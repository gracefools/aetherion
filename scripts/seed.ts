// Seed data for local development: one demo account with a character per job.
// Usage: tsx scripts/seed.ts   (idempotent; login demo / demo-password)
import { hashPassword } from '../server/src/auth';
import { config } from '../server/src/config';
import { migrate } from '../server/src/db/migrate';
import { parseDbUrl, PgPool } from '../server/src/db/pgwire';
import { Repo } from '../server/src/db/repo';
import { JOBS } from '../shared/src/protocol';
import { defaultAppearance } from '../shared/src/appearance';
import { START_ZONE, tileCenter, ZONES } from '../shared/src/world';

const db = new PgPool(parseDbUrl(config.databaseUrl), 2);
await migrate(db, config.migrationsDir);
const repo = new Repo(db);
const acc = (await repo.findAccount('demo')) ?? (await repo.createAccount('demo', await hashPassword('demo-password')));
const have = new Set((await repo.listCharacters(acc.id)).map((c) => c.job));
const sp = ZONES[START_ZONE].spawn;
let made = 0;
for (const [i, job] of JOBS.entries()) {
  if (have.has(job)) continue;
  const name = 'Demo' + job[0].toUpperCase() + job.slice(1);
  await repo.createCharacter(acc.id, name, job, { ...defaultAppearance(job), skin: i, weapon: i % 2 }, START_ZONE, tileCenter(sp.tx + i - 3), tileCenter(sp.ty), JOBS.length);
  made++;
}
console.log(`seed: account "demo" ready, ${made} character(s) created`);
await db.close();
