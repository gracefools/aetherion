// Replaces placeholder audio with sourced, licensed recordings (CC0 and CC-BY from OpenGameArt).
//
//   npx tsx scripts/audio/import-sourced.ts <mapping.json>
//
// The mapping lists, per sound id, a downloaded file and where it came from:
//   { "<id>": { "file": "<path relative to the mapping>", "title", "author", "license", "page", "note"? } }
// Each file is converted with ffmpeg to Ogg Vorbis at the path the manifest already uses
// (44.1 kHz stereo; effects trimmed of leading silence and capped at 4 s, music capped at 4 min;
// loudness normalised per category), its manifest entry is updated (provider, source, licence,
// date, temporary: false), and assets/audio/CREDITS.md lists every recording and its author.
// Anything not in the mapping keeps its placeholder. Downloaded files are only read as audio data.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { oggInfo, type AudioManifest } from './manifest';

const OUT = 'assets/audio';
const mapPath = process.argv[2];
if (!mapPath) {
  console.error('usage: tsx scripts/audio/import-sourced.ts <mapping.json>');
  process.exit(1);
}
const base = path.dirname(mapPath);
const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as Record<string, { file: string; title: string; author: string; license: string; page: string; note?: string }>;
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as AudioManifest;
/** Sounds that need a shorter cut than their category's default (seconds). */
const CAP: Record<string, number> = { 'combat.player_death': 1.6, 'BGM-014': 8, 'BGM-015': 12, 'rune.healing_rain': 3.5 };
const ALLOWED = /^(CC0|CC-BY [34]\.0|OGA-BY [34]\.0)$/;
const today = new Date().toISOString().slice(0, 10);
const done: string[] = [], skipped: string[] = [];

for (const e of manifest.assets) {
  const m = mapping[e.id];
  if (!m) continue;
  if (!ALLOWED.test(m.license)) { skipped.push(`${e.id}: licence "${m.license}" is not accepted`); continue; }
  const src = path.resolve(base, m.file);
  if (!src.startsWith(path.resolve(base)) || !fs.existsSync(src)) { skipped.push(`${e.id}: file not found (${m.file})`); continue; }
  const dst = path.join(OUT, e.file), sfx = e.category === 'sfx';
  // effects: no leading silence, at most 4 s with a short fade; music and ambience: at most 4 minutes
  // per sound: the longest it may be, and the fade at its end (stingers are cut short; a compilation keeps one take)
  const cap = CAP[e.id] ?? (sfx ? 4 : e.category === 'ambience' ? 90 : e.loop ? 150 : 14), fade = sfx ? Math.min(0.3, cap / 4) : e.loop ? 0 : 2.5;
  const filters = [
    ...(sfx ? ['silenceremove=start_periods=1:start_threshold=-50dB'] : []),
    `atrim=0:${cap}`,
    ...(fade ? [`afade=t=out:st=${Math.max(0, cap - fade)}:d=${fade}`] : []),
    // loops: the first and last 50 ms fade, so the seam never clicks
    ...(e.loop ? ['afade=t=in:d=0.05', 'areverse', 'afade=t=in:d=0.05', 'areverse'] : []),
    `loudnorm=I=${sfx ? -16 : e.category === 'music' ? -18 : -22}:TP=-1.5:LRA=11`,
  ];
  const tmp = dst + '.tmp.ogg';
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // convert, then check the result before it replaces anything; a clip that silence trimming empties is tried untrimmed
  const encode = (af: string[]) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', af.join(','), '-ar', '44100', '-ac', '2', '-c:a', 'libvorbis', '-q:a', sfx ? '3' : '0', tmp], { encoding: 'utf8' });
    if (r.status !== 0) return { err: r.stderr.trim().split(/\r?\n/).pop() ?? 'ffmpeg failed' };
    try { return { info: oggInfo(fs.readFileSync(tmp)) }; } catch (x) { return { err: (x as Error).message }; }
  };
  let res = encode(filters);
  if (!res.info && sfx) res = encode(filters.filter((f) => !f.startsWith('silenceremove')));
  if (!res.info || res.info.duration < 0.05) { skipped.push(`${e.id}: ${res.err ?? 'empty after conversion'}`); fs.rmSync(tmp, { force: true }); continue; }
  fs.renameSync(tmp, dst);
  const info = res.info;
  // the length players hear: decoded samples (the stream header can be a few milliseconds longer)
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', dst, '-f', 's16le', '-ac', '2', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  if (pcm.status === 0 && pcm.stdout?.length) info.duration = pcm.stdout.length / 4 / 44100;
  e.duration = Math.round(info.duration * 1000) / 1000;
  e.channels = info.channels;
  e.sampleRate = info.sampleRate;
  e.gain = 1;
  e.provider = 'opengameart';
  e.source = `"${m.title}" by ${m.author}, ${m.page}${m.note ? ` (${m.note})` : ''}`;
  e.license = m.license;
  e.generated = today;
  e.temporary = false;
  done.push(e.id);
}

const left = manifest.assets.filter((e) => e.temporary).length;
manifest.generated = today;
manifest.notice = left
  ? `Recorded audio from OpenGameArt (CC0 and CC-BY; see CREDITS.md) for ${manifest.assets.length - left} sounds. The ${left} entries still marked "temporary": true are procedural placeholders synthesised by scripts/audio and should be replaced.`
  : 'All audio is recorded material from OpenGameArt under CC0 or CC-BY licences; see CREDITS.md for authors and sources.';
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// credits: one line per recording, grouped by source page
const bySource = new Map<string, { ids: string[]; m: (typeof mapping)[string] }>();
for (const id of done) {
  const m = mapping[id], key = m.page + '|' + m.title;
  const g = bySource.get(key) ?? { ids: [], m };
  g.ids.push(id);
  bySource.set(key, g);
}
const lines = ['# Audio credits', '', 'Recordings used by Aetherion Online. CC0 works need no attribution; it is given anyway. CC-BY works are used under their licence with the attribution below.', ''];
for (const { ids, m } of [...bySource.values()].sort((a, b) => a.m.author.localeCompare(b.m.author))) lines.push(`- "${m.title}" by ${m.author} — ${m.license} — ${m.page} — used for: ${ids.join(', ')}`);
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n') + '\n');

console.log(`replaced ${done.length} sounds; ${left} placeholders remain`);
for (const s of skipped) console.log('skipped ' + s);
