// End-to-end tests against a real server process-in-test, real PostgreSQL and real Redis.
// Requires TEST_DATABASE_URL (default: local aetherion_test). The schema is dropped and re-migrated.
import WebSocket from 'ws';
import { teleportCost, zoneObjects } from '../shared/src/places';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, MAX_MESSAGE_BYTES } from '../server/src/app';
import { config, type Config } from '../server/src/config';
import { parseDbUrl, PgPool } from '../server/src/db/pgwire';
import fs from 'node:fs';
import { stepSize, tileCenter, ZONES } from '../shared/src/world';
import { defaultAppearance, parseAppearance, randomAppearance } from '../shared/src/appearance';
import { fullStats, ITEMS } from '../shared/src/items';
import { give, sendInv } from '../server/src/game/Inventory';
import { Act, Move } from '../shared/src/protocol';
import { Bot, http, sleep } from '../scripts/bot';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://aetherion:aetherion_dev@127.0.0.1:5432/aetherion_test';
let app: Awaited<ReturnType<typeof createApp>>;
let base = '';
const GRACE = 700;

before(async () => {
  const admin = new PgPool(parseDbUrl(dbUrl), 1);
  await admin.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.close();
  app = await createApp({ ...config, databaseUrl: dbUrl, host: '127.0.0.1', reconnectGraceMs: GRACE, autosaveMs: 400, authRateLimit: 10_000, mobHp: 1, levelGates: false, admins: ['acc_mod'] } as Config);
  (app.world.opts as any).events = false; // world events and night monsters only when a test starts them
  base = `http://127.0.0.1:${await app.listen(0)}`;
});
after(async () => {
  await app.close();
});

test('registration, login and validation', async () => {
  assert.equal((await http(base, '/api/health')).body.ok, true);
  const r = await http(base, '/api/register', { username: 'Alice', password: 'hunter2hunter2' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token.length > 30);
  assert.equal((await http(base, '/api/register', { username: 'alice', password: 'hunter2hunter2' })).status, 409, 'case-insensitive uniqueness');
  assert.equal((await http(base, '/api/register', { username: 'bob', password: 'short' })).status, 400);
  assert.equal((await http(base, '/api/register', { username: 'b', password: 'longenough1' })).status, 400);
  assert.equal((await http(base, '/api/register', { username: "x'; DROP TABLE accounts;--", password: 'longenough1' })).status, 400);
  assert.equal((await http(base, '/api/login', { username: 'alice', password: 'wrong-password' })).status, 401);
  assert.equal((await http(base, '/api/login', { username: 'nobody', password: 'wrong-password' })).status, 401);
  const l = await http(base, '/api/login', { username: 'ALICE', password: 'hunter2hunter2' });
  assert.equal(l.status, 200);
  const stored = await app.db.query('SELECT password_hash FROM accounts WHERE username_lower=$1', ['alice']);
  assert.ok(stored.rows[0].password_hash.startsWith('scrypt$'), 'password stored hashed');
  assert.ok(!stored.rows[0].password_hash.includes('hunter2'));
  const sess = await app.db.query('SELECT token_hash FROM sessions');
  assert.ok(sess.rows.every((s: any) => s.token_hash !== l.body.token), 'raw tokens are not stored');
  // logout invalidates the session
  assert.equal((await http(base, '/api/characters', undefined, l.body.token)).status, 200);
  await http(base, '/api/logout', {}, l.body.token);
  assert.equal((await http(base, '/api/characters', undefined, l.body.token)).status, 401);
});

test('character creation: validation, uniqueness, per-account cap, ownership', async () => {
  const t = (await http(base, '/api/register', { username: 'carol', password: 'longenough1' })).body.token;
  const ap = { ...defaultAppearance('mage'), skin: 7, hair: 5, eyes: 2, cape: 2, capeColor: 11, aura: 3, weapon: 1 };
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: ap })).status, 401);
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'paladin', appearance: ap }, t)).status, 400);
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: { ...ap, skin: 99 } }, t)).status, 400);
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: { ...ap, weapon: 2 } }, t)).status, 400);
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: { skin: 1, hair: 0, hairColor: 2, outfit: 3 } }, t)).status, 400, 'M1 shape rejected');
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage' }, t)).status, 400);
  assert.equal((await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: { ...ap, level: 99 } }, t)).status, 400);
  assert.equal((await http(base, '/api/characters', { name: '<b>x</b>', job: 'mage', appearance: ap }, t)).status, 400);
  const c = await http(base, '/api/characters', { name: 'Carol', job: 'mage', appearance: ap }, t);
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.character.appearance, ap);
  assert.equal(c.body.character.level, 1);
  assert.equal((await http(base, '/api/characters', { name: 'carol', job: 'knight', appearance: ap }, t)).status, 409);
  // 3 more in parallel + 2 extra: cap must hold under concurrency
  const rs = await Promise.all(['Ca', 'Cb', 'Cc', 'Cd', 'Ce'].map((n) => http(base, '/api/characters', { name: n + 'rol', job: 'ranger', appearance: ap }, t)));
  assert.equal(rs.filter((r) => r.status === 200).length, 3);
  assert.equal((await http(base, '/api/characters', undefined, t)).body.characters.length, 4);
  // another account cannot join with Carol's character
  const mallory = await Bot.create(base, 'mallory', 'Mallory');
  const thief = new Bot(base, mallory.token, c.body.character.id, 'x');
  await assert.rejects(thief.connect(), /Character not found/);
});

test('websocket rejects bad sessions and floods', async () => {
  const bad = new Bot(base, 'not-a-real-token-not-a-real-token', 1, 'x');
  await assert.rejects(bad.connect(), /Session expired/);
  const b = await Bot.create(base, 'flood', 'Flooder');
  await b.connect();
  for (let i = 0; i < 300; i++) b.raw({ t: 'ping', c: i });
  await b.until(() => b.closed, 2000, 'flood kick');
  assert.equal(b.kicked, 'Message rate exceeded');
  await sleep(GRACE + 1200); // let the entity despawn so it does not pollute later tests
});

test('two players share the world: movement sync, chat, appearance', async () => {
  const a = await Bot.create(base, 'acc_pa', 'Aria', 'cleric');
  const b = await Bot.create(base, 'acc_pb', 'Borin', 'berserker');
  await a.connect();
  await b.connect();
  assert.equal(a.welcome!.zone, 'eldoria');
  await a.until(() => a.remotes.has(b.characterId), 2000, 'a sees b');
  await b.until(() => b.remotes.has(a.characterId), 2000, 'b sees a');
  const seen = b.remotes.get(a.characterId)!;
  assert.equal(seen.name, 'Aria');
  assert.equal(seen.job, 'cleric');
  assert.deepEqual(seen.ap, defaultAppearance('cleric'));

  const x0 = a.x;
  await a.walk(1, 0, 20);
  assert.equal(a.x, x0 + 160, 'server moved A exactly 20 steps');
  await b.until(() => b.remotes.get(a.characterId)!.x === a.x, 2000, 'b sees a at new position');

  a.raw({ t: 'chat', text: '  hello <world>\u0007  ' });
  await b.until(() => b.chats.some((c) => c.from === 'Aria'), 2000, 'chat delivery');
  assert.equal(b.chats.find((c) => c.from === 'Aria')!.text, 'hello <world>');
  for (let i = 0; i < 12; i++) a.raw({ t: 'chat', text: 'spam ' + i });
  await a.until(() => a.chats.some((c) => !c.from && /too quickly/.test(c.text)), 2000, 'chat rate limit');
  assert.ok(b.chats.filter((c) => /^spam/.test(c.text)).length <= 5);
  a.close();
  b.close();
  await sleep(GRACE + 1200);
});

test('reconnect within grace resumes in place; after grace position is loaded from PostgreSQL', async () => {
  const a = await Bot.create(base, 'acc_rc', 'Recon');
  const w = await Bot.create(base, 'acc_rw', 'Watcher');
  await a.connect();
  await w.connect();
  await a.walk(0, 1, 10);
  const pos = { x: a.x, y: a.y };
  assert.ok(Math.abs(pos.y - (tileCenter(ZONES.eldoria.spawn.ty) + 10 * stepSize(0.95, true))) < 0.011);
  await w.until(() => w.remotes.has(a.characterId), 2000, 'watcher sees a');

  a.close();
  await sleep(150);
  assert.ok(app.world.online.has(a.characterId), 'entity kept during grace');
  await a.connect();
  assert.deepEqual({ x: a.x, y: a.y }, pos);
  assert.ok(w.remotes.has(a.characterId), 'watcher never saw a leave');

  a.close();
  await w.until(() => !w.remotes.has(a.characterId), GRACE + 2500, 'despawn after grace');
  assert.equal(app.world.online.has(a.characterId), false);
  await sleep(100);
  const row = (await app.db.query('SELECT zone_id, pos_x, pos_y FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.equal(row.zone_id, 'eldoria');
  assert.ok(Math.abs(row.pos_x - pos.x) < 0.001 && Math.abs(row.pos_y - pos.y) < 0.001);
  await a.connect();
  assert.deepEqual({ x: a.x, y: a.y }, pos, 'spawned from persisted position');
  a.close();
  w.close();
  await sleep(GRACE + 1200);
});

test('autosave persists dirty players without a disconnect', async () => {
  const a = await Bot.create(base, 'acc_as', 'Saver');
  await a.connect();
  await a.walk(-1, 0, 6);
  await sleep(1600); // autosave 400ms, housekeeping every 1s
  const row = (await app.db.query('SELECT pos_x FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.ok(Math.abs(row.pos_x - a.x) < 0.001);
  a.close();
});

test('logging in twice kicks the first connection', async () => {
  const a = await Bot.create(base, 'dup', 'Dupe');
  await a.connect();
  const a2 = new Bot(base, a.token, a.characterId, 'Dupe');
  await a2.connect();
  await a.until(() => a.closed, 2000, 'old socket closed');
  assert.match(a.kicked!, /another location/);
  assert.equal(a2.closed, false);
  a2.close();
});

test('portal travel over the network and persistence of the new zone', async () => {
  const a = await Bot.create(base, 'acc_pt', 'Porter');
  const portal = ZONES.eldoria.portals[0];
  await app.db.query('UPDATE characters SET pos_x=$1, pos_y=$2 WHERE id=$3', [tileCenter(portal.tx - 2), tileCenter(portal.ty), a.characterId]);
  await a.connect();
  for (let i = 0; i < 12 && a.welcome!.zone === 'eldoria'; i++) {
    a.input(1, 0);
    await sleep(50);
  }
  await a.until(() => a.welcome!.zone === 'verdant', 2000, 'zone change');
  assert.equal(a.x, tileCenter(portal.toTx));
  a.close();
  await sleep(GRACE + 1300);
  const row = (await app.db.query('SELECT zone_id FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.equal(row.zone_id, 'verdant');
});

test('speed hack over the wire: 40 inputs in one burst barely move the player', async () => {
  const a = await Bot.create(base, 'acc_sh', 'Speedy');
  await a.connect();
  const x0 = a.x;
  for (let i = 0; i < 40; i++) a.input(1, 0); // stays under the message-rate kick
  await sleep(500);
  assert.ok(a.x - x0 <= 13 * 8, `moved ${a.x - x0}px in 0.5s (legit max ~80px + burst)`);
  a.close();
});

// ======================= M2 =======================

test('M2: full appearance persists and is replicated exactly; gait, stats and actions sync', async () => {
  const ap = { ...randomAppearance('ranger', () => 0.73), weapon: 1 };
  assert.equal(typeof parseAppearance(ap, 'ranger'), 'object');
  const a = await Bot.create(base, 'm2_ranger', 'Sylva', 'ranger', ap);
  const b = await Bot.create(base, 'm2_mage', 'Orrin', 'mage');
  const stored = (await app.db.query('SELECT appearance FROM characters WHERE id=$1', [a.characterId])).rows[0].appearance;
  assert.deepEqual(stored, ap, 'all 22 customisation fields stored in PostgreSQL');
  await a.connect();
  await b.connect();
  assert.deepEqual(a.welcome!.stats, fullStats('ranger', 1, 1, a.welcome!.eq), 'stats use the chosen weapon (crossbow)');
  assert.deepEqual(b.welcome!.stats, fullStats('mage', 1, 0, b.welcome!.eq));
  assert.equal(a.welcome!.hp, a.welcome!.stats.maxHp);
  await b.until(() => b.remotes.has(a.characterId), 2000, 'b sees a');
  assert.deepEqual(b.remotes.get(a.characterId)!.ap, ap, 'other players receive the exact appearance and weapon');

  const x0 = a.x;
  await a.walk(1, 0, 10, 0); // walking gait
  assert.ok(Math.abs(a.x - x0 - 10 * stepSize(1.05, false)) < 0.011, `walked ${a.x - x0}`);
  await b.until(() => b.remotes.get(a.characterId)!.x === a.x, 2000, 'position sync');
  assert.equal(b.remotes.get(a.characterId)!.m, Move.Walk, 'gait replicated');
  const x1 = a.x;
  await a.walk(1, 0, 10, 1);
  assert.ok(Math.abs(a.x - x1 - 10 * stepSize(1.05, true)) < 0.011);

  for (let i = 0; i < 12; i++) {
    a.raw({ t: 'act', k: Act.Attack });
    await sleep(50);
  }
  await sleep(200);
  const atk = b.events.filter((e) => e[0] === a.characterId && e[1] === Act.Attack);
  assert.ok(atk.length >= 1 && atk.length <= 2, `crossbow interval 1040ms: ${atk.length} attacks in 0.6s`);
  a.raw({ t: 'act', k: 7 });
  a.raw({ t: 'in', s: 9999, x: 1, y: 0, r: 5 });
  await sleep(200);
  assert.equal(a.closed, false, 'malformed action/input is ignored, not fatal');
  a.close();
  b.close();
});

test('M2: migration 002 upgrades M1 characters to the v2 appearance schema', async () => {
  const pool = new PgPool(parseDbUrl(dbUrl), 1);
  const dir = new URL('../db/migrations/', import.meta.url).pathname;
  try {
    await pool.exec('DROP SCHEMA IF EXISTS mig CASCADE; CREATE SCHEMA mig; SET search_path TO mig;');
    await pool.exec(fs.readFileSync(dir + '001_init.sql', 'utf8'));
    await pool.exec(`INSERT INTO accounts(username, username_lower, password_hash) VALUES ('old','old','x');
      INSERT INTO characters(account_id, name, name_lower, job, appearance, zone_id, pos_x, pos_y) VALUES
        (1,'OldA','olda','knight','{"skin":5,"hair":3,"hairColor":7,"outfit":2}','eldoria',10,10),
        (1,'OldB','oldb','mage','{"skin":0,"hair":4,"hairColor":0,"outfit":7}','eldoria',10,10);`);
    await pool.exec(fs.readFileSync(dir + '002_appearance_v2.sql', 'utf8'));
    const rows = (await pool.query('SELECT name, job, appearance FROM characters ORDER BY id')).rows;
    for (const r of rows) assert.equal(typeof parseAppearance(r.appearance, r.job), 'object', `${r.name} valid after migration`);
    assert.deepEqual([rows[0].appearance.skin, rows[0].appearance.hair, rows[0].appearance.hairColor, rows[0].appearance.color1], [5, 3, 7, 2], 'M1 choices preserved');
    await assert.rejects(pool.exec(`UPDATE characters SET appearance='{"skin":1}'`), /characters_appearance_v2/);
  } finally {
    await pool.exec('SET search_path TO public; DROP SCHEMA IF EXISTS mig CASCADE;').catch(() => {});
    await pool.close();
  }
});

// ======================= M3 =======================

test('M3: fight over the network: targeting, server damage, kill, EXP, level-up and persistence', async () => {
  const a = await Bot.create(base, 'm3_ranger', 'Hunter', 'ranger');
  const w = await Bot.create(base, 'm3_watch', 'Onlook', 'cleric');
  await a.connect();
  await w.connect();
  const p = app.world.online.get(a.characterId)!;
  const m = app.world.spawn(p.room, 'mossling', p.x + 90, p.y);
  await a.until(() => a.remotes.has(m.id), 2000, 'monster replicated');
  assert.deepEqual([a.remotes.get(m.id)!.mt, a.remotes.get(m.id)!.hp], ['mossling', 60]);

  // cannot target another player, and a bogus id is ignored
  a.raw({ t: 'tgt', id: w.characterId });
  a.raw({ t: 'tgt', id: -987654 });
  a.raw({ t: 'tgt', id: 'x' });
  await sleep(150);
  assert.equal(p.target, null);

  a.raw({ t: 'tgt', id: m.id });
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) a.raw({ t: 'act', k: Act.Attack }); // spamming the key must not speed attacks up
  await a.until(() => a.xp > 0, 8000, 'kill credit');
  const mine = a.dmg.filter((d) => d[3] === a.characterId && d[0] === m.id);
  const maxHits = Math.floor((Date.now() - t0) / p.stats.atkIntervalMs) + 2;
  assert.ok(mine.length >= 2 && mine.length <= maxHits, `${mine.length} hits in ${Date.now() - t0}ms (max ${maxHits})`);
  // every third blow in a row is a finisher (G1), which may hit harder by its multiplier
  const cap = (k: number) => Math.ceil(p.stats.atk * 1.1 * p.stats.critDmg * k);
  assert.ok(mine.every((d, i) => d[1] <= cap(i % BASIC_COMBO.hits === BASIC_COMBO.hits - 1 ? BASIC_COMBO.mul : 1)), `no hit exceeds what the stats allow: ${mine.map((d) => d[1])} (cap ${cap(1)}, finisher ${cap(BASIC_COMBO.mul)})`);
  assert.equal(a.xp, 12);
  assert.equal(a.me!.exp, 12);
  assert.equal(a.remotes.get(m.id)?.hp ?? 0, 0);
  assert.ok(w.dmg.some((d) => d[0] === m.id), 'bystander sees the damage numbers');
  await a.until(() => !a.remotes.has(m.id), 3000, 'corpse removed');

  app.world.grantExp(p, 40);
  await a.until(() => a.level === 2, 2000, 'level-up message');
  await w.until(() => w.events.some((e) => e[0] === a.characterId && e[1] === Act.LevelUp && e[2] === 2), 2000, 'level-up broadcast');
  a.close();
  await w.until(() => !w.remotes.has(a.characterId), GRACE + 2500, 'despawn');
  await sleep(100);
  const row = (await app.db.query('SELECT level, exp FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.deepEqual(row, { level: 2, exp: 12 });
  await a.connect();
  assert.equal(a.welcome!.self.level, 2);
  assert.deepEqual(a.welcome!.stats, fullStats('ranger', 2, 0, a.welcome!.eq));
  assert.deepEqual([a.welcome!.exp, a.welcome!.next], [12, 139]);
  a.close();
  w.close();
});

test('M3: death and respawn over the network', async () => {
  const a = await Bot.create(base, 'm3_mage', 'Frail', 'mage');
  await a.connect();
  const p = app.world.online.get(a.characterId)!;
  const tusk = app.world.spawn(p.room, 'old_tusk', p.x + 40, p.y);
  await a.until(() => (a.me?.dead ?? 0) > 0, 30000, 'death');
  assert.ok(a.dmg.some((d) => d[0] === a.characterId && d[3] === tusk.id));
  const x = a.x;
  for (let i = 0; i < 5; i++) {
    a.input(1, 0);
    await sleep(50);
  }
  a.raw({ t: 'respawn' });
  await sleep(200);
  assert.equal(a.x, x, 'dead players do not move');
  assert.equal(p.dead, true, 'early respawn refused');
  await sleep(3000);
  const before = a.welcomes;
  a.raw({ t: 'respawn' });
  await a.until(() => a.welcomes > before && a.me?.dead === 0, 3000, 'respawn');
  assert.equal(a.welcome!.hp, p.maxHp);
  assert.deepEqual([a.x, a.y], [tileCenter(ZONES.eldoria.spawn.tx), tileCenter(ZONES.eldoria.spawn.ty)]);
  p.room.monsters.delete(tusk.id);
  p.room.grid.remove(tusk);
  a.close();
});

// ======================= M4 =======================

test('M4: skills and runes over the network: learn, attune, cast, cooldowns, refusals, persistence', async () => {
  const a = await Bot.create(base, 'm4_mage', 'Caster', 'mage');
  const w = await Bot.create(base, 'm4_watch', 'Viewer', 'knight');
  await a.connect();
  await w.connect();
  assert.deepEqual(a.build, { skills: {}, runes: { slots: [null, null, null], lv: {}, xp: {} } });
  assert.deepEqual(w.build!.runes.slots, [null, null]);
  const p = app.world.online.get(a.characterId)!;
  const m = app.world.spawn(p.room, 'rootwarden', p.x + 100, p.y);
  (m as any).def = { ...m.def, aggro: 0 };
  await a.until(() => a.remotes.has(m.id), 2000, 'target replicated');

  a.raw({ t: 'use', a: 'arcane_bolt', tid: m.id });
  a.raw({ t: 'use', a: 'fireball', tid: m.id });
  a.raw({ t: 'use', a: 12345 });
  a.raw({ t: 'learn', id: 'cataclysm' });
  await a.until(() => a.nos.length >= 4, 2000, 'refusals');
  assert.deepEqual(a.nos.map((n) => n.why), ['Skill not learned', 'Rune not attuned', 'Unknown ability', 'Requires level 35']);
  assert.equal(m.hp, m.maxHp);

  app.world.online.get(a.characterId)!.build.runes.lv.fire = 1; // M12: the rune has to be owned to be attuned (obtaining runes is tested separately)
  a.raw({ t: 'learn', id: 'arcane_bolt' });
  a.raw({ t: 'learn', id: 'arcane_bolt' }); // only one point at level 1
  a.raw({ t: 'rune', slot: 0, el: 'fire' });
  a.raw({ t: 'rune', slot: 1, el: 'fire' });
  a.raw({ t: 'rune', slot: 7, el: 'wind' });
  await a.until(() => a.build!.runes.slots[0] === 'fire' && a.nos.length >= 7, 2000, 'build update');
  assert.deepEqual(a.build, { skills: { arcane_bolt: 1 }, runes: { slots: ['fire', null, null], lv: { fire: 1 }, xp: {} } });
  assert.deepEqual(a.nos.slice(4).map((n) => n.why), ['No skill points', 'That rune is already in another slot', 'No such rune slot']);

  const mana = a.me!.res;
  const realRnd = app.world.rnd;
  app.world.rnd = () => 0.5; // no miss, no crit: the single cast must land for the assertions below
  for (let i = 0; i < 30; i++) {
    a.raw({ t: 'use', a: 'fireball', tid: m.id });
    await sleep(35);
  }
  await sleep(200);
  const fb = a.events.filter((e) => e[0] === a.characterId && e[1] === Act.Fx);
  assert.equal(fb.length, 1, 'one Fireball in 1.2s despite 30 requests (2.5s cooldown)');
  assert.equal(w.events.filter((e) => e[0] === a.characterId && e[1] === Act.Fx).length, 1, 'bystander sees the spell');
  // the only spend is the 14-mana Fireball; in-combat regeneration (1%/s) may add a few points back
  assert.ok(a.me!.res >= mana - 14 && a.me!.res <= mana - 14 + 8, `mana ${mana} -> ${a.me!.res}`);
  const dealt = a.dmg.filter((d) => d[0] === m.id && d[3] === a.characterId);
  assert.equal(dealt.length, 1);
  assert.ok(dealt[0][1] > 0 && dealt[0][1] <= Math.ceil(p.stats.matk * 1.6 * 1.1 * p.stats.critDmg), 'spell damage within what the stats allow');
  app.world.rnd = realRnd;
  assert.ok(a.nos.some((n) => n.why === 'Not ready'));
  assert.equal((a.build as any).runes.xp.fire, 10);

  a.close();
  await w.until(() => !w.remotes.has(a.characterId), GRACE + 2500, 'despawn');
  await sleep(150);
  const row = (await app.db.query('SELECT skills, runes FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.deepEqual(row, { skills: { arcane_bolt: 1 }, runes: { slots: ['fire', null, null], lv: { fire: 1 }, xp: { fire: 10 } } });
  await a.connect();
  assert.deepEqual(a.build, { skills: { arcane_bolt: 1 }, runes: { slots: ['fire', null, null], lv: { fire: 1 }, xp: { fire: 10 } } });
  // a tampered row is sanitised on load, never trusted
  a.close();
  await sleep(GRACE + 1300);
  await app.db.query(`UPDATE characters SET skills='{"arcane_bolt":5,"cataclysm":1,"taunt":3}', runes='{"slots":["fire","fire","void"],"lv":{"fire":999}}' WHERE id=$1`, [a.characterId]);
  await a.connect();
  assert.deepEqual(a.build, { skills: {}, runes: { slots: ['fire', null, null], lv: { fire: 50 }, xp: {} } }, 'overspent skills dropped, rune level clamped');
  p.room.monsters.delete(m.id);
  a.close();
  w.close();
});

// ======================= M5 =======================

test('M5: party over the network: invite by name, accept/decline, shared EXP, chat channels, disconnect and disband', async () => {
  const a = await Bot.create(base, 'm5_lead', 'Captain', 'knight');
  const b = await Bot.create(base, 'm5_heal', 'Medic', 'cleric');
  const c = await Bot.create(base, 'm5_solo', 'Loner', 'ranger');
  await Promise.all([a.connect(), b.connect(), c.connect()]);
  const pa = app.world.online.get(a.characterId)!, pb = app.world.online.get(b.characterId)!;

  a.raw({ t: 'party', op: 'invite', name: 'medic' });
  await b.until(() => b.invites.length === 1, 2000, 'invitation');
  assert.deepEqual(b.invites[0], { from: 'Captain', id: a.characterId });
  b.raw({ t: 'party', op: 'accept' });
  await a.until(() => a.party?.members.length === 2 && b.party?.members.length === 2, 2000, 'party formed');
  assert.deepEqual(a.party!.members.map((m) => [m.name, m.job]), [['Captain', 'knight'], ['Medic', 'cleric']]);
  assert.equal(b.party!.leader, a.characterId);

  // a second invite needs the rate limit to pass; a decline is reported to the inviter
  await sleep(1600);
  a.raw({ t: 'party', op: 'invite', id: c.characterId });
  await c.until(() => c.invites.length === 1, 2000, 'second invitation');
  c.raw({ t: 'party', op: 'decline' });
  await a.until(() => a.chats.some((x) => x.text === 'Loner declined your invitation.'), 2000, 'decline notice');
  // forged commands from a non-member / non-leader
  c.raw({ t: 'party', op: 'kick', id: b.characterId });
  b.raw({ t: 'party', op: 'kick', id: a.characterId });
  b.raw({ t: 'party', op: 'promote', id: b.characterId });
  await b.until(() => b.nos.length >= 2 && c.nos.length >= 1, 2000, 'refusals');
  assert.deepEqual([c.nos[0].why, b.nos[0].why], ['You are not in a party', 'Only the party leader can do that']);
  assert.equal(pa.party!.members.length, 2);

  // channels
  a.raw({ t: 'chat', text: 'party only', ch: 'party' });
  c.raw({ t: 'chat', text: 'secret', ch: 'whisper', to: 'CAPTAIN' });
  await a.until(() => a.chats.some((x) => x.ch === 'whisper') && b.chats.some((x) => x.ch === 'party'), 2000, 'chat');
  await sleep(150);
  assert.equal(c.chats.some((x) => x.text === 'party only'), false, 'outsider cannot read party chat');
  assert.equal(b.chats.some((x) => x.text === 'secret'), false, 'whisper is private');
  assert.deepEqual(a.chats.find((x) => x.ch === 'whisper'), { from: 'Loner', text: 'secret', ch: 'whisper', to: 'Captain' });

  // shared EXP: the healer stands by and still earns
  const m = app.world.spawn(pa.room, 'mossling', pa.x + 30, pa.y);
  await a.until(() => a.remotes.has(m.id), 2000, 'monster');
  a.raw({ t: 'tgt', id: m.id });
  a.raw({ t: 'act', k: 0 });
  await b.until(() => b.xp > 0 && a.xp > 0, 12000, 'both rewarded');
  assert.equal(a.xp, Math.round((12 * 1.1) / 2));
  assert.equal(b.xp, a.xp);
  assert.equal(pb.exp, b.xp);

  // frames follow HP; a dropped connection shows as offline, then the party disbands when the member is gone
  app.world.hurt(pb, 33, 0, null);
  await a.until(() => a.party!.members[1].hp === pb.maxHp - 33, 2500, 'frame HP');
  b.close();
  await a.until(() => a.party !== null && a.party.members[1]?.on === false, 2500, 'offline flag').catch(() => {}); // grace is short in tests; may go straight to disband
  await a.until(() => a.party === null, GRACE + 3000, 'disbanded');
  assert.ok(a.chats.some((x) => x.text === 'The party has been disbanded.'));
  assert.equal(app.world.parties.count, 0);
  a.close();
  c.close();
});

test('M6: inventory over the network with PostgreSQL: starter kit, loot, equip, shop, upgrade, persistence, tamper-proofing', async () => {
  const a = await Bot.create(base, 'm6_ranger', 'Looter', 'ranger', { ...defaultAppearance('ranger'), weapon: 1 });
  const w = await Bot.create(base, 'm6_watch', 'Onlooker', 'cleric');
  await a.connect();
  await w.connect();
  assert.equal(a.eq.weapon!.base, 'crossbow', 'the starting weapon follows the weapon chosen in the creator');
  assert.deepEqual(a.inv.map((i) => [i.base, i.qty]), [['hp_potion', 3]]);
  assert.equal(a.gold, 0);
  const p = app.world.online.get(a.characterId)!;
  // a real kill with every drop chance forced: gold, equipment, potion and stone arrive as one loot message
  const realRnd = app.world.rnd;
  app.world.rnd = () => 0.01;
  const m = app.world.spawn(p.room, 'old_tusk', p.x + 40, p.y);
  app.world.hurt(m, 1e9, 0, p);
  app.world.rnd = realRnd;
  await a.until(() => a.loots.length === 1 && a.inv.length >= 3, 2000, 'loot');
  assert.ok(a.loots[0].gold > 0 && a.gold === a.loots[0].gold);
  assert.equal(w.loots.length, 0, 'loot is personal');
  const gear = a.inv.find((i) => ITEMS[i.base].kind === 'equip')!;
  assert.ok(gear.rar >= 1 && gear.rar <= 3, 'elite drops are Uncommon to Epic');
  // forged requests: someone else's uid, a made-up uid, buying without gold, selling far from the shop is covered in unit tests
  { const shop = zoneObjects('eldoria').find((o) => o.kind === 'merchant')!; app.world.relocate(p, p.room, shop.x, shop.y + 40); await sleep(300); } // the shop is the armoury now, not the plaza
  a.raw({ t: 'inv', op: 'equip', uid: 'made-up' });
  a.raw({ t: 'inv', op: 'buy', base: 'hp_potion', qty: 999 });
  a.raw({ t: 'inv', op: 'sell', uid: w.inv[0].uid });
  a.raw({ t: 'inv', op: 'upgrade', uid: a.eq.weapon!.uid });
  a.raw({ t: 'inv' });
  await a.until(() => a.nos.filter((n) => n.a === 'inv').length >= 5, 2000, 'refusals');
  assert.deepEqual(a.nos.filter((n) => n.a === 'inv').map((n) => n.why), ['Item not found', 'Not enough gold', 'Item not found', 'Cannot upgrade in combat', 'Unknown inventory command']);
  assert.equal(w.inv[0].qty, 3, "another player's items cannot be touched");
  // legitimate flow: buy a potion in the plaza, drink is refused at full health, sell a potion
  p.gold += 100; // monsters carry little gold now
  const g0 = p.gold;
  a.raw({ t: 'inv', op: 'buy', base: 'hp_potion', qty: 1 });
  await a.until(() => a.gold === g0 - ITEMS.hp_potion.price, 2000, 'bought');
  a.raw({ t: 'inv', op: 'sell', uid: a.inv.find((i) => i.base === 'hp_potion')!.uid, qty: 1 });
  await a.until(() => a.gold === g0 - ITEMS.hp_potion.price + 5, 2000, 'sold');
  // equipment changes are visible to the other player
  p.level = 60;
  app.world.grantExp(p, 0);
  const helm = { base: 'leather_cap', rar: 4, ilvl: 10, aff: [['dodge', 1], ['def', 4], ['maxHp', 30], ['crit', 1]] as any, up: 0, qty: 1 };
  give(p, helm);
  sendInv(app.world, p);
  await a.until(() => a.inv.some((i) => i.base === 'leather_cap'), 2000, 'helm arrived');
  a.raw({ t: 'inv', op: 'equip', uid: a.inv.find((i) => i.base === 'leather_cap')!.uid });
  await a.until(() => a.eq.helmet?.base === 'leather_cap', 2000, 'equipped');
  await w.until(() => w.remotes.get(a.characterId)?.ap?.helmet === ITEMS.leather_cap.look!.helmet, 2000, 'look replicated');
  assert.deepEqual(p.stats, fullStats('ranger', p.level, 1, a.eq));

  // logout -> PostgreSQL -> login
  const want = { inv: a.inv, eq: a.eq, gold: a.gold };
  a.close();
  await w.until(() => !w.remotes.has(a.characterId), GRACE + 2500, 'despawn');
  await sleep(200);
  const row = (await app.db.query('SELECT gold, inventory, equipment FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.equal(Number(row.gold), want.gold);
  assert.deepEqual(row.inventory, want.inv);
  assert.deepEqual(row.equipment, { ...want.eq, kit: true });
  await a.connect();
  assert.deepEqual({ inv: a.inv, eq: a.eq, gold: a.gold }, want, 'everything is back after logging in again; no second starter kit');

  // a tampered row (duplicated item, impossible upgrade, equipment for another job) is corrected on load
  a.close();
  await sleep(GRACE + 1300);
  const dup = want.eq.helmet!;
  await app.db.query('UPDATE characters SET inventory=$2::jsonb, equipment=$3::jsonb WHERE id=$1', [a.characterId,
    JSON.stringify([dup, dup, { ...dup, uid: 'zz', up: 500, rar: 5, aff: [['atk', 1e9]] }]),
    JSON.stringify({ weapon: { uid: 'kk', base: 'longsword', rar: 5, ilvl: 80, aff: [], up: 10, qty: 1 }, helmet: dup, kit: true })]);
  await a.connect();
  assert.equal(a.eq.weapon, undefined, 'a knight sword is not left equipped on a ranger');
  assert.equal([...a.inv, ...Object.values(a.eq)].filter((i) => i!.uid === dup.uid).length, 1, 'duplicates collapse to one instance');
  const zz = a.inv.find((i) => i.uid === 'zz')!;
  assert.equal(zz.up, 10);
  assert.ok(zz.aff[0][1] < 100, 'forged affix clamped');
  a.close();
  w.close();
  // the constraint in the database refuses negative gold outright
  await assert.rejects(app.db.query('UPDATE characters SET gold=-1 WHERE id=$1', [a.characterId]));
});

test('M7: a party runs a dungeon over the network: gate, instance, stages, boss, loot in PostgreSQL, return to the gate', async () => {
  const a = await Bot.create(base, 'm7_tank', 'Vanguard', 'knight');
  const b = await Bot.create(base, 'm7_heal', 'Mender', 'cleric');
  const c = await Bot.create(base, 'm7_other', 'Passerby', 'ranger');
  for (const x of [a, b, c]) await x.connect();
  const w = app.world, gate = ZONES.verdant.gates![0];
  const [pa, pb, pc] = [a, b, c].map((x) => w.online.get(x.characterId)!);
  for (const [i, p] of [pa, pb, pc].entries()) {
    p.level = 12;
    w.grantExp(p, 0);
    p.recalc();
    p.hp = p.maxHp;
    w.relocate(p, w.roomIn('verdant', p), tileCenter(gate.tx) + (i - 1) * 30, tileCenter(gate.ty) - 40);
  }
  await a.until(() => a.zone === 'verdant' && b.zone === 'verdant', 2000, 'moved to the gate');
  a.raw({ t: 'party', op: 'invite', id: b.characterId });
  await b.until(() => b.invites.length > 0, 2000, 'invite');
  b.raw({ t: 'party', op: 'accept' });
  await a.until(() => a.party?.members.length === 2, 2000, 'party');
  // loot mode: only the leader, replicated to members
  b.raw({ t: 'party', op: 'loot', mode: 'roundrobin' });
  a.raw({ t: 'party', op: 'loot', mode: 'roundrobin' });
  await b.until(() => b.party?.loot === 'roundrobin', 2000, 'loot mode');
  assert.ok(b.nos.some((n) => n.a === 'party' && n.why === 'Only the party leader can do that'));
  // refusals over the wire
  b.raw({ t: 'dng', op: 'enter', id: 'ruins', diff: 'normal' });
  a.raw({ t: 'dng', op: 'enter', id: 'temple', diff: 'normal' });
  a.raw({ t: 'dng', op: 'teleport' });
  await a.until(() => a.nos.filter((n) => n.a === 'dng').length === 2 && b.nos.some((n) => n.a === 'dng'), 2000, 'refusals');
  assert.deepEqual(a.nos.filter((n) => n.a === 'dng').map((n) => n.why), ['You need to stand at the dungeon entrance', 'Unknown dungeon command']);
  assert.equal(b.nos.find((n) => n.a === 'dng')!.why, 'Only the party leader can open a dungeon');
  // enter: both members are moved into a private instance; the bystander is not
  a.raw({ t: 'dng', op: 'enter', id: 'ruins', diff: 'hard' });
  // every member is asked and must agree before anyone goes in
  await b.until(() => b.ready?.id === 'ruins', 3000, 'ready check');
  b.raw({ t: 'dng', op: 'ready', yes: true });
  await a.until(() => a.zone === 'd_ruins' && b.zone === 'd_ruins' && !!a.dungeon && !!b.dungeon, 3000, 'inside');
  assert.equal(c.zone, 'verdant');
  assert.deepEqual([a.dungeon!.id, a.dungeon!.diff, a.dungeon!.stage, a.dungeon!.left], ['ruins', 'hard', 0, 9]);
  assert.equal(pa.room, pb.room);
  assert.notEqual(pa.room, pc.room);
  const run = w.dungeons.runs.get(pa.room)!;
  // the clients see the instance's monsters (walk in range first: the first chamber is east of the entry hall)
  const first = [...run.alive][0];
  w.relocate(pa, pa.room, first.x - 120, first.y);
  w.relocate(pb, pb.room, first.x - 150, first.y);
  await a.until(() => [...a.remotes.values()].some((r) => r.mt === first.def.id), 3000, 'monsters replicated');
  for (let s = 0; s < 3; s++) {
    for (const m of [...run.alive]) w.hurt(m, 1e9, 0, pa);
    await a.until(() => a.dungeon?.stage === s + 1, 6000, `stage ${s + 2}`);
  }
  assert.ok(a.anns.some((t) => /The way to Ancient Rune Guardian is open/.test(t)));
  const boss = [...run.alive][0];
  w.relocate(pa, pa.room, boss.x - 100, boss.y);
  w.relocate(pb, pb.room, boss.x - 140, boss.y);
  await a.until(() => [...a.remotes.values()].some((r) => r.mt === 'rune_guardian'), 3000, 'boss visible');
  a.loots.length = b.loots.length = 0;
  w.hurt(boss, Math.ceil(boss.maxHp * 0.5), 0, pa);
  await a.until(() => a.anns.some((t) => /seals shatter/.test(t)), 3000, 'phase announcement');
  w.hurt(boss, 1e9, 0, pa);
  await a.until(() => a.dungeon?.state === 'cleared' && a.loots.length >= 2 && b.loots.length >= 2, 4000, 'cleared');
  for (const x of [a, b]) {
    assert.ok(x.loots.flatMap((l) => l.items).some((i) => i.rar >= 3), 'each member received a boss item');
    assert.ok(x.inv.some((i) => i.rar >= 3 && ITEMS[i.base].kind === 'equip'));
  }
  assert.equal(c.loots.length, 0);
  assert.ok(a.dungeon!.closeIn > 0);
  // leaving: back at the gate; the reward is in the database after logout
  a.raw({ t: 'dng', op: 'leave' });
  await a.until(() => a.zone === 'verdant' && a.dungeon === null, 3000, 'left');
  assert.ok(Math.hypot(pa.x - (tileCenter(gate.tx) - 30), pa.y - (tileCenter(gate.ty) - 40)) < 1, 'returned to where they entered');
  const bossItem = a.inv.find((i) => i.rar >= 3 && ITEMS[i.base].kind === 'equip')!;
  b.close(); // logs out while still inside the instance
  a.close();
  await sleep(GRACE + 1500);
  const rows = (await app.db.query('SELECT name, zone_id, inventory, gold FROM characters WHERE id IN ($1, $2) ORDER BY name', [a.characterId, b.characterId])).rows;
  assert.deepEqual(rows.map((r: any) => r.zone_id), ['verdant', 'verdant'], 'the saved location is the entrance, never the instance');
  assert.ok(rows.find((r: any) => r.name === 'Vanguard').inventory.some((i: any) => i.uid === bossItem.uid));
  assert.ok(Number(rows[0].gold) > 0 && Number(rows[1].gold) > 0);
  c.close();
});

test('M8: travel, gathering, crafting and discoveries over the network, persisted in PostgreSQL', async () => {
  const a = await Bot.create(base, 'm8_walker', 'Wayfarer', 'ranger');
  await a.connect();
  const w = app.world, p = w.online.get(a.characterId)!;
  assert.deepEqual(a.welcome!.disc, ['wp:eldoria']);
  const keeper = (z: string) => zoneObjects(z).find((o) => o.kind === 'waykeeper')!;
  // walking through the portal chain reaches the next region; standing by its keeper attunes the waystone
  w.relocate(p, w.roomIn('verdant', p), keeper('verdant').x + 40, keeper('verdant').y + 40);
  await a.until(() => a.disc.includes('wp:verdant'), 3000, 'waystone attuned');
  assert.ok(a.chats.some((c) => /Waystone attuned: Mosswatch/.test(c.text)));
  // gather from a node, through the wire
  const node = zoneObjects('verdant').find((o) => o.kind === 'node')!;
  w.relocate(p, p.room, node.x, node.y);
  await a.until(() => a.zone === 'verdant' && Math.abs(a.x - node.x) < 1, 2000, 'at the node');
  a.loots.length = 0;
  // gathering takes GATHER_MS standing still; asking again once it is done finds the node spent
  a.raw({ t: 'obj', op: 'gather', id: node.id });
  await a.until(() => a.loots.length === 1, GATHER_MS + 3000, 'gathered once');
  a.raw({ t: 'obj', op: 'gather', id: node.id });
  await a.until(() => a.nos.some((n) => n.a === 'obj'), 2000, 'the node is spent');
  assert.equal(a.nos.find((n) => n.a === 'obj')!.why, 'Nothing left to gather here yet');
  assert.ok(a.inv.some((i) => i.base === node.res));
  assert.ok(a.nodes.some(([id]) => id === node.id));
  // a hidden cache
  const cache = zoneObjects('verdant').find((o) => o.kind === 'cache')!;
  w.relocate(p, p.room, cache.x, cache.y);
  a.raw({ t: 'obj', op: 'open', id: cache.id });
  await a.until(() => a.disc.includes(cache.id), 2000, 'cache opened');
  const gold = a.gold;
  assert.ok(gold >= 50 + 80 * ZONES.verdant.level[0]);
  // travel by waystone: refused away from a keeper, then accepted
  a.raw({ t: 'obj', op: 'tp', to: 'eldoria' });
  await a.until(() => a.nos.some((n) => n.why === 'You need to be at a waystone'), 2000, 'refused');
  w.relocate(p, p.room, keeper('verdant').x, keeper('verdant').y + 30);
  p.lastCombat = -1e6;
  a.raw({ t: 'obj', op: 'tp', to: 'eldoria' });
  await a.until(() => a.zone === 'eldoria', 3000, 'travelled');
  assert.equal(a.gold, gold - teleportCost('eldoria'));
  // craft at the merchant
  const mer = zoneObjects('eldoria').find((o) => o.kind === 'merchant')!;
  w.relocate(p, p.room, mer.x, mer.y + 30);
  give(p, { base: 'moonleaf', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 });
  const pots = () => a.inv.reduce((n, i) => n + (i.base === 'hp_potion' ? i.qty : 0), 0), before = pots();
  a.raw({ t: 'obj', op: 'craft', recipe: 'hp' });
  await a.until(() => pots() === before + 1, 2000, 'crafted');
  // persistence
  a.close();
  await sleep(GRACE + 1500);
  const row = (await app.db.query('SELECT discoveries, zone_id FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.deepEqual([...row.discoveries].sort(), [cache.id, 'wp:eldoria', 'wp:verdant'].sort());
  assert.equal(row.zone_id, 'eldoria');
  await a.connect();
  assert.deepEqual([...a.welcome!.disc].sort(), [cache.id, 'wp:eldoria', 'wp:verdant'].sort());
  a.close();
});

// ================= M9: security hardening =================
/** Opens a raw game socket and reports how the handshake or the first exchange ended. */
function rawSocket(url: string, opts: any = {}): Promise<{ ws: any; open: boolean; status?: number }> {
  return new Promise((resolve) => {
    const ws = new (WebSocket as any)(url, opts);
    ws.on('open', () => resolve({ ws, open: true }));
    ws.on('unexpected-response', (_req: unknown, res: any) => { resolve({ ws, open: false, status: res.statusCode }); ws.terminate(); });
    ws.on('error', () => resolve({ ws, open: false }));
  });
}
const wsUrl = (b: string) => b.replace('http', 'ws') + '/ws';

test('M9 security: headers, static path traversal, body limits and metrics access', async () => {
  for (const path of ['/', '/api/health', '/api/nope']) {
    const r = await fetch(base + path);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', path);
    const csp = r.headers.get('content-security-policy')!;
    assert.ok(/default-src 'self'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && /frame-ancestors 'none'/.test(csp), `${path}: ${csp}`);
  }
  // the client page obeys its own policy: no inline scripts
  const html = await (await fetch(base + '/')).text();
  assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) ?? []).length, 0, 'no inline script in index.html');
  // files outside the client directory are never served
  for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/server/src/config.ts', '/assets/../../package.json']) {
    const r = await fetch(base + p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.ok(!(await r.text()).includes('aetherion-online'), `${p} leaked a file`);
  }
  // oversized bodies and malformed JSON are refused before any work is done
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ username: 'x'.repeat(20000), password: 'y' }) })).status, 413);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: '{not json' })).status, 400);
  assert.equal((await http(base, '/api/characters')).status, 401, 'no token, no data');
  assert.equal((await http(base, '/api/characters', undefined, 'A'.repeat(43))).status, 401, 'a made-up token is not a session');
  // metrics: the default app has no token, so only loopback may read them (this test is loopback)
  const m = await http(base, '/api/metrics');
  assert.equal(m.status, 200);
  assert.ok(typeof m.body.sockets === 'number' && m.body.tickMs);
});

test('M9 security: metrics token, trusted proxy addresses, socket origin and per-address connection limits', async () => {
  const app2 = await createApp({ ...config, databaseUrl: dbUrl, host: '127.0.0.1', reconnectGraceMs: GRACE, autosaveMs: 60000, authRateLimit: 3, metricsToken: 'm'.repeat(32), trustProxy: 1, allowedOrigins: ['https://play.example'], maxConnectionsPerIp: 2 });
  const b2 = `http://127.0.0.1:${await app2.listen(0)}`;
  try {
    // metrics need the token, compared in constant time
    assert.equal((await http(b2, '/api/metrics')).status, 403);
    assert.equal((await http(b2, '/api/metrics', undefined, 'wrong')).status, 403);
    assert.equal((await http(b2, '/api/metrics', undefined, 'n'.repeat(32))).status, 403);
    assert.equal((await http(b2, '/api/metrics', undefined, 'm'.repeat(32))).status, 200);
    // rate limiting follows the address the trusted proxy reports: the last X-Forwarded-For entry
    const login = (xff: string) => fetch(b2 + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': xff }, body: JSON.stringify({ username: 'nobody_here', password: 'whatever12' }) }).then((r) => r.status);
    const ipA = `203.0.113.${1 + (Date.now() % 200)}`, ipB = `198.51.100.${1 + (Date.now() % 200)}`;
    assert.deepEqual([await login(ipA), await login(ipA), await login(ipA), await login(ipA)], [401, 401, 401, 429], 'three attempts a minute per address');
    assert.equal(await login(ipB), 401, 'another address is not affected');
    assert.equal(await login(`${ipB}, ${ipA}`), 429, 'the entry added by the trusted proxy counts');
    assert.equal(await login(`${ipA}, 192.0.2.77`), 401, 'a client cannot pick its address by sending its own header: only the last entry is used');
    // origin: this server's own origin and listed origins pass, other sites are refused at the handshake
    const evil = await rawSocket(wsUrl(b2), { origin: 'https://evil.example' });
    assert.deepEqual([evil.open, evil.status], [false, 403]);
    const garbage = await rawSocket(wsUrl(b2), { origin: 'not a url' });
    assert.equal(garbage.open, false);
    const own = await rawSocket(wsUrl(b2), { origin: b2 });
    assert.equal(own.open, true);
    const listed = await rawSocket(wsUrl(b2), { origin: 'https://play.example' });
    assert.equal(listed.open, true);
    // two sockets from this address are open: the third is refused, and a slot frees when one closes
    const third = await rawSocket(wsUrl(b2));
    assert.deepEqual([third.open, third.status], [false, 429]);
    own.ws.close();
    await sleep(150);
    const again = await rawSocket(wsUrl(b2));
    assert.equal(again.open, true);
    // a socket that never authenticates is dropped; oversized and binary frames end the connection
    const closed = (ws: any) => new Promise<number>((r) => ws.on('close', (code: number) => r(code)));
    again.ws.send('x'.repeat(MAX_MESSAGE_BYTES + 1));
    assert.equal(await closed(again.ws), 1009, 'message larger than the limit');
    listed.ws.send(Buffer.from([1, 2, 3]));
    await closed(listed.ws);
    const idle = await rawSocket(wsUrl(b2));
    assert.equal(idle.open, true);
    const t0 = Date.now();
    await closed(idle.ws);
    assert.ok(Date.now() - t0 >= 4000 && Date.now() - t0 < 7000, 'join timeout after 5 s');
  } finally {
    await app2.close();
  }
  // without a trusted proxy the header is ignored entirely (default app, generous limit: just check it is not used as a key)
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.250' }, body: JSON.stringify({ username: 'nobody_here', password: 'whatever12' }) });
  assert.equal(r.status, 401);
});

test('M9 security: a flood of messages or of game commands cannot hurt the server or other players', async () => {
  const a = await Bot.create(base, 'm9_flood', 'Hammerer', 'mage');
  const b = await Bot.create(base, 'm9_calm', 'Onwatch', 'knight');
  await a.connect();
  await b.connect();
  const p = app.world.online.get(a.characterId)!, gold = p.gold, items = p.inv.length;
  // a burst of every command the protocol has, with hostile arguments
  const junk = [{ t: 'inv', op: 'buy', base: 'upgrade_stone', qty: 1e9 }, { t: 'inv', op: 'sell', uid: null }, { t: 'obj', op: 'tp', to: '__proto__' }, { t: 'obj', op: 'open', id: { $ne: 1 } },
    { t: 'dng', op: 'enter', id: 'ruins', diff: ['x'] }, { t: 'party', op: 'loot', mode: 'constructor' }, { t: 'use', a: 'toString', tid: -1e308 }, { t: 'in', s: 1e400, x: 9, y: 'a', r: 1 },
    { t: 'chat', text: '<img src=x onerror=alert(1)>', ch: 'zone' }, { t: 'rune', slot: -1, el: 'hasOwnProperty' }, { t: 'learn', id: '__proto__' }, { t: 'tgt', id: 1.5 }];
  for (const m of junk) a.raw(m);
  await sleep(300);
  assert.equal(p.gold, gold);
  assert.equal(p.inv.length, items);
  assert.equal(a.kicked, null, 'bad arguments are refused, not fatal');
  assert.ok(b.chats.some((c) => c.text === '<img src=x onerror=alert(1)>'), 'chat is relayed as plain text (the client renders text nodes, never HTML)');
  // far more messages than the budget (60 burst, 40/s): the sender is disconnected, the world is fine
  for (let i = 0; i < 400; i++) a.raw({ t: 'ping', c: i });
  await a.until(() => a.kicked !== null, 3000, 'kicked').catch(() => {});
  assert.equal(a.kicked, 'Message rate exceeded');
  assert.equal(b.kicked, null);
  const tick = app.world.metrics().tick;
  await sleep(300);
  assert.ok(app.world.metrics().tick > tick + 3, 'the simulation keeps ticking');
  b.close();
});

// ---------------------------------------------------------------------------------------------
// M10: audio settings API and audio file serving
// ---------------------------------------------------------------------------------------------
import { AUDIO_DEFS, DEFAULT_AUDIO_SETTINGS } from '../shared/src/audio';

/** The audio part of a settings reply (M16 added the game section next to it). */
const audioOf = (b: any) => ({ audio: b.audio, saved: b.saved });
test('M10 audio settings: stored per account in PostgreSQL, validated by the server, private to the account', async () => {
  const reg = async (u: string) => (await http(base, '/api/register', { username: u, password: 'longenough1' })).body.token as string;
  const t1 = await reg('aud_one'), t2 = await reg('aud_two');
  const put = async (token: string | undefined, body: unknown) => {
    const r = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const row = async (u: string) => (await app.db.query<{ settings: any }>('SELECT s.settings FROM account_settings s JOIN accounts a ON a.id = s.account_id WHERE a.username_lower = $1', [u])).rows;

  // a session is required
  assert.equal((await http(base, '/api/settings')).status, 401);
  assert.equal((await put(undefined, { audio: DEFAULT_AUDIO_SETTINGS })).status, 401);
  assert.equal((await put('not-a-token', { audio: DEFAULT_AUDIO_SETTINGS })).status, 401);

  // a new account: the defaults, and nothing stored yet
  assert.deepEqual(audioOf((await http(base, '/api/settings', undefined, t1)).body), { audio: DEFAULT_AUDIO_SETTINGS, saved: false });
  assert.equal((await row('aud_one')).length, 0);

  // saving, reading back, and what is actually in the database
  const mine = { master: 0.35, music: 0, sfx: 1, ambient: 0.2, muteAll: true, musicOn: false, sfxOn: true };
  const saved = await put(t1, { audio: mine });
  assert.equal(saved.status, 200);
  assert.deepEqual(audioOf(saved.body), { audio: mine, saved: true });
  assert.deepEqual(audioOf((await http(base, '/api/settings', undefined, t1)).body), { audio: mine, saved: true });
  assert.deepEqual((await row('aud_one'))[0].settings, { audio: mine });

  // another account is unaffected; a second save replaces the first (one row per account)
  assert.deepEqual(audioOf((await http(base, '/api/settings', undefined, t2)).body), { audio: DEFAULT_AUDIO_SETTINGS, saved: false });
  const next = { ...mine, master: 0.8, muteAll: false };
  assert.equal((await put(t1, { audio: next })).status, 200);
  assert.equal((await row('aud_one')).length, 1);
  assert.deepEqual((await row('aud_one'))[0].settings.audio, next);

  // the server validates: out of range, wrong types, missing or unknown keys are all refused and change nothing
  const bad: unknown[] = [
    {}, { audio: null }, { audio: 'loud' }, [1, 2], { audio: { ...mine, master: 1.5 } }, { audio: { ...mine, music: -0.1 } }, { audio: { ...mine, sfx: '1' } },
    { audio: { ...mine, ambient: null } }, { audio: { ...mine, muteAll: 'yes' } }, { audio: { master: 1 } }, { audio: { ...mine, extra: 1 } }, { audio: mine, admin: true },
  ];
  for (const b of bad) assert.equal((await put(t1, b)).status, 400, JSON.stringify(b));
  assert.deepEqual((await row('aud_one'))[0].settings.audio, next, 'refused requests left the stored settings alone');
  const garbage = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t1 }, body: '{not json' });
  assert.equal(garbage.status, 400);

  // even if a row is damaged, what a client receives is valid
  await app.db.query(`UPDATE account_settings SET settings = '{"audio":{"master":9,"music":"loud","sfxOn":false,"hack":true}}'::jsonb WHERE account_id = (SELECT id FROM accounts WHERE username_lower = 'aud_one')`);
  assert.deepEqual(audioOf((await http(base, '/api/settings', undefined, t1)).body), { audio: { ...DEFAULT_AUDIO_SETTINGS, master: 1, sfxOn: false }, saved: true });

  // settings belong to the account, not the session: they are there after signing out and in again
  assert.equal((await put(t1, { audio: mine })).status, 200);
  await http(base, '/api/logout', {}, t1);
  assert.equal((await http(base, '/api/settings', undefined, t1)).status, 401);
  const again = (await http(base, '/api/login', { username: 'aud_one', password: 'longenough1' })).body.token;
  assert.deepEqual(audioOf((await http(base, '/api/settings', undefined, again)).body), { audio: mine, saved: true });

  // saving is rate limited per account (60 a minute), and one account's limit is not another's
  let limited = 0;
  for (let i = 0; i < 64; i++) if ((await put(t2, { audio: DEFAULT_AUDIO_SETTINGS })).status === 429) limited++;
  assert.ok(limited >= 3 && limited <= 5, `the 61st save onward is refused (${limited} refused)`);
  assert.equal((await put(again, { audio: mine })).status, 200);
});

test('M10 audio files: every sound is served, as audio, and may be cached for good when requested by content hash', async () => {
  const mres = await fetch(base + '/audio/manifest.json');
  assert.equal(mres.status, 200);
  assert.equal(mres.headers.get('cache-control'), 'no-cache', 'the manifest is always revalidated');
  const m = (await mres.json()) as { version: number; assets: any[] };
  assert.equal(m.version, 1);
  assert.deepEqual(m.assets.map((a) => a.id).sort(), AUDIO_DEFS.map((d) => d.id).sort(), 'the build ships every sound in the catalogue');
  assert.ok(m.assets.every((a) => a.temporary === false), 'and tells the client they are recorded, not placeholders');
  for (const id of ['BGM-002', 'rune.fireball_cast', 'AMB-FOREST']) {
    const e = m.assets.find((a) => a.id === id);
    const r = await fetch(`${base}/audio/${e.file}?v=${e.v}`);
    assert.equal(r.status, 200, id);
    assert.equal(r.headers.get('content-type'), 'audio/ogg');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'a hashed URL never changes, so it is cached for good');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(body.length, e.bytes);
    assert.equal(body.toString('latin1', 0, 4), 'OggS');
    assert.equal((await fetch(`${base}/audio/${e.file}`)).headers.get('cache-control'), 'no-cache', 'without the hash it is revalidated');
  }
  assert.equal((await fetch(base + '/app.js?v=1')).headers.get('cache-control'), 'no-cache', 'only audio gets the long cache');
  for (const p of ['/audio/../../package.json', '/audio/%2e%2e/%2e%2e/package.json', '/audio/music/../../../package.json?v=1']) {
    const r = await fetch(base + p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.ok(!(await r.text()).includes('aetherion-online'), 'nothing outside the client folder is served');
  }
  assert.equal((await fetch(base + '/audio/music/nope.ogg?v=1')).status, 404);
});

// ---------------------------------------------------------------------------------------------
// M11 and trading over the real network and database
// ---------------------------------------------------------------------------------------------
import { autoKind, DEFAULT_AUTO } from '../shared/src/autohunt';
import { ABILITIES, jobActives, runeSpells } from '../shared/src/abilities';

test('M11 auto hunting over the network: session messages, and the configuration stored with the character', async () => {
  const a = await Bot.create(base, 'acc_auto', 'Autohuntr', 'mage');
  await a.connect();
  assert.deepEqual(a.welcome!.auto, DEFAULT_AUTO, 'a new character has the default configuration');
  const autos: any[] = [];
  a.ws!.on('message', (d: Buffer) => { const m = JSON.parse(d.toString()); if (m.t === 'auto') autos.push(m); });
  a.raw({ t: 'auto', on: true, cfg: { ...DEFAULT_AUTO, hpPct: 77, mpPct: 22, radius: 9, lootMode: 'rare', onFull: 'stop', returnTo: 'town', skillList: [{ id: 'arcane_bolt', on: true, pri: 0, minMp: 35, minEnemies: 1, hpBelow: 100 }, { id: 'blink', on: true }] } });
  await a.until(() => autos.length > 0, 2000, 'auto reply');
  assert.equal(autos[0].on, true);
  assert.deepEqual([autos[0].cfg.hpPct, autos[0].cfg.lootMode, autos[0].cfg.skillList.map((s: any) => s.id)], [77, 'rare', ['arcane_bolt', 'blink']], 'the server answers with the cleaned configuration (Blink may now be automated)');
  const p = app.world.online.get(a.characterId)!;
  assert.equal(p.autoOn, true);
  // a kill made during the session is counted by the server and reported
  const mob = app.world.spawn(p.room, 'mossling', p.x + 40, p.y);
  app.world.hurt(mob, 1e6, 0, p);
  await a.until(() => autos.some((m) => m.stats.kills === 1 && m.stats.exp > 0), 2000, 'session figures');
  a.raw({ t: 'auto', on: false });
  await a.until(() => autos[autos.length - 1].on === false, 2000, 'stopped');
  // a dropped connection ends a running session on the server
  a.raw({ t: 'auto', on: true });
  await a.until(() => p.autoOn, 2000, 'running again');
  a.close();
  await sleep(150);
  assert.equal(p.autoOn, false, 'the session ended with the connection');
  await sleep(GRACE + 900);
  const row = (await app.db.query<{ auto_hunt: any }>('SELECT auto_hunt FROM characters WHERE id=$1', [a.characterId])).rows[0].auto_hunt;
  assert.deepEqual([row.hpPct, row.mpPct, row.radius, row.lootMode, row.onFull, row.returnTo], [77, 22, 9, 'rare', 'stop', 'town'], 'stored in PostgreSQL');
  const again = new Bot(base, a.token, a.characterId, 'Autohuntr');
  await again.connect();
  assert.equal(again.welcome!.auto.hpPct, 77, 'and back after logging in again');
  assert.deepEqual(again.welcome!.auto.skillList.map((s) => s.id), ['arcane_bolt', 'blink']);
  again.close();
});

test('auto hunting with a full skill set: the largest configuration a character can send fits in one message', async () => {
  // regression: a level 39 mage's configuration (12 skills, 1.2 KB) used to exceed the 1 KB message limit and drop the connection
  const a = await Bot.create(base, 'acc_autobig', 'Bigconfig', 'mage');
  await a.connect();
  const p = app.world.online.get(a.characterId)!;
  // every active mage skill and every spell of three attuned runes
  const ids = [...jobActives('mage').map((d) => d.id), ...(['fire', 'water', 'lightning'] as const).flatMap((el) => runeSpells(el).map((d) => d.id))];
  const cfg = { ...DEFAULT_AUTO, ignore: ['potion', 'material', 'scroll'], skillList: ids.map((id, i) => ({ id, on: true, pri: 90 + i, minMp: 100, minEnemies: 9, hpBelow: 100 })) };
  const msg = JSON.stringify({ t: 'auto', on: true, cfg });
  assert.ok(msg.length > 1024 && msg.length < MAX_MESSAGE_BYTES / 1.5, `${msg.length} bytes: above the old limit, well inside the new one`);
  for (const id of ids) {
    const d = ABILITIES[id];
    if (d.kind === 'skill') p.build.skills[id] = 1;
    else p.build.runes.lv[d.el!] = 10;
  }
  a.raw(JSON.parse(msg));
  await a.until(() => p.autoOn, 2000, 'session started');
  assert.equal(a.closed, false, 'the connection stays open');
  assert.equal(p.autoCfg.skillList.length, ids.filter((id) => autoKind(ABILITIES[id])).length, 'every automatable skill arrived');
  a.raw({ t: 'auto', on: false });
  a.close();
});

test('trading over the network: both inventories and the audit row are stored together', async () => {
  const a = await Bot.create(base, 'acc_tr1', 'Seller'), b = await Bot.create(base, 'acc_tr2', 'Buyer', 'mage');
  await a.connect();
  await b.connect();
  const pa = app.world.online.get(a.characterId)!, pb = app.world.online.get(b.characterId)!;
  give(pa, { base: 'greatsword', rar: 4, ilvl: 9, aff: [['atk', 5]], up: 2, qty: 1 });
  pb.gold = 300;
  const sword = pa.inv.find((i) => i.base === 'greatsword')!;
  const trades = (bot: Bot) => { const list: any[] = []; bot.ws!.on('message', (d: Buffer) => { const m = JSON.parse(d.toString()); if (m.t === 'trade' || m.t === 'tinv') list.push(m); }); return list; };
  const ta = trades(a), tb = trades(b);
  a.raw({ t: 'trade', op: 'invite', id: b.characterId });
  await b.until(() => tb.some((m) => m.t === 'tinv'), 2000, 'trade request');
  b.raw({ t: 'trade', op: 'accept' });
  await a.until(() => ta.some((m) => m.trade), 2000, 'trade opened');
  a.raw({ t: 'trade', op: 'offer', uid: sword.uid });
  b.raw({ t: 'trade', op: 'gold', gold: 250 });
  await a.until(() => ta[ta.length - 1].trade?.theirs.gold === 250 && ta[ta.length - 1].trade?.mine.items.length === 1, 2000, 'offers visible');
  a.raw({ t: 'trade', op: 'confirm' });
  b.raw({ t: 'trade', op: 'confirm' });
  await a.until(() => ta.some((m) => m.done) && tb.some((m) => m.done), 2000, 'exchange');
  assert.equal(pa.gold, 250);
  assert.equal(pb.gold, 50);
  assert.ok(pb.inv.some((i) => i.base === 'greatsword' && i.rar === 4 && i.up === 2) && !pa.inv.some((i) => i.base === 'greatsword'));
  await sleep(250); // the transaction is started at the moment of the exchange, not at the next autosave
  const chars = (await app.db.query<{ id: number; gold: number; inventory: any[] }>('SELECT id, gold, inventory FROM characters WHERE id = ANY($1::bigint[]) ORDER BY id', [`{${a.characterId},${b.characterId}}`])).rows;
  assert.deepEqual(chars.map((c) => Number(c.gold)), [250, 50], 'gold stored for both');
  assert.equal(chars[0].inventory.some((i: any) => i.base === 'greatsword'), false);
  assert.equal(chars[1].inventory.filter((i: any) => i.base === 'greatsword').length, 1, 'the item exists exactly once, with its new owner');
  const log = (await app.db.query<any>('SELECT * FROM trade_log WHERE a_id=$1', [a.characterId])).rows;
  assert.equal(log.length, 1, 'one audit row');
  assert.deepEqual([log[0].a_name, log[0].b_name, log[0].zone_id, log[0].a_gave.gold, log[0].b_gave.gold], ['Seller', 'Buyer', 'eldoria', 0, 250]);
  assert.deepEqual(log[0].a_gave.items, [{ base: 'greatsword', rar: 4, ilvl: 9, aff: [['atk', 5]], up: 2, qty: 1 }]);
  assert.ok(log[0].at instanceof Date);
  // hostile requests change nothing
  const before = JSON.stringify([pa.gold, pa.inv, pb.gold, pb.inv]);
  for (const m of [{ t: 'trade', op: 'confirm' }, { t: 'trade', op: 'offer', uid: pb.inv[0].uid }, { t: 'trade', op: 'gold', gold: 1e12 }, { t: 'trade', op: 'accept' }, { t: 'trade', op: 'invite', id: a.characterId }, { t: 'trade' }, { t: 'inv', op: 'sellall', uids: [pb.inv[0].uid, pb.inv[0].uid] }, { t: 'inv', op: 'sort', by: '__proto__' }]) a.raw(m);
  await sleep(200);
  assert.equal(JSON.stringify([pa.gold, pa.inv, pb.gold, pb.inv]), before);
  assert.equal(a.kicked, null);
  a.close();
  b.close();
});

// ---------------------------------------------------------------------------------------------
// M13 over the real database
// ---------------------------------------------------------------------------------------------
test('M13 quest progress and reputation are stored with the character; factions are database records', async () => {
  // factions: what the server uses is what the table holds
  const rows = (await app.db.query<{ id: string }>('SELECT id FROM factions WHERE enabled ORDER BY sort')).rows.map((r) => r.id);
  assert.deepEqual(rows, ['crown', 'wardens', 'forge', 'hearth', 'lantern', 'runewrights']);
  assert.deepEqual(app.world.quests.factions.map((f) => f.id), rows);
  // a faction added as a row joins the game when factions are loaded
  await app.db.query(`INSERT INTO factions(id, name, seat, region, creed, about, shop, sort) VALUES ('tidecallers', 'The Tidecallers', 'Mosswatch', 'verdant', 'The water remembers.', 'Added by a test.', '[["mana_potion", 30, 0]]', 9)`);
  app.world.quests.setFactions(await app.repo.loadFactions());
  assert.ok(app.world.quests.faction('tidecallers'));
  await app.db.query(`DELETE FROM factions WHERE id='tidecallers'`);
  app.world.quests.setFactions(await app.repo.loadFactions());

  const a = await Bot.create(base, 'acc_quest', 'Questor', 'knight');
  await a.connect();
  assert.equal(a.welcome!.factions.length, 6, 'the factions arrive with the character');
  const p = app.world.online.get(a.characterId)!, lk = (await import('../shared/src/places')).zoneObjects('eldoria').find((o) => o.kind === 'lorekeeper')!;
  app.world.relocate(p, p.room, lk.x + 20, lk.y);
  a.raw({ t: 'quest', op: 'accept', id: 'main_eldoria' });
  await a.until(() => !!p.quests.active.main_eldoria, 2000, 'accepted');
  for (let i = 0; i < 3; i++) {
    const m = app.world.spawn(p.room, 'mossling', p.x + 30, p.y);
    m.noRespawn = true;
    app.world.hurt(m, 1e9, 0, p);
  }
  assert.deepEqual(p.quests.active.main_eldoria.p, [0, 3]);
  app.world.quests.addRep(p, 'crown', 640);
  a.close();
  await sleep(GRACE + 1300); // reconnect grace runs out: the character is saved and leaves the world
  const row = (await app.db.query<any>('SELECT quests, reputation FROM characters WHERE id=$1', [a.characterId])).rows[0];
  assert.deepEqual(row.quests.active.main_eldoria.p, [0, 3], 'progress is in PostgreSQL');
  assert.equal(row.reputation.crown, 640);
  const b = new Bot(base, a.token, a.characterId, 'Questor');
  await b.connect();
  const q = app.world.online.get(a.characterId)!;
  assert.deepEqual([q.quests.active.main_eldoria.p, q.rep.crown], [[0, 3], 640], 'and back after logging in again');
  b.close();
});

// ---------------------------------------------------------------------------------------------
// M14: guilds, auction house and bank over the real network and database
// ---------------------------------------------------------------------------------------------
import { AUCTION_MAX_LISTINGS, BANK_SIZE, GUILD_CREATE_COST, guildExpToNext, listingFee, saleTax, DEFAULT_AUCTION_RATES } from '../shared/src/economy';
import { BASIC_COMBO } from '../shared/src/combat';
import { GATHER_MS } from '../shared/src/places';

/** A bot that records every message and can send a command and wait for its answer. */
async function econBot(user: string, name: string, job: any = 'knight') {
  const b = await Bot.create(base, user, name, job);
  await b.connect();
  const seen: any[] = [];
  b.ws!.on('message', (d: Buffer) => seen.push(JSON.parse(d.toString())));
  const p = app.world.online.get(b.characterId)!;
  /** Sends a command; resolves with the refusal text, or '' once a reply of type `ok` arrives. */
  const ask = async (m: object, ok: string, ms = 3000) => {
    const from = seen.length;
    b.raw(m);
    await b.until(() => seen.slice(from).some((x) => x.t === ok || x.t === 'no'), ms, `reply to ${JSON.stringify(m)}`);
    // other members' actions also send updates: give a refusal for this request a moment to arrive
    if (!seen.slice(from).some((x) => x.t === 'no')) await sleep(120);
    const no = seen.slice(from).find((x) => x.t === 'no');
    return no ? no.why : '';
  };
  const last = (t: string) => [...seen].reverse().find((x) => x.t === t);
  return { b, p, seen, ask, last };
}
const banker = (zone = 'eldoria') => (zoneObjectsOf(zone)).find((o) => o.kind === 'banker')!;
let zoneObjectsOf: (z: string) => any[];
const toBanker = (p: any) => {
  const k = banker();
  app.world.relocate(p, app.world.roomIn('eldoria', p), k.x + 24, k.y);
};
const dbChar = async (id: number) => (await app.db.query<any>('SELECT gold, inventory, bank FROM characters WHERE id=$1', [id])).rows[0];

test('M14 guilds: found, invite, ranks and permissions, message, bank, leadership, leave, kick, disband; stored in PostgreSQL', async () => {
  zoneObjectsOf = (await import('../shared/src/places')).zoneObjects;
  const L = await econBot('acc_gl', 'Guildlead'), O = await econBot('acc_go', 'Guildoffi', 'mage'), M = await econBot('acc_gm', 'Guildmemb', 'ranger');
  L.p.level = O.p.level = M.p.level = 10;
  L.p.gold = 5000;
  const emblem = { shape: 2, color: 1, bg: 7 };
  // founding: validated, paid for, unique
  assert.match(await L.ask({ t: 'guild', op: 'create', name: 'x', tag: 'AB', emblem }, 'guild'), /Guild name/);
  assert.match(await L.ask({ t: 'guild', op: 'create', name: 'Ember Oath', tag: 'ab', emblem: { shape: 1, color: 2, bg: 2 } }, 'guild'), /emblem/);
  assert.equal(await L.ask({ t: 'guild', op: 'create', name: 'Ember Oath', tag: 'EMB', emblem }, 'guild'), '');
  assert.equal(L.p.gold, 5000 - GUILD_CREATE_COST, 'the founding fee is paid');
  const g = L.last('guild').guild;
  assert.deepEqual([g.name, g.tag, g.level, g.members.length, g.members[0].rank, g.emblem], ['Ember Oath', 'EMB', 1, 1, 0, emblem]);
  assert.equal((await dbChar(L.b.characterId)).gold, 5000 - GUILD_CREATE_COST, 'fee and guild stored together');
  O.p.gold = 5000;
  assert.equal(await O.ask({ t: 'guild', op: 'create', name: 'ember oath', tag: 'XYZ', emblem }, 'guild'), 'That guild name is taken');
  assert.equal(await O.ask({ t: 'guild', op: 'create', name: 'Other Guild', tag: 'EMB', emblem }, 'guild'), 'That tag is taken');
  assert.equal(O.p.gold, 5000, 'a refused founding costs nothing');
  // invitation and joining
  assert.equal(await M.ask({ t: 'guild', op: 'invite', name: O.p.name }, 'guild'), 'You are not in a guild');
  assert.equal(await L.ask({ t: 'guild', op: 'invite', name: O.p.name }, 'sys'), '');
  await O.b.until(() => O.seen.some((x) => x.t === 'ginv' && x.guild === 'Ember Oath'), 2000, 'invitation');
  assert.equal(await O.ask({ t: 'guild', op: 'accept' }, 'guild'), '');
  assert.equal(await L.ask({ t: 'guild', op: 'invite', name: M.p.name }, 'sys'), '');
  assert.equal(await M.ask({ t: 'guild', op: 'accept' }, 'guild'), '');
  await L.b.until(() => L.last('guild')?.guild?.members.length === 3, 2000, 'three members');
  assert.equal(O.last('guild').rank, 3, 'new members start as Recruit');
  // ranks and permissions
  assert.match(await O.ask({ t: 'guild', op: 'motd', text: 'hello' }, 'guild'), /cannot do that/);
  assert.match(await O.ask({ t: 'guild', op: 'rank', id: M.b.characterId, rank: 1 }, 'guild'), /cannot do that/);
  assert.equal(await L.ask({ t: 'guild', op: 'rank', id: O.b.characterId, rank: 1 }, 'guild'), '');
  assert.equal(await O.ask({ t: 'guild', op: 'motd', text: 'Raid at dusk.\u0007' }, 'guild'), '', 'officers may set the message');
  await O.b.until(() => O.last('guild')?.guild?.motd === 'Raid at dusk.', 2000, 'control characters are removed from the message');
  assert.match(await M.ask({ t: 'guild', op: 'kick', id: O.b.characterId }, 'guild'), /cannot do that/);
  // guild bank: anyone deposits, officers withdraw, never below zero, stored with the member's gold
  M.p.gold = 300;
  assert.equal(await M.ask({ t: 'guild', op: 'deposit', gold: 200 }, 'guild'), '');
  assert.equal(M.p.gold, 100);
  assert.match(await M.ask({ t: 'guild', op: 'withdraw', gold: 50 }, 'guild'), /Only officers/);
  assert.equal(await O.ask({ t: 'guild', op: 'withdraw', gold: 500 }, 'guild'), 'The guild bank does not hold that much');
  const o0 = O.p.gold;
  assert.equal(await O.ask({ t: 'guild', op: 'withdraw', gold: 150 }, 'guild'), '');
  assert.equal(O.p.gold, o0 + 150);
  assert.equal(Number((await app.db.query<any>("SELECT bank_gold FROM guilds WHERE tag='EMB'")).rows[0].bank_gold), 50);
  assert.equal((await dbChar(M.b.characterId)).gold, 100, "the depositor's gold was stored in the same transaction");
  // guild experience from members' kills
  const gid = app.world.guilds.guildOf(L.p)!.id, gg = app.world.guilds.byId.get(gid)!;
  app.world.grantExp(M.p, 1e6);
  assert.equal(gg.exp, 0, 'a member\'s own experience does not feed the guild');
  for (let i = 0; i * 200 < guildExpToNext(1); i++) app.world.guilds.onKill(M.p, 'world');
  assert.equal(gg.level, 2, 'the guild levelled from its members\' kills');
  // chat
  const fromM = M.seen.length;
  app.world.chat(L.p, 'for the guild', 'guild');
  await M.b.until(() => M.seen.slice(fromM).some((x) => x.t === 'chat' && x.ch === 'guild' && x.text === 'for the guild'), 2000, 'guild chat');
  // the leader cannot leave without handing over; leadership moves in one step
  assert.match(await L.ask({ t: 'guild', op: 'leave' }, 'guild'), /Hand the leadership/);
  assert.equal(await L.ask({ t: 'guild', op: 'transfer', id: O.b.characterId }, 'guild'), '');
  const ranks = (await app.db.query<any>('SELECT character_id, rank FROM guild_members WHERE guild_id=$1 ORDER BY rank', [gid])).rows.map((r) => [Number(r.character_id), r.rank]);
  assert.deepEqual(ranks, [[O.b.characterId, 0], [L.b.characterId, 1], [M.b.characterId, 3]]);
  // kick: only lower ranks; the kicked member is told
  assert.match(await L.ask({ t: 'guild', op: 'kick', id: O.b.characterId }, 'guild'), /lower rank/);
  assert.equal(await L.ask({ t: 'guild', op: 'kick', id: M.b.characterId }, 'guild'), '');
  await M.b.until(() => M.last('guild')?.guild === null, 2000, 'removed');
  assert.equal(app.world.guilds.tagOf(M.b.characterId), undefined);
  // the log records it all
  const log = (await app.db.query<any>('SELECT text FROM guild_log WHERE guild_id=$1 ORDER BY id', [gid])).rows.map((r) => r.text).join(' | ');
  for (const re of [/founded/, /joined/, /made .* Officer/, /deposited 200/, /withdrew 150/, /level 2/, /handed the leadership/, /was removed/]) assert.match(log, re);
  // survives a restart of the guild store
  const fresh = new (await import('../server/src/game/Guilds')).Guilds(app.world, app.repo);
  await fresh.load();
  const again = fresh.byId.get(gid)!;
  assert.deepEqual([again.name, again.tag, again.level, again.members.size, again.leader, again.motd], ['Ember Oath', 'EMB', 2, 2, O.b.characterId, 'Raid at dusk.']);
  // disband: leader only, exact name, empty bank
  assert.match(await O.ask({ t: 'guild', op: 'disband', confirm: 'ember oath' }, 'guild'), /exact name/);
  assert.match(await O.ask({ t: 'guild', op: 'disband', confirm: 'Ember Oath' }, 'guild'), /Withdraw the gold/);
  assert.equal(await O.ask({ t: 'guild', op: 'withdraw', gold: 50 }, 'guild'), '');
  assert.equal(await O.ask({ t: 'guild', op: 'disband', confirm: 'Ember Oath' }, 'guild'), '');
  await L.b.until(() => L.last('guild')?.guild === null, 2000, 'disbanded');
  assert.equal((await app.db.query('SELECT 1 FROM guilds WHERE id=$1', [gid])).rows.length, 0);
  assert.equal((await app.db.query('SELECT 1 FROM guild_members WHERE guild_id=$1', [gid])).rows.length, 0);
  for (const x of [L, O, M]) x.b.close();
});

test('M14 auction house: list with a fee, search and filter, buy, tax, collect, cancel, expire, history', async () => {
  const S = await econBot('acc_as', 'Auctseller'), B = await econBot('acc_ab', 'Auctbuyer', 'mage');
  toBanker(S.p);
  toBanker(B.p);
  S.p.gold = 1000;
  B.p.gold = 5000;
  give(S.p, { base: 'greatsword', rar: 3, ilvl: 12, aff: [['atk', 4]], up: 1, qty: 1 });
  give(S.p, { base: 'star_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: 10 });
  const sword = S.p.inv.find((i) => i.base === 'greatsword')!, pots = S.p.inv.find((i) => i.base === 'star_shard')!;
  const rates = DEFAULT_AUCTION_RATES;
  // away from a banker nothing works
  app.world.relocate(B.p, B.p.room, B.p.x + 900, B.p.y);
  assert.equal(await B.ask({ t: 'eco', op: 'search' }, 'ah'), 'You need to be at a banker');
  toBanker(B.p);
  // listing
  assert.match(await S.ask({ t: 'eco', op: 'list', uid: sword.uid, price: 0 }, 'sys'), /Price must be/);
  assert.equal(await S.ask({ t: 'eco', op: 'list', uid: sword.uid, price: 800, hours: 24 }, 'sys'), '');
  assert.equal(S.p.gold, 1000 - listingFee(800, 24, rates), 'the fee is paid');
  assert.ok(!S.p.inv.some((i) => i.base === 'greatsword'), 'the item left the bag');
  assert.equal(await S.ask({ t: 'eco', op: 'list', uid: pots.uid, qty: 4, price: 60, hours: 12 }, 'sys'), '');
  assert.equal(S.p.inv.find((i) => i.base === 'star_shard')!.qty, 6, 'part of a stack can be listed');
  const stored = await dbChar(S.b.characterId);
  assert.ok(!stored.inventory.some((i: any) => i.base === 'greatsword'), 'the listing and the seller\'s bag were stored together');
  // search: text, category, rarity, sort
  const search = async (q: object) => (await B.ask({ t: 'eco', op: 'search', ...q }, 'ah'), B.last('ah'));
  assert.deepEqual((await search({ text: 'great' })).list.map((l: any) => l.item.base), ['greatsword']);
  assert.deepEqual((await search({ cat: 'material' })).list.map((l: any) => [l.item.base, l.item.qty, l.price]), [['star_shard', 4, 60]]);
  assert.deepEqual((await search({ minRar: 3 })).list.map((l: any) => l.item.base), ['greatsword']);
  assert.deepEqual((await search({ sort: 'price_desc' })).list.map((l: any) => l.price).slice(0, 2), [800, 60]);
  assert.equal((await search({ text: "'; drop table auction_listings; --" })).list.length, 0, 'text is matched against item names, never put into SQL');
  const listing = (await search({ text: 'great' })).list[0];
  assert.deepEqual([listing.seller, listing.item.up, listing.item.aff, listing.mine], ['Auctseller', 1, [['atk', 4]], false]);
  // buying: own listing refused, price must match what was seen, gold checked
  assert.equal(await S.ask({ t: 'eco', op: 'buy', id: listing.id }, 'sys'), 'That listing is no longer available', 'nobody buys their own listing');
  assert.equal(await B.ask({ t: 'eco', op: 'buy', id: listing.id, price: 1 }, 'sys'), 'That listing is no longer available');
  B.p.gold = 10;
  assert.equal(await B.ask({ t: 'eco', op: 'buy', id: listing.id }, 'sys'), 'Not enough gold');
  B.p.gold = 5000;
  assert.equal(await B.ask({ t: 'eco', op: 'buy', id: listing.id, price: 800 }, 'sys'), '');
  assert.equal(B.p.gold, 4200);
  const got = B.p.inv.find((i) => i.base === 'greatsword')!;
  assert.deepEqual([got.rar, got.ilvl, got.up, got.aff], [3, 12, 1, [['atk', 4]]], 'the item arrives exactly as it was listed');
  assert.equal((await dbChar(B.b.characterId)).gold, 4200, 'the buyer is stored in the same transaction');
  assert.equal(await B.ask({ t: 'eco', op: 'buy', id: listing.id }, 'sys'), 'That listing is no longer available', 'sold only once');
  // proceeds wait for the seller, minus tax
  const s0 = S.p.gold;
  assert.equal(await S.ask({ t: 'eco', op: 'collect' }, 'sys'), '');
  assert.equal(S.p.gold, s0 + 800 - saleTax(800, rates));
  assert.equal(await S.ask({ t: 'eco', op: 'collect' }, 'sys'), 'Nothing to collect');
  // cancel: back to the bag; nobody else can cancel it
  const pl = (await search({ cat: 'material' })).list[0];
  assert.equal(await B.ask({ t: 'eco', op: 'cancel', id: pl.id }, 'sys'), 'That listing is no longer available');
  assert.equal(await S.ask({ t: 'eco', op: 'cancel', id: pl.id }, 'sys'), '');
  assert.equal(S.p.inv.filter((i) => i.base === 'star_shard').reduce((n, i) => n + i.qty, 0), 10, 'all ten shards are back');
  assert.equal((await search({ cat: 'material' })).list.length, 0);
  // expiry: returned to the seller through claims
  give(S.p, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 });
  const st = S.p.inv.find((i) => i.base === 'upgrade_stone')!;
  assert.equal(await S.ask({ t: 'eco', op: 'list', uid: st.uid, price: 500, hours: 12 }, 'sys'), '');
  await app.db.query("UPDATE auction_listings SET expires_at = now() - interval '1 second' WHERE seller_id=$1 AND status='active'", [S.b.characterId]);
  assert.equal(await app.world.economy.sweep(), 1);
  assert.equal(await S.ask({ t: 'eco', op: 'collect' }, 'sys'), '');
  assert.equal(S.p.inv.find((i) => i.base === 'upgrade_stone')?.qty, 3, 'the expired item came back');
  // history
  await S.ask({ t: 'eco', op: 'history' }, 'ahhist');
  assert.deepEqual(S.last('ahhist').rows.map((r: any) => [r.base, r.status]).sort(), [['greatsword', 'sold'], ['star_shard', 'cancelled'], ['upgrade_stone', 'expired']]);
  assert.equal(S.last('ahhist').rows.find((r: any) => r.status === 'sold').other, 'Auctbuyer');
  for (const x of [S, B]) x.b.close();
});

test('M14 auction race: two buyers for one listing at the same moment, exactly one gets it, nothing is duplicated', async () => {
  const S = await econBot('acc_rs', 'Raceseller'), A = await econBot('acc_ra', 'Racebuyera', 'mage'), B = await econBot('acc_rb', 'Racebuyerb', 'ranger');
  for (const x of [S, A, B]) toBanker(x.p);
  S.p.gold = 1000;
  A.p.gold = B.p.gold = 2000;
  let won = 0;
  for (let round = 0; round < 5; round++) {
    give(S.p, { base: 'crystal_orb', rar: 4, ilvl: 20, aff: [], up: 0, qty: 1 });
    const orb = S.p.inv.find((i) => i.base === 'crystal_orb')!;
    assert.equal(await S.ask({ t: 'eco', op: 'list', uid: orb.uid, price: 100, hours: 12 }, 'sys'), '');
    const id = Number((await app.db.query<any>("SELECT id FROM auction_listings WHERE seller_id=$1 AND status='active'", [S.b.characterId])).rows[0].id);
    const before = A.p.inv.length + B.p.inv.length;
    // both requests leave at once
    const [ra, rb] = await Promise.all([A.ask({ t: 'eco', op: 'buy', id }, 'sys'), B.ask({ t: 'eco', op: 'buy', id }, 'sys')]);
    assert.deepEqual([ra, rb].filter((r) => r === '').length, 1, `round ${round}: one buyer succeeded (${JSON.stringify([ra, rb])})`);
    assert.ok([ra, rb].includes('That listing is no longer available'));
    assert.equal(A.p.inv.length + B.p.inv.length, before + 1, 'one orb arrived in total');
    won += ra === '' ? 1 : 0;
  }
  assert.equal(A.p.gold + B.p.gold, 4000 - 5 * 100, 'exactly five purchases were paid for');
  const sold = (await app.db.query<any>("SELECT count(*)::int AS n FROM auction_listings WHERE seller_id=$1 AND status='sold'", [S.b.characterId])).rows[0].n;
  assert.equal(sold, 5);
  for (const x of [S, A, B]) x.b.close();
  assert.ok(won >= 0);
});

test('M14 bank: deposit and withdraw items and gold at a banker, limits, persistence and an audit log', async () => {
  const P = await econBot('acc_bank', 'Banksaver');
  toBanker(P.p);
  P.p.lastCombat = -1e6;
  P.p.gold = 900;
  give(P.p, { base: 'plate_cuirass', rar: 2, ilvl: 9, aff: [['def', 3]], up: 2, qty: 1 });
  give(P.p, { base: 'moonleaf', rar: 0, ilvl: 1, aff: [], up: 0, qty: 12 });
  const armor = P.p.inv.find((i) => i.base === 'plate_cuirass')!, leaf = P.p.inv.find((i) => i.base === 'moonleaf')!;
  assert.equal(await P.ask({ t: 'eco', op: 'deposit', uid: armor.uid }, 'bank'), '');
  assert.equal(await P.ask({ t: 'eco', op: 'deposit', uid: leaf.uid, qty: 5 }, 'bank'), '');
  assert.equal(await P.ask({ t: 'eco', op: 'depgold', gold: 600 }, 'bank'), '');
  assert.match(await P.ask({ t: 'eco', op: 'depgold', gold: 600 }, 'bank'), /do not have that much/);
  assert.deepEqual(P.last('bank').bank.items.map((i: any) => [i.base, i.qty]), [['plate_cuirass', 1], ['moonleaf', 5]]);
  assert.equal(P.last('bank').bank.items[0].uid, armor.uid, 'a whole item keeps its identity');
  assert.deepEqual([P.p.gold, P.p.bank.gold, leaf.qty], [300, 600, 7]);
  const row = await dbChar(P.b.characterId);
  assert.deepEqual([row.gold, row.bank.gold, row.bank.items.length], [300, 600, 2], 'stored at once, bag and bank together');
  assert.ok(!row.inventory.some((i: any) => i.uid === armor.uid), 'the item is in exactly one place');
  // withdraw
  assert.equal(await P.ask({ t: 'eco', op: 'withdraw', uid: armor.uid }, 'bank'), '');
  assert.equal(await P.ask({ t: 'eco', op: 'wdgold', gold: 250 }, 'bank'), '');
  assert.match(await P.ask({ t: 'eco', op: 'wdgold', gold: 999 }, 'bank'), /does not hold/);
  assert.ok(P.p.inv.some((i) => i.uid === armor.uid && i.up === 2));
  assert.deepEqual([P.p.gold, P.p.bank.gold], [550, 350]);
  // limits: the bank holds BANK_SIZE slots
  P.p.bank.items.length = 0;
  for (let i = 0; i < BANK_SIZE; i++) P.p.bank.items.push({ uid: `fill${i}`, base: 'cloth_robe', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  assert.match(await P.ask({ t: 'eco', op: 'deposit', uid: armor.uid }, 'bank'), /The bank is full/);
  P.p.bank.items.length = 1;
  // not in combat, not away from a banker
  P.p.lastCombat = app.world.tick;
  assert.equal(await P.ask({ t: 'eco', op: 'depgold', gold: 1 }, 'bank'), 'Not while in combat');
  P.p.lastCombat = -1e6;
  // the log
  await P.ask({ t: 'eco', op: 'banklog' }, 'banklog');
  assert.deepEqual(P.last('banklog').rows.map((r: any) => r.op).slice(0, 5), ['wdgold', 'withdraw', 'depgold', 'deposit', 'deposit']);
  // after logging out and in again
  P.b.close();
  await sleep(GRACE + 1300);
  const again = new Bot(base, P.b.token, P.b.characterId, 'Banksaver');
  await again.connect();
  assert.equal(again.welcome!.bank.gold, 350);
  assert.equal(app.world.online.get(P.b.characterId)!.bank.gold, 350);
  again.close();
});

// ---------------------------------------------------------------------------------------------
// M15: PvP records and rankings, pets and mounts over the real network and database
// ---------------------------------------------------------------------------------------------
test('M15 PvP over the network: the arena, a victory stored in PostgreSQL, and the rankings', async () => {
  const am = (await import('../shared/src/places')).zoneObjects('eldoria').find((o) => o.kind === 'arenamaster')!;
  const A = await econBot('acc_pa', 'Arenaone'), B = await econBot('acc_pb', 'Arenatwo', 'mage');
  for (const X of [A, B]) app.world.relocate(X.p, app.world.roomIn('eldoria', X.p), am.x + 20, am.y);
  assert.equal(await A.ask({ t: 'pvp', op: 'arena' }, 'welcome'), '');
  assert.equal(await B.ask({ t: 'pvp', op: 'arena' }, 'welcome'), '');
  assert.ok(A.last('welcome').arena, 'the client is told it is in the arena');
  assert.ok(app.world.pvp.isArena(A.p.room) && A.p.room === B.p.room);
  app.world.relocate(B.p, B.p.room, A.p.x + 48, A.p.y);
  app.world.hurt(B.p, 1e9, 0, A.p);
  await A.b.until(() => A.seen.some((m) => m.t === 'sys' && /You defeated Arenatwo/.test(m.text)), 3000, 'victory message');
  let rows: any[] = [];
  for (let i = 0; i < 30 && rows.length < 2; i++) {
    rows = (await app.db.query<any>('SELECT character_id, arena_kills, arena_deaths, honor, rating FROM pvp_stats WHERE character_id = ANY($1::bigint[]) ORDER BY rating DESC', [`{${A.b.characterId},${B.b.characterId}}`])).rows;
    if (rows.length < 2) await sleep(100);
  }
  assert.deepEqual(rows.map((r) => [Number(r.character_id), r.arena_kills, r.arena_deaths, r.rating]), [[A.b.characterId, 1, 0, 1012], [B.b.characterId, 0, 1, 988]]);
  const api = await (await fetch(`${base}/api/pvp/rankings?by=arena_kills`)).json() as any;
  assert.equal(api.rows[0].name, 'Arenaone', 'public rankings');
  assert.equal((await (await fetch(`${base}/api/pvp/rankings?by=drop%20table`)).json() as any).rows[0].name, 'Arenaone', 'an unknown sort falls back to rating');
  assert.equal(await A.ask({ t: 'pvp', op: 'rank', by: 'rating' }, 'pvprank'), '');
  assert.equal(A.last('pvprank').me.rating, 1012);
  assert.equal(await A.ask({ t: 'pvp', op: 'leave' }, 'welcome'), '');
  assert.equal(A.p.room.zoneId, 'eldoria');
  // G8: honour is spent at the Arena Master; the database refuses what cannot be paid for
  await app.db.query('UPDATE pvp_stats SET honor = 100 WHERE character_id = $1', [A.b.characterId]);
  app.world.relocate(A.p, A.p.room, am.x + 20, am.y);
  const stones = () => A.p.inv.filter((i) => i.base === 'upgrade_stone').reduce((n, i) => n + i.qty, 0), s0 = stones();
  A.b.raw({ t: 'pvp', op: 'buy', base: 'upgrade_stone' });
  await A.b.until(() => stones() === s0 + 1, 3000, 'bought with honour');
  assert.equal(Number((await app.db.query<any>('SELECT honor_spent FROM pvp_stats WHERE character_id = $1', [A.b.characterId])).rows[0].honor_spent), 30);
  A.b.raw({ t: 'pvp', op: 'buy', base: 'conquerors_medal' });
  await A.b.until(() => A.seen.some((m) => m.t === 'sys' && /Not enough honour/.test(m.text)), 3000, 'refused');
  assert.ok(!A.p.inv.some((i) => i.base === 'conquerors_medal'));
  // G7: the honour won is on this season's ladder, stored in PostgreSQL
  let lad: any[] = [];
  for (let i = 0; i < 30 && !lad.length; i++) {
    lad = (await app.db.query<any>("SELECT score FROM season_scores WHERE ladder = 'honor' AND character_id = $1", [A.b.characterId])).rows;
    if (!lad.length) await sleep(100);
  }
  assert.ok(lad[0]?.score > 0, 'honour on the season ladder');
  assert.equal(await A.ask({ t: 'season', op: 'view', ladder: 'honor' }, 'season'), '');
  assert.equal(A.last('season').rows[0].name, 'Arenaone');
  // last season is paid once, by mail
  const { seasonBefore: before0, seasonOf: of0 } = await import('../shared/src/seasons');
  const past = before0(of0(Date.now()));
  await app.db.query("INSERT INTO season_scores(season, ladder, character_id, name, job, score) VALUES ($1, 'raid', $2, 'Arenaone', 'knight', 3)", [past, A.b.characterId]);
  for (let k = 0; k < 2; k++) { (app.world.seasons as any).lastCheck = 0; await app.world.seasons.tick(Date.now()); }
  const sm = (await app.db.query<any>('SELECT subject, gold FROM mail WHERE to_id = $1 AND subject LIKE $2', [A.b.characterId, `Season ${past}%`])).rows;
  assert.equal(sm.length, 1, 'one payout letter');
  assert.equal(sm[0].gold, 100000);
  // the rating comes back after logging in again
  A.b.close();
  await sleep(GRACE + 1300);
  const again = new Bot(base, A.b.token, A.b.characterId, 'Arenaone');
  await again.connect();
  await again.until(() => app.world.pvp.rating.get(A.b.characterId) === 1012, 3000, 'rating loaded');
  again.close();
  B.b.close();
});

test('M15 pets and mounts over the network: learned from items, summoned, ridden, stored with the character', async () => {
  const P = await econBot('acc_pet', 'Petowner', 'ranger');
  P.p.level = 25;
  P.p.lastCombat = -1e6;
  give(P.p, { base: 'pet_frost_owlet', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  give(P.p, { base: 'mount_plains_strider', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  assert.equal(await P.ask({ t: 'inv', op: 'use', uid: P.p.inv.find((i) => i.base === 'pet_frost_owlet')!.uid }, 'comp'), '');
  assert.equal(await P.ask({ t: 'inv', op: 'use', uid: P.p.inv.find((i) => i.base === 'mount_plains_strider')!.uid }, 'comp'), '');
  const uid = P.last('comp').comp.pets[0].uid;
  assert.equal(await P.ask({ t: 'comp', op: 'summon', uid }, 'comp'), '');
  assert.equal(await P.ask({ t: 'comp', op: 'rename', uid, name: 'Hoot' }, 'comp'), '');
  assert.equal(await P.ask({ t: 'comp', op: 'mount', id: 'plains_strider' }, 'comp'), '');
  // other companion updates may arrive first in a busy world: wait for the one that shows the mount
  await P.b.until(() => P.last('comp')?.comp.riding === 'plains_strider', 2000, 'riding the strider');
  assert.equal(P.p.comp.riding, 'plains_strider');
  assert.match(await P.ask({ t: 'comp', op: 'mount', id: 'void_skiff' }, 'comp'), /do not have that mount/);
  assert.ok(!P.p.inv.some((i) => i.base.startsWith('pet_') || i.base.startsWith('mount_')), 'the items were used up');
  P.b.close();
  await sleep(GRACE + 1300);
  const row = (await app.db.query<any>('SELECT companions FROM characters WHERE id=$1', [P.b.characterId])).rows[0];
  assert.deepEqual([row.companions.pets[0].name, row.companions.pet, row.companions.mounts], ['Hoot', uid, ['plains_strider']]);
  const again = new Bot(base, P.b.token, P.b.characterId, 'Petowner');
  await again.connect();
  const c = again.welcome!.comp;
  assert.deepEqual([c.pets[0].name, c.pet, c.mounts, c.riding], ['Hoot', uid, ['plains_strider'], ''], 'the pet comes back; nobody logs in riding');
  assert.deepEqual(app.world.online.get(P.b.characterId)!.meta().pet, ['frost_owlet', 'Hoot', 1]);
  again.close();
});

// ---------------------------------------------------------------------------------------------
// M16: game settings (key bindings, language, graphics, tutorial, markers) stored per account
// ---------------------------------------------------------------------------------------------
test('M16 game settings: stored per account next to audio, cleaned by the server, refused when malformed', async () => {
  const { defaultGameSettings } = await import('../shared/src/settings');
  const tok = (await http(base, '/api/register', { username: 'set_m16', password: 'longenough1' })).body.token as string;
  const put = async (body: unknown) => {
    const r = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const fresh = (await http(base, '/api/settings', undefined, tok)).body;
  assert.deepEqual([fresh.game, fresh.gameSaved], [defaultGameSettings(), false], 'a new account starts from the defaults');
  const keys = { ...defaultGameSettings().keys, attack: ['KeyQ'], 'rune.1.1': ['KeyQ'] }; // a conflict sent by a broken client
  const r = await put({ game: { ...defaultGameSettings(), keys, lang: 'id', uiScale: 1.1, graphics: { quality: 'medium', shake: false, damageNumbers: true, nameplates: true }, tutorial: { done: ['move', 'bogus'], skipped: false }, markers: [{ id: 'x1', zone: 'ashen', x: 640, y: 320, label: 'Ore <here>' }] } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.game.keys.attack, r.body.game.keys['rune.1.1']], [['KeyQ'], []], 'a key is never stored for two actions');
  assert.deepEqual([r.body.game.lang, r.body.game.uiScale, r.body.game.graphics.quality, r.body.game.tutorial.done, r.body.game.markers[0].label], ['id', 1.1, 'medium', ['move'], 'Ore here']);
  const row = (await app.db.query<{ settings: any }>(`SELECT s.settings FROM account_settings s JOIN accounts a ON a.id = s.account_id WHERE a.username_lower = 'set_m16'`)).rows[0].settings;
  assert.equal(row.game.lang, 'id', 'stored in PostgreSQL');
  assert.equal(row.audio, undefined, 'saving one section leaves the other alone');
  assert.equal((await put({ audio: { master: 0.5, music: 0.5, sfx: 0.5, ambient: 0.5, muteAll: false, musicOn: true, sfxOn: true } })).status, 200);
  const both = (await app.db.query<{ settings: any }>(`SELECT s.settings FROM account_settings s JOIN accounts a ON a.id = s.account_id WHERE a.username_lower = 'set_m16'`)).rows[0].settings;
  assert.deepEqual([both.game.lang, both.audio.master], ['id', 0.5], 'both sections kept');
  for (const bad of [{ game: 'x' }, { game: [1] }, { game: {}, extra: 1 }, {}]) assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  const back = (await http(base, '/api/settings', undefined, tok)).body;
  assert.deepEqual([back.gameSaved, back.game.lang, back.game.markers.length], [true, 'id', 1], 'read back after a refused request: unchanged');
  // an oversized document is refused before it is read
  const huge = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ game: { markers: Array.from({ length: 400 }, (_, i) => ({ id: 'm' + i, zone: 'eldoria', x: i, y: i, label: 'x'.repeat(24) })) } }) });
  assert.equal(huge.status, 413);
});

// ---------------------------------------------------------------------------------------------
// Armament and sigils: stored with the character (one snapshot with gold and the bag)
// ---------------------------------------------------------------------------------------------
test('armament and sigils over the network: enhanced and equipped, stored in PostgreSQL, back after logging in again', async () => {
  const { rollSigil } = await import('../shared/src/gear');
  const P = await econBot('acc_gear', 'Gearsmith', 'mage');
  app.world.grantExp(P.p, 1e8);
  P.p.lastCombat = -1e6;
  P.p.gold = 1e6;
  P.p.build.skills.arcane_bolt = 1;
  give(P.p, { base: 'arm_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: 20 });
  give(P.p, { ...rollSigil(Math.random, 1, 1, 3), sks: undefined, st: undefined, sk: ['arcane_bolt', 2] });
  for (let i = 0; i < 3; i++) assert.equal(await P.ask({ t: 'inv', op: 'arm', slot: 'weapon' }, 'inv'), '');
  const sig = P.p.inv.find((i) => i.base.startsWith('sigil_'))!;
  assert.equal(await P.ask({ t: 'inv', op: 'sigil', uid: sig.uid }, 'inv'), '');
  assert.equal(P.last('inv').gear.arm.weapon, 3, 'the client is sent its armament');
  assert.equal(P.last('inv').gear.sig[3].uid, sig.uid, 'and its sigils');
  P.b.close();
  await sleep(GRACE + 1300);
  const row = (await app.db.query<any>('SELECT gear, inventory, gold FROM characters WHERE id=$1', [P.b.characterId])).rows[0];
  assert.deepEqual([row.gear.arm.weapon, row.gear.sig[3].uid, row.gear.sig[3].sk], [3, sig.uid, ['arcane_bolt', 2]], 'stored');
  assert.ok(!row.inventory.some((i: any) => i.uid === sig.uid), 'the sigil is in one place only');
  const again = new Bot(base, P.b.token, P.b.characterId, 'Gearsmith');
  await again.connect();
  assert.deepEqual([again.welcome!.gear.arm.weapon, again.welcome!.gear.sig[3]!.uid], [3, sig.uid], 'back after logging in');
  again.close();
});

// ---------------------------------------------------------------------------------------------
// Mail and the journal: stored in PostgreSQL
// ---------------------------------------------------------------------------------------------
test('mail over the network: a letter with an item and gold to an offline character, taken once, stored; the journal is kept', async () => {
  const A = await econBot('acc_mail_a', 'Postwriter', 'knight');
  const B = await econBot('acc_mail_b', 'Postreader', 'mage');
  B.b.close();
  await sleep(GRACE + 600);
  A.p.gold = 5000;
  give(A.p, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 4 });
  const stone = A.p.inv.find((i) => i.base === 'upgrade_stone')!;
  // outside a village nothing can be sent
  const sp = ZONES.eldoria.spawn;
  app.world.relocate(A.p, A.p.room, tileCenter(sp.tx) + 40 * 32, tileCenter(sp.ty));
  assert.equal(await A.ask({ t: 'mail', op: 'send', to: 'Postreader', subject: 'Hi', items: [stone.uid], gold: 100 }, 'mail'), 'Letters can be sent from a village');
  app.world.relocate(A.p, A.p.room, tileCenter(sp.tx), tileCenter(sp.ty) + 40);
  assert.equal(await A.ask({ t: 'mail', op: 'send', to: 'Nobody Here', subject: 'Hi' }, 'mail'), 'There is no character of that name');
  assert.equal(await A.ask({ t: 'mail', op: 'send', to: 'Postwriter', subject: 'Hi' }, 'mail'), 'You cannot write to yourself');
  assert.equal(await A.ask({ t: 'mail', op: 'send', to: 'postreader', subject: 'Stones for you', body: 'Use them well.', items: [stone.uid], gold: 100 }, 'inv'), '');
  assert.equal(A.p.gold, 5000 - 100 - 50, 'the gold sent and the postage (30 + 20 per item)');
  assert.ok(!A.p.inv.some((i) => i.uid === stone.uid), 'the item left the bag');
  const row = (await app.db.query<any>('SELECT gold, inventory FROM characters WHERE id=$1', [A.b.characterId])).rows[0];
  assert.deepEqual([Number(row.gold), row.inventory.some((i: any) => i.uid === stone.uid)], [4850, false], 'stored with the letter in one transaction');
  // the receiver logs in: one unread letter, opened, taken once
  const again = new Bot(base, B.b.token, B.b.characterId, 'Postreader');
  const seen: any[] = [];
  await again.connect();
  again.ws!.on('message', (d: Buffer) => seen.push(JSON.parse(d.toString())));
  await again.until(() => seen.some((m) => m.t === 'mail') || true, 100, 'mail count');
  const R = app.world.online.get(B.b.characterId)!;
  app.world.relocate(R, R.room, tileCenter(sp.tx), tileCenter(sp.ty) + 40);
  again.raw({ t: 'mail', op: 'list' });
  await again.until(() => seen.some((m) => m.t === 'mail' && m.list?.length), 3000, 'mailbox');
  const letter = seen.filter((m) => m.t === 'mail' && m.list).at(-1).list[0];
  assert.deepEqual([letter.from, letter.subject, letter.body, letter.gold, letter.items[0].base, letter.items[0].qty, letter.claimed], ['Postwriter', 'Stones for you', 'Use them well.', 100, 'upgrade_stone', 4, false]);
  const g0 = R.gold;
  again.raw({ t: 'mail', op: 'claim', id: letter.id });
  await again.until(() => R.inv.some((i) => i.base === 'upgrade_stone'), 3000, 'claimed');
  assert.equal(R.gold, g0 + 100);
  await again.until(() => !R.econBusy, 3000, 'first claim stored');
  again.raw({ t: 'mail', op: 'claim', id: letter.id });
  await again.until(() => seen.some((m) => m.t === 'no' && m.a === 'mail'), 3000, 'second claim refused');
  assert.equal(seen.filter((m) => m.t === 'no' && m.a === 'mail').at(-1).why, 'That letter has nothing left to take');
  assert.equal(R.inv.filter((i) => i.base === 'upgrade_stone').reduce((n, i) => n + i.qty, 0), 4, 'taken exactly once');
  // the journal is stored with the character's progress
  R.journal.c.kill = 77;
  R.progDirty = true;
  again.close();
  await sleep(GRACE + 1300);
  const jr = (await app.db.query<any>('SELECT journal FROM characters WHERE id=$1', [B.b.characterId])).rows[0].journal;
  assert.equal(jr.c.kill, 77);
  A.b.close();
});

test('friends: request, accept, online status and place, remove; stored in PostgreSQL', async () => {
  const A = await econBot('acc_fr_a', 'Frienda', 'knight'), B = await econBot('acc_fr_b', 'Friendb', 'mage');
  const list = (x: typeof A) => (x.last('friends')?.list ?? []) as any[];
  assert.equal(await A.ask({ t: 'friends', op: 'add', name: 'Frienda' }, 'friends'), 'You cannot add yourself');
  assert.equal(await A.ask({ t: 'friends', op: 'add', name: 'Nobodyhere' }, 'friends'), 'Player not found');
  assert.equal(await A.ask({ t: 'friends', op: 'add', name: 'friendb' }, 'friends'), '', 'names are matched without regard to case');
  await B.b.until(() => list(B).some((f) => f.name === 'Frienda' && f.state === 'in'), 2000, 'the request arrives');
  assert.deepEqual(list(A).map((f) => [f.name, f.state, f.zone]), [['Friendb', 'out', '']], 'a place is shown only between friends');
  assert.match(await A.ask({ t: 'friends', op: 'add', name: 'Friendb' }, 'friends'), /already asked/);
  assert.equal(await A.ask({ t: 'friends', op: 'accept', id: B.p.id }, 'friends'), 'There is no such request', 'only the one asked can accept');
  assert.equal(await B.ask({ t: 'friends', op: 'accept', id: A.p.id }, 'friends'), '');
  await A.b.until(() => list(A)[0]?.state === 'friend', 2000, 'both become friends');
  const f = list(A)[0];
  assert.deepEqual([f.online, f.zone, f.job, f.party], [true, ZONES[B.p.room.zoneId].name, 'mage', false]);
  assert.equal((await app.db.query<any>('SELECT accepted FROM friends WHERE a=$1 AND b=$2', [A.p.id, B.p.id])).rows[0].accepted, true);
  // a friend who leaves is shown offline and announced
  B.b.close();
  await A.b.until(() => list(A)[0]?.online === false, GRACE + 4000, 'the friend goes offline');

  // removing ends it for both
  assert.equal(await A.ask({ t: 'friends', op: 'remove', id: B.p.id }, 'friends'), '');
  assert.equal(list(A).length, 0);
  assert.equal((await app.db.query('SELECT 1 FROM friends WHERE a=$1 OR b=$1', [A.p.id])).rows.length, 0);
  A.b.close();
});

test('T4 moderation: mute refuses chat, ban kicks and refuses login and joining, audit reports holdings, others are refused', async () => {
  const m = await Bot.create(base, 'acc_mod', 'Warden', 'knight');
  const v = await Bot.create(base, 'acc_vic', 'Rowdy', 'knight');
  await m.connect();
  await v.connect();
  const sys = (b: Bot, re: RegExp) => b.chats.some((c) => !c.from && re.test(c.text));
  v.raw({ t: 'mod', op: 'kick', arg: 'Warden' });
  await v.until(() => sys(v, /^Unknown command$/), 2000, 'a player without the right is refused');
  assert.equal(m.closed, false);
  m.raw({ t: 'mod', op: 'mute', arg: 'Rowdy 5 spam' });
  await v.until(() => sys(v, /muted you for 5 minutes/), 2000, 'the muted player is told');
  v.raw({ t: 'chat', text: 'can anyone hear me' });
  await v.until(() => sys(v, /^You are muted for 5 more minutes\.$/), 2000, 'chat refused');
  assert.ok(!m.chats.some((c) => c.from === 'Rowdy'));
  m.raw({ t: 'mod', op: 'unmute', arg: 'Rowdy' });
  await v.until(() => sys(v, /lifted your mute/), 2000, 'unmuted');
  m.raw({ t: 'mod', op: 'audit', arg: 'rowdy' });
  await m.until(() => sys(m, /^Audit of Rowdy, level \d+, online: \d+ gold, \d+ items in the bag, 0 items and 0 gold in the bank\.$/), 2000, 'audit');
  await m.until(() => sys(m, /^No recent trades\.$/), 2000, 'no trades yet');
  m.raw({ t: 'mod', op: 'ban', arg: 'Rowdy 2 cheating' });
  await v.until(() => v.closed, 3000, 'the banned player is removed');
  assert.match(v.kicked ?? '', /^This account is banned until .* UTC\. Reason: cheating$/);
  const r = await http(base, '/api/login', { username: 'acc_vic', password: 'bot-password-1' });
  assert.equal(r.status, 403, 'and cannot log in');
  assert.match(JSON.stringify(r.body), /banned until/);
  await assert.rejects(v.connect(), /banned|Session expired/, 'nor join with an old session');
  m.raw({ t: 'mod', op: 'unban', arg: 'Rowdy' });
  await m.until(() => sys(m, /Lifted the ban on Rowdy/), 2000, 'unbanned');
  assert.equal((await http(base, '/api/login', { username: 'acc_vic', password: 'bot-password-1' })).status, 200);
  m.close();
  await sleep(GRACE + 1200);
});

test('T3: the game socket is compressed (permessage-deflate) and snapshots shrink on the wire', async () => {
  const a = await Bot.create(base, 'acc_t3a', 'Zipa', 'knight');
  const b = await Bot.create(base, 'acc_t3b', 'Zipb', 'mage');
  await a.connect();
  await b.connect();
  assert.match(a.ws!.extensions, /permessage-deflate/);
  const w0 = a.wireIn, r0 = a.bytesIn;
  for (let i = 0; i < 40; i++) { b.raw({ t: 'in', s: i + 1, x: i % 2 ? 1 : -1, y: 0, r: 1 }); await sleep(25); }
  await sleep(300);
  assert.ok(a.bytesIn - r0 > 500, 'snapshots arrived');
  assert.ok(a.wireIn - w0 < (a.bytesIn - r0) * 0.8, `compressed: ${a.wireIn - w0} bytes on the wire for ${a.bytesIn - r0} of messages`);
  a.close();
  b.close();
  await sleep(GRACE + 1200);
});

test('U3: the installable app files are served (manifest, icons, service worker, offline page)', async () => {
  const m = await fetch(base + '/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type') ?? '', /manifest\+json/);
  const man = await m.json();
  assert.equal(man.start_url, '/');
  for (const ic of man.icons) assert.equal((await fetch(base + ic.src)).headers.get('content-type'), 'image/png', ic.src);
  assert.match(await (await fetch(base + '/sw.js')).text(), /offline\.html/);
  assert.equal((await fetch(base + '/offline.html')).status, 200);
});

test('T3: every browser can connect: a bare deflate offer (Firefox, Safari), a full one (Chrome) and none at all', async () => {
  const httpM = await import('node:http');
  const offer = (ext: string | null) => new Promise<{ status: number; ext: string }>((resolve, reject) => {
    const u = new URL(base + '/ws');
    const req = httpM.request({ host: u.hostname, port: u.port, path: '/ws', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: base,
      ...(ext ? { 'Sec-WebSocket-Extensions': ext } : {}),
    } });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode ?? 0, ext: String(res.headers['sec-websocket-extensions'] ?? '') }); });
    req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, ext: '' }); });
    req.on('error', reject);
    req.end();
  });
  for (const ext of ['permessage-deflate', 'permessage-deflate; client_max_window_bits', null]) {
    const r = await offer(ext);
    assert.equal(r.status, 101, `offer ${ext}`);
    if (ext) assert.match(r.ext, /permessage-deflate/);
  }
});
