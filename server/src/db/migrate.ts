import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './pgwire';

/** Applies db/migrations/*.sql in filename order, each inside its own transaction. */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = f.replace(/'/g, '');
    await db.exec(`BEGIN;\n${sql}\n;INSERT INTO schema_migrations(name) VALUES ('${name}');\nCOMMIT;`).catch(async (e) => {
      await db.exec('ROLLBACK').catch(() => {});
      throw new Error(`migration ${f} failed: ${e.message}`);
    });
    applied.push(f);
  }
  return applied;
}
