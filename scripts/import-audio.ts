// Validates assets/audio and copies the files that pass into client/dist/audio, with a manifest
// listing only those (playback data, size and a content hash). A file with any error is left
// out, so a broken or mislabelled sound can never reach players.
//   tsx scripts/import-audio.ts [srcDir] [outDir]
//   tsx scripts/import-audio.ts --check [srcDir]     validate only; exit code 1 on any error
import fs from 'node:fs';
import path from 'node:path';
import { clientEntry, validateAudio } from './audio/manifest';

const args = process.argv.slice(2), check = args[0] === '--check';
if (check) args.shift();
const src = args[0] ?? 'assets/audio', out = args[1] ?? 'client/dist/audio';

if (!fs.existsSync(path.join(src, 'manifest.json'))) {
  if (check) {
    console.log(`ERROR    ${src}/manifest.json  [manifest]  missing`);
    process.exit(1);
  }
  // an empty manifest, so the client's request for it succeeds and the game simply stays silent
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: 1, assets: [] }));
  console.log(`no ${src}/manifest.json: the game has no audio`);
  process.exit(0);
}
const { findings, entries, ok } = validateAudio(src);
for (const f of findings) console.log(`${f.level === 'error' ? 'ERROR  ' : 'warning'}  ${f.file}  [${f.rule}]  ${f.msg}`);
const errors = findings.filter((f) => f.level === 'error').length;
if (check) {
  console.log(`${ok.length} of ${entries.length} audio assets valid, ${errors} error${errors === 1 ? '' : 's'}, ${findings.length - errors} warning${findings.length - errors === 1 ? '' : 's'}`);
  process.exit(errors ? 1 : 0);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let bytes = 0;
const assets = ok.map((e) => {
  fs.mkdirSync(path.dirname(path.join(out, e.file)), { recursive: true });
  fs.copyFileSync(path.join(src, e.file), path.join(out, e.file));
  const c = clientEntry(src, e);
  bytes += c.bytes;
  return c;
});
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: 1, assets }));
const temp = assets.filter((a) => a.temporary).length;
console.log(`imported ${ok.length} of ${entries.length} audio assets into ${out} (${(bytes / 1048576).toFixed(2)} MB${entries.length - ok.length ? `, ${entries.length - ok.length} rejected` : ''}${temp ? `; ${temp} are temporary placeholders` : ''})`);
