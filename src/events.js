/**
 * Turn a Score into a flat list of timed sound events (used by the MIDI writer and by the
 * browser synthesizer): { t, dur, midi, vel, part } with t/dur in ticks (1024 = whole note).
 */
import { LEVELS } from './theory.js';

export const VELOCITY = { p: 48, mp: 62, mf: 78, f: 98 };
export const ACCENT_BOOST = 18;
export const GRACE_TICKS = 32;   // each grace note takes 1/32 of a whole note from the main note
export const ARP_STAGGER = 24;   // ticks between the notes of an arpeggiated chord

/** Velocity of every sound, interpolating over crescendo/diminuendo regions. */
export function velocities(elements) {
  const sounds = elements.filter((e) => e.kind === 'note' || e.kind === 'chord');
  const vel = new Map();
  let k = 0;
  while (k < sounds.length) {
    const e = sounds[k];
    if (!e.hairpin) { vel.set(e, VELOCITY[e.effectiveLevel || e.level || 'mf']); k++; continue; }
    let end = k;
    while (end + 1 < sounds.length && sounds[end + 1].hairpin) end++;
    const from = VELOCITY[e.hairpin.from || 'mf'], to = VELOCITY[e.hairpin.to || 'mf'];
    const n = end - k + 1;
    for (let m = k; m <= end; m++) vel.set(sounds[m], Math.round(from + ((to - from) * (m - k + 1)) / (n + 1)));
    k = end + 1;
  }
  return vel;
}

/**
 * @returns {{events: object[], totalTicks: number}}
 */
export function scoreToEvents(score) {
  const events = [];
  let totalTicks = 0;
  score.parts.forEach((p, partIndex) => {
    const vel = velocities(p.elements);
    let t = 0;
    for (const e of p.elements) {
      if (e.kind === 'nonharm') continue;
      if (e.kind === 'rest') { t += e.dur; continue; }
      const v = Math.min(127, (vel.get(e) || 78) + (e.accent ? ACCENT_BOOST : 0));
      let start = t;
      const end = t + e.dur;
      const graces = e.graces || [];
      if (graces.length) {
        const total = Math.min(graces.length * GRACE_TICKS, Math.floor(e.dur / 2));
        const each = Math.max(1, Math.floor(total / graces.length));
        for (const g of graces) { events.push({ t: start, dur: each, midi: g.midi, vel: Math.max(1, v - 20), part: partIndex, grace: true }); start += each; }
      }
      if (e.kind === 'note') events.push({ t: start, dur: end - start, midi: e.midi, vel: v, part: partIndex });
      else {
        let pitches = [...new Set([...e.pitches, ...(e.extra || [])])].sort((a, b) => a - b);
        if (e.arpeggio === 'down') pitches = pitches.reverse();
        pitches.forEach((m, idx) => {
          const on = e.arpeggio ? Math.min(start + idx * ARP_STAGGER, end - 1) : start;
          events.push({ t: on, dur: end - on, midi: m, vel: v, part: partIndex });
        });
      }
      t = end;
    }
    totalTicks = Math.max(totalTicks, t);
  });
  events.sort((a, b) => a.t - b.t || a.part - b.part);
  return { events, totalTicks };
}

export { LEVELS };
