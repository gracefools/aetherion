// Audio engine: one Web Audio graph for the whole client.
//
//   music channel ─┐
//   ambience chan. ─┼─ bus gains (settings) ─ master gain ─ limiter ─ speakers
//   effect voices ─┘
//
// It knows nothing about the game. The game tells it which track should be playing and which
// effect just happened (client/src/audio/gameSound.ts); it takes care of loading, caching,
// crossfades, seamless loops, voice limits, settings and the browser's autoplay rules.
import {
  busGains, cleanAudioSettings, DEFAULT_AUDIO_SETTINGS, fadeMs, MAX_VOICES, MUSIC_CACHE_BYTES, resumes, SAME_SOUND_GAP_MS, spatial,
  type AudioCategory, type AudioSettings,
} from '../../../shared/src/audio';

interface Entry {
  id: string;
  file: string;
  category: AudioCategory;
  loop: boolean;
  duration: number;
  gain: number;
  bytes: number;
  v: string;
  temporary: boolean;
}
/** 'locked': the browser has not allowed sound yet (no user interaction so far). */
export type AudioState = 'loading' | 'locked' | 'running' | 'unsupported';
export interface AudioSnapshot {
  state: AudioState;
  settings: AudioSettings;
  /** True when the build ships placeholder audio (shown in the settings panel). */
  temporary: boolean;
  assets: number;
}
export interface PlayOpts {
  /** 0..1 on top of the sound's own gain. */
  vol?: number;
  /** Playback-rate multiplier. */
  rate?: number;
  /** Random pitch variation, e.g. 0.06 = up to 6% either way (repeated sounds stop sounding identical). */
  vary?: number;
  /** Offset of the source from the listener in world units; makes the sound positional. */
  dx?: number;
  dy?: number;
  delayMs?: number;
}
interface Playing {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time at which the buffer's position 0 was (or would have been) playing. */
  t0: number;
  level: number; // the sound's own gain from the manifest
  fadeFrom: number;
  fadeTo: number;
  fadeAt: number;
  fadeLen: number;
}
/** A looping, crossfading player: one for music, one for ambience. */
interface Channel {
  name: 'music' | 'ambience';
  bus: GainNode | null;
  want: string;
  cur: Playing | null;
  /** A one-shot track that ran to its end while still wanted (it must not start again by itself). */
  done: string;
  /** Where each resumable track stopped: [position in seconds, performance.now() when it stopped]. */
  pos: Map<string, [number, number]>;
  switches: number;
  starts: number;
}
const LS_KEY = 'aetherion.audio';
/** Load priorities: needed now, likely needed next, background warm-up. */
const URGENT = 0, SOON = 1, IDLE = 2;
const RESUME_WITHIN_MS = 180_000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private manifest = new Map<string, Entry>();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private failed = new Set<string>();
  private queue: { id: string; pri: number; done: (b: AudioBuffer | null) => void }[] = [];
  private active = 0; // decodes in flight
  private lru: string[] = []; // music and ambience ids, least recently used first
  private music: Channel = { name: 'music', bus: null, want: '', cur: null, done: '', pos: new Map(), switches: 0, starts: 0 };
  private ambience: Channel = { name: 'ambience', bus: null, want: '', cur: null, done: '', pos: new Map(), switches: 0, starts: 0 };
  private voices = 0;
  private lastPlayed = new Map<string, number>();
  private subs = new Set<() => void>();
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private state: AudioState = 'loading';
  private snap: AudioSnapshot = { state: 'loading', settings: this.settings, temporary: false, assets: 0 };
  private token = '';
  private saveTimer = 0;
  private dirty = false;
  private started = false;
  /** Counters for tests and for the performance figures in docs/M10.md. */
  stats = { played: 0, throttled: 0, dropped: 0, notReady: 0, outOfRange: 0, decodes: 0, decodeMs: 0, maxDecodeMs: 0, evicted: 0, loadErrors: 0, fetchedBytes: 0 };
  /** The last effects played, newest last (tests assert on this). */
  log: string[] = [];

  // ---------- store (for React) ----------
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getSnapshot = () => this.snap;
  private emit() {
    this.snap = { state: this.state, settings: this.settings, temporary: [...this.manifest.values()].some((e) => e.temporary), assets: this.manifest.size };
    for (const s of this.subs) s();
  }

  // ---------- start-up ----------
  /** Loads the manifest and the locally remembered settings, and starts waiting for the first interaction. */
  async init() {
    if (this.started) return;
    this.started = true;
    try {
      this.settings = cleanAudioSettings(JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'));
    } catch { /* private mode or corrupt value: defaults */ }
    if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
      this.state = 'unsupported';
      return this.emit();
    }
    // Browsers only allow sound after the user has interacted with the page. Until then nothing is
    // created or downloaded; the first click, tap or key press unlocks the engine.
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
    window.addEventListener('pagehide', () => this.flush());
    try {
      const r = await fetch('/audio/manifest.json', { cache: 'no-cache' });
      const m = r.ok ? await r.json() : null;
      if (m?.version === 1 && Array.isArray(m.assets)) for (const e of m.assets as Entry[]) this.manifest.set(e.id, e);
    } catch { /* no manifest: the game runs silently */ }
    if (this.state === 'loading') this.state = 'locked';
    this.emit();
    if (this.ctx?.state === 'running') this.onRunning();
  }
  private onGesture = () => {
    this.unlock();
  };
  /** Called from a user gesture. Creates the audio graph on first use and asks the browser to start it. */
  unlock() {
    if (this.state === 'unsupported') return;
    if (!this.ctx) {
      const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      try {
        this.ctx = new Ctx({ latencyHint: 'interactive' });
      } catch {
        this.state = 'unsupported';
        return this.emit();
      }
      const ctx = this.ctx, limiter = ctx.createDynamicsCompressor();
      // a safety limiter: many effects at once must never clip
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master = ctx.createGain();
      this.master.connect(limiter).connect(ctx.destination);
      this.music.bus = ctx.createGain();
      this.ambience.bus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      for (const b of [this.music.bus, this.ambience.bus, this.sfxBus]) b.connect(this.master);
      this.applyGains(0);
      ctx.addEventListener('statechange', () => (ctx.state === 'running' ? this.onRunning() : this.onSuspended()));
    }
    if (this.ctx.state === 'running') this.onRunning();
    else this.ctx.resume().catch(() => {});
  }
  private onRunning() {
    if (this.state === 'running' || this.state === 'loading') return;
    this.state = 'running';
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this.onGesture, { capture: true });
    this.emit();
    this.apply(this.music);
    this.apply(this.ambience);
    // the music that should be playing comes first; effects warm up behind it
    setTimeout(() => this.warmEffects(), 400);
  }
  /** The browser paused audio (a phone call, the tab was frozen): wait for the next interaction again. */
  private onSuspended() {
    if (this.state !== 'running') return;
    this.state = 'locked';
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
    this.emit();
  }

  // ---------- settings ----------
  getSettings = () => this.settings;
  private applyGains(seconds = 0.05) {
    if (!this.ctx || !this.master) return;
    const g = busGains(this.settings), t = this.ctx.currentTime;
    const set = (node: GainNode | null, v: number) => node && (seconds ? node.gain.setTargetAtTime(v, t, seconds / 3) : (node.gain.value = v));
    set(this.master, g.master);
    set(this.music.bus, g.music);
    set(this.ambience.bus, g.ambient);
    set(this.sfxBus, g.sfx);
  }
  /** Changes settings: applied at once, remembered locally, and saved to the account shortly after. */
  setSettings(patch: Partial<AudioSettings>) {
    this.settings = cleanAudioSettings({ ...this.settings, ...patch });
    this.applyGains();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.settings));
    } catch { /* storage unavailable: the account copy still works */ }
    this.emit();
    if (!this.token) return;
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 500);
  }
  /** Saves pending settings to the account now (also used when the page is closing). */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !this.token) return Promise.resolve();
    this.dirty = false;
    return fetch('/api/settings', {
      method: 'PUT', keepalive: true,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
      body: JSON.stringify({ audio: this.settings }),
    }).then((r) => void (r.ok || r.status === 401 || (this.dirty = true)), () => void (this.dirty = true));
  }
  /**
   * Signing in: the account's saved settings win over this browser's. An account that has never
   * saved any takes over what this browser has. Signing out (empty token) keeps the local copy.
   */
  async setAccount(token: string) {
    if (token === this.token) return;
    if (!token) await this.flush();
    this.token = token;
    if (!token) return;
    try {
      const r = await fetch('/api/settings', { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok || this.token !== token) return;
      const body = await r.json();
      if (body.saved) {
        this.settings = cleanAudioSettings(body.audio);
        this.applyGains();
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(this.settings));
        } catch { /* ignore */ }
        this.emit();
      } else {
        this.dirty = true;
        await this.flush();
      }
    } catch { /* offline: local settings stay in force */ }
  }

  // ---------- loading and caching ----------
  has = (id: string) => this.manifest.has(id);
  /** Length of a sound in seconds (0 if the build does not ship it). */
  durationOf = (id: string) => this.manifest.get(id)?.duration ?? 0;
  /**
   * Fetches and decodes a sound. Decoding competes with the game for the processor, so requests
   * go through a queue: what is needed now (URGENT) first and at most two at a time, hints for
   * what comes next (SOON) one at a time, and the background warm-up (IDLE) one at a time with a
   * pause after each, so start-up never turns into a burst of decoding.
   */
  private load(id: string, pri: number): Promise<AudioBuffer | null> {
    const ready = this.buffers.get(id);
    if (ready) return Promise.resolve(ready);
    const waiting = this.loading.get(id);
    if (waiting) {
      const job = this.queue.find((j) => j.id === id);
      if (job && pri < job.pri) {
        job.pri = pri; // now needed sooner than when it was queued
        this.pump();
      }
      return waiting;
    }
    if (!this.manifest.has(id) || !this.ctx || this.failed.has(id)) return Promise.resolve(null);
    const p = new Promise<AudioBuffer | null>((done) => this.queue.push({ id, pri, done }));
    this.loading.set(id, p);
    this.pump();
    return p;
  }
  private pump() {
    while (this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].pri < this.queue[best].pri) best = i;
      const job = this.queue[best];
      if (this.active >= (job.pri === URGENT ? 2 : 1)) return;
      this.queue.splice(best, 1);
      this.active++;
      void this.fetchDecode(job.id).then((buf) => {
        job.done(buf);
        this.active--;
        // the warm-up yields between files; anything more pressing continues at once
        if (job.pri === IDLE) setTimeout(() => this.pump(), 60);
        else this.pump();
      });
    }
  }
  private async fetchDecode(id: string): Promise<AudioBuffer | null> {
    const e = this.manifest.get(id)!, ctx = this.ctx!;
    try {
      // the content hash in the URL lets the browser's HTTP cache keep the file for good
      const res = await fetch(`/audio/${e.file}?v=${e.v}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      this.stats.fetchedBytes += data.byteLength;
      const t = performance.now(), buf = await ctx.decodeAudioData(data), ms = performance.now() - t;
      this.stats.decodes++;
      this.stats.decodeMs += ms;
      if (ms > this.stats.maxDecodeMs) this.stats.maxDecodeMs = ms;
      this.buffers.set(id, buf);
      if (e.category !== 'sfx') this.touch(id);
      return buf;
    } catch (err) {
      // one warning, no retry storm: a missing or undecodable sound is simply not played
      this.failed.add(id);
      this.stats.loadErrors++;
      console.warn(`audio: cannot load ${id}: ${(err as Error).message}`);
      return null;
    } finally {
      this.loading.delete(id);
    }
  }
  /** Tracks that are likely to be needed soon, so the switch to them is immediate. */
  preload(ids: string[]) {
    if (this.state !== 'running') return;
    for (const id of ids) if (id && !this.buffers.has(id)) void this.load(id, SOON);
  }
  /** Effects are small; all of them are decoded once in the background, the most common first. */
  private warmEffects() {
    const rank = (id: string) => (id.startsWith('ui.') ? 0 : id.startsWith('move.') ? 1 : id.startsWith('combat.') ? 2 : 3);
    const ids = [...this.manifest.values()].filter((e) => e.category === 'sfx').map((e) => e.id).sort((a, b) => rank(a) - rank(b));
    for (const id of ids) void this.load(id, IDLE);
  }
  private bytesOf = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;
  /** Decoded PCM held in memory, by kind (bytes). */
  memory() {
    let music = 0, sfx = 0;
    for (const [id, b] of this.buffers) this.manifest.get(id)?.category === 'sfx' ? (sfx += this.bytesOf(b)) : (music += this.bytesOf(b));
    return { music, sfx };
  }
  /** Marks a long track as used and releases the least recently used ones beyond the memory budget. */
  private touch(id: string) {
    this.lru = this.lru.filter((x) => x !== id);
    this.lru.push(id);
    let total = this.memory().music;
    const busy = new Set([this.music.cur?.id, this.music.want, this.ambience.cur?.id, this.ambience.want]);
    for (let i = 0; i < this.lru.length && total > MUSIC_CACHE_BYTES; ) {
      const old = this.lru[i], buf = this.buffers.get(old);
      if (busy.has(old) || !buf) {
        i++;
        continue;
      }
      total -= this.bytesOf(buf);
      this.buffers.delete(old);
      this.lru.splice(i, 1);
      this.stats.evicted++;
    }
  }

  // ---------- music and ambience ----------
  /** The track that should be playing ('' = silence). Safe to call every frame: the same id is a no-op. */
  setMusic(id: string) {
    if (this.music.want === id) return;
    this.music.want = id;
    this.music.done = '';
    this.apply(this.music);
  }
  setAmbience(id: string) {
    if (this.ambience.want === id) return;
    this.ambience.want = id;
    this.ambience.done = '';
    this.apply(this.ambience);
  }
  private level(p: Playing, t: number) {
    return p.fadeFrom + (p.fadeTo - p.fadeFrom) * clamp01(p.fadeLen ? (t - p.fadeAt) / p.fadeLen : 1);
  }
  private fade(p: Playing, to: number, seconds: number) {
    const ctx = this.ctx!, t = ctx.currentTime, from = this.level(p, t);
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(from, t);
    p.gain.gain.linearRampToValueAtTime(to, t + seconds);
    p.fadeFrom = from;
    p.fadeTo = to;
    p.fadeAt = t;
    p.fadeLen = seconds;
  }
  private apply(ch: Channel) {
    const ctx = this.ctx;
    if (!ctx || this.state !== 'running' || !ch.bus) return;
    const id = ch.want;
    if (ch.cur?.id === id || (id && ch.done === id)) return;
    if (id && !this.manifest.has(id)) return this.stop(ch, 1);
    if (!id) return this.stop(ch, fadeMs(ch.cur?.id ?? '', '') / 1000);
    const buf = this.buffers.get(id);
    if (!buf) {
      // keep the current track playing until the new one is decoded, then crossfade
      void this.load(id, URGENT).then((b) => b && ch.want === id && this.apply(ch));
      return;
    }
    const e = this.manifest.get(id)!, seconds = (ch.name === 'ambience' ? 2500 : fadeMs(ch.cur?.id ?? '', id)) / 1000;
    this.stop(ch, seconds);
    const src = ctx.createBufferSource(), gain = ctx.createGain(), t = ctx.currentTime;
    src.buffer = buf;
    src.loop = e.loop; // a whole-buffer loop on a decoded buffer is sample-exact: no gap at the seam
    let offset = 0;
    const kept = ch.pos.get(id);
    if (e.loop && kept && resumes(id) && performance.now() - kept[1] < RESUME_WITHIN_MS) offset = kept[0] % buf.duration;
    gain.gain.value = 0;
    src.connect(gain).connect(ch.bus);
    src.start(t, offset);
    const p: Playing = { id, src, gain, t0: t - offset, level: e.gain, fadeFrom: 0, fadeTo: 0, fadeAt: t, fadeLen: 0 };
    this.fade(p, e.gain, seconds);
    if (!e.loop)
      src.onended = () => {
        if (ch.cur !== p) return;
        ch.cur = null;
        ch.done = id; // a one-shot does not repeat while it is still the wanted track
        gain.disconnect();
      };
    ch.cur = p;
    ch.starts++;
    ch.switches++;
    this.touch(id);
  }
  private stop(ch: Channel, seconds: number) {
    const p = ch.cur, ctx = this.ctx;
    if (!p || !ctx) return;
    ch.cur = null;
    const buf = p.src.buffer;
    if (buf && p.src.loop) ch.pos.set(p.id, [(ctx.currentTime - p.t0) % buf.duration, performance.now()]);
    p.src.onended = () => p.gain.disconnect();
    this.fade(p, 0, seconds);
    p.src.stop(ctx.currentTime + seconds + 0.05);
  }

  // ---------- sound effects ----------
  private skip(why: 'outOfRange' | 'throttled' | 'dropped' | 'notReady'): false {
    this.stats[why]++;
    return false;
  }
  /** Plays an effect. Returns false when it was skipped (muted, out of range, throttled, not loaded). */
  /**
   * A modern impact layer, synthesized: a deep thump that drops in pitch, a short crisp transient
   * of filtered noise, and for a critical hit a bright ring. Played under the hit sample so a blow
   * lands with weight. Goes through the effects bus, its volume and stereo position like any effect.
   */
  private noise: AudioBuffer | null = null;
  private lastPunch = -1e9;
  punch(o: { dx?: number; dy?: number; vol?: number; crit?: boolean } = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || this.state !== 'running' || !this.sfxBus || !this.settings.sfxOn || this.settings.muteAll) return false;
    // many blows at once (an area attack) make one punch, not a roar
    const at = performance.now();
    if (at - this.lastPunch < 40) return false;
    this.lastPunch = at;
    let vol = (o.vol ?? 1) * (o.crit ? 1.25 : 1), pan = 0;
    if (o.dx !== undefined) { const s = spatial(o.dx, o.dy ?? 0); if (s.vol < 0.02) return false; vol *= s.vol; pan = s.pan; }
    const t = ctx.currentTime, out = ctx.createGain(), p = ctx.createStereoPanner();
    out.gain.value = 0.55 * vol;
    p.pan.value = pan;
    out.connect(p).connect(this.sfxBus);
    // the thump: a sine falling from 150 Hz to 48 Hz with a quick decay
    const sub = ctx.createOscillator(), sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(o.crit ? 170 : 150, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    sub.connect(sg).connect(out);
    sub.start(t); sub.stop(t + 0.18);
    // the transient: 30 ms of noise through a band-pass, the snap of contact
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise;
    bp.type = 'bandpass'; bp.frequency.value = o.crit ? 3600 : 2400; bp.Q.value = 0.9;
    ng.gain.setValueAtTime(0.7, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    n.connect(bp).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.05);
    // a critical hit rings: a bright triangle sliding down
    if (o.crit) {
      const r = ctx.createOscillator(), rg = ctx.createGain();
      r.type = 'triangle';
      r.frequency.setValueAtTime(1500, t);
      r.frequency.exponentialRampToValueAtTime(700, t + 0.22);
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      r.connect(rg).connect(out);
      r.start(t); r.stop(t + 0.3);
    }
    setTimeout(() => { try { out.disconnect(); p.disconnect(); } catch { /* already gone */ } }, 400);
    return true;
  }
  play(id: string, o: PlayOpts = {}): boolean {
    const ctx = this.ctx, e = this.manifest.get(id);
    if (!ctx || !e || this.state !== 'running' || !this.sfxBus) return false;
    if (!this.settings.sfxOn || this.settings.muteAll) return false;
    let vol = o.vol ?? 1, pan = 0;
    if (o.dx !== undefined) {
      const s = spatial(o.dx, o.dy ?? 0);
      if (s.vol < 0.02) return this.skip('outOfRange');
      vol *= s.vol;
      pan = s.pan;
    }
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -1e9) < SAME_SOUND_GAP_MS) return this.skip('throttled');
    if (this.voices >= MAX_VOICES) return this.skip('dropped');
    const buf = this.buffers.get(id);
    if (!buf) {
      // not decoded yet: skipping is better than playing it late
      void this.load(id, URGENT);
      return this.skip('notReady');
    }
    this.lastPlayed.set(id, now);
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0));
    gain.gain.value = e.gain * vol;
    let tail: AudioNode = gain;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      tail = p;
    }
    src.connect(gain);
    tail.connect(this.sfxBus);
    this.voices++;
    src.onended = () => {
      this.voices--;
      tail.disconnect();
    };
    src.start(ctx.currentTime + (o.delayMs ?? 0) / 1000);
    this.stats.played++;
    this.log.push(id);
    if (this.log.length > 60) this.log.shift();
    return true;
  }

  /** State for tests and for the developer console (window.__audio.debug()). */
  debug() {
    const now = this.ctx?.currentTime ?? 0, ch = (c: Channel) => ({
      want: c.want, playing: c.cur?.id ?? '', level: c.cur ? Math.round(this.level(c.cur, now) * 1000) / 1000 : 0,
      position: c.cur?.src.buffer ? Math.round(((now - c.cur.t0) % c.cur.src.buffer.duration) * 100) / 100 : 0, starts: c.starts,
    });
    return {
      state: this.state, context: this.ctx?.state ?? 'none', sampleRate: this.ctx?.sampleRate ?? 0, settings: this.settings, gains: busGains(this.settings),
      assets: this.manifest.size, decoded: this.buffers.size, effectsReady: [...this.buffers.keys()].filter((id) => this.manifest.get(id)?.category === 'sfx').length, voices: this.voices, music: ch(this.music), ambience: ch(this.ambience),
      memory: this.memory(), stats: { ...this.stats }, log: [...this.log], failed: [...this.failed],
    };
  }
}
export const audio = new AudioEngine();
