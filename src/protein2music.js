/**
 * Protein -> music: the forward algorithm of Nadirova & Zhigailov (Heliyon 2026, e45432).
 *
 * The amino-acid chain is read from the N-terminus in duplexes (pairs). Each duplex is one of:
 *   - a pitch-coding duplex (Table 2)      -> a note
 *   - GG                                    -> a G note, or an accent on the previous sound
 *   - methionine + neutral residue          -> a rest (Table 4), or an arpeggio mark next to a chord
 *   - methionine + charged residue          -> a duration modifier of the adjacent note (Table 3),
 *                                              or, for two adjacent such duplexes, two notes
 *   - proline + residue                     -> a chord built on the preceding note (Table 6)
 *   - PP / PG / GP                          -> non-harmonic tones (grace notes / passing tones)
 * Note length (Table 3), octave (Table 5), dynamics (Table 7) and tempo (Table 8) are derived
 * from charge, hydrophilicity, secondary-structure propensity and localization respectively.
 */
import * as T from './tables.js';
import {
  BASE_DUR, applyEffect, midiOf, fitToRange, chordMidis, ticksToString, PITCH_NAMES,
  fractionToTicks, LEVELS,
} from './theory.js';

// ---------------------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------------------

/**
 * Parse FASTA text (or a bare sequence) into chains. Whitespace, digits and '*' are ignored.
 * @returns {{name:string, sequence:string}[]}
 */
export function parseFasta(text, { ignoreUnknown = false } = {}) {
  const chains = [];
  let cur = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      cur = { name: line.slice(1).trim() || `chain ${chains.length + 1}`, sequence: '' };
      chains.push(cur);
    } else {
      if (!cur) { cur = { name: '', sequence: '' }; chains.push(cur); }
      cur.sequence += line;
    }
  }
  for (const c of chains) c.sequence = cleanSequence(c.sequence, { ignoreUnknown });
  return chains.filter((c) => c.sequence.length > 0);
}

/** Upper-case, strip whitespace/digits/'*'; validate against the 20 standard amino acids. */
export function cleanSequence(raw, { ignoreUnknown = false } = {}) {
  const s = String(raw).toUpperCase().replace(/[\s\d*\-.]/g, '');
  const bad = [...new Set([...s].filter((ch) => !T.AMINO_ACIDS.includes(ch)))];
  if (bad.length && !ignoreUnknown) {
    throw new Error(`Unknown amino acid code(s): ${bad.join(', ')} (only the 20 standard one-letter codes are supported)`);
  }
  return [...s].filter((ch) => T.AMINO_ACIDS.includes(ch)).join('');
}

// ---------------------------------------------------------------------------------------
// Per-chain analysis: residues, secondary-structure segments, duplexes and windows
// ---------------------------------------------------------------------------------------

export function analyzeChain(seq) {
  const n = seq.length;
  const residues = [...seq].map((aa, i) => ({ i, aa, sigma: T.AA[aa].sigma, alpha: T.AA[aa].alpha, beta: T.AA[aa].beta }));

  // Segments between glycine/proline residues (they interrupt the α/β calculation).
  const segments = [];
  const segOf = new Array(n).fill(null);
  let start = null;
  for (let i = 0; i <= n; i++) {
    const brk = i === n || T.BREAKERS.includes(seq[i]);
    if (!brk && start === null) start = i;
    if (brk && start !== null) {
      const seg = { start, end: i - 1, length: i - start };
      segments.push(seg);
      for (let k = start; k < i; k++) segOf[k] = seg;
      start = null;
    }
  }

  // Duplexes: pairs from the N-terminus; an odd chain re-uses the penultimate residue.
  const duplexes = [];
  for (let i = 0; i + 1 < n; i += 2) duplexes.push({ idx: duplexes.length, i, j: i + 1, aa: seq[i] + seq[i + 1] });
  if (n % 2 === 1 && n >= 3) duplexes.push({ idx: duplexes.length, i: n - 2, j: n - 1, aa: seq[n - 2] + seq[n - 1], overlap: true });

  /** Σ6σ: hydrophilicity of the six residues nearest to a duplex (Table 5). */
  const sigma6 = (i) => {
    if (n < T.SIGMA_WINDOW) return null;
    let s = i - 2;
    s = Math.max(0, Math.min(s, n - T.SIGMA_WINDOW));
    let sum = 0;
    for (let k = s; k < s + T.SIGMA_WINDOW; k++) sum += residues[k].sigma;
    return Math.round(sum * 10) / 10;
  };

  /** Dynamics window (Table 7): the eight nearest residues inside the duplex's segment. */
  const dynamics = (i, j) => {
    const seg = segOf[i] || segOf[j];
    if (!seg) return null; // both residues are G/P: no level of its own
    if (seg.length <= T.SHORT_SEGMENT) return { short: true, category: 'mf', alphaAv: null, betaAv: null, window: [seg.start, seg.end] };
    const first = segOf[i] ? i : j;
    let s = first - 3;
    s = Math.max(seg.start, Math.min(s, seg.end - (T.DYNAMIC_WINDOW - 1)));
    let a = 0, b = 0;
    for (let k = s; k < s + T.DYNAMIC_WINDOW; k++) { a += residues[k].alpha; b += residues[k].beta; }
    const alphaAv = a / T.DYNAMIC_WINDOW, betaAv = b / T.DYNAMIC_WINDOW;
    return { short: false, category: T.dynamicCategory(alphaAv, betaAv), alphaAv, betaAv, window: [s, s + T.DYNAMIC_WINDOW - 1] };
  };

  return { seq, n, residues, segments, segOf, duplexes, sigma6, dynamics };
}

// ---------------------------------------------------------------------------------------
// Duplex roles
// ---------------------------------------------------------------------------------------

function classifyDuplexes(duplexes) {
  const hasP = (d) => d && d.aa.includes('P');
  for (let k = 0; k < duplexes.length; k++) {
    const d = duplexes[k], prev = duplexes[k - 1], next = duplexes[k + 1];
    const { aa } = d;
    if (aa.includes('P')) {
      if (aa === 'PP' || aa === 'PG' || aa === 'GP') d.role = { kind: 'nonharm', type: aa };
      else d.role = { kind: 'chord', chord: T.CHORDS[aa], partner: aa.replace('P', '') };
    } else if (aa.includes('M')) {
      const other = aa === 'MM' ? 'M' : aa.replace('M', '');
      if (aa === 'MM') d.role = { kind: 'rest', dur: fractionToTicks(...T.REST_DURATION.MM) };
      else if (T.isCharged(other)) d.role = { kind: 'mod', pos: aa[0] === 'M' ? 'first' : 'second', residue: other };
      else if ((aa === 'GM' || aa === 'MG') && (hasP(prev) && prev.role?.kind === 'chord' || hasP(next) && !['PP', 'PG', 'GP'].includes(next.aa))) {
        d.role = { kind: 'arp', dir: aa === 'GM' ? 'up' : 'down', target: hasP(prev) && prev.role?.kind === 'chord' ? 'prev' : 'next' };
      } else d.role = { kind: 'rest', dur: fractionToTicks(...T.REST_DURATION[aa]) };
    } else if (aa === 'GG') d.role = { kind: 'gg' };
    else d.role = { kind: 'note', pc: T.PITCH_OF_DUPLEX[aa] };
  }
  // Two adjacent methionine duplexes "Mx + yM" (x, y charged) encode two notes (note to Table 2).
  for (let k = 0; k + 1 < duplexes.length; k++) {
    const a = duplexes[k], b = duplexes[k + 1];
    if (a.role.kind === 'mod' && a.role.pos === 'first' && b.role.kind === 'mod' && b.role.pos === 'second') {
      const pc = T.M_PAIR_PITCH['M' + a.role.residue + b.role.residue + 'M'];
      a.role = { kind: 'modpair', pc, effect: T.M_FIRST_EFFECTS[a.role.residue], partner: k + 1 };
      b.role = { kind: 'modpair2', pc, effect: T.M_SECOND_EFFECTS[b.role.residue] };
      k++;
    }
  }
  // GG is played as a G note only after a glycine-containing duplex or a rest, or before a
  // proline duplex; otherwise it accents the preceding sound.
  for (let k = 0; k < duplexes.length; k++) {
    const d = duplexes[k];
    if (d.role.kind !== 'gg') continue;
    const prev = duplexes[k - 1], next = duplexes[k + 1];
    const played = (prev && (prev.aa.includes('G') || prev.role.kind === 'rest')) || (next && next.aa.includes('P'));
    d.role = played ? { kind: 'note', pc: 7, fromGG: true } : { kind: 'gg-accent' };
  }
}

// ---------------------------------------------------------------------------------------
// Conversion of one chain into a list of musical elements
// ---------------------------------------------------------------------------------------

const cloneChord = (c) => ({ ...c, root: { ...c.root }, pitches: [...c.pitches], extra: [...(c.extra || [])], src: { ...c.src, repeated: true } });

/**
 * @param {string} seq amino-acid sequence (validated)
 * @param {object} opts { instrument: 'piano'|'guitar', name }
 */
export function convertChain(seq, opts = {}) {
  const instrument = opts.instrument || 'piano';
  const range = T.INSTRUMENT_RANGE[instrument] || T.INSTRUMENT_RANGE.piano;
  const A = analyzeChain(seq);
  const { duplexes } = A;
  classifyDuplexes(duplexes);

  const elements = [];
  let stored = BASE_DUR;      // the current "integer" note value
  let pending = [];           // effects of "Mx" duplexes waiting for the next note
  let pendingArp = null;      // arpeggio direction waiting for the next chord
  let pendingRootChords = []; // chords waiting for the following note to give them a root

  const lastSound = () => {
    for (let k = elements.length - 1; k >= 0; k--) if (elements[k].kind === 'note' || elements[k].kind === 'chord') return elements[k];
    return null;
  };
  const takePending = (eff) => {
    let e = eff;
    for (const p of pending) e = T.composeEffects(p, e);
    pending = [];
    return e;
  };
  const pitchInfo = (d, pc) => {
    const s6 = A.sigma6(d.i);
    const octave = s6 === null ? 4 : T.octaveFromSigma(s6, instrument);
    const midi = fitToRange(midiOf(pc, octave), range.low, range.high);
    return { pc, octave, midi, sigma6: s6, name: PITCH_NAMES[pc] };
  };
  const buildChord = (el, chord, d) => {
    el.kind = 'chord';
    el.symbol = chord.symbol;
    el.chordName = chord.name;
    el.intervals = chord.intervals;
    el.pitches = el.root ? chordMidis(el.root.midi, chord.intervals, range.low, range.high) : [];
    el.extra = el.extra || [];
    el.src.chordIdx = d.idx;
    el.src.chordAa = d.aa;
    el.src.lastIdx = d.idx;
    if (pendingArp) { el.arpeggio = pendingArp; pendingArp = null; }
  };

  const emitNote = (d, pc, ownEffect, extra = {}) => {
    const effect = takePending(ownEffect);
    const before = stored;
    const r = applyEffect(stored, effect);
    stored = r.stored;
    const p = pitchInfo(d, pc);
    const el = {
      kind: 'note', pc: p.pc, octave: p.octave, midi: p.midi, name: p.name, dur: r.played,
      storedBefore: before, storedAfter: r.stored, effect,
      accent: d.aa.includes('G') || !!extra.accent,
      dyn: A.dynamics(d.i, d.j), sigma6: p.sigma6, graces: [],
      src: { idx: d.idx, lastIdx: d.idx, aa: d.aa, i: d.i, j: d.j, fromGG: !!extra.fromGG },
    };
    if (pendingRootChords.length) {
      // "If a proline-containing duplex follows a rest, or is not preceded by a pitch-coding
      // duplex at the N-terminus, the subsequent note is designated as the root pitch."
      for (const c of pendingRootChords) {
        c.root = { pc: p.pc, octave: p.octave, midi: p.midi, name: p.name };
        c.pitches = chordMidis(p.midi, c.intervals, range.low, range.high);
        c.accent = c.accent || el.accent;
        c.dyn = el.dyn; c.sigma6 = p.sigma6;
        c.src.rootIdx = d.idx; c.src.rootAa = d.aa; c.src.lastIdx = d.idx;
        c.pendingRoot = false;
      }
      pendingRootChords[pendingRootChords.length - 1].dur = r.played;
      pendingRootChords = [];
      return null;
    }
    elements.push(el);
    return el;
  };

  const emitChord = (d) => {
    const chord = d.role.chord;
    const own = T.duplexEffect(d.aa.replace('P', 'A')); // proline counts as a neutral partner
    const last = elements[elements.length - 1];
    if (last && last.kind === 'note' && last.src.lastIdx === d.idx - 1) {
      // The preceding note becomes the root of the chord (one sound, e.g. "WN KP" -> Dadd9).
      const effect = takePending(T.composeEffects(last.effect, own));
      const r = applyEffect(last.storedBefore, effect);
      stored = r.stored;
      last.effect = effect; last.storedAfter = r.stored; last.dur = r.played;
      last.root = { pc: last.pc, octave: last.octave, midi: last.midi, name: last.name };
      last.src.rootIdx = last.src.idx; last.src.rootAa = last.src.aa;
      buildChord(last, chord, d);
      return;
    }
    const effect = takePending(own);
    const before = stored;
    const r = applyEffect(stored, effect);
    stored = r.stored;
    const el = { kind: 'chord', dur: r.played, storedBefore: before, storedAfter: r.stored, effect, accent: false, dyn: null, sigma6: null, graces: [], src: { idx: d.idx, aa: d.aa } };
    if (last && last.kind === 'chord' && last.src.lastIdx === d.idx - 1 && last.root) {
      el.root = { ...last.root }; el.dyn = last.dyn; el.sigma6 = last.sigma6; el.src.rootIdx = last.src.rootIdx; el.src.rootAa = last.src.rootAa;
      buildChord(el, chord, d);
    } else if (last && last.kind === 'chord' && last.src.lastIdx === d.idx - 1 && !last.root) {
      el.root = null; buildChord(el, chord, d); el.pendingRoot = true; pendingRootChords.push(el);
    } else {
      el.root = null; buildChord(el, chord, d); el.pendingRoot = true; pendingRootChords.push(el);
    }
    elements.push(el);
  };

  for (const d of duplexes) {
    const role = d.role;
    switch (role.kind) {
      case 'note': emitNote(d, role.pc, role.fromGG ? T.EFFECT_NONE : T.duplexEffect(d.aa), { fromGG: role.fromGG, accent: role.fromGG }); break;
      case 'modpair': emitNote(d, role.pc, role.effect); break;
      case 'modpair2': emitNote(d, role.pc, role.effect); break;
      case 'mod': {
        if (role.pos === 'first') { pending.push(T.M_FIRST_EFFECTS[role.residue]); break; }
        const eff = T.M_SECOND_EFFECTS[role.residue];
        const target = lastSound();
        if (target && target.src.lastIdx === d.idx - 1 && target.storedBefore !== undefined) {
          // "XX + KM": the preceding note is re-timed.
          target.effect = T.composeEffects(target.effect, eff);
          const r = applyEffect(target.storedBefore, target.effect);
          target.dur = r.played; target.storedAfter = r.stored; stored = r.stored;
          target.src.lastIdx = d.idx;
        } else {
          stored = applyEffect(stored, eff).stored; // nothing adjacent to re-time: shift the running value
        }
        break;
      }
      case 'gg-accent': { const t = lastSound(); if (t) { t.accent = true; t.ggAccent = true; } break; }
      case 'rest': elements.push({ kind: 'rest', dur: role.dur, src: { idx: d.idx, lastIdx: d.idx, aa: d.aa, i: d.i, j: d.j } }); break;
      case 'arp': {
        if (role.target === 'prev') { const t = lastSound(); if (t && t.kind === 'chord') t.arpeggio = role.dir; }
        else pendingArp = role.dir;
        break;
      }
      case 'chord': emitChord(d); break;
      case 'nonharm': elements.push({ kind: 'nonharm', type: role.type, src: { idx: d.idx, lastIdx: d.idx, aa: d.aa, i: d.i, j: d.j } }); break;
      default: break;
    }
  }
  // Chords that never received a root (short peptides) are played on C.
  for (const c of pendingRootChords) {
    c.root = { pc: 0, octave: 4, midi: 60, name: 'C' };
    c.pitches = chordMidis(60, c.intervals, range.low, range.high);
    c.pendingRoot = false; c.src.rootAa = null;
  }

  resolveNonHarmonic(elements);
  resolveDynamics(elements);
  return { instrument, range, analysis: A, elements, duplexes, sequence: seq, name: opts.name || '' };
}

/**
 * Non-harmonic tones (Section 2.5): PG merges the preceding note into the following one,
 * GP merges two preceding notes into the following one, PP merges two preceding and two
 * following notes into one sound. Next to a chord the tones are added to the chord; between
 * two chords the preceding chord is sounded twice.
 */
function resolveNonHarmonic(elements) {
  const isSound = (e) => e && (e.kind === 'note' || e.kind === 'chord');
  const isNote = (e) => e && e.kind === 'note';
  for (let guard = 0; guard < 10000; guard++) {
    const k = elements.findIndex((e) => e.kind === 'nonharm');
    if (k < 0) break;
    const nh = elements[k];
    const before = (nh.type === 'PG') ? 1 : 2;         // notes taken from before
    const after = (nh.type === 'PP') ? 2 : 1;           // notes taken from after
    const prev = elements[k - 1], next = elements[k + 1];
    if (prev?.kind === 'chord' && next?.kind === 'chord') {
      elements.splice(k, 1, cloneChord(prev));
      continue;
    }
    if (prev?.kind === 'chord') {
      // non-chord tones after the chord are added to it
      let taken = 0;
      while (taken < after && isNote(elements[k + 1])) { prev.extra.push(elements[k + 1].midi); elements.splice(k + 1, 1); taken++; }
      elements.splice(k, 1);
      continue;
    }
    if (next?.kind === 'chord') {
      let taken = 0;
      while (taken < before && isNote(elements[k - 1 - taken])) { next.extra.push(elements[k - 1 - taken].midi); taken++; }
      elements.splice(k - taken, taken + 1);
      continue;
    }
    // grace notes / passing tones
    const graces = [];
    let taken = 0;
    while (taken < before && isNote(elements[k - 1 - taken])) { graces.unshift(elements[k - 1 - taken]); taken++; }
    const mainIdx = k + 1;
    if (isNote(elements[mainIdx])) {
      const main = elements[mainIdx];
      main.graces = [...graces.map((g) => ({ pc: g.pc, octave: g.octave, midi: g.midi, name: g.name, src: g.src })), ...main.graces];
      if (nh.type === 'PP' && isNote(elements[mainIdx + 1]) && isSound(elements[mainIdx + 2])) {
        const passing = elements[mainIdx + 1];
        const target = elements[mainIdx + 2];
        if (target.kind === 'note') target.graces.unshift({ pc: passing.pc, octave: passing.octave, midi: passing.midi, name: passing.name, src: passing.src, passing: true });
        else target.extra.push(passing.midi);
        elements.splice(mainIdx + 1, 1);
      }
      elements.splice(k - taken, taken + 1);
    } else {
      elements.splice(k, 1); // nothing to merge into: the preceding notes stay as they are
    }
  }
}

/**
 * Table 7: resolve the (α < 0.4, β ≥ 1.5) category into mezzo-piano or a crescendo /
 * diminuendo, depending on the levels before and after the region.
 */
function resolveDynamics(elements) {
  const sounds = elements.filter((e) => e.kind === 'note' || e.kind === 'chord');
  for (const e of sounds) {
    e.level = e.dyn ? (e.dyn.category === 'mpcat' ? null : e.dyn.category) : undefined; // undefined = inherit
    e.hairpin = null;
  }
  let k = 0;
  while (k < sounds.length) {
    if (!(sounds[k].dyn && sounds[k].dyn.category === 'mpcat')) { k++; continue; }
    let end = k;
    while (end + 1 < sounds.length && sounds[end + 1].dyn && sounds[end + 1].dyn.category === 'mpcat') end++;
    let prev = null, next = null;
    for (let a = k - 1; a >= 0; a--) if (sounds[a].level) { prev = sounds[a].level; break; }
    for (let b = end + 1; b < sounds.length; b++) if (sounds[b].dyn && sounds[b].dyn.category !== 'mpcat' && sounds[b].level) { next = sounds[b].level; break; }
    if (prev && next && prev !== next) {
      const kind = LEVELS.indexOf(next) > LEVELS.indexOf(prev) ? 'cresc' : 'dim';
      for (let m = k; m <= end; m++) sounds[m].hairpin = { kind, from: prev, to: next, start: m === k, end: m === end };
    } else {
      for (let m = k; m <= end; m++) sounds[m].level = 'mp';
    }
    k = end + 1;
  }
  // effective level (for playback and markings)
  let current = 'mf';
  for (const e of sounds) {
    if (e.hairpin) { e.effectiveLevel = current; continue; }
    if (e.level) current = e.level;
    e.effectiveLevel = current;
  }
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

/**
 * Convert a protein (one or several chains) into a Score.
 * @param {string|{name:string,sequence:string}[]} input FASTA text, a bare sequence or chains
 * @param {object} options
 *   title        - title of the piece
 *   localization - key of Table 8 (e.g. 'golgi', 'cytosol', 'secreted') or a tempo marking
 *   bpm          - explicit tempo (overrides the localization's default)
 *   instruments  - per-chain instruments, default ['piano', 'guitar', 'piano', ...]
 *   ignoreUnknown - drop letters that are not standard amino acids instead of failing
 */
export function proteinToMusic(input, options = {}) {
  const chains = Array.isArray(input) ? input.map((c) => ({ name: c.name || '', sequence: cleanSequence(c.sequence, options) }))
    : parseFasta(input, options);
  if (!chains.length) throw new Error('No amino-acid sequence found');
  const warnings = [];
  const tempoEntry = options.localization ? T.tempoFor(options.localization) : T.DEFAULT_TEMPO;
  if (!tempoEntry) throw new Error(`Unknown localization "${options.localization}". Use one of: ${T.TEMPOS.map((t) => t.id).join(', ')}`);
  const tempo = { marking: options.tempoMarking || tempoEntry.marking, bpm: options.bpm || tempoEntry.bpm, localization: tempoEntry.localization, id: tempoEntry.id };
  const instruments = options.instruments || [];
  const parts = chains.map((c, k) => {
    const instrument = instruments[k] || (k === 1 ? 'guitar' : 'piano');
    if (c.sequence.length < 2) warnings.push(`Chain ${k + 1} (${c.name || 'unnamed'}) has fewer than two residues and produces no music`);
    const part = convertChain(c.sequence, { instrument, name: c.name });
    return {
      name: c.name || (chains.length > 1 ? `Chain ${String.fromCharCode(65 + k)}` : 'Protein'),
      instrument, midiProgram: part.range.midiProgram, instrumentName: part.range.name,
      sequence: c.sequence, elements: part.elements, table: duplexTable(part), segments: part.analysis.segments,
    };
  });
  const texture = parts.length === 1 ? 'monophony' : parts.length === 2 ? 'biphony' : 'polyphony';
  return { title: options.title || chains[0].name || 'Protein music', tempo, meter: '4/4', texture, parts, warnings };
}

/** The per-duplex table of a chain, in the style of the paper's figures. */
export function duplexTable(part) {
  const rows = [];
  const byIdx = new Map();
  for (const e of part.elements) {
    if (e.kind === 'nonharm') continue;
    const first = e.src.rootIdx !== undefined && e.src.rootIdx !== null ? Math.min(e.src.rootIdx, e.src.idx) : e.src.idx;
    const last = e.src.lastIdx !== undefined ? e.src.lastIdx : e.src.idx;
    for (let i = first; i <= last; i++) byIdx.set(i, e);
    for (const g of e.graces || []) if (g.src) byIdx.set(g.src.idx, { ...e, kind: 'grace', graceOf: e, grace: g });
  }
  for (const d of part.duplexes) {
    const e = byIdx.get(d.idx);
    const row = { idx: d.idx, aa: d.aa, residues: [d.i + 1, d.j + 1], role: d.role.kind, sigma6: part.analysis.sigma6(d.i) };
    if (d.role.kind === 'note' || d.role.kind === 'modpair' || d.role.kind === 'modpair2' || d.role.kind === 'chord') {
      if (e && (e.kind === 'note' || e.kind === 'chord' || e.kind === 'grace')) {
        const el = e.kind === 'grace' ? e.graceOf : e;
        row.note = e.kind === 'grace' ? `${e.grace.octave};${e.grace.name};grace` : describeElement(el);
        row.alphaAv = el.dyn?.alphaAv ?? null; row.betaAv = el.dyn?.betaAv ?? null;
        row.level = el.hairpin ? el.hairpin.kind : el.level || (el.dyn?.short ? 'mf' : null);
        row.shift = el.effect ? el.effect.exp + (el.effect.frac ? el.effect.frac * 0.5 : 0) : 0;
        row.accent = !!el.accent;
      } else if (e && e.kind === 'rest') row.note = 'rest ' + ticksToString(e.dur);
    } else if (d.role.kind === 'rest') row.note = 'rest ' + ticksToString(d.role.dur);
    else if (d.role.kind === 'mod') row.note = (d.role.pos === 'first' ? 'modifies next note' : 'modifies previous note');
    else if (d.role.kind === 'gg-accent') row.note = 'accent on previous sound';
    else if (d.role.kind === 'arp') row.note = `arpeggio (${d.role.dir})`;
    else if (d.role.kind === 'nonharm') row.note = { PP: 'passing tones', PG: 'grace note', GP: 'grace notes' }[d.role.type];
    rows.push(row);
  }
  return rows;
}

/** "4;A#;1/8" / "6;G#add2;1" as in the paper's figures. */
export function describeElement(e) {
  if (e.kind === 'rest') return 'rest ' + ticksToString(e.dur);
  if (e.kind === 'chord') return `${e.root.octave};${e.root.name}${e.symbol};${ticksToString(e.dur)}`;
  return `${e.octave};${e.name};${ticksToString(e.dur)}`;
}
