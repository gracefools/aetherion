// A small software synthesiser used to render the game's TEMPORARY placeholder audio.
// Everything is generated from arithmetic: there are no samples, recordings or third-party
// sounds in here, so the output is original by construction. Deterministic (seeded noise).
export const SR = 44100;
export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}
export const stereo = (seconds: number): Stereo => {
  const n = Math.ceil(seconds * SR);
  return { l: new Float32Array(n), r: new Float32Array(n) };
};
export const mono = (seconds: number) => new Float32Array(Math.ceil(seconds * SR));

export function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------------------------
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "A4" -> 69, "C#3", "Bb2". */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], '5': [0, 7, 12],
  '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], add9: [0, 4, 7, 14], m9: [0, 3, 7, 14], m6: [0, 3, 7, 9],
};
/** "Dm", "Bb", "F#m7", "Asus4" -> midi notes with the root in the given octave. */
export function chord(name: string, octave = 3): number[] {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  if (!m || !(m[2] in QUALITY)) throw new Error(`bad chord "${name}"`);
  const root = midi(m[1] + octave);
  return QUALITY[m[2]].map((s) => root + s);
}

export interface Ev {
  beat: number;
  dur: number;
  notes: number[]; // midi; empty = rest
}
/**
 * Parses a line of music: tokens "E4:1", "F#4:.5", "-:2" (rest), "[C4,E4,G4]:2" (chord).
 * The number is the length in beats (default 1). Returns events on a running beat clock.
 */
export function line(src: string, start = 0): Ev[] {
  const out: Ev[] = [];
  let beat = start;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '|') continue; // bar lines are for the reader
    const m = /^(\[[^\]]+\]|[A-G][#b]?-?\d|-)(?::([\d.]+))?$/.exec(tok);
    if (!m) throw new Error(`bad token "${tok}"`);
    const dur = m[2] ? Number(m[2]) : 1;
    const notes = m[1] === '-' ? [] : m[1][0] === '[' ? m[1].slice(1, -1).split(',').map(midi) : [midi(m[1])];
    if (notes.length) out.push({ beat, dur, notes });
    beat += dur;
  }
  return out;
}
/** Total length in beats of a line (for checking that parts line up). */
export const beatsOf = (src: string) => src.trim().split(/\s+/).filter((t) => t !== '|').reduce((n, t) => n + (t.includes(':') ? Number(t.split(':')[1]) : 1), 0);

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------
/** Zero-delay state-variable filter. `mode`: 0 low, 1 band, 2 high. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  constructor(fc = 1000, q = 0.707) {
    this.set(fc, q);
  }
  set(fc: number, q = 0.707) {
    const g = Math.tan(Math.PI * clamp(fc, 12, SR * 0.45) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(x: number, mode = 0): number {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === 0 ? v2 : mode === 1 ? v1 : x - this.k * v1 - v2;
  }
}
/** Filters a mono signal. `fc` may be a function of time (seconds) for sweeps. */
export function filt(x: Float32Array, mode: 0 | 1 | 2, fc: number | ((t: number) => number), q = 0.707): Float32Array {
  const f = new Svf(typeof fc === 'number' ? fc : fc(0), q), out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    if (typeof fc !== 'number' && (i & 15) === 0) f.set(fc(i / SR), q);
    out[i] = f.run(x[i], mode);
  }
  return out;
}
export const lp = (x: Float32Array, fc: number | ((t: number) => number), q?: number) => filt(x, 0, fc, q);
export const bp = (x: Float32Array, fc: number | ((t: number) => number), q?: number) => filt(x, 1, fc, q);
export const hp = (x: Float32Array, fc: number | ((t: number) => number), q?: number) => filt(x, 2, fc, q);

// ---------------------------------------------------------------------------------------------
// Sources for sound effects (mono)
// ---------------------------------------------------------------------------------------------
export function noise(seconds: number, seed: number, color: 'white' | 'pink' | 'brown' = 'white'): Float32Array {
  const out = mono(seconds), r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') out[i] = w;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}
export type Wave = 'sine' | 'saw' | 'square' | 'tri';
function blep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
function osc(wave: Wave, ph: number, dt: number): number {
  switch (wave) {
    case 'sine': return Math.sin(TAU * ph);
    case 'saw': return 2 * ph - 1 - blep(ph, dt);
    case 'square': return (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
    case 'tri': return 4 * Math.abs(ph - 0.5) - 1;
  }
}
/** A tone whose frequency may change over time. */
export function tone(seconds: number, f: number | ((t: number) => number), wave: Wave = 'sine'): Float32Array {
  const out = mono(seconds);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const fr = typeof f === 'number' ? f : f(i / SR), dt = fr / SR;
    out[i] = osc(wave, ph, dt);
    ph += dt;
    ph -= Math.floor(ph);
  }
  return out;
}
/** Multiplies a signal by an envelope function of time (seconds). */
export function shape(x: Float32Array, env: (t: number) => number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * env(i / SR);
  return out;
}
/** Attack-then-exponential-decay envelope. */
export const ad = (attack: number, decay: number) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));
/** Smooth bump from 0 to 1 and back over `len` seconds, peaking at `peak` (0..1 of len). */
export const bump = (len: number, peak = 0.5, sharp = 1) => (t: number) => {
  if (t <= 0 || t >= len) return 0;
  const k = t / len;
  return Math.pow(k < peak ? k / peak : (1 - k) / (1 - peak), sharp);
};
export const expo = (from: number, to: number, len: number) => (t: number) => from * Math.pow(to / from, clamp(t / len, 0, 1));
export function mixMono(len: number, ...parts: [Float32Array, number, number?][]): Float32Array {
  const out = mono(len);
  for (const [x, gain, at = 0] of parts) {
    const o = Math.round(at * SR);
    for (let i = 0; i < x.length && o + i < out.length; i++) out[o + i] += x[i] * gain;
  }
  return out;
}
/** A cheap mono reverb for sound effects. */
export function room(x: Float32Array, mix = 0.25, size = 0.5, tail = 0.4): Float32Array {
  const out = new Float32Array(x.length + Math.ceil(tail * SR));
  const st: Stereo = { l: new Float32Array(out.length), r: new Float32Array(out.length) };
  st.l.set(x);
  st.r.set(x);
  reverb(st, size, 0.5, mix);
  for (let i = 0; i < out.length; i++) out[i] = (st.l[i] + st.r[i]) * 0.5;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Instruments (write a note into a stereo buffer)
// ---------------------------------------------------------------------------------------------
/** out, start (s), frequency (Hz), length (s), velocity 0..1, pan -1..1 */
export type Inst = (out: Stereo, t: number, f: number, dur: number, vel: number, pan: number) => void;
const panL = (p: number) => Math.cos(((p + 1) * Math.PI) / 4);
const panR = (p: number) => Math.sin(((p + 1) * Math.PI) / 4);
let noteSeed = 1;

export interface SubOpts {
  wave?: Wave;
  voices?: number;
  detune?: number; // cents between voices
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  cutoff?: number;
  /** Extra cutoff (Hz) at the envelope peak. */
  cutEnv?: number;
  /** Cutoff follows pitch: added `track * f`. */
  track?: number;
  q?: number;
  vib?: number; // cents
  vibRate?: number;
  vibDelay?: number;
  gain?: number;
  /** Vowel-like resonances [Hz, gain] replacing the low-pass (choir). */
  formants?: [number, number][];
  spread?: number; // stereo width of the voices 0..1
  sub?: number; // level of a sine one octave down
}
/** Subtractive voice: detuned oscillators through a low-pass (or formant bank) with an ADSR. */
export function sub(o: SubOpts = {}): Inst {
  const { wave = 'saw', voices = 1, detune = 8, a = 0.01, d = 0.1, s = 0.8, r = 0.15, cutoff = 2400, cutEnv = 0, track = 0, q = 0.8, vib = 0, vibRate = 5.2, vibDelay = 0.25, gain = 1, formants, spread = 0.6, sub: subLevel = 0 } = o;
  return (out, t, f, dur, vel, pan) => {
    const start = Math.round(t * SR), n = Math.ceil((dur + r) * SR), rnd = rng(noteSeed++ * 7919);
    const ph = new Float64Array(voices), mul = new Float64Array(voices), gL = new Float64Array(voices), gR = new Float64Array(voices);
    for (let v = 0; v < voices; v++) {
      ph[v] = rnd();
      mul[v] = Math.pow(2, ((voices === 1 ? 0 : (v / (voices - 1) - 0.5) * 2) * detune) / 1200);
      const vp = voices === 1 ? pan : clamp(pan + (v / (voices - 1) - 0.5) * 2 * spread, -1, 1);
      gL[v] = panL(vp);
      gR[v] = panR(vp);
    }
    const sL = panL(pan), sR = panR(pan);
    const lvl = (tt: number) => (tt < a ? tt / a : s + (1 - s) * Math.exp(-(tt - a) / d));
    const held = lvl(dur);
    const fl = new Svf(cutoff, q), fr = new Svf(cutoff, q);
    const bank = formants?.map(([fc]) => [new Svf(fc, 6), new Svf(fc, 6)] as const);
    let subPh = 0;
    const amp = (vel * gain) / Math.sqrt(voices);
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR;
      const env = ts < dur ? lvl(ts) : held * Math.max(0, 1 - (ts - dur) / r) ** 2;
      const vb = vib && ts > vibDelay ? Math.pow(2, (Math.sin(TAU * vibRate * ts) * vib * Math.min(1, (ts - vibDelay) / 0.3)) / 1200) : 1;
      let L = 0, R = 0;
      for (let v = 0; v < voices; v++) {
        const dt = (f * mul[v] * vb) / SR, x = osc(wave, ph[v], dt);
        ph[v] += dt;
        if (ph[v] >= 1) ph[v] -= 1;
        L += x * gL[v];
        R += x * gR[v];
      }
      if (subLevel) {
        const x = Math.sin(TAU * subPh) * subLevel * voices;
        subPh += f / 2 / SR;
        L += x * sL;
        R += x * sR;
      }
      if (bank) {
        let fl2 = 0, fr2 = 0;
        for (let b = 0; b < bank.length; b++) {
          fl2 += bank[b][0].run(L, 1) * formants![b][1];
          fr2 += bank[b][1].run(R, 1) * formants![b][1];
        }
        L = fl2;
        R = fr2;
      } else {
        if ((i & 15) === 0) {
          const fc = cutoff + cutEnv * env + track * f;
          fl.set(fc, q);
          fr.set(fc, q);
        }
        L = fl.run(L);
        R = fr.run(R);
      }
      out.l[start + i] += L * env * amp;
      out.r[start + i] += R * env * amp;
    }
  };
}

/** Plucked string (Karplus-Strong): lute, harp, guitar, pizzicato. */
export function pluck(o: { bright?: number; sustain?: number; gain?: number } = {}): Inst {
  const { bright = 0.6, sustain = 0.996, gain = 1 } = o;
  return (out, t, f, dur, vel, pan) => {
    const start = Math.round(t * SR), N = Math.max(2, Math.round(SR / f)), buf = new Float32Array(N), rnd = rng(noteSeed++ * 104729);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const w = rnd() * 2 - 1;
      prev = prev + (w - prev) * (0.15 + 0.85 * bright);
      buf[i] = prev;
    }
    const n = Math.ceil((dur + 1.6) * SR), gl = panL(pan) * vel * gain, gr = panR(pan) * vel * gain, off = Math.round(dur * SR);
    let idx = 0;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const y = buf[idx], nx = buf[idx + 1 === N ? 0 : idx + 1];
      // after the note is released the string is damped quickly
      buf[idx] = (y + nx) * 0.5 * (i < off ? sustain : sustain * 0.985);
      idx = idx + 1 === N ? 0 : idx + 1;
      const fade = i < 40 ? i / 40 : 1;
      out.l[start + i] += y * gl * fade;
      out.r[start + i] += y * gr * fade;
    }
  };
}

/** Breathy flute / whistle. */
export function flute(o: { breath?: number; gain?: number; vib?: number } = {}): Inst {
  const { breath = 0.07, gain = 1, vib = 9 } = o;
  return (out, t, f, dur, vel, pan) => {
    const start = Math.round(t * SR), r = 0.14, n = Math.ceil((dur + r) * SR), rnd = rng(noteSeed++ * 31337), nf = new Svf(Math.min(9000, f * 3), 1.2);
    const gl = panL(pan) * vel * gain, gr = panR(pan) * vel * gain;
    let ph = 0;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR, a = 0.07;
      const env = ts < a ? (ts / a) ** 1.5 : ts < dur ? 1 : Math.max(0, 1 - (ts - dur) / r);
      const vb = ts > 0.22 ? Math.pow(2, (Math.sin(TAU * 5 * ts) * vib * Math.min(1, (ts - 0.22) / 0.35)) / 1200) : 1;
      ph += (f * vb) / SR;
      const p = TAU * ph;
      const air = nf.run(rnd() * 2 - 1, 1) * breath * (1 + 2.5 * Math.exp(-ts / 0.05));
      const x = (Math.sin(p) + 0.28 * Math.sin(2 * p) + 0.07 * Math.sin(3 * p) + air) * env;
      out.l[start + i] += x * gl;
      out.r[start + i] += x * gr;
    }
  };
}

/** Struck-string piano: decaying, slightly inharmonic partials plus a hammer thump. */
export function piano(o: { gain?: number; soft?: number } = {}): Inst {
  const { gain = 1, soft = 0 } = o;
  return (out, t, f, dur, vel, pan) => {
    const start = Math.round(t * SR), r = 0.3, n = Math.ceil((dur + r + 0.4) * SR), P = 9, B = 0.0004;
    const w = new Float64Array(P), dec = new Float64Array(P), ampl = new Float64Array(P);
    for (let k = 0; k < P; k++) {
      const h = k + 1, fk = f * h * Math.sqrt(1 + B * h * h);
      w[k] = fk < SR * 0.45 ? (TAU * fk) / SR : 0;
      dec[k] = (0.7 + 0.55 * h) * (0.6 + f / 520);
      ampl[k] = (1 / Math.pow(h, 1.15 + soft)) * (h === 1 ? 1 : 0.8);
    }
    const gl = panL(pan) * vel * gain * 0.5, gr = panR(pan) * vel * gain * 0.5, rnd = rng(noteSeed++ * 7);
    let hammer = 0;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR, rel = ts < dur ? 1 : Math.exp(-(ts - dur) / 0.09), att = ts < 0.004 ? ts / 0.004 : 1;
      let x = 0;
      for (let k = 0; k < P; k++) if (w[k]) x += Math.sin(w[k] * i) * ampl[k] * Math.exp(-ts * dec[k]);
      hammer += ((rnd() * 2 - 1) * Math.exp(-ts / 0.006) - hammer) * 0.25;
      x = (x + hammer * 0.6) * rel * att;
      out.l[start + i] += x * gl;
      out.r[start + i] += x * gr;
    }
  };
}

/** FM bell / celesta / glockenspiel. `ratio` sets the timbre, `tau` the ring time. */
export function bell(o: { ratio?: number; index?: number; tau?: number; gain?: number } = {}): Inst {
  const { ratio = 3.5, index = 2.2, tau = 0.9, gain = 1 } = o;
  return (out, t, f, dur, vel, pan) => {
    const start = Math.round(t * SR), n = Math.ceil(Math.max(dur, tau * 4) * SR), gl = panL(pan) * vel * gain * 0.5, gr = panR(pan) * vel * gain * 0.5;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR, e = Math.exp(-ts / tau) * (ts < 0.003 ? ts / 0.003 : 1);
      const x = Math.sin(TAU * f * ts + index * Math.exp(-ts / (tau * 0.4)) * Math.sin(TAU * f * ratio * ts)) * e;
      out.l[start + i] += x * gl;
      out.r[start + i] += x * gr;
    }
  };
}

/** Pitched drum: timpani (long, tonal) or taiko (short, with a slap). `f` is the pitch. */
export function drum(o: { decay?: number; slap?: number; drop?: number; gain?: number; tone2?: number } = {}): Inst {
  const { decay = 0.6, slap = 0.3, drop = 1.6, gain = 1, tone2 = 0.25 } = o;
  return (out, t, f, _dur, vel, pan) => {
    const start = Math.round(t * SR), n = Math.ceil(decay * 5 * SR), rnd = rng(noteSeed++ * 13), nf = new Svf(Math.min(4000, f * 9), 0.9);
    const gl = panL(pan) * vel * gain, gr = panR(pan) * vel * gain;
    let ph = 0;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR, fr = f * (1 + (drop - 1) * Math.exp(-ts / 0.018));
      ph += fr / SR;
      const body = (Math.sin(TAU * ph) + tone2 * Math.sin(TAU * ph * 1.5)) * Math.exp(-ts / decay);
      const sl = nf.run(rnd() * 2 - 1, 0) * slap * Math.exp(-ts / 0.03);
      const x = (body + sl) * (ts < 0.002 ? ts / 0.002 : 1);
      out.l[start + i] += x * gl;
      out.r[start + i] += x * gr;
    }
  };
}

/** Unpitched noise percussion: snare, hats, shaker, tambourine, clap, cymbal. `f` is the filter frequency. */
export function hit(o: { decay?: number; mode?: 0 | 1 | 2; q?: number; gain?: number; tone?: number; attack?: number; bursts?: number } = {}): Inst {
  const { decay = 0.1, mode = 2, q = 0.8, gain = 1, tone: toneLevel = 0, attack = 0.001, bursts = 1 } = o;
  return (out, t, f, _dur, vel, pan) => {
    const start = Math.round(t * SR), n = Math.ceil((decay * 6 + attack + bursts * 0.012) * SR), rnd = rng(noteSeed++ * 17), nf = new Svf(f, q);
    const gl = panL(pan) * vel * gain, gr = panR(pan) * vel * gain;
    for (let i = 0; i < n && start + i < out.l.length; i++) {
      const ts = i / SR;
      let env = ts < attack ? ts / attack : Math.exp(-(ts - attack) / decay);
      if (bursts > 1 && ts < (bursts - 1) * 0.012) env = Math.exp(-(ts % 0.012) / 0.004); // a clap is several quick bursts
      let x = nf.run(rnd() * 2 - 1, mode) * env;
      if (toneLevel) x += Math.sin(TAU * 185 * ts) * toneLevel * Math.exp(-ts / 0.07);
      out.l[start + i] += x * gl;
      out.r[start + i] += x * gr;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------------------------
export interface PlayOpts {
  vel?: number;
  pan?: number;
  transpose?: number; // semitones
  /** Fraction of the written length the note sounds for. */
  gate?: number;
  /** Timing and loudness variation (0 = mechanical). */
  human?: number;
  /** Accent: velocity multiplier for notes on the bar's first beat. */
  accent?: number;
  beatsPerBar?: number;
}
export class Song {
  readonly beat: number; // seconds
  readonly loopSec: number;
  readonly out: Stereo;
  private rnd: () => number;
  constructor(readonly bpm: number, readonly beats: number, tail = 6, seed = 1) {
    this.beat = 60 / bpm;
    this.loopSec = beats * this.beat;
    this.out = stereo(this.loopSec + tail);
    this.rnd = rng(seed);
  }
  bus(): Stereo {
    return { l: new Float32Array(this.out.l.length), r: new Float32Array(this.out.r.length) };
  }
  /** Plays events (see `line`) on an instrument into a bus. */
  play(bus: Stereo, inst: Inst, evs: Ev[] | string, o: PlayOpts = {}) {
    const { vel = 0.5, pan = 0, transpose = 0, gate = 0.95, human = 0.5, accent = 1, beatsPerBar = 4 } = o;
    for (const e of typeof evs === 'string' ? line(evs) : evs) {
      const jitter = (this.rnd() - 0.5) * 0.012 * human, v = vel * (1 + (this.rnd() - 0.5) * 0.25 * human) * (accent !== 1 && Math.abs(e.beat % beatsPerBar) < 1e-6 ? accent : 1);
      e.notes.forEach((m, k) => inst(bus, Math.max(0, e.beat * this.beat + jitter + k * 0.004 * human), hz(m + transpose), e.dur * this.beat * gate, v, pan));
    }
  }
  /** One chord per entry, each lasting `beats`. `voicing` picks/extends chord tones by index. */
  chords(bus: Stereo, inst: Inst, prog: string[], beats: number, o: PlayOpts & { octave?: number; voicing?: number[]; start?: number } = {}) {
    const { octave = 3, voicing, start = 0 } = o;
    const evs: Ev[] = prog.map((name, i) => {
      const c = chord(name, octave);
      return { beat: start + i * beats, dur: beats, notes: voicing ? voicing.map((k) => c[k % c.length] + 12 * Math.floor(k / c.length)) : c };
    });
    this.play(bus, inst, evs, o);
  }
  /** Arpeggio: for each chord, the pattern of chord-tone indices is played at `step` beats per note. */
  arp(bus: Stereo, inst: Inst, prog: string[], beats: number, pattern: number[], step: number, o: PlayOpts & { octave?: number; start?: number } = {}) {
    const { octave = 3, start = 0 } = o, evs: Ev[] = [];
    prog.forEach((name, i) => {
      const c = chord(name, octave);
      for (let k = 0; k * step < beats - 1e-6; k++) {
        const idx = pattern[k % pattern.length];
        if (idx < 0) continue; // rest
        evs.push({ beat: start + i * beats + k * step, dur: step, notes: [c[idx % c.length] + 12 * Math.floor(idx / c.length)] });
      }
    });
    this.play(bus, inst, evs, o);
  }
  /** Root-note bass line: `rhythm` is a list of [beat offset, length, semitone offset from the root]. */
  bass(bus: Stereo, inst: Inst, prog: string[], beats: number, rhythm: [number, number, number?][], o: PlayOpts & { octave?: number; start?: number } = {}) {
    const { octave = 2, start = 0 } = o, evs: Ev[] = [];
    prog.forEach((name, i) => {
      const root = chord(name, octave)[0];
      for (const [b, d, semi = 0] of rhythm) evs.push({ beat: start + i * beats + b, dur: d, notes: [root + semi] });
    });
    this.play(bus, inst, evs, o);
  }
  /** Drum pattern: one character per step ("x" hit, "X" accent, "o" soft, "." rest), repeated to fill `bars`. */
  pattern(bus: Stereo, inst: Inst, pat: string, step: number, f: number, o: PlayOpts & { start?: number; beats?: number } = {}) {
    const { vel = 0.5, pan = 0, start = 0, beats = this.beats - start, human = 0.4 } = o, p = pat.replace(/\s/g, '');
    for (let k = 0; k * step < beats - 1e-6; k++) {
      const c = p[k % p.length];
      if (c === '.') continue;
      const v = vel * (c === 'X' ? 1.35 : c === 'o' ? 0.5 : 1) * (1 + (this.rnd() - 0.5) * 0.2 * human);
      inst(bus, Math.max(0, (start + k * step) * this.beat + (this.rnd() - 0.5) * 0.006 * human), f, step * this.beat, v, pan);
    }
  }
  /** A crescendo or diminuendo of repeated strokes (timpani and snare rolls). */
  roll(bus: Stereo, inst: Inst, note: string, start: number, beats: number, from: number, to: number, step = 0.125, pan = 0) {
    const n = Math.round(beats / step);
    for (let k = 0; k < n; k++) inst(bus, (start + k * step) * this.beat, hz(midi(note)), step * this.beat, from + ((to - from) * k) / Math.max(1, n - 1), pan);
  }
  /**
   * Mixes a bus into the song at a stated level, optionally through the reverb. The bus is
   * measured first, so `db` is the part's loudness in the mix whatever the instrument's raw
   * output is: 'rms' for sustained parts (level while sounding), 'peak' for percussion.
   */
  add(bus: Stereo, db: number, wet = 0, size = 0.7, damp = 0.4, by: 'rms' | 'peak' = 'rms') {
    const lv = by === 'peak' ? levels(bus).peakDb : activeRmsDb(bus);
    if (!Number.isFinite(lv) || lv < -120) return; // an empty bus
    const gain = Math.pow(10, (db - lv) / 20);
    if (wet > 0) reverb(bus, size, damp, wet);
    for (let i = 0; i < this.out.l.length; i++) {
      this.out.l[i] += bus.l[i] * gain;
      this.out.r[i] += bus.r[i] * gain;
    }
  }
  /** Finished audio. Looping songs have their tail folded back onto the start, so the loop is seamless. */
  render(loop: boolean, rmsDb = -20): Stereo {
    return finalize(loop ? fold(this.out, Math.round(this.loopSec * SR)) : trimTail(this.out), rmsDb, loop);
  }
}

// ---------------------------------------------------------------------------------------------
// Effects and mastering
// ---------------------------------------------------------------------------------------------
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], ALLPASS = [556, 441, 341, 225];
/** Stereo reverb (Schroeder/Moorer comb + all-pass network). `wet` is added to the dry signal in place. */
export function reverb(b: Stereo, size = 0.7, damp = 0.4, wet = 0.3) {
  const fb = 0.7 + 0.28 * clamp(size, 0, 1), d1 = damp * 0.4, d2 = 1 - d1, n = b.l.length;
  const wl = new Float32Array(n), wr = new Float32Array(n);
  for (let ch = 0; ch < 2; ch++) {
    const w = ch ? wr : wl, spread = ch ? 23 : 0, acc = new Float32Array(n);
    for (const len of COMBS) {
      const buf = new Float32Array(len + spread);
      let idx = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * d2 + store * d1;
        buf[idx] = (b.l[i] + b.r[i]) * 0.015 + store * fb;
        if (++idx === buf.length) idx = 0;
        acc[i] += y;
      }
    }
    for (const len of ALLPASS) {
      const buf = new Float32Array(len + spread);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx], x = acc[i];
        buf[idx] = x + y * 0.5;
        if (++idx === buf.length) idx = 0;
        acc[i] = y - x;
      }
    }
    w.set(acc);
  }
  for (let i = 0; i < n; i++) {
    b.l[i] += (wl[i] * 0.85 + wr[i] * 0.15) * wet * 3;
    b.r[i] += (wr[i] * 0.85 + wl[i] * 0.15) * wet * 3;
  }
}
/** Folds everything after `n` samples back onto the start (notes and reverb ringing across the loop point). */
export function fold(b: Stereo, n: number): Stereo {
  const out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < b.l.length; i++) {
    out.l[i % n] += b.l[i];
    out.r[i % n] += b.r[i];
  }
  return out;
}
/** Seamless loop for stationary sound (ambience): the last `xf` seconds are crossfaded into the first. */
export function crossLoop(b: Stereo, loopSec: number, xf = 1.5): Stereo {
  const n = Math.round(loopSec * SR), x = Math.round(xf * SR), out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    if (i < x) {
      const k = i / x, a = Math.sin((k * Math.PI) / 2), c = Math.cos((k * Math.PI) / 2);
      out.l[i] = b.l[i] * a + (b.l[n + i] ?? 0) * c;
      out.r[i] = b.r[i] * a + (b.r[n + i] ?? 0) * c;
    } else {
      out.l[i] = b.l[i];
      out.r[i] = b.r[i];
    }
  }
  return out;
}
export function trimTail(b: Stereo, floor = 0.0006): Stereo {
  let end = b.l.length;
  while (end > 1 && Math.abs(b.l[end - 1]) < floor && Math.abs(b.r[end - 1]) < floor) end--;
  end = Math.min(b.l.length, end + Math.round(0.03 * SR));
  return { l: b.l.slice(0, end), r: b.r.slice(0, end) };
}
export interface Levels {
  peakDb: number;
  rmsDb: number;
}
export function levels(b: Stereo): Levels {
  let peak = 0, sum = 0;
  for (let i = 0; i < b.l.length; i++) {
    const a = Math.abs(b.l[i]), c = Math.abs(b.r[i]);
    if (a > peak) peak = a;
    if (c > peak) peak = c;
    sum += b.l[i] * b.l[i] + b.r[i] * b.r[i];
  }
  return { peakDb: 20 * Math.log10(peak || 1e-9), rmsDb: 10 * Math.log10(sum / (2 * b.l.length) || 1e-12) };
}
/** RMS of the parts of a signal that are actually sounding (above 2% of its peak), in dB. */
export function activeRmsDb(b: Stereo): number {
  let peak = 0;
  for (let i = 0; i < b.l.length; i++) peak = Math.max(peak, Math.abs(b.l[i]), Math.abs(b.r[i]));
  const gate = peak * 0.02;
  let sum = 0, n = 0;
  for (let i = 0; i < b.l.length; i++) {
    if (Math.abs(b.l[i]) < gate && Math.abs(b.r[i]) < gate) continue;
    sum += b.l[i] * b.l[i] + b.r[i] * b.r[i];
    n += 2;
  }
  return n ? 10 * Math.log10(sum / n) : -Infinity;
}
/**
 * Loudness normalisation: scales to the target RMS, then tames any peaks above -1 dBFS with a
 * soft knee instead of clipping. One-shots also get 4 ms fades so they never start or end on a click.
 */
export function finalize(b: Stereo, rmsDb: number, loop: boolean, ceilingDb = -1): Stereo {
  // remove any DC offset first
  for (const ch of [b.l, b.r]) {
    let mean = 0;
    for (let i = 0; i < ch.length; i++) mean += ch[i];
    mean /= ch.length || 1;
    for (let i = 0; i < ch.length; i++) ch[i] -= mean;
  }
  const g = Math.pow(10, (rmsDb - levels(b).rmsDb) / 20), ceil = Math.pow(10, ceilingDb / 20), knee = ceil * 0.7;
  const soft = (x: number) => {
    const a = Math.abs(x);
    if (a <= knee) return x;
    return Math.sign(x) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
  };
  const f = Math.round(0.004 * SR);
  for (let i = 0; i < b.l.length; i++) {
    const edge = loop ? 1 : Math.min(1, i / f, (b.l.length - 1 - i) / f);
    b.l[i] = soft(b.l[i] * g) * edge;
    b.r[i] = soft(b.r[i] * g) * edge;
  }
  return b;
}
/** Mono effect -> centred stereo, normalised by peak (effects are balanced against each other by `gain` in the manifest). */
export function toStereo(x: Float32Array, peakDb = -3, pan = 0): Stereo {
  let peak = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) peak = Math.abs(x[i]);
  const g = Math.pow(10, peakDb / 20) / (peak || 1), f = Math.round(0.003 * SR);
  const out: Stereo = { l: new Float32Array(x.length), r: new Float32Array(x.length) };
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * g * Math.min(1, i / f, (x.length - 1 - i) / f);
    out.l[i] = v * panL(pan) * Math.SQRT2;
    out.r[i] = v * panR(pan) * Math.SQRT2;
  }
  return trimTail(out, 0.0004);
}

// ---------------------------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------------------------
/** 16-bit PCM WAV. Mono when both channels are identical. */
export function wav(b: Stereo): Buffer {
  let same = true;
  for (let i = 0; i < b.l.length && same; i++) if (b.l[i] !== b.r[i]) same = false;
  const ch = same ? 1 : 2, n = b.l.length, data = Buffer.alloc(44 + n * ch * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * ch * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(ch, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * ch * 2, 28);
  data.writeUInt16LE(ch * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * ch * 2, 40);
  const q = (v: number) => Math.round(clamp(v, -1, 1) * 32767);
  for (let i = 0, o = 44; i < n; i++) {
    data.writeInt16LE(q(b.l[i]), o);
    o += 2;
    if (ch === 2) {
      data.writeInt16LE(q(b.r[i]), o);
      o += 2;
    }
  }
  return data;
}
