import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proteinToMusic, convertChain } from '../src/protein2music.js';
import { scoreToAbc, parseAbc } from '../src/abc.js';
import { musicToProtein, identifyChord, compareElements, buildTargets } from '../src/music2protein.js';
import * as T from '../src/tables.js';

const HPRP = 'QGGGTHSQWNKPSKPKTNMKHMAGAAAAGAVVGGLGGYMLGSAMSRPIIHFGSDYEDRYYRENMHRYPNQVYYRPMDEYSNQNNFVHDCVNITIKQHTVTTTTKGENFTETDVKMMERVVEQMCITQYERESQAYYQRGSS';

test('identifyChord recognises every Table 6 chord type from its pitches', () => {
  for (const [dup, chord] of Object.entries(T.CHORDS)) {
    const pitches = chord.intervals.map((i) => 60 + i);
    const id = identifyChord(pitches);
    assert.equal(id.dup, dup, `${chord.symbol}: got ${id.symbol}`);
    assert.equal(id.rootPc, 0); assert.equal(id.exact, true);
  }
  assert.equal(identifyChord([62, 66, 69, 76]).symbol, 'add9');
  assert.equal(identifyChord([62, 64, 66, 69]).symbol, 'add2');
});

test('a simple melody with dynamics, rests, a chord and grace notes is reproduced exactly', () => {
  const abc = 'X:1\nT:test\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\n!mf! C D E F | G2 z A | !f! [C E G]4 | {c}B A G !p! F E D C2 |]';
  const score = parseAbc(abc);
  const res = musicToProtein(score, { beamWidth: 48 });
  const c = res.chains[0];
  assert.equal(c.fidelity.attributes.kind, 0);
  assert.equal(c.fidelity.attributes.pitch, 0);
  assert.equal(c.fidelity.attributes.duration, 0);
  assert.equal(c.fidelity.attributes.graces, 0);
  assert.equal(c.fidelity.attributes.octave, 0);
  assert.ok(c.fidelity.exact >= c.fidelity.total - 2, `exact ${c.fidelity.exact}/${c.fidelity.total}`);
  assert.equal(c.sequence.length % 2, 0);
  // re-encoding the protein gives the same pitches and durations
  const back = convertChain(c.sequence);
  const cmp = compareElements(score.parts[0].elements, back.elements);
  assert.equal(cmp.attributes.pitch + cmp.attributes.duration + cmp.attributes.kind, 0);
});

test('hPrP: protein -> music -> protein keeps pitch classes and durations, most octaves and dynamics', () => {
  const score = proteinToMusic(HPRP, { localization: 'golgi' });
  const parsed = parseAbc(scoreToAbc(score));
  const res = musicToProtein(parsed, { beamWidth: 64 });
  const c = res.chains[0];
  assert.equal(c.fidelity.attributes.kind, 0);
  assert.equal(c.fidelity.attributes.pitch, 0);
  assert.equal(c.fidelity.attributes.duration, 0);
  assert.equal(c.fidelity.attributes.accent, 0);
  assert.ok(c.fidelity.exact / c.fidelity.total >= 0.85, `only ${c.fidelity.exact}/${c.fidelity.total} exact`);
  assert.ok(c.sequence !== HPRP); // the code is degenerate: a different protein, same music
});

test('the bundled Mozart excerpt decodes into a protein whose music has the same notes', () => {
  const abc = readFileSync(new URL('../examples/rondo-alla-turca.abc', import.meta.url), 'utf8');
  const score = parseAbc(abc);
  const res = musicToProtein(score, { beamWidth: 48 });
  const c = res.chains[0];
  assert.equal(c.fidelity.attributes.kind, 0);
  assert.equal(c.fidelity.attributes.pitch, 0);
  assert.equal(c.fidelity.attributes.duration, 0);
  assert.ok(c.fidelity.exact / c.fidelity.total >= 0.75, `only ${c.fidelity.exact}/${c.fidelity.total} exact`);
  const { units } = buildTargets(score.parts[0].elements);
  assert.ok(units.some((u) => u.kind === 'nh'));
});

test('a rest of 3/8 is split into two rests; an unknown chord is approximated', () => {
  const score = parseAbc('X:1\nL:1/8\nK:C\nC z3 [C ^D F ^G]2 C |');
  const { units, notes } = buildTargets(score.parts[0].elements);
  assert.equal(units.filter((u) => u.kind === 'rest').length, 2);
  assert.ok(notes.some((n) => /split/.test(n)));
  const res = musicToProtein(score);
  assert.equal(res.chains[0].fidelity.attributes.kind, 0);
});

test('seed produces different (still valid) variants', () => {
  const score = parseAbc('X:1\nL:1/8\nK:C\nC D E F G A B c |');
  const a = musicToProtein(score, { seed: 1 }).chains[0];
  const b = musicToProtein(score, { seed: 2 }).chains[0];
  assert.notEqual(a.sequence, b.sequence);
  assert.equal(a.fidelity.attributes.pitch + b.fidelity.attributes.pitch, 0);
});
