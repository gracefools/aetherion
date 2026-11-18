// The audio manifest (assets/audio/manifest.json): one entry per sound with its file, playback
// data, provenance and licence notes. This module reads, measures and validates it; it is used
// by the audio build, by the client build (scripts/import-audio.ts) and by the tests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AUDIO_BY_ID, AUDIO_DEFS, type AudioCategory } from '../../shared/src/audio';

export interface AudioEntry {
  /** Asset id (BGM-001, rune.fireball_cast, AMB-FOREST). */
  id: string;
  /** Path below assets/audio. */
  file: string;
  category: AudioCategory;
  title: string;
  /** Seconds, measured from the encoded file. */
  duration: number;
  loop: boolean;
  /** Volume normalisation: linear gain applied at playback. */
  gain: number;
  /** What makes the game play it. */
  trigger: string;
  /** Associated map, monster, class or skill. */
  assoc: Record<string, string>;
  location?: string;
  mood?: string;
  /** Set when no game system triggers the sound yet. */
  reserved?: string;
  channels: number;
  sampleRate: number;
  peakDb?: number;
  rmsDb?: number;
  /** Who or what made the audio. */
  provider: string;
  /** How it was made (generator, prompt, tool version). */
  source: string;
  /** ISO date the file was generated. */
  generated: string;
  /** Usage rights as far as they are actually known. Never "cleared" unless someone verified it. */
  license: string;
  /** True for stand-in audio that is meant to be replaced. */
  temporary: boolean;
}
export interface AudioManifest {
  version: 1;
  generated: string;
  /** Shown to anyone opening the file. */
  notice: string;
  assets: AudioEntry[];
}
/** What the client downloads (client/dist/audio/manifest.json): playback data only. */
export interface ClientAudioEntry {
  id: string;
  file: string;
  category: AudioCategory;
  loop: boolean;
  duration: number;
  gain: number;
  bytes: number;
  /** Content hash, used as a cache-busting query string. */
  v: string;
  temporary: boolean;
}
export interface Finding {
  level: 'error' | 'warning';
  file: string;
  rule: string;
  msg: string;
}

export interface OggInfo {
  codec: 'vorbis' | 'opus';
  channels: number;
  sampleRate: number;
  duration: number;
}
/** Reads the stream header and the final granule position of an Ogg file. Throws on anything else. */
export function oggInfo(buf: Buffer): OggInfo {
  if (buf.length < 64 || buf.toString('latin1', 0, 4) !== 'OggS') throw new Error('not an Ogg file');
  const segs = buf[26], head = 27 + segs;
  let codec: OggInfo['codec'], channels: number, sampleRate: number, preskip = 0;
  if (buf[head] === 1 && buf.toString('latin1', head + 1, head + 7) === 'vorbis') {
    codec = 'vorbis';
    channels = buf[head + 11];
    sampleRate = buf.readUInt32LE(head + 12);
  } else if (buf.toString('latin1', head, head + 8) === 'OpusHead') {
    codec = 'opus';
    channels = buf[head + 9];
    preskip = buf.readUInt16LE(head + 10);
    sampleRate = 48000;
  } else throw new Error('unsupported codec (only Ogg Vorbis and Ogg Opus are accepted)');
  const last = buf.lastIndexOf('OggS', buf.length - 1, 'latin1');
  const granule = Number(buf.readBigInt64LE(last + 6));
  if (!(granule > 0) || !(sampleRate > 0) || !(channels > 0)) throw new Error('corrupt Ogg stream');
  return { codec, channels, sampleRate, duration: (granule - preskip) / sampleRate };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export interface AudioCheck {
  findings: Finding[];
  /** Entries with no error. */
  ok: AudioEntry[];
  entries: AudioEntry[];
}
/** Validates assets/audio against its manifest and against the game's sound catalogue. */
export function validateAudio(dir: string): AudioCheck {
  const findings: Finding[] = [], ok: AudioEntry[] = [];
  const add = (level: Finding['level'], file: string, rule: string, msg: string) => void findings.push({ level, file, rule, msg });
  const mf = path.join(dir, 'manifest.json');
  let m: AudioManifest;
  try {
    m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  } catch (e) {
    add('error', 'manifest.json', 'manifest', fs.existsSync(mf) ? `not valid JSON: ${(e as Error).message}` : 'missing');
    return { findings, ok, entries: [] };
  }
  if (m.version !== 1 || !Array.isArray(m.assets)) {
    add('error', 'manifest.json', 'manifest', 'expected { version: 1, assets: [...] }');
    return { findings, ok, entries: [] };
  }
  const seen = new Set<string>(), files = new Set<string>();
  for (const e of m.assets) {
    const name = typeof e?.file === 'string' ? e.file : `(entry ${m.assets.indexOf(e)})`;
    const before = findings.filter((f) => f.level === 'error').length;
    const err = (rule: string, msg: string) => add('error', name, rule, msg);
    if (!e || typeof e !== 'object') {
      err('metadata', 'entry is not an object');
      continue;
    }
    if (typeof e.id !== 'string' || !e.id) err('metadata', 'missing id');
    else if (seen.has(e.id)) err('duplicate-id', `asset id "${e.id}" is used more than once`);
    else seen.add(e.id);
    const def = AUDIO_BY_ID[e.id];
    if (typeof e.id === 'string' && e.id && !def) add('warning', name, 'unknown-id', `"${e.id}" is not in the game's sound catalogue (shared/src/audio.ts); nothing will play it`);
    if (typeof e.file !== 'string' || !e.file) err('metadata', 'missing file path');
    else if (path.isAbsolute(e.file) || e.file.split(/[\\/]/).includes('..')) err('metadata', 'file path must stay inside assets/audio');
    else if (files.has(e.file)) err('duplicate-file', 'two entries use this file');
    else files.add(e.file);
    if (!['music', 'sfx', 'ambience'].includes(e.category)) err('metadata', `category must be music, sfx or ambience (got ${JSON.stringify(e.category)})`);
    else if (def && def.category !== e.category) err('category', `the catalogue lists ${e.id} as ${def.category}`);
    if (typeof e.loop !== 'boolean') err('metadata', 'missing loop flag');
    else if (def && def.loop !== e.loop) err('loop', `the game plays ${e.id} ${def.loop ? 'as a loop' : 'once'}; the manifest says otherwise`);
    if (typeof e.gain !== 'number' || !(e.gain > 0) || e.gain > 2) err('metadata', 'gain (volume normalisation) must be a number in (0, 2]');
    for (const k of ['title', 'trigger', 'provider', 'source', 'license'] as const) if (typeof e[k] !== 'string' || !e[k].trim()) err('metadata', `missing ${k}`);
    if (typeof e.generated !== 'string' || !DATE.test(e.generated)) err('metadata', 'generated must be a date (YYYY-MM-DD)');
    if (typeof e.temporary !== 'boolean') err('metadata', 'missing temporary flag');
    if (!e.assoc || typeof e.assoc !== 'object') err('metadata', 'missing assoc (associated map, monster, class or skill)');
    // A file may only be called cleared for commercial use by a person who checked; the pipeline refuses the claim from placeholders.
    if (e.temporary === true && typeof e.license === 'string' && /commercial(ly)? (use )?(cleared|licensed|approved)/i.test(e.license) && !/not /i.test(e.license))
      err('license', 'a temporary placeholder must not be described as commercially cleared');
    // only a path that stays inside the audio folder is ever opened
    if (typeof e.file === 'string' && e.file && !path.isAbsolute(e.file) && !e.file.split(/[\\/]/).includes('..')) {
      const p = path.join(dir, e.file);
      if (path.extname(e.file).toLowerCase() !== '.ogg') err('format', 'unsupported format: browser audio must be .ogg (Vorbis or Opus)');
      else if (!fs.existsSync(p)) err('missing-file', 'file not found');
      else {
        try {
          const info = oggInfo(fs.readFileSync(p));
          if (typeof e.duration !== 'number' || !(e.duration > 0)) err('metadata', 'missing duration');
          else if (Math.abs(info.duration - e.duration) > 0.05) err('duration', `manifest says ${e.duration}s, the file is ${info.duration.toFixed(3)}s`);
          if (info.channels > 2) err('format', `${info.channels} channels: only mono and stereo are supported`);
          if (e.category === 'sfx' && info.duration > 6) add('warning', name, 'length', `a ${info.duration.toFixed(1)}s sound effect is unusually long`);
          if (e.category !== 'sfx' && e.loop && info.duration < 8) add('warning', name, 'length', `a ${info.duration.toFixed(1)}s loop will sound repetitive`);
        } catch (x) {
          err('format', (x as Error).message);
        }
      }
    }
    if (findings.filter((f) => f.level === 'error').length === before) ok.push(e);
  }
  for (const d of AUDIO_DEFS) if (!seen.has(d.id)) add('error', 'manifest.json', 'missing-asset', `no entry for ${d.id} (${d.title}); the game will be silent where it is used`);
  return { findings, ok, entries: m.assets };
}

/** The playback subset of an entry, with the size and a content hash of the file. */
export function clientEntry(dir: string, e: AudioEntry): ClientAudioEntry {
  const data = fs.readFileSync(path.join(dir, e.file));
  return { id: e.id, file: e.file, category: e.category, loop: e.loop, duration: e.duration, gain: e.gain, bytes: data.length, v: crypto.createHash('sha1').update(data).digest('hex').slice(0, 10), temporary: e.temporary };
}
