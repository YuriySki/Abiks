/**
 * ABC notation: writer (Score -> ABC, in the style used by the paper: L:1/1, dynamics and
 * accents as !decorations!, chords in brackets) and a parser for the subset of ABC needed to
 * translate music back into a protein.
 */
import { TICKS_PER_WHOLE, ticksToString, pcOf, octaveOf, PITCH_NAMES, midiOf, quantizeDuration, isRepresentable, fractionToTicks } from './theory.js';

// ---------------------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------------------

const LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

/** MIDI number -> ABC pitch with sharps, e.g. 61 -> "^C", 72 -> "c", 48 -> "C,". */
export function abcPitch(midi) {
  const pc = pcOf(midi), oct = octaveOf(midi);
  let s = (SHARP[pc] ? '^' : '') + (oct >= 5 ? LETTERS[pc].toLowerCase() : LETTERS[pc]);
  if (oct >= 6) s += "'".repeat(oct - 5);
  if (oct <= 3) s += ','.repeat(4 - oct);
  return s;
}

function abcLen(ticks) {
  const s = ticksToString(ticks);
  return s.startsWith('1/') ? s.slice(1) : s; // "1/8" -> "/8"
}

const HAIRPIN_OPEN = { cresc: '!crescendo(!', dim: '!diminuendo(!' };
const HAIRPIN_CLOSE = { cresc: '!crescendo)!', dim: '!diminuendo)!' };

/**
 * @param {object} score a Score produced by proteinToMusic
 * @param {object} opts { barLength: ticks per bar (default one whole note), barsPerLine }
 */
export function scoreToAbc(score, opts = {}) {
  const barLength = opts.barLength || TICKS_PER_WHOLE;
  const barsPerLine = opts.barsPerLine || 4;
  const lines = [];
  lines.push('X:1');
  lines.push('T:' + (score.title || 'Protein music').replace(/\n/g, ' '));
  if (score.tempo?.localization) lines.push(`%%localization ${score.tempo.localization}`);
  lines.push(`%%abiks texture ${score.texture || 'monophony'}`);
  lines.push('M:4/4');
  lines.push('L:1/1');
  lines.push(`Q:"${score.tempo?.marking || ''}" 1/4=${score.tempo?.bpm || 76}`);
  lines.push('K:C');
  score.parts.forEach((p, k) => {
    const sounds = p.elements.filter((e) => e.kind === 'note' || e.kind === 'chord');
    const mids = sounds.flatMap((e) => (e.kind === 'note' ? [e.midi] : e.pitches)).sort((a, b) => a - b);
    const clef = mids.length && mids[Math.floor(mids.length / 2)] < 55 ? 'bass' : 'treble';
    lines.push(`V:${k + 1} clef=${clef} name="${p.instrumentName || p.instrument}${p.name ? ' – ' + p.name : ''}"`);
    lines.push(`%%MIDI program ${p.midiProgram ?? 0}`);
  });
  score.parts.forEach((p, k) => {
    if (score.parts.length > 1) lines.push(`[V:${k + 1}]`);
    if (p.sequence) lines.push(`%%sequence ${p.sequence}`);
    lines.push(...voiceBody(p.elements, barLength, barsPerLine));
  });
  return lines.join('\n') + '\n';
}

/**
 * ABC accidentals last until the end of the bar, so the writer tracks what has been written
 * in the current bar and emits "^" / "=" only when the sounding pitch requires it.
 */
class BarAccidentals {
  constructor() { this.reset(); }
  reset() { this.state = {}; }
  pitch(midi) {
    const pc = pcOf(midi), oct = octaveOf(midi);
    const key = LETTERS[pc] + oct;
    const want = SHARP[pc] ? 1 : 0;
    let acc = '';
    if ((this.state[key] ?? 0) !== want) { acc = want ? '^' : '='; this.state[key] = want; }
    let s = acc + (oct >= 5 ? LETTERS[pc].toLowerCase() : LETTERS[pc]);
    if (oct >= 6) s += "'".repeat(oct - 5);
    if (oct <= 3) s += ','.repeat(4 - oct);
    return s;
  }
}

function voiceBody(elements, barLength, barsPerLine) {
  const out = [];
  let line = [];
  let t = 0, bars = 0, lastMarked = null, first = true, closing = null;
  const acc = new BarAccidentals();
  const flushBar = () => {
    line.push('|');
    acc.reset();
    bars++;
    if (bars % barsPerLine === 0) { out.push(line.join(' ')); line = []; }
  };
  for (const e of elements) {
    if (e.kind === 'nonharm') continue;
    let tok = '';
    if (closing) { tok += closing + ' '; closing = null; }
    if (e.kind === 'rest') {
      tok += 'z' + abcLen(e.dur);
    } else {
      if (e.hairpin) {
        if (e.hairpin.start) tok += HAIRPIN_OPEN[e.hairpin.kind] + ' ';
        if (e.hairpin.end) closing = HAIRPIN_CLOSE[e.hairpin.kind];
      } else {
        const lvl = e.level || (first ? e.effectiveLevel || 'mf' : null);
        if (lvl && lvl !== lastMarked) { tok += `!${lvl}! `; lastMarked = lvl; }
      }
      if (e.accent) tok += '!>!';
      if (e.arpeggio) tok += '!arpeggio!';
      if (e.graces && e.graces.length) tok += '{' + e.graces.map((g) => acc.pitch(g.midi)).join('') + '}';
      if (e.kind === 'note') tok += acc.pitch(e.midi) + abcLen(e.dur);
      else {
        const pitches = [...new Set([...e.pitches, ...(e.extra || [])])].sort((a, b) => a - b);
        tok += '[' + pitches.map((m) => acc.pitch(m)).join(' ') + ']' + abcLen(e.dur);
      }
      first = false;
    }
    line.push(tok);
    const before = t;
    t += e.dur;
    if (Math.floor(t / barLength) > Math.floor(before / barLength)) flushBar();
  }
  if (closing) line.push(closing);
  if (line.length && line[line.length - 1] === '|') line[line.length - 1] = '|]';
  else if (line.length) line.push('|]');
  if (line.length) out.push(line.join(' '));
  if (out.length && !out[out.length - 1].trim().endsWith('|]')) out[out.length - 1] += ' |]';
  return out;
}

// ---------------------------------------------------------------------------------------
// Parser (subset of the ABC 2.1 standard sufficient for melodies with chords, grace notes,
// rests, dynamics, accents and hairpins - i.e. what the paper's reverse translation needs)
// ---------------------------------------------------------------------------------------

const KEY_SHARPS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const MODE_SHIFT = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, dor: -2, phr: -4, lyd: 1, mix: -1, loc: -5 };
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Key signature string ("G", "Am", "D mix", "HP") -> map letter -> alteration. */
export function keySignature(k) {
  const acc = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const m = /^\s*([A-G])([#b]?)\s*([a-zA-Z]*)/.exec(k || 'C');
  if (!m) return acc;
  let tonic = m[1] + m[2];
  let mode = (m[3] || 'maj').toLowerCase().slice(0, 3);
  if (m[3] && m[3].toLowerCase() === 'm') mode = 'm';
  const shift = MODE_SHIFT[mode] ?? 0;
  // find the relative major: move tonic by -shift semitones along the circle of fifths
  const order = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  const enh = { 'A#': 'Bb', 'D#': 'Eb', 'G#': 'Ab', 'A#m': 'Bb' };
  tonic = enh[tonic] || tonic;
  let sharps = KEY_SHARPS[tonic];
  if (sharps === undefined) sharps = 0;
  // mode shift in fifths: minor = -3 fifths, dorian -2, phrygian -4, lydian +1, mixolydian -1, locrian -5
  sharps += shift;
  if (sharps > 0) for (let i = 0; i < Math.min(7, sharps); i++) acc[SHARP_ORDER[i]] = 1;
  if (sharps < 0) for (let i = 0; i < Math.min(7, -sharps); i++) acc[FLAT_ORDER[i]] = -1;
  void order;
  // explicit accidentals after the key, e.g. "K:D ^f _c"
  const rest = (k || '').slice(m[0].length);
  for (const x of rest.matchAll(/([_^=]+)([a-gA-G])/g)) {
    const a = x[1] === '^' ? 1 : x[1] === '^^' ? 2 : x[1] === '_' ? -1 : x[1] === '__' ? -2 : 0;
    acc[x[2].toUpperCase()] = a;
  }
  return acc;
}

function parseLength(str, unit) {
  // returns ticks for a length suffix like "", "2", "/", "//", "/8", "3/16", "3/2"
  if (!str) return unit;
  let num = 1, den = 1;
  const m = /^(\d+)?(\/+)?(\d+)?$/.exec(str);
  if (!m) return unit;
  if (m[1]) num = parseInt(m[1], 10);
  if (m[2]) {
    if (m[3]) den = parseInt(m[3], 10);
    else den = 2 ** m[2].length;
  }
  return Math.round((unit * num) / den);
}

const DYNAMIC_DECOS = new Set(['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sfz']);
const LEVEL_MAP = { pppp: 'p', ppp: 'p', pp: 'p', p: 'p', mp: 'mp', mf: 'mf', f: 'f', ff: 'f', fff: 'f', ffff: 'f', sfz: 'f' };

/**
 * Parse ABC text into a Score-like object: { title, tempo:{bpm}, parts:[{name, elements}] }.
 * Elements: note {midi, pc, octave, dur, accent, level, hairpin, graces:[{midi}]},
 *           rest {dur}, chord {pitches, dur, accent, arpeggio, level, hairpin, graces}.
 * `warnings` lists constructs that were simplified (tuplets, ties, trills...).
 */
export function parseAbc(text) {
  const warnings = [];
  const header = { title: '', bpm: null, tempoMarking: '', unit: TICKS_PER_WHOLE / 8, meter: '4/4', key: 'C', sequences: [] };
  const voices = new Map();
  let current = null;
  const getVoice = (id) => {
    if (!voices.has(id)) voices.set(id, { id, name: '', elements: [], state: null });
    return voices.get(id);
  };
  const lines = String(text).replace(/\r/g, '').split('\n');
  let inBody = false;
  const applyField = (f, value) => {
    switch (f) {
      case 'T': if (!header.title) header.title = value.trim(); break;
      case 'L': { const m = /(\d+)\s*\/\s*(\d+)/.exec(value); if (m) header.unit = fractionToTicks(+m[1], +m[2]); break; }
      case 'M': header.meter = value.trim(); if (!/\d+\s*\/\s*\d+/.test(value) && value.trim() === 'C') header.meter = '4/4'; break;
      case 'Q': {
        const q = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+)/.exec(value.replace(/"[^"]*"/g, ''));
        const name = /"([^"]*)"/.exec(value);
        if (name) header.tempoMarking = name[1];
        if (q) {
          const bpm = +q[3];
          header.bpm = q[1] ? Math.round((bpm * (+q[1] / +q[2])) / 0.25) : bpm; // normalise to quarter-note beats
        }
        break;
      }
      case 'K': header.key = value.trim(); if (current) current.state.key = keySignature(header.key); break;
      case 'V': {
        const id = value.trim().split(/\s+/)[0];
        current = getVoice(id);
        const nm = /name="([^"]*)"/.exec(value); if (nm) current.name = nm[1];
        if (!current.state) current.state = newState(header);
        break;
      }
      default: break;
    }
  };
  const newState = (h) => ({ key: keySignature(h.key), measureAcc: {}, level: null, hairpin: null, pendingHairpinEnd: false, tuplet: null, brokenRhythm: 0, tie: false });

  for (const raw of lines) {
    let line = raw;
    if (line.startsWith('%%sequence')) { header.sequences.push(line.split(/\s+/)[1] || ''); continue; }
    if (line.startsWith('%')) continue;
    const ci = line.indexOf('%');
    if (ci >= 0 && !line.slice(0, ci).includes('"')) line = line.slice(0, ci);
    if (!line.trim()) continue;
    const fm = /^([A-Za-z]):(.*)$/.exec(line);
    if (fm && !inBody) { applyField(fm[1].toUpperCase(), fm[2]); if (fm[1].toUpperCase() === 'K') inBody = true; continue; }
    if (fm && inBody && /^[VKLMQTWwPN]$/.test(fm[1].toUpperCase())) { applyField(fm[1].toUpperCase(), fm[2]); continue; }
    if (!inBody) continue;
    if (!current) { current = getVoice('1'); current.state = newState(header); }
    parseMusicLine(line, current, header, warnings, getVoice, (v) => { current = v; });
  }
  const parts = [...voices.values()].map((v) => ({ name: v.name || `Voice ${v.id}`, elements: v.elements }));
  if (!parts.length) throw new Error('No music found in the ABC text');
  return { title: header.title, tempo: { bpm: header.bpm || 76, marking: header.tempoMarking }, meter: header.meter, key: header.key, parts, warnings, sequences: header.sequences };
}

function parseMusicLine(line, voiceRef, header, warnings, getVoice, setVoice) {
  let voice = voiceRef;
  let i = 0;
  const st = () => voice.state;
  const pushElement = (el) => {
    const s = st();
    if (s.tuplet) {
      s.tuplet.acc += (el.dur * s.tuplet.q) / s.tuplet.p;
      el.dur = Math.round(s.tuplet.acc) - s.tuplet.given;
      s.tuplet.given += el.dur;
      if (--s.tuplet.count <= 0) s.tuplet = null;
    }
    if (s.brokenRhythm && (el.kind === 'note' || el.kind === 'chord' || el.kind === 'rest')) {
      const prev = s.lastDurEl;
      if (prev) {
        const factor = 2 ** Math.abs(s.brokenRhythm);
        const delta = prev.dur - prev.dur / factor;
        if (s.brokenRhythm > 0) { prev.dur += delta; el.dur -= delta; } else { prev.dur -= delta; el.dur += delta; }
        prev.dur = Math.round(prev.dur); el.dur = Math.round(el.dur);
      }
      s.brokenRhythm = 0;
    }
    if (el.kind !== 'rest') {
      el.level = s.pendingLevel || null; s.pendingLevel = null;
      if (s.hairpin) el.hairpin = { kind: s.hairpin, start: s.hairpinStart }; s.hairpinStart = false;
      if (s.pendingClose) { s.pendingClose = false; }
      el.accent = !!s.pendingAccent; s.pendingAccent = false;
      el.arpeggio = s.pendingArp || null; s.pendingArp = null;
      el.graces = s.pendingGraces || []; s.pendingGraces = null;
      if (s.pendingDecos?.length) { el.decorations = s.pendingDecos; s.pendingDecos = null; }
    }
    if (s.tieNext && (el.kind === 'note' || el.kind === 'chord')) {
      const prev = s.lastDurEl;
      s.tieNext = false;
      if (prev && prev.kind === el.kind && samePitch(prev, el)) { prev.dur += el.dur; s.lastDurEl = prev; return; }
    }
    voice.elements.push(el);
    s.lastDurEl = el;
  };
  const samePitch = (a, b) => (a.kind === 'note' ? a.midi === b.midi : a.pitches.join() === b.pitches.join());

  const readNote = () => {
    // accidentals
    let acc = null;
    const am = /^(\^\^|\^|__|_|=)/.exec(line.slice(i));
    if (am) { acc = { '^^': 2, '^': 1, '__': -2, _: -1, '=': 0 }[am[1]]; i += am[1].length; }
    const ch = line[i];
    if (!/[A-Ga-g]/.test(ch || '')) return null;
    i++;
    let octave = ch === ch.toUpperCase() ? 4 : 5;
    const letter = ch.toUpperCase();
    while (line[i] === "'" || line[i] === ',') { octave += line[i] === "'" ? 1 : -1; i++; }
    const lm = /^(\d*\/*\d*)/.exec(line.slice(i));
    const lenStr = lm ? lm[1] : '';
    i += lenStr.length;
    const s = st();
    const key = letter + octave;
    let alter;
    if (acc !== null) { alter = acc; s.measureAcc[key] = acc; }
    else if (s.measureAcc[key] !== undefined) alter = s.measureAcc[key];
    else alter = s.key[letter] || 0;
    const midi = midiOf(LETTER_PC[letter], octave) + alter;
    return { midi, lenStr };
  };

  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t' || ch === '\\') { i++; continue; }
    if (ch === '[') {
      // inline field or chord
      const fm = /^\[([A-Za-z]):([^\]]*)\]/.exec(line.slice(i));
      if (fm) {
        i += fm[0].length;
        const f = fm[1].toUpperCase();
        if (f === 'V') { const id = fm[2].trim().split(/\s+/)[0]; const v = getVoice(id); if (!v.state) v.state = { key: keySignature(header.key), measureAcc: {}, level: null, hairpin: null }; voice = v; setVoice(v); }
        else if (f === 'K') st().key = keySignature(fm[2]);
        else if (f === 'L') { const m = /(\d+)\s*\/\s*(\d+)/.exec(fm[2]); if (m) header.unit = fractionToTicks(+m[1], +m[2]); }
        else if (f === 'Q') { const q = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+)/.exec(fm[2].replace(/"[^"]*"/g, '')); if (q) header.bpm = q[1] ? Math.round((+q[3] * (+q[1] / +q[2])) / 0.25) : +q[3]; }
        continue;
      }
      if (line[i + 1] === '|') { i += 2; st().measureAcc = {}; continue; } // [| bar
      // chord
      i++;
      const pitches = [];
      let lenInside = '';
      while (i < line.length && line[i] !== ']') {
        if (line[i] === ' ') { i++; continue; }
        if (line[i] === '!') { const e = line.indexOf('!', i + 1); if (e > 0) { handleDecoration(line.slice(i + 1, e), st(), warnings); i = e + 1; continue; } }
        const n = readNote();
        if (!n) { i++; continue; }
        pitches.push(n.midi); lenInside = lenInside || n.lenStr;
      }
      i++; // ]
      const lm = /^(\d*\/*\d*)/.exec(line.slice(i));
      const lenStr = lm && lm[1] ? lm[1] : lenInside;
      i += lm && lm[1] ? lm[1].length : 0;
      const dur = parseLength(lenStr, header.unit);
      if (!pitches.length) continue;
      const uniq = [...new Set(pitches)].sort((a, b) => a - b);
      if (uniq.length === 1) pushElement({ kind: 'note', midi: uniq[0], pc: pcOf(uniq[0]), octave: octaveOf(uniq[0]), dur });
      else pushElement({ kind: 'chord', pitches: uniq, dur });
      if (line[i] === '-') { st().tieNext = true; i++; }
      continue;
    }
    if (ch === '{') {
      const e = line.indexOf('}', i);
      const inner = line.slice(i + 1, e < 0 ? line.length : e).replace(/^\//, '');
      i = e < 0 ? line.length : e + 1;
      const saved = i; const savedLine = line;
      line = inner; i = 0;
      const graces = [];
      while (i < line.length) { if (line[i] === ' ') { i++; continue; } const n = readNote(); if (!n) { i++; continue; } graces.push({ midi: n.midi, pc: pcOf(n.midi), octave: octaveOf(n.midi) }); }
      line = savedLine; i = saved;
      st().pendingGraces = [...(st().pendingGraces || []), ...graces];
      continue;
    }
    if (ch === '!' || ch === '+') {
      const e = line.indexOf(ch, i + 1);
      if (e > 0) { handleDecoration(line.slice(i + 1, e), st(), warnings); i = e + 1; continue; }
      i++; continue;
    }
    if (ch === '"') { const e = line.indexOf('"', i + 1); i = e < 0 ? line.length : e + 1; continue; } // annotation / chord symbol
    if (ch === '|' || ch === ':') {
      while (i < line.length && /[|:\]\[0-9]/.test(line[i])) { if (line[i] === '[' && !/^\[\d/.test(line.slice(i))) break; i++; }
      st().measureAcc = {};
      continue;
    }
    if (ch === '(') {
      const tm = /^\((\d)(?::(\d)?)?(?::(\d)?)?/.exec(line.slice(i));
      if (tm) {
        const p = +tm[1]; let q = tm[2] ? +tm[2] : (p === 3 || p === 6 ? 2 : p === 2 || p === 4 || p === 8 ? 3 : p);
        const r = tm[3] ? +tm[3] : p;
        st().tuplet = { p, q, count: r, acc: 0, given: 0 }; i += tm[0].length; warnings.push(`tuplet (${p}:${q}) approximated by rescaling durations`);
        continue;
      }
      i++; continue; // slur start
    }
    if (ch === ')') { i++; continue; }
    if (ch === '-') { st().tieNext = true; i++; continue; }
    if (ch === '>' || ch === '<') { let n = 0; while (line[i] === ch) { n++; i++; } st().brokenRhythm = ch === '>' ? n : -n; continue; }
    if (ch === '.' || ch === '~' || ch === 'H' || ch === 'L' || ch === 'M' || ch === 'O' || ch === 'P' || ch === 'S' || ch === 'T' || ch === 'u' || ch === 'v') {
      if (ch === 'L') st().pendingAccent = true;
      if (ch === 'T') warnings.push('trill ignored');
      i++; continue;
    }
    if (ch === 'z' || ch === 'x' || ch === 'Z' || ch === 'X') {
      i++;
      const lm = /^(\d*\/*\d*)/.exec(line.slice(i));
      const lenStr = lm ? lm[1] : ''; i += lenStr.length;
      let dur = parseLength(lenStr, header.unit);
      if (ch === 'Z' || ch === 'X') { const [mn, md] = (header.meter.match(/(\d+)\s*\/\s*(\d+)/) || [0, 4, 4]).slice(1).map(Number); dur = fractionToTicks(mn, md) * (lenStr ? parseInt(lenStr, 10) || 1 : 1); }
      pushElement({ kind: 'rest', dur });
      continue;
    }
    if (ch === 'y') { i++; const lm = /^(\d*\/*\d*)/.exec(line.slice(i)); i += lm ? lm[1].length : 0; continue; }
    const n = readNote();
    if (n) {
      const dur = parseLength(n.lenStr, header.unit);
      pushElement({ kind: 'note', midi: n.midi, pc: pcOf(n.midi), octave: octaveOf(n.midi), dur });
      if (line[i] === '-') { st().tieNext = true; i++; }
      continue;
    }
    i++; // unknown character: skip
  }
}

function handleDecoration(name, s, warnings) {
  const d = name.trim();
  if (DYNAMIC_DECOS.has(d)) { s.pendingLevel = LEVEL_MAP[d]; return; }
  if (d === 'crescendo(' || d === '<(') { s.hairpin = 'cresc'; s.hairpinStart = true; return; }
  if (d === 'diminuendo(' || d === '>(') { s.hairpin = 'dim'; s.hairpinStart = true; return; }
  if (d === 'crescendo)' || d === '<)' || d === 'diminuendo)' || d === '>)') {
    if (s.lastDurEl && s.lastDurEl.hairpin) s.lastDurEl.hairpin.end = true;
    s.hairpin = null; return;
  }
  if (d === '>' || d === 'accent' || d === 'emphasis' || d === '^' || d === 'marcato' || d === 'sfz' || d === 'L') { s.pendingAccent = true; return; }
  if (d === 'arpeggio') { s.pendingArp = 'up'; return; }
  if (d === 'trill' || d === 'turn' || d === 'mordent' || d === 'pralltriller' || d === 'roll') { warnings.push(`${d} ignored`); return; }
  s.pendingDecos = [...(s.pendingDecos || []), d];
}

/** Quantise every duration of a parsed score to the paper's note values; returns notes about changes. */
export function normalizeDurations(score) {
  const notes = [];
  for (const p of score.parts) for (const e of p.elements) {
    if (e.dur === undefined) continue;
    if (!isRepresentable(e.dur)) {
      const q = quantizeDuration(e.dur);
      notes.push(`${e.kind} duration ${ticksToString(e.dur)} is not a plain/dotted value between 1/128 and 4: using ${ticksToString(q)}`);
      e.dur = q;
    }
  }
  return notes;
}

export { PITCH_NAMES };
