/**
 * Small music-theory helpers shared by the converter modules.
 *
 * Durations are integers in ticks: 1024 ticks = one whole note (semibreve). The paper's range
 * is 1/128 (8 ticks) to a longa (4 whole notes = 4096 ticks); dotted values are allowed.
 */

export const TICKS_PER_WHOLE = 1024;
export const TICKS_PER_QUARTER = TICKS_PER_WHOLE / 4;
export const MIN_DUR = TICKS_PER_WHOLE / 128; // 1/128 note
export const MAX_DUR = TICKS_PER_WHOLE * 4;   // longa
export const BASE_DUR = TICKS_PER_WHOLE / 8;  // the initial note value is a quaver (1/8)

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PITCH_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const LEVELS = ['p', 'mp', 'mf', 'f'];

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** MIDI note number of a pitch class in an octave (scientific pitch notation, C4 = 60). */
export const midiOf = (pc, octave) => 12 * (octave + 1) + pc;
export const pcOf = (midi) => ((midi % 12) + 12) % 12;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const noteName = (midi) => PITCH_NAMES[pcOf(midi)] + octaveOf(midi);

/** Duration in ticks -> reduced fraction of a whole note, e.g. 192 -> [3, 16]. */
export function ticksToFraction(ticks) {
  const g = gcd(ticks, TICKS_PER_WHOLE);
  return [ticks / g, TICKS_PER_WHOLE / g];
}
export function fractionToTicks(num, den) {
  return Math.round((num * TICKS_PER_WHOLE) / den);
}
/** "3/16", "1/8", "2" ... */
export function ticksToString(ticks) {
  const [n, d] = ticksToFraction(ticks);
  return d === 1 ? String(n) : `${n}/${d}`;
}

/** Is the duration a plain (2^k) or dotted (3*2^k) note value inside the paper's range? */
export function isRepresentable(ticks) {
  if (ticks < MIN_DUR || ticks > MAX_DUR) return false;
  const p = ticks & (ticks - 1) ? null : ticks; // power of two?
  if (p) return true;
  return ticks % 3 === 0 && ((ticks / 3) & (ticks / 3 - 1)) === 0;
}
/** Nearest representable duration (on a log scale); 0 stays 0. */
export function quantizeDuration(ticks) {
  if (ticks <= 0) return 0;
  let best = MIN_DUR, bestErr = Infinity;
  for (let v = MIN_DUR; v <= MAX_DUR; v *= 2) {
    for (const cand of [v, (v * 3) / 2]) {
      if (cand > MAX_DUR) continue;
      const err = Math.abs(Math.log(cand / ticks));
      if (err < bestErr) { bestErr = err; best = cand; }
    }
  }
  return best;
}

/**
 * Apply a Table 3 effect to the stored note value.
 * @param {number} stored current "integer" note value in ticks
 * @param {{exp:number, frac:number}} effect
 * @returns {{stored:number, played:number}} new stored value and the value actually played
 */
export function applyEffect(stored, effect) {
  let s = stored;
  if (effect.exp > 0) s = Math.min(MAX_DUR, s * 2 ** effect.exp);
  else if (effect.exp < 0) s = Math.max(MIN_DUR, s / 2 ** -effect.exp);
  let played = s;
  if (effect.frac > 0) played = Math.min(MAX_DUR, (s * 3) / 2);
  else if (effect.frac < 0) played = Math.max(MIN_DUR, (s * 3) / 4);
  return { stored: s, played };
}

/** Human-readable name of a duration ("dotted quaver", "longa"...). */
export function durationName(ticks) {
  const names = { 4096: 'longa', 2048: 'breve', 1024: 'semibreve', 512: 'minim', 256: 'crotchet',
    128: 'quaver', 64: 'semiquaver', 32: 'demisemiquaver', 16: 'hemidemisemiquaver',
    8: 'semihemidemisemiquaver' };
  if (names[ticks]) return names[ticks];
  if (ticks % 3 === 0 && names[(ticks * 2) / 3]) return 'dotted ' + names[(ticks * 2) / 3];
  return ticksToString(ticks) + ' whole';
}

/**
 * Build the MIDI numbers of a chord from a root MIDI number and semitone intervals, keeping
 * the chord inside [low, high] by moving it down an octave at a time if needed.
 */
export function chordMidis(rootMidi, intervals, low = 0, high = 127) {
  let notes = intervals.map((i) => rootMidi + i);
  while (notes[notes.length - 1] > high && notes[0] - 12 >= low) notes = notes.map((n) => n - 12);
  while (notes[0] < low) notes = notes.map((n) => n + 12);
  return notes;
}

/**
 * Move a pitch into the instrument's range by whole octaves (Table 5 footnote: "a pitch from
 * the lowest or highest octave of the instrument is played").
 */
export function fitToRange(midi, low, high) {
  while (midi < low) midi += 12;
  while (midi > high) midi -= 12;
  return midi;
}

export const levelIndex = (lvl) => LEVELS.indexOf(lvl);
