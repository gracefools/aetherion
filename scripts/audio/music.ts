// TEMPORARY placeholder music for the sixteen tracks of the M10 production list.
//
// These are NOT the Suno tracks the specification asks for: no Suno integration was available
// when they were made (see docs/M10.md). They are original pieces written for this game as
// note data below and rendered by the synthesiser in dsp.ts, so that the dynamic music system
// can be built, heard and tested. Each has its own key, tempo, instrumentation and melody so
// regions are told apart by ear. Replace them file by file when real tracks exist.
import { BGM } from '../../shared/src/audio';
import { beatsOf, bell, drum, flute, hit, hz, line, midi, piano, pluck, Song, sub, type Ev, type Inst, type Stereo } from './dsp';

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------
const strings = sub({ voices: 3, detune: 10, a: 0.22, d: 0.3, s: 0.85, r: 0.45, cutoff: 1500, track: 1.5, vib: 6 });
const stacc = sub({ voices: 2, detune: 8, a: 0.008, d: 0.09, s: 0.25, r: 0.07, cutoff: 1200, cutEnv: 2400, track: 1 });
const pad = sub({ voices: 3, detune: 16, a: 1.1, d: 0.5, s: 0.9, r: 1.6, cutoff: 650, track: 1 });
const horn = sub({ voices: 2, detune: 5, a: 0.07, d: 0.25, s: 0.75, r: 0.22, cutoff: 380, cutEnv: 1500, track: 0.8, vib: 5, vibDelay: 0.4 });
const brass = sub({ voices: 3, detune: 7, a: 0.03, d: 0.18, s: 0.8, r: 0.16, cutoff: 600, cutEnv: 2800, track: 1 });
const lead = sub({ wave: 'square', voices: 2, detune: 6, a: 0.008, d: 0.12, s: 0.7, r: 0.1, cutoff: 1800, cutEnv: 1800, track: 1.5, vib: 7, vibDelay: 0.18 });
const bassSaw = sub({ a: 0.006, d: 0.14, s: 0.6, r: 0.08, cutoff: 260, cutEnv: 700, sub: 0.6 });
const bassSoft = sub({ wave: 'tri', a: 0.02, d: 0.3, s: 0.7, r: 0.2, cutoff: 600, sub: 0.4 });
const choirAh = sub({ voices: 4, detune: 14, a: 0.5, d: 0.4, s: 0.9, r: 0.9, formants: [[650, 1], [1080, 0.6], [2450, 0.25]], vib: 7, vibDelay: 0.5 });
const choirOo = sub({ voices: 4, detune: 12, a: 0.7, d: 0.4, s: 0.9, r: 1.1, formants: [[320, 1], [800, 0.35], [2300, 0.1]], vib: 6, vibDelay: 0.6 });
const fiddle = sub({ a: 0.03, d: 0.1, s: 0.85, r: 0.08, cutoff: 2600, track: 2, vib: 14, vibRate: 5.8, vibDelay: 0.12 });
const lute = pluck({ bright: 0.55, sustain: 0.9965 });
const harp = pluck({ bright: 0.35, sustain: 0.998 });
const guitar = pluck({ bright: 0.45, sustain: 0.997 });
const pizz = pluck({ bright: 0.3, sustain: 0.985 });
const fl = flute();
const whistle = flute({ breath: 0.04, vib: 12 });
const pno = piano();
const pnoSoft = piano({ soft: 0.5 });
const celesta = bell({ ratio: 4, index: 1.2, tau: 0.5 });
const chime = bell({ ratio: 3.5, index: 2.5, tau: 1.4 });
const glock = bell({ ratio: 5.4, index: 1, tau: 0.35 });
const eerie = bell({ ratio: 1.41, index: 3, tau: 2.2 });
const timp = drum({ decay: 0.7, slap: 0.25, drop: 1.3, tone2: 0.3 });
const taiko = drum({ decay: 0.32, slap: 0.9, drop: 1.9, tone2: 0.1 });
const kick = drum({ decay: 0.16, slap: 0.35, drop: 3, tone2: 0 });
const snare = hit({ decay: 0.11, q: 0.7, tone: 0.5 });
const hat = hit({ decay: 0.03 });
const tamb = hit({ decay: 0.07, q: 2 });
const clap = hit({ decay: 0.09, mode: 1, q: 1.2, bursts: 3 });
const crash = hit({ decay: 0.9, q: 0.6 });
const swell = hit({ decay: 0.5, attack: 1.4, q: 0.6 });
const breath = hit({ decay: 1.6, attack: 2.2, mode: 1, q: 0.8 });

/** A melody line that must fill exactly `beats` (a guard against miscounted bars). */
function part(src: string, beats: number): Ev[] {
  const b = beatsOf(src);
  if (Math.abs(b - beats) > 1e-6) throw new Error(`part is ${b} beats, expected ${beats}: ${src.trim().slice(0, 50)}…`);
  return line(src);
}
const one = (bus: Stereo, s: Song, inst: Inst, note: string, beat: number, beats: number, vel: number, pan = 0) => inst(bus, beat * s.beat, hz(midi(note)), beats * s.beat, vel, pan);

// ---------------------------------------------------------------------------------------------
// BGM-001  Main Menu: grand orchestral fantasy, mysterious opening. D minor, 66 bpm.
// ---------------------------------------------------------------------------------------------
function mainMenu(): Stereo {
  const s = new Song(66, 48, 7, 101), prog = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'C', 'A', 'Bb', 'C', 'Dm', 'A'];
  let b = s.bus();
  s.chords(b, strings, prog, 4, { octave: 3, vel: 0.4, voicing: [0, 1, 2, 3] });
  s.add(b, -21, 0.3, 0.85);
  b = s.bus();
  s.bass(b, bassSoft, prog, 4, [[0, 3.9]], { octave: 2 });
  s.add(b, -20);
  b = s.bus();
  s.arp(b, harp, prog, 4, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, { octave: 3, vel: 0.5, pan: -0.35 });
  s.add(b, -24, 0.3, 0.8);
  b = s.bus();
  s.play(b, horn, part(`D4:2 A4:2 | G4:1.5 F4:.5 D4:2 | Bb4:2 A4:1 G4:1 | E4:3 -:1 | D4:1 F4:1 A4:2 | C5:2 A4:1 F4:1 | G4:2 E4:1 G4:1 | A4:3 -:1 |
    D5:2 Bb4:1 D5:1 | E5:2 C5:1 E5:1 | F5:1.5 E5:.5 D5:2 | C#5:2 E5:1 A4:1`, 48), { vel: 0.6, pan: 0.1 });
  s.add(b, -15, 0.35, 0.85);
  b = s.bus();
  s.chords(b, choirOo, prog.slice(8), 4, { octave: 4, start: 32, vel: 0.5 });
  s.add(b, -22, 0.4, 0.9);
  b = s.bus();
  for (const [note, beat] of [['A5', 2], ['D6', 10], ['F5', 18], ['E6', 26], ['A5', 34], ['D6', 42]] as const) one(b, s, chime, note, beat, 2, 0.5, 0.4);
  s.add(b, -27, 0.5, 0.9);
  b = s.bus();
  one(b, s, timp, 'D2', 0, 1, 0.9);
  one(b, s, timp, 'D2', 16, 1, 0.7);
  one(b, s, timp, 'Bb1', 32, 1, 1);
  one(b, s, timp, 'D2', 40, 1, 0.8);
  s.roll(b, timp, 'A1', 30, 2, 0.15, 0.8);
  s.roll(b, timp, 'A1', 46, 2, 0.15, 0.7);
  s.add(b, -13, 0.25, 0.8, 0.4, 'peak');
  b = s.bus();
  swell(b, 29.5 * s.beat, 5000, 1, 0.6, 0);
  s.add(b, -26, 0.3, 0.8, 0.4, 'peak');
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-002  Eldoria Main City: warm medieval, peaceful, a tune to remember. G major, 96 bpm.
// ---------------------------------------------------------------------------------------------
function eldoria(): Stereo {
  const s = new Song(96, 64, 5, 102);
  const A = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'], B = ['Em', 'C', 'G', 'D', 'Em', 'C', 'D', 'G'], prog = [...A, ...B];
  let b = s.bus();
  s.arp(b, lute, prog, 4, [0, 2, 1, 2, 3, 2, 1, 2], 0.5, { octave: 3, vel: 0.5, pan: -0.3, accent: 1.25 });
  s.add(b, -19, 0.15, 0.5);
  b = s.bus();
  s.bass(b, bassSoft, prog, 4, [[0, 1.6], [2, 1.6, 7]], { octave: 2 });
  s.add(b, -20);
  b = s.bus();
  s.pattern(b, tamb, 'x.o.x.oo', 0.5, 6500, { vel: 0.5, pan: 0.3 });
  s.add(b, -27, 0.1, 0.4, 0.4, 'peak');
  b = s.bus();
  s.play(b, fl, part(`G4 B4 D5 B4 | A4 F#4 D4:2 | E4 G4 B4 G4 | G4 E4 G4:2 | G4 B4 D5 G5 | F#5 D5 A4:2 | E5 D5 C5 E5 | D5:3 -:1 |
    B4:1.5 G4:.5 E4 G4 | C5:1.5 G4:.5 E4 G4 | D5 B4 G4 B4 | A4:2 F#4 A4 | B4:1.5 G4:.5 E5 D5 | C5 E5 G5 E5 | F#5 E5 D5 A4 | G4:3 -:1`, 64), { vel: 0.6, transpose: 12, pan: 0.15 });
  s.add(b, -15, 0.25, 0.6);
  b = s.bus();
  s.chords(b, strings, B, 4, { octave: 3, start: 32, vel: 0.4 });
  s.add(b, -25, 0.3, 0.7);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-003  Small Village: gentle acoustic waltz, welcoming. C major, 3/4, 84 bpm.
// ---------------------------------------------------------------------------------------------
function village(): Stereo {
  const s = new Song(84, 48, 5, 103), prog = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'C', 'C'];
  let b = s.bus();
  s.arp(b, guitar, prog, 3, [0, 2, 1, 2, 3, 2], 0.5, { octave: 3, vel: 0.5, pan: -0.25, beatsPerBar: 3, accent: 1.2 });
  s.add(b, -18, 0.15, 0.45);
  b = s.bus();
  s.bass(b, bassSoft, prog, 3, [[0, 2.6]], { octave: 2 });
  s.add(b, -22);
  b = s.bus();
  s.play(b, whistle, part(`E5 G5 E5 | C5:2 A4 | A4 C5 F5 | D5:2 B4 | E5 G5 C6 | B5:2 G5 | A5 G5 F5 | G5:2 -:1 |
    E5 A5 E5 | F5:2 C5 | E5 D5 C5 | D5:2 B4 | A4 C5 F5 | G5 F5 D5 | C5:3 | -:3`, 48), { vel: 0.55, pan: 0.15 });
  s.add(b, -16, 0.25, 0.55);
  b = s.bus();
  for (const [note, beat] of [['C6', 42], ['E6', 43], ['G6', 44], ['C7', 45]] as const) one(b, s, glock, note, beat, 1, 0.5, 0.35);
  s.add(b, -26, 0.3, 0.6);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-004  Verdant Reach: magical woodland; flute, strings, harp. D dorian, 72 bpm.
// ---------------------------------------------------------------------------------------------
function verdant(): Stereo {
  const s = new Song(72, 48, 6, 104), prog = ['Dm', 'G', 'Dm', 'C', 'Dm', 'G', 'Am', 'Dm', 'F', 'G', 'Am', 'Dm'];
  let b = s.bus();
  s.arp(b, harp, prog, 4, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, { octave: 3, vel: 0.5, pan: -0.3 });
  s.add(b, -19, 0.3, 0.75);
  b = s.bus();
  s.chords(b, strings, prog, 4, { octave: 3, vel: 0.4 });
  s.add(b, -24, 0.35, 0.8);
  b = s.bus();
  s.play(b, fl, part(`A4:1.5 D5:.5 F5 E5 | D5 B4 G4:2 | A4 D5 E5:.5 F5:.5 A5 | G5:1.5 E5:.5 C5:2 | D5 F5 A5:1.5 G5:.5 | B5 A5 G5 D5 | E5:2 C5 A4 | D5:3 -:1 |
    -:1 C5 F5 A5 | B5:1.5 A5:.5 G5 B4 | C5 E5 A5 G5 | F5 E5 D5:2`, 48), { vel: 0.6, pan: 0.2 });
  s.add(b, -15, 0.35, 0.8);
  b = s.bus();
  // small bright calls answering the flute, like birds in the canopy
  for (const [beat, notes] of [[3.5, ['A6', 'D7']], [14.25, ['G6', 'B6', 'G6']], [27.5, ['E7', 'C7']], [38, ['A6', 'C7', 'A6']], [45.5, ['D7', 'A6']]] as const)
    notes.forEach((n, k) => one(b, s, glock, n, beat + k * 0.18, 0.2, 0.4, k % 2 ? 0.6 : -0.5));
  s.add(b, -29, 0.4, 0.8);
  b = s.bus();
  s.bass(b, bassSoft, prog, 4, [[0, 3.8]], { octave: 2 });
  s.add(b, -24);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-005  Ashen Highlands: dark volcanic; war drums and dramatic strings. C phrygian, 104 bpm.
// ---------------------------------------------------------------------------------------------
function ashen(): Stereo {
  const s = new Song(104, 64, 5, 105), prog = ['Cm', 'Cm', 'Db', 'Cm', 'Ab', 'Bb', 'Cm', 'G'];
  let b = s.bus();
  s.pattern(b, taiko, 'X..x..x.X..x.xx.', 0.25, 78, { vel: 0.6, pan: -0.1 });
  s.pattern(b, taiko, 'X...............................', 0.25, 52, { vel: 0.9, pan: 0.15 });
  s.add(b, -12, 0.18, 0.6, 0.4, 'peak');
  b = s.bus();
  s.arp(b, stacc, prog, 8, [0, 0, 2, 0, 1, 0, 2, 0], 0.5, { octave: 2, vel: 0.5, accent: 1.3 });
  s.add(b, -18, 0.2, 0.6);
  b = s.bus();
  s.play(b, strings, part(`C4:3 Eb4 | G4:3 F4 | Eb4:2 D4:2 | C4:4 | Db4:3 F4 | Ab4:3 G4 | Eb4:2 D4 Eb4 | C4:4 |
    C5:3 Ab4 | Eb5:3 C5 | D5:2 Bb4:2 | F5:3 D5 | Eb5:2 D5 C5 | G4:4 | B4:2 D5:2 | G4:2 B4 D5`, 64), { vel: 0.6, gate: 1 });
  s.add(b, -15, 0.3, 0.75);
  b = s.bus();
  s.chords(b, brass, ['Ab', 'Bb', 'Cm', 'G'], 8, { octave: 3, start: 32, vel: 0.6, gate: 0.2 });
  s.add(b, -18, 0.25, 0.7);
  b = s.bus();
  one(b, s, pad, 'C2', 0, 32, 0.5);
  one(b, s, pad, 'C2', 32, 32, 0.5);
  s.add(b, -23);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-006  Frostveil: cold and still; piano over thin high strings. A minor, 60 bpm.
// ---------------------------------------------------------------------------------------------
function frostveil(): Stereo {
  const s = new Song(60, 40, 8, 106), prog = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E', 'Am', 'Em'];
  let b = s.bus();
  s.arp(b, pnoSoft, prog, 4, [0, 2, 3, 4, -1, 4, 3, 2], 0.5, { octave: 3, vel: 0.45, pan: -0.15 });
  s.add(b, -20, 0.45, 0.9);
  b = s.bus();
  s.play(b, pno, part(`E5:2 C5 B4 | A4:3 C5 | E5:2 G5:2 | D5:3 B4 | C5 E5 A5:2 | G5 F5 C5:2 | D5:2 F5 A5 | G#5:3 E5 | A5:2 E5 C5 | B4:3 -:1`, 40), { vel: 0.6, pan: 0.1, gate: 1 });
  s.add(b, -15, 0.5, 0.92);
  b = s.bus();
  s.chords(b, pad, prog, 4, { octave: 4, vel: 0.4, voicing: [0, 2, 4] });
  s.add(b, -26, 0.5, 0.95);
  b = s.bus();
  for (const [note, beat] of [['E6', 1.5], ['A6', 7.5], ['C7', 13], ['B6', 18.5], ['E7', 25.5], ['A6', 30], ['G#6', 34.5], ['E6', 38.5]] as const) one(b, s, celesta, note, beat, 1, 0.45, beat % 2 ? 0.5 : -0.5);
  s.add(b, -27, 0.55, 0.95);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-007  Dreadmoor: dark ambient, unsettling. Drone on C#, clusters and tritones, 50 bpm.
// ---------------------------------------------------------------------------------------------
function dreadmoor(): Stereo {
  const s = new Song(50, 32, 9, 107);
  let b = s.bus();
  for (const start of [0, 16]) {
    one(b, s, pad, 'C#2', start, 16, 0.6, -0.2);
    one(b, s, pad, 'G#2', start, 16, 0.4, 0.2);
  }
  s.add(b, -18, 0.3, 0.9);
  b = s.bus();
  // a second drone a semitone away drifts in and out: the "wrong" note that makes the place uneasy
  one(b, s, pad, 'D2', 8, 8, 0.5, 0.4);
  one(b, s, pad, 'D3', 24, 8, 0.4, -0.4);
  s.add(b, -25, 0.4, 0.95);
  b = s.bus();
  s.play(b, pnoSoft, part(`C#3:4 -:4 G3:2 F#3:2 -:4 | E3:4 -:2 C4:2 -:4 Bb2:4`, 32), { vel: 0.6, gate: 1, human: 1 });
  s.add(b, -19, 0.6, 0.95);
  b = s.bus();
  for (const [note, beat, pan] of [['D6', 6, 0.5], ['G#5', 13, -0.5], ['C6', 22, 0.3], ['F#5', 29, -0.3]] as const) one(b, s, eerie, note, beat, 3, 0.5, pan);
  s.add(b, -26, 0.6, 0.97);
  b = s.bus();
  s.play(b, choirOo, [{ beat: 16, dur: 8, notes: [midi('C#4'), midi('D4'), midi('G#4')] }], { vel: 0.5 });
  s.add(b, -27, 0.5, 0.95);
  b = s.bus();
  for (const [beat, v] of [[0, 0.9], [12.5, 0.5], [16, 0.8], [27, 0.5]] as const) one(b, s, timp, 'C#2', beat, 1, v);
  s.add(b, -17, 0.4, 0.9, 0.4, 'peak');
  b = s.bus();
  breath(b, 8 * s.beat, 700, 1, 0.5, -0.3);
  breath(b, 24 * s.beat, 500, 1, 0.5, 0.3);
  s.add(b, -30, 0.4, 0.9, 0.4, 'peak');
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-008  Astral Ruins: an ancient city; mysterious choir and bell tones. F lydian, 56 bpm.
// ---------------------------------------------------------------------------------------------
function astral(): Stereo {
  const s = new Song(56, 40, 9, 108), prog = ['F', 'G', 'Em', 'F', 'Dm', 'G', 'Am', 'Em', 'F', 'G'];
  let b = s.bus();
  s.chords(b, choirAh, prog, 4, { octave: 3, vel: 0.5, voicing: [0, 1, 2, 3] });
  s.add(b, -18, 0.5, 0.95);
  b = s.bus();
  s.bass(b, choirOo, prog, 4, [[0, 4]], { octave: 2, vel: 0.5 });
  s.add(b, -22, 0.4, 0.9);
  b = s.bus();
  s.play(b, chime, part(`B5 A5 E5:2 | -:2 C6 B5 | G5:2 E5:2 | -:1 A5 B5:2 | F5:2 A5:2 | D6:1.5 B5:.5 G5:2 | E5:2 C6:2 | B5:3 -:1 | A5 C6 E6:2 | D6:2 B5:2`, 40), { vel: 0.5, pan: 0.2, human: 1 });
  s.add(b, -19, 0.55, 0.96);
  b = s.bus();
  s.arp(b, harp, prog, 4, [0, 2, 4, 6], 1, { octave: 4, vel: 0.4, pan: -0.4 });
  s.add(b, -26, 0.5, 0.95);
  b = s.bus();
  one(b, s, pad, 'F1', 0, 20, 0.5);
  one(b, s, pad, 'F1', 20, 20, 0.5);
  s.add(b, -24);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-009  Normal Combat: energetic JRPG action. A minor, 152 bpm.
// ---------------------------------------------------------------------------------------------
function combat(): Stereo {
  // Rewritten to hit harder when a fight starts: faster, a kick on every beat with double-kick
  // fills, sixteenth-note bass and string ostinato, war drums underneath, brass on the accents
  // and the lead doubled an octave down. It opens on a crash and a full-band downbeat.
  const s = new Song(172, 64, 3, 109), prog = ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E', 'Dm', 'Dm', 'Am', 'Am', 'F', 'G', 'E', 'E'];
  let b = s.bus();
  s.pattern(b, kick, 'X.x.x.x.X.x.x.xx' + 'X.x.x.x.X.x.xxxx', 0.25, 50, { vel: 0.95 });
  s.pattern(b, snare, '....X..o....X..o' + '....X..o....X.xX', 0.25, 1500, { vel: 0.8, pan: 0.05 });
  s.pattern(b, hat, 'xxoxxxoxxxoxxxox', 0.25, 8500, { vel: 0.26, pan: -0.25 });
  s.pattern(b, taiko, 'X.....x...x.X...' + 'X.....x.x.x.X.xx', 0.25, 64, { vel: 0.8, pan: 0.2 });
  for (const beat of [0, 16, 32, 48]) crash(b, beat * s.beat, 4500, 1, 0.6, beat % 32 ? -0.2 : 0.2);
  s.roll(b, timp, 'E2', 60, 4, 0.25, 1, 0.25);
  s.add(b, -10, 0.08, 0.4, 0.5, 'peak');
  b = s.bus();
  s.bass(b, bassSaw, prog, 4, Array.from({ length: 16 }, (_, k) => [k * 0.25, 0.25, k % 8 === 7 ? 12 : k % 4 === 2 ? 7 : 0] as [number, number, number]), { octave: 2, vel: 0.6, gate: 0.75, human: 0.2 });
  s.add(b, -14);
  b = s.bus();
  s.arp(b, stacc, prog, 4, [0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 0, 1, 0, 3, 2], 0.25, { octave: 3, vel: 0.5, accent: 1.4, human: 0.25 });
  s.add(b, -17, 0.15, 0.5);
  b = s.bus();
  for (const start of [0, 1.5, 3]) s.chords(b, brass, prog, 4, { octave: 3, start, gate: 0.12, vel: 0.6, voicing: [0, 1, 2, 3] });
  s.add(b, -16, 0.2, 0.55);
  b = s.bus();
  const tune = `A4:.5 C5:.5 E5:.5 A5:.5 G5 E5 | A5:.5 G5:.5 E5:.5 D5:.5 E5:2 | F5:.5 A5:.5 C6:.5 A5:.5 F5 A5 | G5:.5 B5:.5 D6:.5 B5:.5 G5:2 |
    A4:.5 C5:.5 E5:.5 A5:.5 G5 E5 | A5:.5 B5:.5 C6:.5 B5:.5 A5:2 | C6 A5 F5 A5 | G#5:1.5 B5:.5 E6:2 |
    D5:.5 F5:.5 A5:.5 D6:.5 C6 A5 | F5 E5:.5 D5:.5 F5:2 | E5:.5 A5:.5 C6:.5 E6:.5 D6 C6 | A5:3 -:1 |
    F5:.5 G5:.5 A5:.5 C6:.5 A5 F5 | G5:.5 A5:.5 B5:.5 D6:.5 B5 G5 | E5 G#5 B5 E6 | D6:.5 C6:.5 B5:.5 G#5:.5 E5 -:1`;
  s.play(b, lead, part(tune, 64), { vel: 0.55, gate: 0.9, human: 0.3 });
  s.play(b, brass, part(tune, 64), { vel: 0.45, gate: 0.9, transpose: -12, human: 0.3, pan: -0.15 });
  s.add(b, -13, 0.18, 0.5);
  b = s.bus();
  s.chords(b, choirAh, prog.slice(8), 4, { octave: 3, start: 32, vel: 0.5 });
  s.add(b, -22, 0.3, 0.7);
  return s.render(true, -19);
}

// ---------------------------------------------------------------------------------------------
// BGM-010  Elite Monster Combat: faster, heavier, threatening. E phrygian, 168 bpm.
// ---------------------------------------------------------------------------------------------
function elite(): Stereo {
  const s = new Song(184, 64, 3, 110), prog = ['Em', 'Em', 'F', 'Em', 'Em', 'Em', 'F', 'G', 'Am', 'Am', 'Em', 'Em', 'F', 'F', 'B', 'B'];
  let b = s.bus();
  s.pattern(b, kick, 'x.x.x.xxx.x.x.xx', 0.25, 50, { vel: 0.9 });
  s.pattern(b, snare, '....X.......X..x', 0.25, 1400, { vel: 0.65, pan: 0.05 });
  s.pattern(b, hat, 'xxoxxxoxxxoxxxox', 0.25, 8500, { vel: 0.22, pan: -0.25 });
  s.pattern(b, taiko, 'X...............................', 0.25, 62, { vel: 0.9, pan: 0.2 });
  s.roll(b, timp, 'B1', 56, 8, 0.2, 0.9, 0.25);
  s.add(b, -11, 0.08, 0.4, 0.5, 'peak');
  b = s.bus();
  const riff: [number, number, number?][] = [[0, 0.5], [0.5, 0.5], [1, 0.5], [2, 0.5], [2.5, 0.5], [3, 0.5, 3], [3.5, 0.5]];
  s.bass(b, brass, prog, 4, riff, { octave: 2, vel: 0.6, gate: 0.7 });
  s.bass(b, bassSaw, prog, 4, riff, { octave: 2, vel: 0.6, gate: 0.8 });
  s.add(b, -14, 0.1, 0.5);
  b = s.bus();
  // stabs with a semitone on top of the root: the dissonance that says "this one is dangerous"
  for (const start of [0, 2.5]) s.chords(b, stacc, prog, 4, { octave: 3, start, gate: 0.1, vel: 0.5, voicing: [0, 1, 2, 3] });
  for (let bar = 0; bar < 16; bar += 2) one(b, s, stacc, 'F4', bar * 4 + 2.5, 0.3, 0.4, 0.3);
  s.add(b, -18, 0.15, 0.5);
  b = s.bus();
  s.play(b, lead, part(`E5:1.5 F5:.5 E5 B4 | E5:1.5 G5:.5 F5 E5 | A5:1.5 G5:.5 F5 C5 | B4:3 -:1 | E5:1.5 F5:.5 E5 B4 | G5:1.5 A5:.5 B5:2 | C6 A5 F5 A5 | B5 G5 D6:2 |
    E6:1.5 D6:.5 C6 A5 | C6 B5 A5:2 | B5:1.5 A5:.5 G5 E5 | G5 F#5 E5:2 | F5 A5 C6 F6 | E6 C6 A5:2 | D#6:2 B5 F#5 | B5:.5 A5:.5 F#5:.5 D#5:.5 B4 -:1`, 64), { vel: 0.55, gate: 0.92, human: 0.3 });
  s.play(b, brass, part(`E5:1.5 F5:.5 E5 B4 | E5:1.5 G5:.5 F5 E5 | A5:1.5 G5:.5 F5 C5 | B4:3 -:1 | E5:1.5 F5:.5 E5 B4 | G5:1.5 A5:.5 B5:2 | C6 A5 F5 A5 | B5 G5 D6:2 |
    E6:1.5 D6:.5 C6 A5 | C6 B5 A5:2 | B5:1.5 A5:.5 G5 E5 | G5 F#5 E5:2 | F5 A5 C6 F6 | E6 C6 A5:2 | D#6:2 B5 F#5 | B5:.5 A5:.5 F#5:.5 D#5:.5 B4 -:1`, 64), { vel: 0.4, transpose: -12, gate: 0.9 });
  s.add(b, -14, 0.18, 0.5);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-011  Dungeon Exploration: suspenseful and mysterious. D minor with a flat second, 70 bpm.
// ---------------------------------------------------------------------------------------------
function dungeon(): Stereo {
  const s = new Song(70, 48, 7, 111), prog = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A', 'Bb', 'Gm', 'A', 'A'];
  let b = s.bus();
  s.arp(b, pizz, prog, 4, [0, 2, 3, 2, 4, 2, 3, 2], 0.5, { octave: 2, vel: 0.5, pan: -0.2 });
  s.add(b, -18, 0.35, 0.85);
  b = s.bus();
  one(b, s, pad, 'D2', 0, 24, 0.5);
  one(b, s, pad, 'D2', 24, 24, 0.5);
  s.add(b, -23, 0.3, 0.9);
  b = s.bus();
  s.play(b, celesta, part(`A5 -:1 F5:.5 E5:.5 D5 | -:2 C#5 D5 | -:1 Bb5 A5 F5 | E5:2 -:2 | A5 -:1 F5:.5 E5:.5 D5 | -:2 E5 F5 | G5:1.5 Bb5:.5 A5:2 | C#5:3 -:1 |
    D6 -:1 Bb5:.5 A5:.5 F5 | G5:2 D5:2 | E5 C#5 A4:2 | -:4`, 48), { vel: 0.5, pan: 0.25, human: 0.8 });
  s.add(b, -17, 0.5, 0.93);
  b = s.bus();
  for (const beat of [0, 16, 32]) one(b, s, timp, 'D2', beat, 1, 0.8);
  // a slow heartbeat, barely there
  for (let bar = 0; bar < 12; bar += 2) {
    one(b, s, kick, 'G1', bar * 4 + 2, 0.5, 0.35);
    one(b, s, kick, 'G1', bar * 4 + 2.6, 0.5, 0.25);
  }
  s.add(b, -16, 0.4, 0.9, 0.4, 'peak');
  b = s.bus();
  one(b, s, strings, 'A5', 32, 15, 0.3, 0.3);
  one(b, s, strings, 'Bb5', 40, 7, 0.25, -0.3);
  s.add(b, -30, 0.5, 0.95);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-012  Dungeon Boss: epic orchestral encounter. D minor, 144 bpm.
// ---------------------------------------------------------------------------------------------
function dungeonBoss(): Stereo {
  const s = new Song(144, 64, 4, 112), prog = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A', 'Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'];
  let b = s.bus();
  s.arp(b, stacc, prog, 4, [0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 0, 1, 0, 3, 2], 0.25, { octave: 3, vel: 0.5, accent: 1.3, human: 0.3 });
  s.add(b, -17, 0.2, 0.6);
  b = s.bus();
  s.pattern(b, taiko, 'X..x..x.x..x.x..', 0.25, 70, { vel: 0.7, pan: -0.15 });
  s.bass(b, timp, prog, 4, [[0, 1], [2, 1]], { octave: 2, vel: 0.7, pan: 0.15 });
  s.roll(b, timp, 'A1', 60, 4, 0.2, 0.9);
  crash(b, 0, 4200, 1, 0.5, 0.2);
  crash(b, 32 * s.beat, 4200, 1, 0.5, -0.2);
  s.add(b, -11, 0.15, 0.6, 0.4, 'peak');
  b = s.bus();
  s.bass(b, bassSaw, prog, 4, [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]], { octave: 2, vel: 0.6, gate: 0.8 });
  s.add(b, -16);
  b = s.bus();
  s.play(b, brass, part(`D4:2 F4 A4 | D5:3 A4 | Bb4:2 D5 F5 | E5:2 C5 G4 | D4:2 F4 A4 | D5:2 E5 F5 | F5:1.5 D5:.5 Bb4:2 | C#5:2 E5 A4 |
    G4 Bb4 D5:2 | G5:2 F5 D5 | F5:1.5 E5:.5 D5 A4 | D5:3 -:1 | Bb4 D5 F5 Bb5 | C5 E5 G5 C6 | A5:2 E5 C#5 | A4 C#5 E5 A5`, 64), { vel: 0.6, gate: 0.95 });
  s.add(b, -14, 0.25, 0.7);
  b = s.bus();
  s.chords(b, choirAh, prog, 4, { octave: 3, vel: 0.5 });
  s.add(b, -21, 0.35, 0.85);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-013  World Boss: large-scale cinematic battle. C minor, 120 bpm, slow harmony, huge drums.
// ---------------------------------------------------------------------------------------------
function worldBoss(): Stereo {
  const s = new Song(120, 64, 5, 113), prog = ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Eb', 'Fm', 'G'];
  let b = s.bus();
  s.pattern(b, taiko, 'X.....x.X...x.x.', 0.25, 58, { vel: 0.9, pan: -0.2 });
  s.pattern(b, taiko, '..x.x....x.x....', 0.25, 112, { vel: 0.5, pan: 0.35 });
  s.roll(b, timp, 'G1', 28, 4, 0.2, 0.9);
  s.roll(b, timp, 'G1', 60, 4, 0.2, 1);
  crash(b, 0, 4000, 1, 0.6, 0.2);
  crash(b, 32 * s.beat, 4000, 1, 0.6, -0.2);
  s.add(b, -10, 0.2, 0.7, 0.4, 'peak');
  b = s.bus();
  s.arp(b, stacc, prog, 8, [0], 0.25, { octave: 2, vel: 0.5, accent: 1.4, human: 0.3 });
  s.add(b, -19, 0.2, 0.6);
  b = s.bus();
  s.bass(b, bassSaw, prog, 8, [[0, 7.8]], { octave: 2, vel: 0.6, gate: 1 });
  s.add(b, -17);
  b = s.bus();
  s.chords(b, choirAh, prog, 8, { octave: 3, vel: 0.5, voicing: [0, 1, 2, 3] });
  s.add(b, -18, 0.4, 0.9);
  b = s.bus();
  s.play(b, brass, part(`C4:1.5 G4:.5 C5:2 | Eb5:2 D5 C5 | Ab4:1.5 C5:.5 Eb5:2 | Ab5:3 G5 | F5:2 C5 Ab4 | F4:2 Ab4 C5 | D5:2 B4 G4 | D5 G5 B5:2 |
    C6:2 G5 Eb5 | C5:2 Eb5 G5 | Bb5:2 G5 Eb5 | Bb4:2 Eb5 G5 | Ab5:1.5 G5:.5 F5:2 | C6:2 Ab5:2 | G5 B5 D6:2 | G5:.5 F5:.5 D5:.5 B4:.5 G4:2`, 64), { vel: 0.6, gate: 0.97 });
  s.play(b, horn, part(`C4:1.5 G4:.5 C5:2 | Eb5:2 D5 C5 | Ab4:1.5 C5:.5 Eb5:2 | Ab5:3 G5 | F5:2 C5 Ab4 | F4:2 Ab4 C5 | D5:2 B4 G4 | D5 G5 B5:2 |
    C6:2 G5 Eb5 | C5:2 Eb5 G5 | Bb5:2 G5 Eb5 | Bb4:2 Eb5 G5 | Ab5:1.5 G5:.5 F5:2 | C6:2 Ab5:2 | G5 B5 D6:2 | G5:.5 F5:.5 D5:.5 B4:.5 G4:2`, 64), { vel: 0.5, transpose: -12, gate: 0.97, pan: -0.2 });
  s.add(b, -13, 0.3, 0.85);
  return s.render(true);
}

// ---------------------------------------------------------------------------------------------
// BGM-014  Victory: a short triumphant fanfare (one-shot). C major, 132 bpm.
// ---------------------------------------------------------------------------------------------
function victory(): Stereo {
  const s = new Song(132, 8, 4, 114);
  let b = s.bus();
  s.play(b, brass, part(`G4:.5 C5:.5 E5:.5 G5:1.5 E5:.5 G5:.5 C6:4`, 8), { vel: 0.7, gate: 0.92, human: 0.2 });
  s.play(b, brass, part(`E4:.5 G4:.5 C5:.5 E5:1.5 C5:.5 E5:.5 [E5,G5]:4`, 8), { vel: 0.5, gate: 0.92, human: 0.2, pan: -0.25 });
  s.add(b, -13, 0.3, 0.8);
  b = s.bus();
  s.play(b, strings, [{ beat: 0, dur: 2, notes: [48, 55, 64] }, { beat: 2, dur: 1, notes: [53, 57, 65] }, { beat: 3, dur: 1, notes: [55, 59, 67] }, { beat: 4, dur: 4, notes: [48, 55, 64, 72] }], { vel: 0.5 });
  s.add(b, -19, 0.35, 0.85);
  b = s.bus();
  s.roll(b, timp, 'G2', 3, 1, 0.3, 0.9);
  one(b, s, timp, 'C2', 4, 2, 1);
  one(b, s, timp, 'C2', 0, 1, 0.7);
  crash(b, 4 * s.beat, 4200, 1, 0.7, 0);
  s.add(b, -11, 0.25, 0.8, 0.4, 'peak');
  b = s.bus();
  for (const [note, beat] of [['C6', 4], ['E6', 4.25], ['G6', 4.5], ['C7', 4.75]] as const) one(b, s, glock, note, beat, 1, 0.5, 0.3);
  s.add(b, -24, 0.4, 0.85);
  return s.render(false);
}

// ---------------------------------------------------------------------------------------------
// BGM-015  Defeat: emotional but restrained (one-shot). A minor, 60 bpm.
// ---------------------------------------------------------------------------------------------
function defeat(): Stereo {
  const s = new Song(60, 16, 6, 115), prog = ['Am', 'F', 'E', 'Am'];
  let b = s.bus();
  s.play(b, pno, part(`E5:2 D5 C5 | B4:2 A4:2 | C5:2 B4 G#4 | [A3,E4,A4]:4`, 16), { vel: 0.6, gate: 1, human: 1 });
  s.arp(b, pnoSoft, prog.slice(0, 3), 4, [0, 2, 3, 2], 1, { octave: 2, vel: 0.4, pan: -0.15 });
  s.add(b, -15, 0.5, 0.92);
  b = s.bus();
  s.chords(b, strings, prog, 4, { octave: 3, vel: 0.4, gate: 1 });
  s.add(b, -22, 0.45, 0.92);
  return s.render(false);
}

// ---------------------------------------------------------------------------------------------
// BGM-016  Special Event: a festive jig. D major, 6/8 at 120 dotted-quarters per minute.
// ---------------------------------------------------------------------------------------------
function festival(): Stereo {
  // one beat = one eighth note, six to the bar
  const s = new Song(360, 192, 3, 116);
  const A = ['D', 'D', 'G', 'A', 'D', 'Bm', 'G', 'A'], B = ['G', 'D', 'A', 'D', 'G', 'D', 'Em', 'A', 'G', 'D', 'A', 'Bm', 'G', 'A', 'D', 'D'], prog = [...A, ...A, ...B];
  const tuneA = (last: string) => `D5 F#5 A5 D6 A5 F#5 | E5 F#5 E5 D5:2 A4 | B4 D5 G5 B5 G5 D5 | C#5 E5 A5 E5:2 C#5 | D5 F#5 A5 D6 A5 F#5 | B5 A5 F#5 D5:2 F#5 | G5 F#5 E5 D5 E5 F#5 | ${last}`;
  const tune = `${tuneA('E5:3 A4:3')} | ${tuneA('A5:3 E5:3')} |
    B5 G5 B5 D6:2 B5 | A5 F#5 A5 D6:2 A5 | G5 E5 C#5 A4 C#5 E5 | F#5:3 D5:3 | B5 G5 B5 D6:2 B5 | A5 F#5 D5 F#5 A5 D6 | E6 D6 B5 G5 B5 E5 | A5:3 C#6:3 |
    D6 B5 G5 B5 D6 G6 | F#6 D6 A5 D6:2 A5 | E6 C#6 A5 C#6 E6 A5 | D6 B5 F#5 B5:2 F#5 | G5 B5 D6 B5 G5 D5 | E5 A5 C#6 E6:2 C#6 | D6 A5 F#5 D5 F#5 A5 | D5:3 -:3`;
  let b = s.bus();
  s.play(b, fiddle, part(tune, 192), { vel: 0.6, gate: 0.85, human: 0.4, beatsPerBar: 6, accent: 1.2, pan: 0.15 });
  s.add(b, -14, 0.2, 0.55);
  b = s.bus();
  s.play(b, whistle, part(tune, 192).filter((e) => e.beat >= 96), { vel: 0.5, gate: 0.85, transpose: 12, pan: -0.3 });
  s.add(b, -22, 0.25, 0.6);
  b = s.bus();
  for (const start of [0, 3]) s.chords(b, lute, prog, 6, { octave: 3, start, gate: 0.5, vel: 0.5, pan: -0.2, voicing: [0, 1, 2, 3] });
  s.add(b, -17, 0.15, 0.5);
  b = s.bus();
  s.bass(b, bassSoft, prog, 6, [[0, 2.6], [3, 2.6, 7]], { octave: 2 });
  s.add(b, -19);
  b = s.bus();
  s.pattern(b, tamb, 'x..x.x', 1, 6500, { vel: 0.5, pan: 0.3 });
  s.pattern(b, clap, '...x..', 1, 1300, { vel: 0.6, pan: -0.1, start: 96 });
  s.pattern(b, kick, 'x.....', 1, 60, { vel: 0.7 });
  s.add(b, -15, 0.1, 0.4, 0.4, 'peak');
  return s.render(true);
}

/** Track id -> renderer. */
export const MUSIC: Record<string, () => Stereo> = {
  [BGM.MENU]: mainMenu, [BGM.CITY]: eldoria, [BGM.VILLAGE]: village, [BGM.FOREST]: verdant, [BGM.ASHEN]: ashen, [BGM.FROST]: frostveil,
  [BGM.MOOR]: dreadmoor, [BGM.ASTRAL]: astral, [BGM.COMBAT]: combat, [BGM.ELITE]: elite, [BGM.DUNGEON]: dungeon, [BGM.DUNGEON_BOSS]: dungeonBoss,
  [BGM.WORLD_BOSS]: worldBoss, [BGM.VICTORY]: victory, [BGM.DEFEAT]: defeat, [BGM.EVENT]: festival,
};
