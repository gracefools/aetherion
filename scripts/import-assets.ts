// Validates assets/game and copies the sheets that pass into client/dist/assets, with a manifest
// listing only those. A sheet with any error is left out, so broken art can never reach players.
// Usage: tsx scripts/import-assets.ts [srcDir] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { validateDir } from './assets';

const src = process.argv[2] ?? 'assets/game', out = process.argv[3] ?? 'client/dist/assets';
fs.rmSync(out, { recursive: true, force: true });
if (!fs.existsSync(path.join(src, 'manifest.json'))) {
  // an empty manifest, so the client's request for it succeeds and it simply keeps its built-in art
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: 1, sheets: [] }));
  console.log(`no ${src}/manifest.json: the game uses its built-in art`);
  process.exit(0);
}
const { findings, entries, ok, records } = validateDir(src);
for (const f of findings) console.log(`${f.level === 'error' ? 'ERROR  ' : 'warning'}  ${f.file}  [${f.rule}]  ${f.msg}`);
fs.mkdirSync(out, { recursive: true });
for (const e of ok) {
  fs.mkdirSync(path.dirname(path.join(out, e.file)), { recursive: true });
  fs.copyFileSync(path.join(src, e.file), path.join(out, e.file));
}
// character layers are validated but not yet composited by the client: only monsters and props are loaded
// the full metadata of every imported asset (dimensions, frames, animations, anchor, provenance), derived by the validator
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: 1, sheets: ok, assets: records }, null, 1));
console.log(`imported ${ok.length} of ${entries.length} sheets into ${out}${entries.length - ok.length ? ` (${entries.length - ok.length} rejected)` : ''}`);
