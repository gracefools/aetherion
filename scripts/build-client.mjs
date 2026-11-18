// Bundles the client into client/dist. (esbuild stands in for Vite, which is not installed here.)
import { build } from 'esbuild';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

fs.mkdirSync('client/dist', { recursive: true });
fs.copyFileSync('client/public/index.html', 'client/dist/index.html');
fs.copyFileSync('client/public/clock.js', 'client/dist/clock.js');
const r = await build({
  entryPoints: ['client/src/main.tsx'],
  bundle: true,
  minify: process.env.NO_MINIFY !== '1',
  sourcemap: true,
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: 'client/dist/app.js',
  metafile: true,
});
// Imported art: validated, then copied next to the bundle (rejected sheets are left out).
const imp = spawnSync('node_modules/.bin/tsx', ['scripts/import-assets.ts'], { stdio: 'inherit' });
if (imp.status !== 0) process.exit(imp.status ?? 1);
// Audio: validated the same way and copied to client/dist/audio (a sound with any error is left out).
const aud = spawnSync('node_modules/.bin/tsx', ['scripts/import-audio.ts'], { stdio: 'inherit' });
if (aud.status !== 0) process.exit(aud.status ?? 1);
const out = r.metafile.outputs['client/dist/app.js'];
console.log(`client/dist/app.js ${(out.bytes / 1024).toFixed(1)} kB`);
