/**
 * Music -> protein: reverse translation through the degenerate duplex code.
 *
 * Every note can be encoded by 20-34 amino-acid pairs, every rest by three methionine pairs,
 * every chord by its root pair plus a proline pair. The pair has to be chosen so that the
 * note length (charge, Table 3), the octave (hydrophilicity of the six neighbours, Table 5)
 * and the dynamics (α/β propensity of the eight neighbours, Table 7) come out right, which
 * couples each choice to its neighbours. A beam search over candidate "chunks" scores the
 * octave and dynamics windows as soon as they are determined, and the best sequences are
 * verified by running the forward algorithm and comparing with the target.
 */
import * as T from './tables.js';
import { applyEffect, BASE_DUR, pcOf, octaveOf, midiOf, ticksToString, LEVELS } from './theory.js';
import { convertChain, proteinToMusic, describeElement } from './protein2music.js';
import { normalizeDurations } from './abc.js';

const LEVEL_IDX = { p: 0, mp: 1, mf: 2, f: 3, mpcat: 1 };
const PRE_MODS = ['', 'MD', 'MR', 'ME', 'MK', 'MC', 'MH'];
const POST_MODS = ['', 'DM', 'RM', 'EM', 'KM', 'CM', 'HM'];
const REST_VALUES = [2048, 1024, 512, 256, 128, 64, 32, 16, 8];
const REST_OPTIONS = {};
for (const [dup, [n, d]] of Object.entries(T.REST_DURATION)) {
  if (dup === 'GM' || dup === 'MG') continue; // would become an arpeggio next to a chord
  const ticks = Math.round((1024 * n) / d);
  (REST_OPTIONS[ticks] = REST_OPTIONS[ticks] || []).push(dup);
}

/** Amino-acid prior: log of the natural occurrence, used as a small tie-breaker. */
const PRIOR = {};
for (const aa of T.AMINO_ACIDS) PRIOR[aa] = -Math.log(T.AA[aa].occ / 10);
const chunkPrior = (s) => { let p = 0; for (const c of s) p += PRIOR[c]; return p; };

// ---------------------------------------------------------------------------------------
// Target units
// ---------------------------------------------------------------------------------------

/** Find the chord type/root of Table 6 that best matches a set of MIDI pitches. */
export function identifyChord(pitches) {
  const sorted = [...new Set(pitches)].sort((a, b) => a - b);
  const pcs = new Set(sorted.map(pcOf));
  const lowestPc = pcOf(sorted[0]);
  let best = null;
  for (const r of pcs) {
    const rootMidi = sorted.find((m) => pcOf(m) === r);
    for (const [dup, chord] of Object.entries(T.CHORDS)) {
      const cpcs = new Set(chord.intervals.map((i) => (r + i) % 12));
      let missing = 0, extra = 0, misplaced = 0;
      for (const x of cpcs) if (!pcs.has(x)) missing++;
      for (const m of sorted) {
        const iv = m - rootMidi;
        if (!cpcs.has(pcOf(m))) extra++;
        else if (!chord.intervals.includes(iv) && !chord.intervals.includes(((iv % 12) + 12) % 12)) misplaced++;
        else if (!chord.intervals.includes(iv)) misplaced += 0.5; // same pitch class, different octave
      }
      const cost = missing + extra + 0.3 * misplaced + (r === lowestPc ? 0 : 0.5) + chord.intervals.length * 0.01;
      if (!best || cost < best.cost) best = { cost, rootPc: r, dup, symbol: chord.symbol, missing, extra };
    }
  }
  const rootNote = sorted.find((m) => pcOf(m) === best.rootPc) ?? sorted[0];
  return { ...best, rootOctave: octaveOf(rootNote), exact: best.missing === 0 && best.extra === 0 };
}

/** Greedy decomposition of a rest into Table 4 values (largest first). */
function restPieces(ticks) {
  const out = [];
  let rest = ticks;
  for (const v of REST_VALUES) while (rest >= v) { out.push(v); rest -= v; }
  if (rest > 0) out.push(8);
  return out;
}

/**
 * Turn the elements of a parsed part into target units (one chunk of amino acids each).
 * @returns {{units: object[], notes: string[]}}
 */
export function buildTargets(elements) {
  const notes = [];
  const sounds = [];
  let level = 'mf';
  // effective level and hairpins
  const els = elements.filter((e) => e.kind === 'note' || e.kind === 'chord' || e.kind === 'rest');
  for (const e of els) {
    if (e.kind === 'rest') { sounds.push({ ...e }); continue; }
    if (e.level) level = e.level;
    const s = { ...e, targetLevel: level };
    s.category = e.hairpin ? 'mpcat' : level === 'mp' ? 'mpcat' : level;
    sounds.push(s);
  }
  // hairpin runs: remember the levels before/after for the final comparison
  const units = [];
  let unitIndex = 0;
  const pushUnit = (u) => { u.index = unitIndex++; units.push(u); return u; };
  for (let k = 0; k < sounds.length; k++) {
    const e = sounds[k];
    if (e.kind === 'rest') {
      for (const v of restPieces(e.dur)) pushUnit({ kind: 'rest', dur: v, elementIndex: k });
      if (restPieces(e.dur).length > 1) notes.push(`rest of ${ticksToString(e.dur)} split into ${restPieces(e.dur).length} rests`);
      continue;
    }
    // grace notes -> PG (1) / GP (2) / PP (2 + a passing tone borrowed from the next note)
    let graces = (e.graces || []).map((g) => ({ pc: pcOf(g.midi), octave: octaveOf(g.midi) }));
    if (graces.length > 2) { notes.push(`element ${k + 1}: only the last two of ${graces.length} grace notes can be encoded`); graces = graces.slice(-2); }
    const next = sounds[k + 1];
    let passing = null;
    if (graces.length === 2 && next && next.kind === 'note' && (next.graces || []).length === 1 && sounds[k + 2] && sounds[k + 2].kind !== 'rest') {
      passing = { pc: pcOf(next.graces[0].midi), octave: octaveOf(next.graces[0].midi) };
      next.graces = [];
    }
    for (const g of graces) pushUnit({ kind: 'grace', pc: g.pc, octave: g.octave, elementIndex: k });
    if (graces.length) pushUnit({ kind: 'nh', aa: passing ? 'PP' : graces.length === 1 ? 'PG' : 'GP', elementIndex: k });
    if (e.kind === 'note') {
      pushUnit({ kind: 'note', pc: pcOf(e.midi), octave: octaveOf(e.midi), dur: e.dur, accent: !!e.accent, category: e.category, level: e.targetLevel, hairpin: e.hairpin ? e.hairpin.kind : null, elementIndex: k });
    } else {
      const id = identifyChord(e.pitches);
      if (!id.exact) notes.push(`element ${k + 1}: chord [${e.pitches.join(' ')}] approximated by ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][id.rootPc]}${id.symbol} (${id.missing} missing, ${id.extra} extra tone${id.extra === 1 ? '' : 's'})`);
      pushUnit({ kind: 'chord', pc: id.rootPc, octave: id.rootOctave, dup: id.dup, symbol: id.symbol, dur: e.dur, accent: !!e.accent, arpeggio: e.arpeggio || null, category: e.category, level: e.targetLevel, hairpin: e.hairpin ? e.hairpin.kind : null, elementIndex: k });
    }
    if (passing) pushUnit({ kind: 'passing', pc: passing.pc, octave: passing.octave, elementIndex: k + 1 });
  }
  return { units, notes };
}

// ---------------------------------------------------------------------------------------
// Candidate chunks
// ---------------------------------------------------------------------------------------

const noEffect = (dup) => { const e = T.duplexEffect(dup); return e.exp === 0 && e.frac === 0; };

/** All chunks that encode a unit given the current stored note value. */
function candidateChunks(unit, stored, opts) {
  const maxBranch = opts.maxBranch || 64;
  const out = [];
  if (unit.kind === 'rest') {
    for (const dup of REST_OPTIONS[unit.dur] || REST_OPTIONS[8]) out.push({ seq: dup, effect: T.EFFECT_NONE, soundAt: null });
    return out;
  }
  if (unit.kind === 'nh') return [{ seq: unit.aa, effect: T.EFFECT_NONE, soundAt: null }];
  if (unit.kind === 'grace' || unit.kind === 'passing') {
    for (const dup of T.DUPLEXES_OF_PITCH[unit.pc]) if (noEffect(dup) && !dup.includes('G')) out.push({ seq: dup, effect: T.EFFECT_NONE, soundAt: 0 });
    return out;
  }
  // note or chord
  const roots = T.DUPLEXES_OF_PITCH[unit.pc];
  const pDup = unit.kind === 'chord' ? unit.dup : '';
  const pEffect = pDup ? T.duplexEffect(pDup.replace('P', 'A')) : T.EFFECT_NONE;
  const arp = unit.kind === 'chord' && unit.arpeggio ? (unit.arpeggio === 'down' ? 'MG' : 'GM') : '';
  for (const root of roots) {
    const hasG = root.includes('G');
    const variants = [];
    if (unit.accent && hasG) variants.push({ gg: '' });
    else if (unit.accent && !hasG) variants.push({ gg: 'GG' });
    else if (!unit.accent && !hasG) variants.push({ gg: '' });
    else continue;
    const own = T.composeEffects(T.duplexEffect(root), pEffect);
    for (const v of variants) {
      for (const pre of PRE_MODS) {
        const preEff = pre ? T.M_FIRST_EFFECTS[pre[1]] : T.EFFECT_NONE;
        for (const post of POST_MODS) {
          if (v.gg && post) continue; // a modifier after GG would not reach the note
          const postEff = post ? T.M_SECOND_EFFECTS[post[0]] : T.EFFECT_NONE;
          const eff = T.composeEffects(T.composeEffects(preEff, own), postEff);
          if (applyEffect(stored, eff).played !== unit.dur) continue;
          let seq, soundAt;
          if (arp) { seq = pre + arp + pDup + root + post + v.gg; soundAt = pre.length + 2 + 2; }
          else { seq = pre + root + pDup + v.gg + post; soundAt = pre.length; }
          out.push({ seq, effect: eff, soundAt, mods: (pre ? 1 : 0) + (post ? 1 : 0) + (v.gg ? 1 : 0) });
        }
      }
    }
  }
  for (const c of out) c.h = heuristic(c.seq, unit);
  out.sort((a, b) => a.h - b.h);
  return out.slice(0, maxBranch);
}

/** Ideal per-residue hydrophilicity for an octave (midpoint of the Table 5 interval / 6). */
const SIGMA_TARGET = { 0: -3, 1: -2.1, 2: -1.33, 3: -0.75, 4: 0, 5: 0.75, 6: 1.33, 7: 2.1, 8: 3 };
/** Ideal (α, β) for a dynamic category (Table 7). */
const AB_TARGET = { f: [0.6, 2.5], p: [0.25, 0.8], mf: [0.6, 0.8], mpcat: [0.25, 2.5] };

/**
 * Ordering heuristic for candidate chunks: how well the residues fit the wanted octave and
 * dynamics on their own (the search then scores the real windows), plus a preference for
 * short chunks and common amino acids.
 */
function heuristic(seq, unit) {
  let h = 0, n = 0, sig = 0, a = 0, b = 0, na = 0;
  for (const c of seq) {
    const aa = T.AA[c];
    sig += aa.sigma; n++;
    if (aa.alpha !== null) { a += aa.alpha; b += aa.beta; na++; }
  }
  if (unit.octave !== undefined && n) h += 1.5 * Math.abs(sig / n - SIGMA_TARGET[unit.octave]);
  if (unit.category && AB_TARGET[unit.category] && na) {
    const [ta, tb] = AB_TARGET[unit.category];
    h += 4 * Math.abs(a / na - ta) + 1.2 * Math.abs(b / na - tb);
  }
  h += 0.8 * Math.max(0, seq.length / 2 - 1) + 0.03 * chunkPrior(seq);
  return h;
}

// ---------------------------------------------------------------------------------------
// Beam search
// ---------------------------------------------------------------------------------------

const W_OCT = 10, W_DYN = 6, W_GRACE_OCT = 2, W_MOD = 0.7, W_PRIOR = 0.05;

function materialize(state) {
  const parts = [];
  for (let s = state; s && s.chunk !== undefined; s = s.parent) parts.push(s.chunk);
  return parts.reverse().join('');
}

/** Evaluate every pending sound record whose windows are now determined. */
function evaluatePending(state, seqSoFar, final, instrument) {
  const n = seqSoFar.length;
  let penalty = 0;
  const remaining = [];
  for (const rec of state.pending) {
    let done = true;
    // octave (Table 5): needs residues up to i+3 (window shifted at the chain start)
    if (!rec.octDone) {
      const needed = Math.max(rec.i + 4, T.SIGMA_WINDOW);
      if (n >= needed || final) {
        let oct = 4;
        if (n >= T.SIGMA_WINDOW) {
          let s = Math.max(0, Math.min(rec.i - 2, n - T.SIGMA_WINDOW));
          let sum = 0;
          for (let k = s; k < s + T.SIGMA_WINDOW; k++) sum += T.AA[seqSoFar[k]].sigma;
          oct = T.octaveFromSigma(Math.round(sum * 10) / 10, instrument);
        }
        const w = rec.kind === 'grace' ? W_GRACE_OCT : W_OCT;
        penalty += w * Math.abs(oct - rec.octave);
        rec.octDone = true;
      } else done = false;
    }
    // dynamics (Table 7)
    if (!rec.dynDone && rec.category) {
      const r = rec.segRes;
      if (r === null) { rec.dynDone = true; }
      else {
        // find the segment end: first breaker after r, or unknown
        let segEnd = -1;
        for (let k = r + 1; k < n; k++) if (T.BREAKERS.includes(seqSoFar[k])) { segEnd = k - 1; break; }
        const closed = segEnd >= 0 || final;
        if (closed && segEnd < 0) segEnd = n - 1;
        const ready = closed || (n - 1 >= Math.max(r + 4, rec.segStart + T.DYNAMIC_WINDOW - 1));
        if (ready) {
          let cat;
          const end = closed ? segEnd : n - 1;
          const len = end - rec.segStart + 1;
          if (len <= T.SHORT_SEGMENT && closed) cat = 'mf';
          else if (len < T.DYNAMIC_WINDOW) cat = null; // cannot happen when ready, kept for safety
          else {
            let s = Math.max(rec.segStart, Math.min(r - 3, end - (T.DYNAMIC_WINDOW - 1)));
            let a = 0, b = 0;
            for (let k = s; k < s + T.DYNAMIC_WINDOW; k++) { a += T.AA[seqSoFar[k]].alpha; b += T.AA[seqSoFar[k]].beta; }
            cat = T.dynamicCategory(a / T.DYNAMIC_WINDOW, b / T.DYNAMIC_WINDOW);
          }
          if (cat) penalty += W_DYN * Math.abs(LEVEL_IDX[cat] - LEVEL_IDX[rec.category]);
          rec.dynDone = true;
        } else done = false;
      }
    }
    if (!done) remaining.push(rec);
  }
  state.pending = remaining;
  return penalty;
}

/**
 * Translate one part (voice) into an amino-acid sequence.
 * @param {object[]} elements parsed elements of one voice
 * @param {object} opts { beamWidth, maxBranch, instrument, seed }
 */
export function translatePart(elements, opts = {}) {
  const beamWidth = opts.beamWidth || 64;
  const instrument = opts.instrument || 'piano';
  const { units, notes } = buildTargets(elements);
  const rng = mulberry32(opts.seed ?? 0);
  const noise = opts.seed ? 0.5 : 0;
  let beam = [{ parent: null, chunk: undefined, len: 0, stored: BASE_DUR, score: 0, pending: [], segStart: 0, seq: '' }];
  for (const unit of units) {
    const next = [];
    const cache = new Map();
    for (const st of beam) {
      let cands = cache.get(st.stored);
      if (!cands) { cands = candidateChunks(unit, st.stored, opts); cache.set(st.stored, cands); }
      for (const c of cands) {
        const seq = st.seq + c.seq;
        const ns = { parent: st, chunk: c.seq, len: seq.length, stored: st.stored, score: st.score, pending: st.pending.map((p) => ({ ...p })), segStart: st.segStart, seq };
        // stored note value
        if (unit.kind === 'note' || unit.kind === 'chord') ns.stored = applyEffect(st.stored, c.effect).stored;
        // segment tracking (breakers G/P)
        let segStart = st.segStart;
        for (let k = st.len; k < seq.length; k++) if (T.BREAKERS.includes(seq[k])) segStart = k + 1;
        // new sound record
        if (c.soundAt !== null && c.soundAt !== undefined) {
          const i = st.len + c.soundAt, j = i + 1;
          const segRes = !T.BREAKERS.includes(seq[i]) ? i : !T.BREAKERS.includes(seq[j]) ? j : null;
          let segStartAt = 0;
          for (let k = segRes === null ? i : segRes; k > 0; k--) if (T.BREAKERS.includes(seq[k - 1])) { segStartAt = k; break; }
          ns.pending.push({ kind: unit.kind, i, j, octave: unit.octave, category: unit.kind === 'note' || unit.kind === 'chord' ? unit.category : null, segRes, segStart: segStartAt, octDone: false, dynDone: false });
        }
        ns.segStart = segStart;
        ns.score += W_MOD * (c.mods || 0) + W_PRIOR * chunkPrior(c.seq) + noise * rng();
        ns.score += evaluatePending(ns, seq, false, instrument);
        next.push(ns);
      }
    }
    if (!next.length) throw new Error(`No amino-acid pair can encode unit ${unit.index + 1} (${unit.kind}${unit.dur ? ' ' + ticksToString(unit.dur) : ''})`);
    next.sort((a, b) => a.score - b.score);
    // keep diverse: drop exact duplicate sequences
    const seen = new Set();
    beam = [];
    for (const s of next) { if (seen.has(s.seq)) continue; seen.add(s.seq); beam.push(s); if (beam.length >= beamWidth) break; }
  }
  for (const st of beam) st.score += evaluatePending(st, st.seq, true, instrument);
  beam.sort((a, b) => a.score - b.score);
  const chunksOf = (st) => { const out = []; for (let s = st; s && s.chunk !== undefined; s = s.parent) out.push(s.chunk); return out.reverse(); };
  return { candidates: beam.slice(0, Math.min(beam.length, opts.verifyTop || 6)).map((s) => ({ sequence: s.seq, searchScore: s.score, chunks: chunksOf(s) })), units, notes };
}

/** Penalty of a produced element list against the target (used by the verification). */
function penaltyOf(cmp) {
  const a = cmp.attributes;
  return a.kind * 100 + a.pitch * 50 + a.duration * 20 + a.octave * 5 + a.accent * 5 + a.dynamics * 3 + a.graces * 5;
}

/**
 * Local repair: re-choose single chunks (keeping the note values before and after them)
 * whenever that lowers the number of differences of the full forward translation.
 */
function repair(chunks, units, targetElements, instrument, opts) {
  const evaluate = (seq) => { const cmp = compareElements(targetElements, convertChain(seq, { instrument }).elements); return { cmp, penalty: penaltyOf(cmp) }; };
  let current = evaluate(chunks.join(''));
  const maxPasses = opts.repairPasses ?? 3;
  for (let pass = 0; pass < maxPasses && current.penalty > 0; pass++) {
    let improved = false;
    // stored note value before each unit
    let stored = BASE_DUR;
    const storedBefore = [];
    for (let k = 0; k < units.length; k++) {
      storedBefore.push(stored);
      const u = units[k];
      if (u.kind === 'note' || u.kind === 'chord') stored = applyEffect(stored, chunkEffect(chunks[k], u)).stored;
    }
    // which elements differ -> which units to try
    const badElements = new Set(current.cmp.diffs.map((d) => d.index));
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      if (u.kind === 'nh') continue;
      const near = [u.elementIndex - 1, u.elementIndex, u.elementIndex + 1].some((x) => badElements.has(x));
      if (!near) continue;
      const alts = candidateChunks(u, storedBefore[k], { ...opts, maxBranch: opts.repairBranch || 40 });
      const wantStored = (u.kind === 'note' || u.kind === 'chord') ? applyEffect(storedBefore[k], chunkEffect(chunks[k], u)).stored : null;
      for (const alt of alts) {
        if (alt.seq === chunks[k]) continue;
        if (wantStored !== null && applyEffect(storedBefore[k], alt.effect).stored !== wantStored) continue;
        const trial = chunks.slice(); trial[k] = alt.seq;
        const ev = evaluate(trial.join(''));
        if (ev.penalty < current.penalty) { chunks = trial; current = ev; improved = true; break; }
      }
      if (current.penalty === 0) break;
    }
    if (!improved) break;
  }
  return { chunks, sequence: chunks.join(''), ...current };
}

/** Duration effect of a chunk (used to recompute stored values during repair). */
function chunkEffect(chunk, unit) {
  const cands = candidateChunks(unit, BASE_DUR, { maxBranch: 1e9 });
  const found = cands.find((c) => c.seq === chunk);
  if (found) return found.effect;
  // fall back: compose the effects of the duplexes in the chunk
  let e = T.EFFECT_NONE;
  for (let i = 0; i + 1 < chunk.length; i += 2) {
    const d = chunk.slice(i, i + 2);
    if (d[0] === 'M' && T.isCharged(d[1])) e = T.composeEffects(e, T.M_FIRST_EFFECTS[d[1]]);
    else if (d[1] === 'M' && T.isCharged(d[0])) e = T.composeEffects(e, T.M_SECOND_EFFECTS[d[0]]);
    else if (!d.includes('M') && d !== 'GG') e = T.composeEffects(e, T.duplexEffect(d.replace('P', 'A')));
  }
  return e;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Verification: forward-translate the candidate and compare with the target
// ---------------------------------------------------------------------------------------

const soundPitches = (e) => (e.kind === 'note' ? [e.midi] : e.kind === 'chord' ? [...new Set([...(e.pitches || []), ...(e.extra || [])])].sort((a, b) => a - b) : []);

/**
 * Compare target elements (parsed ABC) with produced elements (forward translation).
 * @returns {{diffs: object[], total: number, exact: number, attributes: object}}
 */
export function compareElements(target, produced) {
  const tg = target.filter((e) => e.kind !== 'nonharm');
  const pr = produced.filter((e) => e.kind !== 'nonharm');
  const diffs = [];
  const attrs = { kind: 0, pitch: 0, duration: 0, octave: 0, accent: 0, dynamics: 0, graces: 0 };
  let level = 'mf', plevel = 'mf';
  const n = Math.max(tg.length, pr.length);
  let exact = 0;
  for (let k = 0; k < n; k++) {
    const a = tg[k], b = pr[k];
    if (!a || !b) { diffs.push({ index: k, what: 'count', target: a ? describeAny(a) : '-', produced: b ? describeElement(b) : '-' }); attrs.kind++; continue; }
    const d = [];
    if (a.kind !== b.kind) { d.push('kind'); attrs.kind++; }
    if (a.dur !== b.dur) { d.push('duration'); attrs.duration++; }
    if (a.kind !== 'rest' && b.kind !== 'rest') {
      const pa = soundPitches(a), pb = soundPitches(b);
      if (pa.map(pcOf).join() !== pb.map(pcOf).join()) { d.push('pitch'); attrs.pitch++; }
      else if (pa.join() !== pb.join()) { d.push('octave'); attrs.octave++; }
      if (!!a.accent !== !!b.accent) { d.push('accent'); attrs.accent++; }
      if (a.level) level = a.level;
      const tl = a.hairpin ? 'hairpin' : level;
      if (b.level) plevel = b.level;
      const pl = b.hairpin ? 'hairpin' : b.level ? b.level : (b.effectiveLevel || plevel);
      if (tl !== pl) { d.push('dynamics'); attrs.dynamics++; }
      const ga = (a.graces || []).map((g) => pcOf(g.midi)).join(), gb = (b.graces || []).map((g) => pcOf(g.midi)).join();
      if (ga !== gb) { d.push('graces'); attrs.graces++; }
    }
    if (d.length) {
      const tl = a.kind === 'rest' ? '' : ` (${a.hairpin ? a.hairpin.kind || 'hairpin' : level}${a.accent ? ', >' : ''})`;
      const pl = b.kind === 'rest' ? '' : ` (${b.hairpin ? b.hairpin.kind : b.level || b.effectiveLevel || plevel}${b.accent ? ', >' : ''})`;
      diffs.push({ index: k, what: d.join(','), target: describeAny(a) + tl, produced: describeElement(b) + pl });
    } else exact++;
  }
  return { diffs, total: n, exact, attributes: attrs };
}

function describeAny(e) {
  if (e.kind === 'rest') return 'rest ' + ticksToString(e.dur);
  if (e.kind === 'chord') return `[${e.pitches.map((m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pcOf(m)] + octaveOf(m)).join(' ')}];${ticksToString(e.dur)}`;
  return `${octaveOf(e.midi)};${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pcOf(e.midi)]};${ticksToString(e.dur)}`;
}

/**
 * Translate a parsed score (from parseAbc) into one amino-acid sequence per voice.
 * @param {object} score parsed score
 * @param {object} opts { beamWidth, maxBranch, seed, instruments, verifyTop }
 * @returns {{chains: object[], notes: string[]}}
 */
export function musicToProtein(score, opts = {}) {
  const notes = [...normalizeDurations(score), ...(score.warnings || [])];
  const chains = score.parts.map((part, k) => {
    const instrument = (opts.instruments && opts.instruments[k]) || (k === 1 ? 'guitar' : 'piano');
    // rests longer than a breve or dotted rests become several rests (Table 4 has fixed values)
    const target = [];
    for (const e of part.elements) {
      if (e.kind === 'rest' && restPieces(e.dur).length > 1) for (const v of restPieces(e.dur)) target.push({ kind: 'rest', dur: v });
      else target.push(e);
    }
    const res = translatePart(target, { ...opts, instrument });
    notes.push(...res.notes.map((n) => `${part.name}: ${n}`));
    // verify each candidate with the forward algorithm, then repair the best ones locally
    let verified = res.candidates.map((c) => {
      const cmp = compareElements(target, convertChain(c.sequence, { instrument }).elements);
      return { ...c, comparison: cmp, penalty: penaltyOf(cmp) };
    });
    verified.sort((a, b) => a.penalty - b.penalty || a.searchScore - b.searchScore);
    if (opts.repair !== false) {
      verified = verified.slice(0, opts.repairTop || 2).map((v) => {
        if (v.penalty === 0) return v;
        const r = repair(v.chunks, res.units, target, instrument, opts);
        return { ...v, sequence: r.sequence, chunks: r.chunks, comparison: r.cmp, penalty: r.penalty };
      }).concat(verified.slice(opts.repairTop || 2));
      verified.sort((a, b) => a.penalty - b.penalty || a.searchScore - b.searchScore);
    }
    const best = verified[0];
    return {
      name: part.name, instrument, sequence: best.sequence, length: best.sequence.length,
      fidelity: { exact: best.comparison.exact, total: best.comparison.total, attributes: best.comparison.attributes, diffs: best.comparison.diffs },
      alternatives: verified.slice(1).filter((v) => v.sequence !== best.sequence).map((v) => ({ sequence: v.sequence, exact: v.comparison.exact, total: v.comparison.total })),
      units: res.units.length,
    };
  });
  return { chains, notes, title: score.title };
}

export { proteinToMusic };
