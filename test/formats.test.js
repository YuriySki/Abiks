import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proteinToMusic, parseFasta } from '../src/protein2music.js';
import { scoreToAbc, parseAbc, abcPitch, keySignature } from '../src/abc.js';
import { scoreToMidi } from '../src/midi.js';
import { scoreToMusicXml } from '../src/musicxml.js';

const HPRP = 'QGGGTHSQWNKPSKPKTNMKHMAGAAAAGAVVGGLGGYMLGSAMSRPIIHFGSDYEDRYYRENMHRYPNQVYYRPMDEYSNQNNFVHDCVNITIKQHTVTTTTKGENFTETDVKMMERVVEQMCITQYERESQAYYQRGSS';
const pitchesOf = (e) => (e.kind === 'note' ? [e.midi] : e.kind === 'chord' ? [...new Set([...e.pitches, ...(e.extra || [])])].sort((a, b) => a - b) : []);

function assertRoundTrip(score) {
  const abc = scoreToAbc(score);
  const parsed = parseAbc(abc);
  assert.equal(parsed.parts.length, score.parts.length);
  assert.equal(parsed.tempo.bpm, score.tempo.bpm);
  score.parts.forEach((p, k) => {
    const orig = p.elements.filter((e) => e.kind !== 'nonharm');
    const back = parsed.parts[k].elements;
    assert.equal(back.length, orig.length);
    orig.forEach((a, i) => {
      const b = back[i];
      assert.equal(b.kind, a.kind, `element ${i}`);
      assert.equal(b.dur, a.dur, `duration of element ${i}`);
      assert.deepEqual(pitchesOf(b), pitchesOf(a), `pitches of element ${i}`);
      if (a.kind !== 'rest') {
        assert.equal(!!b.accent, !!a.accent, `accent ${i}`);
        assert.deepEqual((b.graces || []).map((g) => g.midi), (a.graces || []).map((g) => g.midi), `graces ${i}`);
        assert.equal(!!b.hairpin, !!a.hairpin, `hairpin ${i}`);
      }
    });
  });
}

test('ABC writer/parser round trip: hPrP, insulin (two voices), grace notes and arpeggio', () => {
  assertRoundTrip(proteinToMusic(HPRP, { localization: 'golgi' }));
  assertRoundTrip(proteinToMusic(parseFasta('>B\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT\n>A\nGIVEQCCTSICSLYQLENYCN')));
  assertRoundTrip(proteinToMusic('TTSVGPFNSVPLGMTTMKFNQGDDRRSSTTPPFNLYQAKM'));
});

test('ABC pitches and key signatures', () => {
  assert.equal(abcPitch(60), 'C'); assert.equal(abcPitch(61), '^C'); assert.equal(abcPitch(72), 'c'); assert.equal(abcPitch(84), "c'");
  assert.equal(abcPitch(48), 'C,'); assert.equal(abcPitch(21), 'A,,,,');
  assert.deepEqual(keySignature('D').F, 1); assert.deepEqual(keySignature('D').C, 1); assert.equal(keySignature('D').G, 0);
  assert.equal(keySignature('F').B, -1); assert.equal(keySignature('Am').F, 0); assert.equal(keySignature('Em').F, 1);
  assert.equal(keySignature('D mix').C, 0); assert.equal(keySignature('D mix').F, 1);
});

test('ABC parser: accidentals last for the bar, chords, rests, decorations, unit length, tuplets', () => {
  const s = parseAbc('X:1\nT:t\nM:4/4\nL:1/8\nQ:1/4=100\nK:D\n!p! F ^G G | G2 =F F | [DFA]2 z2 {A}!>!B !f! (3ccc c |');
  const e = s.parts[0].elements;
  assert.equal(s.tempo.bpm, 100);
  assert.deepEqual(e.slice(0, 3).map((x) => x.midi), [66, 68, 68]); // F# (key), G#, G# (bar accidental)
  assert.deepEqual(e.slice(3, 6).map((x) => x.midi), [67, 65, 65]);   // new bar: G natural, =F, F natural
  assert.equal(e[6].kind, 'chord'); assert.deepEqual(e[6].pitches, [62, 66, 69]); assert.equal(e[6].dur, 256);
  assert.equal(e[7].kind, 'rest'); assert.equal(e[7].dur, 256);
  assert.equal(e[8].graces.length, 1); assert.equal(e[8].accent, true); assert.equal(e[0].level, 'p'); assert.equal(e[9].level, 'f');
  assert.equal(e[9].dur + e[10].dur + e[11].dur, 256); // triplet of eighths = one quarter
  assert.equal(e[12].dur, 128);
  assert.ok(s.warnings.some((w) => /tuplet/.test(w)));
});

test('ABC parser: Q with beat unit other than a quarter, ties, multiple voices', () => {
  const s = parseAbc('X:1\nL:1/4\nQ:1/2=60\nK:C\nV:1\nC2- C2 | D4 |\nV:2\nE4 | F4 |');
  assert.equal(s.tempo.bpm, 120);
  assert.equal(s.parts.length, 2);
  assert.equal(s.parts[0].elements[0].dur, 1024); // tied halves = whole note
  assert.equal(s.parts[1].elements.length, 2);
});

test('MIDI file structure', () => {
  const bytes = scoreToMidi(proteinToMusic(HPRP, { localization: 'golgi' }));
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.equal(bytes[9], 1);            // format 1
  assert.equal(bytes[11], 2);           // two tracks (tempo + piano)
  assert.equal((bytes[12] << 8) | bytes[13], 256); // ticks per quarter
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
  const two = scoreToMidi(proteinToMusic(parseFasta('>B\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT\n>A\nGIVEQCCTSICSLYQLENYCN')));
  assert.equal(two[11], 3);
});

test('MusicXML structure', () => {
  const xml = scoreToMusicXml(proteinToMusic(parseFasta('>B\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT\n>A\nGIVEQCCTSICSLYQLENYCN'), { localization: 'secreted' }));
  assert.ok(xml.startsWith('<?xml'));
  assert.equal((xml.match(/<part id=/g) || []).length, 2);
  assert.equal((xml.match(/<measure /g) || []).length, (xml.match(/<\/measure>/g) || []).length);
  assert.equal((xml.match(/<note>/g) || []).length, (xml.match(/<\/note>/g) || []).length);
  assert.ok(xml.includes('<per-minute>184</per-minute>'));
  assert.ok(xml.includes('<wedge type="crescendo"/>'));
  assert.ok(xml.includes('<accent/>'));
  assert.ok(xml.includes('<midi-program>25</midi-program>')); // acoustic guitar
});
