export * from './tables.js';
export * from './theory.js';
export { proteinToMusic, convertChain, analyzeChain, parseFasta, cleanSequence, duplexTable, describeElement } from './protein2music.js';
export { scoreToAbc, parseAbc, normalizeDurations, abcPitch, keySignature } from './abc.js';
export { scoreToMidi } from './midi.js';
export { scoreToEvents, velocities } from './events.js';
export { scoreToMusicXml } from './musicxml.js';
export { musicToProtein, translatePart, buildTargets, identifyChord, compareElements } from './music2protein.js';
