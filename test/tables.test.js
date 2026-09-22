import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/tables.js';

test('Table 2: the doublet code covers all 324 ordered pairs exactly once', () => {
  const letters = T.AMINO_ACIDS.replace('M', '').replace('P', '');
  assert.equal(letters.length, 18);
  let count = 0;
  for (const a of letters) for (const b of letters) { assert.notEqual(T.PITCH_OF_DUPLEX[a + b], undefined, a + b); count++; }
  assert.equal(count, 324);
  assert.equal(Object.keys(T.PITCH_OF_DUPLEX).length, 324);
  assert.deepEqual(T.DUPLEXES_OF_PITCH.map((d) => d.length), [31, 20, 31, 20, 32, 33, 20, 34, 20, 32, 20, 31]);
});

test('Table 2: spot checks from the paper', () => {
  const pc = T.PITCH_OF_DUPLEX;
  assert.equal(pc.QG, 10); assert.equal(pc.GG, 7); assert.equal(pc.TH, 3); assert.equal(pc.SQ, 8);
  assert.equal(pc.WN, 2); assert.equal(pc.SK, 8); assert.equal(pc.TN, 3); assert.equal(pc.DR, 0);
  assert.equal(pc.KD, 11); assert.equal(pc.VA, 9); assert.equal(pc.AA, 0); assert.equal(pc.GA, 11);
  assert.equal(pc.YA, 2); assert.equal(pc.RG, 9); assert.equal(pc.HG, 0); assert.equal(pc.DG, 2);
  assert.equal(pc.KL, 5); assert.equal(pc.LK, 6); assert.equal(pc.FV, 11); assert.equal(pc.GF, 9);
});

test('Note to Table 2: methionine pairs', () => {
  assert.equal(Object.keys(T.M_PAIR_PITCH).length, 36);
  assert.equal(T.M_PAIR_PITCH.MKHM, 11); // 2KD -> two B notes
  assert.equal(T.M_PAIR_PITCH.MDRM, 0);
  assert.equal(T.M_PAIR_PITCH.MDKM, T.PITCH_OF_DUPLEX.DK); // unlisted pair falls back to "DK"
});

test('Table 3: duration effects', () => {
  assert.deepEqual(T.duplexEffect('KH'), { exp: 3, frac: 0 });
  assert.deepEqual(T.duplexEffect('DD'), { exp: -3, frac: 0 });
  assert.deepEqual(T.duplexEffect('DK'), { exp: -1, frac: -1 });
  assert.deepEqual(T.duplexEffect('RE'), { exp: 1, frac: 1 });
  assert.deepEqual(T.duplexEffect('ER'), { exp: 0, frac: 0 });
  assert.deepEqual(T.duplexEffect('TH'), { exp: 0, frac: 1 });
  assert.deepEqual(T.duplexEffect('CG'), { exp: 0, frac: -1 });
  assert.deepEqual(T.duplexEffect('SD'), { exp: -2, frac: 0 });
  assert.deepEqual(T.duplexEffect('QK'), { exp: 1, frac: 0 });
  assert.deepEqual(T.duplexEffect('WN'), { exp: 0, frac: 0 });
  assert.deepEqual(T.composeEffects({ exp: 1, frac: 0 }, { exp: 1, frac: 1 }), { exp: 2, frac: 1 });
  assert.deepEqual(T.composeEffects({ exp: 0, frac: 1 }, { exp: 0, frac: 1 }), { exp: 1, frac: 0 });
});

test('Table 4: rests', () => {
  assert.equal(Object.keys(T.REST_DURATION).length, 25);
  assert.deepEqual(T.REST_DURATION.MM, [2, 1]);
  assert.deepEqual(T.REST_DURATION.ML, [1, 64]);
  assert.deepEqual(T.REST_DURATION.AM, [1, 1]);
  assert.deepEqual(T.REST_DURATION.NM, [1, 2]);
  assert.deepEqual(T.REST_DURATION.MY, [1, 4]);
});

test('Table 5: octave thresholds', () => {
  assert.equal(T.octaveFromSigma(-16), 0); assert.equal(T.octaveFromSigma(-15), 1); assert.equal(T.octaveFromSigma(-10), 2);
  assert.equal(T.octaveFromSigma(-6), 3); assert.equal(T.octaveFromSigma(-3), 4); assert.equal(T.octaveFromSigma(2.9), 4);
  assert.equal(T.octaveFromSigma(3), 5); assert.equal(T.octaveFromSigma(6), 6); assert.equal(T.octaveFromSigma(10), 7); assert.equal(T.octaveFromSigma(15), 8);
  assert.equal(T.octaveFromSigma(-9, 'guitar'), 2); assert.equal(T.octaveFromSigma(-8, 'guitar'), 3); assert.equal(T.octaveFromSigma(-3, 'guitar'), 4);
  assert.equal(T.octaveFromSigma(5, 'guitar'), 5); assert.equal(T.octaveFromSigma(10, 'guitar'), 6);
});

test('Table 6: 36 chords, symbol lookup', () => {
  assert.equal(Object.keys(T.CHORDS).length, 36);
  assert.equal(T.CHORDS.KP.symbol, 'add9'); assert.equal(T.CHORDS.PK.symbol, 'add2');
  assert.equal(T.CHORDS.NP.symbol, 'sus4'); assert.equal(T.CHORDS.PI.symbol, '7#9');
  assert.equal(T.CHORD_DUPLEX_OF_SYMBOL.maj, 'PL'); assert.equal(T.CHORD_DUPLEX_OF_SYMBOL.min, 'LP');
});

test('Table 7: dynamic categories', () => {
  assert.equal(T.dynamicCategory(0.5, 1.8), 'f');
  assert.equal(T.dynamicCategory(0.365, 1.313), 'p');
  assert.equal(T.dynamicCategory(0.5, 1.0), 'mf');
  assert.equal(T.dynamicCategory(0.3, 1.8), 'mpcat');
});

test('Table 8: tempo lookup', () => {
  assert.equal(T.tempoFor('golgi').marking, 'Allegro');
  assert.equal(T.tempoFor('Golgi complex').bpm, 130);
  assert.equal(T.tempoFor('allegro').id, 'golgi');
  assert.equal(T.tempoFor(undefined).marking, 'Andante');
  assert.equal(T.tempoFor('nowhere'), null);
  assert.equal(T.TEMPOS.length, 15);
});
