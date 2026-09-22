/** MusicXML (partwise, 3.1) writer for a Score. No dependencies. */
import { TICKS_PER_WHOLE, TICKS_PER_QUARTER, pcOf, octaveOf } from './theory.js';

const DIVISIONS = TICKS_PER_QUARTER; // divisions per quarter note = 256
const TYPE_OF = { 4096: 'long', 2048: 'breve', 1024: 'whole', 512: 'half', 256: 'quarter', 128: 'eighth', 64: '16th', 32: '32nd', 16: '64th', 8: '128th', 4: '256th' };
const STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split a duration into plain/dotted note values (largest first), e.g. 320 -> [256, 64]. */
function splitDuration(ticks) {
  const parts = [];
  let rest = ticks;
  const values = Object.keys(TYPE_OF).map(Number).sort((a, b) => b - a);
  while (rest > 0) {
    let chosen = null;
    for (const v of values) {
      if ((v * 3) / 2 <= rest && TYPE_OF[v] && v >= 8) { chosen = { dur: (v * 3) / 2, type: TYPE_OF[v], dot: true }; break; }
      if (v <= rest) { chosen = { dur: v, type: TYPE_OF[v], dot: false }; break; }
    }
    if (!chosen) { parts.push({ dur: rest, type: '256th', dot: false }); break; }
    parts.push(chosen); rest -= chosen.dur;
  }
  return parts;
}

function pitchXml(midi) {
  const pc = pcOf(midi);
  return `<pitch><step>${STEP[pc]}</step>${ALTER[pc] ? `<alter>${ALTER[pc]}</alter>` : ''}<octave>${octaveOf(midi)}</octave></pitch>`;
}

function noteXml({ midi, dur, type, dot, chord = false, tieStart = false, tieStop = false, grace = false, accent = false, arpeggio = null, rest = false, voice = 1 }) {
  let s = '<note>';
  if (grace) s += '<grace slash="yes"/>';
  if (chord) s += '<chord/>';
  s += rest ? '<rest/>' : pitchXml(midi);
  if (!grace) s += `<duration>${dur}</duration>`;
  if (tieStart) s += '<tie type="start"/>';
  if (tieStop) s += '<tie type="stop"/>';
  s += `<voice>${voice}</voice><type>${type}</type>`;
  if (dot) s += '<dot/>';
  const notations = [];
  if (tieStart) notations.push('<tied type="start"/>');
  if (tieStop) notations.push('<tied type="stop"/>');
  if (accent) notations.push('<articulations><accent/></articulations>');
  if (arpeggio) notations.push(`<arpeggiate direction="${arpeggio}"/>`);
  if (notations.length) s += '<notations>' + notations.join('') + '</notations>';
  return s + '</note>';
}

/**
 * @param {object} score Score from proteinToMusic
 * @returns {string} MusicXML document
 */
export function scoreToMusicXml(score) {
  const bpm = score.tempo?.bpm || 76;
  const barLen = TICKS_PER_WHOLE;
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="3.1">');
  out.push(`<work><work-title>${esc(score.title || 'Protein music')}</work-title></work>`);
  out.push('<identification><encoding><software>abiks protein-music converter</software></encoding></identification>');
  out.push('<part-list>');
  score.parts.forEach((p, k) => {
    const id = `P${k + 1}`;
    out.push(`<score-part id="${id}"><part-name>${esc(p.instrumentName || p.instrument || 'Piano')}${p.name ? ' – ' + esc(p.name) : ''}</part-name>`);
    out.push(`<score-instrument id="${id}-I1"><instrument-name>${esc(p.instrumentName || 'Piano')}</instrument-name></score-instrument>`);
    out.push(`<midi-instrument id="${id}-I1"><midi-channel>${(k % 15) + 1 + (k >= 9 ? 1 : 0)}</midi-channel><midi-program>${(p.midiProgram ?? 0) + 1}</midi-program></midi-instrument></score-part>`);
  });
  out.push('</part-list>');

  score.parts.forEach((p, k) => {
    out.push(`<part id="P${k + 1}">`);
    const measures = []; // array of arrays of xml strings
    let measureXml = [];
    let pos = 0; // position within the measure
    let measureNo = 1;
    const sounds = p.elements.filter((e) => e.kind !== 'nonharm');
    const mids = sounds.flatMap((e) => (e.kind === 'note' ? [e.midi] : e.kind === 'chord' ? e.pitches : [])).sort((a, b) => a - b);
    const clef = mids.length && mids[Math.floor(mids.length / 2)] < 55 ? '<clef><sign>F</sign><line>4</line></clef>' : '<clef><sign>G</sign><line>2</line></clef>';
    const openMeasure = () => {
      measureXml = [`<measure number="${measureNo}">`];
      if (measureNo === 1) {
        measureXml.push(`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${clef}</attributes>`);
        measureXml.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`);
        if (score.tempo?.marking) measureXml.push(`<direction placement="above"><direction-type><words>${esc(score.tempo.marking)}</words></direction-type></direction>`);
      }
    };
    const closeMeasure = () => { measureXml.push('</measure>'); measures.push(measureXml.join('')); measureNo++; pos = 0; openMeasure(); };
    openMeasure();
    let lastLevel = null;
    let first = true;
    const dirWords = (xml) => measureXml.push(`<direction placement="below"><direction-type>${xml}</direction-type></direction>`);

    for (const e of sounds) {
      if (e.kind !== 'rest') {
        if (e.hairpin) {
          if (e.hairpin.start) dirWords(`<wedge type="${e.hairpin.kind === 'cresc' ? 'crescendo' : 'diminuendo'}"/>`);
        } else {
          const lvl = e.level || (first ? e.effectiveLevel || 'mf' : null);
          if (lvl && lvl !== lastLevel) { dirWords(`<dynamics><${lvl}/></dynamics>`); lastLevel = lvl; }
        }
        first = false;
        for (const g of e.graces || []) measureXml.push(noteXml({ midi: g.midi, dur: 0, type: '16th', grace: true }));
      }
      // split the element over bar lines
      let remaining = e.dur;
      let firstChunk = true;
      const pitches = e.kind === 'note' ? [e.midi] : e.kind === 'chord' ? [...new Set([...e.pitches, ...(e.extra || [])])].sort((a, b) => a - b) : null;
      while (remaining > 0) {
        const room = barLen - pos;
        const chunk = Math.min(remaining, room);
        const pieces = splitDuration(chunk);
        for (let pi = 0; pi < pieces.length; pi++) {
          const piece = pieces[pi];
          const isLast = remaining - piece.dur === 0;
          const tieStart = !isLast && e.kind !== 'rest';
          const tieStop = !firstChunk && e.kind !== 'rest';
          if (e.kind === 'rest') measureXml.push(noteXml({ rest: true, dur: piece.dur, type: piece.type, dot: piece.dot }));
          else pitches.forEach((m, idx) => measureXml.push(noteXml({ midi: m, dur: piece.dur, type: piece.type, dot: piece.dot, chord: idx > 0, tieStart, tieStop, accent: firstChunk && e.accent && idx === 0, arpeggio: firstChunk && e.arpeggio ? (e.arpeggio === 'down' ? 'down' : 'up') : null })));
          remaining -= piece.dur; pos += piece.dur; firstChunk = false;
        }
        if (pos >= barLen) closeMeasure();
      }
      if (e.kind !== 'rest' && e.hairpin && e.hairpin.end) dirWords('<wedge type="stop"/>');
    }
    if (pos > 0) { // pad the last measure with a rest so it is complete
      for (const piece of splitDuration(barLen - pos)) measureXml.push(noteXml({ rest: true, dur: piece.dur, type: piece.type, dot: piece.dot }));
      measureXml.push('</measure>'); measures.push(measureXml.join(''));
    } else if (measures.length === 0) {
      measureXml.push(noteXml({ rest: true, dur: barLen, type: 'whole' }), '</measure>'); measures.push(measureXml.join(''));
    }
    out.push(...measures);
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n');
}
