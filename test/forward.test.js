import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proteinToMusic, convertChain, parseFasta, cleanSequence, describeElement } from '../src/protein2music.js';

const HPRP = 'QGGGTHSQWNKPSKPKTNMKHMAGAAAAGAVVGGLGGYMLGSAMSRPIIHFGSDYEDRYYRENMHRYPNQVYYRPMDEYSNQNNFVHDCVNITIKQHTVTTTTKGENFTETDVKMMERVVEQMCITQYERESQAYYQRGSS';
const HPRP_MUT = HPRP.replace('KPSKPK', 'KLSKLK');
const elementsOf = (seq, opts) => proteinToMusic(seq, opts).parts[0].elements.filter((e) => e.kind !== 'nonharm');
const desc = (els) => els.map(describeElement);

test('Fig. 4a: hPrP91-230-nat, distinctive region 91-112', () => {
  const els = elementsOf(HPRP, { localization: 'golgi' });
  assert.deepEqual(desc(els.slice(0, 9)), ['4;A#;1/8', '4;G;1/8', '4;D#;3/16', '3;G#;1/8', '4;Dadd9;1/4', '6;G#add2;1', '5;D#;1', '4;B;2', '4;B;3']);
  assert.deepEqual(els.slice(0, 9).map((e) => e.sigma6), [-0.7, -0.7, -0.4, -3.6, 0.3, 9.3, 4.5, -0.3, -0.6]);
  assert.equal(els[0].accent, true); assert.equal(els[1].accent, true); assert.equal(els[2].accent, false);
  // TN, MK, HM: alpha_av 0.365, beta_av 1.313 -> piano
  for (const e of els.slice(6, 9)) {
    assert.ok(Math.abs(e.dyn.alphaAv - 0.365) < 1e-9); assert.ok(Math.abs(e.dyn.betaAv - 1.3125) < 1e-9); assert.equal(e.level, 'p');
  }
  assert.equal(els[2].level, 'mf'); // short segment (7 residues) -> mf
  assert.deepEqual(els[4].pitches, [62, 66, 69, 76]); // D add9 = D F# A E
});

test('Fig. 4a: hPrP91-230-mut (P102L, P105L) has single notes instead of chords', () => {
  const els = elementsOf(HPRP_MUT, { localization: 'aggresome' });
  assert.deepEqual(desc(els.slice(0, 11)), ['4;A#;1/8', '4;G;1/8', '4;D#;3/16', '3;G#;1/8', '4;D;1/8', '4;F;1/4', '5;G#;1/2', '5;F#;1', '4;D#;1', '4;B;2', '4;B;3']);
  assert.ok(Math.abs(els[5].dyn.alphaAv - 0.371) < 0.001); // K L: alpha_av 0.371 (Fig. 4a)
  assert.ok(Math.abs(els[5].dyn.betaAv - 1.25) < 1e-9);
});

test('hPrP: rests, chords, duration rules further along the chain (matches the paper ABC excerpt)', () => {
  const els = elementsOf(HPRP, { localization: 'golgi' });
  const byAa = (aa) => els.find((e) => e.src.aa === aa);
  assert.equal(describeElement(byAa('ML')), 'rest 1/64');
  assert.equal(describeElement(byAa('AM')), 'rest 1');
  assert.equal(describeElement(byAa('NM')), 'rest 1/2');
  assert.equal(describeElement(byAa('MM')), 'rest 2');
  assert.equal(byAa('SR').symbol, '7#9'); assert.equal(byAa('SR').dur, 4096);
  assert.equal(describeElement(byAa('IH')), '2;G#;4');     // x1.5 clamped at the longa
  assert.equal(describeElement(byAa('SD')), '4;G#;1');     // XD: 4 times shorter
  assert.equal(byAa('SD').level, 'f');
  assert.equal(describeElement(byAa('RE')), '4;B;3/2');    // RE: 2.5 times longer -> dotted
  assert.equal(byAa('HR').symbol, '7sus4'); assert.equal(byAa('HR').dur, 4096); // HR: 8 times longer
  assert.equal(describeElement(byAa('DE')), '4;E;1/2');    // DE: 8 times shorter
  assert.equal(describeElement(byAa('HD')), '3;F;3/16');   // HD: 2.5 times shorter
  assert.equal(describeElement(byAa('CV')), '4;B;3/16');   // CX: 1.5 times shorter (dotted value of the next shorter note)
  assert.equal(describeElement(byAa('TD')), '6;D#;1/16');  // XD: 4 times shorter
  assert.equal(describeElement(byAa('ER')), '4;A;1/8');    // ER: no change
  assert.equal(byAa('GE').accent, true);
});

test('GG rules: played as G after a glycine duplex or a rest, or before proline; otherwise an accent', () => {
  // QG GG -> GG is played (previous duplex contains G)
  let els = elementsOf('QGGGTHSQ');
  assert.equal(els[1].name, 'G'); assert.equal(els[1].src.fromGG, true);
  // TH GG SQ -> GG not played, accent on the TH note
  els = elementsOf('THGGSQ');
  assert.equal(els.length, 2); assert.equal(els[0].accent, true); assert.equal(els[0].ggAccent, true);
  // MW GG -> after a rest: played
  els = elementsOf('MWGGSQ');
  assert.equal(els[1].name, 'G');
  // TH GG PL -> before proline: played, and becomes the root of the chord
  els = elementsOf('THGGPL');
  assert.equal(els[1].kind, 'chord'); assert.equal(els[1].root.name, 'G'); assert.equal(els[1].symbol, 'maj');
});

test('Table 3: durations are clamped between 1/128 and a longa; fractional changes are not stored', () => {
  const els = elementsOf('SVDDEEDDEETT'); // 1/8 -> 1/64 -> 1/128 (clamped) ...
  assert.equal(els[1].dur, 16); assert.equal(els[2].dur, 8); assert.equal(els[4].dur, 8); assert.equal(els[5].dur, 8);
  const els2 = elementsOf('SVRRKKRKTTGCQK'); // 1/8 -> 1 -> 4 -> 4, then GC (x0.75) -> 3, QK -> x2 clamps at 4
  assert.equal(els2[3].dur, 4096); assert.equal(els2[4].dur, 4096); assert.equal(els2[5].dur, 3072); assert.equal(els2[6].dur, 4096);
  const els3 = elementsOf('SVTHSQ'); // TH dotted, SQ back to the stored 1/8
  assert.equal(els3[1].dur, 192); assert.equal(els3[2].dur, 128);
});

test('Methionine duration modifiers (Table 3) and methionine pairs (note to Table 2)', () => {
  let els = elementsOf('MKFNVA'); // MK + XX: the next note is 2 times longer
  assert.equal(els[0].dur, 256); assert.equal(els[0].name, 'D#'); assert.equal(els.length, 2);
  els = elementsOf('FNKMVA');    // XX + KM: the previous note 2.5 times longer (stored x2, played dotted)
  assert.equal(els[0].dur, 384); assert.equal(els[1].dur, 256);
  els = elementsOf('TNMKHMAG');  // MK + HM = 2KD: two B notes
  assert.deepEqual(desc(els.slice(0, 3)), ['4;D#;1/8', '4;B;1/4', '4;B;3/8']);
});

test('Chords: root from the preceding note, from the following note after a rest, or C', () => {
  let els = elementsOf('SVPLTT');
  assert.equal(els[0].kind, 'chord'); assert.equal(els[0].root.name, 'G#'); assert.equal(els[0].symbol, 'maj');
  els = elementsOf('MWPLTTSV');            // after a rest: the following note is the root
  assert.equal(els[1].kind, 'chord'); assert.equal(els[1].root.name, 'D#'); assert.equal(els.length, 3);
  els = elementsOf('PLMW');                // no pitch-coding duplex at all: C chord
  assert.equal(els[0].kind, 'chord'); assert.equal(els[0].root.name, 'C');
  els = elementsOf('SVPLPETT');            // consecutive proline duplexes: same root, new chord types
  assert.equal(els[1].kind, 'chord'); assert.equal(els[1].symbol, 'dim'); assert.equal(els[1].root.name, 'G#');
  els = elementsOf('SVPLGMTT');            // GM next to a chord: arpeggio, no rest
  assert.equal(els[0].arpeggio, 'up'); assert.equal(els.length, 2);
});

test('Non-harmonic tones: PG / GP / PP and chords', () => {
  let els = elementsOf('TTPGSV');          // TT becomes a grace note of SV
  assert.equal(els.length, 1); assert.equal(els[0].graces.length, 1); assert.equal(els[0].graces[0].name, 'D#');
  els = elementsOf('TTSVGPFN');            // two grace notes
  assert.equal(els.length, 1); assert.equal(els[0].graces.map((g) => g.name).join(), 'D#,G#');
  els = elementsOf('TTSVPPFNLYQA');        // PP: 2 before + 2 after in one sound
  assert.equal(els.length, 2); assert.equal(els[0].graces.length, 2); assert.equal(els[1].graces.length, 1);
  els = elementsOf('SVPLPGTT');            // non-chord tone added to the chord
  assert.equal(els.length, 1); assert.equal(els[0].kind, 'chord'); assert.equal(els[0].extra.length, 1);
  els = elementsOf('SVPLPGTTPE');          // between two chords: the previous chord sounds twice
  assert.equal(els.filter((e) => e.kind === 'chord').length, 3);
});

test('Fig. 5: insulin B-chain (piano) durations and dynamics', () => {
  const score = proteinToMusic(parseFasta('>B\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT\n>A\nGIVEQCCTSICSLYQLENYCN'), { localization: 'secreted' });
  assert.equal(score.texture, 'biphony');
  assert.equal(score.parts[1].instrument, 'guitar');
  const b = score.parts[0].elements;
  assert.deepEqual(desc(b.slice(0, 6)), ['3;B;1/8', '3;B;1/8', '4;F;3/16', '3;B;3/32', '3;G#;3/16', '4;B;1/8']);
  assert.deepEqual(b.slice(0, 4).map((e) => e.sigma6), [-5.9, -5.9, -2.9, -3.5]);
  assert.equal(describeElement(b[6]), '3;E;1/16');
  assert.equal(describeElement(b[9]), '4;B;3/64');
  assert.equal(b[11].kind === 'note' && b[11].name, 'A');
  // SH, LV, EA: alpha < 0.4 and beta >= 1.5 between mf and f -> crescendo
  assert.equal(b[4].hairpin.kind, 'cresc'); assert.equal(b[5].hairpin.kind, 'cresc'); assert.equal(b[6].hairpin.kind, 'cresc');
  assert.equal(b[7].level, 'f');
  assert.ok(Math.abs(b[4].dyn.alphaAv - 0.38375) < 1e-6);
  assert.ok(Math.abs(b[9].dyn.alphaAv - 0.40625) < 1e-6); // CG uses the segment of C
  const a = score.parts[1].elements; // guitar
  assert.deepEqual(desc(a.slice(0, 4)), ['4;C;1/8', '4;A#;1/16', '4;A#;3/64', '3;D;3/64']);
  assert.equal(describeElement(a[a.length - 1]), '4;F;3/128'); // odd chain: final duplex CN
  assert.equal(a[a.length - 1].src.aa, 'CN');
});

test('Fig. 1a: Rab5 fragment pitch classes and rest', () => {
  const els = elementsOf('GQERYHSLAPMYYRGAQAAIVVYDITNTDT', { localization: 'lysosome' });
  const names = els.map((e) => (e.kind === 'rest' ? 'z' : e.kind === 'chord' ? e.root.name + e.symbol : e.name));
  assert.deepEqual(names, ['E', 'A', 'A', 'D7', 'z', 'A', 'B', 'C#', 'A', 'E', 'A', 'D', 'F#', 'D']);
  assert.equal(els[4].dur, 256);
  assert.equal(proteinToMusic('GQERYHSLAP', { localization: 'lysosome' }).tempo.marking, 'Moderato');
});

test('Input handling', () => {
  assert.equal(cleanSequence('mkf nva\n12 np*'), 'MKFNVANP');
  assert.throws(() => cleanSequence('MKXB'), /Unknown amino acid/);
  assert.equal(cleanSequence('MKXB', { ignoreUnknown: true }), 'MK');
  assert.equal(parseFasta('>a\nMK\n>b\nFN').length, 2);
  const s = proteinToMusic('SV', { bpm: 99, title: 'x' });
  assert.equal(s.tempo.bpm, 99); assert.equal(s.parts[0].elements[0].octave, 4); // fewer than six residues: one-line octave
  assert.equal(convertChain('SVFN').elements.length, 2);
});
