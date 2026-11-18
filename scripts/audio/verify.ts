// Measures what cannot be judged by reading code: decodes every looping track from its encoded
// OGG and checks that the last sample joins the first without a jump, i.e. that the loop point
// is not a click. Also reports clipping. Needs ffmpeg (the dev image has it).
//   npm run audio:verify
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AudioManifest } from './manifest';

const DIR = 'assets/audio';
const m: AudioManifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
let failed = 0;
console.log('id                seam jump   typical step   99.9% step   ratio   peak     verdict');
for (const e of m.assets.filter((a) => a.loop)) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(DIR, e.file), '-f', 'f32le', '-ac', String(e.channels), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${e.id}: ${r.stderr}`);
  const pcm = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength >> 2), ch = e.channels, n = pcm.length / ch;
  if (Math.abs(n / e.sampleRate - e.duration) > 0.002) throw new Error(`${e.id}: decoded ${n / e.sampleRate}s, manifest says ${e.duration}s`);
  // sample-to-sample steps inside the track, against the step from the last sample back to the first
  const steps = new Float32Array((n - 1) * ch);
  let peak = 0;
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < ch; c++) {
    steps[i * ch + c] = Math.abs(pcm[(i + 1) * ch + c] - pcm[i * ch + c]);
    peak = Math.max(peak, Math.abs(pcm[i * ch + c]));
  }
  steps.sort();
  const typical = steps[Math.floor(steps.length * 0.5)], high = steps[Math.floor(steps.length * 0.999)];
  let seam = 0;
  for (let c = 0; c < ch; c++) seam = Math.max(seam, Math.abs(pcm[c] - pcm[(n - 1) * ch + c]));
  // A click is a step far outside what the music itself contains. Anything within the track's own 99.9th percentile is inaudible as a seam.
  const ok = seam <= high * 1.5 && peak <= 1;
  if (!ok) failed++;
  console.log(`${e.id.padEnd(16)} ${seam.toFixed(5).padStart(10)} ${typical.toFixed(5).padStart(14)} ${high.toFixed(5).padStart(12)} ${(seam / (high || 1e-9)).toFixed(2).padStart(7)} ${peak.toFixed(3).padStart(7)}   ${ok ? 'seamless' : 'CLICK AT LOOP POINT'}`);
}
console.log(failed ? `${failed} loop(s) have a discontinuity at the loop point` : 'every loop joins its start without a discontinuity');
process.exit(failed ? 1 : 0);
