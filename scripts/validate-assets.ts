// CLI: tsx scripts/validate-assets.ts [dir]   (default: assets/game)
// Exit code 1 if any sheet has an error. Sheets with errors are never copied into the client build.
import { validateDir } from './assets';

const dir = process.argv[2] ?? 'assets/game';
const { findings, entries, ok } = validateDir(dir);
for (const f of findings) console.log(`${f.level === 'error' ? 'ERROR  ' : 'warning'}  ${f.file}  [${f.rule}]  ${f.msg}`);
const errors = findings.filter((f) => f.level === 'error').length;
console.log(`${dir}: ${entries.length} sheets listed, ${ok.length} game-ready, ${errors} errors, ${findings.length - errors} warnings`);
process.exit(errors ? 1 : 0);
