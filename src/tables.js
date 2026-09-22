/**
 * Tables from:
 *   L.T. Nadirova, A.V. Zhigailov, "How does a protein sound like: Converting amino acid
 *   sequences into music, and back", Heliyon 12 (2026) e45432,
 *   https://doi.org/10.1016/j.heliyon.2026.e45432
 *
 * All numbers are transcribed from Tables 1-8 of the paper. Comments reference the
 * table they come from so the code can be audited against the article.
 */

/** The 20 standard proteinogenic amino acids (one-letter codes). */
export const AMINO_ACIDS = 'LAGSVETRKDIPNQFYMHCW';

/**
 * Table 1: hydrophilicity index σ (Levitt), helical penalty ΔΔG (α-index, Pace & Scholtz,
 * kJ/mol), β-sheet propensity score (β-index) and mean occurrence (%). Glycine and proline
 * have no α/β index (NA) - they break secondary structure.
 */
export const AA = {
  L: { name: 'Leucine',       occ: 9.6, sigma: -1.8, pI: 6.01,  alpha: 0.21, beta: 2.0 },
  A: { name: 'Alanine',       occ: 7.2, sigma: -0.5, pI: 6.11,  alpha: 0.00, beta: 0.0 },
  G: { name: 'Glycine',       occ: 6.6, sigma:  0.0, pI: 6.06,  alpha: null, beta: null },
  S: { name: 'Serine',        occ: 7.9, sigma:  0.3, pI: 5.68,  alpha: 0.50, beta: 0.0 },
  V: { name: 'Valine',        occ: 6.3, sigma: -1.5, pI: 6.00,  alpha: 0.61, beta: 4.0 },
  E: { name: 'Glutamic acid', occ: 6.8, sigma:  3.0, pI: 3.15,  alpha: 0.40, beta: 1.0 },
  T: { name: 'Threonine',     occ: 5.5, sigma: -0.4, pI: 5.60,  alpha: 0.66, beta: 3.0 },
  R: { name: 'Arginine',      occ: 5.3, sigma:  3.0, pI: 10.76, alpha: 0.21, beta: 1.5 },
  K: { name: 'Lysine',        occ: 6.0, sigma:  3.0, pI: 9.60,  alpha: 0.26, beta: 1.0 },
  D: { name: 'Aspartic acid', occ: 5.2, sigma:  3.0, pI: 2.85,  alpha: 0.69, beta: 1.5 },
  I: { name: 'Isoleucine',    occ: 5.1, sigma: -1.8, pI: 6.05,  alpha: 0.41, beta: 4.0 },
  P: { name: 'Proline',       occ: 5.4, sigma:  0.0, pI: 6.30,  alpha: null, beta: null },
  N: { name: 'Asparagine',    occ: 4.2, sigma:  0.2, pI: 5.41,  alpha: 0.65, beta: 0.0 },
  Q: { name: 'Glutamine',     occ: 4.3, sigma:  0.2, pI: 5.65,  alpha: 0.39, beta: 1.0 },
  F: { name: 'Phenylalanine', occ: 3.9, sigma: -2.5, pI: 5.49,  alpha: 0.54, beta: 4.0 },
  Y: { name: 'Tyrosine',      occ: 3.0, sigma: -2.3, pI: 5.64,  alpha: 0.53, beta: 3.0 },
  M: { name: 'Methionine',    occ: 2.2, sigma: -1.3, pI: 5.74,  alpha: 0.24, beta: 2.0 },
  H: { name: 'Histidine',     occ: 2.4, sigma: -0.5, pI: 7.60,  alpha: 0.61, beta: 1.5 },
  C: { name: 'Cysteine',      occ: 1.9, sigma: -1.0, pI: 5.05,  alpha: 0.68, beta: 2.0 },
  W: { name: 'Tryptophan',    occ: 1.2, sigma: -3.4, pI: 5.89,  alpha: 0.49, beta: 3.0 },
};

/** Residues that shorten (D, E, C) or lengthen (R, K, H) notes - Table 3. */
export const NEGATIVE = 'DEC';
export const POSITIVE = 'RKH';
export const CHARGED = NEGATIVE + POSITIVE;
/** "X" of Table 3: the twelve residues that do not change note duration. */
export const NEUTRAL = 'WIGSYVAQFLTN';
/** Residues that break the α/β (dynamics) calculation: proline and glycine. */
export const BREAKERS = 'GP';

export const isCharged = (a) => CHARGED.includes(a);
export const isNeutral = (a) => NEUTRAL.includes(a);

// ---------------------------------------------------------------------------------------
// Table 2: pitch-class coding. An ordered pair of amino acids (methionine and proline
// excluded) encodes one of the 12 pitch classes (0 = C ... 11 = B).
// ---------------------------------------------------------------------------------------
const CH = 'RKHCED';
const PITCH_RULES = [
  // pitch class, list of [firstSet, secondSet] cartesian products, explicit pairs
  [0,  [['WIGS', 'WIS'], [CH, 'WQ']],            'DD CE DR RR HK AA HG'],
  [1,  [['WQ', 'YVAQ'], ['WG', CH]],             ''],
  [2,  [['WIS', 'FLTN'], [CH, 'FT']],            'EE CC RD KK HH YA DG'],
  [3,  [['FT', 'FLTN'], ['FT', CH]],             ''],
  [4,  [['YVAG', 'YVQ'], [CH, 'YA'], ['WIS', 'G']], 'DE DH EK RK RC'],
  [5,  [['YVAQ', 'FLTN'], [CH, 'LN']],           'ED HD KE KR CR'],
  [6,  [['LN', 'FLTN'], ['LN', CH]],             ''],
  [7,  [['FLTN', 'WIGS'], [CH, 'IS']],           'DC EH CH RH KC GG'],
  [8,  [['IS', 'YVAQ'], ['IS', CH]],             ''],
  [9,  [['YA', 'WIGS'], ['YA', CH], ['G', 'FLTN']], 'VA ER CD HE HC HR CK RG'],
  [10, [['VQ', 'WIGS'], ['VQ', CH]],             ''],
  [11, [['FLTN', 'YVAQ'], [CH, 'V'], ['KCE', 'G']], 'EC DK KD KH RE GA'],
];

/** duplex (e.g. "QG") -> pitch class 0..11 */
export const PITCH_OF_DUPLEX = {};
/** pitch class -> array of duplexes (the degenerate code, 20-34 variants per pitch) */
export const DUPLEXES_OF_PITCH = Array.from({ length: 12 }, () => []);

for (const [pc, products, explicit] of PITCH_RULES) {
  const add = (dup) => {
    if (PITCH_OF_DUPLEX[dup] !== undefined) throw new Error(`Table 2: duplex ${dup} listed twice`);
    PITCH_OF_DUPLEX[dup] = pc;
    DUPLEXES_OF_PITCH[pc].push(dup);
  };
  for (const [a, b] of products) for (const x of a) for (const y of b) add(x + y);
  for (const dup of explicit.split(' ').filter(Boolean)) add(dup);
}

/**
 * Note to Table 2: two adjacent methionine-containing duplexes "Mx + yM" (x, y charged) encode
 * two notes of one pitch ("2DR" = two C notes, etc.).
 */
export const M_PAIR_PITCH = {};
{
  const spec = [
    [0, 'MD+RM MH+KM MK+CM MC+EM MC+CM'],
    [2, 'MR+DM MR+HM MC+KM MH+HM'],
    [4, 'ME+KM MH+RM MR+CM MR+RM'],
    [5, 'MK+EM MD+HM MC+RM MD+DM'],
    [7, 'MC+HM MH+DM MD+CM ME+EM'],
    [9, 'MH+CM ME+RM ME+HM MC+DM MK+KM'],
    [11, 'MK+DM MK+HM MH+EM ME+CM'],
  ];
  for (const [pc, s] of spec) for (const p of s.split(' ')) M_PAIR_PITCH[p.replace('+', '')] = pc;
  // Six combinations are not listed in the paper's note; fall back to the pitch of the
  // charged pair "xy" read from Table 2 (e.g. MD+KM -> DK -> B).
  for (const x of CH) for (const y of CH) {
    const key = 'M' + x + y + 'M';
    if (M_PAIR_PITCH[key] === undefined) M_PAIR_PITCH[key] = PITCH_OF_DUPLEX[x + y];
  }
}

// ---------------------------------------------------------------------------------------
// Table 3: changing the duration of notes.
// An "effect" is { exp, frac }: the stored ("integer") note value is multiplied by 2^exp;
// frac = +1 plays the note dotted (x1.5), frac = -1 plays the dotted value of the next
// shorter note (x0.75). "2.5 times" longer/shorter is exp +/-1 with the dot (x3 / x0.375),
// "1.5 times" is exp 0 with the dot - see README for the derivation from the paper's figures.
// ---------------------------------------------------------------------------------------
export const EFFECT_NONE = Object.freeze({ exp: 0, frac: 0 });

const PAIR_EFFECTS = {};
{
  const set = (list, exp, frac) => { for (const d of list.split(' ')) PAIR_EFFECTS[d] = Object.freeze({ exp, frac }); };
  set('DD EE DE ED DC CD EC', -3, 0);      // shortens 8x
  set('RR KK RK KR RH HR KH', 3, 0);       // lengthens 8x
  set('CE CC DH HD EH HE DK', -1, -1);     // 2.5x shorter
  set('HK HH RC CR KC CK RE', 1, 1);       // 2.5x longer
  set('DR RD EK KE CH HC ER KD', 0, 0);    // no change
}

/** Effect of a single charged residue paired with a neutral one (rows 2, 4, 5 of Table 3). */
export const SINGLE_EFFECTS = Object.freeze({
  D: { exp: -2, frac: 0 }, R: { exp: 2, frac: 0 },   // 4x
  E: { exp: -1, frac: 0 }, K: { exp: 1, frac: 0 },   // 2x
  C: { exp: 0, frac: -1 }, H: { exp: 0, frac: 1 },   // 1.5x
});

/** Effect of a methionine duplex with the M first ("MK + XX": applies to the next note). */
export const M_FIRST_EFFECTS = Object.freeze({
  D: { exp: -2, frac: 0 }, R: { exp: 2, frac: 0 },
  E: { exp: -1, frac: 0 }, K: { exp: 1, frac: 0 },
  C: { exp: 0, frac: -1 }, H: { exp: 0, frac: 1 },
});
/** Effect of a methionine duplex with the M second ("XX + KM": applies to the previous note). */
export const M_SECOND_EFFECTS = Object.freeze({
  D: { exp: -2, frac: 0 }, R: { exp: 2, frac: 0 },
  E: { exp: -1, frac: -1 }, K: { exp: 1, frac: 1 },  // 2.5x
  C: { exp: 0, frac: -1 }, H: { exp: 0, frac: 1 },
});

/**
 * Duration effect encoded by a duplex that produces a note (no M, no P in the pair;
 * for a proline chord duplex the proline counts as a neutral partner).
 */
export function duplexEffect(dup) {
  const [a, b] = dup;
  const ca = isCharged(a), cb = isCharged(b);
  if (ca && cb) return PAIR_EFFECTS[dup];
  if (ca) return SINGLE_EFFECTS[a];
  if (cb) return SINGLE_EFFECTS[b];
  return EFFECT_NONE;
}

/** Compose two effects (exponents add, dots combine: two dots ~ x2, dot + short-dot cancel). */
export function composeEffects(e1, e2) {
  let exp = e1.exp + e2.exp;
  let frac = e1.frac + e2.frac;
  if (frac >= 2) { exp += 1; frac = 0; }
  else if (frac <= -2) { exp -= 1; frac = 0; }
  return { exp, frac };
}

// ---------------------------------------------------------------------------------------
// Table 4: rests (methionine + a neutral residue). Durations are absolute, in whole notes.
// ---------------------------------------------------------------------------------------
export const REST_DURATION = {}; // duplex -> whole-note fraction as [num, den]
{
  const rows = [
    ['MM', 2, 1], ['MW AM SM', 1, 1], ['MF VM NM', 1, 2], ['MY LM QM', 1, 4],
    ['MI TM MQ', 1, 8], ['YM IM MT', 1, 16], ['WM MA MN', 1, 32], ['FM ML MS', 1, 64],
    ['GM MG MV', 1, 128],
  ];
  for (const [list, n, d] of rows) for (const dup of list.split(' ')) REST_DURATION[dup] = [n, d];
}
export const REST_NAMES = {
  '2/1': 'breve rest', '1/1': 'semibreve rest', '1/2': 'minim rest', '1/4': 'crotchet rest',
  '1/8': 'quaver rest', '1/16': 'semiquaver rest', '1/32': 'demisemiquaver rest',
  '1/64': 'hemidemisemiquaver rest', '1/128': 'semihemidemisemiquaver rest',
};

// ---------------------------------------------------------------------------------------
// Table 5: octave from the total hydrophilicity index of the six nearest residues (Σ6σ).
// Each row: [lower bound (inclusive), octave]. The first row has no lower bound.
// ---------------------------------------------------------------------------------------
export const OCTAVE_RULES = {
  piano: [[-Infinity, 0], [-15, 1], [-10, 2], [-6, 3], [-3, 4], [3, 5], [6, 6], [10, 7], [15, 8]],
  guitar: [[-Infinity, 2], [-8, 3], [-3, 4], [5, 5], [10, 6]],
};
/** Playable range of each instrument as MIDI numbers (A0 = 21, C8 = 108; E2 = 40, C6 = 84). */
export const INSTRUMENT_RANGE = {
  piano: { low: 21, high: 108, midiProgram: 0, name: 'Piano' },
  guitar: { low: 40, high: 84, midiProgram: 24, name: 'Acoustic guitar' },
};
export const OCTAVE_NAMES = ['sub-contra', 'contra', 'great', 'small', 'one-line', 'two-line',
  'three-line', 'four-line', 'five-line'];

export function octaveFromSigma(sum, instrument = 'piano') {
  const rules = OCTAVE_RULES[instrument] || OCTAVE_RULES.piano;
  let oct = rules[0][1];
  for (const [lo, o] of rules) if (sum >= lo) oct = o;
  return oct;
}

// ---------------------------------------------------------------------------------------
// Table 6: chords encoded by proline-containing duplexes. Intervals are semitones above
// the root. X = the pitch class of the preceding pitch-coding duplex.
// ---------------------------------------------------------------------------------------
export const CHORDS = {
  PL: { symbol: 'maj',     name: 'major triad',                 intervals: [0, 4, 7] },
  LP: { symbol: 'min',     name: 'minor triad',                 intervals: [0, 3, 7] },
  PE: { symbol: 'dim',     name: 'diminished triad',            intervals: [0, 3, 6] },
  EP: { symbol: 'aug',     name: 'augmented triad',             intervals: [0, 4, 8] },
  PA: { symbol: 'maj7',    name: 'major seventh',               intervals: [0, 4, 7, 11] },
  AP: { symbol: '7',       name: 'dominant seventh',            intervals: [0, 4, 7, 10] },
  PV: { symbol: 'min7',    name: 'minor seventh',               intervals: [0, 3, 7, 10] },
  VP: { symbol: 'minmaj7', name: 'minor-major seventh',         intervals: [0, 3, 7, 11] },
  PW: { symbol: 'm7b5',    name: 'half-diminished seventh',     intervals: [0, 3, 6, 10] },
  WP: { symbol: 'dim7',    name: 'diminished seventh',          intervals: [0, 3, 6, 9] },
  PM: { symbol: 'augM7',   name: 'augmented major seventh',     intervals: [0, 4, 8, 11] },
  MP: { symbol: 'aug7',    name: 'augmented seventh',           intervals: [0, 4, 8, 10] },
  PT: { symbol: 'maj9',    name: 'major ninth',                 intervals: [0, 4, 7, 11, 14] },
  TP: { symbol: '9',       name: 'dominant ninth',              intervals: [0, 4, 7, 10, 14] },
  PC: { symbol: 'm9',      name: 'minor ninth',                 intervals: [0, 3, 7, 10, 14] },
  CP: { symbol: 'minmaj9', name: 'minor-major ninth',           intervals: [0, 3, 7, 11, 14] },
  PS: { symbol: '6',       name: 'major sixth',                 intervals: [0, 4, 7, 9] },
  SP: { symbol: 'min6',    name: 'minor sixth',                 intervals: [0, 3, 7, 9] },
  PH: { symbol: 'maj11',   name: 'major eleventh',              intervals: [0, 4, 7, 11, 14, 17] },
  HP: { symbol: '11',      name: 'dominant eleventh',           intervals: [0, 4, 7, 10, 14, 17] },
  PR: { symbol: 'm11',     name: 'minor eleventh',              intervals: [0, 3, 7, 10, 14, 17] },
  RP: { symbol: 'minmaj11', name: 'minor-major eleventh',       intervals: [0, 3, 7, 11, 14, 17] },
  PF: { symbol: '13',      name: 'dominant thirteenth',         intervals: [0, 4, 7, 10, 14, 21] },
  FP: { symbol: 'm13',     name: 'minor thirteenth',            intervals: [0, 3, 7, 10, 14, 21] },
  PN: { symbol: 'sus2',    name: 'suspended second',            intervals: [0, 2, 7] },
  NP: { symbol: 'sus4',    name: 'suspended fourth',            intervals: [0, 5, 7] },
  PY: { symbol: '7sus2',   name: 'suspended second seventh',    intervals: [0, 2, 7, 10] },
  YP: { symbol: '7sus4',   name: 'suspended fourth seventh',    intervals: [0, 5, 7, 10] },
  PI: { symbol: '7#9',     name: 'dominant sharp ninth',        intervals: [0, 4, 7, 10, 15] },
  IP: { symbol: '7b9',     name: 'dominant seventh flat ninth', intervals: [0, 4, 7, 10, 13] },
  PK: { symbol: 'add2',    name: 'added second',                intervals: [0, 2, 4, 7] },
  KP: { symbol: 'add9',    name: 'added ninth',                 intervals: [0, 4, 7, 14] },
  PQ: { symbol: '5',       name: 'fifth (power chord)',         intervals: [0, 7] },
  QP: { symbol: '7b5',     name: 'dominant seventh flat fifth', intervals: [0, 4, 6, 10] },
  PD: { symbol: '6/9',     name: 'major sixth-ninth',           intervals: [0, 4, 7, 9, 14] },
  DP: { symbol: 'maj13',   name: 'major thirteenth',            intervals: [0, 4, 7, 11, 14, 21] },
};
/** chord symbol -> duplex (for the reverse translation) */
export const CHORD_DUPLEX_OF_SYMBOL = {};
for (const [dup, c] of Object.entries(CHORDS)) CHORD_DUPLEX_OF_SYMBOL[c.symbol] = dup;

// ---------------------------------------------------------------------------------------
// Table 7: dynamics from the average α-index and β-index of the eight nearest residues.
// ---------------------------------------------------------------------------------------
export const ALPHA_THRESHOLD = 0.4;
export const BETA_THRESHOLD = 1.5;
export const DYNAMIC_LEVELS = ['p', 'mp', 'mf', 'f'];
export const DYNAMIC_WINDOW = 8;
export const SIGMA_WINDOW = 6;
/** Segments of no more than this many residues between G/P get the baseline level (mf). */
export const SHORT_SEGMENT = 7;

/**
 * @returns {'f'|'p'|'mf'|'mpcat'} the Table 7 category. 'mpcat' (α<0.4, β≥1.5) becomes
 * mp or a crescendo/diminuendo depending on the surrounding levels.
 */
export function dynamicCategory(alphaAv, betaAv) {
  const a = alphaAv >= ALPHA_THRESHOLD, b = betaAv >= BETA_THRESHOLD;
  if (a && b) return 'f';
  if (!a && !b) return 'p';
  if (a && !b) return 'mf';
  return 'mpcat';
}

// ---------------------------------------------------------------------------------------
// Table 8: tempo from the subcellular localization of the protein. `bpm` is the value used
// by the converter (inside the paper's range; Andante 76 is the paper's default).
// ---------------------------------------------------------------------------------------
export const TEMPOS = [
  { id: 'peroxisome',   localization: 'Peroxisomes',                                   marking: 'Larghissimo',      range: '<24',    bpm: 20 },
  { id: 'plastid',      localization: 'Plastids',                                      marking: 'Grave',            range: '25-45',  bpm: 35 },
  { id: 'mitochondrion', localization: 'Mitochondria',                                 marking: 'Largo',            range: '40-60',  bpm: 50 },
  { id: 'nucleus',      localization: 'Nucleus',                                       marking: 'Lento',            range: '45-66',  bpm: 55 },
  { id: 'cytoplasm-nucleus', localization: 'Cytoplasm or nucleus',                     marking: 'Larghetto',        range: '60-66',  bpm: 63 },
  { id: 'aggresome',    localization: 'Aggresomes, inclusion bodies, stress granules', marking: 'Adagio',           range: '66-76',  bpm: 66 },
  { id: 'cytosol',      localization: 'Cytosol, ribosomes',                            marking: 'Andante',          range: '76-108', bpm: 76 },
  { id: 'cytoskeleton', localization: 'Cytoskeleton and centrosome',                   marking: 'Andante moderato', range: '92-112', bpm: 100 },
  { id: 'lysosome',     localization: 'Lysosomes',                                     marking: 'Moderato',         range: '108-120', bpm: 110 },
  { id: 'er',           localization: 'Endoplasmic reticulum',                         marking: 'Allegretto',       range: '112-120', bpm: 116 },
  { id: 'golgi',        localization: 'Golgi complex',                                 marking: 'Allegro',          range: '120-156', bpm: 130 },
  { id: 'plasmalemma',  localization: 'Plasmalemma',                                   marking: 'Vivace',           range: '156-176', bpm: 166 },
  { id: 'membrane-receptor', localization: 'Extracellular membrane proteins, receptors', marking: 'Vivacissimo',   range: '172-176', bpm: 174 },
  { id: 'secreted',     localization: 'Intercellular space (secreted proteins)',        marking: 'Presto',           range: '168-200', bpm: 184 },
  { id: 'matrix',       localization: 'Extracellular matrix proteins',                 marking: 'Prestissimo',      range: '>200',   bpm: 208 },
];
export const DEFAULT_TEMPO = TEMPOS.find((t) => t.id === 'cytosol');

export function tempoFor(localization) {
  if (!localization) return DEFAULT_TEMPO;
  const key = String(localization).toLowerCase();
  return TEMPOS.find((t) => t.id === key || t.marking.toLowerCase() === key
    || t.localization.toLowerCase().includes(key)) || null;
}
