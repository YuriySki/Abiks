#!/usr/bin/env node
/**
 * abiks - protein <-> music converter (Nadirova & Zhigailov, Heliyon 2026, e45432).
 *
 *   abiks encode <fasta-file | sequence> [options]   protein -> ABC / MIDI / MusicXML / JSON
 *   abiks decode <abc-file> [options]                music (ABC) -> amino-acid sequence(s)
 *   abiks examples [outdir]                          convert the bundled examples
 *   abiks tables                                     print the localization/tempo table
 *   abiks serve [port]                               serve the web page locally
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { proteinToMusic, parseFasta } from '../src/protein2music.js';
import { scoreToAbc, parseAbc } from '../src/abc.js';
import { scoreToMidi } from '../src/midi.js';
import { scoreToMusicXml } from '../src/musicxml.js';
import { musicToProtein } from '../src/music2protein.js';
import { TEMPOS } from '../src/tables.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `abiks - protein <-> music converter
(doublet degenerate code of Nadirova & Zhigailov, Heliyon 12 (2026) e45432)

Usage:
  abiks encode <fasta-file|sequence> [-o out.abc] [--midi out.mid] [--xml out.musicxml]
               [--json out.json] [--loc <localization>] [--bpm N] [--title T]
               [--instruments piano,guitar] [--table] [--ignore-unknown]
  abiks decode <abc-file> [-o out.fasta] [--beam N] [--seed N] [--json report.json]
               [--verify out.abc] [--instruments piano,guitar]
  abiks examples [outdir]        convert the bundled examples (default: examples/output)
  abiks tables                   list the localization -> tempo table (Table 8)
  abiks serve [port]             serve the web converter on http://localhost:<port>

Localizations (Table 8): ${TEMPOS.map((t) => t.id).join(', ')}
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { args[key] = next; i++; } else args[key] = true;
    } else if (a === '-o') { args.out = argv[++i]; }
    else args._.push(a);
  }
  return args;
}

function readInput(arg) {
  if (!arg || arg === '-') return readFileSync(0, 'utf8');
  if (existsSync(arg) && statSync(arg).isFile()) return readFileSync(arg, 'utf8');
  return arg;
}

function encode(args) {
  const input = readInput(args._[1]);
  const opts = {
    title: args.title, localization: args.loc || args.localization, bpm: args.bpm ? Number(args.bpm) : undefined,
    instruments: args.instruments ? String(args.instruments).split(',') : undefined, ignoreUnknown: !!args['ignore-unknown'],
  };
  const score = proteinToMusic(input, opts);
  const abc = scoreToAbc(score);
  const base = args.out ? args.out.replace(/\.abc$/i, '') : null;
  if (args.out) writeFileSync(args.out, abc); else process.stdout.write(abc);
  if (args.midi) writeFileSync(args.midi === true ? `${base || 'out'}.mid` : args.midi, scoreToMidi(score));
  if (args.xml) writeFileSync(args.xml === true ? `${base || 'out'}.musicxml` : args.xml, scoreToMusicXml(score));
  if (args.json) writeFileSync(args.json === true ? `${base || 'out'}.json` : args.json, JSON.stringify(score, null, 2));
  if (args.table) {
    for (const p of score.parts) {
      console.error(`\n${p.name} (${p.instrumentName}), ${p.sequence.length} residues, tempo ${score.tempo.marking} ${score.tempo.bpm} bpm`);
      console.error('idx  duplex  role        note              Σ6σ    αav    βav    level  shift');
      for (const r of p.table) {
        console.error(`${String(r.idx + 1).padStart(3)}  ${r.aa.padEnd(6)}  ${r.role.padEnd(10)}  ${String(r.note ?? '').padEnd(16)}  ${r.sigma6 === null || r.sigma6 === undefined ? '  -  ' : String(r.sigma6).padStart(5)}  ${r.alphaAv == null ? '  -  ' : r.alphaAv.toFixed(3)}  ${r.betaAv == null ? '  -  ' : r.betaAv.toFixed(3)}  ${(r.level || '').padEnd(6)} ${r.shift === undefined ? '' : (r.accent ? '> ' : '') + r.shift}`);
      }
    }
  }
  for (const w of score.warnings) console.error('warning: ' + w);
}

function decode(args) {
  const text = readInput(args._[1]);
  const score = parseAbc(text);
  const opts = { beamWidth: args.beam ? Number(args.beam) : undefined, seed: args.seed ? Number(args.seed) : undefined, instruments: args.instruments ? String(args.instruments).split(',') : undefined };
  const t0 = Date.now();
  const res = musicToProtein(score, opts);
  const fasta = res.chains.map((c) => `>${(score.title || 'music').replace(/\s+/g, '_')}|${c.name.replace(/\s+/g, '_')}|${c.fidelity.exact}/${c.fidelity.total}_elements_exact\n${c.sequence.replace(/(.{60})/g, '$1\n').trim()}`).join('\n') + '\n';
  if (args.out) writeFileSync(args.out, fasta); else process.stdout.write(fasta);
  for (const c of res.chains) {
    const a = c.fidelity.attributes;
    console.error(`${c.name}: ${c.length} residues; ${c.fidelity.exact}/${c.fidelity.total} elements reproduced exactly ` +
      `(pitch errors ${a.pitch}, duration ${a.duration}, octave ${a.octave}, accent ${a.accent}, dynamics ${a.dynamics}, graces ${a.graces}); ${Date.now() - t0} ms`);
    if (args.diffs) for (const d of c.fidelity.diffs) console.error(`  #${d.index + 1} ${d.what}: wanted ${d.target}, got ${d.produced}`);
  }
  for (const n of res.notes) console.error('note: ' + n);
  if (args.json) writeFileSync(args.json === true ? 'decode-report.json' : args.json, JSON.stringify(res, null, 2));
  if (args.verify) {
    const chains = res.chains.map((c) => ({ name: c.name, sequence: c.sequence }));
    const back = proteinToMusic(chains, { title: (score.title || 'music') + ' (re-encoded)', bpm: score.tempo.bpm, tempoMarking: score.tempo.marking, instruments: res.chains.map((c) => c.instrument) });
    writeFileSync(args.verify === true ? 'verify.abc' : args.verify, scoreToAbc(back));
  }
}

function examples(args) {
  const outDir = resolve(args._[1] || join(ROOT, 'examples', 'output'));
  mkdirSync(outDir, { recursive: true });
  const exDir = join(ROOT, 'examples');
  const meta = JSON.parse(readFileSync(join(exDir, 'examples.json'), 'utf8'));
  for (const ex of meta) {
    const src = readFileSync(join(exDir, ex.file), 'utf8');
    const base = join(outDir, basename(ex.file, extname(ex.file)));
    if (ex.file.endsWith('.abc')) {
      const score = parseAbc(src);
      const res = musicToProtein(score, { beamWidth: 64 });
      const fasta = res.chains.map((c) => `>${ex.title.replace(/\s+/g, '_')}|${c.name.replace(/\s+/g, '_')}\n${c.sequence}`).join('\n') + '\n';
      writeFileSync(base + '.musical-protein.fasta', fasta);
      const back = proteinToMusic(res.chains.map((c) => ({ name: c.name, sequence: c.sequence })), { title: ex.title + ' (re-encoded from protein)', bpm: score.tempo.bpm, tempoMarking: score.tempo.marking });
      writeFileSync(base + '.re-encoded.abc', scoreToAbc(back));
      writeFileSync(base + '.re-encoded.mid', scoreToMidi(back));
      console.log(`${ex.file} -> ${res.chains.map((c) => `${c.length} aa, ${c.fidelity.exact}/${c.fidelity.total} exact`).join('; ')}`);
    } else {
      const score = proteinToMusic(src, { title: ex.title, localization: ex.localization, bpm: ex.bpm });
      writeFileSync(base + '.abc', scoreToAbc(score));
      writeFileSync(base + '.mid', scoreToMidi(score));
      writeFileSync(base + '.musicxml', scoreToMusicXml(score));
      console.log(`${ex.file} -> ${score.parts.map((p) => `${p.sequence.length} aa, ${p.elements.filter((e) => e.kind !== 'nonharm').length} elements`).join('; ')} (${score.tempo.marking} ${score.tempo.bpm})`);
    }
  }
  console.log('written to ' + outDir);
}

function serve(args) {
  const port = Number(args._[1] || 8080);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.abc': 'text/plain', '.fasta': 'text/plain', '.mid': 'audio/midi', '.musicxml': 'application/xml', '.md': 'text/markdown' };
  createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`abiks web converter: http://localhost:${port}/`));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  if (!cmd || cmd === 'help' || args.help) process.stdout.write(HELP);
  else if (cmd === 'encode') encode(args);
  else if (cmd === 'decode') decode(args);
  else if (cmd === 'examples') examples(args);
  else if (cmd === 'tables') { for (const t of TEMPOS) console.log(`${t.id.padEnd(18)} ${t.marking.padEnd(17)} ${String(t.bpm).padStart(3)} bpm (${t.range})  ${t.localization}`); }
  else if (cmd === 'serve') serve(args);
  else { process.stderr.write(`Unknown command "${cmd}"\n\n` + HELP); process.exit(2); }
} catch (err) {
  process.stderr.write('error: ' + (err && err.message ? err.message : err) + '\n');
  process.exit(1);
}
