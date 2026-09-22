/** Standard MIDI file (format 1) writer for a Score. No dependencies. */
import { TICKS_PER_QUARTER } from './theory.js';
import { scoreToEvents, VELOCITY } from './events.js';

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function u16(n) { return [(n >>> 8) & 255, n & 255]; }
function str(s) { return [...new TextEncoder().encode(s)]; }

function track(events) {
  const sorted = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const data = [];
  let last = 0;
  for (const e of sorted) { data.push(...vlq(e.t - last), ...e.bytes); last = e.t; }
  data.push(...vlq(0), 0xff, 0x2f, 0x00);
  return [...str('MTrk'), ...u32(data.length), ...data];
}

/**
 * @param {object} score Score from proteinToMusic
 * @returns {Uint8Array} the .mid file bytes
 */
export function scoreToMidi(score) {
  const bpm = score.tempo?.bpm || 76;
  const tracks = [];
  const meta = [];
  const title = score.title || 'Protein music';
  meta.push({ t: 0, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60000000 / bpm)).slice(1)] });
  meta.push({ t: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] });
  meta.push({ t: 0, bytes: [0xff, 0x03, ...vlq(str(title).length), ...str(title)] });
  tracks.push(track(meta));
  const { events } = scoreToEvents(score);
  score.parts.forEach((p, k) => {
    const channel = k >= 9 ? k + 1 : k; // skip the percussion channel
    const ev = [];
    const name = p.name || `Part ${k + 1}`;
    ev.push({ t: 0, bytes: [0xff, 0x03, ...vlq(str(name).length), ...str(name)] });
    ev.push({ t: 0, bytes: [0xc0 | channel, p.midiProgram ?? 0] });
    for (const e of events) {
      if (e.part !== k) continue;
      ev.push({ t: e.t, bytes: [0x90 | channel, e.midi, e.vel] });
      ev.push({ t: e.t + e.dur, bytes: [0x80 | channel, e.midi, 0] });
    }
    tracks.push(track(ev));
  });
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(TICKS_PER_QUARTER)];
  return new Uint8Array([...header, ...tracks.flat()]);
}

export { VELOCITY };
