import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { allDiscoveries, isNpc, NODE_RESPAWN_MS, objById, RECIPES, REGION_RES, teleportCost, WAYSTONE_RANGE, zoneObjects } from '../shared/src/places';
import { speakerName, STORY, STORY_REGIONS } from '../shared/src/story';
import { affixEndsAt, traitIn, traitOf, TRAITS, weeklyAffix } from '../shared/src/traits';
import { statusNames } from '../shared/src/combat';
import { emptyGoals, FINDER_WAIT_MS, weeklyGoals, weekOf } from '../shared/src/social';
import { talentsOf, TALENT_TIERS } from '../shared/src/talents';
import { FACTIONS, LORE } from '../shared/src/lore';
import { validateDir, validateSheet, type SheetEntry } from '../scripts/assets';
import { decodePng, encodePng, type Image } from '../scripts/png';
import {
  cleanInventory, equipBlock, fullStats, INVENTORY_SIZE, ITEM_LIST, ITEMS, itemStats, LOOT, MAX_UPGRADE, POTION_CD_MS, RARITIES, RARITY_AFFIXES, rollItem, rollLoot, sellValue,
  SHOP_RANGE, starterKit, UPGRADE_STEP, upgradeCost, type Item,
  BOSS_RARITY, BOSS_UNIQUES, PASSIVES, rollBossItem, SECOND_WIND_CD_MS, SETS,
} from '../shared/src/items';
import { give } from '../server/src/game/Inventory';
import assert from 'node:assert/strict';
import { Act, JOBS, Move, TICK_MS, TILE, type Job } from '../shared/src/protocol';
import { blocked, BOSS_ROOM, CHAMBERS, EXIT, getZoneMap, REGIONS, stepMove, stepSize, T, tileAt, tileCenter, ZONES } from '../shared/src/world';
import { EXPANSION, MONSTER_LOOK } from '../shared/src/expansion';
import { ANIM_COL, ANIM_NAMES, ANIMS, animFrame, AP_FIELDS, AP_LIMITS, defaultAppearance, parseAppearance, randomAppearance, SHEET_COLS } from '../shared/src/appearance';
import { ATTRS, attrsAt, computeStats, JOB_DEFS, jobTitle, TIER_BONUS, type Stats } from '../shared/src/jobs';
import { SpatialGrid } from '../server/src/game/SpatialGrid';
import { hashPassword, verifyPassword } from '../server/src/auth';
import { World, ZoneRoom, type WorldOpts } from '../server/src/game/World';
import type { CharacterRow } from '../server/src/db/repo';
import { Dmg, expLevelFactor, expToNext, missChance, mitigate, modsOf, STATUS, STATUS_INDEX } from '../shared/src/combat';
import { MONSTERS, mobHp, patternOf, phaseAt, SPAWNS, WORLD_BOSSES } from '../shared/src/monsters';
import { DIFFICULTY, DUNGEON_CLOSE_MS, DUNGEON_EMPTY_MS, DUNGEONS, partyHpScale } from '../shared/src/dungeons';
import { COMBAT_TIMEOUT_MS, RESPAWN_AUTO_MS, RESPAWN_MIN_MS } from '../shared/src/combat';
import { applyStatus } from '../server/src/game/entity';
import { ABILITIES, ABILITY_INDEX, ABILITY_LIST, cleanBuild, ELEMENTS, emptyBuild, freePoints, jobActives, runeExpToNext, runeSlots, runeSpells, type Build, type Element } from '../shared/src/abilities';
import { runeLevel } from '../server/src/game/Abilities';
import type { Player } from '../server/src/game/World';

const STEP = stepSize(1, true);

test('stepMove advances exactly one step and normalises diagonals', () => {
  const m = getZoneMap('eldoria');
  const p = { x: tileCenter(m.def.spawn.tx), y: tileCenter(m.def.spawn.ty) };
  const x0 = p.x;
  stepMove(p, 1, 0, m, STEP);
  assert.equal(p.x, x0 + STEP);
  const q = { ...p };
  stepMove(q, 1, 1, m, STEP);
  assert.ok(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - STEP) < 0.02);
});

test('stepMove never enters solid tiles and slides along them', () => {
  const m = getZoneMap('eldoria');
  const p = { x: tileCenter(m.def.spawn.tx), y: tileCenter(m.def.spawn.ty) };
  for (let i = 0; i < 5000; i++) {
    stepMove(p, -1, i % 7 === 0 ? 1 : 0, m, STEP);
    assert.equal(blocked(m, p.x, p.y), false);
  }
  assert.ok(p.x >= 2 * TILE, 'stopped by the border trees');
});

test('map generation is deterministic and every portal is reachable from spawn', () => {
  for (const def of Object.values(ZONES)) {
    const m = getZoneMap(def.id);
    assert.equal(m.tiles.length, def.w * def.h);
    const solid = (t: T) => t === T.Water || t === T.Tree || t === T.Wall || t === T.Roof || t === T.Rock;
    const seen = new Uint8Array(m.w * m.h);
    const stack = [def.spawn.tx + def.spawn.ty * m.w];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % m.w, y = (i / m.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = x + dx + (y + dy) * m.w;
        if (!seen[j] && !solid(tileAt(m, x + dx, y + dy))) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    assert.equal(solid(tileAt(m, def.spawn.tx, def.spawn.ty)), false, 'spawn walkable');
    for (const p of def.portals) {
      assert.equal(tileAt(m, p.tx, p.ty), T.Portal);
      assert.equal(seen[p.tx + p.ty * m.w], 1, `${def.id} portal reachable`);
      if (p.to === EXIT) continue; // dungeon exits are resolved per player by the server
      const dest = getZoneMap(p.to);
      assert.equal(blocked(dest, tileCenter(p.toTx), tileCenter(p.toTy)), false, 'arrival walkable');
      assert.notEqual(tileAt(dest, p.toTx, p.toTy), T.Portal, 'arrival must not be a portal (no ping-pong)');
    }
    // M7/M8: every landmark can be walked to from the spawn point
    const reach = (tx: number, ty: number, what: string) => assert.equal(seen[tx + ty * m.w], 1, `${def.id}: ${what} reachable`);
    for (const g of def.gates ?? []) {
      assert.equal(tileAt(m, g.tx, g.ty), T.Gate);
      assert.ok(DUNGEONS[g.dungeon], 'gate leads to a real dungeon');
      reach(g.tx, g.ty, 'dungeon gate');
    }
    if (def.town) reach(def.town.tx, def.town.ty, 'town');
    for (const c of def.clearings ?? []) reach(c.tx, c.ty, 'clearing');
    if (def.kind === 'dungeon' && def.id !== 'h_home') for (const c of CHAMBERS) reach(c.cx, c.cy, 'chamber');
  }
  assert.deepEqual(REGIONS.map((z) => ZONES[z].level[0]), [1, 4, 10, 18, 26, 34, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180], 'sixteen regions in rising level order, up to 200');
  assert.equal(ZONES[REGIONS.at(-1)!].level[1], 200);
  for (let i = 1; i < REGIONS.length; i++) {
    assert.ok(ZONES[REGIONS[i - 1]].portals.some((p) => p.to === REGIONS[i]), `${REGIONS[i - 1]} -> ${REGIONS[i]}`);
    assert.ok(ZONES[REGIONS[i]].portals.some((p) => p.to === REGIONS[i - 1]), `${REGIONS[i]} -> ${REGIONS[i - 1]}`);
  }
  for (const d of Object.values(DUNGEONS)) {
    assert.equal(ZONES[d.zone].kind, 'dungeon');
    assert.ok(Object.values(ZONES).some((z) => z.gates?.some((g) => g.dungeon === d.id)), `${d.id} has an entrance in the world`);
    assert.equal(d.stages.length, 4, 'two halls of waves, the elite guard, the boss');
    assert.ok(MONSTERS[d.boss].boss && !MONSTERS[d.boss].boss!.world);
    assert.ok(d.stages[2].spawns.some(([t]) => MONSTERS[t].elite), 'the third stage is guarded by an elite');
    for (const st of d.stages) for (const [t, n] of st.spawns) assert.ok(MONSTERS[t] && n > 0, `${d.id}/${t}`);
  }
});

test('SpatialGrid rect query matches brute force under random movement', () => {
  const grid = new SpatialGrid<{ x: number; y: number; cell: number; id: number }>(256);
  const items = Array.from({ length: 300 }, (_, id) => ({ id, x: Math.random() * 3000, y: Math.random() * 3000, cell: 0 }));
  items.forEach((i) => grid.insert(i));
  for (let round = 0; round < 20; round++) {
    for (const i of items) {
      i.x = Math.max(0, i.x + (Math.random() - 0.5) * 400);
      i.y = Math.max(0, i.y + (Math.random() - 0.5) * 400);
      grid.update(i);
    }
    if (round === 10) items.splice(0, 50).forEach((i) => grid.remove(i));
    const x0 = Math.random() * 2000, y0 = Math.random() * 2000;
    const out: typeof items = [];
    grid.queryRect(x0, y0, x0 + 900, y0 + 700, out);
    const want = items.filter((i) => i.x >= x0 && i.x <= x0 + 900 && i.y >= y0 && i.y <= y0 + 700);
    assert.deepEqual(out.map((i) => i.id).sort(), want.map((i) => i.id).sort());
  }
});

test('password hashing: salted scrypt, verify accepts only the right password', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('wrong horse', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

// ---- World (no network, no database) ----
function harness(opts: { rng?: () => number; capacity?: number; kit?: boolean; world?: Partial<WorldOpts> } = {}) {
  const saved: any[] = [];
  const builds: any[] = [];
  const items: any[] = [];
  const discs: any[] = [];
  const trades: any[] = [];
  const repo: any = { saveAuto: async () => {}, saveTrade: async (a: any, b: any, log: any) => void trades.push({ a, b, log }), saveState: async (rows: any[]) => void saved.push(...rows), saveBuild: async (id: number, skills: any, runes: any) => void builds.push({ id, skills, runes }), saveItems: async (snap: any) => void items.push(snap), saveDiscoveries: async (id: number, list: string[]) => void discs.push({ id, list }) };
  // anything else the world stores (progress, guilds, PvP records) is accepted and ignored
  const repoAny = new Proxy(repo, { get: (t, k) => t[k] ?? (async () => {}) });
  // Monsters are placed by hand in combat tests; rng 0.5 = no miss, no crit, no damage variance.
  const world = new World(repoAny, { events: false, roomCapacity: opts.capacity ?? 3, reconnectGraceMs: 0, autosaveMs: 1e9, monsters: false, rng: opts.rng ?? (() => 0.5), ...opts.world });
  let id = 0;
  const join = (dx = 0, dy = 0, job: Job = 'knight', level = 1, weapon = -1, zone = 'eldoria') => {
    const sp = ZONES[zone].spawn;
    const out: any[] = [];
    const row: CharacterRow = {
      id: ++id, account_id: id, name: 'P' + id, job, level, exp: 0,
      appearance: weapon < 0 ? defaultAppearance(job) : { ...defaultAppearance(job), weapon }, zone_id: zone,
      pos_x: tileCenter(sp.tx) + dx, pos_y: tileCenter(sp.ty) + dy,
      // Pre-M6 tests measure bare characters: mark the starter kit as already granted unless asked.
      equipment: opts.kit ? {} : { kit: true },
    };
    const conn = { send: (d: string) => out.push(JSON.parse(d)), close() {} };
    return { p: world.join(row, conn), out, conn, row };
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) (world as any).step();
  };
  return { world, join, step, saved, builds, items, discs, trades };
}

test('input flooding cannot exceed the simulation rate (speed-hack guard)', () => {
  const { world, join, step } = harness();
  const { p } = join();
  const x0 = p.x;
  for (let s = 1; s <= 500; s++) world.input(p, s, 1, 0, 1);
  step(10);
  // 10 ticks of budget + burst allowance of 3, queue capped at 8 inputs.
  assert.ok(p.x - x0 <= 8 * p.runStep + 0.01, `moved ${p.x - x0}`);
  for (let i = 0; i < 20; i++) {
    for (let k = 0; k < 5; k++) world.input(p, p.lastSeq + 1 + k, 1, 0, 1);
    step();
  }
  assert.ok(p.x - x0 <= (30 + 3) * p.runStep + 0.01, `moved ${p.x - x0} in 30 ticks`);
});

test('malformed inputs are ignored', () => {
  const { world, join, step } = harness();
  const { p } = join();
  const x0 = p.x;
  for (const bad of [[1, 5, 0, 1], [1.5, 1, 0, 1], ['1', 1, 0, 1], [2, 0.5, 0, 1], [-1, 1, 0, 1], [3, NaN, 0, 1], [4, 1, null, 1], [5, 1, 0, 2], [6, 1, 0, undefined], [7, 1, 0, true]]) world.input(p, bad[0], bad[1], bad[2], bad[3]);
  step(5);
  assert.equal(p.x, x0);
});

test('interest management: add on enter, delta moves, rm on leave, nothing for far players', () => {
  const { world, join, step } = harness();
  const a = join(0, 0);
  const b = join(40, 0);
  const far = join(0, 1200); // outside AOI_HALF_H
  step();
  const addsFor = (o: any[]) => o.filter((m) => m.t === 'snap').flatMap((m) => m.add ?? []).map((e: any) => e.id);
  assert.deepEqual(addsFor(a.out), [b.p.id]);
  assert.deepEqual(addsFor(b.out), [a.p.id]);
  assert.deepEqual(addsFor(far.out), []);
  a.out.length = 0;
  world.input(b.p, 1, 1, 0, 1);
  step();
  const mv = a.out.filter((m) => m.t === 'snap').flatMap((m) => m.mv ?? []);
  assert.deepEqual(mv, [[b.p.id, b.p.x, b.p.y, 2, Move.Run]]);
  a.out.length = 0;
  step(3); // b idle: a gets no further packets about b except the stop transition
  const after = a.out.flatMap((m) => m.mv ?? []);
  assert.ok(after.length <= 1);
  // teleport b out of range -> rm
  b.p.x += 5000;
  b.p.room.grid.update(b.p);
  a.out.length = 0;
  step();
  assert.deepEqual(a.out.flatMap((m) => m.rm ?? []), [b.p.id]);
});

test('idle players receive only heartbeat snapshots', () => {
  const { join, step } = harness();
  const a = join();
  step(2);
  a.out.length = 0;
  step(100);
  const n = a.out.filter((m) => m.t === 'snap').length;
  assert.ok(n >= 4 && n <= 6, `got ${n} snapshots in 100 idle ticks`);
});

test('channels: a full room spills into a new channel', () => {
  const { join } = harness(); // capacity 3
  const ps = [join(), join(), join(), join()];
  assert.deepEqual(ps.map((x) => x.p.room.channel), [1, 1, 1, 2]);
});

test('duplicate login kicks the old socket and resumes the same entity', () => {
  const { world, join } = harness();
  const a = join();
  const out2: any[] = [];
  let closed = false;
  (a.conn as any).close = () => (closed = true);
  const p2 = world.join(a.row, { send: (d) => out2.push(JSON.parse(d)), close() {} });
  assert.equal(p2, a.p);
  assert.equal(closed, true);
  assert.equal(a.out.at(-1).t, 'kick');
  assert.equal(out2[0].t, 'welcome');
  assert.equal(world.online.size, 1);
});

test('walking onto a portal transfers the player to the linked zone', () => {
  const { world, join, step } = harness();
  const portal = ZONES.eldoria.portals[0];
  const a = join();
  a.p.x = tileCenter(portal.tx - 1);
  a.p.y = tileCenter(portal.ty);
  a.p.room.grid.update(a.p);
  let seq = 0;
  for (let i = 0; i < 10 && a.p.room.zoneId === 'eldoria'; i++) {
    world.input(a.p, ++seq, 1, 0, 1);
    step();
  }
  assert.equal(a.p.room.zoneId, 'verdant');
  assert.equal(a.p.x, tileCenter(portal.toTx));
  const w = a.out.filter((m) => m.t === 'welcome');
  assert.equal(w.at(-1).zone, 'verdant');
});

test('disconnect keeps the entity until grace expires, then saves and despawns', () => {
  const { world, join, step, saved } = harness();
  const a = join();
  world.input(a.p, 1, 1, 0, 1);
  step();
  world.disconnect(a.p, a.conn);
  assert.equal(world.online.size, 1);
  assert.equal(saved.length, 0, 'no database write on movement');
  (world as any).housekeep(Date.now() + 1);
  assert.equal(world.online.size, 0);
  assert.deepEqual(saved, [{ id: a.p.id, zone: 'eldoria', x: a.p.x, y: a.p.y, level: 1, exp: 0 }]);
});

// ======================= M2: jobs, appearance, animation, actions =======================

test('six jobs are mechanically distinct and complete', () => {
  assert.equal(JOBS.length, 6);
  const sig = new Set<string>(), roles = new Set<string>(), skillIds = new Set<string>();
  for (const j of JOBS) {
    const d = JOB_DEFS[j];
    assert.equal(d.id, j);
    sig.add(JSON.stringify([d.base, d.growth, computeStats(j, 1, 0)]));
    roles.add(d.role);
    assert.equal(d.weapons.length, 2, `${j} weapon specialisations`);
    assert.ok(d.passives.length >= 3, `${j} passives`);
    assert.ok(d.passives.some((p) => p.level === 1), `${j} has a level-1 passive`);
    assert.ok(d.skills.length >= 7, `${j} skill tree`);
    assert.deepEqual([...new Set(d.skills.map((s) => s.tier))].sort(), [1, 2, 3]);
    const own = new Set(d.skills.map((s) => s.id));
    for (const s of d.skills) {
      assert.ok(!skillIds.has(s.id), `skill id ${s.id} unique across jobs`);
      skillIds.add(s.id);
      for (const r of s.requires ?? []) {
        assert.ok(own.has(r), `${j}.${s.id} requires existing ${r}`);
        assert.ok(d.skills.find((x) => x.id === r)!.level <= s.level, 'prerequisite unlocks first');
      }
    }
    assert.equal(d.tiers[0].level, 1);
    assert.ok(d.tiers.length >= 3 && d.tiers.every((t, i) => i === 0 || t.level > d.tiers[i - 1].level), `${j} progression tiers`);
    assert.equal(jobTitle(j, 1), d.tiers[0].title);
    assert.equal(jobTitle(j, 60), d.tiers.at(-1)!.title);
  }
  assert.equal(sig.size, 6, 'no two jobs share attributes and stats');
  assert.equal(roles.size, 6);
});

test('each job keeps its combat identity at every level', () => {
  const best = (lvl: number, f: (s: ReturnType<typeof computeStats>) => number) => JOBS.reduce((a, b) => (f(computeStats(a, lvl, 0)) >= f(computeStats(b, lvl, 0)) ? a : b));
  for (const lvl of [1, 15, 30, 60]) {
    assert.equal(best(lvl, (s) => s.maxHp), 'knight', `tankiest HP at ${lvl}`);
    assert.equal(best(lvl, (s) => s.def), 'knight');
    assert.equal(best(lvl, (s) => s.matk), 'mage');
    assert.equal(best(lvl, (s) => s.moveMul), 'assassin');
    assert.equal(best(lvl, (s) => s.critDmg), 'assassin');
    assert.equal(best(lvl, (s) => s.healPower), 'cleric');
    assert.equal(best(lvl, (s) => s.lifesteal), 'berserker');
    assert.equal(best(lvl, (s) => s.atk), 'berserker');
    assert.ok(computeStats('ranger', lvl, 0).range > 200 && computeStats('ranger', lvl, 0).crit > computeStats('knight', lvl, 0).crit);
  }
  assert.equal(JOB_DEFS.berserker.resource, 'rage');
  assert.equal(computeStats('berserker', 1, 0).maxRes, computeStats('berserker', 60, 0).maxRes, 'rage cap does not scale');
});

test('stats grow with level, passives unlock on schedule, weapon choice matters', () => {
  for (const j of JOBS) {
    let prev = computeStats(j, 1, 0);
    for (let l = 2; l <= 60; l++) {
      const s = computeStats(j, l, 0);
      assert.ok(s.maxHp > prev.maxHp && s.atk >= prev.atk && s.def >= prev.def, `${j} L${l}`);
      for (const a of ATTRS) assert.ok(attrsAt(j, l)[a] >= attrsAt(j, l - 1)[a]);
      prev = s;
    }
    assert.notDeepEqual(computeStats(j, 20, 0), computeStats(j, 20, 1), `${j} weapons differ`);
  }
  const k9 = computeStats('knight', 9, 0), k10 = computeStats('knight', 10, 0);
  assert.ok(k10.maxHp / k9.maxHp > 1.12, 'Iron Will (+12% HP) applies from level 10');
  assert.equal(computeStats('ranger', 1, 0).crit, JOB_DEFS.ranger.critBase + 1 + 5, 'Eagle Eye adds 5% crit');
});

test('appearance validation is strict', () => {
  for (const j of JOBS) {
    const ap = defaultAppearance(j);
    assert.deepEqual(parseAppearance(ap, j), ap);
    assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(ap)), j), ap);
    for (let i = 0; i < 200; i++) assert.equal(typeof parseAppearance(randomAppearance(j), j), 'object');
    for (const f of AP_FIELDS) {
      assert.equal(typeof parseAppearance({ ...ap, [f]: AP_LIMITS[f] }, j), 'string', `${f} upper bound`);
      assert.equal(typeof parseAppearance({ ...ap, [f]: -1 }, j), 'string');
      assert.equal(typeof parseAppearance({ ...ap, [f]: 0.5 }, j), 'string');
      assert.equal(typeof parseAppearance({ ...ap, [f]: '1' }, j), 'string');
      const { [f]: _, ...missing } = ap;
      assert.equal(typeof parseAppearance(missing, j), 'string', `${f} required`);
    }
    assert.equal(typeof parseAppearance({ ...ap, level: 99 }, j), 'string', 'unknown fields rejected');
  }
  for (const bad of [null, 1, 'x', [], { skin: 1, hair: 0, hairColor: 2, outfit: 3 }]) assert.equal(typeof parseAppearance(bad, 'knight'), 'string');
});

test('animation sheet layout: 7 animations, contiguous columns, loop vs hold', () => {
  assert.deepEqual(ANIM_NAMES, ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death']);
  let col = 0;
  for (const a of ANIM_NAMES) {
    assert.equal(ANIM_COL[a], col);
    col += ANIMS[a].frames;
  }
  assert.equal(SHEET_COLS, col);
  assert.equal(animFrame('walk', ANIMS.walk.ms * 5), ANIM_COL.walk + 1, 'looping animation wraps');
  assert.equal(animFrame('death', 99999), ANIM_COL.death + ANIMS.death.frames - 1, 'one-shot holds last frame');
  assert.equal(animFrame('attack', 0), ANIM_COL.attack);
});

test('movement speed is job- and gait-specific and applied by the server', () => {
  const { world, join, step } = harness();
  const k = join(0, 0, 'knight'), a = join(0, 64, 'assassin');
  assert.ok(a.p.runStep > k.p.runStep && k.p.walkStep < k.p.runStep);
  const kx = k.p.x, ax = a.p.x;
  for (let s = 1; s <= 5; s++) {
    world.input(k.p, s, 1, 0, 1);
    world.input(a.p, s, 1, 0, 0);
    step();
  }
  assert.ok(Math.abs(k.p.x - kx - 5 * stepSize(0.95, true)) < 0.011);
  assert.ok(Math.abs(a.p.x - ax - 5 * stepSize(computeStats('assassin', 1, 0).moveMul, false)) < 0.011);
  assert.equal(k.p.moving, Move.Run);
  assert.equal(a.p.moving, Move.Walk);
});

test('welcome carries server-computed stats; actions replicate with a server-side cooldown', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage'), b = join(30, 0, 'knight');
  const w = a.out.find((m) => m.t === 'welcome');
  assert.deepEqual(w.stats, computeStats('mage', 1, a.row.appearance.weapon));
  assert.equal(w.hp, w.stats.maxHp);
  step();
  b.out.length = 0;
  // spam: 40 requests over 40 ticks (2s). Mage attack interval 1100ms -> at most 2 accepted.
  let evs: any[] = [];
  for (let i = 0; i < 40; i++) {
    world.action(a.p, Act.Attack);
    step();
  }
  evs = b.out.flatMap((m) => m.ev ?? []);
  assert.ok(evs.length >= 1 && evs.length <= 2, `attack events: ${evs.length}`);
  assert.deepEqual(evs[0], [a.p.id, Act.Attack]);
  assert.equal(a.out.slice(1).flatMap((m) => m.ev ?? []).length, 0, 'no echo to the actor');
  b.out.length = 0;
  for (const bad of [2, -1, '0', null, 0.5]) world.action(a.p, bad);
  step(30);
  assert.equal(b.out.flatMap((m) => m.ev ?? []).length, 0, 'invalid action kinds ignored');
  world.action(a.p, Act.Cast);
  step();
  assert.equal(b.out.flatMap((m) => m.ev ?? []).length, 0, 'the M2 cast emote is gone; casting goes through abilities');
});

// ======================= M3: combat, monsters, death, EXP =======================
const snaps = (o: any[]) => o.filter((m) => m.t === 'snap');
const dmOf = (o: any[]) => snaps(o).flatMap((m) => m.dm ?? []);
const lastMe = (o: any[]) => snaps(o).filter((m) => m.me).at(-1)?.me;

test('M3 tables: EXP curve, mitigation, statuses, monster definitions', () => {
  for (let l = 1; l < 199; l++) assert.ok(expToNext(l + 1) > expToNext(l));
  assert.ok(mitigate(100, 0) === 100 && mitigate(100, 25) === 50 && mitigate(100, 1e6) > 0 && mitigate(100, -5) === 100);
  assert.deepEqual([missChance(1, 1), missChance(1, 30), missChance(30, 1)], [5, 25, 2]);
  assert.deepEqual([expLevelFactor(3, 1), expLevelFactor(1, 9), expLevelFactor(13, 1), expLevelFactor(40, 30), expLevelFactor(60, 30), expLevelFactor(80, 30)], [1, 1, 0.643, 0.714, 0, 0]);
  // tiers of 30 levels, three times harder each: EXP_REQUIRED(L) = 40 x L^1.8 x 3^(ceil(L/30) - 1)
  assert.deepEqual([expToNext(1), expToNext(30), expToNext(31), expToNext(61), expToNext(199)], [40, Math.round(40 * 30 ** 1.8), Math.round(40 * 31 ** 1.8 * 3), Math.round(40 * 61 ** 1.8 * 9), Math.round(40 * 199 ** 1.8 * 729)]);
  assert.equal(modsOf(1 << STATUS_INDEX.slow).move, 0.55);
  assert.equal(modsOf(1 << STATUS_INDEX.stun).stun, true);
  const m = modsOf((1 << STATUS_INDEX.enrage) | (1 << STATUS_INDEX.weaken));
  assert.ok(Math.abs(m.atk - 1.35 * 0.75) < 1e-9);
  const names = new Set<string>();
  for (const d of Object.values(MONSTERS)) {
    assert.ok(d.hp > 0 && d.atk > 0 && d.exp > 0 && patternOf(d, 0).length > 0 && d.leash > d.aggro, d.id);
    assert.ok(!names.has(d.name));
    names.add(d.name);
    const phases = d.boss ? d.boss.phases.map((p) => p.pattern) : [d.pattern];
    for (const pat of phases) for (const a of pat) {
      if (a.status) assert.ok(a.status.id in STATUS_INDEX, `${d.id} status`);
      if (a.summon) assert.ok(MONSTERS[a.summon.type] && !MONSTERS[a.summon.type].boss, `${d.id} summon`);
      if (a.donut) assert.ok(a.self && a.aoe! > a.donut + 40, `${d.id}: a ring needs a safe centre and a wide band`);
    }
    if (!d.boss) assert.equal(d.elite, d.pattern.length >= 4, `${d.id}: elites have richer patterns`);
  }
  assert.ok(new Set(Object.values(MONSTERS).map((d) => JSON.stringify(d.pattern.map((a) => a.name)))).size >= 7, 'attack patterns differ between monsters');
  for (const [zone, groups] of Object.entries(SPAWNS)) for (const g of groups) assert.ok(MONSTERS[g.type] && ZONES[zone], `${zone}/${g.type}`);
});

test('M3 spawning: every group is placed on walkable ground away from the arrival points', () => {
  let s = 12345;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const repo: any = { saveState: async () => {} };
  for (const zone of ['eldoria', 'verdant']) {
    const world = new World(new Proxy(repo as any, { get: (t: any, k) => t[k] ?? (async () => {}) }), { roomCapacity: 10, reconnectGraceMs: 0, autosaveMs: 1e9, rng });
    const sp = ZONES[zone].spawn;
    const p = world.join({ id: 1, account_id: 1, name: 'A', job: 'knight', level: 1, exp: 0, appearance: defaultAppearance('knight'), zone_id: zone, pos_x: tileCenter(sp.tx), pos_y: tileCenter(sp.ty) }, { send() {}, close() {} });
    const want = SPAWNS[zone].reduce((n, g) => n + g.count, 0);
    assert.equal(p.room.monsters.size, want, `${zone}: all ${want} monsters placed`);
    for (const m of p.room.monsters.values()) {
      assert.equal(blocked(p.room.map, m.x, m.y), false);
      assert.ok(Math.hypot(m.x - p.x, m.y - p.y) > 8 * TILE, `${m.def.id} not on top of the spawn point`);
      assert.ok(m.id < 0);
    }
    assert.equal(world.metrics().monsters, want);
  }
});

test('M3 basic attack: server-computed damage, interval, kill, EXP, corpse removal and respawn', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight');
  const m = world.spawn(a.p.room, 'mossling', a.p.x + 26, a.p.y);
  step();
  const meta = snaps(a.out).flatMap((s) => s.add ?? []).find((e: any) => e.id === m.id);
  assert.deepEqual([meta.mt, meta.name, meta.hp, meta.mhp, meta.level], ['mossling', 'Mossling', 60, 60, 1]);
  world.setTarget(a.p, m.id);
  world.action(a.p, Act.Attack);
  a.out.length = 0;
  step();
  const per = Math.round(mitigate(a.p.stats.atk, MONSTERS.mossling.def));
  assert.deepEqual(dmOf(a.out), [[m.id, per, 0, a.p.id]], 'damage computed by the server formula');
  assert.equal(m.hp, 60 - per);
  assert.deepEqual(lastMe(a.out).tgt, m.id);
  assert.equal(lastMe(a.out).atk, 1);
  let n = 1;
  for (let i = 0; i < 400 && !m.dead; i++) {
    step();
    n = dmOf(a.out).filter((d: any) => d[3] === a.p.id).length;
  }
  assert.equal(m.dead, true);
  // every third blow in a row is a finisher (G1)
  const fin = Math.round(mitigate(a.p.stats.atk * BASIC_COMBO.mul, MONSTERS.mossling.def));
  let need = 0;
  for (let left = 60; left > 0; need++) left -= (need + 1) % BASIC_COMBO.hits === 0 ? fin : per;
  assert.equal(n, need, 'exactly as many hits as the HP requires');
  const tickSpan = world.tick - 2;
  assert.ok(tickSpan >= (n - 1) * (a.p.stats.atkIntervalMs / 50) - 1, `attack interval respected (${n} hits in ${tickSpan} ticks)`);
  assert.equal(a.p.exp, MONSTERS.mossling.exp);
  assert.equal(snaps(a.out).map((s) => s.me?.xp).filter(Boolean).reduce((x: number, y: number) => x + y, 0), 12);
  assert.equal(a.p.target, null);
  a.out.length = 0;
  step(30);
  assert.deepEqual(snaps(a.out).flatMap((s) => s.rm ?? []), [m.id], 'corpse leaves the world');
  step(MONSTERS.mossling.respawnMs / 50);
  const again = snaps(a.out).flatMap((s) => s.add ?? []).find((e: any) => e.id === m.id);
  assert.equal(again.hp, 60, 'respawned at full health');
  assert.equal(m.dead, false);
});

test('M3 range and target validation', () => {
  const { world, join, step } = harness();
  const k = join(0, 0, 'knight'), r = join(0, 40, 'ranger');
  const far = world.spawn(k.p.room, 'mossling', k.p.x + 200, k.p.y);
  world.setTarget(k.p, far.id);
  world.action(k.p, Act.Attack);
  world.setTarget(r.p, far.id);
  world.action(r.p, Act.Attack);
  step(60);
  assert.ok(far.dmgBy.get(r.p.id)! > 0, 'ranger reaches 200px');
  assert.equal(far.dmgBy.get(k.p.id), undefined, 'knight does not');
  for (const bad of [r.p.id, 999, -999, 0, '1', null, 1.5, {}]) {
    world.setTarget(k.p, bad);
    assert.equal(k.p.target, null, `target ${JSON.stringify(bad)} rejected`);
  }
  const tooFar = world.spawn(k.p.room, 'mossling', k.p.x + 900, k.p.y);
  world.setTarget(k.p, tooFar.id);
  assert.equal(k.p.target, null);
  // Attack with no target picks the nearest monster within reach; otherwise it is a free swing.
  const near = world.spawn(k.p.room, 'mossling', k.p.x - 30, k.p.y);
  world.action(k.p, Act.Attack);
  assert.equal(k.p.target, near);
});

test('M3 level up: stats recomputed on the server, announced, and saved', () => {
  const { world, join, step, saved } = harness();
  const a = join(0, 0, 'mage'), b = join(20, 0, 'knight');
  step();
  a.out.length = b.out.length = 0;
  world.hurt(a.p, 50, 0, null);
  world.grantExp(a.p, expToNext(1) + expToNext(2) + 7);
  step();
  assert.equal(a.p.level, 3);
  assert.equal(a.p.exp, 7);
  assert.deepEqual(a.p.stats, computeStats('mage', 3, a.p.ap.weapon));
  assert.equal(a.p.hp, a.p.stats.maxHp, 'healed on level up');
  const st = a.out.find((m) => m.t === 'stats');
  assert.deepEqual([st.level, st.exp, st.next], [3, 7, expToNext(3)]);
  assert.deepEqual(snaps(b.out).flatMap((s) => s.ev ?? []), [[a.p.id, Act.LevelUp, 3]]);
  assert.deepEqual(snaps(b.out).flatMap((s) => s.hp ?? []).at(-1), [a.p.id, a.p.maxHp, a.p.maxHp, 0]);
  world.disconnect(a.p, a.conn);
  (world as any).housekeep(Date.now() + 1);
  assert.deepEqual(saved.map((r) => [r.level, r.exp]), [[3, 7]]);
  // 20 levels above the monster: a share of the EXP; 30 or more above: nothing
  const mid = join(0, 60, 'knight', 21);
  world.hurt(world.spawn(mid.p.room, 'mossling', mid.p.x + 26, mid.p.y), 60, 0, mid.p);
  assert.equal(mid.p.exp, Math.round(12 * ((30 - 20) / 28)));
  const hi = join(0, 90, 'knight', 31);
  world.hurt(world.spawn(hi.p.room, 'mossling', hi.p.x + 26, hi.p.y), 60, 0, hi.p);
  assert.equal(hi.p.exp, 0);
});

test('M3 monster AI: aggressive monsters chase and attack, neutral ones only retaliate', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight');
  const boar = world.spawn(a.p.room, 'boar', a.p.x + 120, a.p.y);
  const moss = world.spawn(a.p.room, 'mossling', a.p.x, a.p.y + 60);
  const d0 = Math.hypot(boar.x - a.p.x, boar.y - a.p.y);
  step(30);
  assert.equal(boar.state === 'chase' || boar.state === 'windup', true);
  assert.ok(Math.hypot(boar.x - a.p.x, boar.y - a.p.y) < d0 - 30, 'boar closed in');
  step(200);
  const taken = dmOf(a.out).filter((d: any) => d[0] === a.p.id);
  assert.ok(taken.length > 0 && taken.every((d: any) => d[3] === boar.id), 'only the boar attacked');
  assert.ok(a.p.hp < a.p.maxHp);
  assert.equal(moss.state, 'idle', 'neutral mossling ignored the player');
  assert.ok(Math.hypot(moss.x - moss.spawnX, moss.y - moss.spawnY) <= 75, 'wanders near its camp');
  world.hurt(moss, 5, 0, a.p);
  step(120);
  assert.ok(dmOf(a.out).some((d: any) => d[3] === moss.id), 'mossling fights back once hit');
});

test('M3 leash: a monster dragged too far returns home, heals and cannot be hit on the way', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'ranger');
  const boar = world.spawn(a.p.room, 'boar', a.p.x + 100, a.p.y);
  world.hurt(boar, 30, 0, a.p);
  step(10);
  assert.equal(boar.state, 'chase');
  a.p.x += 700; // far beyond the 420px leash
  a.p.room.grid.update(a.p);
  step(400);
  const st: string = boar.state;
  assert.ok(st === 'return' || st === 'idle');
  const before = boar.hp;
  if (st === 'return') {
    world.setTarget(a.p, boar.id);
    (world as any).strike(a.p, boar, 1);
    assert.equal(boar.hp >= before, true, 'evading: no damage while returning');
  }
  step(400);
  assert.equal(boar.state, 'idle');
  assert.equal(boar.hp, boar.maxHp);
  assert.ok(Math.hypot(boar.x - boar.spawnX, boar.y - boar.spawnY) < 80);
});

test('M3 death and respawn: dead players cannot act; respawn is gated, free of penalties, and warded', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage');
  const tusk = world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y);
  world.grantExp(a.p, 20);
  world.hurt(tusk, 1, 0, a.p);
  for (let i = 0; i < 2000 && !a.p.dead; i++) step();
  assert.equal(a.p.dead, true);
  assert.equal(a.p.hp, 0);
  assert.ok(lastMe(a.out).dead > 0);
  const x = a.p.x;
  for (let s = 1; s <= 5; s++) world.input(a.p, s, 1, 0, 1);
  world.setTarget(a.p, tusk.id);
  world.action(a.p, Act.Attack);
  step(3);
  assert.equal(a.p.x, x, 'no movement while dead');
  assert.equal(a.p.lastSeq, 5, 'inputs still acknowledged');
  assert.equal(a.p.target, null);
  assert.equal(tusk.threat.size, 0, 'monster drops a dead target');
  world.requestRespawn(a.p);
  assert.equal(a.p.dead, true, `manual respawn refused before ${RESPAWN_MIN_MS}ms`);
  step(RESPAWN_MIN_MS / 50);
  world.requestRespawn(a.p);
  const sp = ZONES.eldoria.spawn;
  assert.deepEqual([a.p.dead, a.p.hp, a.p.x, a.p.y], [false, a.p.maxHp, tileCenter(sp.tx), tileCenter(sp.ty)]);
  assert.equal(a.p.exp, 20, 'no EXP penalty');
  assert.ok(a.p.mask & (1 << STATUS_INDEX.ward));
  assert.equal(a.out.filter((m) => m.t === 'welcome').length, 2);
  // the respawn welcome resets the client, so everything nearby must be sent again
  const friend = join(20, 0, 'knight');
  step();
  world.hurt(a.p, 99999, 0, null);
  step(RESPAWN_MIN_MS / 50 + 1);
  a.out.length = 0;
  world.requestRespawn(a.p);
  step();
  assert.ok(snaps(a.out).flatMap((s) => s.add ?? []).some((e: any) => e.id === friend.p.id), 'nearby players are re-sent after respawn');
  // automatic respawn
  world.hurt(a.p, 99999, 0, null);
  step(RESPAWN_AUTO_MS / 50 + 1);
  assert.equal(a.p.dead, false);
});

test('M3 statuses: poison ticks and stacks, slow changes the server step, stun blocks input and attacks', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight');
  const run0 = a.p.runStep;
  applyStatus(a.p, STATUS_INDEX.poison, world.tick, 50, 0);
  step(21);
  assert.deepEqual(dmOf(a.out).at(-1), [a.p.id, Math.round(50 * 0.12), Dmg.Dot, 0]);
  for (let i = 0; i < 5; i++) applyStatus(a.p, STATUS_INDEX.poison, world.tick, 50, 0);
  assert.equal(a.p.st[0].stacks, 3, 'stack cap');
  step(20);
  assert.equal(dmOf(a.out).at(-1)[1], Math.round(50 * 0.12 * 3));
  assert.equal(lastMe(a.out).st[0][0], STATUS_INDEX.poison);
  step(110);
  assert.equal(a.p.mask, 0, 'expired after 5s');
  applyStatus(a.p, STATUS_INDEX.slow, world.tick, 0, 0);
  assert.ok(Math.abs(a.p.runStep - stepSize(0.95 * 0.55, true)) < 0.011 && a.p.runStep < run0);
  const x0 = a.p.x;
  world.input(a.p, 1, 1, 0, 1);
  step();
  assert.ok(Math.abs(a.p.x - x0 - a.p.runStep) < 0.011, 'slowed step applied');
  step(70);
  assert.equal(a.p.runStep, run0);
  const m = world.spawn(a.p.room, 'mossling', a.p.x + 26, a.p.y);
  world.setTarget(a.p, m.id);
  world.action(a.p, Act.Attack);
  applyStatus(a.p, STATUS_INDEX.stun, world.tick, 0, 0);
  const x1 = a.p.x, hp = m.hp;
  world.input(a.p, 2, 1, 0, 1);
  step(10);
  assert.equal(a.p.x, x1);
  assert.equal(m.hp, hp, 'no attacks while stunned');
  step(30);
  assert.ok(m.hp < hp, 'attacks resume');
});

test('M3 weapon mechanics: double strike, venom, cleave, pierce, block, rage and lifesteal', () => {
  // daggers strike twice
  let h = harness();
  let a = h.join(0, 0, 'assassin', 1, 0);
  let m = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y);
  h.world.setTarget(a.p, m.id);
  h.world.action(a.p, Act.Attack);
  h.step();
  let d = dmOf(a.out).filter((x: any) => x[3] === a.p.id);
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[1][1] / d[0][1] - 0.4) < 0.12, `second strike ~40% (${d[0][1]}, ${d[1][1]})`);
  // venom daggers poison (rng 0.2 -> 20 < 35% chance; still no miss since 20 > 5)
  h = harness({ rng: () => 0.2 });
  a = h.join(0, 0, 'assassin', 1, 1);
  m = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y);
  h.world.setTarget(a.p, m.id);
  h.world.action(a.p, Act.Attack);
  h.step();
  assert.ok(m.mask & (1 << STATUS_INDEX.poison), 'venom applied');
  h.step(25);
  assert.ok(dmOf(a.out).some((x: any) => x[0] === m.id && x[2] & Dmg.Dot), 'poison ticks on the monster');
  // greatsword cleaves neighbours
  h = harness();
  a = h.join(0, 0, 'knight', 1, 1);
  const m1 = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y), m2 = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y + 30);
  h.world.setTarget(a.p, m1.id);
  h.world.action(a.p, Act.Attack);
  h.step();
  assert.ok(m1.hp < m1.maxHp && m2.hp < m2.maxHp && m1.maxHp - m1.hp > m2.maxHp - m2.hp, 'main target takes more than the cleaved one');
  // crossbow ignores 30% of defence
  h = harness();
  a = h.join(0, 0, 'ranger', 1, 1);
  m = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 100, a.p.y);
  h.world.setTarget(a.p, m.id);
  h.world.action(a.p, Act.Attack);
  h.step();
  assert.equal(m.maxHp - m.hp, Math.round(mitigate(a.p.stats.atk, MONSTERS.old_tusk.def * 0.7)));
  // shield blocks (rng 0.1 -> 10 < 20% block chance)
  h = harness({ rng: () => 0.1 });
  a = h.join(0, 0, 'knight', 1, 0);
  m = h.world.spawn(a.p.room, 'boar', a.p.x + 30, a.p.y);
  h.step(80);
  const blocks = dmOf(a.out).filter((x: any) => x[0] === a.p.id && x[2] & Dmg.Block);
  assert.ok(blocks.length > 0, 'blocked hits flagged');
  // berserker: rage per hit (x1.5 with dual axes) and lifesteal
  h = harness();
  a = h.join(0, 0, 'berserker', 1, 1);
  m = h.world.spawn(a.p.room, 'old_tusk', a.p.x + 30, a.p.y);
  assert.equal(a.p.res, 0);
  h.world.hurt(a.p, 40, 0, null);
  const hp0 = a.p.hp, rage0 = a.p.res;
  h.world.setTarget(a.p, m.id);
  h.world.action(a.p, Act.Attack);
  h.step();
  assert.equal(a.p.res - rage0, 12);
  assert.ok(a.p.hp > hp0, 'lifesteal healed');
  assert.ok(dmOf(a.out).some((x: any) => x[0] === a.p.id && x[2] & Dmg.Heal));
});

test('M3 threat and shared EXP: the monster turns on the biggest threat; all contributors are rewarded', () => {
  const { world, join, step } = harness();
  const a = join(-20, 0, 'cleric'), b = join(20, 0, 'berserker');
  const m = world.spawn(a.p.room, 'boar', a.p.x + 20, a.p.y + 34);
  world.hurt(m, 3, 0, a.p);
  step(40);
  assert.ok(dmOf(a.out).some((d: any) => d[0] === a.p.id && d[3] === m.id), 'first attacker is targeted');
  world.setTarget(b.p, m.id);
  world.action(b.p, Act.Attack);
  step(40);
  assert.ok(m.threat.get(b.p.id)! > m.threat.get(a.p.id)!);
  a.out.length = b.out.length = 0;
  for (let i = 0; i < 600 && !m.dead; i++) step();
  assert.equal(m.dead, true);
  assert.ok(b.p.exp > a.p.exp && a.p.exp >= Math.round(MONSTERS.boar.exp * 0.5), `both rewarded (${a.p.exp}, ${b.p.exp})`);
  assert.ok(a.p.exp + b.p.exp <= Math.round(MONSTERS.boar.exp * 1.5) + 1);
});

test('M3 pack hunters alert their neighbours', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight', 10);
  const w1 = world.spawn(a.p.room, 'wolf', a.p.x + 150, a.p.y), w2 = world.spawn(a.p.room, 'wolf', a.p.x + 280, a.p.y), w3 = world.spawn(a.p.room, 'wolf', a.p.x + 600, a.p.y);
  step(12);
  assert.ok(w1.threat.has(a.p.id) && w2.threat.has(a.p.id), 'wolf outside aggro range joined its packmate');
  assert.equal(w3.threat.size, 0);
});

test('M3 telegraphed area attacks can be dodged', () => {
  for (const dodge of [false, true]) {
    const { world, join, step } = harness();
    const a = join(0, 0, 'knight', 10);
    const tusk = world.spawn(a.p.room, 'old_tusk', a.p.x + 40, a.p.y);
    world.hurt(tusk, 1, 0, a.p);
    let tele: any;
    for (let i = 0; i < 300 && !tele; i++) {
      step();
      tele = snaps(a.out).flatMap((s) => s.ev ?? []).find((e: any) => e[1] === Act.Telegraph && e[4] === 85);
    }
    assert.ok(tele, 'ground slam telegraphed');
    assert.deepEqual([tele[0], tele[5]], [tusk.id, 1000]);
    a.out.length = 0;
    if (dodge) {
      a.p.y += 200;
      a.p.room.grid.update(a.p);
    }
    step(22);
    const hits = dmOf(a.out).filter((d: any) => d[0] === a.p.id && d[1] > 0);
    assert.equal(hits.length > 0, !dodge, dodge ? 'stepping out avoids the slam' : 'standing in it hurts');
    assert.equal(!!(snaps(a.out).flatMap((s) => s.me ? [s.me] : []).some((me: any) => me.st.some((x: any) => x[0] === STATUS_INDEX.stun))), !dodge);
  }
});

test('M3 regeneration only out of combat; elites enrage at low health', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight');
  const m = world.spawn(a.p.room, 'mossling', a.p.x + 400, a.p.y);
  world.hurt(a.p, 100, 0, m);
  const hp = a.p.hp;
  step(60);
  assert.equal(a.p.hp, hp, 'no regen within 5s of combat');
  step(140);
  assert.ok(a.p.hp > hp, 'regen after leaving combat');
  const tusk = world.spawn(a.p.room, 'old_tusk', a.p.x + 500, a.p.y);
  world.hurt(tusk, Math.ceil(tusk.maxHp * 0.75), 0, a.p);
  assert.ok(tusk.mask & (1 << STATUS_INDEX.enrage));
  assert.ok(tusk.mods.atk > 1 && tusk.mods.interval < 1);
});

// ======================= M4: rune magic and skills =======================
/** Grants skills/runes directly (bypassing the point economy) for effect tests. */
function grant(p: Player, skills: string[] = [], runes: Element[] = [], runeLv = 1, rank = 1) {
  for (const id of skills) p.build.skills[id] = rank;
  runes.forEach((el, i) => {
    p.build.runes.slots[i] = el;
    p.build.runes.lv[el] = runeLv;
  });
  p.recalc();
  p.hp = p.maxHp;
  p.res = p.stats.maxRes;
}
/** Puts players into one party (first is the leader), bypassing the invite rate limit. */
function group(world: World, leader: Player, ...others: Player[]) {
  for (const o of others) {
    leader.lastInvite = 0;
    assert.equal(world.party(leader, 'invite', o.id, undefined), '');
    assert.equal(world.party(o, 'accept', undefined, undefined), '');
  }
}
const fxOf = (o: any[]) => snaps(o).flatMap((m) => m.ev ?? []).filter((e: any) => e[1] === Act.Fx);

test('M4 tables: 12 rune spells in 5 elements, every active skill node is executable', () => {
  const want: Record<string, string[]> = {
    fire: ['Fireball', 'Flame Burst', 'Meteor Strike'], water: ['Water Bolt', 'Healing Rain', 'Ice Spear'],
    lightning: ['Thunder Strike', 'Chain Lightning'], earth: ['Stone Shield', 'Earthquake'], wind: ['Wind Slash', 'Tornado'],
  };
  assert.deepEqual([...ELEMENTS], Object.keys(want));
  const looks = new Set<string>();
  for (const el of ELEMENTS) {
    const spells = runeSpells(el);
    assert.deepEqual(spells.map((s) => s.name), want[el]);
    assert.equal(spells[0].unlock, 1, `${el}: first spell available at rune level 1`);
    for (const s of spells) {
      assert.ok(s.cost > 0 && s.cdMs > 0 && s.range >= 0 && s.unlock! >= 1 && s.desc.length > 10, s.id);
      assert.ok(s.hit?.mul || s.field || s.barrier, `${s.id} has a damage multiplier or effect`);
      looks.add(JSON.stringify(s.fx));
    }
  }
  assert.equal(looks.size, 12, 'every rune spell has its own visual effect');
  assert.equal(new Set(ABILITY_LIST.map((a) => a.id)).size, ABILITY_LIST.length);
  for (const j of JOBS) {
    const actives = JOB_DEFS[j].skills.filter((s) => s.type === 'active');
    assert.deepEqual(jobActives(j).map((a) => a?.id), actives.map((s) => s.id), `${j}: every active node has an ability`);
    for (const a of jobActives(j)) assert.equal(a.job, j);
    assert.equal(runeSlots(j), j === 'mage' ? 3 : 2);
  }
  assert.equal(ABILITY_LIST.length, 12 + JOBS.reduce((n, j) => n + jobActives(j).length, 0) + 12 + 10, 'rune spells, job skills, the twelve ultimates and the ten fusions');
});

test('M4 skill points: one per level, prerequisites, level gates, rank caps, respec', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight', 1);
  assert.equal(freePoints(1, a.p.build), 1);
  assert.equal(world.learn(a.p, 'taunt'), 'Requires level 3');
  assert.equal(world.learn(a.p, 'arcane_bolt'), 'Not a skill of this job');
  for (const bad of [null, 5, {}, 'nope']) assert.notEqual(world.learn(a.p, bad), '');
  assert.equal(world.learn(a.p, 'shield_bash'), '');
  assert.deepEqual(a.out.find((m) => m.t === 'build').build.skills, { shield_bash: 1 });
  assert.equal(world.learn(a.p, 'shield_bash'), 'No skill points');
  assert.equal(a.out.filter((m) => m.t === 'no').at(-1).why, 'No skill points');
  const b = join(0, 40, 'knight', 16);
  assert.equal(world.learn(b.p, 'fortify'), 'Requires Guard Stance');
  for (let i = 0; i < 5; i++) assert.equal(world.learn(b.p, 'shield_bash'), '');
  assert.equal(world.learn(b.p, 'shield_bash'), 'Already at maximum rank');
  assert.equal(world.learn(b.p, 'guard_stance'), '');
  const def0 = b.p.stats.def;
  assert.equal(world.learn(b.p, 'fortify'), '');
  assert.ok(b.p.stats.def > def0, 'passive node changes server stats immediately');
  assert.deepEqual(b.out.filter((m) => m.t === 'stats').at(-1).stats, computeStats('knight', 16, 0, b.p.build.skills));
  world.hurt(b.p, 5, 0, null);
  assert.equal(world.respec(b.p), 'Cannot do that in combat');
  step(120);
  assert.equal(world.respec(b.p), '');
  assert.equal(freePoints(16, b.p.build), 16);
  // stored builds are sanitised
  const c = cleanBuild('mage', 3, { skills: { arcane_bolt: 99, taunt: 2, rune_focus: 1.5 }, runes: { slots: ['fire', 'fire', 'banana', 'wind'], lv: { fire: 99, wind: 2 }, xp: { fire: -4 } } });
  assert.deepEqual(c, emptyBuild('mage') && { skills: {}, runes: { slots: ['fire', null, null], lv: { fire: 50, wind: 2 }, xp: {} } }, 'overspent ranks dropped, runes clamped');
});

test('M4 ability gating: unknown, unlearned, wrong job, mana, cooldown, GCD, dead and stunned', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage', 5);
  const m = world.spawn(a.p.room, 'rootwarden', a.p.x + 80, a.p.y);
  assert.equal(world.use(a.p, 'nope', 0), 'Unknown ability');
  assert.equal(world.use(a.p, 42, 0), 'Unknown ability');
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), 'Skill not learned');
  assert.equal(world.use(a.p, 'fireball', m.id), 'Rune not attuned');
  grant(a.p, ['arcane_bolt'], ['fire']);
  assert.equal(world.use(a.p, 'shield_bash', m.id), 'Skill not learned');
  assert.equal(world.use(a.p, 'meteor_strike', m.id), 'Requires rune level 6');
  const mana = a.p.res;
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), '');
  assert.equal(a.p.res, mana - 6);
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), 'Not ready');
  assert.equal(world.use(a.p, 'fireball', m.id), 'Not ready', 'global cooldown');
  step(10);
  assert.equal(world.use(a.p, 'fireball', m.id), '');
  step(15);
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), '', 'ready again after its 1.2s cooldown');
  step(26);
  a.p.res = 3;
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), 'Not enough mana');
  a.p.res = 100;
  applyStatus(a.p, STATUS_INDEX.stun, world.tick, 0, 0);
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), 'Stunned');
  world.hurt(a.p, 99999, 0, null);
  assert.equal(world.use(a.p, 'arcane_bolt', m.id), 'You are dead');
  const far = join(0, 40, 'mage', 5);
  grant(far.p, ['arcane_bolt']);
  const distant = world.spawn(far.p.room, 'rootwarden', far.p.x + 600, far.p.y);
  assert.equal(world.use(far.p, 'arcane_bolt', distant.id), 'Out of range');
  world.hurt(m, 99999, 0, null);
  step(30);
  assert.equal(world.use(far.p, 'arcane_bolt', 0), 'No target');
});

test('M4 every ability executes: cost, cooldown, effect event and its gameplay effect', () => {
  for (const def of ABILITY_LIST) {
    if (def.kind === 'ult' || def.kind === 'fusion') continue; // ultimates and fusions have their own tests
    const { world, join, step } = harness();
    const job = def.job ?? 'mage';
    const a = join(0, 0, job, 60), ally = join(-30, 0, 'knight', 60);
    group(world, a.p, ally.p);
    if (def.kind === 'skill') grant(a.p, [def.id]);
    else grant(a.p, [], [def.el!], 10);
    const rage = JOB_DEFS[job].resource === 'rage';
    if (rage) a.p.res = 100;
    const m = world.spawn(a.p.room, 'rootwarden', a.p.x + 36, a.p.y);
    (m as any).def = { ...m.def, aggro: 0 };
    m.maxHp = m.hp = m.maxHp * 4; // a level 60 character with its class bonuses must not kill it outright: the effects are what is checked
    step();
    world.hurt(ally.p, 400, 0, null);
    if (def.special === 'revive') world.hurt(ally.p, 99999, 0, null);
    if (def.special === 'cleanse') applyStatus(ally.p, STATUS_INDEX.poison, world.tick, 5, 0);
    const res0 = a.p.res, x0 = a.p.x, y0 = a.p.y, allyHp = ally.p.hp;
    const tid = def.target === 'enemy' ? m.id : def.target === 'self' ? 0 : ally.p.id;
    assert.equal(world.use(a.p, def.id, tid), '', `${def.id} accepted`);
    step(Math.ceil((def.castMs ?? 0) / 50) + 2);
    const fx = fxOf(a.out).filter((e: any) => e[2] === ABILITY_INDEX[def.id]);
    assert.equal(fx.length, 1, `${def.id}: effect event sent to the caster`);
    assert.equal(fxOf(ally.out).filter((e: any) => e[2] === ABILITY_INDEX[def.id]).length, 1, `${def.id}: effect event sent to bystanders`);
    assert.ok((a.p.cds.get(def.id) ?? 0) > world.tick || def.cdMs <= 150, `${def.id}: cooldown started`);
    if (def.gain) assert.ok(a.p.res > res0 - 1 || res0 === 100, `${def.id}: generates rage`);
    else if (def.cost) assert.ok(a.p.res < res0, `${def.id}: cost paid (${res0} -> ${a.p.res})`);
    if (def.field) step(Math.ceil((def.field.everyMs ?? 0) / 50) + 14);
    if (def.field?.kind === 'trap') { m.x = a.p.x + 10; m.y = a.p.y; m.room.grid.update(m); step(2); }
    if (def.hit || def.field?.hit) assert.ok(m.hp < m.maxHp, `${def.id}: damaged the monster`);
    if (def.heal || def.field?.heal) assert.ok(ally.p.hp > allyHp, `${def.id}: healed the ally`);
    for (const s of [...(def.status ?? []), ...(def.field?.status ?? [])]) {
      if ((s.chance ?? 100) < 100) continue;
      const who = s.on === 'enemy' ? m : s.on === 'self' ? a.p : ally.p;
      const bit = 1 << STATUS_INDEX[s.id];
      // short statuses (shock 0.7s) may already have expired after a long field wait
      assert.ok(who.mask & bit || STATUS[STATUS_INDEX[s.id]].ms < 1500, `${def.id}: applied ${s.id} to ${s.on}`);
    }
    if (def.move) assert.ok(a.p.x !== x0 || a.p.y !== y0, `${def.id}: moved the caster`);
    if (def.taunt) assert.equal([...m.threat.entries()].sort((p, q) => q[1] - p[1])[0][0], a.p.id, 'taunt puts the knight on top of the threat table');
    if (def.special === 'revive') assert.deepEqual([ally.p.dead, ally.p.hp], [false, Math.ceil(ally.p.maxHp * 0.4)]);
    if (def.special === 'cleanse') assert.equal(ally.p.mask & (1 << STATUS_INDEX.poison), 0);
  }
});

test('M4 rune progression: level scales damage, casting earns rune EXP, levels unlock spells, attunement rules', () => {
  const dmgAt = (lv: number, surge = false) => {
    const { world, join, step } = harness();
    const a = join(0, 0, 'mage', 10);
    grant(a.p, [], ['water'], lv);
    if (surge) applyStatus(a.p, STATUS_INDEX.surge, world.tick, 0, 0);
    const m = world.spawn(a.p.room, 'rootwarden', a.p.x + 60, a.p.y);
    world.use(a.p, 'water_bolt', m.id);
    step();
    return m.maxHp - m.hp;
  };
  const d1 = dmgAt(1), d5 = dmgAt(5);
  assert.ok(Math.abs(d5 / d1 - 1.08) < 0.03, `rune level 5 deals +8% (${d1} -> ${d5})`);
  assert.ok(Math.abs(dmgAt(1, true) / d1 - 1.35) < 0.03, 'Elemental Surge adds 35%');

  const { world, join, step } = harness();
  const a = join(0, 0, 'mage', 10), k = join(0, 40, 'knight', 10);
  assert.equal(world.attune(a.p, 0, 'fire'), 'You do not own that rune yet', 'M12: a rune must be obtained first');
  a.p.build.runes.lv.fire = a.p.build.runes.lv.wind = 1;
  assert.equal(world.attune(a.p, 0, 'fire'), '');
  assert.equal(world.attune(a.p, 1, 'fire'), 'That rune is already in another slot');
  assert.equal(world.attune(a.p, 2, 'wind'), '', 'mages have a third slot');
  assert.equal(world.attune(k.p, 2, 'wind'), 'No such rune slot');
  for (const bad of [[0, 'plasma'], [-1, 'fire'], ['0', 'fire'], [9, null]]) assert.notEqual(world.attune(k.p, bad[0], bad[1]), '');
  assert.equal(runeLevel(a.p, 'fire'), 1);
  assert.equal(runeLevel(a.p, 'earth'), 0);
  const m = world.spawn(a.p.room, 'rootwarden', a.p.x + 60, a.p.y);
  (m as any).def = { ...m.def, aggro: 0, hp: 1e9 };
  m.hp = m.maxHp = 1e9;
  assert.equal(world.use(a.p, 'flame_burst', 0), 'Requires rune level 3');
  const need = Math.ceil(runeExpToNext(1) / 10) + Math.ceil(runeExpToNext(2) / 10);
  let casts = 0;
  for (let i = 0; i < 400 && (a.p.build.runes.lv.fire ?? 1) < 3; i++) {
    a.p.res = a.p.stats.maxRes;
    if (world.use(a.p, 'fireball', m.id) === '') casts++;
    step(10);
  }
  assert.equal(a.p.build.runes.lv.fire, 3);
  assert.ok(casts >= need - 1 && casts <= need + 1, `${casts} casts to reach level 3 (expected ~${need})`);
  assert.ok(a.out.some((x) => x.t === 'sys' && /Fire Rune reached level 3/.test(x.text)));
  a.p.res = a.p.stats.maxRes;
  step(120);
  assert.equal(world.use(a.p, 'flame_burst', 0), '', 'second spell unlocked');
  assert.equal(world.attune(a.p, 0, null), 'Cannot change runes in combat');
  // Rune Focus lowers cost, Rune Mastery raises the effective level
  grant(a.p, ['rune_focus', 'rune_mastery'], [], 1, 5);
  assert.equal(a.p.stats.runeCost, 0.7);
  assert.equal(runeLevel(a.p, 'fire'), 3 + 5);
  step(60);
  // the Rootwarden may have stunned the caster at this moment: wait it out
  let mana = a.p.res, cast = world.use(a.p, 'fireball', m.id);
  for (let i = 0; i < 80 && cast === 'Stunned'; i++) {
    step(5);
    mana = a.p.res;
    cast = world.use(a.p, 'fireball', m.id);
  }
  assert.equal(cast, '');
  assert.equal(mana - a.p.res, Math.round(14 * 0.7));
});

test('M4 area shapes: splash, cone, chain, self-centred and aimed areas', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage', 30);
  grant(a.p, [], ['fire', 'lightning', 'wind'], 10);
  const R = a.p.room, x = a.p.x, y = a.p.y;
  const mk = (dx: number, dy: number) => { const m = world.spawn(R, 'rootwarden', x + dx, y + dy); (m as any).def = { ...m.def, aggro: 0 }; return m; };
  const front = mk(100, 0), beside = mk(120, 30), behind = mk(-100, 0), farChain = mk(210, 0), farther = mk(300, 0), tooFar = mk(600, 0);
  const lost = (m: any) => m.maxHp - m.hp;
  world.use(a.p, 'fireball', front.id);
  step(12);
  assert.ok(lost(front) > 0 && lost(beside) > 0 && lost(beside) < lost(front), 'splash hits neighbours for less');
  assert.equal(lost(behind), 0);
  const before = [front, beside, behind, farChain].map(lost);
  world.use(a.p, 'wind_slash', front.id);
  step(12);
  assert.ok(lost(front) > before[0] && lost(beside) > before[1], 'cone hits what is in front');
  assert.equal(lost(behind), before[2], 'cone does not reach behind the caster');
  const b2 = [front, beside, farChain, farther, tooFar].map(lost);
  world.use(a.p, 'chain_lightning', front.id);
  step();
  const gains = [front, beside, farChain, farther, tooFar].map((m, i) => lost(m) - b2[i]);
  assert.ok(gains[0] > 0 && gains.filter((g) => g > 0).length === 4, `chain hit the target and three more (${gains})`);
  assert.equal(gains[4], 0);
  const jumps = gains.filter((g) => g > 0).sort((p, q) => q - p);
  assert.ok(jumps[0] > jumps[1] && jumps[1] > jumps[2] && jumps[2] > jumps[3], 'each jump is weaker');
  assert.equal(fxOf(a.out).at(-1).length, 7 + 3, 'chained target ids are sent for the lightning arcs');
});

test('M4 cast times: nothing happens until the cast ends; moving or a stun cancels it for free', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage', 30), b = join(0, 30, 'knight', 1);
  grant(a.p, [], ['fire'], 10);
  const m = world.spawn(a.p.room, 'rootwarden', a.p.x + 150, a.p.y), near = world.spawn(a.p.room, 'rootwarden', a.p.x + 190, a.p.y);
  for (const x of [m, near]) (x as any).def = { ...x.def, aggro: 0 };
  step();
  a.out.length = b.out.length = 0;
  const mana = a.p.res;
  assert.equal(world.use(a.p, 'meteor_strike', m.id), '');
  step(2);
  const evs = snaps(b.out).flatMap((s) => s.ev ?? []);
  assert.deepEqual(evs.find((e: any) => e[1] === Act.Cast), [a.p.id, Act.Cast, ABILITY_INDEX.meteor_strike, 1200]);
  const tele = evs.find((e: any) => e[1] === Act.Telegraph);
  assert.deepEqual([tele[0], tele[4], tele[5], tele[6]], [a.p.id, 80, 1200, 1], 'friendly ground warning');
  assert.ok(Math.hypot(tele[2] - m.x, tele[3] - m.y) < 12);
  assert.ok(snaps(a.out).flatMap((s) => s.ev ?? []).some((e: any) => e[1] === Act.Cast), 'caster gets its own cast event');
  step(15);
  assert.equal(m.hp, m.maxHp, 'no damage during the cast');
  assert.equal(a.p.res, mana, 'no cost during the cast');
  world.input(a.p, 1, 0, 1, 1);
  step(2);
  assert.equal(a.p.casting, null, 'moving cancelled it');
  assert.equal(a.p.res, mana);
  assert.equal(a.p.cds.has('meteor_strike'), false);
  assert.deepEqual(snaps(b.out).flatMap((s) => s.ev ?? []).filter((e: any) => e[1] === Act.Cast).at(-1), [a.p.id, Act.Cast, ABILITY_INDEX.meteor_strike, 0]);
  step(12);
  assert.equal(world.use(a.p, 'meteor_strike', m.id), '');
  step(10);
  applyStatus(a.p, STATUS_INDEX.stun, world.tick, 0, 0);
  step(30);
  assert.equal(m.hp, m.maxHp, 'stun cancelled it');
  assert.equal(world.use(a.p, 'meteor_strike', m.id), '');
  step(26);
  assert.ok(m.hp < m.maxHp && near.hp < near.maxHp, 'meteor landed on the area');
  assert.equal(a.p.res, mana - Math.round(55 * a.p.stats.runeCost), 'its cost (a level 30 Runeweaver pays 5% less for rune spells)');
  assert.ok(m.mask & (1 << STATUS_INDEX.burn));
});

test('M4 defensive effects: stone shield, mana shield, guard stance, last stand, divine aegis', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'mage', 20), k = join(0, 30, 'knight', 20), c = join(0, 60, 'cleric', 20);
  grant(a.p, ['mana_shield'], ['earth'], 1);
  grant(k.p, ['guard_stance', 'last_stand']);
  grant(c.p, ['divine_aegis']);
  group(world, c.p, a.p, k.p);
  // stone shield: absorbs exactly its pool, on an ally
  world.use(a.p, 'stone_shield', k.p.id);
  const pool = Math.round(a.p.stats.matk * 3);
  assert.equal(k.p.st.find((s) => s.i === STATUS_INDEX.barrier)!.power, pool);
  world.hurt(k.p, pool - 10, 0, null);
  assert.equal(k.p.hp, k.p.maxHp, 'fully absorbed');
  world.hurt(k.p, 50, 0, null);
  assert.equal(k.p.hp, k.p.maxHp - 40, 'overflow goes through');
  assert.equal(k.p.mask & (1 << STATUS_INDEX.barrier), 0, 'shield broke');
  step();
  assert.ok(dmOf(k.out).at(-1)[2] & Dmg.Absorb);
  // mana shield: 70% of the hit is paid in mana
  a.p.gcd = 0;
  world.use(a.p, 'mana_shield', 0);
  const hp = a.p.hp, mana = a.p.res;
  world.hurt(a.p, 100, 0, null);
  assert.deepEqual([hp - a.p.hp, mana - a.p.res], [30, 70]);
  // guard stance: same raw hit, far less damage
  const boar = world.spawn(k.p.room, 'old_tusk', k.p.x + 30, k.p.y);
  const hit = (m: any) => { const h = k.p.hp; (m as any).hit(k.p, MONSTERS.old_tusk.pattern[0], world); return h - k.p.hp; };
  const plain = hit(boar);
  world.use(k.p, 'guard_stance', 0);
  const guarded = hit(boar);
  assert.ok(guarded < plain * 0.6, `guard stance: ${plain} -> ${guarded}`);
  // last stand: cannot die
  k.p.gcd = 0;
  world.use(k.p, 'last_stand', 0);
  world.hurt(k.p, 99999, 0, null);
  assert.deepEqual([k.p.dead, k.p.hp], [false, 1]);
  // divine aegis: everyone nearby is immune
  world.use(c.p, 'divine_aegis', 0);
  const before = [a.p.hp, k.p.hp, c.p.hp];
  for (const p of [a.p, k.p, c.p]) world.hurt(p, 500, 0, null);
  assert.deepEqual([a.p.hp, k.p.hp, c.p.hp], before);
});

test('M4 stealth: unseen by monsters, broken by attacking, smoke bomb weakens', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'assassin', 30);
  grant(a.p, ['stealth', 'smoke_bomb', 'backstab']);
  const boar = world.spawn(a.p.room, 'rootwarden', a.p.x + 100, a.p.y);
  world.use(a.p, 'stealth', 0);
  step(60);
  assert.equal(boar.threat.size, 0, 'aggressive monster ignores a stealthed player');
  assert.ok(lastMe(a.out).st.some((s: any) => s[0] === STATUS_INDEX.stealth));
  // ambush (level 25 passive): the opener is a guaranteed critical hit (rng 0.5 never crits otherwise)
  boar.x = a.p.x + 26;
  boar.room.grid.update(boar);
  world.use(a.p, 'backstab', boar.id);
  step();
  assert.equal(a.p.mods.stealth, false, 'attacking reveals');
  assert.ok(dmOf(a.out).some((d: any) => d[0] === boar.id && d[2] & Dmg.Crit), 'ambush crit');
  step(40);
  assert.ok(boar.threat.has(a.p.id), 'monster fights back once revealed');
  world.use(a.p, 'smoke_bomb', 0);
  assert.ok(a.p.mods.stealth && boar.mask & (1 << STATUS_INDEX.weaken));
  assert.equal(boar.threat.size, 0, 'smoke bomb drops threat');
});

test('M4 fields: traps trigger once, zones pulse on schedule and vanish with their owner', () => {
  const { world, join, step } = harness();
  const r = join(0, 0, 'ranger', 30), c = join(60, 0, 'cleric', 30);
  grant(r.p, ['snare_trap', 'explosive_trap']);
  grant(c.p, ['sanctuary']);
  group(world, c.p, r.p);
  world.use(r.p, 'snare_trap', 0);
  step(5);
  assert.equal(r.p.room.fields.length, 1);
  const key = fxOf(r.out).at(-1)[6];
  assert.ok(key > 0);
  const bat = world.spawn(r.p.room, 'duskwing', r.p.x + 5, r.p.y);
  (bat as any).def = { ...bat.def, aggro: 0 };
  step(3);
  assert.equal(r.p.room.fields.length, 1, 'flyers do not set off ground traps');
  const m = world.spawn(r.p.room, 'rootwarden', r.p.x + 200, r.p.y);
  (m as any).def = { ...m.def, aggro: 0 };
  step(3);
  assert.equal(r.p.room.fields.length, 1, 'trap waits');
  m.x = r.p.x + 12;
  m.room.grid.update(m);
  step(2);
  assert.ok(m.mask & (1 << STATUS_INDEX.root), 'rooted');
  assert.equal(m.mods.move, 0);
  assert.equal(r.p.room.fields.length, 0, 'trap consumed');
  assert.deepEqual(snaps(r.out).flatMap((s) => s.ev ?? []).find((e: any) => e[1] === Act.FxEnd), [r.p.id, Act.FxEnd, key, 1]);
  // explosive trap
  step(10);
  world.use(r.p, 'explosive_trap', 0);
  const hp = m.hp;
  step(3);
  assert.ok(m.hp < hp && m.mask & (1 << STATUS_INDEX.burn));
  world.hurt(m, 1e9, 0, null); // out of the way for the healing measurements
  step(140);
  // sanctuary heals everyone inside once a second for 8 seconds
  r.p.cds.clear();
  const per = Math.round(c.p.stats.matk * 0.45 * c.p.stats.healPower);
  r.p.maxHp = c.p.maxHp = 100000; // room for every pulse to land in full
  r.p.lastCombat = c.p.lastCombat = world.tick + 100000; // keep natural regeneration out of the measurement
  const h0 = r.p.hp;
  r.out.length = 0;
  world.use(c.p, 'sanctuary', 0);
  step(170);
  assert.equal(r.p.hp - h0, per * 8, '8 pulses');
  assert.equal(dmOf(r.out).filter((d: any) => d[0] === r.p.id && d[2] & Dmg.Heal).length, 8);
  assert.equal(c.p.room.fields.length, 0, 'zone expired');
  // a zone disappears with its owner
  c.p.cds.clear();
  c.p.res = c.p.stats.maxRes;
  assert.equal(world.use(c.p, 'sanctuary', 0), '');
  assert.equal(c.p.room.fields.length, 1);
  c.p.room.remove(c.p);
  step(2);
  assert.equal(r.p.room.fields.length, 0);
});

test('M4 level-25 passives: toxicology, retribution, overflow, undying fury, guardian spirit, death mark', () => {
  // toxicology: poison arrow applies 2 stacks, +1 at level 25
  let h = harness();
  let lo = h.join(0, 0, 'ranger', 24), hi = h.join(0, 40, 'ranger', 25);
  for (const p of [lo.p, hi.p]) grant(p, ['poison_arrow']);
  const m1 = h.world.spawn(lo.p.room, 'rootwarden', lo.p.x + 80, lo.p.y), m2 = h.world.spawn(lo.p.room, 'rootwarden', lo.p.x + 80, lo.p.y + 300);
  h.world.use(lo.p, 'poison_arrow', m1.id);
  hi.p.y = lo.p.y + 300; hi.p.room.grid.update(hi.p);
  h.world.use(hi.p, 'poison_arrow', m2.id);
  assert.deepEqual([m1.st[0].stacks, m2.st[0].stacks], [2, 3]);
  // retribution: a block empowers the next physical strike by 50%
  h = harness({ rng: () => 0.1 });
  const k = h.join(0, 0, 'knight', 25, 0);
  const tusk = h.world.spawn(k.p.room, 'old_tusk', k.p.x + 30, k.p.y);
  tusk.level = 25; // same level: the 10% roll is not a miss, but is a block
  (tusk as any).hit(k.p, MONSTERS.old_tusk.pattern[0], h.world);
  assert.ok(k.p.mask & (1 << STATUS_INDEX.retribution));
  const d1 = h.world.strike(k.p, tusk, 1), d2 = h.world.strike(k.p, tusk, 1);
  assert.ok(Math.abs(d1 / d2 - 1.5) < 0.08, `empowered ${d1} vs normal ${d2}`);
  // overflow: a critical spell refunds 30% of its cost (rng 0.02 -> always crits, never misses at level 25 vs 8)
  h = harness({ rng: () => 0.021 });
  const mg = h.join(0, 0, 'mage', 25);
  grant(mg.p, ['arcane_bolt']);
  const t = h.world.spawn(mg.p.room, 'rootwarden', mg.p.x + 80, mg.p.y);
  const mana = mg.p.res = mg.p.stats.maxRes - 50;
  h.world.use(mg.p, 'arcane_bolt', t.id);
  assert.equal(mana - mg.p.res, 6 - Math.round(6 * 0.3));
  // undying fury: more damage at low health
  h = harness();
  const b = h.join(0, 0, 'berserker', 25);
  const t2 = h.world.spawn(b.p.room, 'rootwarden', b.p.x + 30, b.p.y);
  const full = h.world.strike(b.p, t2, 1);
  b.p.hp = Math.round(b.p.maxHp * 0.2);
  const low = h.world.strike(b.p, t2, 1);
  assert.ok(low / full > 1.3, `${full} -> ${low}`);
  // guardian spirit: heals leave a barrier
  h = harness();
  const cl = h.join(0, 0, 'cleric', 25), friend = h.join(30, 0, 'knight', 5);
  grant(cl.p, ['mend']);
  h.world.hurt(friend.p, 100, 0, null);
  h.world.use(cl.p, 'mend', friend.p.id);
  assert.ok(friend.p.mask & (1 << STATUS_INDEX.barrier));
  // death mark: 40% of the damage dealt during the mark lands when it expires
  h = harness();
  const as = h.join(0, 0, 'assassin', 40);
  grant(as.p, ['death_mark']);
  const t3 = h.world.spawn(as.p.room, 'rootwarden', as.p.x + 30, as.p.y);
  (t3 as any).def = { ...t3.def, aggro: 0 };
  h.world.use(as.p, 'death_mark', t3.id);
  const dealt = h.world.strike(as.p, t3, 3) + h.world.strike(as.p, t3, 3);
  const hp = t3.hp;
  h.step(125);
  assert.equal(hp - t3.hp, Math.round(dealt * 0.4));
});

test('M4 movement skills: charge, shadow step, blink and fleet step land on walkable ground', () => {
  const { world, join, step } = harness();
  const b = join(0, 0, 'berserker', 20), a = join(0, 60, 'assassin', 20), mg = join(0, 120, 'mage', 20), r = join(0, 180, 'ranger', 20);
  grant(b.p, ['charge']); b.p.res = 0; grant(a.p, ['shadow_step']); grant(mg.p, ['blink']); grant(r.p, ['fleet_step']);
  const t = world.spawn(b.p.room, 'rootwarden', b.p.x + 200, b.p.y);
  (t as any).def = { ...t.def, aggro: 0 };
  world.use(b.p, 'charge', t.id);
  assert.ok(Math.hypot(b.p.x - t.x, b.p.y - t.y) < 50 && b.p.x < t.x, 'charged up to the near side of the target');
  assert.ok(t.hp < t.maxHp && b.p.res === 10, 'charge hits and builds rage');
  world.use(a.p, 'shadow_step', t.id);
  assert.ok(a.p.x > t.x && Math.hypot(a.p.x - t.x, a.p.y - t.y) < 60, 'appeared on the far side');
  for (const p of [b.p, a.p]) assert.equal(blocked(p.room.map, p.x, p.y), false);
  // blink goes where the mage faces and stops at obstacles
  world.input(mg.p, 1, -1, 0, 1);
  step();
  const x0 = mg.p.x;
  world.use(mg.p, 'blink', 0);
  assert.ok(Math.abs(x0 - mg.p.x - 128) < 0.01, `blinked ${x0 - mg.p.x}px left`);
  mg.p.x = 2 * TILE + 14; mg.p.cds.clear(); mg.p.gcd = 0; mg.p.room.grid.update(mg.p);
  world.use(mg.p, 'blink', 0);
  assert.equal(blocked(mg.p.room.map, mg.p.x, mg.p.y), false, 'never ends inside a wall');
  assert.ok(mg.p.x >= 2 * TILE + 10);
  // fleet step moves away from the target
  r.p.target = t;
  const d0 = Math.hypot(r.p.x - t.x, r.p.y - t.y);
  world.use(r.p, 'fleet_step', 0);
  assert.ok(Math.hypot(r.p.x - t.x, r.p.y - t.y) > d0 + 60);
});

test('M4 resurrection and persistence of the build', () => {
  const { world, join, step, builds } = harness();
  const c = join(0, 0, 'cleric', 30), k = join(40, 0, 'knight', 5);
  grant(c.p, ['resurrection']);
  assert.equal(world.use(c.p, 'resurrection', k.p.id), 'Select a fallen ally');
  assert.equal(world.use(c.p, 'resurrection', c.p.id), 'Select a fallen ally');
  world.hurt(k.p, 99999, 0, null);
  const pos = [k.p.x, k.p.y];
  assert.equal(world.use(c.p, 'resurrection', k.p.id), '');
  step(40);
  assert.equal(k.p.dead, true, 'three-second cast');
  step(25);
  assert.deepEqual([k.p.dead, k.p.x, k.p.y, k.p.hp], [false, pos[0], pos[1], Math.ceil(k.p.maxHp * 0.4)]);
  assert.equal(lastMe(k.out).dead, 0);
  // build is saved when it changed, and restored (sanitised) on the next login
  const a = join(0, 80, 'mage', 4);
  world.learn(a.p, 'arcane_bolt');
  a.p.build.runes.lv.wind = 1;
  world.attune(a.p, 0, 'wind');
  world.disconnect(a.p, a.conn);
  (world as any).housekeep(Date.now() + 1);
  assert.deepEqual(builds.at(-1), { id: a.p.id, skills: { arcane_bolt: 1 }, runes: { slots: ['wind', null, null], lv: { wind: 1 }, xp: {} } });
  const again = world.join({ ...a.row, level: 4, skills: builds.at(-1).skills, runes: builds.at(-1).runes }, { send: (d) => a.out.push(JSON.parse(d)), close() {} });
  assert.deepEqual(again.build, a.p.build);
  assert.deepEqual(a.out.filter((m) => m.t === 'welcome').at(-1).build, a.p.build);
  assert.equal(world.use(again, 'wind_slash', 0), 'No target', 'restored rune is usable (only a target is missing)');
});

// ======================= M5: party and social =======================
const partyOf = (o: any[]) => o.filter((m) => m.t === 'party').at(-1)?.party;
const sysOf = (o: any[]) => o.filter((m) => m.t === 'sys').map((m) => m.text);
const noOf = (o: any[]) => o.filter((m) => m.t === 'no').map((m) => m.why);

test('M5 invitations: invite by id or name, accept, decline, expiry and every refusal', () => {
  const { world, join } = harness({ capacity: 20 });
  const a = join(0, 0, 'knight'), b = join(30, 0, 'mage'), c = join(60, 0, 'cleric');
  assert.equal(world.party(a.p, 'invite', a.p.id, undefined), 'You cannot invite yourself');
  assert.equal(world.party(a.p, 'invite', 9999, undefined), 'Player not found');
  for (const bad of [null, {}, 1.5, '', 'x'.repeat(40)]) assert.equal(world.party(a.p, 'invite', bad, undefined), 'Player not found');
  assert.equal(world.party(a.p, 'frobnicate', 1, undefined), 'Unknown party command');
  assert.equal(world.party(b.p, 'accept', undefined, undefined), 'The invitation has expired', 'nothing to accept');
  // by name, case-insensitive
  assert.equal(world.party(a.p, 'invite', undefined, b.p.name.toUpperCase()), '');
  assert.deepEqual(b.out.find((m) => m.t === 'pinv'), { t: 'pinv', from: a.p.name, id: a.p.id, ms: 30000 });
  assert.equal(world.party(a.p, 'invite', c.p.id, undefined), 'Wait a moment before inviting again', 'invite spam is rate limited');
  a.p.lastInvite = 0;
  assert.equal(world.party(a.p, 'invite', b.p.id, undefined), `${b.p.name} already has a pending invitation`);
  // decline notifies the inviter and creates nothing
  assert.equal(world.party(b.p, 'decline', undefined, undefined), '');
  assert.ok(sysOf(a.out).includes(`${b.p.name} declined your invitation.`));
  assert.equal(a.p.party, null);
  assert.equal(world.parties.count, 0);
  // expiry
  a.p.lastInvite = 0;
  world.party(a.p, 'invite', b.p.id, undefined);
  b.p.invite!.until = Date.now() - 1;
  assert.equal(world.party(b.p, 'accept', undefined, undefined), 'The invitation has expired');
  // accept
  a.p.lastInvite = 0;
  world.party(a.p, 'invite', b.p.id, undefined);
  assert.equal(world.party(b.p, 'accept', undefined, undefined), '');
  const st = partyOf(b.out);
  assert.deepEqual([st.leader, st.members.map((m: any) => m.id)], [a.p.id, [a.p.id, b.p.id]]);
  assert.deepEqual(partyOf(a.out), st, 'both members get the same state');
  const m0 = st.members[0];
  assert.deepEqual([m0.name, m0.job, m0.level, m0.hp, m0.mhp, m0.zone, m0.on], [a.p.name, 'knight', 1, a.p.hp, a.p.maxHp, 'eldoria', true]);
  // members cannot be poached, non-leaders cannot invite
  c.p.lastInvite = 0;
  assert.equal(world.party(c.p, 'invite', b.p.id, undefined), `${b.p.name} is already in a party`);
  assert.equal(world.party(b.p, 'invite', c.p.id, undefined), 'Only the party leader can invite');
  assert.deepEqual(noOf(b.out).at(-1), 'Only the party leader can invite');
});

test('M5 party size is capped at five', () => {
  const { world, join } = harness({ capacity: 20 });
  const ps = Array.from({ length: 7 }, (_, i) => join(i * 20, 0, JOBS[i % 6]));
  group(world, ps[0].p, ...ps.slice(1, 5).map((x) => x.p));
  assert.equal(ps[0].p.party!.members.length, 5);
  ps[0].p.lastInvite = 0;
  assert.equal(world.party(ps[0].p, 'invite', ps[5].p.id, undefined), 'The party is full (5)');
  // an invitation sent before the party filled up cannot overfill it
  const solo = join(0, 80, 'mage'), lead = join(0, 120, 'knight');
  const four = Array.from({ length: 3 }, (_, i) => join(30 + i * 20, 120, 'cleric'));
  group(world, lead.p, ...four.map((x) => x.p));
  lead.p.lastInvite = 0;
  world.party(lead.p, 'invite', solo.p.id, undefined);
  lead.p.lastInvite = 0;
  world.party(lead.p, 'invite', ps[6].p.id, undefined);
  assert.equal(world.party(ps[6].p, 'accept', undefined, undefined), '');
  assert.equal(world.party(solo.p, 'accept', undefined, undefined), 'The party is full (5)');
  assert.equal(lead.p.party!.members.length, 5);
});

test('M5 leadership: kick, promote, leaving, succession, disbanding, logging out', () => {
  const { world, join } = harness({ capacity: 20 });
  const a = join(0, 0, 'knight'), b = join(30, 0, 'mage'), c = join(60, 0, 'cleric'), d = join(90, 0, 'ranger');
  group(world, a.p, b.p, c.p, d.p);
  assert.equal(world.party(b.p, 'kick', c.p.id, undefined), 'Only the party leader can do that');
  assert.equal(world.party(b.p, 'promote', b.p.id, undefined), 'Only the party leader can do that');
  assert.equal(world.party(a.p, 'kick', a.p.id, undefined), 'That player is not in your party');
  assert.equal(world.party(a.p, 'kick', 424242, undefined), 'That player is not in your party');
  assert.equal(world.party(a.p, 'kick', d.p.id, undefined), '');
  assert.equal(d.p.party, null);
  assert.equal(partyOf(d.out), null);
  assert.ok(sysOf(d.out).includes('You were removed from the party.'));
  assert.deepEqual(partyOf(a.out).members.map((m: any) => m.id), [a.p.id, b.p.id, c.p.id]);
  assert.equal(world.party(a.p, 'promote', c.p.id, undefined), '');
  assert.equal(partyOf(b.out).leader, c.p.id);
  assert.equal(world.party(a.p, 'kick', b.p.id, undefined), 'Only the party leader can do that', 'the old leader lost its powers');
  // the leader leaving hands leadership to the longest-standing member
  assert.equal(world.party(c.p, 'leave', undefined, undefined), '');
  assert.equal(partyOf(a.out).leader, a.p.id);
  assert.ok(sysOf(b.out).includes(`${a.p.name} is now the party leader.`));
  assert.equal(world.party(c.p, 'leave', undefined, undefined), 'You are not in a party');
  // two left: one logging out disbands the party
  world.disconnect(b.p, b.conn);
  (world as any).housekeep(Date.now() + 1);
  assert.equal(a.p.party, null);
  assert.equal(partyOf(a.out), null);
  assert.ok(sysOf(a.out).includes('The party has been disbanded.'));
  assert.equal(world.parties.count, 0);
});

test('M5 party frames: HP, zone and connection state are pushed once a second, only when changed', () => {
  const { world, join, step } = harness({ capacity: 20 });
  const a = join(0, 0, 'knight'), b = join(30, 0, 'mage');
  group(world, a.p, b.p);
  const n0 = a.out.filter((m) => m.t === 'party').length;
  (world as any).housekeep(Date.now() + 1000);
  assert.equal(a.out.filter((m) => m.t === 'party').length, n0, 'nothing changed, nothing sent');
  world.hurt(b.p, 40, 0, null);
  step();
  (world as any).housekeep(Date.now() + 2000);
  assert.equal(partyOf(a.out).members[1].hp, b.p.maxHp - 40);
  world.grantExp(b.p, 5000);
  world.disconnect(b.p, b.conn);
  (world as any).opts.reconnectGraceMs = 1e9; // keep b in the world, just disconnected
  (world as any).housekeep(Date.now() + 3000);
  const mb = partyOf(a.out).members[1];
  assert.equal(mb.on, false, 'frame shows the member as disconnected');
  assert.equal(mb.level, b.p.level);
  // reconnecting within the grace period keeps the party and resends its state
  const out2: any[] = [];
  world.join(b.row, { send: (d) => out2.push(JSON.parse(d)), close() {} });
  assert.equal(partyOf(out2).members.length, 2);
  assert.equal(b.p.party!.members.length, 2);
});

test('M5 party EXP: shared equally with a bonus, healers included, far members and strangers excluded', () => {
  const { world, join } = harness({ capacity: 20 });
  const tank = join(0, 0, 'knight'), healer = join(30, 0, 'cleric'), far = join(0, 1200, 'mage'), solo = join(60, 0, 'ranger'), idle = join(90, 0, 'mage');
  group(world, tank.p, healer.p, far.p);
  const m = world.spawn(tank.p.room, 'boar', tank.p.x + 30, tank.p.y); // 22 EXP
  world.hurt(m, 55, 0, tank.p);
  world.hurt(m, 55, 0, solo.p);
  // party did 50%: pool = 22 * 0.75 * 1.1 (two members present) = 18.15 -> 9 each
  assert.equal(tank.p.exp, 9);
  assert.equal(healer.p.exp, 9, 'the healer dealt no damage and is paid the same');
  assert.equal(far.p.exp, 0, 'a member far away does not share');
  assert.equal(solo.p.exp, Math.round(22 * 0.75), 'a stranger is paid by contribution as before');
  assert.equal(idle.p.exp, 0, 'bystanders get nothing');
  // a full party of five standing together: +40% bonus
  const h = harness({ capacity: 20 });
  const five = Array.from({ length: 5 }, (_, i) => h.join(i * 20, 0, JOBS[i]));
  group(h.world, five[0].p, ...five.slice(1).map((x) => x.p));
  const m2 = h.world.spawn(five[0].p.room, 'boar', five[0].p.x + 30, five[0].p.y);
  h.world.hurt(m2, 110, 0, five[2].p);
  assert.deepEqual(five.map((x) => x.p.exp), Array(5).fill(Math.round((22 * 1.4) / 5)));
  // a dead member who contributed still gets a share; a dead one who did not, does not
  const k = harness({ capacity: 20 });
  const x = k.join(0, 0, 'knight'), y = k.join(20, 0, 'mage'), z = k.join(40, 0, 'cleric');
  group(k.world, x.p, y.p, z.p);
  const m3 = k.world.spawn(x.p.room, 'boar', x.p.x + 30, x.p.y);
  k.world.hurt(m3, 50, 0, y.p);
  k.world.hurt(y.p, 99999, 0, null);
  k.world.hurt(z.p, 99999, 0, null);
  k.world.hurt(m3, 60, 0, x.p);
  assert.ok(x.p.exp > 0 && y.p.exp === x.p.exp && z.p.exp === 0, `${x.p.exp}/${y.p.exp}/${z.p.exp}`);
});

test('M5 area support reaches the party only; single-target support works on anyone', () => {
  const { world, join } = harness({ capacity: 20 });
  const c = join(0, 0, 'cleric', 30), mate = join(30, 0, 'knight', 30), stranger = join(0, 30, 'mage', 30);
  grant(c.p, ['blessing', 'mend', 'divine_aegis']);
  group(world, c.p, mate.p);
  world.use(c.p, 'blessing', 0);
  const bit = 1 << STATUS_INDEX.blessing;
  assert.ok(c.p.mask & bit && mate.p.mask & bit, 'caster and party member are blessed');
  assert.equal(stranger.p.mask & bit, 0, 'a nearby stranger is not');
  world.hurt(stranger.p, 100, 0, null);
  c.p.gcd = 0;
  world.use(c.p, 'mend', stranger.p.id);
  assert.ok(stranger.p.hp > stranger.p.maxHp - 100, 'a targeted heal still helps a stranger');
  // without a party, area buffs affect only the caster
  const lone = join(60, 0, 'knight', 30);
  grant(lone.p, ['rallying_cry']);
  world.use(lone.p, 'rallying_cry', 0);
  const rally = 1 << STATUS_INDEX.rally;
  assert.ok(lone.p.mask & rally);
  assert.equal((c.p.mask | mate.p.mask | stranger.p.mask) & rally, 0);
});

test('M5 chat channels: zone, party and whisper reach exactly the right players', () => {
  const { world, join } = harness({ capacity: 20 });
  const a = join(0, 0, 'knight'), b = join(30, 0, 'mage'), c = join(60, 0, 'cleric');
  group(world, a.p, b.p);
  const chats = (o: any[]) => o.filter((m) => m.t === 'chat').map((m) => [m.ch, m.from, m.text, m.to]);
  world.chat(a.p, 'hello all');
  assert.deepEqual([a, b, c].map((x) => chats(x.out).length), [1, 1, 1]);
  assert.deepEqual(chats(c.out)[0], ['zone', a.p.name, 'hello all', undefined]);
  world.chat(a.p, 'pull the boar', 'party');
  assert.deepEqual([a, b, c].map((x) => chats(x.out).length), [2, 2, 1], 'party chat stays in the party');
  assert.equal(chats(b.out)[1][0], 'party');
  world.chat(c.p, 'psst', 'whisper', b.p.name.toLowerCase());
  assert.deepEqual([a, b, c].map((x) => chats(x.out).length), [2, 3, 2], 'whisper goes to the target and echoes to the sender');
  assert.deepEqual(chats(b.out)[2], ['whisper', c.p.name, 'psst', b.p.name]);
  world.chat(c.p, 'anyone?', 'party');
  assert.equal(sysOf(c.out).at(-1), 'You are not in a party.');
  world.chat(c.p, 'hi', 'whisper', 'Nobody');
  assert.equal(sysOf(c.out).at(-1), 'That player is not online.');
  world.chat(c.p, 'hi', 'whisper', c.p.name);
  assert.equal(sysOf(c.out).at(-1), 'You cannot whisper to yourself.');
  for (const bad of [null, 7, {}, undefined]) world.chat(c.p, 'x', 'whisper', bad);
  world.chat(c.p, 'fallback', 'nonsense-channel');
  assert.equal(chats(a.out).at(-1)![0], 'zone', 'unknown channels fall back to zone chat');
  // the rate limit is shared by all channels
  for (let i = 0; i < 12; i++) world.chat(a.p, 'spam ' + i, i % 2 ? 'party' : 'whisper', b.p.name);
  assert.ok(chats(b.out).filter((x) => /^spam/.test(x[2])).length <= 5);
  assert.ok(sysOf(a.out).some((t) => /too quickly/.test(t)));
});

test('M5 party members are kept in the same channel when changing zones', () => {
  const { world, join, step } = harness({ capacity: 2 });
  const portal = ZONES.eldoria.portals[0];
  const walkIn = (x: ReturnType<typeof join>) => {
    x.p.x = tileCenter(portal.tx - 1);
    x.p.y = tileCenter(portal.ty);
    x.p.room.grid.update(x.p);
    for (let i = 0; i < 10 && x.p.room.zoneId === 'eldoria'; i++) {
      world.input(x.p, x.p.lastSeq + 1, 1, 0, 1);
      step();
    }
    assert.equal(x.p.room.zoneId, 'verdant');
  };
  // fill verdant channel 1 with two strangers, so the next arrival opens channel 2
  const s1 = join(0, 0, 'mage'), s2 = join(0, 0, 'mage');
  walkIn(s1);
  walkIn(s2);
  const a = join(0, 0, 'knight'), b = join(0, 0, 'cleric'), lone = join(0, 0, 'ranger');
  group(world, a.p, b.p);
  walkIn(a);
  assert.equal(a.p.room.channel, 2);
  world.disconnect(s1.p, s1.conn);
  (world as any).housekeep(Date.now() + 1); // a seat frees up in channel 1
  walkIn(lone);
  assert.equal(lone.p.room.channel, 1, 'a stranger fills the first channel with space');
  walkIn(b);
  assert.equal(b.p.room, a.p.room, 'the party member joins the leader in channel 2');
  assert.deepEqual(partyOf(a.out).members.map((m: any) => [m.zone, m.ch]), [['verdant', 2], ['verdant', 2]]);
});

// ================= M6: inventory and equipment =================
const invOf = (o: any[]) => o.filter((m) => m.t === 'inv').at(-1);
const spec = (base: string, o: Partial<Item> = {}) => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1, ...o }) as any;

test('M6 item rules: rarity affixes, upgrade scaling, requirements and sell value', () => {
  let s = 1;
  const rng = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  for (let rar = 0; rar < 6; rar++) {
    const it = { ...rollItem(rng, 'longsword', 20, rar), uid: 'a' };
    assert.equal(it.aff.length, RARITY_AFFIXES[rar], `${RARITIES[rar]} has ${RARITY_AFFIXES[rar]} affixes`);
    assert.equal(new Set(it.aff.map((a) => a[0])).size, it.aff.length, 'no affix twice on one item');
  }
  const common = { ...spec('longsword', { ilvl: 20 }), uid: 'a' }, mythic = { ...common, rar: 5 }, plus10 = { ...common, up: 10 };
  assert.ok(itemStats(mythic).atk! > itemStats(common).atk! * 2, 'rarity multiplies base stats');
  assert.equal(itemStats(plus10).atk, Math.round(itemStats(common).atk! * (1 + 10 * UPGRADE_STEP)), '+6% per upgrade level');
  assert.equal(equipBlock(common, 'mage', 60), 'Only for Knights');
  assert.match(equipBlock(common, 'knight', 5), /Requires level 18/);
  assert.equal(equipBlock(common, 'knight', 18), '');
  assert.match(equipBlock({ ...spec('plate_cuirass'), uid: 'b' }, 'mage', 60), /^Only for Knight and/);
  assert.equal(equipBlock({ ...spec('ring'), uid: 'c' }, 'mage', 1), '', 'jewellery fits everyone');
  assert.ok(sellValue(mythic) > sellValue(common) && sellValue(common) > 0);
  // every job has a weapon item for both weapon slots, and every equip item is usable by someone
  for (const job of JOBS) for (const w of [0, 1]) assert.equal(starterKit(job, w)[0].base, ITEM_LIST.find((b) => b.job === job && b.wslot === w)!.id);
});

test('M6 loot tables: rates are configurable, ordinary monsters never drop Epic or better, elites always drop', () => {
  let s = 7;
  const rng = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  const tally = (elite: boolean, rate: number, n = 20000) => {
    const rar = [0, 0, 0, 0, 0, 0];
    let equips = 0, gold = 0, kills = 0;
    for (let i = 0; i < n; i++) {
      const l = rollLoot(rng, 10, elite, 'knight', rate, 1);
      gold += l.gold;
      if (l.items.length) kills++;
      for (const it of l.items) if (ITEMS[it.base].kind === 'equip') (equips++, rar[it.rar]++);
    }
    return { rar, equips, gold: gold / n, kills };
  };
  const normal = tally(false, 1);
  assert.ok(Math.abs(normal.equips / 20000 - LOOT.normal.equip) < 0.02, `equip rate ${normal.equips / 20000}`);
  assert.deepEqual(normal.rar.slice(3), [0, 0, 0], 'no Epic/Legendary/Mythic from ordinary monsters');
  assert.ok(normal.rar[0] > normal.rar[1] && normal.rar[1] > normal.rar[2] && normal.rar[2] > 0);
  const elite = tally(true, 1, 4000);
  assert.equal(elite.equips, 4000, 'elites always drop equipment');
  assert.ok(elite.rar[0] === 0 && elite.rar[3] > 0 && elite.rar[4] === 0 && elite.rar[5] === 0, 'elites: Uncommon to Epic');
  assert.equal(tally(false, 0).kills, 0, 'DROP_RATE 0 disables item drops');
  assert.ok(Math.abs(tally(false, 2).equips / 20000 - 0.28) < 0.02, 'DROP_RATE 2 doubles them');
  assert.ok(Math.abs(rollLoot(() => 0.5, 10, false, 'knight', 1, 3).gold - 3 * rollLoot(() => 0.5, 10, false, 'knight', 1, 1).gold) <= 1, 'GOLD_RATE scales gold');
});

test('M6 stored inventories are sanitised: duplicates, forged values and illegal equipment are corrected', () => {
  const sword = { uid: 'u1', base: 'longsword', rar: 5, ilvl: 10, up: 99, qty: 7, aff: [['atk', 1e9], ['atk', 5], ['hax', 3], ['def', -4], ['crit', 1]] };
  const c = cleanInventory('knight', 10, [sword, { ...sword }, { uid: 'u2', base: 'nope' }, { uid: 'u3', base: 'hp_potion', qty: 9999 }, null, 'x', { uid: 'u4', base: 'oak_staff', ilvl: 1 }],
    { weapon: { uid: 'u5', base: 'oak_staff', ilvl: 1 }, armor: { uid: 'u6', base: 'plate_cuirass', ilvl: 60 }, ring: { uid: 'u1', base: 'ring' }, helmet: { uid: 'u7', base: 'ring' }, kit: true });
  assert.equal(c.kit, true);
  assert.deepEqual(Object.keys(c.eq), ['ring'], 'wrong job, too high a level and wrong slot are all unequipped');
  const ids = c.inv.map((i) => i.uid);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('u1') && !ids.includes('u2'), 'the second copy of a uid and unknown bases are dropped');
  assert.equal(c.inv.find((i) => i.uid === 'u3')!.qty, 100, 'stacks are clamped');
  const c2 = cleanInventory('knight', 10, [sword], {});
  const it = c2.inv[0];
  assert.equal(it.up, MAX_UPGRADE);
  assert.equal(it.qty, 1);
  assert.deepEqual(it.aff.map((a) => a[0]), ['atk', 'crit'], 'duplicate, unknown and non-positive affixes are removed');
  assert.ok(it.aff[0][1] < 1000, 'an affix cannot exceed the best roll for its item level');
  assert.deepEqual(cleanInventory('knight', 1, 'garbage', 42), { inv: [], eq: {}, kit: false });
  assert.equal(cleanInventory('knight', 1, Array.from({ length: 100 }, (_, i) => ({ uid: 'x' + i, base: 'ring' })), {}).inv.length, INVENTORY_SIZE);
});

test('M6 starter kit is granted once; equipped gear changes stats, weapon specialisation and appearance', () => {
  const { world, join, step, items } = harness({ kit: true });
  const a = join(0, 0, 'knight', 5), b = join(40, 0, 'mage');
  const w0 = a.out.find((m) => m.t === 'welcome');
  assert.equal(w0.eq.weapon.base, 'longsword');
  assert.deepEqual(w0.inv.map((i: any) => [i.base, i.qty]), [['hp_potion', 3]]);
  assert.deepEqual(a.p.stats, fullStats('knight', 5, 0, a.p.eq));
  assert.ok(a.p.stats.atk > computeStats('knight', 5, 0).atk, 'the starting weapon adds attack');
  assert.equal(a.p.hp, a.p.maxHp);
  // rejoining does not grant the kit again
  world.disconnect(a.p, a.conn);
  step(2);
  assert.equal(items.at(-1).equipment.kit, true, 'the kit flag is saved');
  const again = world.join({ ...a.row, inventory: items.at(-1).inventory, equipment: items.at(-1).equipment, gold: 0 }, a.conn);
  assert.deepEqual(again.inv.map((i) => [i.base, i.qty]), [['hp_potion', 3]]);
  // equip a greatsword: weapon slot 1 -> different weapon rule, visible to others
  step(2);
  b.out.length = a.out.length = 0;
  assert.ok(give(again, spec('greatsword', { ilvl: 5, rar: 2, aff: [['maxHp', 30]] })));
  assert.ok(give(again, spec('plate_helm', { ilvl: 3 })));
  const gs = again.inv.find((i) => i.base === 'greatsword')!, helm = again.inv.find((i) => i.base === 'plate_helm')!;
  const hp0 = again.maxHp, rule0 = again.rule;
  assert.equal(world.inventory(again, { op: 'equip', uid: gs.uid }), '');
  assert.equal(again.eq.weapon!.base, 'greatsword');
  assert.ok(again.inv.some((i) => i.base === 'longsword'), 'the old weapon goes back to the bag');
  assert.equal(again.ap.weapon, 1);
  assert.notEqual(again.rule, rule0);
  assert.equal(again.maxHp, hp0 + 30);
  assert.equal(again.hp, again.maxHp, 'HP fraction is kept across a gear change');
  assert.deepEqual(again.stats, fullStats('knight', 5, 1, again.eq));
  assert.equal(world.inventory(again, { op: 'equip', uid: helm.uid }), '');
  assert.equal(again.ap.helmet, ITEMS.plate_helm.look!.helmet);
  assert.equal(again.baseAp.helmet, defaultAppearance('knight').helmet, 'the creator look is untouched underneath');
  step(2);
  const re = snaps(b.out).flatMap((m) => m.add ?? []).filter((e: any) => e.id === again.id).at(-1);
  assert.deepEqual(re.ap, again.ap, 'nearby players receive the new look');
  assert.deepEqual(invOf(a.out).ap, again.ap);
  // unequip restores the creator look and the bare-handed weapon choice
  assert.equal(world.inventory(again, { op: 'unequip', slot: 'helmet' }), '');
  assert.equal(world.inventory(again, { op: 'unequip', slot: 'weapon' }), '');
  assert.deepEqual(again.ap, again.baseAp);
  assert.deepEqual(again.stats, computeStats('knight', 5, 0));
  assert.equal(world.inventory(again, { op: 'unequip', slot: 'weapon' }), 'Nothing equipped there');
  assert.equal(world.inventory(again, { op: 'unequip', slot: '__proto__' }), 'Nothing equipped there');
});

test('M6 equip rules are enforced by the server; unknown items and commands are refused', () => {
  const { world, join } = harness();
  const { p, out } = join(0, 0, 'mage', 3);
  give(p, spec('longsword'));
  give(p, spec('oak_staff', { ilvl: 30 }));
  give(p, spec('plate_cuirass'));
  give(p, spec('hp_potion', { qty: 2 }));
  const id = (b: string) => p.inv.find((i) => i.base === b)!.uid;
  assert.equal(world.inventory(p, { op: 'equip', uid: id('longsword') }), 'Only for Knights');
  assert.match(world.inventory(p, { op: 'equip', uid: id('oak_staff') }), /Requires level 28/);
  assert.match(world.inventory(p, { op: 'equip', uid: id('plate_cuirass') }), /^Only for Knight and/);
  assert.equal(world.inventory(p, { op: 'equip', uid: id('hp_potion') }), 'Not equipment');
  assert.equal(world.inventory(p, { op: 'equip', uid: 'forged' }), 'Item not found');
  assert.equal(world.inventory(p, { op: 'equip' }), 'Item not found');
  assert.equal(world.inventory(p, { op: 'dupe', uid: id('longsword') }), 'Unknown inventory command');
  assert.equal(world.inventory(p, null), 'Unknown inventory command');
  assert.deepEqual(p.eq, {});
  assert.equal(noOf(out).length, 8, 'every refusal is reported to the client');
  assert.equal(p.inv.length, 4, 'nothing was lost or created');
});

test('M6 potions: restore HP or the class resource, share an 8 s cooldown, and are consumed', () => {
  const { world, join, step } = harness();
  const { p, out } = join(0, 0, 'mage', 10), z = join(40, 0, 'berserker', 10);
  give(p, spec('hp_potion', { qty: 3 }));
  give(p, spec('mana_potion', { qty: 2 }));
  const hp = p.inv[0].uid, mp = p.inv[1].uid;
  assert.equal(world.inventory(p, { op: 'use', uid: hp }), 'Already at full health');
  world.hurt(p, p.maxHp - 10, 0, null);
  const before = p.hp;
  assert.equal(world.inventory(p, { op: 'use', uid: hp }), '');
  assert.equal(p.hp, before + Math.ceil(p.maxHp * 0.2));
  assert.equal(p.inv[0].qty, 2);
  assert.equal(invOf(out).pcd, POTION_CD_MS);
  p.res = 0;
  assert.equal(world.inventory(p, { op: 'use', uid: mp }), 'Potions are on cooldown');
  step(POTION_CD_MS / TICK_MS - 1);
  assert.equal(world.inventory(p, { op: 'use', uid: mp }), 'Potions are on cooldown');
  step(1);
  const res0 = p.res;
  assert.equal(world.inventory(p, { op: 'use', uid: mp }), '');
  assert.equal(p.res, Math.min(p.stats.maxRes, res0 + Math.ceil(p.stats.maxRes * 0.3)));
  // a berserker gains rage from the same potion
  give(z.p, spec('mana_potion'));
  z.p.res = 0;
  assert.equal(world.inventory(z.p, { op: 'use', uid: z.p.inv[0].uid }), '');
  assert.equal(z.p.res, 20);
  assert.equal(z.p.inv.length, 0, 'the last potion of a stack removes the stack');
  // the dead cannot drink
  give(z.p, spec('hp_potion'));
  world.hurt(z.p, 99999, 0, null);
  assert.equal(world.inventory(z.p, { op: 'use', uid: z.p.inv[0].uid }), 'You are dead');
});

test('M6 stacking and capacity: stacks fill first, a full bag refuses whole grants', () => {
  const { join } = harness();
  const { p } = join();
  assert.ok(give(p, spec('hp_potion', { qty: 60 })));
  assert.ok(give(p, spec('hp_potion', { qty: 60 })));
  assert.deepEqual(p.inv.map((i) => i.qty), [100, 20], 'a stack is topped up before a new one starts');
  for (let i = 0; i < INVENTORY_SIZE - 2; i++) assert.ok(give(p, spec('ring')));
  assert.equal(p.inv.length, INVENTORY_SIZE);
  assert.equal(give(p, spec('ring')), false, 'no room for another item');
  assert.ok(give(p, spec('hp_potion', { qty: 80 })), 'but potions still fit in the open stack');
  assert.equal(give(p, spec('hp_potion', { qty: 1 })), false);
  assert.equal(give(p, spec('mana_potion')), false);
  assert.equal(new Set(p.inv.map((i) => i.uid)).size, INVENTORY_SIZE, 'every instance has its own id');
});

test('M6 shop: buy and sell only near the town plaza, with gold checked on the server', () => {
  const { world, join } = harness();
  const { p } = join(0, 0, 'knight', 5), far = join(SHOP_RANGE + 60, 0, 'knight', 5);
  p.gold = 100;
  assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion', qty: 2 }), '');
  assert.equal(p.gold, 100 - 2 * ITEMS.hp_potion.price);
  assert.equal(p.inv[0].qty, 2);
  assert.equal(world.inventory(p, { op: 'buy', base: 'upgrade_stone', qty: 1 }), 'Not for sale', 'Upgrade Stones are a daily gift now');
  assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion', qty: 999 }), 'Not enough gold');
  assert.equal(world.inventory(p, { op: 'buy', base: 'longsword' }), 'Not for sale');
  // companions: only the starter pet and the lowest mount, once each
  assert.deepEqual(SHOP_COMPANIONS, ['pet_moss_sprout', 'mount_plains_strider']);
  assert.equal(Math.min(...Object.values(MOUNTS).map((m) => m.level)), MOUNTS.plains_strider.level, 'the Plains Strider is the lowest mount');
  assert.equal(world.inventory(p, { op: 'buy', base: 'pet_ember_kit' }), 'Not for sale', 'other pets are found in the world');
  assert.equal(world.inventory(p, { op: 'buy', base: 'mount_ashen_charger' }), 'Not for sale');
  {
    const g = p.gold;
    p.gold = 10000;
    for (const id of SHOP_COMPANIONS) {
      assert.equal(world.inventory(p, { op: 'buy', base: id, qty: 5 }), '');
      assert.equal(p.inv.filter((i) => i.base === id).reduce((n, i) => n + i.qty, 0), 1, `${id}: one, whatever the quantity asked`);
      assert.equal(world.inventory(p, { op: 'buy', base: id }), 'You have already bought that; a shop sells it only once');
    }
    p.inv = p.inv.filter((i) => !SHOP_COMPANIONS.includes(i.base));
    p.gold = g;
  }
  assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion', qty: -5 }), '', 'a bad quantity is read as one');
  assert.equal(p.inv[0].qty, 3);
  assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion', qty: 1e9 }), '');
  assert.equal(p.inv[0].qty, 4);
  give(p, spec('ring', { ilvl: 5, rar: 2 }));
  const ring = p.inv.find((i) => i.base === 'ring')!, g0 = p.gold;
  assert.equal(world.inventory(p, { op: 'sell', uid: ring.uid }), '');
  assert.equal(p.gold, g0 + sellValue(ring));
  assert.equal(world.inventory(p, { op: 'sell', uid: ring.uid }), 'Item not found', 'an item cannot be sold twice');
  assert.equal(world.inventory(p, { op: 'sell', uid: p.inv[0].uid, qty: 99 }), '');
  assert.equal(p.gold, g0 + sellValue(ring) + 4 * sellValue(spec('hp_potion')), 'selling more than the stack sells the stack');
  assert.ok(sellValue(spec('hp_potion')) < ITEMS.hp_potion.price, 'no buy-and-sell profit');
  far.p.gold = 500;
  give(far.p, spec('ring'));
  assert.equal(world.inventory(far.p, { op: 'buy', base: 'hp_potion' }), 'You need to be at a shop');
  assert.equal(world.inventory(far.p, { op: 'sell', uid: far.p.inv[0].uid }), 'You need to be at a shop');
  assert.equal(far.p.gold, 500);
  // equipped items cannot be sold or destroyed directly
  give(p, spec('longsword'));
  const sw = p.inv.find((i) => i.base === 'longsword')!;
  world.inventory(p, { op: 'equip', uid: sw.uid });
  assert.equal(world.inventory(p, { op: 'sell', uid: sw.uid }), 'Item not found');
  assert.equal(world.inventory(p, { op: 'destroy', uid: sw.uid }), 'Item not found');
  assert.equal(p.eq.weapon!.uid, sw.uid);
});

test('M6 upgrading: costs gold and stones, can fail without harming the item, stops at +10, not in combat', () => {
  let roll = 0;
  const { world, join, step } = harness({ rng: () => roll });
  const { p, out } = join(0, 0, 'knight', 20);
  give(p, spec('longsword', { ilvl: 20 }));
  const sw = p.inv[0];
  world.inventory(p, { op: 'equip', uid: sw.uid });
  assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), 'Not enough gold');
  p.gold = 1e6;
  assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), 'Requires 1 Upgrade Stone');
  give(p, spec('upgrade_stone', { qty: 50 }));
  const atk0 = p.stats.atk;
  assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), '');
  assert.equal(sw.up, 1);
  assert.equal(p.gold, 1e6 - 20);
  assert.equal(p.inv[0].qty, 49);
  assert.ok(p.stats.atk > atk0, 'upgrading equipped gear raises stats immediately');
  // a failed roll: resources are spent, the item is unchanged
  roll = 0.999;
  const g = p.gold;
  assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), '');
  assert.equal(sw.up, 1);
  assert.equal(p.gold, g - upgradeCost(sw).gold);
  assert.equal(p.inv[0].qty, 48);
  assert.ok(sysOf(out).some((t) => /failed/.test(t)));
  roll = 0;
  give(p, spec('upgrade_stone', { qty: 50 }));
  while (sw.up < MAX_UPGRADE) assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), '');
  assert.equal(world.inventory(p, { op: 'upgrade', uid: sw.uid }), 'Already at maximum upgrade');
  assert.deepEqual(p.stats, fullStats('knight', 20, 0, p.eq));
  // not while fighting
  give(p, spec('ring'));
  const ring = p.inv.find((i) => i.base === 'ring')!;
  const m = world.spawn(p.room, 'boar', p.x + 30, p.y);
  world.hurt(p, 1, 0, m);
  assert.equal(world.inventory(p, { op: 'upgrade', uid: ring.uid }), 'Cannot upgrade in combat');
  world.hurt(m, 99999, 0, null);
  step(Math.ceil(COMBAT_TIMEOUT_MS / TICK_MS) + 2);
  assert.equal(world.inventory(p, { op: 'upgrade', uid: ring.uid }), '');
  assert.equal(world.inventory(p, { op: 'upgrade', uid: p.inv.find((i) => i.base === 'upgrade_stone')!.uid }), 'Item not found', 'materials cannot be upgraded');
});

test('M6 loot on kill is personal: each rewarded player rolls separately; a full bag loses items, never gold', () => {
  // rng 0.01: every chance succeeds
  const { world, join } = harness({ rng: () => 0.01, capacity: 20 });
  const a = join(0, 0, 'knight', 3), b = join(30, 0, 'mage', 3), c = join(60, 0, 'ranger', 3), idle = join(90, 0, 'cleric', 3);
  group(world, a.p, b.p);
  const m = world.spawn(a.p.room, 'boar', a.p.x + 30, a.p.y);
  world.hurt(m, m.maxHp / 2, 0, a.p);
  world.hurt(m, 99999, 0, c.p);
  for (const x of [a, b, c]) {
    const loot = x.out.find((q) => q.t === 'loot');
    // equipment, a potion, an upgrade stone and (since M12) a Rune Scroll
    assert.ok(loot && loot.gold > 0 && loot.items.length === 4, `${x.p.name} got ${JSON.stringify(loot)}`);
    assert.equal(x.p.gold, loot.gold);
    assert.equal(x.p.inv.length, 4);
    assert.ok(x.p.invDirty);
    assert.deepEqual(invOf(x.out).inv, x.p.inv);
  }
  assert.equal(idle.out.some((q) => q.t === 'loot'), false, 'bystanders get nothing');
  const all = [a, b, c].flatMap((x) => x.p.inv.map((i) => i.uid));
  assert.equal(new Set(all).size, all.length, 'no two players hold the same instance');
  // full bag: gold still arrives, the player is told
  const h = harness({ rng: () => 0.01 });
  const f = h.join(0, 0, 'knight', 3);
  for (let i = 0; i < INVENTORY_SIZE; i++) give(f.p, spec('ring'));
  const m2 = h.world.spawn(f.p.room, 'boar', f.p.x + 30, f.p.y);
  h.world.hurt(m2, 99999, 0, f.p);
  assert.ok(f.p.gold > 0);
  assert.equal(f.p.inv.length, INVENTORY_SIZE);
  assert.ok(sysOf(f.out).some((t) => /inventory is full/i.test(t)));
  // DROP_RATE 0: gold only
  const z = new World(new Proxy({} as any, { get: () => async () => {} }), { roomCapacity: 5, reconnectGraceMs: 0, autosaveMs: 1e9, monsters: false, rng: () => 0.01, dropRate: 0, goldRate: 2 });
  const zp = z.join({ ...a.row, id: 99, equipment: { kit: true } }, { send() {}, close() {} });
  const m3 = z.spawn(zp.room, 'boar', zp.x + 30, zp.y);
  z.hurt(m3, 99999, 0, zp);
  assert.equal(zp.inv.length, 0);
  assert.equal(zp.gold, 2 * a.p.gold - 0 >= 0 ? zp.gold : -1);
  assert.ok(zp.gold >= 2 * a.p.gold - 1 && zp.gold <= 2 * a.p.gold + 1, 'GOLD_RATE 2 doubles gold');
});

test('M6 persistence: inventory, equipment and gold are saved on logout and by autosave only when changed', async () => {
  const { world, join, step, items } = harness();
  const { p, conn } = join(0, 0, 'knight', 5), q = join(40, 0, 'mage');
  give(p, { ...rollItem(() => 0.3, 'greatsword', 4, 3), up: 2 });
  p.gold = 777;
  world.inventory(p, { op: 'equip', uid: p.inv[0].uid });
  await (world as any).autosave?.();
  world.disconnect(p, conn);
  step(2);
  const rec = items.filter((r) => r.id === p.id).at(-1);
  assert.ok(rec, 'saved');
  assert.equal(rec.gold, 777);
  assert.equal(rec.equipment.weapon.base, 'greatsword');
  assert.equal(items.some((r) => r.id === q.p.id), false, 'an untouched inventory is not written');
  // what was saved loads back identically
  const c = cleanInventory('knight', 5, JSON.parse(JSON.stringify(rec.inventory)), JSON.parse(JSON.stringify(rec.equipment)));
  assert.deepEqual(c.eq, p.eq);
  assert.deepEqual(c.inv, p.inv);
});

// ================= M7: bosses, dungeons and boss loot =================
const annOf = (o: any[]) => o.filter((m) => m.t === 'ann').map((m) => m.text as string);
const lootOf = (o: any[]) => o.filter((m) => m.t === 'loot');
const teleOf = (o: any[]) => snaps(o).flatMap((m) => m.ev ?? []).filter((e: any) => e[1] === Act.Telegraph);
const gateOf = (zone: string) => {
  const g = ZONES[zone].gates![0], sp = ZONES[zone].spawn;
  return { dx: (g.tx - sp.tx) * TILE, dy: (g.ty - sp.ty) * TILE - TILE, id: g.dungeon };
};
// Test monsters with one attack each, so a mechanic can be observed in isolation.
MONSTERS.t_ring = { ...MONSTERS.boar, id: 't_ring', name: 'Test Ring', aggro: 400, leash: 900, speed: 0.01, pattern: [{ name: 'Ring', windupMs: 500, range: 400, mul: 1, aoe: 140, self: true, donut: 60 }] };
MONSTERS.t_multi = { ...MONSTERS.boar, id: 't_multi', name: 'Test Multi', aggro: 400, leash: 900, speed: 0.01, pattern: [{ name: 'Rain', windupMs: 500, range: 400, mul: 1, aoe: 40, magic: true, multi: 3 }] };

test('M7 boss definitions: six bosses with phases, enrage timers, summons, and loot pools', () => {
  const bosses = Object.values(MONSTERS).filter((d) => d.boss && ['abyssal_golem', 'ancient_dragon', 'demon_lord', 'frost_queen', 'rune_guardian', 'shadow_knight'].includes(d.id));
  assert.equal(bosses.length, 6);
  // levels 45-200: ten dungeon bosses and five world bosses more
  assert.equal(Object.values(MONSTERS).filter((d) => d.boss).length, 6 + 10 + 5 + 4 + DEPTHS.length, 'the four raid bosses, and one in each of the Depths');
  for (const d of bosses) {
    const b = d.boss!;
    assert.ok(b.phases.length >= 3 && b.phases[0].at === 1, `${d.id} phases`);
    for (let i = 1; i < b.phases.length; i++) {
      assert.ok(b.phases[i].at < b.phases[i - 1].at && b.phases[i].say.length > 10, `${d.id} phase ${i}`);
      assert.notDeepEqual(b.phases[i].pattern.map((a) => a.name), b.phases[i - 1].pattern.map((a) => a.name), `${d.id}: phase ${i} plays differently`);
      assert.ok(b.phases[i].pattern.length >= 3);
    }
    assert.ok(b.enrageMs >= 5 * 60000 && b.intro.length > 10 && b.title.length > 3);
    assert.ok(b.phases.some((p) => p.pattern.some((a) => a.summon)), `${d.id} calls helpers`);
    assert.ok(b.phases.some((p) => p.pattern.some((a) => a.donut)), `${d.id} has a ring attack`);
    assert.ok(b.phases.some((p) => p.pattern.some((a) => a.multi)), `${d.id} has a multi-target attack`);
    assert.ok(d.hp >= mobHp(d.level) * 60, 'boss health');
    assert.equal(phaseAt(d, 1), 0);
    assert.equal(phaseAt(d, 0.01), b.phases.length - 1);
    const pool = BOSS_UNIQUES[d.id];
    assert.ok(pool.length >= 5 && pool.every((id) => ITEMS[id].unique), `${d.id} loot pool`);
    for (const rar of [3, 4, 5]) assert.ok(pool.some((id) => ITEMS[id].unique!.rar === rar), `${d.id} can drop a ${RARITIES[rar]} unique`);
  }
  assert.deepEqual([...WORLD_BOSSES, ...DEPTH_BOSSES].map((b) => b.type).sort(), Object.values(MONSTERS).filter((d) => d.boss?.world).map((d) => d.id).sort(), 'every world boss is placed in its region, or in the Depths');
  for (const b of [...WORLD_BOSSES, ...DEPTH_BOSSES]) assert.equal(blocked(getZoneMap(b.zone), tileCenter(b.tx), tileCenter(b.ty)), false, 'world boss stands on open ground');
});

test('M7 boss fight: phases change the pattern and are announced, crowd control is refused, a wipe resets the boss', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 12), far = join(0, 1000, 'mage', 12);
  assert.ok(far.p.y > a.p.y + 900);
  const m = world.spawn(a.p.room, 'rune_guardian', a.p.x + 60, a.p.y);
  const def = m.def.boss!;
  step(8);
  assert.ok(m.engagedAt > 0 && m.state !== 'idle', 'the boss notices the player');
  assert.deepEqual(annOf(a.out), [def.intro]);
  assert.equal(annOf(far.out).length, 1, 'announcements reach the whole room');
  applyStatus(m, STATUS_INDEX.stun, world.tick, 0, a.p.id);
  applyStatus(m, STATUS_INDEX.root, world.tick, 0, a.p.id);
  applyStatus(m, STATUS_INDEX.slow, world.tick, 0, a.p.id);
  assert.equal(m.mask & ((1 << STATUS_INDEX.stun) | (1 << STATUS_INDEX.root)), 0, 'bosses cannot be stunned or rooted');
  assert.ok(m.mask & (1 << STATUS_INDEX.slow), 'but can be slowed');
  // phase 2 at 60%, phase 3 at 25%; one big hit may skip straight to the right phase
  world.hurt(m, Math.ceil(m.maxHp * 0.41), 0, a.p);
  assert.equal(m.phase, 1);
  assert.equal(annOf(a.out).at(-1), def.phases[1].say);
  world.hurt(m, Math.ceil(m.maxHp * 0.36), 0, a.p);
  assert.equal(m.phase, 2);
  assert.equal(annOf(a.out).at(-1), def.phases[2].say);
  assert.equal(phaseAt(m.def, m.hp / m.maxHp), 2, 'the client derives the same phase from health');
  // the boss summons in later phases; helpers are tied to it
  world.summon(m, 'ruin_sentry', 2);
  const adds = [...a.p.room.monsters.values()].filter((x) => x.summoner === m.id);
  assert.equal(adds.length, 2);
  assert.ok(adds.every((x) => x.noRespawn && x.threat.has(a.p.id)), 'helpers join the fight and never respawn');
  for (let i = 0; i < 5; i++) world.summon(m, 'ruin_sentry', 2);
  assert.equal([...a.p.room.monsters.values()].filter((x) => x.summoner === m.id).length, 6, 'at most six helpers at a time');
  // wipe: the boss goes home, heals, returns to phase 1 and its helpers vanish
  world.hurt(a.p, 1e9, 0, null);
  step(60);
  assert.equal(m.state, 'idle');
  assert.deepEqual([m.hp, m.phase, m.engagedAt, m.fury, m.contrib.size], [m.maxHp, 0, 0, false, 0]);
  assert.equal([...a.p.room.monsters.values()].filter((x) => x.summoner === m.id).length, 0);
  assert.match(annOf(far.out).at(-1)!, /restored/);
});

test('M7 boss enrage: past the time limit the boss deals triple damage', () => {
  const dmg = (fury: boolean) => {
    const { world, join, step } = harness();
    const a = join(0, 0, 'knight', 10);
    const m = world.spawn(a.p.room, 'rune_guardian', a.p.x + 40, a.p.y);
    m.def.boss!.phases[0].pattern.length; // phase 1 opens with a plain melee hit
    step(3);
    if (fury) m.engagedAt = world.tick - Math.ceil(m.def.boss!.enrageMs / TICK_MS) - 1;
    a.p.maxHp = a.p.hp = 1e6; // survive long enough to compare the same attack in both runs
    step(110);
    const hits = dmOf(a.out).filter((d: any) => d[0] === a.p.id && d[3] === m.id && d[1] > 0);
    assert.ok(hits.length >= 3, `the boss landed ${hits.length} hits`);
    // third attack of the pattern: Stone Fist again (the first one may predate the enrage)
    return { first: hits[2][1], fury: m.fury, ann: annOf(a.out) };
  };
  const calm = dmg(false), mad = dmg(true);
  assert.equal(calm.fury, false);
  assert.equal(mad.fury, true);
  assert.ok(mad.ann.some((t) => /berserk/.test(t)));
  assert.ok(Math.abs(mad.first / calm.first - 3) < 0.25, `${calm.first} -> ${mad.first}`);
});

test('M7 ring attack: the band is dangerous, standing next to the monster or far away is safe', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const near = join(30, 0, 'knight', 5), band = join(100, 0, 'knight', 5), out = join(260, 0, 'knight', 5);
  const m = world.spawn(near.p.room, 't_ring', near.p.x - 30, near.p.y);
  step(40);
  const t = teleOf(band.out)[0];
  assert.deepEqual(t.slice(4), [140, 500, 0, 60], 'the warning carries the outer and the safe inner radius');
  assert.equal(near.p.hp, near.p.maxHp, 'inside the inner circle: safe');
  assert.ok(band.p.hp < band.p.maxHp, 'in the band: hit');
  assert.equal(out.p.hp, out.p.maxHp, 'beyond the ring: safe');
  assert.ok(m.threat.size > 0);
});

test('M7 multi-target attack: one warning per circle, players who step out are spared', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 5), b = join(120, 0, 'knight', 5), c = join(0, 120, 'knight', 5);
  world.spawn(a.p.room, 't_multi', a.p.x + 60, a.p.y + 60);
  let tele: any[] = [];
  for (let i = 0; i < 40 && !tele.length; i++) {
    step(1);
    tele = teleOf(a.out);
  }
  assert.equal(tele.length, 3, 'three circles');
  const spots = tele.map((t) => `${t[2]},${t[3]}`).sort();
  assert.deepEqual(spots, [a, b, c].map((x) => `${Math.round(x.p.x)},${Math.round(x.p.y)}`).sort(), 'one under each player');
  // b walks out of their circle before it lands
  for (let i = 0; i < 9; i++) {
    world.input(b.p, i + 1, 1, 0, 1);
    step(1);
  }
  step(6);
  assert.ok(a.p.hp < a.p.maxHp && c.p.hp < c.p.maxHp, 'those who stayed are hit');
  assert.equal(b.p.hp, b.p.maxHp, 'the one who moved is not');
  // alone, the spare circles still fall near the target
  const h = harness();
  const solo = h.join(0, 0, 'knight', 5);
  h.world.spawn(solo.p.room, 't_multi', solo.p.x + 60, solo.p.y);
  h.step(12);
  assert.equal(teleOf(solo.out).length, 3);
});

test('M7 world boss: contribution decides who is rewarded; top contributors roll twice; it returns on schedule', () => {
  const { world, join, step } = harness({ capacity: 20, rng: () => 0.5, world: { bossRespawnScale: 0.001 } });
  const z = 'dreadmoor', wb = WORLD_BOSSES.find((b) => b.zone === z)!, sp = ZONES[z].spawn;
  const at = (i: number, job: Job) => join((wb.tx - sp.tx) * TILE + i * 30, (wb.ty - sp.ty) * TILE + 60, job, 32, -1, z);
  const tank = at(0, 'knight'), dps = at(1, 'assassin'), dps2 = at(2, 'ranger'), healer = at(3, 'cleric'), tourist = at(4, 'mage'), idle = at(5, 'mage');
  const elsewhere = join(0, 0, 'mage', 5);
  const m = world.spawn(tank.p.room, wb.type, tileCenter(wb.tx), tileCenter(wb.ty));
  assert.ok(m.def.boss!.world);
  world.hurt(m, m.maxHp * 0.3, 0, tank.p);
  world.hurt(m, m.maxHp * 0.4, 0, dps.p);
  world.hurt(m, m.maxHp * 0.2, 0, dps2.p);
  world.hurt(m, Math.floor(m.maxHp * 0.004), 0, tourist.p); // tagging the boss is not enough
  // healing a fighter and soaking the boss's hits both count (at half value)
  tank.p.hp = 1;
  world.heal(tank.p, m.maxHp * 0.05, healer.p);
  assert.ok(tank.p.maxHp > 1 && (m.contrib.get(healer.p.id) ?? 0) > 0, 'healer credited');
  world.heal(tank.p, 1e9, healer.p);
  for (let i = 0; i < 40; i++) { tank.p.hp = 1; world.heal(tank.p, 1e9, healer.p); }
  assert.ok(m.contrib.get(healer.p.id)! >= m.maxHp * 0.01, `healer contribution ${m.contrib.get(healer.p.id)} of ${m.maxHp}`);
  const before = m.contrib.get(tank.p.id)!;
  world.hurt(tank.p, 100, 0, m);
  assert.equal(m.contrib.get(tank.p.id), before + 50, 'damage soaked counts at half value');
  world.hurt(m, 1e9, 0, dps.p);
  assert.ok(m.dead);
  const items = (x: any) => lootOf(x.out).flatMap((l: any) => l.items).filter((i: any) => i.rar >= 3).length;
  assert.equal(items(dps), 2, 'top three contributors roll twice');
  assert.equal(items(tank), 2);
  assert.equal(items(dps2), 2);
  assert.equal(items(healer), 1, 'the healer is rewarded without dealing damage');
  assert.equal(items(tourist), 0, 'below 1% contribution: no boss item');
  assert.equal(items(idle), 0);
  for (const x of [dps, tank, dps2, healer]) assert.ok(x.p.gold > 0 && x.p.inv.some((i) => i.base === 'upgrade_stone'));
  assert.ok(annOf(elsewhere.out).some((t) => /Shadow Knight has been defeated in Dreadmoor/.test(t) && t.includes(dps.p.name)), 'the kill is announced to everyone online');
  // schedule: respawnMs (15 min) scaled by the server setting
  step(Math.ceil((m.def.respawnMs * 0.001) / TICK_MS) + 2);
  assert.ok(!m.dead && m.hp === m.maxHp && m.contrib.size === 0, 'the boss is back');
  assert.ok(annOf(elsewhere.out).some((t) => /has returned to Dreadmoor/.test(t)));
});

test('M7 boss loot odds: always Epic or better, Mythic possible on every tier and never guaranteed', () => {
  let s = 99;
  const rng = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  for (const tier of ['normal', 'hard', 'nightmare', 'world'] as const) {
    const n = 20000, count = [0, 0, 0];
    let uniques = 0;
    for (let i = 0; i < n; i++) {
      const it = rollBossItem(rng, 'ancient_dragon', 18, JOBS[i % 6], tier);
      assert.ok(it.rar >= 3 && it.rar <= 5);
      count[it.rar - 3]++;
      const b = ITEMS[it.base];
      if (b.unique) {
        uniques++;
        assert.ok(BOSS_UNIQUES.ancient_dragon.includes(it.base) && b.unique.rar === it.rar);
      } else assert.equal(equipBlock({ ...it, uid: 'x' }, JOBS[i % 6], 60), '', 'ordinary boss gear fits the looter');
      assert.equal(it.aff.length, RARITY_AFFIXES[it.rar]);
    }
    const w = BOSS_RARITY[tier];
    for (let k = 0; k < 3; k++) assert.ok(Math.abs((count[k] / n) * 100 - w[k]) < 1.2, `${tier} ${RARITIES[k + 3]}: ${(count[k] / n) * 100}% vs ${w[k]}%`);
    assert.ok(count[2] > 0 && count[2] < n * 0.1, `${tier}: Mythic is rare but obtainable`);
    assert.ok(uniques > n * 0.3 && uniques < n * 0.6);
  }
  assert.ok(BOSS_RARITY.nightmare[2] > BOSS_RARITY.hard[2] && BOSS_RARITY.hard[2] > BOSS_RARITY.normal[2], 'harder dungeons improve the odds');
});

test('M7 sets and unique passives: bonuses at 2 and 3 pieces; passives change combat on the server', () => {
  const { world, join, step } = harness();
  const { p, out } = join(0, 0, 'knight', 30);
  const wear = (base: string) => {
    give(p, rollItem(() => 0.5, base, 30, 3));
    assert.equal(world.inventory(p, { op: 'equip', uid: p.inv.at(-1)!.uid }), '');
  };
  const bare = computeStats('knight', 30, 0);
  wear('ds_helm');
  const one = { ...p.stats };
  wear('ds_amulet');
  const flat2 = fullStats('knight', 30, 0, { helmet: p.eq.helmet }).maxHp + itemStats(p.eq.amulet!).maxHp! - bare.maxHp;
  assert.equal(p.stats.maxHp, Math.round((bare.maxHp + flat2) * 1.1), '2 pieces: +10% maximum HP');
  assert.ok(one.maxHp < p.stats.maxHp);
  const atk2 = p.stats.atk, crit2 = p.stats.crit;
  wear('ds_ring');
  assert.ok(p.stats.atk >= Math.round(atk2 * 1.1) && p.stats.crit >= crit2 + 5, '3 pieces: +10% attack and +5% crit');
  assert.deepEqual(p.stats, fullStats('knight', 30, 0, p.eq), 'client-side preview matches the server');
  assert.equal(p.ap.helmet, ITEMS.ds_helm.look!.helmet, 'set helmets are visible');
  // passives that change stats
  world.inventory(p, { op: 'unequip', slot: 'ring' });
  wear('stormstride');
  assert.deepEqual(p.passives, ['swift']);
  assert.equal(p.stats.moveMul, Math.round(computeStats('knight', 30, 0).moveMul * 1.08 * 1000) / 1000);
  wear('guardian_sigil');
  assert.equal(p.stats.runeCost, 0.8);
  // executioner: +25% below 30% health; giantslayer: +15% against elites
  const strike = (passives: string[], hpFrac: number, type = 'boar') => {
    const m = world.spawn(p.room, type, p.x + 30, p.y);
    m.hp = Math.ceil(m.maxHp * hpFrac);
    p.passives = passives;
    const d = world.strike(p, m, 1, false, -100);
    p.room.monsters.delete(m.id);
    return d;
  };
  MONSTERS.t_tank = { ...MONSTERS.old_tusk, id: 't_tank', name: 'Test Tank', hp: 1e7, def: 0 };
  MONSTERS.t_dummy = { ...MONSTERS.boar, id: 't_dummy', name: 'Test Dummy', hp: 1e7, def: 0 };
  const base = strike([], 1, 't_dummy');
  assert.equal(strike(['executioner'], 1, 't_dummy'), base, 'no bonus on a healthy target');
  assert.equal(strike(['executioner'], 0.2, 't_dummy'), Math.round(base * 1.25));
  assert.equal(strike(['giantslayer'], 1, 't_dummy'), base, 'no bonus against ordinary monsters');
  assert.equal(strike(['giantslayer'], 1, 't_tank'), Math.round(strike([], 1, 't_tank') * 1.15));
  // thorns: melee attackers take 20% back; second wind: a big heal once per 90 s
  p.passives = ['thorns', 'secondwind'];
  p.hp = p.maxHp;
  const foe = world.spawn(p.room, 'boar', p.x + 20, p.y);
  step(40);
  const taken = dmOf(out).filter((d: any) => d[0] === p.id && d[3] === foe.id && d[1] > 0);
  const back = dmOf(out).filter((d: any) => d[0] === foe.id && d[3] === p.id);
  assert.ok(taken.length > 0 && back.length === taken.length, 'every melee hit is answered');
  assert.equal(back[0][1], Math.max(1, Math.round(taken[0][1] * 0.2)));
  p.room.monsters.delete(foe.id);
  p.hp = p.maxHp;
  world.hurt(p, Math.ceil(p.maxHp * 0.8), 0, null);
  assert.equal(p.hp, p.maxHp - Math.ceil(p.maxHp * 0.8) + Math.ceil(p.maxHp * 0.3), 'Second Wind fires below 25% health');
  const hp = p.hp;
  world.hurt(p, hp - 5, 0, null);
  assert.equal(p.hp, 5, 'and not again while on cooldown');
  step(Math.ceil(SECOND_WIND_CD_MS / TICK_MS));
  p.hp = Math.ceil(p.maxHp * 0.5);
  world.hurt(p, Math.ceil(p.maxHp * 0.3), 0, null);
  assert.ok(p.hp > p.maxHp * 0.4, 'ready again after 90 s');
  // unique items keep their rarity whatever is stored
  assert.equal(cleanInventory('knight', 30, [{ uid: 'q', base: 'heart_of_aetherion', rar: 0, ilvl: 30 }], {}).inv[0].rar, 5);
  for (const set of Object.values(SETS)) assert.equal(ITEM_LIST.filter((b) => b.unique?.set === set.id).length, 3, `${set.id} has three pieces`);
  for (const b of ITEM_LIST) if (b.unique?.passive) assert.ok(PASSIVES[b.unique.passive], b.id);
});

test('M7 dungeon entry: gate, level and leadership rules; a private instance scaled to the group', () => {
  const g = gateOf('verdant');
  const { world, join } = harness({ capacity: 20 });
  const lead = join(g.dx, g.dy, 'knight', 10, -1, 'verdant'), mate = join(g.dx + 40, g.dy, 'cleric', 10, -1, 'verdant');
  const farMate = join(0, 0, 'mage', 10, -1, 'verdant'), low = join(g.dx, g.dy + 20, 'mage', 2, -1, 'verdant'), stranger = join(g.dx - 40, g.dy, 'ranger', 10, -1, 'verdant');
  assert.equal(world.dungeon(farMate.p, 'enter', 'ruins', 'normal'), 'You need to stand at the dungeon entrance');
  assert.equal(world.dungeon(lead.p, 'enter', 'lair', 'normal'), 'You need to stand at the dungeon entrance', 'this gate leads to the Ancient Ruins only');
  assert.equal(world.dungeon(lead.p, 'enter', 'nope', 'normal'), 'Unknown dungeon');
  assert.equal(world.dungeon(low.p, 'enter', 'ruins', 'normal'), `Requires level ${DUNGEONS.ruins.minLevel}`);
  assert.equal(world.dungeon(lead.p, 'leave', undefined, undefined), 'You are not in a dungeon');
  assert.equal(world.dungeon(lead.p, 'dance', undefined, undefined), 'Unknown dungeon command');
  group(world, lead.p, mate.p, farMate.p, low.p);
  assert.equal(world.dungeon(mate.p, 'enter', 'ruins', 'normal'), 'Only the party leader can open a dungeon');
  const outside = lead.p.room, pos = [lead.p.x, lead.p.y];
  // every member must be at the entrance and high enough in level
  assert.equal(world.dungeon(lead.p, 'enter', 'ruins', 'hard'), `Every party member must be at the dungeon entrance: ${farMate.p.name}, ${low.p.name}`);
  world.parties.remove(low.p, 'left');
  farMate.p.x = lead.p.x - 30; farMate.p.y = lead.p.y;
  // then every member must agree
  assert.equal(world.dungeon(lead.p, 'enter', 'ruins', 'hard'), '');
  assert.equal(lead.p.room, outside, 'nobody goes in before everyone agreed');
  const ask = mate.out.filter((m) => m.t === 'dready').at(-1);
  assert.deepEqual([ask.id, ask.diff, ask.from, ask.ok, ask.wait.sort()], ['ruins', 'hard', lead.p.name, [lead.p.name], [mate.p.name, farMate.p.name].sort()]);
  assert.equal(world.dungeon(lead.p, 'enter', 'ruins', 'hard'), 'Already waiting for the party to agree');
  assert.equal(world.dungeon(mate.p, 'ready', undefined, true), '');
  assert.equal(lead.p.room, outside, 'still waiting for one');
  // a decline cancels; asked again, everyone agrees
  assert.equal(world.dungeon(farMate.p, 'ready', undefined, false), '');
  assert.equal(world.dungeons.checks.size, 0);
  assert.ok(lead.out.some((m) => m.t === 'sys' && m.text === `${farMate.p.name} declined to enter Ancient Ruins.`));
  assert.equal(world.dungeon(lead.p, 'enter', 'ruins', 'hard'), '');
  world.dungeon(mate.p, 'ready', undefined, true);
  world.dungeon(farMate.p, 'ready', undefined, true);
  const inst = lead.p.room;
  assert.notEqual(inst, outside);
  assert.equal(inst.zoneId, 'd_ruins');
  assert.equal(mate.p.room, inst, 'the whole party goes in together');
  assert.equal(farMate.p.room, inst);
  assert.equal(low.p.room, outside, 'members below the level requirement stay outside');
  assert.equal(stranger.p.room, outside);
  const sp = ZONES.d_ruins.spawn;
  assert.deepEqual([lead.p.x, lead.p.y], [tileCenter(sp.tx), tileCenter(sp.ty)]);
  assert.deepEqual(lead.p.ret, { zone: 'verdant', x: pos[0], y: pos[1] });
  const w = lead.out.filter((m) => m.t === 'welcome').at(-1);
  assert.equal(w.zone, 'd_ruins');
  const st = lead.out.filter((m) => m.t === 'dng').at(-1).run;
  assert.deepEqual([st.id, st.diff, st.stage, st.stages, st.state, st.left], ['ruins', 'hard', 0, 4, 'active', 9]);
  // monsters: hard difficulty and three players
  const mobs = [...inst.monsters.values()];
  assert.equal(mobs.length, 9);
  for (const m of mobs) {
    assert.equal(m.maxHp, Math.round(m.def.hp * DIFFICULTY.hard.hp * partyHpScale(3)));
    assert.equal(m.level, m.def.level + DIFFICULTY.hard.level);
    assert.equal(m.atkScale, DIFFICULTY.hard.atk);
    assert.ok(m.noRespawn && !blocked(inst.map, m.x, m.y));
  }
  // a member who leaves can walk back in to the same run
  assert.equal(world.dungeon(farMate.p, 'leave', undefined, undefined), '');
  assert.equal(world.dungeon(farMate.p, 'enter', 'ruins', 'nightmare'), '');
  assert.equal(farMate.p.room, inst, 'joins the existing run; the difficulty is the one the leader chose');
  // a stranger at the same gate gets an instance of their own
  assert.equal(world.dungeon(stranger.p, 'enter', 'ruins', 'normal'), '');
  assert.notEqual(stranger.p.room, inst);
  assert.equal(stranger.p.room.zoneId, 'd_ruins');
  assert.equal([...stranger.p.room.monsters.values()][0].maxHp, Math.round([...stranger.p.room.monsters.values()][0].def.hp * partyHpScale(1)));
  assert.equal(world.dungeons.runs.size, 2);
  assert.equal(world.dungeon(stranger.p, 'enter', 'ruins', 'normal'), 'You are already inside a dungeon');
  // leaving returns to the gate
  assert.equal(world.dungeon(mate.p, 'leave', undefined, undefined), '');
  assert.equal(mate.p.room.zoneId, 'verdant');
  assert.ok(Math.hypot(mate.p.x - (pos[0] + 40), mate.p.y - pos[1]) < 1);
  assert.equal(mate.out.filter((m) => m.t === 'dng').at(-1).run, null);
});

test('every dungeon: entered from its gate, cleared, and its boss gives equipment', () => {
  const report: string[] = [];
  for (const zone of REGIONS) {
    if (!ZONES[zone].gates?.length) continue;
    const g = gateOf(zone), def = DUNGEONS[g.id];
    const { world, join } = harness({ capacity: 20 });
    const a = join(g.dx, g.dy, 'knight', Math.max(def.minLevel, def.level), -1, zone);
    const why = world.dungeon(a.p, 'enter', g.id, 'normal');
    if (why) { report.push(`${g.id}: cannot enter: ${why}`); continue; }
    const run = world.dungeons.runs.get(a.p.room)!;
    const before = a.p.inv.filter((i) => ITEMS[i.base].kind === 'equip').length;
    let now = Date.now(), bossSeen = '';
    for (let s = 0; s < def.stages.length + 3; s++) {
      for (const m of [...run.alive]) { if (m.def.boss) bossSeen = m.def.id; world.hurt(m, 1e9, 0, a.p); }
      world.dungeons.tick((now = Date.now()));
      world.dungeons.tick(now + 3000);
    }
    const after = a.p.inv.filter((i) => ITEMS[i.base].kind === 'equip').length;
    if (!bossSeen) report.push(`${g.id}: no boss`);
    else if (after <= before) report.push(`${g.id}: boss ${bossSeen} gave no equipment (bag ${a.p.inv.length})`);

  }
  assert.deepEqual(report, []);
});

test('G7 weekly dungeon affix: rotates every week, applies on Hard and above, and the boss gives one more item', () => {
  const W = 7 * 86_400_000, t0 = Date.UTC(2026, 10, 19);
  assert.notEqual(weeklyAffix(t0).id, weeklyAffix(t0 + W).id, 'a new affix every week');
  assert.equal(weeklyAffix(t0).id, weeklyAffix(affixEndsAt(t0) - 1).id);
  assert.equal(traitIn('ruins', 'normal', t0), undefined, 'Normal runs are as before');
  assert.equal(traitIn('ruins', 'hard', t0)!.id, weeklyAffix(t0).id);
  assert.equal(traitIn('emberwaste', undefined, t0)!.id, 'embers', 'regions keep their own trait');
  const equips = (diff: string) => {
    const g = gateOf('verdant'), { world, join } = harness({ capacity: 20 }), a = join(g.dx, g.dy, 'knight', 30, -1, 'verdant');
    assert.equal(world.dungeon(a.p, 'enter', 'ruins', diff), '');
    const run = world.dungeons.runs.get(a.p.room)!;
    assert.equal(!!world.traits.traitFor(a.p.room), diff !== 'normal');
    const before = a.p.inv.filter((i) => ITEMS[i.base].kind === 'equip').length;
    for (let s = 0; s < 8; s++) { for (const m of [...run.alive]) world.hurt(m, 1e9, 0, a.p); const now = Date.now(); world.dungeons.tick(now); world.dungeons.tick(now + 3000); }
    return a.p.inv.filter((i) => ITEMS[i.base].kind === 'equip').length - before;
  };
  assert.ok(equips('hard') > equips('normal'), 'one more boss item on Hard');
});

test('G9 social: world chat reaches everyone at its own pace; the dungeon finder forms a group and opens the dungeon; guild goals', () => {
  const { world, join } = harness({ capacity: 20 });
  const a = join(0, 0, 'knight', 20), b = join(0, 0, 'mage', 20, -1, 'verdant');
  world.chat(a.p, 'hello world', 'world');
  assert.ok(b.out.some((m) => m.t === 'chat' && m.ch === 'world' && m.text === 'hello world'), 'world chat reaches another zone');
  world.chat(a.p, 'again', 'world');
  assert.ok(a.out.some((m) => m.t === 'sys' && /again in \d+ seconds/.test(m.text)), 'and has its own pace');
  world.chat(a.p, 'lfg ruins', 'lfg');
  assert.ok(b.out.some((m) => m.t === 'chat' && m.ch === 'lfg'));
  // the finder
  assert.equal(world.finderOp(a.p, { op: 'join', dungeon: 'ruins', diff: 'hard' }), '');
  assert.equal(world.finderOp(b.p, { op: 'join', dungeon: 'ruins', diff: 'hard' }), '');
  assert.ok(b.out.some((m) => m.t === 'finder' && m.counts['ruins:hard'] === 2));
  world.finder.tick(Date.now());
  assert.ok(!a.p.party, 'two players wait a little for more');
  world.finder.tick(Date.now() + FINDER_WAIT_MS + 1);
  assert.ok(a.p.party && a.p.party === b.p.party, 'a party is formed');
  const run = world.dungeons.runs.get(a.p.room);
  assert.ok(run && a.p.room === b.p.room && run.diff === 'hard', 'and the dungeon opens with everyone inside');
  assert.equal(world.finderOp(join(0, 0, 'knight', 3).p, { op: 'join', dungeon: 'ruins', diff: 'normal' }), 'Requires level 10');
  // guild goals
  const g: any = { id: 7, name: 'G', tag: 'GG', emblem: { shape: 0, color: 0, bg: 7 }, leader: a.p.id, level: 1, exp: 0, motd: '', bank: 0, buildings: { barracks: 0, treasury: 0, weaponry: 0, kitchen: 0, fortress: 0 }, members: new Map([[a.p.id, { id: a.p.id, name: a.p.name, job: 'knight', level: 20, rank: 0 }]]), pendingExp: 0, goals: emptyGoals(weekOf(Date.now())) };
  (world.guilds as any).byId.set(7, g);
  (world.guilds as any).of.set(a.p.id, 7);
  const defs = weeklyGoals(7, weekOf(Date.now())), i = defs.findIndex((d) => d.kind === 'quests' || d.kind === 'kills');
  g.goals.p[i] = defs[i].n - 1;
  const gold = a.p.gold, exp = g.exp + g.level * 1e6;
  world.guilds.goal(a.p, defs[i].kind);
  assert.equal(g.goals.p[i], defs[i].n);
  assert.ok(a.p.gold > gold && a.p.inv.some((x) => x.base === 'upgrade_stone'), 'every member online is rewarded');
  assert.ok(g.exp + g.level * 1e6 > exp, 'and the guild grows');
  world.guilds.goal(a.p, defs[i].kind);
  assert.equal(g.goals.p[i], defs[i].n, 'a goal completes once');
});

test('M7 dungeon run: waves, elite, boss with phases, completion rewards, closing, and immediate re-entry', () => {
  const g = gateOf('verdant');
  const { world, join, step } = harness({ capacity: 20 });
  const a = join(g.dx, g.dy, 'knight', 12, -1, 'verdant'), b = join(g.dx + 30, g.dy, 'mage', 12, -1, 'verdant');
  group(world, a.p, b.p);
  assert.equal(world.dungeon(a.p, 'enter', 'ruins', 'normal'), '');
  assert.equal(world.dungeon(b.p, 'ready', undefined, true), '');
  const room = a.p.room, run = world.dungeons.runs.get(room)!;
  let now = Date.now();
  const clear = () => {
    for (const m of [...run.alive]) world.hurt(m, 1e9, 0, a.p);
  };
  const def = DUNGEONS.ruins;
  for (let s = 0; s < 3; s++) {
    assert.equal(run.stage, s);
    const c = CHAMBERS[def.stages[s].room];
    for (const m of run.alive) assert.ok(Math.hypot(m.x - tileCenter(c.cx), m.y - tileCenter(c.cy)) < 8 * TILE, 'the stage spawns in its chamber');
    if (s === 2) assert.ok([...run.alive].some((m) => m.def.elite && !m.def.boss), 'the third stage has an elite guard');
    clear();
    assert.equal(run.alive.size, 0);
    world.dungeons.tick((now = Date.now()));
    assert.equal(run.stage, s, 'a short pause before the next stage');
    world.dungeons.tick(now + 3000);
    assert.equal(run.stage, s + 1);
  }
  assert.ok(annOf(a.out).some((t) => /The way to Ancient Rune Guardian is open/.test(t)));
  const boss = [...run.alive][0];
  assert.equal(run.alive.size, 1);
  assert.equal(boss.def.id, 'rune_guardian');
  assert.equal(boss.maxHp, Math.round(boss.def.hp * partyHpScale(2)));
  // a death inside respawns inside
  world.hurt(b.p, 1e9, 0, null);
  step(Math.ceil(RESPAWN_AUTO_MS / TICK_MS) + 2);
  assert.ok(!b.p.dead && b.p.room === room, 'respawn at the dungeon entrance hall');
  const gold0 = a.p.gold;
  world.hurt(boss, boss.maxHp * 0.5, 0, a.p);
  assert.equal(boss.phase, 1);
  world.hurt(boss, 1e9, 0, a.p);
  assert.equal(run.state, 'cleared');
  for (const x of [a, b]) {
    const loots = lootOf(x.out);
    assert.ok(loots.flatMap((l: any) => l.items).some((i: any) => i.rar >= 3), `${x.p.name} received a boss item`);
    assert.ok(loots.some((l: any) => l.gold === 40 * def.level), 'completion gold');
    assert.ok(x.p.inv.some((i) => i.base === 'upgrade_stone'));
  }
  assert.ok(a.p.gold >= gold0 + 40 * def.level + 60 * boss.level);
  assert.ok(annOf(a.out).some((t) => /Ancient Ruins cleared in \d+:\d\d/.test(t)));
  world.dungeons.tick((now = run.clearedAt + 1000));
  const st = a.out.filter((m) => m.t === 'dng').at(-1).run;
  assert.equal(st.state, 'cleared');
  assert.ok(st.closeIn > 40 && st.closeIn <= 45);
  // closing: everyone is returned to the gate and the instance is discarded
  world.dungeons.tick(run.clearedAt + DUNGEON_CLOSE_MS + 10);
  assert.equal(a.p.room.zoneId, 'verdant');
  assert.equal(b.p.room.zoneId, 'verdant');
  world.dungeons.tick(run.clearedAt + DUNGEON_CLOSE_MS + 20);
  assert.equal(world.dungeons.runs.size, 0);
  assert.equal(world.metrics().rooms, 1, 'only the open zone is left');
  // no lockout, no entry cost: straight back in, fresh instance
  assert.equal(world.dungeon(a.p, 'enter', 'ruins', 'nightmare'), '');
  world.dungeon(b.p, 'ready', undefined, true);
  const run2 = world.dungeons.runs.get(a.p.room)!;
  assert.notEqual(run2, run);
  assert.equal(run2.stage, 0);
  assert.equal(run2.alive.size, 9);
  // logging out inside stores the entrance outside; an empty instance resets
  world.disconnect(a.p, a.conn);
  world.disconnect(b.p, b.conn);
  step(2);
  (world as any).housekeep(Date.now() + 1000);
  assert.equal(world.online.has(a.p.id), false);
  world.dungeons.tick(Date.now());
  world.dungeons.tick(Date.now() + DUNGEON_EMPTY_MS + 2000);
  assert.equal(world.dungeons.runs.size, 0, 'an abandoned instance is discarded');
});

test('M7 logging out inside a dungeon saves the entrance, not the instance', async () => {
  const g = gateOf('verdant');
  const { world, join, step, saved } = harness();
  const a = join(g.dx, g.dy, 'knight', 12, -1, 'verdant');
  const [x, y] = [a.p.x, a.p.y];
  world.dungeon(a.p, 'enter', 'ruins', 'normal');
  world.disconnect(a.p, a.conn);
  step(2);
  (world as any).housekeep(Date.now() + 1000);
  await new Promise((r) => setTimeout(r, 5));
  const row = saved.at(-1);
  assert.deepEqual([row.zone, row.x, row.y], ['verdant', x, y]);
  // a stored dungeon zone (should never happen) falls back to the starting town
  const p = world.join({ ...a.row, id: 77, zone_id: 'd_ruins', pos_x: 300, pos_y: 600, equipment: { kit: true } }, { send() {}, close() {} });
  assert.equal(p.room.zoneId, 'eldoria');
});

test('M7 party loot modes: personal, round robin and by contribution; only the leader may change it', () => {
  // rng 0.01: every roll drops equipment, a potion and a stone
  const mk = () => {
    const h = harness({ capacity: 20, rng: () => 0.01 });
    const a = h.join(0, 0, 'knight', 3), b = h.join(30, 0, 'mage', 3), c = h.join(60, 0, 'cleric', 3);
    group(h.world, a.p, b.p, c.p);
    const kill = (dmgA = 0.5, dmgB = 0.5) => {
      const m = h.world.spawn(a.p.room, 'boar', a.p.x + 30, a.p.y);
      h.world.hurt(m, Math.floor(m.maxHp * dmgA), 0, a.p);
      h.world.hurt(m, m.maxHp * dmgB + 5, 0, b.p);
    };
    return { ...h, a, b, c, kill };
  };
  const equips = (x: any) => x.p.inv.filter((i: Item) => ITEMS[i.base].kind === 'equip').length;
  {
    const t = mk();
    assert.equal(t.world.party(t.b.p, 'loot', 'roundrobin', undefined), 'Only the party leader can do that');
    assert.equal(t.world.party(t.a.p, 'loot', 'everything-to-me', undefined), 'Unknown loot mode');
    assert.equal(partyOf(t.a.out).loot, 'personal');
    t.kill();
    assert.deepEqual([t.a, t.b, t.c].map(equips), [1, 1, 1], 'personal: everyone rolls their own');
  }
  {
    const t = mk();
    assert.equal(t.world.party(t.a.p, 'loot', 'roundrobin', undefined), '');
    assert.equal(partyOf(t.c.out).loot, 'roundrobin');
    assert.ok(sysOf(t.b.out).some((s) => /Round robin/.test(s)));
    t.kill();
    assert.deepEqual([t.a, t.b, t.c].map(equips), [1, 1, 1], 'three drops, one each in turn');
    assert.ok(t.a.p.gold === t.b.p.gold && t.b.p.gold === t.c.p.gold && t.a.p.gold > 0, 'gold is split equally');
    // the turn carries over between kills: with one drop per kill, it still rotates
    const h = harness({ capacity: 20, rng: (() => { let i = 0; const seq = [0.5, 0.01, 0.5, 0.5, 0.5, 0.9, 0.9, 0.5, 0.9, 0.9, 0.5, 0.9, 0.9]; return () => seq[i++ % seq.length]; })() });
    void h;
  }
  {
    const t = mk();
    t.world.party(t.a.p, 'loot', 'contribution', undefined);
    // rng 0.01 always lands in the first weight bucket: the member with the most damage first in order
    t.kill(0.9, 0.1);
    assert.equal(equips(t.a) + equips(t.b) + equips(t.c), 3, 'the same number of drops as personal loot');
    assert.equal(equips(t.a), 3, 'with this roll everything goes to the top damage dealer');
    assert.ok(t.a.p.gold === t.c.p.gold, 'gold is still split equally');
  }
  {
    // contribution weights: a real random stream, many kills -> shares follow damage, supports are not shut out
    let s = 5;
    const h = harness({ capacity: 20, rng: () => ((s = (s * 16807) % 2147483647), s / 2147483647), world: { dropRate: 7 } });
    const a = h.join(0, 0, 'knight', 3), b = h.join(30, 0, 'mage', 3), c = h.join(60, 0, 'cleric', 3);
    group(h.world, a.p, b.p, c.p);
    h.world.party(a.p, 'loot', 'contribution', undefined);
    const got = [0, 0, 0];
    for (let i = 0; i < 400; i++) {
      const m = h.world.spawn(a.p.room, 'mossling', a.p.x + 30, a.p.y);
      for (const x of [a, b, c]) { x.p.inv.length = 0; x.out.length = 0; }
      m.dmgBy.set(a.p.id, 70); m.dmgBy.set(b.p.id, 30);
      h.world.hurt(m, 1e9, 0, null);
      [a, b, c].forEach((x, k) => (got[k] += lootOf(x.out).flatMap((l: any) => l.items).filter((it: any) => ITEMS[it.base].kind === 'equip').length));
    }
    const total = got[0] + got[1] + got[2];
    assert.ok(total > 800, `${total} drops`);
    assert.ok(got[0] > got[1] && got[1] > got[2] && got[2] > total * 0.03, `shares ${got}`);
    assert.ok(Math.abs(got[0] / total - 78.33 / 125) < 0.06, `top share ${got[0] / total}`);
  }
});

// ================= M8: world, NPCs, travel, resources, lore and the asset pipeline =================
const discOf = (o: any[]) => o.filter((m) => m.t === 'disc').at(-1)?.list as string[] | undefined;
const objAt = (zone: string, kind: string, n = 0) => zoneObjects(zone).filter((o) => o.kind === kind)[n];
const offset = (zone: string, o: { x: number; y: number }) => [o.x - tileCenter(ZONES[zone].spawn.tx), o.y - tileCenter(ZONES[zone].spawn.ty)] as [number, number];

test('M8 regions: six themed regions with towns, ecosystems, an elite each, and level bands that connect', () => {
  const themes = new Set(REGIONS.map((z) => ZONES[z].theme));
  assert.equal(themes.size, 6, 'every region has its own look');
  for (const z of REGIONS) {
    const def = ZONES[z], groups = SPAWNS[z];
    assert.ok(def.town && def.blurb.length > 20 && LORE[z].pages.length >= 3, `${z} town and lore`);
    const types = new Set(groups.map((g) => g.type));
    assert.ok(types.size >= 4, `${z}: at least four kinds of monster`);
    assert.equal(groups.filter((g) => MONSTERS[g.type].elite && !MONSTERS[g.type].boss).length, 1, `${z}: one roaming elite`);
    for (const t of types) {
      const lv = MONSTERS[t].level;
      assert.ok(lv >= def.level[0] && lv <= def.level[1], `${z}/${t}: level ${lv} inside ${def.level}`);
    }
    // behaviours differ inside a region: melee, ranged or flying, and an area attack
    const pats = [...types].map((t) => MONSTERS[t]);
    assert.ok(pats.some((d) => d.pattern.some((a) => a.ranged) || d.flying), `${z} has a ranged or flying monster`);
    assert.ok(pats.some((d) => d.pattern.some((a) => a.aoe)), `${z} has an area attack`);
    assert.ok(pats.some((d) => d.pattern.some((a) => a.charge) || d.pack), `${z} has a charger or a pack hunter`);
  }
  for (let i = 1; i < REGIONS.length; i++) assert.ok(ZONES[REGIONS[i]].level[0] <= ZONES[REGIONS[i - 1]].level[1], 'level bands overlap so there is no gap to grind across');
  assert.equal(FACTIONS.length, 6);
  for (const f of FACTIONS) assert.ok(REGIONS.some((z) => f.seat.includes(ZONES[z].town!.name)), `${f.name} has a seat in the world`);
  // every monster in every new region can actually be placed
  const w = new World(new Proxy({} as any, { get: () => async () => {} }), { roomCapacity: 5, reconnectGraceMs: 0, autosaveMs: 1e9, rng: mulberryTest(11) });
  for (const z of REGIONS) {
    const room = w.roomIn(z);
    const want = SPAWNS[z].reduce((n, g) => n + g.count, 0) + WORLD_BOSSES.filter((b) => b.zone === z).length;
    assert.equal(room.monsters.size, want, `${z}: all ${want} monsters placed`);
    for (const m of room.monsters.values()) {
      assert.equal(blocked(room.map, m.x, m.y), false);
      if (!m.def.boss) for (const o of zoneObjects(z).filter(isNpc)) assert.ok(Math.hypot(o.x - m.x, o.y - m.y) > 5 * TILE, `${z}: ${m.def.id} spawns away from the town`);
    }
  }
});
function mulberryTest(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('M8 places: every town has a merchant, a waystone keeper and a lorekeeper; nodes and caches are reachable and deterministic', () => {
  const ids = new Set<string>();
  for (const z of REGIONS) {
    const objs = zoneObjects(z), map = getZoneMap(z);
    assert.equal(zoneObjects(z), objs, 'computed once');
    assert.deepEqual(objs.filter(isNpc).map((o) => o.kind).sort(), [...(z === 'eldoria' ? ['arenamaster'] : []), 'banker', 'lorekeeper', 'merchant', ...(z === 'eldoria' ? ['raidherald', 'riftwarden'] : []), 'runesmith', ...(z === 'eldoria' ? ['steward'] : []), 'waykeeper']); // the Rune Merchant joined in M12, the banker and the Arena Master in M14-M15
    assert.equal(objs.filter((o) => o.kind === 'node').length, 8);
    assert.equal(objs.filter((o) => o.kind === 'cache').length, 2);
    // flood fill from the spawn point
    const seen = new Uint8Array(map.w * map.h), stack = [ZONES[z].spawn.tx + ZONES[z].spawn.ty * map.w];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % map.w, y = (i / map.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = x + dx + (y + dy) * map.w, t = tileAt(map, x + dx, y + dy);
        if (!seen[j] && t !== T.Water && t !== T.Tree && t !== T.Wall && t !== T.Roof && t !== T.Rock) { seen[j] = 1; stack.push(j); }
      }
    }
    for (const o of objs) {
      assert.ok(!ids.has(o.id), `${o.id} unique`);
      ids.add(o.id);
      assert.equal(objById(o.id), o);
      const tx = Math.floor(o.x / TILE), ty = Math.floor(o.y / TILE);
      assert.equal(seen[tx + ty * map.w], 1, `${o.id} can be walked to`);
      if (isNpc(o)) {
        assert.equal(tileAt(map, tx, ty), T.Plaza, `${o.id} stands on the plaza`);
        assert.equal(typeof parseAppearance(o.ap, o.job!), "object", `${o.id} has a valid look: ${parseAppearance(o.ap, o.job!)}`);
        assert.ok(Math.hypot(o.x - tileCenter(ZONES[z].spawn.tx), o.y - tileCenter(ZONES[z].spawn.ty)) > 40, 'not on the spawn point');
      }
      if (o.kind === 'node') assert.ok(REGION_RES[z].includes(o.res!) && ITEMS[o.res!].kind === 'material');
      if (o.kind === 'cache') {
        // hidden: no road or plaza within two tiles, and far from town
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.ok(![T.Path, T.Plaza].includes(tileAt(map, tx + dx, ty + dy)), `${o.id} is out of sight of the road`);
        assert.ok(Math.hypot(tx - ZONES[z].town!.tx, ty - ZONES[z].town!.ty) >= 18);
      }
    }
    assert.ok(new Set(objs.filter((o) => o.kind === 'node').map((o) => o.res)).size === 2, `${z}: two kinds of resource`);
  }
  assert.equal(allDiscoveries().length, REGIONS.length * 3, 'a waystone and two caches per region');
  for (const z of Object.keys(ZONES)) if (ZONES[z].kind === 'dungeon') assert.equal(zoneObjects(z).length, 0);
  for (const r of RECIPES) assert.ok(ITEMS[r.out[0]] && r.needs.every(([b]) => ITEMS[b].kind === 'material'));
});

test('M8 gathering: range and cooldown per node, shared by the channel, respawning; no energy or daily limit', () => {
  const node = objAt('eldoria', 'node'), [dx, dy] = offset('eldoria', node);
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(dx + 5, dy, 'knight', 3), b = join(dx - 5, dy, 'mage', 3), far = join(0, 0, 'mage', 3);
  assert.equal(world.object(far.p, { op: 'gather', id: node.id }), 'Too far away');
  assert.equal(world.object(a.p, { op: 'gather', id: 'node:eldoria:99' }), 'Nothing to gather');
  assert.equal(world.object(a.p, { op: 'gather', id: objAt('verdant', 'node').id }), 'Nothing to gather', 'a node in another zone');
  assert.equal(world.object(a.p, { op: 'gather', id: objAt('eldoria', 'cache').id }), 'Nothing to gather');
  assert.equal(world.object(a.p, { op: 'gather', id: node.id }), '');
  assert.deepEqual(a.p.inv.map((i) => [i.base, i.qty]), [[node.res, 1]]);
  assert.deepEqual(lootOf(a.out).at(-1).items, [{ base: node.res, rar: 0, qty: 1 }]);
  assert.deepEqual(b.out.filter((m) => m.t === 'nodes').at(-1).cd, [[node.id, NODE_RESPAWN_MS]], 'everyone in the channel sees the node is spent');
  assert.equal(world.object(b.p, { op: 'gather', id: node.id }), 'Nothing left to gather here yet');
  // a player who arrives later is told which nodes are spent
  const late = join(dx, dy + 5, 'ranger', 3);
  assert.equal(late.out.filter((m) => m.t === 'nodes').at(-1).cd[0][0], node.id);
  step(NODE_RESPAWN_MS / TICK_MS - 1);
  assert.equal(world.object(b.p, { op: 'gather', id: node.id }), 'Nothing left to gather here yet');
  step(1);
  assert.equal(world.object(b.p, { op: 'gather', id: node.id }), '');
  // unlimited: other nodes can be gathered straight away, again and again
  const n2 = objAt('eldoria', 'node', 1);
  a.p.x = n2.x; a.p.y = n2.y;
  for (let i = 0; i < 5; i++) {
    assert.equal(world.object(a.p, { op: 'gather', id: n2.id }), '');
    step(NODE_RESPAWN_MS / TICK_MS);
  }
  assert.ok(a.p.inv.reduce((n, i) => n + i.qty, 0) >= 6);
  world.hurt(a.p, 1e9, 0, null);
  assert.equal(world.object(a.p, { op: 'gather', id: n2.id }), 'You are dead');
  assert.equal(world.object(b.p, null), 'Unknown command');
  assert.equal(world.object(b.p, { op: 'conjure' }), 'Unknown command');
});

test('M8 hidden caches: found once per character, rewarded, remembered and persisted', async () => {
  const c = objAt('ashen', 'cache'), [dx, dy] = offset('ashen', c);
  const { world, join, step, discs } = harness({ capacity: 10 });
  const a = join(dx + 5, dy, 'ranger', 12, -1, 'ashen'), b = join(dx - 5, dy, 'mage', 12, -1, 'ashen'), far = join(0, 0, 'mage', 12, -1, 'ashen');
  assert.equal(world.object(far.p, { op: 'open', id: c.id }), 'Too far away');
  assert.equal(world.object(a.p, { op: 'open', id: objAt('ashen', 'node').id }), 'Nothing to open');
  assert.equal(world.object(a.p, { op: 'open', id: c.id }), '');
  const loot = lootOf(a.out).at(-1);
  assert.equal(loot.gold, 50 + 80 * ZONES.ashen.level[0]);
  const item = a.p.inv.find((i) => ITEMS[i.base].kind === 'equip')!;
  assert.ok(item.rar >= 2 && item.ilvl === ZONES.ashen.level[1] && equipBlock(item, 'ranger', 60) === '', 'a Rare-or-better item for the finder');
  assert.ok(sysOf(a.out).some((t) => /hidden cache/.test(t)));
  assert.ok(discOf(a.out)!.includes(c.id));
  assert.equal(world.object(a.p, { op: 'open', id: c.id }), 'You have already emptied this cache');
  assert.equal(world.object(b.p, { op: 'open', id: c.id }), '', 'each character can find it once');
  // saved, and restored on the next login; unknown ids in storage are dropped
  world.disconnect(a.p, a.conn);
  step(2);
  (world as any).housekeep(Date.now() + 1000);
  await new Promise((r) => setTimeout(r, 5));
  const saved = discs.filter((d) => d.id === a.p.id).at(-1).list;
  assert.deepEqual(saved.sort(), [c.id, 'wp:eldoria'].sort());
  const again = world.join({ ...a.row, discoveries: [...saved, 'cache:nowhere:9', 42, 'wp:moon'] } as any, a.conn);
  assert.deepEqual([...again.disc].sort(), [c.id, 'wp:eldoria'].sort());
  again.x = c.x; again.y = c.y;
  assert.equal(world.object(again, { op: 'open', id: c.id }), 'You have already emptied this cache');
});

test('M8 waystones: attune by visiting, then travel between towns for a fee; refused when unknown, poor, away or fighting', () => {
  const keeper = (z: string) => objAt(z, 'waykeeper');
  const { world, join, step } = harness({ capacity: 10 });
  const [ex, ey] = offset('eldoria', keeper('eldoria'));
  const a = join(ex, ey + 40, 'knight', 20), away = join(ex + 600, ey, 'knight', 20);
  assert.deepEqual(a.out.find((m) => m.t === 'welcome').disc, ['wp:eldoria'], 'the capital is known from the start');
  a.p.gold = 1000;
  assert.equal(world.object(a.p, { op: 'tp', to: 'verdant' }), 'You have not attuned to that waystone yet');
  assert.equal(world.object(a.p, { op: 'tp', to: 'eldoria' }), 'You are already here');
  assert.equal(world.object(a.p, { op: 'tp', to: 'd_ruins' }), 'Unknown destination');
  assert.equal(world.object(a.p, { op: 'tp', to: 'atlantis' }), 'Unknown destination');
  // walk (here: be placed) next to Mosswatch's keeper: the waystone attunes within a second
  const kv = keeper('verdant');
  world.relocate(a.p, world.roomIn('verdant', a.p), kv.x + WAYSTONE_RANGE + 60, kv.y);
  (world as any).housekeep(Date.now());
  assert.ok(!a.p.disc.has('wp:verdant'), 'not from a distance');
  a.p.x = kv.x + 100;
  (world as any).housekeep(Date.now() + 1000);
  assert.ok(a.p.disc.has('wp:verdant'));
  assert.ok(sysOf(a.out).some((t) => /Waystone attuned: Mosswatch/.test(t)));
  assert.deepEqual(discOf(a.out)!.sort(), ['wp:eldoria', 'wp:verdant']);
  // travel back and forth
  a.p.x = kv.x; a.p.y = kv.y + 30;
  assert.equal(world.object(a.p, { op: 'tp', to: 'eldoria' }), '');
  assert.equal(a.p.room.zoneId, 'eldoria');
  assert.equal(a.p.gold, 1000 - teleportCost('eldoria'));
  assert.ok(Math.hypot(a.p.x - keeper('eldoria').x, a.p.y - keeper('eldoria').y) < 60, 'arrives beside the waystone keeper');
  assert.equal(blocked(a.p.room.map, a.p.x, a.p.y), false);
  assert.equal(a.out.filter((m) => m.t === 'welcome').at(-1).zone, 'eldoria');
  assert.equal(world.object(a.p, { op: 'tp', to: 'verdant' }), '');
  assert.equal(a.p.gold, 1000 - teleportCost('eldoria') - teleportCost('verdant'));
  assert.ok(teleportCost('astral') > teleportCost('verdant'), 'farther regions cost more');
  // refusals
  away.p.disc.add('wp:verdant');
  away.p.gold = 1000;
  assert.equal(world.object(away.p, { op: 'tp', to: 'verdant' }), 'You need to be at a waystone');
  a.p.gold = 1;
  assert.equal(world.object(a.p, { op: 'tp', to: 'eldoria' }), 'Not enough gold');
  a.p.gold = 100;
  const m = world.spawn(a.p.room, 'spider', a.p.x + 30, a.p.y);
  world.hurt(a.p, 1, 0, m);
  assert.equal(world.object(a.p, { op: 'tp', to: 'eldoria' }), 'Cannot travel in combat');
  a.p.room.monsters.delete(m.id);
  step(Math.ceil(COMBAT_TIMEOUT_MS / TICK_MS) + 2);
  assert.equal(world.object(a.p, { op: 'tp', to: 'eldoria' }), '');
  assert.equal(a.p.gold, 100 - teleportCost('eldoria'));
});

test('M8 merchants: trade and crafting work at every town merchant and nowhere else', () => {
  const { world, join } = harness({ capacity: 10 });
  for (const z of REGIONS) {
    const mer = objAt(z, 'merchant'), [dx, dy] = offset(z, mer);
    const p = join(dx, dy + 30, 'knight', 5, -1, z).p;
    p.gold = 100;
    assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion' }), '', `${z}: the merchant sells`);
    p.x += SHOP_RANGE + 80;
    assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion' }), 'You need to be at a shop');
  }
  const mer = objAt('eldoria', 'merchant'), [dx, dy] = offset('eldoria', mer);
  const { p } = join(dx, dy + 30, 'knight', 5);
  give(p, spec('iron_ore', { qty: 9 }));
  give(p, spec('moonleaf', { qty: 5 }));
  assert.equal(world.object(p, { op: 'craft', recipe: 'stone' }), 'Not enough gold');
  p.gold = 100;
  assert.equal(world.object(p, { op: 'craft', recipe: 'stone' }), '');
  assert.equal(world.object(p, { op: 'craft', recipe: 'stone' }), '');
  assert.equal(world.object(p, { op: 'craft', recipe: 'stone' }), 'Requires 4 Iron Ore');
  assert.deepEqual([p.gold, p.inv.find((i) => i.base === 'iron_ore')!.qty, p.inv.find((i) => i.base === 'upgrade_stone')!.qty], [40, 1, 2]);
  assert.equal(world.object(p, { op: 'craft', recipe: 'hp' }), '');
  assert.equal(world.object(p, { op: 'craft', recipe: 'mana' }), 'Requires 1 Star Shard');
  assert.equal(world.object(p, { op: 'craft', recipe: 'philosophers_stone' }), 'Unknown recipe');
  assert.equal(p.inv.find((i) => i.base === 'moonleaf')!.qty, 2);
  p.x += SHOP_RANGE + 80;
  assert.equal(world.object(p, { op: 'craft', recipe: 'hp' }), 'You need to be at a merchant');
  // materials can be sold, and crafting is never cheaper than it is worth selling the inputs
  for (const r of RECIPES) {
    const inputs = r.needs.reduce((n, [b, q]) => n + sellValue(spec(b)) * q, 0) + r.gold;
    assert.ok(sellValue(spec(r.out[0])) * r.out[1] <= inputs, `${r.id}: no profit from craft-and-sell`);
  }
});

test('M8 asset pipeline: the PNG codec round-trips and every built-in sheet passes validation', () => {
  const img = { w: 5, h: 3, data: new Uint8Array(60).map((_, i) => (i * 37) & 255) };
  const back = decodePng(encodePng(img));
  assert.deepEqual([back.w, back.h, [...back.data]], [5, 3, [...img.data]]);
  assert.throws(() => decodePng(Buffer.from('not a png at all, just text padding here')), /not a PNG/);
  const { findings, entries, ok } = validateDir('assets/templates');
  assert.ok(entries.length >= 80, `${entries.length} template sheets`);
  assert.deepEqual(findings.filter((f) => f.level === 'error'), [], 'the built-in art meets its own import rules');
  assert.equal(ok.length, entries.length);
  // monsters of the later regions are drawn from another monster's art, recoloured: no template of their own
  assert.equal(entries.filter((e) => e.type === 'monster').length, Object.keys(MONSTERS).filter((id) => !id.startsWith('t_')).length, 'a template for every monster (the recoloured ones too)');
});

test('M8 asset validation: each rule rejects the fault it exists for', () => {
  const read = (f: string) => decodePng(fs.readFileSync(`assets/templates/${f}`));
  const clone = (i: Image): Image => ({ w: i.w, h: i.h, data: new Uint8Array(i.data) });
  const rules = (e: SheetEntry, i: Image) => validateSheet(e, i).filter((f) => f.level === 'error').map((f) => f.rule);
  const wolf: SheetEntry = { type: 'monster', id: 'wolf', file: 'monsters/wolf.png', scale: 1 }, base = read(wolf.file);
  assert.deepEqual(rules(wolf, base), []);
  const F = 48, copyFrame = (i: Image, sc: number, sr: number, dc: number, dr: number) => {
    for (let y = 0; y < F; y++) i.data.set(i.data.subarray(((sr * F + y) * i.w + sc * F) * 4, ((sr * F + y) * i.w + sc * F + F) * 4), ((dr * F + y) * i.w + dc * F) * 4);
  };
  // naming
  assert.deepEqual(rules({ ...wolf, file: 'monsters/Wolf.png' }, base), ['naming', 'naming'], 'capital letters and a file name that differs from the id');
  assert.deepEqual(rules({ ...wolf, file: 'creatures/wolf.png' }, base), ['naming'], 'wrong folder');
  assert.deepEqual(rules({ type: 'monster', id: 'unicorn', file: 'monsters/unicorn.png' }, base), ['naming'], 'not a monster in the game');
  assert.deepEqual(rules({ ...wolf, file: 'monsters/wolf.jpg' }, base).includes('naming'), true);
  // dimensions
  assert.deepEqual(rules({ ...wolf, scale: 1.5 }, base), ['dimensions'], 'the size must match the declared scale');
  assert.deepEqual(rules(wolf, { w: 100, h: 100, data: new Uint8Array(40000) }), ['dimensions']);
  // transparency
  const solid = clone(base);
  for (let i = 0; i < solid.data.length; i += 4) if (!solid.data[i + 3]) solid.data.set([255, 0, 255, 255], i);
  assert.ok(rules(wolf, solid).includes('transparency'), 'a flat background colour is rejected');
  const soft = clone(base);
  for (let i = 3; i < soft.data.length / 2; i += 4) if (soft.data[i] === 255 && i % 3 === 0) soft.data[i] = 128;
  assert.ok(rules(wolf, soft).includes('transparency'), 'anti-aliased edges are rejected');
  // frames
  const empty = clone(base);
  for (let y = 0; y < F; y++) empty.data.fill(0, (y * empty.w + 3 * F) * 4, (y * empty.w + 4 * F) * 4);
  assert.deepEqual(rules(wolf, empty), ['frames']);
  const still = clone(base);
  for (const c of [6, 7, 8]) copyFrame(still, 0, 0, c, 0);
  assert.deepEqual(rules(wolf, still), ['frames', 'frames'], 'an attack that never moves: same as idle, and all frames equal');
  // direction
  const oneWay = clone(base);
  for (let c = 0; c < 13; c++) copyFrame(oneWay, c, 0, c, 1);
  assert.deepEqual(rules(wolf, oneWay), ['direction']);
  // alignment: the sprite floats eight pixels above the ground line
  const floaty = clone(base);
  floaty.data.copyWithin(0, 12 * floaty.w * 4);
  floaty.data.fill(0, floaty.data.length - 12 * floaty.w * 4);
  assert.ok(rules(wolf, floaty).includes('alignment'));
  // character layers must stand on the shared feet line and share the body's grid
  const body: SheetEntry = { type: 'character', layer: 'body', item: 'knight_default', file: 'body/knight_default.png' }, b = read(body.file);
  assert.deepEqual(rules(body, b), []);
  const raised = clone(b);
  raised.data.copyWithin(0, 5 * raised.w * 4);
  assert.ok(rules(body, raised).includes('alignment'), 'feet off the shared baseline');
  const shifted = clone(b);
  shifted.data.copyWithin(9 * 4, 0);
  assert.ok(rules(body, shifted).includes('alignment'), 'body off-centre');
  assert.deepEqual(rules({ ...body, layer: 'boots' as any, file: 'boots/knight_default.png' }, b), ['naming']);
  assert.deepEqual(rules({ ...body, item: 'paladin', file: 'body/knight_default.png' }, b), ['naming']);
  const hair: SheetEntry = { type: 'character', layer: 'hair', item: 'knight_default', file: 'hair/knight_default.png' }, h = read(hair.file);
  const stray = clone(h);
  stray.data.copyWithin(14 * 4, 0);
  assert.ok(rules(hair, stray).includes('alignment'), 'a layer that does not line up with the body');
  // props
  const prop: SheetEntry = { type: 'prop', id: 'cache', file: 'props/cache.png' };
  assert.deepEqual(rules(prop, read(prop.file)), []);
  assert.deepEqual(rules(prop, { w: 32, h: 32, data: new Uint8Array(4096) }), ['frames'], 'an empty prop');
  assert.deepEqual(rules({ ...prop, id: 'sofa', file: 'props/sofa.png' }, read(prop.file)), ['naming']);
});

test('M8 asset import: only sheets that pass are copied into the build; manifest problems are reported', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeth-assets-')), src = path.join(tmp, 'game'), out = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(src, 'monsters'), { recursive: true });
  fs.mkdirSync(path.join(src, 'props'), { recursive: true });
  fs.copyFileSync('assets/templates/monsters/wolf.png', path.join(src, 'monsters/wolf.png'));
  fs.copyFileSync('assets/templates/props/cache.png', path.join(src, 'props/cache.png'));
  fs.copyFileSync('assets/templates/props/cache.png', path.join(src, 'props/unlisted.png'));
  fs.writeFileSync(path.join(src, 'monsters/boar.png'), 'this is not an image');
  // a boar sheet with the wrong size
  fs.writeFileSync(path.join(src, 'monsters/spider.png'), encodePng({ w: 64, h: 64, data: new Uint8Array(64 * 64 * 4) }));
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: 1, sheets: [
    { type: 'monster', id: 'wolf', file: 'monsters/wolf.png', scale: 1 }, { type: 'prop', id: 'cache', file: 'props/cache.png' },
    { type: 'monster', id: 'boar', file: 'monsters/boar.png' }, { type: 'monster', id: 'spider', file: 'monsters/spider.png' },
    { type: 'monster', id: 'wolf', file: 'monsters/wolf.png' }, { type: 'prop', id: 'cache_open', file: '../../etc/passwd' },
    { type: 'monster', id: 'mossling', file: 'monsters/missing.png' }, { type: 'tileset', file: 'x.png' }, null,
  ] }));
  const { findings, ok } = validateDir(src);
  assert.deepEqual(ok.map((e) => e.file), ['monsters/wolf.png', 'props/cache.png']);
  const by = (file: string) => findings.filter((f) => f.file === file).map((f) => `${f.level}:${f.rule}`);
  assert.deepEqual(by('monsters/boar.png'), ['error:format']);
  assert.deepEqual(by('monsters/spider.png'), ['error:dimensions']);
  assert.deepEqual(by('../../etc/passwd'), ['error:manifest'], 'paths may not leave the asset folder');
  assert.deepEqual(by('monsters/missing.png'), ['error:manifest']);
  assert.deepEqual(by('props/unlisted.png'), ['warning:manifest']);
  assert.ok(by('monsters/wolf.png').includes('error:manifest'), 'duplicates are reported');
  assert.equal(findings.filter((f) => f.rule === 'manifest' && f.level === 'error').length, 5);
  // the import step
  const r = spawnSync('node_modules/.bin/tsx', ['scripts/import-assets.ts', src, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /imported 2 of 9 sheets/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).sheets.map((e: any) => e.file), ['monsters/wolf.png', 'props/cache.png']);
  assert.ok(fs.existsSync(path.join(out, 'monsters/wolf.png')) && !fs.existsSync(path.join(out, 'monsters/boar.png')) && !fs.existsSync(path.join(out, 'props/unlisted.png')));
  assert.equal(validateDir(path.join(tmp, 'nothing')).findings[0].rule, 'manifest');
  fs.writeFileSync(path.join(src, 'manifest.json'), '{ broken');
  assert.match(validateDir(src).findings[0].msg, /not valid JSON/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ================= M9: replication cost control =================
test('M9 replication: on-screen entities update every tick; off-screen ones at a quarter rate, without damage numbers, and stay exact', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, -64), near = join(300, -64, 'mage', 5), off = join(690, -64, 'mage', 5);
  assert.ok(Math.abs(off.p.x - a.p.x) > 680 && Math.abs(off.p.x - a.p.x) < 800, 'inside the interest area, outside any screen');
  step(2);
  a.out.length = 0;
  let seq = 0;
  for (let t = 0; t < 40; t++) {
    const dir = t < 20 ? 1 : -1; // both walk east then back west, one step per tick
    seq++;
    world.input(near.p, seq, dir, 0, 0);
    world.input(off.p, seq, dir, 0, 0);
    step(1);
  }
  const moves = (id: number) => snaps(a.out).flatMap((m) => m.mv ?? []).filter((m: any) => m[0] === id);
  assert.equal(moves(near.p.id).length, 40, 'an entity on screen is sent every tick');
  const far = moves(off.p.id).length;
  assert.ok(far >= 9 && far <= 11, `an entity off screen is sent every fourth tick (${far} of 40)`);
  // once it stops, the last position sent is the true one
  step(5);
  const last = moves(off.p.id).at(-1);
  assert.deepEqual([last[1], last[2]], [off.p.x, off.p.y]);
  // vitals are always replicated (party frames, targets); floating damage numbers only when visible
  a.out.length = 0;
  world.hurt(off.p, 7, 0, null);
  world.hurt(near.p, 7, 0, null);
  step(1);
  const dm = dmOf(a.out), hp = snaps(a.out).flatMap((m) => m.hp ?? []);
  assert.deepEqual(dm.map((d: any) => d[0]), [near.p.id], 'no damage number for the entity that cannot be seen');
  assert.deepEqual(hp.map((h: any) => h[0]).sort(), [near.p.id, off.p.id].sort(), 'health is updated for both');
  // every snapshot is valid JSON with the documented shape (they are assembled by hand for speed)
  for (const m of a.out) assert.ok(m.t && (m.t !== 'snap' || (Number.isInteger(m.k) && typeof m.x === 'number')));
  // walking into view restores the full rate at once
  off.p.x = a.p.x + 500;
  a.out.length = 0;
  for (let t = 0; t < 8; t++) {
    world.input(off.p, ++seq, 1, 0, 0);
    step(1);
  }
  assert.equal(moves(off.p.id).length, 8);
});

// ================= Definition of Done: no energy system =================
test('there is no energy, stamina, fatigue or entry-limit mechanic anywhere in the rules, the protocol or the code', () => {
  // 1. No such field in anything a player has or is sent.
  const banned = /energy|stamina|fatigue|lockout|dailylimit|entriesleft|attemptsleft|keys?$/i;
  const { world, join } = harness({ kit: true });
  const { p, out } = join(0, 0, 'knight', 10);
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (!Array.isArray(v)) keys.add(k);
      walk(x);
    }
  };
  for (const m of out) walk(m);
  walk(p.stats);
  walk(JOB_DEFS);
  walk(DUNGEONS);
  walk(DIFFICULTY);
  for (const k of keys) assert.ok(!banned.test(k), `field "${k}" looks like an energy or entry-limit mechanic`);
  assert.ok(keys.size > 80, 'the walk actually covered the protocol');
  // 2. The only resources are HP and the job resource (mana or rage); neither gates access to content.
  assert.deepEqual([...new Set(Object.values(JOB_DEFS).map((d) => d.resource))].sort(), ['mana', 'rage']);
  // 3. Repeating content is never refused for having done it before: ten dungeon entries in a row.
  const g = gateOf('verdant');
  const h = harness();
  const a = h.join(g.dx, g.dy, 'knight', 12, -1, 'verdant');
  for (let i = 0; i < 10; i++) {
    assert.equal(h.world.dungeon(a.p, 'enter', 'ruins', 'normal'), '', `entry ${i + 1}`);
    assert.equal(h.world.dungeon(a.p, 'leave', undefined, undefined), '');
  }
  // 4. No identifier in the source names such a mechanic (comments stating its absence are fine).
  const files: string[] = [];
  const scan = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) scan(path.join(dir, f.name));
      else if (/\.(ts|tsx)$/.test(f.name)) files.push(path.join(dir, f.name));
    }
  };
  for (const d of ['shared/src', 'server/src', 'client/src']) scan(d);
  assert.ok(files.length > 30);
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')).join('\n');
    const hit = /\b\w*(stamina|energy|fatigue)\w*\b/i.exec(code);
    assert.equal(hit, null, `${f}: identifier "${hit?.[0]}"`);
  }
});

// ---------------------------------------------------------------------------------------------
// M10: audio (rules shared by client and build; assets; server cues)
// ---------------------------------------------------------------------------------------------
import {
  abilitySound, AMB, ambienceFor, AUDIO_BY_ID, AUDIO_DEFS, BGM, busGains, cleanAudioSettings, COMBAT_LINGER_MS, DEFAULT_AUDIO_SETTINGS, dropSound, fadeMs,
  HEARING_RANGE, MENU_INPUT, MUSIC_IDS, MusicDirector, resumes, spatial, STEP_SOUND, surfaceOf, VILLAGE_ENTER_TILES, VILLAGE_LEAVE_TILES, WEAPON_SOUND,
  ZONE_AMBIENCE, ZONE_MUSIC, type MusicInput,
} from '../shared/src/audio';
import { oggInfo, validateAudio, type AudioManifest } from '../scripts/audio/manifest';

const calm: MusicInput = { ...MENU_INPUT, screen: 'world', zone: 'eldoria' };

test('M10 settings: anything is sanitised into valid audio settings; mute and the on/off switches silence the right buses', () => {
  assert.deepEqual(cleanAudioSettings(undefined), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(cleanAudioSettings('nope'), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(cleanAudioSettings({ master: 5, music: -1, sfx: NaN, ambient: '0.3', muteAll: 'yes', musicOn: false, extra: 1 }), { ...DEFAULT_AUDIO_SETTINGS, master: 1, music: 0, musicOn: false });
  assert.equal(cleanAudioSettings({ master: 0.123456 }).master, 0.12, 'stored to two decimals');
  assert.equal('extra' in cleanAudioSettings({ extra: 1 }), false, 'unknown keys are dropped');
  const g = busGains(DEFAULT_AUDIO_SETTINGS);
  assert.ok(g.master > 0 && g.music > 0 && g.sfx > 0 && g.ambient > 0, 'sound is on by default');
  assert.equal(busGains({ ...DEFAULT_AUDIO_SETTINGS, muteAll: true }).master, 0, 'mute all silences the master bus');
  const noMusic = busGains({ ...DEFAULT_AUDIO_SETTINGS, musicOn: false });
  assert.ok(noMusic.music === 0 && noMusic.sfx > 0 && noMusic.ambient > 0 && noMusic.master > 0, 'music off leaves effects alone');
  const noSfx = busGains({ ...DEFAULT_AUDIO_SETTINGS, sfxOn: false });
  assert.ok(noSfx.sfx === 0 && noSfx.ambient === 0 && noSfx.music > 0, 'sound effects off also silences ambience, not music');
  for (const k of ['master', 'music', 'sfx', 'ambient'] as const) {
    assert.equal(busGains({ ...DEFAULT_AUDIO_SETTINGS, [k]: 0 })[k], 0);
    assert.equal(busGains({ ...DEFAULT_AUDIO_SETTINGS, [k]: 1 })[k], 1);
    assert.ok(busGains({ ...DEFAULT_AUDIO_SETTINGS, [k]: 0.5 })[k] < busGains({ ...DEFAULT_AUDIO_SETTINGS, [k]: 0.6 })[k], 'louder slider, louder bus');
  }
});

test('M10 catalogue: the sixteen tracks of the production list, one theme per region, and the asset folders of the specification', () => {
  assert.deepEqual(MUSIC_IDS, Array.from({ length: 16 }, (_, i) => `BGM-${String(i + 1).padStart(3, '0')}`));
  const music = AUDIO_DEFS.filter((d) => d.category === 'music');
  assert.equal(new Set(music.map((d) => d.title)).size, 16, 'every track has its own title');
  assert.ok(music.every((d) => d.location && d.mood), 'every track records its location and mood');
  assert.equal(new Set(AUDIO_DEFS.map((d) => d.id)).size, AUDIO_DEFS.length, 'ids are unique');
  assert.equal(new Set(AUDIO_DEFS.map((d) => d.path)).size, AUDIO_DEFS.length, 'no two sounds share a file');
  assert.deepEqual(Object.keys(ZONE_MUSIC), REGIONS, 'every open-world region has a theme');
  assert.equal(new Set(REGIONS.slice(0, 6).map((z) => ZONE_MUSIC[z])).size, 6, 'no two of the first six regions share a theme');
  for (const e of EXPANSION) assert.ok(REGIONS.slice(0, 6).some((z) => ZONE_MUSIC[z] === ZONE_MUSIC[e.id]), `${e.id} plays the theme of a region of its kind`);
  assert.deepEqual(Object.keys(ZONE_AMBIENCE), REGIONS);
  for (const id of [...Object.values(ZONE_MUSIC), ...Object.values(ZONE_AMBIENCE), ...Object.values(BGM), ...Object.values(AMB)]) assert.ok(AUDIO_BY_ID[id], `${id} is in the catalogue`);
  const dirs = (cat: string) => [...new Set(AUDIO_DEFS.filter((d) => d.category === cat).map((d) => d.path.split('/')[1]))].sort();
  assert.ok(AUDIO_DEFS.every((d) => d.path.startsWith(d.category + '/')));
  assert.deepEqual(dirs('music'), ['boss', 'city', 'combat', 'dungeon', 'events', 'forest', 'menu', 'ruins', 'snow', 'swamp', 'village', 'volcano']);
  assert.deepEqual(dirs('sfx'), ['combat', 'environment', 'items', 'monsters', 'movement', 'rune', 'ui']);
  assert.deepEqual(dirs('ambience'), ['city', 'dungeon', 'forest', 'water', 'weather']);
  // every effect the specification lists by name exists
  for (const id of ['move.step_grass', 'move.step_stone', 'move.step_wood', 'move.step_snow', 'move.step_water', 'move.run',
    'combat.sword_swing', 'combat.sword_impact', 'combat.shield_block', 'combat.greatsword_impact', 'combat.dagger_attack', 'combat.bow_release', 'combat.arrow_impact',
    'combat.staff_attack', 'combat.physical_hit', 'combat.critical_hit', 'combat.monster_hit', 'combat.monster_death', 'combat.player_damage', 'combat.player_death',
    'item.potion', 'item.pickup', 'item.upgrade_ok', 'game.level_up', 'game.quest_accept', 'game.quest_complete', 'item.drop_rare', 'item.drop_legendary', 'item.drop_mythic',
    'game.dungeon_enter', 'game.boss_spawn', 'game.boss_defeat', 'game.world_boss_announce', 'ui.click', 'ui.notify'])
    assert.equal(AUDIO_BY_ID[id]?.category, 'sfx', id);
  // sounds with nothing to trigger them yet say so instead of pretending
  assert.deepEqual(AUDIO_DEFS.filter((d) => d.reserved).map((d) => d.id).sort(), ['BGM-016', 'move.step_wood'], 'quest sounds are triggered since M13');
});

test('M10 sound identity: every rune spell has its own sounds, and every ability, weapon, surface and loot rarity resolves to real ones', () => {
  const spells = ABILITY_LIST.filter((a) => a.kind === 'rune');
  assert.equal(spells.length, 12);
  const used: string[] = [];
  for (const a of spells) {
    const s = abilitySound(a), ids = [s.cast, s.fx, s.impact].filter(Boolean) as string[];
    assert.ok(ids.length >= 1 && s.fx, `${a.id} has a sound`);
    for (const id of ids) {
      assert.equal(AUDIO_BY_ID[id]?.assoc.skill, a.id, `${id} belongs to ${a.id} alone`);
      assert.equal(AUDIO_BY_ID[id].assoc.element, a.el, `${id} is a ${a.el} sound`);
    }
    used.push(...ids);
  }
  assert.equal(new Set(used).size, used.length, 'no two spells share a sound: fire never sounds like water, lightning or healing');
  const fb = abilitySound(ABILITIES.fireball);
  assert.ok(fb.fx === 'rune.fireball_cast' && fb.impact === 'rune.fireball_impact' && fb.impactMs! > 0, 'a fireball is heard leaving and landing');
  assert.ok(abilitySound(ABILITIES.meteor_strike).cast, 'the meteor is heard falling during its cast');
  for (const a of ABILITY_LIST) {
    const s = abilitySound(a);
    assert.ok(s.weapon || s.fx, `${a.id} makes a sound`);
    for (const id of [s.cast, s.fx, s.impact]) if (id) assert.ok(AUDIO_BY_ID[id], `${a.id} -> ${id}`);
  }
  assert.equal(abilitySound(ABILITIES.mend).fx, 'skill.heal');
  assert.notEqual(abilitySound(ABILITIES.mend).fx, abilitySound(ABILITIES.smite).fx, 'healing does not sound like a damage spell');
  for (const d of Object.values(JOB_DEFS)) for (const w of d.weapons) {
    const s = WEAPON_SOUND[w.kind];
    assert.ok(s && AUDIO_BY_ID[s.swing] && AUDIO_BY_ID[s.impact] && s.swingRate > 0.5 && s.swingRate < 1.5, `${w.kind} has swing and impact sounds`);
  }
  assert.deepEqual([WEAPON_SOUND.sword_shield.swing, WEAPON_SOUND.sword_shield.impact], ['combat.sword_swing', 'combat.sword_impact']);
  assert.equal(WEAPON_SOUND.greatsword.impact, 'combat.greatsword_impact');
  assert.equal(WEAPON_SOUND.daggers.swing, 'combat.dagger_attack');
  assert.deepEqual([WEAPON_SOUND.bow.swing, WEAPON_SOUND.bow.impact], ['combat.bow_release', 'combat.arrow_impact']);
  assert.equal(WEAPON_SOUND.staff.swing, 'combat.staff_attack');
  for (const id of Object.values(STEP_SOUND)) assert.ok(AUDIO_BY_ID[id]);
  assert.equal(surfaceOf(T.Grass, 'kingdom'), 'grass');
  assert.equal(surfaceOf(T.Flower, 'forest'), 'grass');
  assert.equal(surfaceOf(T.Plaza, 'kingdom'), 'stone');
  assert.equal(surfaceOf(T.Path, 'forest'), 'stone');
  assert.equal(surfaceOf(T.Grass, 'frost'), 'snow');
  assert.equal(surfaceOf(T.Path, 'frost'), 'snow', 'Frostveil paths are packed snow');
  assert.equal(surfaceOf(T.Grass, 'moor'), 'water', 'Dreadmoor is flooded ground');
  assert.equal(surfaceOf(T.Grass, 'ruins'), 'stone', 'dungeon floors');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(dropSound), ['', '', 'item.drop_rare', 'item.drop_rare', 'item.drop_legendary', 'item.drop_mythic']);
});

test('M10 music director: regions, villages with a soft boundary, combat that lingers, elites, bosses, death and the victory fanfare', () => {
  let d = new MusicDirector();
  assert.equal(d.update(0, MENU_INPUT), BGM.MENU);
  for (const z of REGIONS) assert.equal(d.update(0, { ...calm, zone: z }), ZONE_MUSIC[z], z);
  for (const z of Object.values(ZONES).filter((x) => x.kind === 'dungeon')) assert.equal(d.update(0, { ...calm, zone: z.id, dungeon: true }), BGM.DUNGEON, z.id);

  // village: entered at the inner boundary, left only at the outer one
  d = new MusicDirector();
  const at = (dist: number) => d.update(0, { ...calm, zone: 'verdant', villageDist: dist });
  assert.equal(at(30), BGM.FOREST);
  assert.equal(at(VILLAGE_ENTER_TILES + 2), BGM.FOREST, 'approaching: not yet');
  assert.equal(at(VILLAGE_ENTER_TILES), BGM.VILLAGE);
  for (const dist of [9.5, 10.5, 9.5, 10.5, 13.9, VILLAGE_LEAVE_TILES]) assert.equal(at(dist), BGM.VILLAGE, `pacing around the edge (${dist}) never switches`);
  assert.equal(at(VILLAGE_LEAVE_TILES + 0.5), BGM.FOREST);
  assert.equal(at(VILLAGE_ENTER_TILES + 2), BGM.FOREST, 'and it does not flip back on the way out');
  d = new MusicDirector();
  assert.equal(d.update(0, { ...calm, zone: 'ashen', villageDist: 12 }), BGM.VILLAGE, 'arriving by waystone inside the outer boundary starts in the village');
  assert.equal(d.update(0, { ...calm, zone: 'eldoria', villageDist: Infinity }), BGM.CITY, 'the capital is one piece of music');

  // combat: starts at once, lasts through the combat timeout plus a linger, then the region returns
  d = new MusicDirector();
  const fight = (t: number, since: number, o: Partial<MusicInput> = {}) => d.update(t, { ...calm, sinceCombat: since, ...o });
  assert.equal(fight(0, 0), BGM.COMBAT);
  assert.equal(fight(4000, 4000), BGM.COMBAT, 'still inside the combat timeout');
  assert.equal(fight(5500, 5500), BGM.COMBAT, 'lingering: the next monster is probably close');
  assert.equal(fight(4000 + COMBAT_LINGER_MS + 100, 9999), BGM.CITY, 'calm again');
  assert.equal(fight(9000, Infinity, { attacking: true }), BGM.COMBAT, 'auto-attacking counts as fighting before the first hit');
  // back-to-back fights are one stretch of combat music
  d = new MusicDirector();
  const seen = new Set<string>();
  for (let t = 0; t <= 60000; t += 250) seen.add(fight(t, t % 6000)); // a kill every six seconds
  assert.deepEqual([...seen], [BGM.COMBAT], 'grinding does not flap between combat and exploration');

  // elite: the fight stays "elite" until it is over, even after the elite itself is dead
  d = new MusicDirector();
  assert.equal(fight(0, 0, { elite: true }), BGM.ELITE);
  assert.equal(fight(1000, 200, { elite: false }), BGM.ELITE, 'no drop back to the normal theme mid-fight');
  assert.equal(fight(20000, 19000), BGM.CITY);
  assert.equal(fight(21000, 0), BGM.COMBAT, 'the next ordinary fight is ordinary');

  // bosses outrank everything but death; world and dungeon bosses have different tracks
  d = new MusicDirector();
  assert.equal(fight(0, 0, { boss: 'dungeon', zone: 'd_ruins', dungeon: true }), BGM.DUNGEON_BOSS);
  assert.equal(fight(100, 0, { boss: 'world', zone: 'dreadmoor', elite: true }), BGM.WORLD_BOSS);
  assert.equal(fight(200, 0, { boss: 'world', zone: 'dreadmoor', dead: true }), BGM.DEFEAT);
  assert.equal(d.update(300, { ...calm, zone: 'dreadmoor', dead: true }), BGM.DEFEAT);
  assert.equal(d.update(400, { ...calm, zone: 'dreadmoor' }), BGM.MOOR, 'respawned: the fight is forgotten, the region returns');

  // victory: a one-shot that plays out even while the fight is winding down, then the region
  d = new MusicDirector();
  assert.equal(fight(0, 0, { boss: 'dungeon', zone: 'd_ruins', dungeon: true }), BGM.DUNGEON_BOSS);
  d.playStinger(BGM.VICTORY, 1000, 7000);
  assert.equal(fight(1000, 0, { zone: 'd_ruins', dungeon: true }), BGM.VICTORY);
  assert.equal(fight(7900, 6900, { zone: 'd_ruins', dungeon: true }), BGM.VICTORY);
  assert.equal(fight(8100, 7100, { zone: 'd_ruins', dungeon: true }), BGM.DUNGEON);
  d.playStinger(BGM.VICTORY, 9000, 7000);
  assert.equal(fight(9500, 0, { boss: 'world', zone: 'astral' }), BGM.WORLD_BOSS, 'a new boss ends the fanfare');
  assert.equal(fight(9500 + COMBAT_LINGER_MS + 100, 20000, { zone: 'astral' }), BGM.ASTRAL, 'and the fanfare does not come back');

  // changing zone drops the fight; a special event plays only when nothing more urgent does
  d = new MusicDirector();
  assert.equal(fight(0, 0), BGM.COMBAT);
  assert.equal(d.update(100, { ...calm, zone: 'verdant' }), BGM.FOREST);
  assert.equal(d.update(200, { ...calm, zone: 'verdant', event: true }), BGM.EVENT);
  assert.equal(d.update(300, { ...calm, zone: 'verdant', event: true, sinceCombat: 0 }), BGM.COMBAT);
  assert.equal(d.update(400, { ...MENU_INPUT, event: true }), BGM.MENU);

  // transitions: quick into a fight, slow out of it; exploration themes resume, fight music restarts
  assert.ok(fadeMs(BGM.CITY, BGM.COMBAT) < fadeMs(BGM.COMBAT, BGM.CITY));
  assert.ok(fadeMs(BGM.CITY, BGM.FOREST) >= 1000 && fadeMs('', BGM.MENU) > 0);
  for (const z of REGIONS) assert.equal(resumes(ZONE_MUSIC[z]), true);
  for (const id of [BGM.COMBAT, BGM.ELITE, BGM.DUNGEON_BOSS, BGM.WORLD_BOSS, BGM.VICTORY, BGM.DEFEAT]) assert.equal(resumes(id), false);
  assert.equal(ambienceFor('verdant', false, 'world'), AMB.FOREST);
  assert.equal(ambienceFor('d_lair', true, 'world'), AMB.DUNGEON);
  assert.equal(ambienceFor('verdant', false, 'menu'), '');
});

test('M10 positional sound: nothing beyond hearing range, quieter with distance, panned to the side it comes from', () => {
  assert.deepEqual(spatial(0, 0), { vol: 1, pan: 0 });
  assert.equal(spatial(HEARING_RANGE, 0).vol, 0);
  assert.equal(spatial(0, -HEARING_RANGE - 1).vol, 0);
  let last = 2;
  for (let x = 0; x < HEARING_RANGE; x += 40) {
    const v = spatial(x, 0).vol;
    assert.ok(v < last && v > 0, `volume falls with distance (${x})`);
    last = v;
  }
  assert.ok(spatial(200, 0).pan > 0 && spatial(-200, 0).pan < 0 && spatial(0, 200).pan === 0);
  assert.ok(spatial(5000, 0).pan === 0 && Math.abs(spatial(500, 0).pan) <= 1);
});

const AUDIO_DIR = 'assets/audio';
test('M10 audio assets: every catalogue sound is a valid, measured OGG, licensed and credited', () => {
  const r = validateAudio(AUDIO_DIR);
  assert.deepEqual(r.findings.filter((f) => f.level === 'error'), [], 'no validation errors');
  assert.equal(r.ok.length, AUDIO_DEFS.length, 'one valid file per catalogue entry');
  const m: AudioManifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8'));
  assert.match(m.notice, /OpenGameArt/);
  const credits = fs.readFileSync(path.join(AUDIO_DIR, 'CREDITS.md'), 'utf8');
  let bytes = 0;
  const contents = new Set<string>();
  for (const e of m.assets) {
    const data = fs.readFileSync(path.join(AUDIO_DIR, e.file)), info = oggInfo(data), def = AUDIO_BY_ID[e.id];
    bytes += data.length;
    contents.add(data.toString('base64'));
    assert.equal(e.file, def.path + '.ogg');
    assert.equal(info.codec, 'vorbis');
    // the manifest holds the decoded length; the stream header may differ by the encoder's padding
    assert.ok(Math.abs(info.duration - e.duration) < 0.03 && e.duration > 0.02, `${e.id} duration`);
    assert.ok(info.sampleRate === 44100 && info.channels === e.channels && e.channels <= 2);
    assert.ok(e.gain > 0 && e.gain <= 1 && e.trigger.length >= 4 && /^\d{4}-\d\d-\d\d$/.test(e.generated), `${e.id} metadata`);
    // provenance and rights: a recording with a permissive licence, its source page, and a line in the credits
    assert.equal(e.temporary, false, `${e.id} is a real recording`);
    assert.equal(e.provider, 'opengameart');
    assert.match(e.license, /^(CC0|CC-BY [34]\.0|OGA-BY [34]\.0)$/, `${e.id} licence`);
    assert.match(e.source, /https:\/\/opengameart\.org\/content\//, `${e.id} source page`);
    assert.ok(credits.includes(e.id), `${e.id} is credited`);
  }
  // a recording may serve two similar sounds (both bow sounds, say), but most are distinct
  assert.ok(contents.size >= m.assets.length * 0.8, 'mostly distinct recordings');
  const music = m.assets.filter((e) => e.category === 'music');
  assert.equal(music.length, 16);
  for (const e of music.filter((x) => x.loop)) assert.ok(e.duration >= 20 && e.channels === 2, `${e.id} is a full-length stereo loop (${e.duration}s)`);
  assert.ok(new Set(music.map((e) => e.duration)).size >= 12, 'the tracks differ in tempo and length');
  assert.deepEqual(music.filter((e) => !e.loop).map((e) => e.id), [BGM.VICTORY, BGM.DEFEAT]);
  assert.ok(m.assets.find((e) => e.id === BGM.VICTORY)!.duration < 10, 'the victory theme is short');
  assert.equal(m.assets.filter((e) => e.category === 'ambience' && e.loop).length, 5);
  assert.ok(m.assets.filter((e) => e.category === 'sfx').every((e) => e.duration < 4.5), 'effects are short');
  assert.ok(bytes < 16 * 1048576, `all audio together is ${(bytes / 1048576).toFixed(1)} MB`);
});

test('M10 audio validation: each rule rejects the fault it exists for', () => {
  const m: AudioManifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8'));
  const click = m.assets.find((e) => e.id === 'ui.click')!, fanfare = m.assets.find((e) => e.id === BGM.VICTORY)!;
  const check = (mutate: (assets: any[], dir: string) => void, raw?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeth-audio-'));
    try {
      const assets = [structuredClone(click), structuredClone(fanfare)];
      for (const e of assets) {
        fs.mkdirSync(path.dirname(path.join(dir, e.file)), { recursive: true });
        fs.copyFileSync(path.join(AUDIO_DIR, e.file), path.join(dir, e.file));
      }
      mutate(assets, dir);
      if (raw !== '') fs.writeFileSync(path.join(dir, 'manifest.json'), raw ?? JSON.stringify({ version: 1, assets }));
      const r = validateAudio(dir);
      // the two-file fixture always lacks the rest of the catalogue; that rule is checked separately below
      return {
        rules: [...new Set(r.findings.filter((f) => f.level === 'error' && f.rule !== 'missing-asset').map((f) => f.rule))],
        warnings: r.findings.filter((f) => f.level === 'warning').map((f) => f.rule), ok: r.ok.map((e) => e.id), all: r.findings,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const clean = check(() => {});
  assert.deepEqual(clean.rules, []);
  assert.deepEqual(clean.ok, ['ui.click', BGM.VICTORY], 'the untouched fixture is valid');
  assert.equal(clean.all.filter((f) => f.rule === 'missing-asset').length, AUDIO_DEFS.length - 2, 'sounds the game needs but the manifest lacks are reported one by one');

  assert.deepEqual(check((a, dir) => fs.rmSync(path.join(dir, a[0].file))).rules, ['missing-file']);
  assert.deepEqual(check((a, dir) => { fs.renameSync(path.join(dir, a[0].file), path.join(dir, 'x.mp3')); a[0].file = 'x.mp3'; }).rules, ['format'], 'only OGG is accepted');
  assert.deepEqual(check((a, dir) => fs.writeFileSync(path.join(dir, a[0].file), Buffer.alloc(4000, 7))).rules, ['format'], 'a file that is not really an Ogg stream');
  assert.ok(check((a) => { a[1].id = a[0].id; }).rules.includes('duplicate-id'));
  assert.ok(check((a) => { a[1].file = a[0].file; }).rules.includes('duplicate-file'));
  for (const k of ['license', 'source', 'provider', 'trigger', 'title', 'generated', 'temporary', 'loop', 'gain', 'category', 'assoc'])
    assert.deepEqual(check((a) => { delete a[0][k]; }).rules, ['metadata'], `missing ${k}`);
  assert.deepEqual(check((a) => { a[0].gain = 0; }).rules, ['metadata']);
  assert.deepEqual(check((a) => { a[0].duration += 1; }).rules, ['duration'], 'the stated length must be the real length');
  assert.deepEqual(check((a) => { a[1].loop = true; }).rules, ['loop'], 'a one-shot must not be listed as a loop');
  assert.deepEqual(check((a) => { a[0].category = 'music'; }).rules, ['category']);
  assert.deepEqual(check((a) => { a[0].file = '../escape.ogg'; }).rules, ['metadata'], 'paths cannot leave the audio folder');
  assert.deepEqual(check((a) => { a[0].temporary = true; a[0].license = 'Commercially cleared for release.'; }).rules, ['license'], 'a placeholder cannot claim commercial clearance');
  const stranger = check((a) => { a[0].id = 'ui.unknown_sound'; });
  assert.ok(stranger.warnings.includes('unknown-id') && stranger.ok.includes('ui.unknown_sound'), 'an extra sound is allowed but pointed out');
  assert.deepEqual(check(() => {}, '').rules, ['manifest'], 'no manifest');
  assert.deepEqual(check(() => {}, '{not json').rules, ['manifest']);
  assert.deepEqual(check(() => {}, JSON.stringify({ version: 2, assets: [] })).rules, ['manifest']);
});

test('M10 audio import: only valid sounds reach the build, with their size and content hash; no manifest means a silent game', () => {
  const m: AudioManifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeth-audio-imp-'));
  try {
    const src = path.join(tmp, 'src'), out = path.join(tmp, 'out');
    const good = m.assets.filter((e) => ['ui.click', 'ui.notify'].includes(e.id)), bad = { ...m.assets.find((e) => e.id === 'ui.error')!, duration: 99 };
    for (const e of [...good, bad]) {
      fs.mkdirSync(path.dirname(path.join(src, e.file)), { recursive: true });
      fs.copyFileSync(path.join(AUDIO_DIR, e.file), path.join(src, e.file));
    }
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: 1, assets: [...good, bad] }));
    const run = (...args: string[]) => spawnSync('node_modules/.bin/tsx', ['scripts/import-audio.ts', ...args], { encoding: 'utf8' });
    const r = run(src, out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ERROR\s+sfx\/ui\/error\.ogg\s+\[duration\]/);
    assert.match(r.stdout, /imported 2 of 3 audio assets/);
    assert.doesNotMatch(r.stdout, /temporary placeholders/, 'recorded audio is not reported as placeholder');
    const built = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(built.assets.map((a: any) => a.id).sort(), ['ui.click', 'ui.notify']);
    for (const a of built.assets) {
      assert.equal(fs.statSync(path.join(out, a.file)).size, a.bytes);
      assert.match(a.v, /^[0-9a-f]{10}$/);
      assert.deepEqual(Object.keys(a).sort(), ['bytes', 'category', 'duration', 'file', 'gain', 'id', 'loop', 'temporary', 'v'], 'players download playback data only');
    }
    assert.equal(fs.existsSync(path.join(out, bad.file)), false, 'the rejected file is not shipped');
    assert.equal(run('--check', src).status, 1, 'the check command fails on errors');
    assert.equal(run('--check', AUDIO_DIR).status, 0, 'and passes on the real assets');
    const none = run(path.join(tmp, 'nothing'), out);
    assert.equal(none.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')), { version: 1, assets: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M10 server cues: authoritative events carry a cue, so every client plays the same sound for the same event', () => {
  let roll = 0.5;
  const { world, join, step } = harness({ rng: () => roll, capacity: 10 });
  const a = join(0, 0, 'knight', 20), watcher = join(40, 0, 'mage', 20);
  const m = world.spawn(a.p.room, 'rune_guardian', a.p.x + 60, a.p.y);
  step(8);
  for (const out of [a.out, watcher.out]) assert.deepEqual(out.filter((x) => x.t === 'ann').map((x) => [x.text, x.cue]), [[m.def.boss!.intro, 'boss']], 'the boss intro is tagged for everyone in the room');
  world.hurt(m, Math.ceil(m.maxHp * 0.45), 0, a.p);
  step(2);
  assert.ok(a.out.some((x) => x.t === 'ann' && x.cue === 'phase' && x.text === m.def.boss!.phases[1].say), 'phase changes are tagged');
  // upgrades: success and failure are told apart by the server, not guessed from text
  world.hurt(m, 1e9, 0, null);
  a.p.lastCombat = -1e6;
  give(a.p, spec('longsword', { ilvl: 20 }));
  give(a.p, spec('upgrade_stone', { qty: 10 }));
  a.p.gold = 1e6;
  const sw = a.p.inv.find((i) => i.base === 'longsword')!;
  a.out.length = 0;
  watcher.out.length = 0;
  roll = 0;
  assert.equal(world.inventory(a.p, { op: 'upgrade', uid: sw.uid }), '');
  roll = 0.999;
  assert.equal(world.inventory(a.p, { op: 'upgrade', uid: sw.uid }), '');
  assert.deepEqual(a.out.filter((x) => x.t === 'sys' && x.cue).map((x) => x.cue), ['upgrade_ok', 'upgrade_fail']);
  assert.equal(watcher.out.some((x) => x.t === 'sys' && x.cue), false, 'only the player who upgraded hears it');
  // ordinary system lines carry no cue
  world.chat(a.p, 'hello', 'party');
  assert.ok(a.out.some((x) => x.t === 'sys' && x.cue === undefined), 'plain system messages have none');
});

// ---------------------------------------------------------------------------------------------
// Monster spawn, navigation and map fix
// ---------------------------------------------------------------------------------------------
import { clearLine, findPath, lineOfSight, navOf, pathStats, reachableAt, roomAround, SPAWN_MIN_ROOM, spawnFault, tileOf } from '../shared/src/nav';
import { spawnRegions } from '../shared/src/monsters';
import { PATHS_PER_TICK } from '../server/src/game/Monster';

/** In a zone: two reachable tiles a few tiles apart with something solid between them and a short way round. */
function detour(zone: string) {
  const nav = navOf(zone), map = nav.map;
  for (let ty = 4; ty < map.h - 4; ty++) for (let tx = 4; tx < map.w - 12; tx++) {
    for (const span of [5, 6, 7]) {
      const a = tx + ty * map.w, b = a + span;
      if (!nav.reach[a] || !nav.reach[b]) continue;
      const ax = tileCenter(tx), ay = tileCenter(ty), bx = tileCenter(tx + span);
      if (clearLine(map, ax, ay, bx, ay) || blocked(map, ax, ay) || blocked(map, bx, ay)) continue;
      const p = findPath(nav, tx, ty, tx + span, ty);
      if (p && p.length >= span + 2 && p.length <= 16 && roomAround(nav, tx, ty, 3) >= SPAWN_MIN_ROOM) return { ax, ay, bx, by: ay, steps: p.length };
    }
  }
  throw new Error('no detour found in ' + zone);
}

test('nav: reachability, spawn validation rules and line checks', () => {
  for (const z of REGIONS) {
    const nav = navOf(z), map = nav.map, sp = map.def.spawn;
    assert.equal(nav.reach[sp.tx + sp.ty * map.w], 1, `${z}: the arrival point is reachable`);
    assert.ok(nav.size > 2500, `${z}: most of the zone is connected (${nav.size} tiles)`);
    let cutOff = 0;
    for (let i = 0; i < nav.walk.length; i++) if (nav.walk[i] && !nav.reach[i]) cutOff++;
    assert.ok(cutOff > 0, `${z}: the terrain does contain sealed pockets (${cutOff} tiles), which is why spawns must be validated`);
    for (const p of map.def.portals) assert.equal(nav.reach[p.tx + p.ty * map.w], 1, `${z}: portal reachable`);
  }
  const nav = navOf('verdant'), map = nav.map;
  const find = (pred: (i: number, tx: number, ty: number) => boolean) => {
    for (let ty = 3; ty < map.h - 3; ty++) for (let tx = 3; tx < map.w - 3; tx++) if (pred(tx + ty * map.w, tx, ty)) return [tileCenter(tx), tileCenter(ty)] as const;
    throw new Error('not found');
  };
  const solid = find((i) => !nav.walk[i]), pocket = find((i) => nav.walk[i] === 1 && !nav.reach[i]);
  const nook = find((i, tx, ty) => nav.reach[i] === 1 && roomAround(nav, tx, ty, 3) < SPAWN_MIN_ROOM && !blocked(map, tileCenter(tx), tileCenter(ty)));
  const open = find((i, tx, ty) => nav.reach[i] === 1 && roomAround(nav, tx, ty, 3) >= SPAWN_MIN_ROOM && !blocked(map, tileCenter(tx), tileCenter(ty)));
  assert.equal(spawnFault(nav, ...solid), 'inside-obstacle');
  assert.equal(spawnFault(nav, ...pocket), 'unreachable', 'walkable ground that is sealed off is refused');
  assert.equal(spawnFault(nav, ...nook), 'cramped', 'a nook with no room to move is refused');
  assert.equal(spawnFault(nav, ...open), '');
  assert.equal(spawnFault(nav, 10, 10), 'out-of-bounds');
  assert.equal(spawnFault(nav, map.w * TILE - 10, 400), 'out-of-bounds');
  assert.equal(spawnFault(nav, ...pocket, true), '', 'a flyer may live over a pocket');
  assert.equal(spawnFault(nav, ...solid, true), 'inside-obstacle', 'but not inside a tree');
  assert.equal(reachableAt(nav, ...open), true);
  assert.equal(reachableAt(nav, ...pocket), false);
  assert.equal(findPath(nav, tileOf(open[0]), tileOf(open[1]), tileOf(pocket[0]), tileOf(pocket[1])), null, 'no route into a sealed pocket, answered without a search');
  const d = detour('eldoria'), en = navOf('eldoria');
  assert.equal(clearLine(en.map, d.ax, d.ay, d.bx, d.by), false);
  const route = findPath(en, tileOf(d.ax), tileOf(d.ay), tileOf(d.bx), tileOf(d.by))!;
  assert.equal(route[route.length - 1], tileOf(d.bx) + tileOf(d.by) * en.map.w, 'the route ends on the goal');
  let prev = tileOf(d.ax) + tileOf(d.ay) * en.map.w;
  for (const i of route) {
    assert.equal(en.walk[i], 1, 'every step is walkable');
    assert.equal(Math.abs((i % en.map.w) - (prev % en.map.w)) + Math.abs(Math.floor(i / en.map.w) - Math.floor(prev / en.map.w)), 1, 'steps are between neighbouring tiles');
    prev = i;
  }
  assert.equal(findPath(en, 5, 5, en.map.w - 6, en.map.h - 6, 30), null, 'the node budget bounds a search');
  assert.equal(typeof lineOfSight(en.map, d.ax, d.ay, d.bx, d.by), 'boolean');
});

test('spawns: every monster in every region stands on valid, connected ground with room to move, spread out, and the result is logged', () => {
  const total = { monsters: 0, rejected: 0 };
  for (const z of REGIONS) for (const seed of [1, 2, 3, 4, 5, 6]) {
    const h = harness({ rng: mulberryTest(seed * 977), world: { monsters: true } }), room = h.world.roomIn(z), nav = navOf(z);
    const regions = spawnRegions(z);
    assert.equal(room.spawnLog.length, regions.length, 'one log entry per spawn region');
    for (const [i, log] of room.spawnLog.entries()) {
      assert.equal(log.region, regions[i].id);
      assert.equal(log.placed, log.wanted, `${log.region}: every monster of the camp was placed`);
      total.rejected += Object.values(log.rejected).reduce((a, b) => a + b, 0);
    }
    const list = [...room.monsters.values()].filter((m) => !m.def.boss);
    assert.equal(list.length, SPAWNS[z].reduce((n, g) => n + g.count, 0));
    for (const m of list) {
      total.monsters++;
      assert.equal(spawnFault(nav, m.x, m.y, m.def.flying), '', `${z} seed ${seed}: ${m.def.id} at ${m.x},${m.y}`);
      const reg = regions.find((r) => r.id === m.region)!;
      assert.ok(reg && reg.monster === m.def.id && m.patrolR === reg.patrolRadius && m.patrolR >= 96, 'a monster knows its region and patrol radius');
      for (const o of list) if (o !== m) assert.ok(Math.abs(o.x - m.x) >= 2 * TILE || Math.abs(o.y - m.y) >= 2 * TILE, `${z}: monsters do not stack on one spot`);
    }
    // a camp occupies an area, not a point
    for (const reg of regions.filter((r) => r.count >= 4)) {
      const own = list.filter((m) => m.region === reg.id), xs = own.map((m) => m.x), ys = own.map((m) => m.y);
      assert.ok(Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) >= 5 * TILE, `${reg.id} is spread over its hunting ground`);
    }
  }
  assert.ok(total.monsters > 900 && total.rejected > 0, `${total.monsters} monsters checked; ${total.rejected} candidate points were rejected and logged`);
  for (const r of spawnRegions('verdant')) {
    assert.ok(r.id && r.map === 'verdant' && MONSTERS[r.monster] && r.count > 0 && r.respawnMs > 0 && r.patrolRadius > 0 && r.leashRadius > r.patrolRadius && r.level[0] >= 1 && r.restrictions.length > 0, 'spawn region configuration is complete');
  }
});

test('monster movement: walks around obstacles to reach its target, attacks in range, and returns home along a route', () => {
  const d = detour('eldoria'), sp = ZONES.eldoria.spawn;
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(d.bx - tileCenter(sp.tx), d.by - tileCenter(sp.ty), 'knight', 30);
  const m = world.spawn(a.p.room, 'boar', d.ax, d.ay);
  assert.equal(m.aiState as string, 'idle');
  m.addThreat(a.p.id, 50);
  const hp0 = a.p.hp;
  let chased = false, maxFromLine = 0;
  for (let i = 0; i < 400 && a.p.hp === hp0; i++) {
    step();
    if ((m.aiState as string) === 'chase') chased = true;
    maxFromLine = Math.max(maxFromLine, Math.abs(m.y - d.ay));
    assert.equal(blocked(a.p.room.map, m.x, m.y), false, 'never inside an obstacle');
  }
  assert.ok(chased, 'it chased');
  assert.ok(a.p.hp < hp0, `it reached the player around the obstacle and hit (${d.steps} tiles of route for a ${Math.round((d.bx - d.ax) / TILE)}-tile gap)`);
  assert.ok(maxFromLine >= TILE * 0.9, 'by leaving the straight line');
  assert.ok(Math.hypot(m.x - a.p.x, m.y - a.p.y) < 80, 'and stands within attack range');
  // the player leaves: the monster goes home by the same kind of route and heals
  world.relocate(a.p, world.roomIn('verdant'), tileCenter(ZONES.verdant.spawn.tx), tileCenter(ZONES.verdant.spawn.ty));
  const watcher = join(d.bx - tileCenter(sp.tx) + 400, d.by - tileCenter(sp.ty) + 400, 'mage', 1); // keeps the room simulated
  assert.ok(watcher.p.room === m.room);
  let returned = false;
  for (let i = 0; i < 500; i++) {
    step();
    if ((m.aiState as string) === 'return') returned = true;
    if (returned && (m.aiState as string) !== 'return') break;
  }
  assert.ok(returned && Math.hypot(m.x - d.ax, m.y - d.ay) <= 100 && m.hp === m.maxHp, 'back at its camp, restored');
});

test('monster movement: idle monsters patrol inside their radius on valid ground; an unreachable target is dropped, with the reason recorded', () => {
  const h = harness({ rng: mulberryTest(4242), capacity: 10, world: { monsters: true } });
  const a = h.join(0, 0, 'knight', 60), room = a.p.room, nav = navOf('eldoria');
  const mobs = [...room.monsters.values()].filter((m) => !m.def.boss && !m.def.elite);
  for (const m of mobs) (m as any).def = { ...m.def, aggro: 0 }; // observe patrols only
  const start = new Map(mobs.map((m) => [m, [m.x, m.y]])), far = new Map(mobs.map((m) => [m, 0])), states = new Set<string>();
  for (let i = 0; i < 1200; i++) {
    h.step();
    if (i % 4) continue;
    for (const m of mobs) {
      states.add(m.aiState);
      far.set(m, Math.max(far.get(m)!, Math.hypot(m.x - m.spawnX, m.y - m.spawnY)));
      if (!m.def.flying) assert.equal(blocked(room.map, m.x, m.y), false);
      assert.ok(Math.hypot(m.x - m.spawnX, m.y - m.spawnY) <= m.patrolR + 8, `${m.def.id} stays inside its patrol radius`);
    }
  }
  const moved = mobs.filter((m) => Math.hypot(m.x - start.get(m)![0], m.y - start.get(m)![1]) > 8 || far.get(m)! > 24).length;
  assert.ok(moved >= mobs.length * 0.9, `monsters move about rather than standing still (${moved} of ${mobs.length} moved in a minute)`);
  assert.ok(states.has('patrol') && states.has('idle'));
  assert.ok(Math.max(...far.values()) > 64, 'and use their patrol radius');
  // unreachable target: a player standing in a sealed pocket
  const map = room.map;
  let pocket: [number, number] | null = null;
  for (let i = 0; i < nav.walk.length && !pocket; i++) if (nav.walk[i] && !nav.reach[i] && !blocked(map, tileCenter(i % map.w), tileCenter(Math.floor(i / map.w)))) pocket = [tileCenter(i % map.w), tileCenter(Math.floor(i / map.w))];
  assert.ok(pocket);
  h.world.relocate(a.p, room, pocket[0], pocket[1]);
  let near: [number, number] | null = null;
  for (let r = 2; r < 12 && !near; r++) for (let k = 0; k < 16 && !near; k++) {
    const x = pocket[0] + Math.cos(k * 0.39) * r * TILE, y = pocket[1] + Math.sin(k * 0.39) * r * TILE;
    if (!spawnFault(nav, x, y)) near = [x, y];
  }
  assert.ok(near);
  const hunter = h.world.spawn(room, 'boar', near[0], near[1]);
  (hunter as any).def = { ...hunter.def, leash: 2000, pattern: [{ name: 'Gore', windupMs: 350, range: 20, mul: 1 }] };
  hunter.addThreat(a.p.id, 50);
  const hp = a.p.hp;
  let gaveUp = false;
  for (let i = 0; i < 300 && !gaveUp; i++) {
    h.step();
    if (hunter.threat.size === 0) gaveUp = true;
  }
  assert.ok(gaveUp, 'it stops trying to reach a target it cannot reach');
  assert.equal(a.p.hp, hp, 'and never attacked through the obstacle');
  assert.match(hunter.blockedBy, /unreachable|no route/, 'the reason is recorded for the developer overlay');
});

test('pathfinding cost is bounded: a budget per tick, a throttle per monster, and a measured share of the tick', () => {
  const h = harness({ rng: mulberryTest(99), capacity: 40, world: { monsters: true } });
  const players = Array.from({ length: 30 }, (_, i) => h.join(((i % 6) - 3) * 300, (Math.floor(i / 6) - 2) * 300, 'knight', 60));
  for (const m of players[0].p.room.monsters.values()) (m as any).def = { ...m.def, aggro: 900, leash: 3000 }; // everything hunts everyone
  pathStats.searches = pathStats.nodes = pathStats.failed = 0;
  let worst = 0;
  const t0 = performance.now(), TICKS = 600;
  for (let i = 0; i < TICKS; i++) {
    const before = pathStats.searches;
    h.step();
    worst = Math.max(worst, pathStats.searches - before);
  }
  const ms = (performance.now() - t0) / TICKS;
  assert.ok(worst <= PATHS_PER_TICK + 30, `searches in one tick stay bounded (worst ${worst})`); // patrol validation adds none; headroom is for player-driven systems
  assert.ok(pathStats.searches > 0, 'monsters did search for routes');
  assert.ok(ms < 25, `a tick with ${players[0].p.room.monsters.size} hunting monsters and 30 players averages ${ms.toFixed(2)} ms (budget 50)`);
  console.log(`pathfinding: ${pathStats.searches} searches in ${TICKS} ticks (worst ${worst}/tick), ${Math.round(pathStats.nodes / Math.max(1, pathStats.searches))} nodes each, ${pathStats.failed} without a route; tick average ${ms.toFixed(2)} ms`);
});

test('developer overlay: debug data is sent only when the server enables it, and only to players who asked', () => {
  const off = harness({ capacity: 5 }), p = off.join(0, 0, 'knight', 5);
  off.world.spawn(p.p.room, 'boar', p.p.x + 80, p.p.y);
  assert.equal(p.out.find((m) => m.t === 'welcome').dev, undefined, 'ordinary servers do not advertise it');
  off.world.setDebug(p.p, true);
  off.step(12);
  assert.equal(p.p.debug, false);
  assert.equal(p.out.some((m) => m.t === 'dbg'), false, 'a request is ignored when the server has it disabled');
  const on = harness({ capacity: 5, world: { debugOverlay: true } }), dev = on.join(0, 0, 'knight', 5), other = on.join(30, 0, 'mage', 5);
  const boar = on.world.spawn(dev.p.room, 'boar', dev.p.x + 80, dev.p.y);
  assert.equal(dev.out.find((m) => m.t === 'welcome').dev, true);
  on.world.setDebug(dev.p, 'yes');
  assert.equal(dev.p.debug, false, 'only a literal true turns it on');
  on.world.setDebug(dev.p, true);
  on.step(12);
  const msg = dev.out.filter((m) => m.t === 'dbg').pop();
  const row = msg.mobs.find((r: any[]) => r[0] === boar.id);
  assert.ok(row, 'the monster is in the feed');
  assert.ok(['idle', 'patrol', 'chase', 'attack', 'return'].includes(row[1]), `AI state (${row[1]})`);
  assert.deepEqual(row.slice(4, 9), [Math.round(boar.spawnX), Math.round(boar.spawnY), boar.patrolR, boar.def.aggro, boar.def.leash], 'spawn point, patrol, aggro and leash radius');
  assert.equal(typeof row[9], 'string', 'blocked-movement reason');
  assert.equal(other.out.some((m) => m.t === 'dbg'), false, 'a player who did not ask gets nothing');
  on.world.setDebug(dev.p, false);
  dev.out.length = 0;
  on.step(12);
  assert.equal(dev.out.some((m) => m.t === 'dbg'), false);
});

// ---------------------------------------------------------------------------------------------
// M11: auto hunting; bulk sale, inventory sorting and player trading
// ---------------------------------------------------------------------------------------------
import {
  AUTO_RADIUS, autoAbilities, autoKind, autoTargetable, chooseSkill, chooseTarget, cleanAutoConfig, DEFAULT_AUTO, defaultAutoSkill, lootAllowed, withSkills,
  type AutoConfig, type SkillView, type TargetView,
} from '../shared/src/autohunt';
import { award, sortInventory } from '../server/src/game/Inventory';
import { TRADE_MAX_ITEMS, TRADE_RANGE } from '../shared/src/protocol';

const autoCfg = (o: Partial<AutoConfig> = {}): AutoConfig => cleanAutoConfig({ ...DEFAULT_AUTO, ...o });
const skillCfg = (ids: string[], o: Partial<AutoConfig> = {}) => autoCfg({ skillList: ids.map((id, i) => ({ ...defaultAutoSkill(ABILITIES[id], i), on: true })), ...o });
const view = (o: Partial<SkillView> = {}): SkillView => ({
  hpPct: 100, resPct: 100, res: 500, hasTarget: true, targetDist: 60, targetHpFrac: 1, targetElite: false,
  enemiesNearMe: () => 1, enemiesNearTarget: () => 1, ready: () => true, cost: (id) => ABILITIES[id].cost, ...o,
});

test('M11 configuration: sanitised and clamped; only skills that are safe to automate are offered', () => {
  assert.deepEqual(cleanAutoConfig(undefined), DEFAULT_AUTO);
  const c = cleanAutoConfig({
    hpPct: 500, mpPct: -3, radius: 9999, attack: 'yes', loot: false, lootMode: 'steal', onFull: 'stop', returnTo: 'moon', ignore: ['potion', 'gold', 'potion'],
    skillList: [{ id: 'fireball', on: true, pri: 3, minMp: 150, minEnemies: 99, hpBelow: 0 }, { id: 'blink', on: true }, { id: 'nope' }, { id: 'fireball' }, null],
  });
  assert.deepEqual([c.hpPct, c.mpPct, c.radius], [95, 5, AUTO_RADIUS.max], 'thresholds and radius are clamped');
  assert.equal(c.attack, true, 'a non-boolean keeps the default');
  assert.deepEqual([c.loot, c.lootMode, c.onFull, c.returnTo, c.ignore], [false, 'all', 'stop', 'none', ['potion']]);
  assert.deepEqual(c.skillList.map((s) => s.id), ['fireball', 'blink'], 'unknown ids and duplicates are dropped');
  assert.deepEqual([c.skillList[0].minMp, c.skillList[0].minEnemies, c.skillList[0].hpBelow], [100, 9, 1]);
  // what may be automated
  assert.equal(autoKind(ABILITIES.fireball), 'enemy');
  assert.equal(autoKind(ABILITIES.flame_burst), 'area');
  assert.equal(autoKind(ABILITIES.healing_rain), 'heal');
  assert.equal(autoKind(ABILITIES.mend), 'heal');
  assert.equal(autoKind(ABILITIES.guard_stance), 'buff');
  assert.equal(autoKind(ABILITIES.resurrection), null, 'raising the dead is never automated');
  for (const id of ['shadow_step', 'charge']) assert.equal(autoKind(ABILITIES[id]), 'enemy', `${id} closes the gap`);
  for (const id of ['taunt', 'smoke_bomb']) assert.equal(autoKind(ABILITIES[id]), 'area', id);
  for (const id of ['blink', 'fleet_step', 'stealth', 'purify']) assert.equal(autoKind(ABILITIES[id]), 'buff', id);
  assert.equal(defaultAutoSkill(ABILITIES.charge, 0).on, false, 'movement skills start switched off');
  // the list follows the character: learned job skills and the spells of attuned runes
  const build = emptyBuild('mage');
  assert.deepEqual(autoAbilities('mage', build), []);
  build.skills.arcane_bolt = 1;
  build.runes.slots[0] = 'fire';
  assert.deepEqual(autoAbilities('mage', build).map((d) => d.id), ['arcane_bolt', 'fireball', 'flame_burst', 'meteor_strike']);
  const w = withSkills(DEFAULT_AUTO, 'mage', build);
  assert.deepEqual(w.skillList.map((s) => [s.id, s.on, s.minEnemies]), [['arcane_bolt', true, 1], ['fireball', true, 1], ['flame_burst', true, 3], ['meteor_strike', true, 1]], 'Flame Burst defaults to three enemies');
  const kept = withSkills({ ...w, skillList: w.skillList.map((s) => (s.id === 'fireball' ? { ...s, on: false, minMp: 55 } : s)) }, 'mage', build);
  assert.deepEqual(kept.skillList.find((s) => s.id === 'fireball'), { ...defaultAutoSkill(ABILITIES.fireball, 1), on: false, minMp: 55 }, "the player's own settings survive");
});

test('M11 auto skill: priority, MP threshold, cooldown, range, enemy count, healing threshold and not wasting costly skills', () => {
  const cfg = skillCfg(['meteor_strike', 'flame_burst', 'fireball']);
  assert.equal(chooseSkill(cfg, view()), 'meteor_strike', 'highest priority first');
  assert.equal(chooseSkill(cfg, view({ ready: (id) => id !== 'meteor_strike' })), 'fireball', 'a skill on cooldown is skipped; Flame Burst needs three enemies');
  assert.equal(chooseSkill(cfg, view({ ready: (id) => id !== 'meteor_strike', enemiesNearMe: () => 3 })), 'flame_burst', 'Flame Burst when at least three enemies are close');
  assert.equal(chooseSkill(cfg, view({ ready: (id) => id !== 'meteor_strike', enemiesNearMe: () => 2 })), 'fireball');
  assert.equal(chooseSkill(cfg, view({ res: 20 })), 'fireball', 'cannot afford the meteor (55): the next affordable skill');
  assert.equal(chooseSkill(cfg, view({ res: 5 })), null, 'nothing affordable');
  assert.equal(chooseSkill(cfg, view({ resPct: 10 })), null, 'below every skill\'s MP threshold (20%)');
  assert.equal(chooseSkill(cfg, view({ targetDist: 300 })), null, 'out of range');
  assert.equal(chooseSkill(cfg, view({ hasTarget: false })), null, 'no target in sight: no targeted skill');
  assert.equal(chooseSkill(cfg, view({ hasTarget: false, enemiesNearMe: () => 4 })), 'flame_burst', 'an area skill around the caster needs no target');
  assert.equal(chooseSkill({ ...cfg, skills: false }, view()), null, 'auto skill off');
  // priority is the player's: fireball first
  const re = { ...cfg, skillList: cfg.skillList.map((s) => ({ ...s, pri: s.id === 'fireball' ? 0 : s.pri + 1 })) };
  assert.equal(chooseSkill(re, view()), 'fireball');
  // a costly skill is not wasted on a weak monster about to die, unless configured or the monster is an elite
  assert.equal(chooseSkill(cfg, view({ targetHpFrac: 0.1 })), 'fireball', 'the 55-mana meteor is held back; the 14-mana fireball is not');
  assert.equal(chooseSkill(cfg, view({ targetHpFrac: 0.1, targetElite: true })), 'meteor_strike');
  assert.equal(chooseSkill({ ...cfg, finishWithSkills: true }, view({ targetHpFrac: 0.1 })), 'meteor_strike');
  // healing: only when needed
  const heal = skillCfg(['mend', 'smite']);
  heal.skillList[0].hpBelow = 60;
  assert.equal(chooseSkill(heal, view({ hpPct: 90 })), 'smite');
  assert.equal(chooseSkill(heal, view({ hpPct: 40 })), 'mend', 'heals below the configured HP');
  const rain = skillCfg(['healing_rain']);
  assert.equal(chooseSkill(rain, view({ hpPct: 100 })), null);
  assert.equal(chooseSkill(rain, view({ hpPct: 30 })), 'healing_rain', 'Healing Rain when HP is below its threshold');
  // a disabled skill is never chosen
  assert.equal(chooseSkill({ ...cfg, skillList: cfg.skillList.map((s) => ({ ...s, on: false })) }, view()), null);
});

test('M11 auto target: the nearest valid monster in the hunting area; steady; never bosses; elites and unreachable ones by rule', () => {
  const me = { x: 1000, y: 1000 }, anchor = me, R = 12 * TILE, ok = () => true, none = () => false;
  const mobs: TargetView[] = [
    { id: -1, type: 'mossling', x: 1200, y: 1000, hp: 60 }, { id: -2, type: 'boar', x: 1080, y: 1000, hp: 100 }, { id: -3, type: 'old_tusk', x: 1040, y: 1000, hp: 900 },
    { id: -4, type: 'rune_guardian', x: 1010, y: 1000, hp: 9999 }, { id: -5, type: 'boar', x: 1020, y: 1000, hp: 0 }, { id: -6, type: 'boar', x: 1000 + R + 50, y: 1000, hp: 100 },
  ];
  const cfg = autoCfg();
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, 0, ok, none), -2, 'nearest living ordinary monster (not the elite, the boss or the corpse)');
  assert.equal(chooseTarget(autoCfg({ elites: true }), me, anchor, R, mobs, 0, ok, none), -3, 'elites when allowed');
  assert.equal(autoTargetable(autoCfg({ elites: true }), 'rune_guardian'), false, 'bosses never');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, -1, ok, none), -1, 'the current target is kept though another is nearer: no flitting');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, -3, ok, none), -3, 'a target the player picked by hand is honoured');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, -4, ok, none), -2, 'but not a boss');
  assert.equal(chooseTarget(autoCfg({ bosses: true }), me, anchor, R, mobs, -4, ok, none), -4, 'unless bosses are allowed: then a hand-picked boss is fought');
  assert.equal(chooseTarget(autoCfg({ bosses: true }), me, anchor, R, mobs, 0, ok, none), -4, 'and the nearest boss is chosen like any other monster');
  assert.equal(cleanAutoConfig({ bosses: 'yes' }).bosses, false, 'off unless set to true');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, -5, ok, none), -2, 'a dead target is replaced');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, -6, ok, none), -2, 'a target outside the hunting area is dropped');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, 0, (m) => m.x !== 1080, none), -1, 'unreachable monsters are not chosen');
  assert.equal(chooseTarget(cfg, me, anchor, R, mobs, 0, ok, (id) => id === -2), -1, 'nor ones recently given up on');
  assert.equal(chooseTarget(autoCfg({ target: false }), me, anchor, R, mobs, 0, ok, none), 0, 'auto target off: nothing is picked');
  assert.equal(chooseTarget(autoCfg({ target: false }), me, anchor, R, mobs, -1, ok, none), -1, 'but a hand-picked target is fought');
  assert.equal(chooseTarget(cfg, me, anchor, 2 * TILE, mobs, 0, ok, none), 0, 'a small hunting radius holds nothing valid'); // only the elite, the boss and a corpse are inside 64 px
  // loot rules
  assert.equal(lootAllowed(autoCfg(), 'longsword', 0), true);
  assert.equal(lootAllowed(autoCfg({ loot: false }), 'longsword', 5), false, 'auto loot off: no items');
  assert.deepEqual(['longsword', 'hp_potion', 'upgrade_stone'].map((b) => lootAllowed(autoCfg({ lootMode: 'equip' }), b, 0)), [true, false, false]);
  assert.deepEqual([0, 1, 2, 4].map((r) => lootAllowed(autoCfg({ lootMode: 'rare' }), 'longsword', r)), [false, false, true, true]);
  assert.deepEqual(['longsword', 'hp_potion', 'upgrade_stone'].map((b) => lootAllowed(autoCfg({ ignore: ['potion', 'material'] }), b, 0)), [true, false, false]);
});

test('M11 server session: figures, loot rules, and every way a session ends; the configuration is stored', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 20), p = a.p;
  const autoMsgs = () => a.out.filter((m) => m.t === 'auto');
  assert.deepEqual(a.out.find((m) => m.t === 'welcome').auto, DEFAULT_AUTO, 'the saved configuration arrives with the character');
  world.auto(p, { on: true, cfg: { ...DEFAULT_AUTO, hpPct: 500, lootMode: 'equip', skillList: [{ id: 'resurrection' }] } });
  assert.equal(p.autoOn, true);
  assert.deepEqual([p.autoCfg.hpPct, p.autoCfg.lootMode, p.autoCfg.skillList.length], [95, 'equip', 0], 'the server sanitises what it stores');
  assert.equal(p.autoCfgDirty, true, 'and saves it with the character');
  assert.equal(autoMsgs().pop().on, true);
  // a kill: counted, EXP counted, loot filtered by the rules (equipment only), gold always
  const m = world.spawn(p.room, 'mossling', p.x + 30, p.y);
  world.hurt(m, 1e6, 0, p);
  assert.equal(p.autoStats.kills, 1);
  assert.ok(p.autoStats.exp > 0);
  const gold0 = p.gold, inv0 = p.inv.length;
  award(world, p, 25, [spec('longsword', { rar: 2 }), spec('hp_potion'), spec('upgrade_stone')], true);
  assert.equal(p.gold, gold0 + 25);
  assert.deepEqual(p.inv.slice(inv0).map((i) => i.base), ['longsword'], 'only what the loot rules allow is collected');
  assert.deepEqual([p.autoStats.items, p.autoStats.skipped], [1, 2]);
  // loot that is not from hunting (a boss, a cache) is never filtered
  award(world, p, 0, [spec('hp_potion')]);
  assert.ok(p.inv.some((i) => i.base === 'hp_potion'));
  // auto loot off: gold only
  world.auto(p, { on: true, cfg: { ...DEFAULT_AUTO, loot: false } });
  const n = p.inv.length;
  award(world, p, 10, [spec('greatsword', { rar: 5 })], true);
  assert.equal(p.inv.length, n);
  // a full bag stops the session when configured
  world.auto(p, { on: true, cfg: { ...DEFAULT_AUTO, onFull: 'stop' } });
  while (p.inv.length < INVENTORY_SIZE) give(p, spec('cloth_robe'));
  award(world, p, 0, [spec('cloth_hood')], true);
  assert.equal(p.autoOn, false);
  assert.match(autoMsgs().pop().why, /inventory is full/i);
  p.inv.length = 0;
  // stop on request
  world.auto(p, { on: true });
  world.auto(p, { on: false });
  assert.deepEqual([p.autoOn, autoMsgs().pop().on], [false, false]);
  // death
  world.auto(p, { on: true });
  world.hurt(p, 1e9, 0, null);
  assert.equal(p.autoOn, false);
  assert.match(autoMsgs().pop().why, /died/);
  world.auto(p, { on: true });
  assert.equal(p.autoOn, false, 'cannot start while dead');
  step(Math.ceil(RESPAWN_MIN_MS / TICK_MS) + 2);
  world.requestRespawn(p);
  // leaving the zone
  world.auto(p, { on: true });
  world.relocate(p, world.roomIn('verdant'), tileCenter(ZONES.verdant.spawn.tx), tileCenter(ZONES.verdant.spawn.ty));
  assert.equal(p.autoOn, false);
  // losing the connection
  world.auto(p, { on: true });
  world.disconnect(p, a.conn);
  assert.equal(p.autoOn, false, 'nothing hunts for a disconnected player');
  // junk is ignored
  for (const junk of [null, 5, 'on', { on: 'true' }]) world.auto(p, junk);
  assert.equal(p.autoOn, false);
});

test('M11 server authority under automation: attack interval, potions and cooldowns hold however often commands arrive', () => {
  const { world, join, step } = harness();
  const { p, out } = join(0, 0, 'mage', 10);
  grant(p, ['arcane_bolt']);
  world.auto(p, { on: true });
  const m = world.spawn(p.room, 'rootwarden', p.x + 60, p.y);
  (m as any).def = { ...m.def, aggro: 0, atk: 0 };
  world.setTarget(p, m.id);
  const TICKS = 100;
  const hits = () => snaps(out).flatMap((s) => s.dm ?? []).filter((d: any) => d[0] === m.id && d[3] === p.id).length;
  for (let i = 0; i < TICKS; i++) {
    world.action(p, Act.Attack); // an attack command every single tick
    step();
  }
  const swings = hits(), most = Math.ceil((TICKS * TICK_MS) / p.stats.atkIntervalMs) + 1;
  assert.ok(swings >= 2 && swings <= most, `${swings} attacks in ${TICKS} ticks; the attack interval allows at most ${most}`);
  world.setTarget(p, 0);
  step(Math.ceil(p.stats.atkIntervalMs / TICK_MS) + 2);
  const before = hits();
  for (let i = 0; i < TICKS; i++) {
    world.use(p, 'arcane_bolt', m.id); // a skill command every tick
    step();
  }
  const casts = hits() - before;
  assert.ok(casts >= 2 && casts <= Math.ceil((TICKS * TICK_MS) / ABILITIES.arcane_bolt.cdMs) + 1, `${casts} casts in ${TICKS} ticks: the cooldown is the server's`);
  // potions: refused when full, when on cooldown, and when there is none
  give(p, spec('hp_potion', { qty: 2 }));
  const hp = p.inv.find((i) => i.base === 'hp_potion')!;
  world.hurt(m, 1e9, 0, null);
  p.hp = p.maxHp;
  const q0 = hp.qty;
  assert.equal(world.inventory(p, { op: 'use', uid: hp.uid }), 'Already at full health');
  assert.equal(hp.qty, q0, 'nothing is consumed by a refused potion');
  p.hp = 10;
  assert.equal(world.inventory(p, { op: 'use', uid: hp.uid }), '');
  assert.equal(world.inventory(p, { op: 'use', uid: hp.uid }), 'Potions are on cooldown');
  assert.equal(hp.qty, q0 - 1);
  assert.equal(world.inventory(p, { op: 'use', uid: 'no-such-item' }), 'Item not found');
  // a target out of range is refused by the server whatever the client claims
  const far = world.spawn(p.room, 'mossling', p.x + 600, p.y);
  step(30);
  assert.equal(world.use(p, 'arcane_bolt', far.id), 'Out of range');
});

test('bulk sale: several items in one step at a shop, all or nothing', () => {
  const { world, join } = harness();
  const { p, out } = join(0, 40, 'knight', 10);
  for (const s of [spec('longsword', { rar: 0, ilvl: 5 }), spec('greatsword', { rar: 1, ilvl: 5 }), spec('cloth_robe', { rar: 3, ilvl: 5 }), spec('upgrade_stone', { qty: 7 })]) give(p, s);
  const [a, b, c, stones] = p.inv, worth = (i: Item) => sellValue(i) * i.qty;
  const expect = worth(a) + worth(b) + worth(stones), gold = p.gold;
  assert.equal(world.inventory(p, { op: 'sellall', uids: [] }), 'Nothing selected');
  assert.equal(world.inventory(p, { op: 'sellall', uids: 'all' }), 'Nothing selected');
  assert.equal(world.inventory(p, { op: 'sellall', uids: [a.uid, 'ghost'] }), 'Item not found');
  assert.equal(world.inventory(p, { op: 'sellall', uids: [a.uid, a.uid] }), 'Invalid selection', 'an item cannot be sold twice in one request');
  assert.equal(world.inventory(p, { op: 'sellall', uids: [a.uid, 7] }), 'Invalid selection');
  assert.deepEqual([p.gold, p.inv.length], [gold, 4], 'a refused sale sells nothing');
  world.inventory(p, { op: 'equip', uid: a.uid });
  assert.equal(world.inventory(p, { op: 'sellall', uids: [a.uid] }), 'Item not found', 'equipped items are not in the bag');
  world.inventory(p, { op: 'unequip', slot: 'weapon' });
  assert.equal(world.inventory(p, { op: 'sellall', uids: [a.uid, b.uid, stones.uid] }), '');
  assert.equal(p.gold, gold + expect, 'the whole stack and every item, at the normal sell value');
  assert.deepEqual(p.inv.map((i) => i.uid), [c.uid]);
  assert.ok(out.some((m) => m.t === 'sys' && /Sold 3 items/.test(m.text)));
  world.relocate(p, p.room, p.x + 1500, p.y);
  assert.equal(world.inventory(p, { op: 'sellall', uids: [c.uid] }), 'You need to be at a shop');
});

test('inventory sorting: merges stacks and orders the bag on the server', () => {
  const { world, join } = harness();
  const { p } = join(0, 0, 'knight', 10);
  for (const s of [spec('upgrade_stone', { qty: 3 }), spec('cloth_robe', { rar: 1, ilvl: 3 }), spec('hp_potion', { qty: 5 }), spec('greatsword', { rar: 4, ilvl: 9 }), spec('longsword', { rar: 2, ilvl: 6 })]) give(p, s);
  // two partial stacks of the same potion, as trading or selling can leave behind
  p.inv.push({ ...spec('hp_potion', { qty: 4 }), uid: 'extra-stack' });
  const bases = () => p.inv.map((i) => i.base);
  assert.equal(world.inventory(p, { op: 'sort', by: 'sideways' }), 'Unknown sort order');
  assert.equal(world.inventory(p, { op: 'sort', by: 'kind' }), '');
  assert.deepEqual(bases(), ['greatsword', 'longsword', 'cloth_robe', 'hp_potion', 'upgrade_stone'], 'by type: weapons, armour, potions, materials; stacks merged');
  assert.equal(p.inv.find((i) => i.base === 'hp_potion')!.qty, 9, 'the two potion stacks became one');
  world.inventory(p, { op: 'sort', by: 'rarity' });
  assert.deepEqual(p.inv.slice(0, 3).map((i) => i.rar), [4, 2, 1]);
  world.inventory(p, { op: 'sort', by: 'level' });
  assert.deepEqual(p.inv.slice(0, 3).map((i) => i.ilvl), [9, 6, 3]);
  world.inventory(p, { op: 'sort', by: 'name' });
  assert.deepEqual(bases(), [...bases()].sort((x, y) => ITEMS[x].name.localeCompare(ITEMS[y].name)));
  world.inventory(p, { op: 'sort', by: 'value' });
  const v = p.inv.map((i) => sellValue(i) * i.qty);
  assert.deepEqual(v, [...v].sort((x, y) => y - x));
  assert.equal(p.invDirty, true, 'the new order is saved');
  assert.equal(new Set(p.inv.map((i) => i.uid)).size, p.inv.length);
  sortInventory(p, 'kind');
  assert.equal(p.inv.reduce((n, i) => n + i.qty, 0), 3 + 1 + 9 + 1 + 1, 'sorting never creates or destroys anything');
});

test('trading: invitation, offers, confirmation reset on change, atomic exchange, audit record', () => {
  const { world, join, trades } = harness({ capacity: 10 });
  const A = join(0, 0, 'knight', 10), B = join(60, 0, 'mage', 10), C = join(0, 60, 'ranger', 10), a = A.p, b = B.p;
  const state = (x: typeof A) => x.out.filter((m) => m.t === 'trade').pop()?.trade;
  give(a, spec('longsword', { rar: 3, ilvl: 8, aff: [['atk', 3]] }));
  give(a, spec('upgrade_stone', { qty: 10 }));
  give(b, spec('cloth_robe', { rar: 2, ilvl: 7 }));
  a.gold = 500;
  b.gold = 80;
  const sword = a.inv[0], stones = a.inv[1], robe = b.inv[0];
  const totals = () => [a.gold + b.gold, [...a.inv, ...b.inv].reduce((n, i) => n + i.qty, 0)];
  const before = totals();
  // invitation
  assert.equal(world.trade(a, { op: 'invite', id: a.id }), 'Player not found', 'not with yourself');
  assert.equal(world.trade(a, { op: 'offer', uid: sword.uid }), 'You are not trading');
  assert.equal(world.trade(a, { op: 'invite', id: b.id }), '');
  assert.equal(B.out.filter((m) => m.t === 'tinv').pop().from, a.name);
  assert.equal(world.trade(a, { op: 'invite', name: b.name }), 'Wait a moment before inviting again');
  assert.equal(world.trade(b, { op: 'accept' }), '');
  assert.equal(state(A).with.name, b.name);
  assert.equal(world.trade(C.p, { op: 'invite', id: a.id }), `${a.name} is already trading`);
  // offers
  assert.equal(world.trade(a, { op: 'offer', uid: robe.uid }), 'Item not found in your bag', 'only your own items');
  assert.equal(world.trade(a, { op: 'offer', uid: sword.uid }), '');
  assert.equal(world.trade(a, { op: 'offer', uid: stones.uid, qty: 4 }), '');
  assert.equal(world.trade(a, { op: 'gold', gold: 501 }), 'You do not have that much gold');
  assert.equal(world.trade(a, { op: 'gold', gold: -5 }), 'Invalid amount of gold');
  assert.equal(world.trade(a, { op: 'gold', gold: 1.5 }), 'Invalid amount of gold');
  assert.equal(world.trade(a, { op: 'gold', gold: 120 }), '');
  assert.equal(world.trade(b, { op: 'offer', uid: robe.uid }), '');
  assert.deepEqual(state(B).theirs.items.map((i: Item) => [i.base, i.qty]), [['longsword', 1], ['upgrade_stone', 4]], 'each sees the other side of the table');
  assert.equal(state(B).theirs.gold, 120);
  // items on the table are locked
  for (const op of ['sell', 'destroy', 'equip', 'upgrade']) assert.equal(world.inventory(a, { op, uid: sword.uid }), 'That item is in your trade offer', op);
  assert.equal(world.inventory(a, { op: 'sellall', uids: [stones.uid] }), 'An item is in your trade offer');
  // a change after one side confirmed clears both confirmations
  assert.equal(world.trade(b, { op: 'confirm' }), '');
  assert.equal(state(A).theirs.ok, true);
  assert.equal(world.trade(a, { op: 'gold', gold: 20 }), '', 'A lowers the gold after B confirmed');
  assert.deepEqual([state(B).mine.ok, state(B).theirs.ok, state(B).theirs.gold], [false, false, 20], 'B\'s confirmation is gone, and B sees the new offer');
  assert.deepEqual(totals(), before, 'nothing has moved');
  assert.equal(world.trade(a, { op: 'confirm' }), '');
  assert.equal(world.trade(a, { op: 'remove', uid: stones.uid }), '');
  assert.equal(state(A).mine.ok, false, 'changing your own offer also clears your own confirmation');
  assert.equal(world.trade(a, { op: 'offer', uid: stones.uid, qty: 4 }), '');
  // both confirm: the exchange
  assert.equal(world.trade(a, { op: 'confirm' }), '');
  assert.equal(trades.length, 0);
  assert.equal(world.trade(b, { op: 'confirm' }), '');
  assert.deepEqual([a.gold, b.gold], [480, 100]);
  assert.deepEqual(a.inv.map((i) => [i.base, i.qty]), [['upgrade_stone', 6], ['cloth_robe', 1]]);
  assert.deepEqual(b.inv.map((i) => [i.base, i.qty, i.rar, i.ilvl]), [['longsword', 1, 3, 8], ['upgrade_stone', 4, 0, 1]], 'items arrive exactly as they were');
  assert.deepEqual(b.inv[0].aff, [['atk', 3]]);
  assert.deepEqual(totals(), before, 'gold and items are conserved: nothing duplicated, nothing lost');
  assert.equal(new Set([...a.inv, ...b.inv].map((i) => i.uid)).size, a.inv.length + b.inv.length, 'every item instance is unique');
  assert.equal(state(A), null);
  assert.ok(A.out.some((m) => m.t === 'trade' && m.done));
  assert.ok(B.out.some((m) => m.t === 'sys' && /Trade with .* complete\. You received: Longsword and Kite Shield, Upgrade Stone x4, 20 gold/.test(m.text)));
  // stored in one transaction with an audit record
  assert.equal(trades.length, 1);
  assert.deepEqual([trades[0].a.id, trades[0].b.id, trades[0].a.gold, trades[0].b.gold], [a.id, b.id, 480, 100], 'both inventories are stored together');
  assert.deepEqual(trades[0].log.a, { id: a.id, name: a.name, gold: 20, items: [spec('longsword', { rar: 3, ilvl: 8, aff: [['atk', 3]] }), spec('upgrade_stone', { qty: 4 })] });
  assert.deepEqual(trades[0].log.b.items.map((i: any) => i.base), ['cloth_robe']);
  assert.equal(world.trades.completed, 1);
  assert.equal(world.inventory(b, { op: 'destroy', uid: b.inv[0].uid }), '', 'received items are ordinary items again');
});

test('trading: cancelled by distance, death, disconnection or leaving; refused for lack of space or missing items; nothing moves', () => {
  const { world, join, trades, step } = harness({ capacity: 10 });
  const A = join(0, 0, 'knight', 10), B = join(60, 0, 'mage', 10), a = A.p, b = B.p;
  const open = () => {
    a.lastTradeInvite = 0;
    assert.equal(world.trade(a, { op: 'invite', id: b.id }), '');
    assert.equal(world.trade(b, { op: 'accept' }), '');
  };
  const cancelled = (x: typeof A, re: RegExp) => x.out.some((m) => m.t === 'sys' && re.test(m.text)) && x.out.filter((m) => m.t === 'trade').pop().trade === null;
  give(a, spec('longsword'));
  a.gold = 100;
  const snapshot = () => JSON.stringify([a.gold, a.inv, b.gold, b.inv]), s0 = snapshot();
  // too far to start
  world.relocate(b, b.room, a.x + TRADE_RANGE + 50, a.y);
  assert.equal(world.trade(a, { op: 'invite', id: b.id }), 'Too far away to trade');
  world.relocate(b, b.room, a.x + 60, a.y);
  // walking away ends it
  open();
  world.trade(a, { op: 'offer', uid: a.inv[0].uid });
  world.trade(a, { op: 'confirm' });
  world.relocate(b, b.room, a.x + TRADE_RANGE + 50, a.y);
  world.trades.tick(Date.now());
  assert.ok(cancelled(A, /too far away/) && cancelled(B, /too far away/));
  assert.equal(world.trade(b, { op: 'confirm' }), 'You are not trading');
  world.relocate(b, b.room, a.x + 60, a.y);
  // an expired invitation
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: b.id });
  world.trades.tick(Date.now() + 31_000);
  assert.equal(world.trade(b, { op: 'accept' }), 'The trade request has expired');
  // declined
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: b.id });
  assert.equal(world.trade(b, { op: 'decline' }), '');
  assert.ok(A.out.some((m) => m.t === 'sys' && /declined your trade request/.test(m.text)));
  // death
  open();
  world.hurt(b, 1e9, 0, null);
  assert.ok(cancelled(A, /a player died/));
  step(Math.ceil(RESPAWN_MIN_MS / TICK_MS) + 2);
  world.requestRespawn(b);
  world.relocate(b, b.room, a.x + 60, a.y);
  // disconnection
  open();
  world.disconnect(b, B.conn);
  assert.ok(cancelled(A, /disconnected/));
  const B2 = join(0, 0, 'mage', 10); // a different character to continue with
  const c = B2.p;
  // cancel button
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: c.id });
  world.trade(c, { op: 'accept' });
  world.trade(a, { op: 'cancel' });
  assert.ok(cancelled(B2, /cancelled the trade/));
  // no room in the receiver's bag: refused at confirmation, nothing moves
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: c.id });
  world.trade(c, { op: 'accept' });
  while (c.inv.length < INVENTORY_SIZE) give(c, spec('cloth_hood'));
  world.trade(a, { op: 'offer', uid: a.inv[0].uid });
  assert.match(world.trade(a, { op: 'confirm' }) as string, /does not have enough bag space/);
  // ... unless the receiver gives something back that frees a slot
  world.trade(c, { op: 'offer', uid: c.inv[0].uid });
  assert.equal(world.trade(a, { op: 'confirm' }), '');
  assert.equal(world.trade(c, { op: 'confirm' }), '');
  assert.equal(c.inv.filter((i) => i.base === 'longsword').length, 1);
  assert.equal(a.inv.filter((i) => i.base === 'cloth_hood').length, 1);
  assert.equal(c.inv.length, INVENTORY_SIZE);
  // gold spent after it was offered: the exchange re-checks and cancels
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: c.id });
  world.trade(c, { op: 'accept' });
  world.trade(a, { op: 'gold', gold: 100 });
  world.trade(c, { op: 'confirm' });
  a.gold = 10; // as if spent at a shop meanwhile
  assert.match(world.trade(a, { op: 'confirm' }) as string, /does not have the gold offered/);
  assert.deepEqual([a.gold, c.gold], [10, 0]);
  world.trade(a, { op: 'cancel' });
  // the item limit
  c.inv.length = 0;
  for (let i = 0; i < TRADE_MAX_ITEMS + 1; i++) give(c, spec('cloth_robe', { ilvl: i + 1 }));
  a.lastTradeInvite = 0;
  world.trade(a, { op: 'invite', id: c.id });
  world.trade(c, { op: 'accept' });
  for (let i = 0; i < TRADE_MAX_ITEMS; i++) assert.equal(world.trade(c, { op: 'offer', uid: c.inv[i].uid }), '');
  assert.equal(world.trade(c, { op: 'offer', uid: c.inv[TRADE_MAX_ITEMS].uid }), `At most ${TRADE_MAX_ITEMS} items per trade`);
  for (const junk of [null, 'x', { op: 'steal' }, { op: 'offer', uid: 5 }, { op: 'gold', gold: '100' }]) assert.notEqual(world.trade(c, junk), '', JSON.stringify(junk));
  assert.equal(trades.length, 1, 'only the one completed trade was stored');
  assert.ok(s0.length > 0);
});

// ---------------------------------------------------------------------------------------------
// M12: rune acquisition (merchant, scrolls, drops), skill icons, asset pipeline
// ---------------------------------------------------------------------------------------------
import { addRuneXp, applyScroll, BOSS_SCROLL, ownedRunes, ownsRune, rollScroll, RUNE_SHOP, RUNE_STOCK, runePrice, SCROLLS } from '../shared/src/runes';
import { SCROLL_DROP } from '../shared/src/items';
import { RUNE_MAX_LEVEL } from '../shared/src/abilities';
import { RUNE_SHOP_RANGE } from '../shared/src/places';
import { handMadeSkillIcons, ICON_SIZE, iconManifest } from '../client/src/game/skillicons';
import { describe as describeAsset, ENTRY_TYPES, entryKey, iconKnown } from '../scripts/assets';
import { FRAME_H as FRAME_H_PX } from '../shared/src/appearance';

const runesmith = (zone = 'eldoria') => zoneObjects(zone).find((o) => o.kind === 'runesmith')!;

test('M12 rune ownership: nothing is owned at the start, a rune must be obtained before it is attuned, and older characters keep theirs', () => {
  const { world, join } = harness();
  const { p } = join(0, 0, 'mage', 10);
  assert.deepEqual(ownedRunes(p.build), [], 'a new character owns no rune');
  for (const el of ELEMENTS) assert.equal(world.attune(p, 0, el), 'You do not own that rune yet', el);
  assert.equal(world.use(p, 'fireball', 0), 'Rune not attuned');
  // owning, equipping and upgrading are three different things
  p.build.runes.lv.fire = 1;
  assert.equal(ownsRune(p.build, 'fire'), true);
  assert.deepEqual(p.build.runes.slots, [null, null, null], 'owned is not yet equipped');
  assert.equal(world.attune(p, 0, 'fire'), '');
  assert.equal(world.attune(p, 0, null), '', 'unequipping keeps the rune');
  assert.equal(ownsRune(p.build, 'fire'), true);
  assert.equal(addRuneXp(p.build, 'fire', runeExpToNext(1) + 5), 1, 'experience levels the rune up');
  assert.deepEqual([p.build.runes.lv.fire, p.build.runes.xp.fire], [2, 5]);
  assert.equal(addRuneXp(p.build, 'fire', 1e9), RUNE_MAX_LEVEL - 2, 'and stops at the maximum level');
  assert.deepEqual([p.build.runes.lv.fire, p.build.runes.xp.fire], [RUNE_MAX_LEVEL, 0]);
  // a character saved before M12 with runes attuned or levelled still owns them
  const old = cleanBuild('mage', 20, { skills: {}, runes: { slots: ['water', null, 'wind'], lv: { water: 4, earth: 2 }, xp: { water: 30 } } });
  assert.deepEqual(ownedRunes(old).sort(), ['earth', 'water', 'wind']);
  assert.deepEqual(old.runes.slots, ['water', null, 'wind']);
});

test('M12 Rune Scrolls: reward tables, one scroll consumed per reading, no double use, never overwriting a rune', () => {
  // the tables
  assert.deepEqual(Object.keys(SCROLLS).sort(), ['scroll_advanced', 'scroll_earth', 'scroll_fire', 'scroll_lightning', 'scroll_random', 'scroll_rare', 'scroll_water', 'scroll_wind']);
  for (const id of Object.keys(SCROLLS)) assert.ok(ITEMS[id]?.kind === 'scroll' && (ITEMS[id].stack ?? 1) > 1 && ITEMS[id].desc.length > 20, `${id} is an inventory item`);
  const none = emptyBuild('mage');
  for (const el of ELEMENTS) assert.deepEqual(rollScroll(Math.random, `scroll_${el}`, none), { el, isNew: true, xp: 0 }, `the ${el} scroll always gives ${el}`);
  const rnd = mulberryTest(7), seen: Record<string, number> = {};
  for (let i = 0; i < 5000; i++) seen[rollScroll(rnd, 'scroll_random', none)!.el] = (seen[rollScroll(rnd, 'scroll_random', none)!.el] ?? 0) + 1;
  for (const el of ELEMENTS) assert.ok(seen[el] > 800 && seen[el] < 1200, `random scroll: ${el} about one time in five (${seen[el]} of 5000)`);
  // the rare scroll goes for a rune that is still missing, and only then for experience
  const four = emptyBuild('mage');
  for (const el of ['fire', 'water', 'earth', 'wind'] as Element[]) four.runes.lv[el] = 1;
  for (let i = 0; i < 50; i++) assert.deepEqual(rollScroll(rnd, 'scroll_rare', four), { el: 'lightning', isNew: true, xp: SCROLLS.scroll_rare.bonusXp });
  four.runes.lv.lightning = 1;
  const dup = rollScroll(rnd, 'scroll_rare', four)!;
  assert.deepEqual([dup.isNew, dup.xp], [false, SCROLLS.scroll_rare.xpDup], 'with all five owned it is experience');
  assert.equal(rollScroll(rnd, 'hp_potion', four), null);
  assert.equal(applyScroll(four, { el: 'fire', isNew: false, xp: 60 }), 1, 'an owned rune gains experience (and here a level)');
  assert.equal(four.runes.lv.fire, 2, 'it is strengthened, never reset');

  // reading on the server
  const { world, join } = harness({ rng: () => 0.01 });
  const { p, out } = join(0, 0, 'mage', 10);
  give(p, spec('scroll_fire', { qty: 2 }));
  give(p, spec('hp_potion'));
  const scroll = p.inv[0], potion = p.inv[1];
  assert.equal(world.inventory(p, { op: 'scroll', uid: potion.uid }), 'That is not a Rune Scroll');
  assert.equal(world.inventory(p, { op: 'scroll', uid: 'nope' }), 'That is not a Rune Scroll');
  assert.equal(world.inventory(p, { op: 'use', uid: scroll.uid }), 'Cannot be used', 'a scroll is read, not drunk');
  assert.equal(world.inventory(p, { op: 'scroll', uid: scroll.uid }), '');
  assert.equal(scroll.qty, 1, 'one scroll consumed');
  assert.equal(ownsRune(p.build, 'fire'), true);
  assert.deepEqual(out.filter((m) => m.t === 'rune').pop(), { t: 'rune', el: 'fire', isNew: true, xp: 0, levels: 0 });
  assert.equal(p.buildDirty, true, 'the new rune is saved');
  assert.ok(out.some((m) => m.t === 'sys' && /unlocks the Fire Rune/.test(m.text)));
  p.build.runes.lv.fire = 3;
  p.build.runes.xp.fire = 7;
  assert.equal(world.inventory(p, { op: 'scroll', uid: scroll.uid }), '');
  assert.deepEqual([p.build.runes.lv.fire, p.build.runes.xp.fire], [3, 7 + SCROLLS.scroll_fire.xpDup], 'the second scroll strengthens the rune instead of replacing it');
  assert.equal(out.filter((m) => m.t === 'rune').pop().isNew, false);
  assert.equal(p.inv.some((i) => i.base === 'scroll_fire'), false, 'both scrolls are gone');
  // the same scroll cannot be read again: the item no longer exists
  assert.equal(world.inventory(p, { op: 'scroll', uid: scroll.uid }), 'That is not a Rune Scroll');
  assert.deepEqual([p.build.runes.lv.fire, p.build.runes.xp.fire], [3, 7 + SCROLLS.scroll_fire.xpDup], 'nothing more was granted');
  // dead players cannot read
  give(p, spec('scroll_wind'));
  world.hurt(p, 1e9, 0, null);
  assert.equal(world.inventory(p, { op: 'scroll', uid: p.inv.find((i) => i.base === 'scroll_wind')!.uid }), 'You are dead');
});

test('M12 Rune Merchant: in every town, sells runes and scrolls for gold, checks level, distance, gold and ownership', () => {
  for (const z of REGIONS) {
    const npc = runesmith(z), t = ZONES[z].town!;
    assert.ok(npc && isNpc(npc) && npc.name.length > 5, `${z} has a Rune Merchant`);
    assert.ok(Math.hypot(npc.x / TILE - t.tx, npc.y / TILE - t.ty) < 8, 'in town');
    assert.equal(blocked(getZoneMap(z), npc.x, npc.y), false, 'standing on open ground');
  }
  assert.deepEqual(Object.keys(RUNE_SHOP).sort(), [...ELEMENTS].sort(), 'the five rune categories');
  for (const el of ELEMENTS) assert.ok(RUNE_SHOP[el].price > 0 && RUNE_SHOP[el].level >= 1 && RUNE_SHOP[el].blurb.length > 10 && runeSpells(el).length >= 2);
  for (const id of RUNE_STOCK) assert.ok(SCROLLS[id] && ITEMS[id].price > 0);

  const { world, join } = harness();
  const npc = runesmith(), sp = ZONES.eldoria.spawn;
  const { p, out } = join(npc.x - tileCenter(sp.tx) + 20, npc.y - tileCenter(sp.ty), 'mage', 4);
  // the first rune is a gift
  assert.equal(runePrice(p.build, 'water'), 0);
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'plasma' }), 'Unknown rune');
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'lightning' }), `Requires level ${RUNE_SHOP.lightning.level}`);
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'water' }), '');
  assert.deepEqual([ownsRune(p.build, 'water'), p.gold], [true, 0]);
  assert.deepEqual(p.build.runes.slots, [null, null, null], 'bought is not equipped: the player chooses the slot');
  assert.equal(out.filter((m) => m.t === 'rune').pop().isNew, true);
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'water' }), 'You already own that rune');
  // the second costs gold
  assert.equal(runePrice(p.build, 'fire'), RUNE_SHOP.fire.price);
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'fire' }), 'Not enough gold');
  p.gold = RUNE_SHOP.fire.price + 200;
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'fire' }), '');
  assert.equal(p.gold, 200);
  assert.equal(world.attune(p, 0, 'fire'), '');
  // scrolls are sold here, not at the general merchant
  assert.equal(world.inventory(p, { op: 'buy', base: 'scroll_random', qty: 1 }), '');
  assert.deepEqual([p.gold, p.inv.filter((i) => i.base === 'scroll_random').length], [200 - ITEMS.scroll_random.price, 1]);
  assert.equal(world.inventory(p, { op: 'buy', base: 'scroll_rare', qty: 1 }), 'Not for sale', 'boss scrolls are not sold');
  // away from the Rune Merchant nothing can be bought, even standing at the general merchant
  const shop = zoneObjects('eldoria').find((o) => o.kind === 'merchant')!;
  world.relocate(p, p.room, shop.x - RUNE_SHOP_RANGE - 40, shop.y);
  p.gold = 5000;
  assert.equal(world.inventory(p, { op: 'buyrune', el: 'wind' }), 'You need to be at the Rune Merchant');
  assert.equal(world.inventory(p, { op: 'buy', base: 'scroll_random', qty: 1 }), 'You need to be at the Rune Merchant');
  assert.equal(world.inventory(p, { op: 'buy', base: 'hp_potion', qty: 1 }), '', 'the general merchant still sells potions');
  assert.equal(p.gold, 5000 - ITEMS.hp_potion.price);
});

test('M12 rune drops: scrolls from monsters (rare), elites (common), dungeon bosses and world bosses', () => {
  const rnd = mulberryTest(31), N = 20000;
  const rate = (elite: boolean) => {
    let n = 0;
    for (let i = 0; i < N; i++) if (rollLoot(rnd, 5, elite, 'mage').items.some((x) => x.base === 'scroll_random')) n++;
    return n / N;
  };
  const normal = rate(false), elite = rate(true);
  assert.ok(Math.abs(normal - SCROLL_DROP.normal) < 0.005, `ordinary monsters: ${(normal * 100).toFixed(2)}% (configured ${SCROLL_DROP.normal * 100}%)`);
  assert.ok(Math.abs(elite - SCROLL_DROP.elite) < 0.02, `elites: ${(elite * 100).toFixed(1)}% (configured ${SCROLL_DROP.elite * 100}%)`);
  assert.ok(elite > normal * 5);
  // bosses hand a scroll to everyone they reward
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 30);
  const boss = world.spawn(a.p.room, 'rune_guardian', a.p.x + 60, a.p.y);
  boss.noRespawn = true;
  for (let i = 0; i < 10 && !boss.dead; i++) {
    world.hurt(boss, boss.maxHp, 0, a.p);
    step(2);
  }
  assert.ok(boss.dead);
  assert.equal(a.p.inv.filter((i) => i.base === BOSS_SCROLL.normal).length, 1, 'a dungeon boss drops an Advanced Rune Scroll');
  const wb = WORLD_BOSSES[0], b = join(0, 0, 'knight', 60, -1, wb.zone);
  world.relocate(b.p, b.p.room, tileCenter(wb.tx) - 60, tileCenter(wb.ty));
  const wboss = world.spawn(b.p.room, wb.type, tileCenter(wb.tx), tileCenter(wb.ty));
  wboss.noRespawn = true;
  for (let i = 0; i < 12 && !wboss.dead; i++) {
    world.hurt(wboss, wboss.maxHp, 0, b.p);
    step(2);
  }
  assert.ok(wboss.dead);
  assert.ok(b.p.inv.some((i) => i.base === BOSS_SCROLL.world), 'a world boss drops a Rare Rune Scroll');
  assert.deepEqual([BOSS_SCROLL.normal, BOSS_SCROLL.nightmare, BOSS_SCROLL.world], ['scroll_advanced', 'scroll_rare', 'scroll_rare']);
});

test('M12 skill icons: every ability, passive, status, weapon attack and rune has its own icon, mapped by id', () => {
  const m = iconManifest(), ids = m.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate icon ids');
  assert.equal(new Set(m.map((e) => e.file)).size, m.length, 'no two icons share an image file');
  assert.ok(m.every((e) => e.width === ICON_SIZE && e.height === ICON_SIZE && ICON_SIZE === 64), 'one standard size: 64x64');
  assert.ok(m.every((e) => e.file === `icons/${e.kind}/${e.ref}.png` && /^[a-z0-9_]+$/.test(e.ref)));
  for (const a of ABILITY_LIST) assert.ok(ids.includes(`skill/${a.id}`), `${a.id} is in the icon manifest`);
  assert.deepEqual([...handMadeSkillIcons()].sort(), ABILITY_LIST.map((a) => a.id).sort(), 'every active ability has a symbol drawn for it specifically');
  for (const s of STATUS) assert.ok(ids.includes(`status/${s.id}`), `status ${s.id}`);
  for (const el of ELEMENTS) assert.ok(ids.includes(`rune/${el}`));
  for (const j of JOBS) {
    for (const w of JOB_DEFS[j].weapons) assert.ok(ids.includes(`attack/${w.kind}`), `basic attack with ${w.kind}`);
    for (const s of JOB_DEFS[j].skills) assert.ok(ids.includes(`${s.type === 'passive' ? 'passive' : 'skill'}/${s.id}`), `${j}: ${s.id}`);
  }
  assert.ok(m.length >= 100, `${m.length} icons`);
  for (const e of m) assert.ok(iconKnown(e.kind, e.ref), `${e.id} names something in the game data`);
  // the exported templates (assets/templates/icons) hold exactly this set, every file a real 64x64 PNG that differs from all the others
  const seen = new Set<string>();
  for (const e of m) {
    const img = decodePng(fs.readFileSync(path.join('assets/templates', e.file)));
    assert.deepEqual([img.w, img.h], [64, 64], e.id);
    assert.equal(img.data[3], 0, `${e.id}: transparent corner`);
    let opaque = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 255) opaque++;
    assert.ok(opaque > 64 * 64 * 0.3, `${e.id} is a filled tile`); // the hexagonal rune tiles cover less of the square
    seen.add(Buffer.from(img.data).toString('base64'));
  }
  assert.equal(seen.size, m.length, 'no two icons are the same picture');
  const map = JSON.parse(fs.readFileSync('assets/templates/icons/icons.json', 'utf8'));
  assert.deepEqual(map.icons.map((e: any) => e.id).sort(), [...ids].sort(), 'the skill icon manifest on disk matches the game');
});

test('M12 asset pipeline: icons, NPC sheets, tilesets and effects are validated; every fault is reported; metadata is derived', () => {
  const read = (f: string) => decodePng(fs.readFileSync(`assets/templates/${f}`));
  const clone = (i: Image): Image => ({ w: i.w, h: i.h, data: new Uint8Array(i.data) });
  const meta = { source: 'painted for the test', license: 'test only' };
  const rules = (e: SheetEntry, i: Image) => [...new Set(validateSheet(e, i).filter((f) => f.level === 'error').map((f) => f.rule))];
  assert.deepEqual(ENTRY_TYPES, ['monster', 'prop', 'character', 'icon', 'npc', 'tileset', 'vfx']);
  // ---- icons ----
  const icon: SheetEntry = { type: 'icon', kind: 'skill', id: 'fireball', file: 'icons/skill/fireball.png', ...meta }, pic = read(icon.file);
  assert.deepEqual(rules(icon, pic), []);
  assert.deepEqual(rules({ ...icon, source: '' }, pic), ['metadata'], 'missing metadata: no source');
  assert.deepEqual(rules({ ...icon, license: undefined }, pic), ['metadata'], 'missing metadata: no licence');
  assert.deepEqual(rules({ ...icon, id: 'fire_ball', file: 'icons/skill/fire_ball.png' }, pic), ['naming'], 'not a skill in the game');
  assert.deepEqual(rules({ ...icon, file: 'icons/status/fireball.png' }, pic), ['naming'], 'wrong folder');
  assert.deepEqual(rules({ ...icon, file: 'icons/skill/fireball.webp' }, pic).includes('format'), true, 'unsupported format');
  assert.deepEqual(rules(icon, { w: 48, h: 48, data: new Uint8Array(48 * 48 * 4) }), ['dimensions'], 'invalid dimensions');
  assert.deepEqual(rules(icon, { w: 64, h: 32, data: new Uint8Array(64 * 32 * 4) }), ['dimensions']);
  const flat = clone(pic);
  for (let i = 3; i < flat.data.length; i += 4) flat.data[i] = 255;
  assert.deepEqual(rules(icon, flat), ['transparency'], 'no transparent background');
  assert.deepEqual(rules(icon, { w: 64, h: 64, data: new Uint8Array(64 * 64 * 4) }), ['frames'], 'an empty icon');
  assert.deepEqual(rules({ type: 'icon', kind: 'item', id: 'hp_potion', file: 'icons/item/hp_potion.png', ...meta }, { ...clone(pic) }), [], 'item icons may be 64x64 too');
  assert.deepEqual(rules({ type: 'icon', kind: 'rune', id: 'fire', file: 'icons/rune/fire.png', ...meta }, read('icons/rune/fire.png')), []);
  // ---- NPC sheets: a full character sheet, all four directions ----
  const npc: SheetEntry = { type: 'npc', id: 'runesmith', file: 'npcs/runesmith.png', ...meta }, body = read('body/mage_default.png');
  assert.deepEqual(rules(npc, body), []);
  assert.deepEqual(rules({ ...npc, id: 'baker', file: 'npcs/baker.png' }, body), ['naming']);
  assert.deepEqual(rules(npc, { w: 100, h: 100, data: new Uint8Array(40000) }), ['dimensions'], 'incorrect sprite frame sizes');
  const noUp = clone(body);
  noUp.data.fill(0, 3 * FRAME_H_PX * noUp.w * 4);
  assert.deepEqual(rules(npc, noUp), ['direction'], 'a missing animation direction');
  // ---- tilesets ----
  const tiles: SheetEntry = { type: 'tileset', id: 'forest', file: 'tilesets/forest.png', ...meta }, grid = (w: number, h: number): Image => ({ w, h, data: new Uint8Array(w * h * 4).fill(255) });
  assert.deepEqual(rules(tiles, grid(256, 128)), [], 'opaque tiles are fine');
  assert.deepEqual(rules(tiles, grid(250, 128)), ['dimensions'], 'not a whole number of tiles');
  assert.deepEqual(rules({ ...tiles, tile: 24 }, grid(240, 120)), ['dimensions']);
  assert.deepEqual(rules({ ...tiles, id: 'candyland', file: 'tilesets/candyland.png' }, grid(256, 128)), ['naming']);
  // ---- effect strips ----
  const strip = (frames: number, fw = 32, fh = 32): Image => {
    const i: Image = { w: frames * fw, h: fh, data: new Uint8Array(frames * fw * fh * 4) };
    for (let k = 0; k < frames; k++) for (let y = 8; y < 8 + 4 + k; y++) for (let x = 8; x < 20; x++) i.data.set([255, 200, 80, 255], (y * i.w + k * fw + x) * 4);
    return i;
  };
  const fx: SheetEntry = { type: 'vfx', id: 'spark', file: 'vfx/spark.png', frameW: 32, frameH: 32, frames: 6, fps: 12, ...meta };
  assert.deepEqual(rules(fx, strip(6)), []);
  assert.deepEqual(rules(fx, strip(5)), ['dimensions'], 'frame count does not match the strip');
  assert.deepEqual(rules({ ...fx, fps: 0 }, strip(6)), ['metadata']);
  assert.deepEqual(rules({ ...fx, fps: 240 }, strip(6)), ['metadata']);
  const hole = strip(6);
  hole.data.fill(0, 0, 0); // (kept for symmetry)
  for (let y = 0; y < 32; y++) hole.data.fill(0, (y * hole.w + 64) * 4, (y * hole.w + 96) * 4);
  assert.deepEqual(rules(fx, hole), ['frames'], 'an empty frame in the middle');
  // ---- metadata is derived, not typed in ----
  const rec = describeAsset({ type: 'monster', id: 'wolf', file: 'monsters/wolf.png', scale: 1, ...meta }, read('monsters/wolf.png'));
  assert.deepEqual(rec, {
    id: 'monster/wolf', type: 'monster', file: 'monsters/wolf.png', width: 13 * 48, height: 96, transparent: true, source: meta.source, license: meta.license,
    frameWidth: 48, frameHeight: 48, animations: { idle: 2, move: 4, attack: 3, hit: 1, death: 3 }, directions: ['right', 'left'], layerOrder: -1, anchor: [24, 42], fps: 8, associated: 'monster:wolf',
  });
  const layer = describeAsset({ type: 'character', layer: 'hair', item: 'mage_default', file: 'hair/mage_default.png' }, read('hair/mage_default.png'));
  assert.deepEqual([layer.id, layer.directions, layer.layerOrder, layer.anchor, Object.keys(layer.animations).length], ['character/hair/mage_default', ['down', 'left', 'right', 'up'], 4, [24, FRAME_H_PX - 4], 7]);
  assert.deepEqual([describeAsset(fx, strip(6)).animations, describeAsset(fx, strip(6)).fps, describeAsset(icon, pic).associated], [{ play: 6 }, 12, 'skill:fireball']);
  assert.equal(entryKey(icon), 'icon/skill/fireball');

  // ---- a whole folder: one manifest entry per asset, every kind of fault named, valid ones imported with their metadata ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeth-m12-'));
  try {
    const put = (f: string, img: Image | Buffer) => {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.writeFileSync(path.join(tmp, f), Buffer.isBuffer(img) ? img : encodePng(img));
    };
    put('icons/skill/fireball.png', pic);
    put('icons/skill/smite.png', { w: 20, h: 20, data: new Uint8Array(1600) });
    put('icons/status/poison.png', read('icons/status/poison.png'));
    put('vfx/spark.png', strip(6));
    put('icons/rune/fire.png', Buffer.from('this is not a png'));
    put('icons/skill/stray.png', pic);
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ version: 1, sheets: [
      icon, { ...icon }, // the same id twice
      { type: 'icon', kind: 'skill', id: 'smite', file: 'icons/skill/smite.png', ...meta },
      { type: 'icon', kind: 'status', id: 'poison', file: 'icons/status/poison.png' }, // no source or licence
      { type: 'icon', kind: 'skill', id: 'mend', file: 'icons/skill/mend.png', ...meta }, // file missing
      { type: 'icon', kind: 'skill', id: 'cleave', file: 'icons/skill/cleave.gif', ...meta },
      { type: 'icon', kind: 'rune', id: 'fire', file: 'icons/rune/fire.png', ...meta },
      fx, { type: 'hologram', id: 'x', file: 'x.png' },
    ] }));
    const r = validateDir(tmp), errs = r.findings.filter((f) => f.level === 'error');
    const has = (file: string, rule: string, re: RegExp) => errs.some((f) => f.file === file && f.rule === rule && re.test(f.msg));
    assert.ok(has('icons/skill/fireball.png', 'manifest', /duplicate asset id/), 'duplicate asset ids');
    assert.ok(has('icons/skill/smite.png', 'dimensions', /expected a square/), 'invalid dimensions');
    assert.ok(has('icons/status/poison.png', 'metadata', /missing "source"/), 'missing metadata');
    assert.ok(has('icons/skill/mend.png', 'manifest', /missing file/), 'missing files');
    assert.ok(has('icons/skill/cleave.gif', 'format', /unsupported format/), 'unsupported formats');
    assert.ok(has('icons/rune/fire.png', 'format', /./), 'a file that is not really a PNG');
    assert.ok(has('x.png', 'manifest', /entry needs "type"/), 'unknown asset type');
    assert.ok(r.findings.some((f) => f.level === 'warning' && f.file === 'icons/skill/stray.png'), 'a file nobody listed is pointed out');
    assert.deepEqual(r.ok.map(entryKey), ['icon/skill/fireball', 'vfx/spark']);
    assert.deepEqual(r.records.map((x) => [x.id, x.width, x.frameWidth, x.source]), [['icon/skill/fireball', 64, 64, meta.source], ['vfx/spark', 192, 32, meta.source]]);
    const out = path.join(tmp, 'out');
    const run = spawnSync('node_modules/.bin/tsx', ['scripts/import-assets.ts', tmp, out], { encoding: 'utf8' });
    assert.match(run.stdout, /imported 2 of 9 sheets/);
    const built = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(built.assets.map((x: any) => x.id), ['icon/skill/fireball', 'vfx/spark'], 'the build ships the derived metadata of what passed');
    assert.ok(fs.existsSync(path.join(out, 'icons/skill/fireball.png')) && !fs.existsSync(path.join(out, 'icons/skill/smite.png')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // the shipped templates, icons included, all pass
  const all = validateDir('assets/templates');
  assert.equal(all.findings.filter((f) => f.level === 'error').length, 0);
  assert.equal(all.ok.length, all.entries.length);
  assert.ok(all.entries.filter((e) => e.type === 'icon').length >= 100);
});

// ---------------------------------------------------------------------------------------------
// M13: quests and faction reputation
// ---------------------------------------------------------------------------------------------
import {
  acceptBlock, cleanQuests, cleanRep, DEFAULT_FACTIONS, emptyQuests, giverId, MAX_ACTIVE_QUESTS, QUEST_LIST, QUEST_TYPES, QUESTS, REP_GIFT, REP_LEVELS, repLevel, utcDay,
} from '../shared/src/quests';
import { DUNGEONS as DUNGEON_DEFS } from '../shared/src/dungeons';
import { count, sendInv } from '../server/src/game/Inventory';

/** Joins a character standing next to a town's lorekeeper (the quest giver). */
function atGiver(h: ReturnType<typeof harness>, zone: string, job: Job = 'knight', level = 10) {
  const lk = zoneObjects(zone).find((o) => o.kind === 'lorekeeper')!, sp = ZONES[zone].spawn;
  return h.join(lk.x - tileCenter(sp.tx) + 20, lk.y - tileCenter(sp.ty), job, level, -1, zone);
}
const questMsgs = (out: any[]) => out.filter((m) => m.t === 'quests');
/** Kills a monster of a type with the player credited, the way a real fight ends. */
function kill(world: World, p: Player, type: string) {
  const m = world.spawn(p.room, type, p.x + 30, p.y);
  m.noRespawn = true;
  world.hurt(m, 1e9, 0, p);
  return m;
}

test('M13 quest data: every type, valid givers, objectives, prerequisites and rewards', () => {
  assert.deepEqual([...new Set(QUEST_LIST.map((q) => q.type))].sort(), [...QUEST_TYPES].sort(), 'every quest type exists');
  assert.equal(new Set(QUEST_LIST.map((q) => q.id)).size, QUEST_LIST.length, 'unique ids');
  assert.equal(QUEST_LIST.length, REGIONS.length * 7 + STORY_REGIONS.length * 3 + Object.keys(DUNGEON_DEFS).length + WORLD_BOSSES.length);
  const factions = new Set(DEFAULT_FACTIONS.map((f) => f.id));
  for (const q of QUEST_LIST) {
    const giver = objById(giverId(q));
    assert.ok(giver && isNpc(giver) && giver.zone === q.zone && (giver.kind === 'lorekeeper' || !!STORY[q.id]), `${q.id}: given by a townsperson of ${q.zone}`);
    assert.ok(q.name.length > 3 && q.text.length > 20 && q.level >= 1 && q.objectives.length >= 1, q.id);
    for (const o of q.objectives) {
      assert.ok(o.n >= 1 && o.label.length > 3, `${q.id}: objective`);
      if (o.kind === 'kill' && o.mob) assert.ok(MONSTERS[o.mob] && !MONSTERS[o.mob].boss, `${q.id}: ${o.mob}`);
      if (o.kind === 'kill' && o.zone) assert.ok(REGIONS.includes(o.zone));
      if (o.kind === 'collect') assert.equal(ITEMS[o.item]?.kind, 'material');
      if (o.kind === 'discover') assert.equal(o.n, zoneObjects(o.zone).filter((x) => x.kind === 'cache').length, 'as many caches as the zone has');
      if (o.kind === 'clear') assert.ok(DUNGEON_DEFS[o.dungeon]);
      if (o.kind === 'boss') assert.ok(MONSTERS[o.mob]?.boss);
      if (o.kind === 'talk') assert.ok(objById(o.npc) && isNpc(objById(o.npc)!) && objById(o.npc)!.zone === q.zone, `${q.id}: speak to ${o.npc}`);
      if (o.kind === 'loot') assert.ok(MONSTERS[o.mob] && !MONSTERS[o.mob].boss && SPAWNS[q.zone].some((g) => g.type === o.mob) && o.chance > 0 && o.chance <= 1, `${q.id}: loot from ${o.mob}`);
      if (o.kind === 'visit') {
        // the place is on the map and can be walked to (some tile within its radius is open ground)
        const map = getZoneMap(o.zone), T = TILE;
        let open = false;
        for (let y = o.y - o.r; y <= o.y + o.r && !open; y += 16) for (let x = o.x - o.r; x <= o.x + o.r && !open; x += 16) if (Math.hypot(x - o.x, y - o.y) <= o.r && !blocked(map, x, y)) open = true;
        assert.ok(o.zone === q.zone && open && o.x > 0 && o.y > 0 && o.x < map.w * T && o.y < map.h * T, `${q.id}: a reachable place`);
      }
    }
    for (const id of q.prereq) assert.ok(QUESTS[id], `${q.id}: prerequisite ${id}`);
    assert.ok(q.reward.exp > 0 && q.reward.gold > 0, `${q.id}: reward`);
    for (const [b, n] of q.reward.items) assert.ok(ITEMS[b] && n > 0);
    for (const [f, n] of q.reward.rep) assert.ok(factions.has(f) && n > 0, `${q.id}: reputation with ${f}`);
    if (q.rep) assert.ok(factions.has(q.rep[0]) && q.rep[1] > 0);
  }
  // the main story runs region by region
  REGIONS.forEach((z, i) => assert.deepEqual(QUESTS[`main_${z}`].prereq, i ? [`main_${REGIONS[i - 1]}`] : []));
  assert.deepEqual(QUEST_LIST.filter((q) => q.type === 'daily').map((q) => q.repeat), REGIONS.map(() => 'day'));
  // reputation levels
  assert.deepEqual(REP_LEVELS.map((l) => l.name), ['Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted']);
  assert.deepEqual([0, 499, 500, 1499, 1500, 9000, 99999].map(repLevel), [0, 0, 1, 1, 2, 4, 4]);
  for (const f of DEFAULT_FACTIONS) {
    assert.ok(REGIONS.includes(f.region) && f.shop.length >= 3, `${f.id} has a seat and a shop`);
    for (const [b, price, lv] of f.shop) assert.ok(ITEMS[b] && price > 0 && lv >= 0 && lv < REP_LEVELS.length, `${f.id} sells ${b}`);
  }
});

test('G3 the main story: a chapter in every region, three chained steps, dialogue, every new objective on the server', () => {
  assert.equal(STORY_REGIONS.length, REGIONS.length, 'every region has a chapter');
  for (const z of STORY_REGIONS) {
    const [s1, s2, s3] = [1, 2, 3].map((n) => QUESTS[`story_${z}_${n}`]);
    assert.deepEqual([s1.prereq, s2.prereq, s3.prereq], [[`main_${z}`], [s1.id], [s2.id]], `${z}: the steps follow the region's main quest`);
    for (const q of [s1, s2, s3]) assert.ok(q.type === 'main' && q.intro!.length >= 1 && q.outro!.length >= 1 && q.intro!.every(([who, line]) => who && line.length > 10), `${q.id}: spoken lines`);
    assert.equal(giverId(s2), s1.objectives.find((o) => o.kind === 'talk')!.kind === 'talk' ? (s1.objectives[0] as any).npc : '', `${z}: step 2 comes from the person step 1 sends you to`);
    for (const [who] of [...s1.intro!, ...s3.outro!]) assert.ok(speakerName(who, z).length > 2);
  }
  assert.match(QUESTS.story_voidreach_3.outro!.map((l) => l[1]).join(' '), /Remember yourself/, 'the story ends where it says it does');
  // the server: speak to, go to, recover from monsters
  const h = harness({ capacity: 10, rng: () => 0.1 }), { world } = h;
  const a = atGiver(h, 'eldoria', 'knight', 6), p = a.p;
  p.quests.done.main_eldoria = { n: 1, day: 0 };
  assert.equal(world.quest(p, { op: 'accept', id: 'story_eldoria_1' }), '');
  const talk = QUESTS.story_eldoria_1.objectives[0] as any, visit = QUESTS.story_eldoria_1.objectives[1] as any;
  assert.equal(world.quest(p, { op: 'talk', npc: talk.npc }), '');
  assert.deepEqual(p.quests.active.story_eldoria_1.p, [0, 0], 'speaking from across the plaza does not count');
  const npc = objById(talk.npc)!;
  p.x = npc.x + 20; p.y = npc.y;
  assert.equal(world.quest(p, { op: 'talk', npc: talk.npc }), '');
  assert.deepEqual(p.quests.active.story_eldoria_1.p, [1, 0]);
  world.quests.onMove(p);
  assert.deepEqual(p.quests.active.story_eldoria_1.p, [1, 0], 'not there yet');
  p.x = visit.x; p.y = visit.y;
  world.quests.onMove(p);
  assert.deepEqual(p.quests.active.story_eldoria_1.p, [1, 1], 'arrived');
  const lk = objById('lorekeeper:eldoria')!;
  p.x = lk.x + 20; p.y = lk.y;
  assert.equal(world.quest(p, { op: 'turnin', id: 'story_eldoria_1' }), '');
  // step 2 is given by the person step 1 sent you to
  assert.equal(world.quest(p, { op: 'accept', id: 'story_eldoria_2' }), 'Talk to the quest giver to accept this quest');
  p.x = npc.x + 20; p.y = npc.y;
  assert.equal(world.quest(p, { op: 'accept', id: 'story_eldoria_2' }), '');
  const loot = QUESTS.story_eldoria_2.objectives[0] as any;
  kill(world, p, 'boar' === loot.mob ? 'mossling' : 'boar');
  assert.deepEqual(p.quests.active.story_eldoria_2.p, [0], 'only the named monster carries the pieces');
  for (let i = 0; i < loot.n + 3; i++) kill(world, p, loot.mob);
  assert.deepEqual(p.quests.active.story_eldoria_2.p, [loot.n], 'recovered, and no more than needed');
  assert.equal(world.quest(p, { op: 'turnin', id: 'story_eldoria_2' }), '');
  for (const junk of [{ op: 'talk' }, { op: 'talk', npc: 5 }, { op: 'talk', npc: 'nobody' }]) assert.equal(world.quest(p, junk), '', 'unknown townsfolk are ignored quietly');
});

test('G4 region traits: every region past level 45 has its own mechanic, and each works on the server', () => {
  assert.deepEqual(EXPANSION.map((e) => !!traitOf(e.id)), EXPANSION.map(() => true), 'every expansion region has a trait');
  assert.equal(new Set(Object.values(TRAITS).map((t) => t.id)).size, EXPANSION.length, 'all different');
  for (const z of ['eldoria', 'verdant', 'astral']) assert.equal(traitOf(z), undefined, 'the early regions stay as they are');
  const has = (p: Player, name: string) => statusNames(p.mask).includes(name);
  const setup = (zone: string, rng: number, level = 100) => {
    const h = harness({ rng: () => rng, capacity: 10 }), a = h.join(0, 0, 'knight', level, -1, zone);
    const mobs = EXPANSION.find((e) => e.id === zone)!.mobs;
    const fight = (type: string, dx: number, dy = 0) => {
      const m = h.world.spawn(a.p.room, type, a.p.x + dx, a.p.y + dy);
      m.noRespawn = true;
      m.addThreat(a.p.id, 5);
      m.state = 'chase';
      return m;
    };
    return { h, p: a.p, mobs, fight };
  };
  // blows that root, chill and arc
  {
    const { h, p, mobs, fight } = setup('thornwild', 0.1);
    h.world.traitHit(fight(mobs[0].id, 30), p, 40);
    assert.ok(has(p, 'Rooted'), 'Thornbound roots');
  }
  {
    const { h, p, mobs, fight } = setup('glacierdeep', 0.1);
    h.world.traitHit(fight(mobs[0].id, 30), p, 40);
    assert.ok(has(p, 'Slowed'), 'Deep Chill slows');
  }
  {
    const { h, p, mobs, fight } = setup('stormspire', 0.1), other = h.join(20, 0, 'mage', 100, -1, 'stormspire').p;
    const hp0 = other.hp;
    h.world.traitHit(fight(mobs[0].id, 30), p, 200);
    assert.ok(other.hp < hp0 && has(other, 'Shocked'), 'Static arcs to a player standing close');
    // and lightning marks the ground under the target, then strikes
    let struck = false;
    for (let i = 0; i < 140 && !struck; i++) { h.step(); struck = (h.world.traits as any).hazards.length > 0; }
    assert.ok(struck, 'a lightning strike is on its way');
  }
  // deaths that burn and burst
  for (const [zone, label] of [['emberwaste', 'Ember Trail'], ['cinderdeep', 'Volatile']] as const) {
    const { h, p, mobs } = setup(zone, 0.5);
    const hp0 = p.hp;
    kill(h.world, p, mobs[0].id);
    h.step(4);
    assert.equal(p.hp, hp0, `${label}: a warning first, no damage yet`);
    h.step(30);
    assert.ok(p.hp < hp0, `${label}: standing in it hurts`);
    if (zone === 'emberwaste') assert.ok(statusNames(p.mask).includes('Burning'));
  }
  // the dead rise once
  {
    const { h, p, mobs } = setup('hollowfen', 0.1);
    const m = kill(h.world, p, mobs[0].id);
    assert.ok(m.dead);
    h.step(22);
    assert.ok(!m.dead && m.hp === Math.ceil(m.maxHp * 0.33) && m.risen, 'Restless Dead: it gets back up, weakened');
    h.world.hurt(m, 1e9, 0, p);
    h.step(40);
    assert.ok(m.dead, 'but only once');
  }
  // over time: blink, rally, regrow, phase out
  {
    const { h, p, mobs, fight } = setup('riftlands', 0.7);
    const m = fight(mobs[0].id, 420);
    h.step(21);
    assert.ok(Math.hypot(m.x - p.x, m.y - p.y) < 80, 'Phase Step: it appears beside a target that keeps its distance');
  }
  {
    const { h, p, mobs, fight } = setup('crownfall', 0.5);
    const line = [fight(mobs[0].id, 60), fight(mobs[0].id, 60, 40), fight(mobs[0].id, 60, -40)];
    h.step(21);
    assert.ok(line.every((m) => statusNames(m.mask).includes('Rallying Cry')), 'Banner Line: side by side, they rally');
    void p;
  }
  {
    const { h, mobs, fight } = setup('elderwood', 0.5);
    const a = fight(mobs[0].id, 200), b = fight(mobs[0].id, 230);
    b.hp = Math.round(b.maxHp / 2);
    const before = b.hp;
    h.step(61);
    assert.ok(b.hp > before, 'Regrowth: a fighting monster heals the one beside it');
    void a;
  }
  {
    const { h, mobs, fight } = setup('voidreach', 0.1);
    const m = fight(mobs[0].id, 250);
    let phased = false;
    for (let i = 0; i < 190 && !phased; i++) { h.step(); phased = statusNames(m.mask).includes('Phased Out'); }
    assert.ok(phased, 'Null Field: it phases out of reach');
    const hp = m.hp;
    h.world.hurt(m, 1000, 0, null);
    assert.equal(m.hp, hp, 'and cannot be hurt meanwhile');
  }
});

test('G2 talents: one per tier, free, changeable outside combat, and each changes how the character fights', () => {
  const h = harness({ rng: () => 0.5, capacity: 10 }), { world } = h;
  const a = h.join(0, 0, 'knight', 15), p = a.p;
  assert.equal(world.learn(p, 'talent.1.1'), 'Requires level 30');
  for (const junk of ['talent.9.1', 'talent.1.7', 'talent.x']) assert.equal(world.learn(p, junk), 'Unknown talent');
  const lv = (n: number) => { p.level = n; p.recalc(); };
  lv(65);
  const free = freePoints(p.level, p.build);
  assert.equal(world.learn(p, 'talent.1.1'), '');
  assert.equal(freePoints(p.level, p.build), free, 'talents cost no skill points');
  assert.equal(world.learn(p, 'talent.1.1'), 'Already chosen');
  assert.equal(world.learn(p, 'talent.1.2'), '', 'changed: one per tier');
  assert.deepEqual(talentsOf(p.build.skills).map((t) => t.id), ['opportunist']);
  p.lastCombat = (world as any).tick;
  assert.equal(world.learn(p, 'talent.1.3'), 'Cannot do that in combat');
  p.lastCombat = -1e9;
  assert.deepEqual(cleanBuild('knight', 65, p.build).skills['talent.1'], 2, 'stored with the build');
  assert.equal(cleanBuild('knight', 15, p.build).skills['talent.1'], undefined, 'not kept below the tier level');
  // what each does in a fight
  const mob = (dx = 30, dy = 0) => { const m = world.spawn(p.room, 'boar', p.x + dx, p.y + dy); m.noRespawn = true; m.maxHp = m.hp = 1e7; return m; };
  const pick = (tier: number, c: number) => { p.build.skills[`talent.${tier}`] = c; };
  const clearT = () => { for (const k of Object.keys(p.build.skills)) if (k.startsWith('talent.')) delete p.build.skills[k]; };
  clearT();
  const base = world.strike(p, mob(), 1);
  pick(1, 1); // Momentum
  const m1 = mob(), hits = [1, 2, 3, 4, 5, 6, 7].map(() => world.strike(p, m1, 1));
  assert.ok(hits[0] === base && hits[1] > hits[0] && hits[5] === hits[6] && hits[6] > hits[0] * 1.15, `Momentum stacks on one target: ${hits}`);
  assert.equal(world.strike(p, mob(), 1), base, 'and starts over on another');
  pick(1, 2); // Opportunist
  const m2 = mob();
  assert.ok(world.strike(p, m2, 1) > base * 1.3, 'Opportunist: the opening hit is heavy');
  m2.hp = m2.maxHp * 0.5;
  assert.equal(world.strike(p, m2, 1), base, 'but not once the target is hurt');
  pick(1, 3); // Executioner's Eye
  const m3 = mob();
  m3.hp = m3.maxHp * 0.2;
  assert.ok(world.strike(p, m3, 1) > base * 1.2, "Executioner's Eye finishes the wounded");
  clearT();
  // kills: Bloodthirst heals, Arcane Flow restores and cuts cooldowns
  pick(2, 1);
  p.hp = Math.round(p.maxHp / 2);
  const hp0 = p.hp;
  kill(world, p, 'boar');
  assert.ok(p.hp >= hp0 + Math.round(p.maxHp * 0.06) - 1, 'Bloodthirst');
  pick(2, 2);
  p.res = 0;
  p.cds.set('shield_bash', (world as any).tick + 200);
  kill(world, p, 'boar');
  assert.ok(p.res > 0 && p.cds.get('shield_bash')! <= (world as any).tick + 200 - 19, 'Arcane Flow');
  assert.ok(a.out.some((m) => m.t === 'cdcut' && m.ms === 1000), 'the client is told');
  pick(2, 3); // Bulwark
  p.hp = Math.round(p.maxHp * 0.6);
  const blow = Math.round(p.maxHp * 0.2), hpB = p.hp;
  world.hurt(p, blow, 0, mob());
  assert.ok(hpB - p.hp <= blow - Math.round(p.maxHp * 0.15) + 1, 'Bulwark: the barrier rises in time to soak the blow that crosses half health');
  p.hp = Math.round(p.maxHp * 0.6);
  world.hurt(p, blow, 0, mob());
  assert.equal(p.hp, Math.round(p.maxHp * 0.6) - blow, 'and only once every 20 seconds');
  clearT();
  // signatures
  const h2 = harness({ rng: () => 0.1, capacity: 10 }), b = h2.join(0, 0, 'mage', 65).p;
  const m4 = h2.world.spawn(b.room, 'boar', b.x + 30, b.y); m4.noRespawn = true; m4.maxHp = m4.hp = 1e7;
  b.build.skills['talent.3'] = 1; // Echo
  const before = m4.hp, dealt = h2.world.strike(b, m4, 1, true, 0, false);
  assert.ok(before - m4.hp > dealt * 1.3, 'Echo strikes again');
  b.build.skills['talent.3'] = 2; // Overload
  b.cds.set('fireball', (h2.world as any).tick + 100);
  h2.world.strike(b, m4, 1, true, 100, false);
  assert.ok(b.cds.get('fireball')! < (h2.world as any).tick + 100, 'Overload: a critical skill hit shortens cooldowns');
  b.build.skills['talent.3'] = 3; // Cleaving Blows
  const side = [0, 1].map((i) => { const m = h2.world.spawn(b.room, 'boar', m4.x + 20, m4.y + (i ? 25 : -25)); m.noRespawn = true; m.maxHp = m.hp = 1e7; return m; });
  h2.world.strike(b, m4, 1);
  assert.ok(side.every((m) => m.hp < m.maxHp), 'Cleaving Blows: basic attacks strike the enemies beside the target');
});

test('G2 talents, tiers 4 to 6; awakening costs skill points; auto hunting uses every fighting skill', () => {
  assert.deepEqual(TALENT_TIERS.map((t) => t.level), [30, 60, 90, 120, 160, 200]);
  const h = harness({ rng: () => 0.5, capacity: 10 }), { world } = h, p = h.join(0, 0, 'knight', 200).p;
  const mob = (boss = false) => { const m = world.spawn(p.room, boss ? 'old_tusk' : 'boar', p.x + 30, p.y); m.noRespawn = true; m.maxHp = m.hp = 1e7; return m; };
  const base = world.strike(p, mob(), 1), eliteBase = world.strike(p, mob(true), 1);
  p.build.skills['talent.4'] = 1;
  assert.ok(world.strike(p, mob(true), 1) > eliteBase * 1.2 && world.strike(p, mob(), 1) === base, 'Predator: elites and bosses only');
  p.build.skills['talent.4'] = 3; // Second Wind
  p.hp = 50;
  world.hurt(p, 1e6, 0, mob());
  assert.ok(!p.dead && p.hp === 1, 'Second Wind: the killing blow leaves 1 health');
  delete p.build.skills['talent.4'];
  p.hp = p.maxHp;
  p.build.skills['talent.5'] = 1; // Glass Cannon
  assert.ok(world.strike(p, mob(), 1) > base * 1.15);
  const hpG = p.hp; world.hurt(p, 100, 0, mob());
  assert.equal(hpG - p.hp, 115, 'and takes 15% more');
  p.build.skills['talent.5'] = 2; // Iron Skin
  const hpI = p.hp; world.hurt(p, 100, 0, mob());
  assert.equal(hpI - p.hp, 85);
  delete p.build.skills['talent.5'];
  p.build.skills['talent.6'] = 2; // Vampiric Mastery
  p.hp = Math.round(p.maxHp / 2); const hpV = p.hp;
  world.strike(p, mob(), 1);
  assert.ok(p.hp > hpV, 'Vampiric Mastery heals');
  // awakening: 10 skill points, given back by a respec
  const a = h.join(0, 0, 'mage', 90).p, sk = JOB_DEFS.mage.skills.find((x) => x.type === 'active')!;
  a.build.skills[sk.id] = sk.maxRank;
  const town = zoneObjects('eldoria').find((o) => o.kind === 'lorekeeper')!; a.x = town.x; a.y = town.y;
  const free = freePoints(a.level, a.build);
  assert.equal(world.ascOp(a, { op: 'awaken', id: sk.id }), '');
  assert.equal(freePoints(a.level, a.build), free - 10, 'awakening costs 10 skill points');
  assert.ok(a.asc.awake.includes(sk.id));
  a.lastCombat = -1e9;
  assert.equal(world.respec(a), '');
  assert.deepEqual([a.asc.awake, freePoints(a.level, a.build)], [[], a.level], 'a respec clears the awakening and returns its points');
  // auto hunting: every active skill except raising the dead
  for (const j of JOBS) for (const d of jobActives(j)) assert.ok(!!autoKind(d) === !(d.special === 'revive' || d.target === 'deadAlly'), `${j}: ${d.id}`);
});

test('G6 chase items: every boss past level 45 drops its own set and signature, and every new passive works', () => {
  for (const e of EXPANSION) for (const b of [e.dungeon.boss.id, e.world?.id].filter(Boolean) as string[]) {
    const list = BOSS_UNIQUES[b] ?? [];
    assert.ok(list.some((id) => ITEMS[id].unique!.set) && list.some((id) => ITEMS[id].unique!.passive), `${b} drops a set piece and a signature`);
  }
  for (const set of Object.keys(SETS)) assert.equal(ITEM_LIST.filter((i) => i.unique?.set === set).length, 3, `${set} has three pieces`);
  for (const pid of Object.keys(PASSIVES)) assert.ok(ITEM_LIST.some((i) => i.unique?.passive === pid), `${pid} is on an item`);
  const h = harness({ rng: () => 0.05, capacity: 10 }), { world } = h, p = h.join(0, 0, 'knight', 120).p;
  const mob = (dx = 30, dy = 0) => { const m = world.spawn(p.room, 'boar', p.x + dx, p.y + dy); m.noRespawn = true; m.maxHp = m.hp = 1e7; return m; };
  const wear = (...ids: string[]) => { p.passives = ids; };
  wear('ignite'); const a = mob(); world.strike(p, a, 1); assert.ok(statusNames(a.mask).includes('Burning'), 'Ignite');
  wear('frostbite'); const b = mob(); world.strike(p, b, 1); assert.ok(statusNames(b.mask).includes('Slowed'), 'Frostbite');
  wear('stormlash'); const c = mob(600), c2 = mob(630); world.strike(p, c, 1); assert.ok(c2.hp < c2.maxHp, 'Stormlash arcs');
  wear('eruption'); const d = mob(-600), d2 = mob(-640); world.strike(p, d, 1, false, 100); assert.ok(d2.hp < d2.maxHp, 'Eruption bursts on a critical hit');
  wear('wildgrowth'); p.hp = 100; world.strike(p, mob(), 1); assert.ok(p.hp > 100, 'Wildgrowth heals');
  wear('soulreap'); p.hp = 100; kill(world, p, 'boar'); assert.ok(p.hp > 100, 'Soulreap');
  wear('nullward'); p.hp = p.maxHp; world.hurt(p, 500, 0, mob()); assert.equal(p.hp, p.maxHp, 'Null Ward turns a blow aside');
  world.hurt(p, 500, 0, mob()); assert.equal(p.hp, p.maxHp - 500, 'once every 30 seconds');
  wear('warbanner'); p.hp = p.maxHp; world.hurt(p, 1000, 0, mob(0, -20)); assert.equal(p.hp, p.maxHp - 850, 'War Banner: less damage when surrounded');
});

test('M13 accepting: level, prerequisites, reputation, once, daily reset at midnight UTC, and the active limit', () => {
  const s = emptyQuests(), now = Date.UTC(2026, 10, 17, 15), main2 = QUESTS.main_verdant;
  assert.equal(acceptBlock(QUESTS.main_eldoria, s, 1, {}, now), '');
  assert.equal(acceptBlock(main2, s, 3, {}, now), `Requires level ${main2.level}`);
  assert.match(acceptBlock(main2, s, 30, {}, now), /First complete "The Crater Watch"/);
  s.done.main_eldoria = { n: 1, day: utcDay(now) };
  assert.equal(acceptBlock(main2, s, 30, {}, now), '');
  assert.equal(acceptBlock(QUESTS.main_eldoria, s, 30, {}, now), 'Already completed', 'a one-off quest');
  const fq = QUESTS.faction_eldoria;
  assert.match(acceptBlock(fq, s, 30, {}, now), /Requires Friendly reputation with The Starfall Crown/);
  assert.equal(acceptBlock(fq, s, 30, { crown: 500 }, now), '');
  // daily: done today -> refused until the next UTC day; repeatable: always
  s.done.daily_eldoria = { n: 3, day: utcDay(now) };
  assert.match(acceptBlock(QUESTS.daily_eldoria, s, 30, {}, now), /after midnight/);
  assert.equal(acceptBlock(QUESTS.daily_eldoria, s, 30, {}, Date.UTC(2026, 10, 18, 0, 0, 1)), '', 'available again one second after midnight');
  s.done.hunt_eldoria = { n: 50, day: utcDay(now) };
  assert.equal(acceptBlock(QUESTS.hunt_eldoria, s, 30, {}, now), '', 'repeatable quests have no limit at all');
  s.active.side_eldoria = { p: [0, 0], at: now };
  assert.equal(acceptBlock(QUESTS.side_eldoria, s, 30, {}, now), 'You already have this quest');
  for (const q of QUEST_LIST.slice(0, MAX_ACTIVE_QUESTS)) s.active[q.id] = { p: q.objectives.map(() => 0), at: now };
  assert.match(acceptBlock(QUESTS.collect_astral, s, 60, {}, now), /at most 15 quests/);
  // stored state is sanitised
  const c = cleanQuests({ active: { main_eldoria: { p: [5, -3, 99], at: 1 }, nope: { p: [] } }, done: { side_eldoria: { n: 2, day: 9 }, ghost: { n: 1 } }, hist: [{ id: 'main_eldoria', at: 5 }, { id: 'ghost', at: 1 }, 'x'] });
  assert.deepEqual(c, { active: { main_eldoria: { p: [1, 0], at: 1 } }, done: { side_eldoria: { n: 2, day: 9 } }, hist: [{ id: 'main_eldoria', at: 5 }] }, 'progress clamped to the objective, unknown quests dropped');
  assert.deepEqual(cleanRep({ crown: 700, wardens: -5, ghosts: 100, forge: 1e9, hearth: 1.5 }), { crown: 700, forge: 12000 });
});

test('M13 quest flow on the server: accept at the giver, progress from real kills, turn in for rewards, history', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = atGiver(h, 'eldoria', 'knight', 6), p = a.p, q = QUESTS.main_eldoria, elite = q.objectives[0], pack = q.objectives[1];
  // away from the giver nothing can be accepted
  const far = h.join(900, 900, 'mage', 6);
  assert.equal(world.quest(far.p, { op: 'accept', id: q.id }), 'Talk to the quest giver to accept this quest');
  assert.equal(world.quest(p, { op: 'accept', id: 'nope' }), 'Unknown quest');
  assert.equal(world.quest(p, { op: 'turnin', id: q.id }), 'You do not have that quest');
  assert.equal(world.quest(p, { op: 'accept', id: q.id }), '');
  assert.deepEqual(p.quests.active[q.id].p, [0, 0]);
  assert.equal(p.progDirty, true, 'saved with the character');
  assert.ok(a.out.some((m) => m.t === 'sys' && m.cue === 'quest' && /Quest accepted: The Crater Watch/.test(m.text)));
  assert.deepEqual(questMsgs(a.out).pop().prog[q.id], [0, 0]);
  // progress: only the right monsters, only kills this player is rewarded for
  kill(world, p, 'boar');
  kill(world, far.p, (pack as any).mob); // someone else's kill
  assert.deepEqual(p.quests.active[q.id].p, [0, 0]);
  for (let i = 0; i < 8; i++) kill(world, p, (pack as any).mob);
  assert.deepEqual(p.quests.active[q.id].p, [0, 6], 'counts stop at the target');
  assert.equal(world.quest(p, { op: 'turnin', id: q.id }), 'The quest is not complete yet');
  kill(world, p, (elite as any).mob);
  assert.deepEqual(questMsgs(a.out).pop().prog[q.id], [1, 6]);
  // turning in: rewards arrive, the quest moves to history
  const gold0 = p.gold, exp0 = p.exp + p.level * 1e9;
  assert.equal(world.quest(p, { op: 'turnin', id: q.id }), '');
  assert.equal(p.quests.active[q.id], undefined);
  assert.deepEqual([p.quests.done[q.id].n, p.quests.hist[0].id], [1, q.id]);
  assert.equal(p.gold, gold0 + q.reward.gold);
  assert.ok(p.exp + p.level * 1e9 > exp0, 'experience granted');
  assert.equal(count(p, 'scroll_random'), 1, 'item reward');
  assert.equal(p.rep.crown, 250, 'reputation with the Starfall Crown');
  assert.ok(a.out.some((m) => m.t === 'sys' && m.cue === 'questdone'));
  assert.equal(world.quest(p, { op: 'accept', id: q.id }), 'Already completed');
  // abandon
  assert.equal(world.quest(p, { op: 'accept', id: 'hunt_eldoria' }), '');
  kill(world, p, QUESTS.hunt_eldoria.objectives[0].kind === 'kill' ? (QUESTS.hunt_eldoria.objectives[0] as any).mob : '');
  assert.equal(world.quest(p, { op: 'abandon', id: 'hunt_eldoria' }), '');
  assert.equal(p.quests.active.hunt_eldoria, undefined);
  assert.equal(world.quest(p, { op: 'accept', id: 'hunt_eldoria' }), '');
  assert.deepEqual((p.quests.active as any).hunt_eldoria.p, [0], 'starting again starts from nothing');
  for (const junk of [null, 'x', { op: 'steal' }, { op: 'accept', id: 5 }, { op: 'turnin', id: '__proto__' }]) assert.notEqual(world.quest(p, junk), '');
});

test('M13 collection, exploration, dungeon and boss objectives; full bag; daily quests', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = atGiver(h, 'verdant', 'ranger', 12), p = a.p;
  // collection: read from the bag live, handed over at turn-in
  const cq = QUESTS.collect_verdant, res = (cq.objectives[0] as any).item;
  assert.equal(world.quest(p, { op: 'accept', id: cq.id }), '');
  give(p, spec(res, { qty: 3 }));
  sendInv(world, p);
  assert.deepEqual(questMsgs(a.out).pop().prog[cq.id], [3], 'progress follows the bag');
  assert.equal(world.quest(p, { op: 'turnin', id: cq.id }), 'The quest is not complete yet');
  give(p, spec(res, { qty: 4 }));
  assert.equal(world.quest(p, { op: 'turnin', id: cq.id }), '');
  assert.equal(count(p, res), 2, 'exactly five were handed over');
  // exploration: hidden caches found count
  const eq = QUESTS.explore_verdant;
  assert.equal(world.quest(p, { op: 'accept', id: eq.id }), '');
  const caches = zoneObjects('verdant').filter((o) => o.kind === 'cache');
  p.disc.add(caches[0].id);
  assert.equal(world.quest(p, { op: 'turnin', id: eq.id }), 'The quest is not complete yet');
  p.disc.add(caches[1].id);
  // a full bag: the reward (a scroll) does not fit, so nothing happens
  while (p.inv.length < INVENTORY_SIZE) give(p, spec('cloth_robe'));
  assert.equal(world.quest(p, { op: 'turnin', id: eq.id }), 'Make room in your bag for the reward first');
  assert.ok(p.quests.active[eq.id], 'still active');
  p.inv.length = 0;
  assert.equal(world.quest(p, { op: 'turnin', id: eq.id }), '');
  // dungeon: cleared through the dungeon hook
  const dq = QUESTS.dungeon_ruins;
  assert.equal(world.quest(p, { op: 'accept', id: dq.id }), '');
  world.quests.onClear(p, 'lair');
  assert.deepEqual(p.quests.active[dq.id].p, [0], 'another dungeon does not count');
  world.quests.onClear(p, 'ruins');
  assert.equal(world.quest(p, { op: 'turnin', id: dq.id }), '');
  // daily: once per UTC day
  const dl = QUESTS.daily_verdant;
  assert.equal(world.quest(p, { op: 'accept', id: dl.id }), '');
  for (let i = 0; i < 20; i++) kill(world, p, 'spider');
  assert.equal(world.quest(p, { op: 'turnin', id: dl.id }), '');
  assert.match(world.quest(p, { op: 'accept', id: dl.id }) as string, /after midnight/);
  p.quests.done[dl.id].day -= 1; // as if it was yesterday
  assert.equal(world.quest(p, { op: 'accept', id: dl.id }), '', 'available again the next day');
  // boss: a world boss kill credited to the player
  const b = h.join(0, 0, 'knight', 60, -1, 'dreadmoor');
  const lk = zoneObjects('dreadmoor').find((o) => o.kind === 'lorekeeper')!;
  world.relocate(b.p, b.p.room, lk.x + 20, lk.y);
  assert.equal(world.quest(b.p, { op: 'accept', id: 'boss_shadow_knight' }), '');
  const sk = world.spawn(b.p.room, 'shadow_knight', b.p.x + 60, b.p.y);
  sk.noRespawn = true;
  for (let i = 0; i < 12 && !sk.dead; i++) {
    world.hurt(sk, sk.maxHp, 0, b.p);
    h.step(2);
  }
  assert.ok(sk.dead);
  assert.deepEqual(b.p.quests.active.boss_shadow_knight.p, [1], 'the boss counts for those it rewards');
});

test('M13 reputation: levels announced and rewarded once, faction quests and the faction shop gated by standing', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = atGiver(h, 'ashen', 'berserker', 20), p = a.p, watcher = atGiver(h, 'ashen', 'mage', 20);
  world.quests.addRep(p, 'forge', 499);
  assert.equal(watcher.out.filter((m) => m.t === 'ann').length, 0);
  world.quests.addRep(p, 'forge', 1);
  assert.deepEqual(watcher.out.filter((m) => m.t === 'ann').map((m) => [m.text, m.cue]), [[`${p.name} is now Friendly with The Cinder Compact.`, 'rep']], 'a faction announcement everyone nearby hears');
  assert.equal(count(p, REP_GIFT[1][0][0]), REP_GIFT[1][0][1], "the faction's gift for Friendly");
  world.quests.addRep(p, 'forge', 5000);
  assert.deepEqual(watcher.out.filter((m) => m.t === 'ann').map((m) => m.text.split(' is now ')[1]), ['Friendly with The Cinder Compact.', 'Honored with The Cinder Compact.', 'Revered with The Cinder Compact.'], 'every level passed is announced');
  const gifts = count(p, 'scroll_random') + count(p, 'scroll_advanced');
  world.quests.addRep(p, 'forge', 1);
  assert.equal(count(p, 'scroll_random') + count(p, 'scroll_advanced'), gifts, 'no gift twice');
  world.quests.addRep(p, 'nobody', 100);
  assert.equal(p.rep.nobody, undefined);
  // the faction shop: at the faction's seat only, by standing, for gold
  const f = DEFAULT_FACTIONS.find((x) => x.id === 'forge')!, [cheap, price] = f.shop[0], [mount, , needM] = f.shop.find(([b]) => b.startsWith('mount_'))!;
  const fresh = atGiver(h, 'ashen', 'knight', 20).p;
  fresh.gold = 1e6;
  assert.equal(world.quest(fresh, { op: 'shop', faction: 'forge', base: mount }), `Requires ${REP_LEVELS[needM].name} reputation with The Cinder Compact`);
  assert.equal(world.quest(fresh, { op: 'shop', faction: 'forge', base: cheap }), '');
  assert.equal(fresh.gold, 1e6 - price);
  assert.equal(world.quest(fresh, { op: 'shop', faction: 'forge', base: 'hp_potion' }), 'Not sold by this faction');
  assert.equal(world.quest(fresh, { op: 'shop', faction: 'crown', base: 'hp_potion' }), 'Visit The Starfall Crown at Eldoria', 'only at the faction seat');
  p.gold = 1e6;
  assert.equal(world.quest(p, { op: 'shop', faction: 'forge', base: mount }), '', 'Revered may buy the mount');
  assert.equal(count(p, mount), 1);
  // faction quests are offered from Friendly
  assert.equal(world.quest(fresh, { op: 'accept', id: 'faction_ashen' }), 'Requires Friendly reputation with The Cinder Compact');
  assert.equal(world.quest(p, { op: 'accept', id: 'faction_ashen' }), '');
});

test('M13 factions are configuration and database records: rows are validated, new factions join the game', () => {
  const h = harness(), q = h.world.quests;
  assert.equal(q.factions, DEFAULT_FACTIONS, 'without a database the built-in factions are used');
  q.setFactions([
    ...DEFAULT_FACTIONS.map((f) => ({ ...f, shop: f.shop as unknown })),
    { id: 'tidecallers', name: 'The Tidecallers', seat: 'Mosswatch', region: 'verdant', creed: 'The water remembers.', about: 'A new faction added as a database row.', shop: [['mana_potion', 30, 0], ['no_such_item', 5, 0], ['hp_potion', -1, 0], ['hp_potion', 10, 9]] },
    { id: 'nowhere', name: 'Lost', seat: '-', region: 'd_ruins', creed: '-', about: '-', shop: [] },
  ]);
  assert.deepEqual(q.factions.map((f) => f.id), [...DEFAULT_FACTIONS.map((f) => f.id), 'tidecallers'], 'a faction in a region with no lorekeeper is skipped');
  assert.deepEqual(q.faction('tidecallers')!.shop, [['mana_potion', 30, 0]], 'invalid shop lines are dropped');
  const a = atGiver(h, 'verdant', 'mage', 10);
  assert.ok(a.out.find((m) => m.t === 'welcome').factions.some((f: any) => f.id === 'tidecallers'), 'clients receive the factions in force');
  q.addRep(a.p, 'tidecallers', 600);
  assert.equal(a.p.rep.tidecallers, 600, 'reputation works for it');
  a.p.gold = 100;
  assert.equal(h.world.quest(a.p, { op: 'shop', faction: 'tidecallers', base: 'mana_potion' }), '');
});

// ---------------------------------------------------------------------------------------------
// M15: PvP, duels, arena, pets and mounts
// ---------------------------------------------------------------------------------------------
import { inSanctuary, inTown, pvpBlock, pvpRule, pvpRuleAt, ratingDelta, ARENA_GOLD, type PvpView } from '../shared/src/pvp';
import { BOUNTY_HONOR, BOUNTY_STREAK, DEPTH_MONSTER, DEPTHS } from '../shared/src/depths';
import { DEPTH_BOSSES } from '../shared/src/monsters';
import { DEPTH_ZONES } from '../shared/src/world';
import { cleanCompanions, MOUNTS, PET_MAX_LEVEL, petBonus, petExpToNext, PETS } from '../shared/src/companions';
import { pvpUsable } from '../server/src/game/Abilities';

/** An open spot in a zone outside its town, reachable, with room around it. */
/** The Depths used by the tests. */
const DEEP = 'x_frostveil';
/** Open ground in the Depths, well outside the sanctuary (two players fit side by side). */
function wilds(zone = DEEP): { x: number; y: number } {
  const nav = navOf(zone), map = nav.map, s = ZONES[zone].sanctuary!;
  for (let tx = s.tx + s.r + 8; tx < map.w - 10; tx++) for (let ty = 10; ty < map.h - 10; ty++) {
    const x = tileCenter(tx), y = tileCenter(ty);
    if (!spawnFault(nav, x, y) && !spawnFault(nav, x + 48, y) && !inSanctuary(zone, x, y)) return { x, y };
  }
  throw new Error('no open ground in ' + zone);
}
/** Open ground in a region, outside its town. */
function freeGround(zone: string): { x: number; y: number } {
  const nav = navOf(zone), map = nav.map;
  for (let ty = 10; ty < map.h - 10; ty++) for (let tx = 10; tx < map.w - 10; tx++) {
    const x = tileCenter(tx), y = tileCenter(ty);
    if (!spawnFault(nav, x, y) && !inTown(zone, x, y) && !spawnFault(nav, x + 48, y)) return { x, y };
  }
  throw new Error('no free ground in ' + zone);
}
/** Two players placed side by side at a point of a zone. */
function pair(h: ReturnType<typeof harness>, zone: string, at: { x: number; y: number }, la = 30, lb = 30) {
  const sp = ZONES[zone].spawn, dx = at.x - tileCenter(sp.tx), dy = at.y - tileCenter(sp.ty);
  const A = h.join(dx, dy, 'knight', la, -1, zone), B = h.join(dx + 48, dy, 'mage', lb, -1, zone);
  if (ZONES[zone].depth) {
    // everyone enters the Depths through the sanctuary: walk them out to the place
    h.world.relocate(A.p, A.p.room, at.x, at.y);
    h.world.relocate(B.p, A.p.room, at.x + 48, at.y);
  }
  return [A, B];
}
const pview = (o: Partial<PvpView>): PvpView => ({ id: 1, level: 30, x: 0, y: 0, party: 0, shieldUntil: 0, duel: 0, ...o });

test('M15 PvP rules: regions allow duels only, the Depths allow open combat at any level, with sanctuary, guild, party and protection rules', () => {
  assert.equal(pvpRule('d_ruins'), 'safe', 'dungeons are safe from other players');
  for (const z of REGIONS) assert.equal(pvpRule(z), 'duel', `${z}: duels only, anywhere in the region`);
  for (const z of DEPTH_ZONES) assert.equal(pvpRule(z), 'open', `${z}: open`);
  const now = 1e9, wild = wilds(), a = pview({ id: 1, ...wild }), b = pview({ id: 2, ...wild });
  const free = freeGround('dreadmoor'), fa = pview({ id: 1, ...free }), fb = pview({ id: 2, ...free });
  assert.equal(pvpBlock(a, b, DEEP, false, now), '', 'open ground in the Depths');
  assert.equal(pvpBlock(fa, fb, 'dreadmoor', false, now), 'Only duels are allowed here', 'no region has open ground any more');
  assert.equal(pvpRuleAt(DEEP, wild.x, wild.y), 'open');
  assert.equal(pvpRuleAt('dreadmoor', free.x, free.y), 'duel');
  const t = ZONES.dreadmoor.town!;
  assert.equal(pvpBlock(fa, { ...fb, x: tileCenter(t.tx), y: tileCenter(t.ty) }, 'dreadmoor', false, now), 'Fighting is not allowed in town');
  assert.equal(pvpBlock({ ...a, level: 1 }, { ...b, level: 200 }, DEEP, false, now), '', 'no level limits: entering is a choice');
  assert.match(pvpBlock(a, { ...b, shieldUntil: now + 1 }, DEEP, false, now), /protected for a moment/);
  assert.equal(pvpBlock({ ...a, party: 7 }, { ...b, party: 7 }, DEEP, false, now), 'You cannot attack a member of your party');
  assert.equal(pvpBlock({ ...a, guild: 'AAA' }, { ...b, guild: 'AAA' }, DEEP, false, now), 'You cannot attack a member of your guild');
  assert.equal(pvpBlock({ ...a, guild: 'AAA' }, { ...b, guild: 'BBB' }, DEEP, false, now), '');
  assert.equal(pvpBlock(a, a, DEEP, false, now), 'You cannot attack yourself');
  // the sanctuary shelters everyone but a player who has just struck another
  const s = ZONES[DEEP].sanctuary!, home = { x: s.tx * TILE, y: s.ty * TILE };
  assert.equal(pvpRuleAt(DEEP, home.x, home.y), 'safe');
  assert.equal(pvpBlock(a, { ...b, ...home }, DEEP, false, now), 'That player is in the sanctuary');
  assert.equal(pvpBlock(a, { ...b, ...home, tagUntil: now + 1 }, DEEP, false, now), '', 'no shelter for a striker');
  assert.equal(pvpBlock({ ...a, ...home }, b, DEEP, false, now), 'You cannot fight from the sanctuary');
  assert.equal(pvpBlock({ ...a, ...home }, { ...b, tagUntil: now + 1 }, DEEP, false, now), '', 'a striker may be answered from inside');
  // a running duel overrides the zone, the party and the levels
  assert.equal(pvpBlock({ ...a, duel: 2, level: 3, party: 7 }, { ...b, duel: 1, level: 50, party: 7 }, 'ashen', false, now), '');
  assert.equal(pvpBlock({ ...fa, duel: 2 }, { ...fb, duel: 0 }, 'dreadmoor', false, now), 'Only duels are allowed here', 'both sides must be in the same duel');
  // the arena: everyone is fair game except one's own party
  assert.equal(pvpBlock({ ...a, level: 1 }, { ...b, level: 60 }, 'd_ruins', true, now), '');
  assert.equal(pvpBlock({ ...a, party: 3 }, { ...b, party: 3 }, 'd_ruins', true, now), 'That player is on your team');
  // rating
  assert.equal(ratingDelta(1000, 1000), 12);
  assert.ok(ratingDelta(1000, 1400) > 20 && ratingDelta(1400, 1000) <= 3, 'beating a stronger player is worth more');
});

test('M15 open-world PvP: targeting is validated, attacks are server-resolved, kills are recorded once, victims are protected', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  // on the capital's free ground a player cannot even be targeted
  const [c1, c2] = pair(h, 'eldoria', { x: tileCenter(ZONES.eldoria.spawn.tx) + 300, y: tileCenter(ZONES.eldoria.spawn.ty) });
  world.setTarget(c1.p, c2.p.id);
  assert.equal(c1.p.pvpTarget, null);
  assert.ok(c1.out.some((m) => m.t === 'no' && m.a === 'tgt' && /Only duels are allowed here|not allowed in town/.test(m.why)));
  // in the Depths it can
  const [A, B] = pair(h, DEEP, wilds());
  const a = A.p, b = B.p;
  world.setTarget(a, b.id);
  assert.equal(a.pvpTarget, b);
  world.action(a, Act.Attack);
  const hp0 = b.hp;
  h.step(Math.ceil(a.stats.atkIntervalMs / TICK_MS) * 3);
  assert.ok(b.hp < hp0, 'the knight\'s auto-attack hits the mage');
  const dm = snaps(B.out).flatMap((s) => s.dm ?? []).find((d: any) => d[0] === b.id && d[3] === a.id);
  assert.ok(dm, 'the victim sees the damage and who dealt it');
  // the fight to the end
  for (let i = 0; i < 600 && !b.dead; i++) h.step();
  assert.ok(b.dead, 'the mage fell');
  assert.ok(A.out.some((m) => m.t === 'sys' && /You defeated .*: \+10 honour, rating \+12/.test(m.text)));
  assert.ok(B.out.some((m) => m.t === 'sys' && /You were defeated by/.test(m.text)));
  assert.equal(world.pvp.rating.get(a.id), 1012);
  assert.equal(world.pvp.rating.get(b.id), 988);
  assert.equal(a.pvpTarget, null, 'the attacker stops');
  // protection after respawn
  h.step(Math.ceil(RESPAWN_MIN_MS / TICK_MS) + 2);
  world.requestRespawn(b);
  world.relocate(b, b.room, a.x + 48, a.y);
  world.setTarget(a, b.id);
  assert.equal(a.pvpTarget, null);
  assert.ok(A.out.some((m) => m.t === 'no' && /protected for a moment/.test(m.why)));
  // a repeated kill inside ten minutes gives nothing
  b.pvpShieldUntil = 0;
  world.setTarget(a, b.id);
  world.action(a, Act.Attack);
  for (let i = 0; i < 600 && !b.dead; i++) h.step();
  assert.ok(b.dead);
  assert.ok(A.out.some((m) => m.t === 'sys' && /again\. Repeated victories/.test(m.text)));
  assert.equal(world.pvp.rating.get(a.id), 1012, 'no rating for farming the same player');
  // a party is never hostile to itself
  const [P1, P2] = pair(h, DEEP, wilds());
  group(world, P1.p, P2.p);
  world.setTarget(P1.p, P2.p.id);
  assert.equal(P1.p.pvpTarget, null);
});

test('M15 PvP abilities: single-target hits work on players; area, field and movement abilities do not', () => {
  for (const id of ['arcane_bolt', 'fireball', 'thunder_strike', 'power_shot', 'smite', 'shield_bash']) assert.equal(pvpUsable(ABILITIES[id]), true, id);
  for (const id of ['meteor_strike', 'flame_burst', 'tornado', 'charge', 'death_mark', 'mend', 'volley']) assert.equal(pvpUsable(ABILITIES[id]), false, id);
  const h = harness({ capacity: 10 }), { world } = h;
  const [K, M] = pair(h, DEEP, wilds(), 35, 35);
  grant(M.p, ['arcane_bolt'], ['fire'], 10);
  const hp0 = K.p.hp, res0 = M.p.res;
  assert.equal(world.use(M.p, 'arcane_bolt', K.p.id), '');
  assert.ok(K.p.hp < hp0, 'damage from a spell');
  assert.ok(M.p.res < res0, 'mana paid');
  assert.equal(world.use(M.p, 'arcane_bolt', K.p.id), 'Not ready', 'the cooldown is the server\'s');
  h.step(40);
  assert.equal(world.use(M.p, 'meteor_strike', K.p.id), 'This ability cannot be used on players');
  world.relocate(K.p, K.p.room, M.p.x + 900, M.p.y);
  h.step(40);
  assert.equal(world.use(M.p, 'fireball', K.p.id), 'Out of range');
  // PvP damage is scaled down compared with the same hit on a monster
  const K2 = h.join(0, 0, 'knight', 35, -1, DEEP);
  world.relocate(K2.p, K.p.room, M.p.x + 48, M.p.y);
  assert.equal(world.pvp.block(M.p, K2.p), '');
});

test('M15 duels: request and accept, a countdown, the fight ends at 1 HP with a winner, leash and forfeit', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const [A, B] = pair(h, 'ashen', freeGround('ashen'), 12, 40); // levels far apart: allowed in a duel
  const a = A.p, b = B.p, duels = (world.pvp as any).duels as Map<number, any>;
  assert.equal(world.pvpOp(a, { op: 'duel', id: 999 }), 'That player is not here');
  assert.equal(world.pvpOp(a, { op: 'duel', id: b.id }), '');
  assert.equal(B.out.filter((m) => m.t === 'dinv').pop().from, a.name);
  assert.equal(world.pvpOp(b, { op: 'accept' }), '');
  assert.ok(A.out.some((m) => m.t === 'duel' && m.with === b.name && m.starts > 0));
  // during the countdown nobody may strike
  world.setTarget(a, b.id);
  assert.equal(a.pvpTarget, null);
  duels.get(a.id).startsAt = 0; // the countdown is over
  world.setTarget(a, b.id);
  assert.equal(a.pvpTarget, b);
  world.action(a, Act.Attack);
  for (let i = 0; i < 2000 && duels.has(a.id); i++) h.step();
  assert.equal(duels.has(a.id), false, 'the duel ended');
  assert.equal(b.dead, false, 'nobody dies in a duel');
  assert.equal(b.hp, 1, 'the loser is left at 1 HP');
  assert.ok(A.out.some((m) => m.t === 'duel' && /You won the duel/.test(m.result ?? '')));
  assert.ok(B.out.some((m) => m.t === 'duel' && /You lost the duel/.test(m.result ?? '')));
  assert.ok(A.out.some((m) => m.t === 'ann' && /has defeated .* in a duel/.test(m.text)));
  world.setTarget(a, b.id);
  assert.equal(a.pvpTarget, null, 'after the duel they are no longer enemies');
  // a duel ends when the two move apart, or by forfeit; not in a safe zone
  assert.equal(world.pvpOp(a, { op: 'duel', id: b.id }), '');
  world.pvpOp(b, { op: 'accept' });
  world.relocate(b, b.room, a.x + 900, a.y);
  world.pvp.tick(Date.now());
  assert.equal(duels.has(a.id), false);
  assert.ok(B.out.some((m) => m.t === 'duel' && /moved too far apart/.test(m.result ?? '')));
  world.relocate(b, b.room, a.x + 48, a.y);
  world.pvpOp(a, { op: 'duel', id: b.id });
  world.pvpOp(b, { op: 'accept' });
  assert.equal(world.pvpOp(b, { op: 'forfeit' }), '');
  assert.ok(A.out.some((m) => m.t === 'ann' && /\(forfeit\)/.test(m.text)));
  const [S1, S2] = pair(h, 'eldoria', { x: tileCenter(ZONES.eldoria.spawn.tx) + 300, y: tileCenter(ZONES.eldoria.spawn.ty) });
  assert.equal(world.pvpOp(S1.p, { op: 'duel', id: S2.p.id }), '', 'duels are allowed anywhere in a region, the capital included');
});

test('M15 arena: entered at the Arena Master, everyone fights everyone (teams by party), rewards, respawn inside, leave', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const am = zoneObjects('eldoria').find((o) => o.kind === 'arenamaster')!, sp = ZONES.eldoria.spawn;
  const A = h.join(am.x - tileCenter(sp.tx) + 20, am.y - tileCenter(sp.ty), 'knight', 15), B = h.join(am.x - tileCenter(sp.tx) - 20, am.y - tileCenter(sp.ty), 'mage', 50);
  const far = h.join(600, 600, 'ranger', 15);
  world.relocate(far.p, far.p.room, am.x + 400, am.y + 300);
  assert.ok(Math.hypot(far.p.x - am.x, far.p.y - am.y) > 300);
  assert.equal(world.pvpOp(far.p, { op: 'arena' }), 'Talk to the Arena Master to enter');
  assert.equal(world.pvpOp(A.p, { op: 'arena' }), '');
  assert.equal(world.pvpOp(B.p, { op: 'arena' }), '');
  assert.ok(world.pvp.isArena(A.p.room) && A.p.room === B.p.room && A.p.room.monsters.size === 0, 'one monster-free room');
  assert.equal(world.pvp.block(A.p, B.p), '', 'level 15 and level 50 may fight here');
  world.relocate(B.p, B.p.room, A.p.x + 48, A.p.y);
  const gold = A.p.gold;
  world.hurt(B.p, 1e9, 0, A.p);
  assert.ok(B.p.dead);
  assert.equal(A.p.gold, gold + ARENA_GOLD, 'an arena victory pays');
  h.step(Math.ceil(RESPAWN_MIN_MS / TICK_MS) + 2);
  world.requestRespawn(B.p);
  assert.ok(world.pvp.isArena(B.p.room) && !B.p.dead, 'the fallen return inside the arena');
  assert.ok(Math.abs(B.p.x - tileCenter(CHAMBERS[BOSS_ROOM].cx)) < 200, 'in the arena hall');
  assert.equal(world.pvp.block(A.p, B.p), 'That player has just returned to the fight', 'a short protection after returning');
  B.p.pvpShieldUntil = 0;
  group(world, A.p, B.p);
  assert.equal(world.pvp.block(A.p, B.p), 'That player is on your team');
  assert.equal(world.pvpOp(A.p, { op: 'leave' }), '');
  assert.equal(A.p.room.zoneId, 'eldoria');
  assert.ok(Math.hypot(A.p.x - am.x, A.p.y - am.y) < 60, 'back where they came in');
  assert.equal(world.pvpOp(A.p, { op: 'leave' }), 'You are not in the arena');
});

import { BG, BG_SHRINE, formTeams, MATCH_END_MS, pairRanked, pickBattleground, RANKED, ratingWindow } from '../shared/src/matches';

test('G8 matchmaking rules: rating windows widen with waiting, teams are balanced, a battleground fills or waits', () => {
  assert.equal(ratingWindow(0), 100);
  assert.ok(ratingWindow(60_000) > ratingWindow(10_000));
  const now = 1e6;
  assert.deepEqual(pairRanked([{ id: 1, rating: 1000, since: now }, { id: 2, rating: 1500, since: now }, { id: 3, rating: 1050, since: now }], now), [[1, 3]], 'the closest pair, the far one waits');
  assert.equal(pairRanked([{ id: 1, rating: 1000, since: now - 120_000 }, { id: 2, rating: 1500, since: now - 120_000 }], now).length, 1, 'after a long wait the gap is bridged');
  const t = formTeams([1600, 1500, 1400, 1300, 1200, 1100].map((rating, i) => ({ id: i + 1, rating, since: now })));
  const sum = (ids: number[]) => ids.reduce((s, id) => s + 1700 - id * 100, 0);
  assert.equal(t[0].length, 3);
  assert.ok(Math.abs(sum(t[0]) - sum(t[1])) <= 100, 'the strongest are spread across the teams');
  const q = (n: number, wait: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, rating: 1000, since: now - wait }));
  assert.equal(pickBattleground(q(6, 0), now)!.length, 6, 'a full match starts at once');
  assert.equal(pickBattleground(q(3, 0), now), null, 'a short line waits');
  assert.equal(pickBattleground(q(3, BG.fillWaitMs), now)!.length, 2, 'then starts with an even number');
});

test('G8 rated duel: queued anywhere, matched by rating, fought in a private hall, rating changes, everyone goes home', () => {
  const h = harness({ capacity: 10 }), { world } = h, mm = world.pvp.matches as any;
  const A = h.join(0, 0, 'knight', 30), B = h.join(200, 0, 'mage', 30);
  const home = { x: A.p.x, y: A.p.y };
  assert.equal(world.pvpOp(A.p, { op: 'queue', mode: 'ranked' }), '');
  assert.equal(world.pvpOp(A.p, { op: 'queue', mode: 'nope' }), 'Unknown command');
  assert.equal(world.pvpOp(B.p, { op: 'queue', mode: 'ranked' }), '');
  assert.ok(A.out.some((m) => m.t === 'mq' && m.mode === 'ranked'));
  mm.tick(Date.now());
  assert.ok(mm.isMatch(A.p.room) && A.p.room === B.p.room, 'both taken to the same hall');
  assert.ok(A.p.room.monsters.size === 0);
  assert.notEqual(world.pvp.block(A.p, B.p), '', 'nobody is hurt before the start');
  const m = mm.of.get(A.p.id);
  m.startsAt = Date.now() - 1;
  for (const p of [A.p, B.p]) p.pvpShieldUntil = 0;
  assert.equal(world.pvp.block(A.p, B.p), '', 'then they fight');
  const ra = world.pvp.rating.get(A.p.id) ?? 1000;
  world.hurt(B.p, 1e9, 0, A.p);
  assert.ok(B.p.dead && m.overAt > 0 && m.winner === m.side.get(A.p.id));
  assert.ok((world.pvp.rating.get(A.p.id) ?? 0) > ra, 'the winner gains rating');
  assert.ok(A.out.some((x) => x.t === 'match' && x.v?.result === 'won') && B.out.some((x) => x.t === 'match' && x.v?.result === 'lost'));
  m.overAt -= MATCH_END_MS;
  mm.tick(Date.now());
  assert.equal(A.p.room.zoneId, 'eldoria');
  assert.ok(Math.hypot(A.p.x - home.x, A.p.y - home.y) < 2, 'back where they were');
  assert.ok(!B.p.dead && B.p.room.zoneId === 'eldoria', 'the loser is brought back on their feet');
  assert.ok(!mm.of.has(A.p.id) && mm.matches.size === 0, 'the hall is closed');
  // leaving a rated duel loses it (once out of combat: nobody is taken from a fight)
  for (const p of [A.p, B.p]) p.lastCombat = -1000;
  world.pvpOp(A.p, { op: 'queue', mode: 'ranked' });
  world.pvpOp(B.p, { op: 'queue', mode: 'ranked' });
  mm.tick(Date.now());
  const rb = world.pvp.rating.get(B.p.id) ?? 1000;
  assert.equal(world.pvpOp(B.p, { op: 'leave' }), '');
  assert.equal(B.p.room.zoneId, 'eldoria');
  assert.ok((world.pvp.rating.get(B.p.id) ?? 0) < rb, 'whoever leaves loses');
  assert.equal(world.pvpOp(B.p, { op: 'unqueue' }), 'You are not in line');
});

test('G8 Shrine Clash: two balanced teams, team-mates are safe, kills and the shrine score, honour for both sides', () => {
  const h = harness({ capacity: 10 }), { world } = h, mm = world.pvp.matches as any;
  const ps = [h.join(0, 0, 'knight', 30), h.join(30, 0, 'mage', 30), h.join(60, 0, 'cleric', 30), h.join(90, 0, 'ranger', 30)].map((x) => x.p);
  for (const p of ps) assert.equal(world.pvpOp(p, { op: 'queue', mode: 'bg' }), '');
  mm.tick(Date.now());
  assert.ok(!mm.isMatch(ps[0].room), 'four in line: it waits for more');
  for (const p of ps) mm.queue.get(p.id).since -= BG.fillWaitMs;
  mm.tick(Date.now());
  assert.ok(ps.every((p) => mm.isMatch(p.room) && p.room === ps[0].room), 'then all four go in');
  const m = mm.of.get(ps[0].id);
  m.startsAt = Date.now() - 1;
  for (const p of ps) p.pvpShieldUntil = 0;
  const mate = ps.find((p) => p !== ps[0] && m.side.get(p.id) === m.side.get(ps[0].id))!, foe = ps.find((p) => m.side.get(p.id) !== m.side.get(ps[0].id))!;
  assert.equal(world.pvp.block(ps[0], mate), 'That player is on your team');
  assert.equal(world.pvp.block(ps[0], foe), '');
  const side = m.side.get(ps[0].id);
  world.hurt(foe, 1e9, 0, ps[0]);
  assert.equal(m.score[side], BG.killPoints, 'a kill scores');
  // the fallen come back at their base
  foe.deadTick -= Math.ceil(BG.respawnMs / TICK_MS) + 1;
  mm.tick(Date.now());
  assert.ok(!foe.dead && mm.isMatch(foe.room), 'back in the fight');
  // holding the shrine alone scores
  for (const p of ps) world.relocate(p, p.room, m.side.get(p.id) === side ? tileCenter(BG_SHRINE.tx) : tileCenter(BG_SHRINE.tx) + 30 * TILE, tileCenter(BG_SHRINE.ty));
  const before = m.score[side];
  m.nextHold = Date.now() - 1;
  mm.tick(Date.now());
  assert.equal(m.score[side], before + 1, 'the shrine scores for the team on it');
  assert.equal(m.shrine, side);
  // reaching the target wins; both sides are paid
  m.score[side] = BG.target - 1;
  const gold = ps[0].gold;
  m.nextHold = Date.now() - 1;
  mm.tick(Date.now());
  assert.ok(m.overAt > 0 && m.winner === side);
  assert.equal(ps[0].gold, gold + BG.winGold);
  m.overAt -= MATCH_END_MS;
  mm.tick(Date.now());
  assert.ok(ps.every((p) => p.room.zoneId === 'eldoria'), 'everyone goes home');
  assert.ok(RANKED.winHonor > 0);
});

test('M15 pets: whistles join the collection, a summoned pet gives its bonus, follows the owner on screen, levels up, can be named', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = h.join(0, 0, 'berserker', 20), p = a.p, other = h.join(30, 0, 'mage', 20);
  give(p, spec('pet_ember_kit', { qty: 2 }));
  const w = p.inv.find((i) => i.base === 'pet_ember_kit')!;
  assert.equal(world.inventory(p, { op: 'use', uid: w.uid }), '');
  assert.equal(w.qty, 1, 'one whistle used');
  assert.deepEqual(p.comp.pets.map((x) => [x.kind, x.name, x.level]), [['ember_kit', 'Ember Kit', 1]]);
  const uid = p.comp.pets[0].uid, atk0 = p.stats.atk;
  assert.equal(world.companion(p, { op: 'summon', uid }), '');
  assert.equal(p.stats.atk, Math.round(atk0 * (1 + petBonus(PETS.ember_kit, 1) / 100)), 'the pet\'s bonus applies');
  assert.deepEqual(p.meta().pet, ['ember_kit', 'Ember Kit', 1], 'others see the pet');
  assert.equal(other.p.known.has(p.id), false, 'and are sent the new look');
  // naming
  assert.match(world.companion(p, { op: 'rename', uid, name: '<script>' }) as string, /Pet names/);
  assert.equal(world.companion(p, { op: 'rename', uid, name: 'Cinder' }), '');
  assert.equal(p.meta().pet![1], 'Cinder');
  // levelling from the owner's experience
  world.grantExp(p, Math.ceil(petExpToNext(1) / 0.15) + 10);
  assert.equal(p.comp.pets[0].level, 2);
  assert.ok(a.out.some((m) => m.t === 'sys' && /Cinder reached level 2/.test(m.text)));
  // dismissing removes the bonus
  assert.equal(world.companion(p, { op: 'dismiss' }), '');
  assert.equal(p.stats.atk, atk0);
  assert.equal(p.meta().pet, undefined);
  assert.equal(p.progDirty, true, 'saved with the character');
  // stored data is checked
  const c = cleanCompanions({ pets: [{ uid: 'a', kind: 'ember_kit', name: 'X!', level: 99, exp: -1 }, { uid: 'a', kind: 'ember_kit' }, { uid: 'b', kind: 'dragon' }], pet: 'a', mounts: ['frost_elk', 'frost_elk', 'pegasus'], riding: 'frost_elk' });
  assert.deepEqual(c, { pets: [{ uid: 'a', kind: 'ember_kit', name: 'Ember Kit', level: PET_MAX_LEVEL, exp: 0 }], pet: 'a', mounts: ['frost_elk'], riding: '' }, 'nobody logs in riding; bad entries are dropped');
});

import { PET_IDS, PET_SKILLS, petSkillPower } from '../shared/src/companions';
import { petAct } from '../server/src/game/Companions';

test('G10 pets fight: each pet has a skill on its own cooldown, used only in a fight, on monsters only; healers and shields wait until the owner is hurt', () => {
  assert.deepEqual(Object.keys(PET_SKILLS).sort(), [...PET_IDS].sort(), 'every pet has a skill');
  assert.ok(petSkillPower(60) > petSkillPower(20) && petSkillPower(20) > petSkillPower(1));
  const h = harness({ capacity: 10 }), { world } = h;
  const summon = (p: any, kind: string, level = 1) => {
    p.comp.pets.push({ uid: 'u_' + kind + p.id, kind, name: 'Pal', level, exp: 0 });
    assert.equal(world.companion(p, { op: 'summon', uid: 'u_' + kind + p.id }), '');
  };
  const a = h.join(0, 0, 'knight', 30), p = a.p;
  summon(p, 'iron_pup');
  const m = world.spawn(p.room, 'mossling', p.x + 60, p.y);
  m.maxHp = m.hp = 1e7;
  p.target = m;
  petAct(world, p, world.tick);
  assert.equal(m.hp, 1e7, 'no fight yet: the pet waits');
  p.lastCombat = world.tick;
  petAct(world, p, world.tick);
  assert.ok(m.hp < 1e7, 'in a fight it pounces');
  assert.ok(m.st.some((x) => x.i === STATUS_INDEX.stun), 'and stuns');
  const hp1 = m.hp;
  petAct(world, p, world.tick + 1);
  assert.equal(m.hp, hp1, 'then waits for its cooldown');
  assert.ok(p.petSkillAt > world.tick);
  // a healer waits until its owner is hurt
  const b = h.join(0, 20, 'mage', 30).p;
  summon(b, 'moss_sprout', 40);
  b.lastCombat = world.tick;
  petAct(world, b, world.tick);
  assert.equal(b.petSkillAt, 0, 'healthy owner: nothing to do');
  b.hp = Math.round(b.maxHp * 0.5);
  const hp0 = b.hp;
  petAct(world, b, world.tick);
  assert.ok(b.hp > hp0, 'heals the hurt owner');
  // a shield
  const c = h.join(0, 40, 'ranger', 30).p;
  summon(c, 'bog_toad');
  c.lastCombat = world.tick;
  c.hp = Math.round(c.maxHp * 0.4);
  petAct(world, c, world.tick);
  assert.ok(c.st.some((x) => x.i === STATUS_INDEX.barrier), 'shields the owner');
  // pets never attack players
  const d = h.join(0, 60, 'assassin', 30).p, foe = h.join(30, 60, 'knight', 30).p;
  summon(d, 'ember_kit');
  d.lastCombat = world.tick;
  (d as any).target = foe;
  const fhp = foe.hp;
  petAct(world, d, world.tick);
  assert.equal(foe.hp, fhp);
  // the area skill reaches the monsters around the target
  const e = h.join(0, 80, 'cleric', 30).p;
  summon(e, 'star_mote');
  const m1 = world.spawn(e.room, 'mossling', e.x + 80, e.y), m2 = world.spawn(e.room, 'mossling', e.x + 110, e.y);
  m1.maxHp = m1.hp = m2.maxHp = m2.hp = 1e7;
  e.target = m1;
  e.lastCombat = world.tick;
  petAct(world, e, world.tick);
  assert.ok(m1.hp < 1e7 && m2.hp < 1e7, 'both monsters are struck');
});

import { DODGE } from '../shared/src/combat';

test('G1 dodge roll: a quick dash the way the player is moving, blows during it miss, then a cooldown', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = h.join(0, 0, 'knight', 30), p = a.p;
  const x0 = p.x;
  p.inQ.push(p.lastSeq + 1, 1, 0, 1); // moving right
  assert.equal(world.dodge(p), '');
  assert.ok(p.x > x0 + DODGE.dist * 0.5, 'rolled to the right');
  assert.equal(p.inQ.length, 0, 'the predicted inputs are dropped; the client is corrected');
  assert.ok(a.out.length >= 0);
  const hp = p.hp, foe = world.spawn(p.room, 'mossling', p.x + 30, p.y);
  world.hurt(p, 50, 0, foe);
  assert.equal(p.hp, hp, 'a blow during the roll misses');
  world.hurt(p, 50, Dmg.Dot, foe);
  assert.ok(p.hp < hp, 'but a poison already working still does');
  assert.equal(world.dodge(p), 'Not ready');
  p.evadeUntil = 0;
  const hp2 = p.hp;
  world.hurt(p, 50, 0, foe);
  assert.ok(p.hp < hp2, 'after the roll, blows land again');
  p.dodgeAt = 0;
  p.mods = { ...p.mods, stun: true } as any;
  assert.equal(world.dodge(p), 'You cannot move');
});

import { BASIC_COMBO, FINISHERS } from '../shared/src/combat';

test('G1 combos: every third basic blow in a row is a finisher with its class effect; a skill right after hits harder', () => {
  assert.deepEqual(Object.keys(FINISHERS).sort(), Object.keys(JOB_DEFS).sort(), 'a finisher for every class');
  const h = harness({ capacity: 10 }), { world } = h;
  const a = h.join(0, 0, 'knight', 30), p = a.p;
  const m = world.spawn(p.room, 'mossling', p.x + 30, p.y);
  m.maxHp = m.hp = 1e7;
  const blow = () => { const hp = m.hp; (world as any).playerAttack(p, m); return hp - m.hp; };
  const d1 = blow(), d2 = blow(), d3 = blow();
  assert.ok(Math.abs(d1 - d2) <= 1, 'the first two blows are alike');
  assert.ok(d3 >= d1 * (BASIC_COMBO.mul - 0.1), 'the third is a finisher');
  assert.ok(m.st.some((x) => x.i === STATUS_INDEX.stun), 'the knight\'s finisher stuns');
  assert.ok(p.weaveUntil > world.tick, 'skills hit harder for a moment');
  const d4 = blow();
  assert.ok(Math.abs(d4 - d1) <= 1, 'and the chain starts again');
  // a pause breaks the chain
  p.comboAt = world.tick - Math.ceil(BASIC_COMBO.windowMs / 50) - 2;
  blow(); blow();
  assert.ok(Math.abs(blow() - d1) > 1, 'two blows after a pause, then the finisher');
  // a cleric's finisher heals
  const c = h.join(0, 30, 'cleric', 30).p, mc = world.spawn(c.room, 'mossling', c.x + 30, c.y);
  mc.maxHp = mc.hp = 1e7;
  c.hp = Math.round(c.maxHp / 2);
  for (let i = 0; i < 3; i++) (world as any).playerAttack(c, mc);
  assert.ok(c.hp > Math.round(c.maxHp / 2));
});

import { aimable } from '../shared/src/abilities';

test('G1 aimed skills: areas and cones land where the player aims, without a target; too far is pulled back or refused', () => {
  assert.ok(aimable(ABILITIES.volley) && aimable(ABILITIES.meteor_strike) && !aimable(ABILITIES.arcane_bolt) && !aimable(ABILITIES.charge));
  const { world, join } = harness({ capacity: 10 });
  const a = join(0, 0, 'ranger', 30), p = a.p;
  grant(p, ['volley'], []);
  const r = ABILITIES.volley.range;
  assert.equal(world.use(p, 'volley', 0, p.x + r * 3, p.y), 'Out of range');
  assert.equal(world.use(p, 'volley', 0, p.x + 120, p.y + 40), '', 'no monster needed');
  const f = p.room.fields[p.room.fields.length - 1];
  assert.ok(Math.abs(f.x - (p.x + 120)) < 1 && Math.abs(f.y - (p.y + 40)) < 1, 'the volley falls where it was aimed');
  p.cds.clear(); p.gcd = 0; p.res = 999;
  assert.equal(world.use(p, 'volley', 0, p.x + (r + 20) * 1.5, p.y), '');
  const g = p.room.fields[p.room.fields.length - 1];
  assert.ok(Math.abs(g.x - (p.x + r + 20)) < 1, 'a little too far lands at the edge of the range');
  // an unaimable skill ignores the aim and needs its target as before
  grant(p, ['power_shot'], []);
  p.cds.clear(); p.gcd = 0;
  assert.equal(world.use(p, 'power_shot', 0, p.x + 50, p.y), 'No target');
});

test('M15 mounts: faster movement through the same collision rules, a level to ride, kept when struck, not in dungeons or the arena', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const a = h.join(0, 0, 'knight', 25), p = a.p;
  give(p, spec('mount_plains_strider'));
  assert.equal(world.inventory(p, { op: 'use', uid: p.inv.find((i) => i.base === 'mount_plains_strider')!.uid }), '');
  assert.deepEqual(p.comp.mounts, ['plains_strider']);
  give(p, spec('mount_plains_strider'));
  assert.equal(world.inventory(p, { op: 'use', uid: p.inv.find((i) => i.base === 'mount_plains_strider')!.uid }), 'You already have this mount');
  const step0 = p.runStep, mul0 = p.stats.moveMul;
  assert.equal(world.companion(p, { op: 'mount', id: 'plains_strider' }), '');
  assert.equal(p.stats.moveMul, Math.round(mul0 * MOUNTS.plains_strider.speed * 1000) / 1000);
  assert.ok(p.runStep > step0 * 1.25, 'each step covers more ground');
  assert.equal(p.meta().mnt, 'plains_strider');
  assert.ok(a.out.some((m) => m.t === 'stats' && m.stats.moveMul === p.stats.moveMul), 'the client is told its new speed, so its prediction matches');
  // collision is the same: walking into a wall stops a rider exactly as it stops a walker
  const map = p.room.map;
  let wall: [number, number] | null = null;
  for (let tx = 2; tx < map.w - 2 && !wall; tx++) for (let ty = 2; ty < map.h - 2 && !wall; ty++) if (!blocked(map, tileCenter(tx), tileCenter(ty)) && blocked(map, tileCenter(tx + 1), tileCenter(ty))) wall = [tx, ty];
  world.relocate(p, p.room, tileCenter(wall![0]), tileCenter(wall![1]));
  for (let i = 0; i < 20; i++) stepMove(p, 1, 0, map, p.runStep);
  assert.equal(blocked(map, p.x, p.y), false, 'never inside the obstacle');
  assert.ok(p.x < tileCenter(wall![0] + 1), 'and not through it');
  // a blow does not knock the rider off
  world.hurt(p, 1, 0, null);
  assert.equal(p.comp.riding, 'plains_strider', 'still riding after being struck');
  // getting off and back on works in a fight too
  assert.equal(world.companion(p, { op: 'dismount' }), '');
  assert.equal(p.stats.moveMul, mul0);
  assert.equal(world.companion(p, { op: 'mount', id: 'plains_strider' }), '', 'mounting in combat is allowed');
  assert.equal(world.companion(p, { op: 'dismount' }), '');
  p.lastCombat = -1e6;
  // level
  const low = h.join(0, 40, 'mage', 5);
  low.p.comp.mounts.push('plains_strider');
  assert.equal(world.companion(low.p, { op: 'mount', id: 'plains_strider' }), `Requires level ${MOUNTS.plains_strider.level}`);
  // entering a dungeon dismounts; riding is refused inside
  assert.equal(world.companion(p, { op: 'mount', id: 'plains_strider' }), '');
  const room = new ZoneRoom('d_ruins', 777);
  world.addRoom(room);
  world.relocate(p, room, tileCenter(ZONES.d_ruins.spawn.tx), tileCenter(ZONES.d_ruins.spawn.ty));
  assert.equal(p.comp.riding, '', 'dismounted on entering');
  assert.equal(world.companion(p, { op: 'mount', id: 'plains_strider' }), 'You cannot ride here');
  assert.equal(world.companion(p, { op: 'mount', id: 'void_skiff' }), 'You do not have that mount');
});

// ---------------------------------------------------------------------------------------------
// M16: settings, key binding, translations, run-time message catalog
// ---------------------------------------------------------------------------------------------
import {
  ACTION_GROUPS, ACTION_LIST, ACTIONS, actionFor, bindKey, cleanGameSettings, defaultBindings, defaultGameSettings, keyConflicts, keyLabel,
  MAX_MARKERS, RESERVED_KEYS, TUTORIAL_STEPS, UI_SCALES,
} from '../shared/src/settings';
import { en } from '../client/src/i18n/en';
import { id as idDict } from '../client/src/i18n/id';
import { MESSAGES } from '../client/src/i18n/messages';
import { SHOP_COMPANIONS } from '../shared/src/items';
import { matchMessage, tm } from '../client/src/i18n';
import fsM16 from 'node:fs';
import { RARITIES as RAR16, SLOT_NAMES as SLOTN16, STAT_LABEL as STATL16 } from '../shared/src/items';
import { ATTR_NAMES as ATTRN16 } from '../shared/src/jobs';
import { AP_LABELS as APL16, ANIM_NAMES as ANIMN16 } from '../shared/src/appearance';
import { ELEMENTS as EL16 } from '../shared/src/abilities';
import { DIFFICULTY as DIFF16 } from '../shared/src/dungeons';
import { REP_LEVELS as REPL16 } from '../shared/src/quests';
import { AUCTION_CATEGORIES as CATS16, GUILD_RANKS as RANKS16, SORTS as SORTS16 } from '../shared/src/economy';
import { LOOT_MODES as LOOTM16, SORT_KEYS as SORTK16 } from '../shared/src/protocol';
import { PETS as PETS16 } from '../shared/src/companions';

test('M16 key bindings: defaults have no conflicts, conflicts are detected, reserved keys refused, nothing taken silently', () => {
  const d = defaultBindings();
  assert.equal(keyConflicts(d).size, 0, 'the default layout uses every key once');
  assert.ok(ACTION_GROUPS.flatMap(([, a]) => a).length === ACTION_LIST.length && ACTION_LIST.every((a) => ACTION_GROUPS.some(([, l]) => l.includes(a))), 'every action is on the settings screen exactly once');
  assert.equal(actionFor(d, 'KeyW'), 'move.up');
  assert.equal(actionFor(d, 'ArrowUp'), 'move.up');
  assert.equal(actionFor(d, 'KeyM'), 'panel.map');
  // rebinding attack to Q collides with the first rune spell: refused, and the user is told who uses it
  const r = bindKey(d, 'attack', 0, 'KeyQ');
  assert.deepEqual(r, { conflict: ['rune.1.1'] });
  const ok = bindKey(d, 'attack', 1, 'KeyL' === 'KeyL' ? 'Numpad0' : '');
  assert.ok('ok' in ok && ok.ok.attack.join() === 'Space,Numpad0', 'a second key for an action');
  assert.deepEqual(bindKey(d, 'attack', 0, 'Escape'), { reserved: true }, 'Escape always closes panels');
  assert.deepEqual(bindKey(d, 'attack', 0, 'F5'), { reserved: true });
  assert.ok(RESERVED_KEYS.includes('F9'), 'the developer overlay key stays free');
  // stored data with a conflict: the later action loses the key, nothing is used twice
  const clean = cleanGameSettings({ keys: { attack: ['KeyQ'], 'rune.1.1': ['KeyQ'], walk: ['Escape', 'KeyZ', 'KeyX', 'KeyC'], 'not.an.action': ['KeyK'] } });
  assert.deepEqual(clean.keys.attack, ['KeyQ']);
  assert.deepEqual(clean.keys['rune.1.1'], [], 'the duplicate is dropped');
  assert.deepEqual(clean.keys.walk, ['KeyZ', 'KeyX'], 'reserved keys dropped, at most two per action');
  assert.equal(keyConflicts(clean.keys).size, 0);
  assert.ok(!('not.an.action' in clean.keys));
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('ArrowLeft'), '←');
});

test('M16 settings document: every field is validated; bad values fall back to defaults; markers are cleaned and capped', () => {
  assert.deepEqual(cleanGameSettings(null), defaultGameSettings());
  assert.deepEqual(cleanGameSettings('nonsense'), defaultGameSettings());
  const s = cleanGameSettings({
    lang: 'id', uiScale: 1.25, graphics: { quality: 'low', shake: false, damageNumbers: 0, nameplates: false }, camera: { zoom: 1 }, movement: { walkToggle: true },
    tutorial: { done: ['move', 'move', 'hack', 'auto'], skipped: true },
    markers: [{ id: 'a1', zone: 'verdant', x: 100.4, y: 200, label: '<b>Herbs</b> by the river and beyond' }, { id: 'BAD!', zone: 'verdant', x: 1, y: 1 }, { id: 'b', zone: 'eldoria', x: 'x', y: 1 }],
  });
  assert.equal(s.lang, 'id');
  assert.equal(s.uiScale, 1.25);
  assert.deepEqual(s.graphics, { quality: 'low', shake: false, damageNumbers: true, nameplates: false, weather: true, questMarkers: true, art: 'hd', renderer: 'hd2d' });
  assert.deepEqual([s.camera.zoom, s.movement.walkToggle], [1, true]);
  assert.deepEqual(s.tutorial, { done: ['move', 'auto'], skipped: true });
  assert.deepEqual(s.markers, [{ id: 'a1', zone: 'verdant', x: 100, y: 200, label: 'bHerbs/b by the river an' }], 'markup stripped, length capped, malformed markers dropped');
  const bad = cleanGameSettings({ lang: 'fr', uiScale: 7, graphics: { quality: 'ultra' }, camera: { zoom: 5 } });
  assert.deepEqual([bad.lang, bad.uiScale, bad.graphics.quality, bad.camera.zoom], ['en', 1, 'high', 0]);
  assert.ok(UI_SCALES.includes(1));
  const many = cleanGameSettings({ markers: Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i, zone: 'eldoria', x: i, y: i, label: '' })) });
  assert.equal(many.markers.length, MAX_MARKERS);
  assert.ok(JSON.stringify(cleanGameSettings({ ...defaultGameSettings(), markers: many.markers })).length < 8192, 'a full settings document fits the request size limit');
});

/** The `{name}` placeholders of a template, sorted. */
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('M16 translations: English and Indonesian have the same keys and the same placeholders; every key family the code builds exists', () => {
  const ek = Object.keys(en).sort(), ik = Object.keys(idDict).sort();
  assert.deepEqual(ik, ek, 'the same keys in both languages');
  for (const k of ek) {
    assert.equal(holes((idDict as any)[k]), holes((en as any)[k]), `placeholders of ${k}`);
    assert.ok((idDict as any)[k].trim(), `${k} is not empty in Indonesian`);
  }
  const untranslated = ek.filter((k) => (idDict as any)[k] === (en as any)[k] && /[a-z]{4,} [a-z]{4,}/i.test((en as any)[k]));
  assert.deepEqual(untranslated, [], 'no sentence was left in English');
  // keys built from data at run time (t(`act.${a}`) and the like) must all exist
  const need = [
    ...ACTION_LIST.map((a) => `act.${a}`), ...ACTION_GROUPS.map(([g]) => `keys.group.${g}`),
    ...['audio', 'controls', 'graphics', 'interface', 'camera'].map((x) => `settings.tab.${x}`),
    ...['low', 'medium', 'high'].flatMap((q) => [`gfx.q.${q}`, `gfx.q.${q}Tip`]),
    ...['you', 'party', 'town', 'waystone', 'dungeon', 'hunt', 'elite', 'boss', 'exit', 'marker'].map((k) => `map.legend.${k}`),
    ...TUTORIAL_STEPS.flatMap((s) => [`tut.${s}.title`, `tut.${s}.text`]),
    ...['body', 'build', 'height', 'skin', 'face', 'eyes', 'eyeColor', 'hair', 'hairColor', 'clothing', 'color1', 'color2', 'armor', 'armorColor', 'helmet', 'helmetColor', 'weapon', 'cape', 'capeColor', 'accessory', 'accessoryColor', 'aura'].map((f) => `ap.${f}`),
    ...LOOTM16.map((m) => `loot.${m}`), ...SORTK16.map((k) => `sort.${k}`), ...CATS16.map((c) => `ah.cat.${c}`), ...SORTS16.map((s) => `ah.sort.${s}`),
    ...['active', 'sold', 'cancelled', 'expired'].map((s) => `ah.status.${s}`), ...[...new Set(Object.values(PETS16).map((p) => p.stat))].map((s) => `comp.stat.${s}`),
    ...['potion', 'material', 'scroll'].map((k) => `auto.ignore.${k}`),
  ];
  const vocab = [...RAR16, ...Object.values(SLOTN16), ...Object.values(STATL16), ...Object.values(ATTRN16), ...(Object.values(APL16).flat() as string[]), ...ANIMN16,
    ...EL16.map((e) => e[0].toUpperCase() + e.slice(1)), ...Object.values(DIFF16).map((d: any) => d.name), ...REPL16.map((r) => r.name), ...RANKS16];
  need.push(...vocab.map((w) => `v.${w}`));
  assert.deepEqual(need.filter((k) => !(k in en)), [], 'every key the code builds exists');
  // tutorial texts name keys only through placeholders, so they follow the player's bindings
  for (const s of TUTORIAL_STEPS) assert.doesNotMatch((en as any)[`tut.${s}.text`], /\bpress [A-Z]\b|\(press [A-Z]\)/, s);
});

/**
 * Every message the server can send as text, found in its source: string literals on lines that
 * send or return a message. Each one, with sample values in place of its ${...} parts, must be
 * matched by the catalog, so that it can be shown in every language.
 */
function serverMessages(): { file: string; text: string }[] {
  const files = [
    ...fsM16.readdirSync('server/src/game').filter((f) => f.endsWith('.ts')).map((f) => 'server/src/game/' + f),
    'server/src/app.ts', 'shared/src/pvp.ts', 'shared/src/quests.ts', 'shared/src/abilities.ts', 'shared/src/items.ts', 'client/src/game/Game.ts', 'client/src/game/autohunt.ts',
  ];
  const ctx = /(return |why: |text: |userError\(|HttpError\(\d+, |notice\(|reason: |hint: |\bstop\(|status = |announce(All)?\([^,]+, |pushChat\(\{ text: |kick\(|\? |: )/;
  const lit = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    const lines = fsM16.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!ctx.test(line) || t.startsWith('//') || t.startsWith('*') || /console\.|desc: |blurb: |text: '[^']*' \}\)|label: |name: /.test(line)) continue;
      // content (item, quest and lore text) is not translated yet: in the data files only returned refusals count
      if (/shared\/src\/(quests|items|abilities)\.ts/.test(file) && !/return ['`]/.test(line)) continue;
      if (/^['`]/.test(t)) continue; // a bare string in a list of content (cache lore and the like)
      if (/^(eldoria|verdant|ashen|frostveil|dreadmoor|astral): ['`]/.test(t)) continue; // per-region lore
      // only real sentences sent to players: content descriptions are excluded by the patterns above
      for (const m of line.matchAll(lit)) {
        let s = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
        // nested template parts: flatten ${...} (with braces inside) to a sample value
        for (let i = 0; i < 4; i++) s = s.replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, 'Xq');
        if (s.length < 6 || !/^([A-Z"(+]|Xq [a-z])/.test(s) || !/[a-z]{2,} [a-z]{2,}|[a-z]{3,}[.!?]$/.test(s)) continue;
        if (/SELECT|INSERT|UPDATE |DELETE |ON CONFLICT|Bearer|application\/|charset|default-src|DEBUG/.test(s)) continue;
        out.push({ file, text: s });
      }
    }
  }
  return out;
}

test('M16 run-time messages: every message the server or game loop sends has an Indonesian version', () => {
  // Indonesian may leave out a value English needs only for a plural ending ("item{b}"), never add one
  for (const [k, v] of Object.entries(MESSAGES)) for (const h of holes(v.id).split(',').filter(Boolean)) assert.ok(holes(v.en).split(',').includes(h), `placeholder ${h} of message ${k}`);
  const found = serverMessages(), missing = found.filter((x) => !matchMessage(x.text)).map((x) => `${x.file}: ${x.text}`);
  assert.ok(found.length > 250, `the scan finds the messages (${found.length})`);
  assert.deepEqual([...new Set(missing)], [], 'messages without a translation');
  // translation itself, including a message inside a message
  assert.equal(tm('Not enough gold', 'id'), 'Emas tidak cukup');
  assert.equal(tm('Requires level 12', 'id'), 'Butuh level 12');
  assert.equal(tm('Trade cancelled: The other player is offline.', 'id'), 'Dagang dibatalkan: Pemain lain sedang luring.');
  assert.equal(tm('Stopped: you took the controls', 'id'), 'Berhenti: kamu mengambil kendali');
  assert.equal(tm('Not enough gold', 'en'), 'Not enough gold', 'English is shown as sent');
  assert.equal(tm('Some text nobody wrote a template for', 'id'), 'Some text nobody wrote a template for', 'unknown text is shown unchanged, never lost');
});

// ---------------------------------------------------------------------------------------------
// Sub-skills: two enhancement branches per active skill, learned with skill points
// ---------------------------------------------------------------------------------------------
import { enhance, SUB_MAX_RANK, SUBSKILL_LIST, SUBSKILLS, subsOf } from '../shared/src/subskills';

test('sub-skills: every active skill of every job has exactly two branches, of different kinds; passives and runes have none', () => {
  let n = 0;
  for (const job of JOBS) {
    const actives = jobActives(job);
    for (const a of actives) {
      const s = subsOf(a.id);
      assert.equal(s.length, 2, a.id);
      assert.notEqual(s[0].mod.k, s[1].mod.k, `${a.id}: two different enhancements`);
      assert.ok(s.every((x) => x.job === job && x.maxRank === SUB_MAX_RANK && x.name.length > 2), a.id);
      n += 2;
    }
    for (const p of JOB_DEFS[job].skills.filter((x) => x.type === 'passive')) assert.equal(subsOf(p.id).length, 0, p.id);
  }
  assert.equal(SUBSKILL_LIST.length, n, 'nothing else has sub-skills');
  assert.equal(new Set(SUBSKILL_LIST.map((s) => s.name)).size, n, 'every branch has its own name');
  for (const r of ABILITY_LIST.filter((a) => a.kind === 'rune')) assert.equal(subsOf(r.id).length, 0);
  // every branch changes something its skill actually has (no "+area" on a skill without an area)
  for (const s of SUBSKILL_LIST) {
    const base = ABILITIES[s.parent], b = { skills: { [s.parent]: 1, [s.id]: SUB_MAX_RANK }, runes: { slots: [], lv: {}, xp: {} } } as Build;
    assert.notDeepEqual(enhance(base, b), base, `${s.id} (${s.mod.k}) changes ${s.parent}`);
  }
});

test('sub-skills: the enhanced skill, rank by rank; the base definition is never changed', () => {
  const B = (skills: Record<string, number>) => ({ skills, runes: { slots: [], lv: {}, xp: {} } }) as Build;
  const before = JSON.stringify(ABILITY_LIST);
  const bolt = enhance(ABILITIES.arcane_bolt, B({ arcane_bolt: 1, 'arcane_bolt.a': 3, 'arcane_bolt.b': 2 }));
  assert.ok(Math.abs(bolt.hit!.mul - 1.5 * 1.24) < 1e-9, '+8% damage per rank');
  assert.equal(bolt.cost, 5, '-12% cost per rank (6 -> 5)');
  assert.equal(enhance(ABILITIES.guard_stance, B({ guard_stance: 1, 'guard_stance.b': 3 })).cdMs, 15200, '-8% cooldown per rank');
  assert.equal(enhance(ABILITIES.whirlwind, B({ whirlwind: 1, 'whirlwind.a': 2 })).hit!.aoeSelf, 87, '+12% area per rank');
  assert.equal(enhance(ABILITIES.cleave, B({ cleave: 1, 'cleave.a': 2 })).hit!.maxTargets, 7, '+1 target per rank');
  assert.equal(enhance(ABILITIES.cataclysm, B({ cataclysm: 1, 'cataclysm.b': 3 })).castMs, 1100, '-15% cast time per rank');
  assert.ok(Math.abs(enhance(ABILITIES.mend, B({ mend: 1, 'mend.a': 3 })).heal! - 2.2 * 1.3) < 1e-9, '+10% healing per rank');
  assert.equal(enhance(ABILITIES.rend, B({ rend: 1, 'rend.a': 1 })).status![0].durMul, 1.15, '+15% duration per rank');
  assert.equal(enhance(ABILITIES.volley, B({ volley: 1, 'volley.b': 2 })).field!.ms, Math.round(2400 * 1.3), 'ground effects last longer too');
  assert.equal(enhance(ABILITIES.backstab, B({ backstab: 1, 'backstab.b': 3 })).hit!.critAdd, 18);
  const pin = enhance(ABILITIES.power_shot, B({ power_shot: 1, 'power_shot.b': 2 }));
  assert.deepEqual(pin.status!.at(-1), { id: 'slow', on: 'enemy', chance: 30 }, 'a new status, 15% chance per rank');
  assert.ok(enhance(ABILITIES.blink, B({ blink: 1, 'blink.a': 1 })).dist! > (ABILITIES.blink.dist ?? 0), 'a longer blink');
  assert.equal(enhance(ABILITIES.fireball, B({ 'arcane_bolt.a': 3 })), ABILITIES.fireball, 'rune spells are untouched');
  assert.equal(enhance(ABILITIES.arcane_bolt, B({ arcane_bolt: 3 })), ABILITIES.arcane_bolt, 'no branches learned: the same skill');
  assert.equal(JSON.stringify(ABILITY_LIST), before, 'the shared definitions were not modified');
});

test('sub-skills: learned with skill points once their skill is learned, up to 3 ranks; stored builds are checked; a reset refunds them', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight', 6), p = a.p;
  assert.match(world.learn(p, 'shield_bash.a'), /^Learn Shield Bash first$/);
  assert.equal(world.learn(p, 'arcane_bolt.a'), 'Not a skill of this job');
  assert.equal(world.learn(p, 'shield_bash'), '');
  for (let i = 0; i < 3; i++) assert.equal(world.learn(p, 'shield_bash.a'), '');
  assert.equal(world.learn(p, 'shield_bash.a'), 'Already at maximum rank');
  assert.equal(p.build.skills['shield_bash.a'], 3);
  assert.equal(freePoints(p.level, p.build), 6 - 4, 'each rank costs a skill point');
  assert.equal(world.learn(p, 'shield_bash.b'), '');
  assert.equal(world.learn(p, 'taunt'), '');
  assert.equal(world.learn(p, 'taunt.a'), 'No skill points');
  // stored data: branches of another job, of an unlearned skill, or above the rank cap are dropped or clamped
  const c = cleanBuild('knight', 20, { skills: { shield_bash: 1, 'shield_bash.a': 9, 'taunt.b': 2, 'arcane_bolt.a': 1, 'cleave.z': 1 } });
  assert.deepEqual(c.skills, { shield_bash: 1, 'shield_bash.a': 3 });
  assert.equal(cleanBuild('knight', 3, { skills: { shield_bash: 1, 'shield_bash.a': 3 } }).skills['shield_bash.a'], undefined, 'never more points than the level allows');
  // a reset refunds everything, branches included
  step(Math.ceil(COMBAT_TIMEOUT_MS / TICK_MS) + 2);
  assert.equal(world.respec(p), '');
  assert.equal(freePoints(p.level, p.build), 6);
  assert.ok(SUBSKILLS['shield_bash.a']);
});

test('sub-skills in combat: the server casts the enhanced skill (damage, cost, cooldown, area, duration, added status)', () => {
  const { world, join } = harness({ capacity: 10 });
  // damage: the same bolt with and without "Focused Bolt" rank 3
  const m1 = join(0, 0, 'mage', 20), m2 = join(0, 60, 'mage', 20);
  grant(m1.p, ['arcane_bolt']);
  grant(m2.p, ['arcane_bolt', 'arcane_bolt.a', 'arcane_bolt.b'], [], 1, 1);
  m2.p.build.skills['arcane_bolt.a'] = 3;
  m2.p.build.skills['arcane_bolt.b'] = 2;
  const t1 = world.spawn(m1.p.room, 'rootwarden', m1.p.x + 80, m1.p.y), t2 = world.spawn(m2.p.room, 'rootwarden', m2.p.x + 80, m2.p.y);
  const r1 = m1.p.res, r2 = m2.p.res, h1 = t1.hp, h2 = t2.hp;
  assert.equal(world.use(m1.p, 'arcane_bolt', t1.id), '');
  assert.equal(world.use(m2.p, 'arcane_bolt', t2.id), '');
  const d1 = h1 - t1.hp, d2 = h2 - t2.hp;
  assert.ok(d2 > d1 * 1.15, `more damage (${d1} -> ${d2})`);
  assert.deepEqual([r1 - m1.p.res, r2 - m2.p.res], [6, 5], 'a lower cost');
  // cooldown
  const k1 = join(0, 120, 'knight', 20), k2 = join(0, 180, 'knight', 20);
  grant(k1.p, ['guard_stance']);
  grant(k2.p, ['guard_stance']);
  k2.p.build.skills['guard_stance.b'] = 3;
  world.use(k1.p, 'guard_stance', 0);
  world.use(k2.p, 'guard_stance', 0);
  const cd1 = k1.p.cds.get('guard_stance')! - world.tick, cd2 = k2.p.cds.get('guard_stance')! - world.tick;
  assert.ok(Math.abs(cd2 / cd1 - 0.76) < 0.02, `a shorter cooldown (${cd1} -> ${cd2} ticks)`);
  // duration: Guard Stance lasts longer with "Bulwark Discipline"
  const k3 = join(0, 240, 'knight', 20);
  grant(k3.p, ['guard_stance']);
  k3.p.build.skills['guard_stance.a'] = 2;
  world.use(k3.p, 'guard_stance', 0);
  const g1 = k1.p.st.find((s) => s.i === STATUS_INDEX.guard)!.until - world.tick, g3 = k3.p.st.find((s) => s.i === STATUS_INDEX.guard)!.until - world.tick;
  assert.ok(Math.abs(g3 / g1 - 1.3) < 0.03, `the buff lasts longer (${g1} -> ${g3} ticks)`);
  // area: a monster just beyond the plain Whirlwind is caught by "Wide Spin"
  const b1 = join(300, 0, 'berserker', 20), b2 = join(300, 200, 'berserker', 20);
  for (const b of [b1, b2]) grant(b.p, ['whirlwind']);
  b2.p.build.skills['whirlwind.a'] = 3;
  for (const b of [b1, b2]) b.p.res = b.p.stats.maxRes;
  const reach = (b: typeof b1) => world.spawn(b.p.room, 'rootwarden', b.p.x + 70 + MONSTERS.rootwarden.radius + 12, b.p.y);
  const w1 = reach(b1), w2 = reach(b2), wh1 = w1.hp, wh2 = w2.hp;
  assert.equal(world.use(b1.p, 'whirlwind', 0), '');
  assert.equal(world.use(b2.p, 'whirlwind', 0), '');
  assert.equal(w1.hp, wh1, 'out of reach of the plain whirlwind');
  assert.ok(w2.hp < wh2, 'inside the wider one');
  // an added status: "Bloodied Spin" makes whirlwind cause bleeding
  const b3 = join(300, 400, 'berserker', 20);
  grant(b3.p, ['whirlwind']);
  b3.p.build.skills['whirlwind.b'] = 3; // 45%: the harness rolls 0.5, so it needs the dice
  const v = world.spawn(b3.p.room, 'rootwarden', b3.p.x + 40, b3.p.y);
  b3.p.res = b3.p.stats.maxRes;
  const realRnd = (world as any).rnd;
  (world as any).rnd = () => 0.2;
  assert.equal(world.use(b3.p, 'whirlwind', 0), '');
  (world as any).rnd = realRnd;
  assert.ok(v.st.some((s) => s.i === STATUS_INDEX.bleed), 'the target bleeds');
});

// ---------------------------------------------------------------------------------------------
// Smarter auto hunting: where to stand, targets behind obstacles, flyers over obstacles
// ---------------------------------------------------------------------------------------------
import { AutoHunter, type HunterHost } from '../client/src/game/autohunt';
import { attackSpot as attackSpotH, walkField as walkFieldH } from '../shared/src/nav';
import { SOLID as SOLID_H } from '../shared/src/world';

/** Runs the real hunter against real map geometry: movement uses the game's own collision. */
function huntSim(zone: string, start: { x: number; y: number }, mob: { type: string; x: number; y: number }, reach: number, steps = 400) {
  const map = getZoneMap(zone), me = { x: start.x, y: start.y };
  let target = 0, attacks = 0, throughWall = 0;
  let attackedFrom = null as { x: number; y: number } | null;
  const m = { id: -1, type: mob.type, x: mob.x, y: mob.y, hp: 50, mhp: 50 };
  const host: HunterHost = {
    pos: () => me, map: () => map, playing: () => true, dead: () => false, hp: () => 100, maxHp: () => 100, res: () => 100, maxRes: () => 100,
    range: () => reach, monsters: () => [m], targetId: () => target, setTarget: (id) => void (target = id), attacking: () => false,
    attack: () => {
      attacks++;
      attackedFrom = { ...me };
      if (!lineOfSight(map, me.x, me.y, m.x, m.y, !!MONSTERS[m.type].flying)) throughWall++;
    },
    abilityReady: () => false, abilityCost: () => 0, useAbility: () => {}, ultReady: () => null, potions: () => 0, potionReady: () => false, quaff: () => {},
    usesMana: () => true, bagFull: () => false, notify: () => {},
  };
  const hunter = new AutoHunter(host);
  hunter.start(autoCfg({ radius: 14, potions: false, skills: false }), 0);
  let walkedIntoWall = 0;
  for (let i = 0; i < steps && !attacks; i++) {
    const s = hunter.step(i * 50);
    if (s) stepMove(me, s.ix, s.iy, map, 8);
    if (blocked(map, me.x, me.y)) walkedIntoWall++;
  }
  return { attacks, attackedFrom, throughWall, walkedIntoWall, target, status: hunter.status, me };
}

test('auto hunting picks where to stand: around an obstacle for a target behind it, to the bank for a flyer over one', () => {
  const zone = 'verdant', nav = navOf(zone), map = nav.map, w = map.w, R = 260 * 0.85;
  // --- a walker behind an obstacle: within bow range but out of sight from where the hunter starts ---
  let behind: { p: [number, number]; q: [number, number] } | null = null;
  for (let ty = 6; ty < map.h - 6 && !behind; ty++)
    for (let tx = 6; tx < w - 6 && !behind; tx++) {
      if (!nav.reach[tx + ty * w] || roomAround(nav, tx, ty, 2, 9) < 9) continue;
      for (const [dx, dy] of [[5, 0], [0, 5], [4, 3], [-5, 0]] as const) {
        const qx = tx + dx, qy = ty + dy;
        if (!nav.reach[qx + qy * w] || roomAround(nav, qx, qy, 2, 9) < 9) continue;
        if (!lineOfSight(map, tileCenter(tx), tileCenter(ty), tileCenter(qx), tileCenter(qy))) behind = { p: [tx, ty], q: [qx, qy] };
      }
    }
  assert.ok(behind, 'the test map has a target hidden behind an obstacle');
  const a = huntSim(zone, { x: tileCenter(behind!.p[0]), y: tileCenter(behind!.p[1]) }, { type: 'spider', x: tileCenter(behind!.q[0]), y: tileCenter(behind!.q[1]) }, 260);
  assert.ok(a.attacks > 0, `the hunter found a place to shoot from (${a.status})`);
  assert.equal(a.throughWall, 0, 'it never attacks through the obstacle');
  assert.equal(a.walkedIntoWall, 0, 'and never walks into it');

  // --- a flyer hovering over solid ground (a tree, a rock) next to walkable ground ---
  let over: [number, number] | null = null;
  for (let ty = 6; ty < map.h - 6 && !over; ty++)
    for (let tx = 6; tx < w - 6 && !over; tx++) {
      const t = map.tiles[tx + ty * w];
      if (!SOLID_H[t] || t === 2) continue; // water never blocks sight; look for a tree or a rock
      if (nav.reach[tx + 1 + ty * w] && nav.reach[tx + 2 + ty * w] && roomAround(nav, tx + 2, ty, 2, 9) >= 9) over = [tx, ty];
    }
  assert.ok(over, 'the test map has an obstacle with open ground beside it');
  const fx = tileCenter(over![0]), fy = tileCenter(over![1]);
  assert.equal(lineOfSight(map, tileCenter(over![0] + 2), fy, fx, fy), false, 'as before, the solid tile under a flyer counts as cover...');
  assert.equal(lineOfSight(map, tileCenter(over![0] + 2), fy, fx, fy, true), true, '...unless the target is the flyer above it');
  // a melee fighter: it walks to the edge and swings, where before it never chose this monster at all
  const start = { x: tileCenter(over![0] + 6 < w - 2 && nav.reach[over![0] + 6 + over![1] * w] ? over![0] + 6 : over![0] + 2), y: fy };
  const b = huntSim(zone, start, { type: 'duskwing', x: fx, y: fy }, 40);
  assert.ok(MONSTERS.duskwing.flying);
  assert.equal(b.target, -1, 'the flyer over the obstacle is chosen');
  assert.ok(b.attacks > 0, `and attacked from the edge (${b.status})`);
  assert.equal(b.throughWall + b.walkedIntoWall, 0);
  assert.ok(Math.hypot(b.attackedFrom!.x - fx, b.attackedFrom!.y - fy) - MONSTERS.duskwing.radius <= 40, 'from within reach');

  // --- a flyer deep inside a large obstacle, beyond any reach from the ground: not chosen, no running in circles ---
  let deep: [number, number] | null = null;
  for (let ty = 6; ty < map.h - 6 && !deep; ty++)
    for (let tx = 6; tx < w - 6 && !deep; tx++) {
      let solid = true;
      for (let dy = -2; dy <= 2 && solid; dy++) for (let dx = -2; dx <= 2 && solid; dx++) if (nav.walk[tx + dx + (ty + dy) * w]) solid = false;
      if (solid) deep = [tx, ty];
    }
  if (deep) {
    const field = walkFieldH(nav, deep[0] + 6, deep[1], 40);
    assert.equal(attackSpotH(nav, field, tileCenter(deep[0]), tileCenter(deep[1]), 8, 38, true), null, 'no spot within sword reach');
    let st: [number, number] | null = null;
    for (let r = 3; r < 12 && !st; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!st && nav.reach[deep[0] + dx + (deep[1] + dy) * w]) st = [deep[0] + dx, deep[1] + dy];
    if (st) {
      const c = huntSim(zone, { x: tileCenter(st[0]), y: tileCenter(st[1]) }, { type: 'duskwing', x: tileCenter(deep[0]), y: tileCenter(deep[1]) }, 40, 120);
      assert.equal(c.attacks, 0);
      assert.equal(c.target, 0, `a melee hunter does not choose it (${c.status})`);
      assert.ok(Math.hypot(c.me.x - tileCenter(st[0]), c.me.y - tileCenter(st[1])) < 48, 'and does not run around trying');
    }
  }
  assert.ok(R > 0);
});

test('denser camps and faster respawns: counts, spacing and timers as configured', () => {
  assert.equal(MONSTERS.mossling.respawnMs, Math.round(12000 * 0.45));
  assert.equal(MONSTERS.old_tusk.respawnMs, Math.round(60000 * 0.6), 'elites refill faster too');
  assert.ok(WORLD_BOSSES.every((b) => MONSTERS[b.type].respawnMs === 15 * 60000), 'world bosses keep their timers');
  const eld = SPAWNS.eldoria;
  assert.deepEqual(eld.map((g) => g.count), [13, 13, 11, 8, 11, 8, 1], 'Eldoria camps: 1.3 times for the larger map, then 1.6 times; the elite alone');
  // real dice: the harness's fixed 0.5 would aim every placement attempt at the same spot
  const { join } = harness({ rng: Math.random, world: { monsters: true } });
  const p = join(0, 0, 'knight', 1).p, placed = [...p.room.monsters.values()].length;
  assert.equal(placed, eld.reduce((n, g) => n + g.count, 0), `every monster of every camp placed (${placed})`);
  assert.ok(p.room.spawnLog.every((l: any) => l.placed === l.wanted));
});

test('the Depths: behind the fourth region and every third after it, joined by portals, with a sanctuary and a boss as strong as a world boss', () => {
  assert.deepEqual(DEPTHS.map((d) => REGIONS.indexOf(d.host) + 1), [4, 7, 10, 13, 16]);
  for (const d of DEPTHS) {
    const z = ZONES[d.id], host = ZONES[d.host];
    assert.ok(!REGIONS.includes(d.id) && !z.kind && !z.town, `${d.id}: an open map of its own, not a region and not an instance`);
    const door = host.portals.find((p) => p.to === d.id)!, back = z.portals.find((p) => p.to === d.host)!;
    assert.ok(door && back, `${d.id}: a way in and a way out`);
    assert.equal(z.portals.length, 1, 'the only way out is the way in');
    for (const [tx, ty] of [[door.toTx, door.toTy], [z.spawn.tx, z.spawn.ty], [back.tx, back.ty]]) assert.ok(inSanctuary(d.id, tileCenter(tx), tileCenter(ty)), `${d.id}: arrival, respawn and the exit lie in the sanctuary`);
    const nav = navOf(d.id), b = DEPTH_BOSSES.find((x) => x.zone === d.id)!, bd = MONSTERS[b.type];
    assert.equal(spawnFault(nav, tileCenter(door.toTx), tileCenter(door.toTy)), '', `${d.id}: the arrival point is open ground`);
    assert.equal(spawnFault(nav, tileCenter(b.tx), tileCenter(b.ty)), '', `${d.id}: the boss can be reached`);
    assert.equal(spawnFault(navOf(d.host), tileCenter(back.toTx), tileCenter(back.toTy)), '', `${d.host}: the way back arrives on open ground`);
    assert.ok(Math.hypot(b.tx - z.spawn.tx, b.ty - z.spawn.ty) > z.w * 0.7, 'the boss waits at the far end');
    assert.ok(bd.boss?.world, 'rewarded and announced like a world boss');
    const peer = MONSTERS.shadow_knight;
    assert.ok(bd.hp / mobHp(bd.level) >= (peer.hp / mobHp(peer.level)) * 0.9, `${bd.name}: a world boss's health for its level`);
    assert.equal(bd.respawnMs, peer.respawnMs);
    assert.ok(MONSTER_LOOK[b.type], 'it has art');
    // its monsters are those of the region above
    const hostTypes = new Set(SPAWNS[d.host].map((g) => g.type));
    assert.ok(SPAWNS[d.id].length >= 8 && SPAWNS[d.id].every((g) => hostTypes.has(g.type)));
  }
});

test('the Depths: every monster but the boss is tougher and worth 10% more; none lives near the sanctuary', () => {
  const { join, world } = harness({ rng: Math.random, world: { monsters: true } });
  const p = join(0, 0, 'knight', 30, -1, DEEP).p, s = ZONES[DEEP].sanctuary!;
  const all = [...p.room.monsters.values()], boss = all.find((m) => m.def.boss)!, mobs = all.filter((m) => !m.def.boss);
  assert.ok(boss && mobs.length > 40, `a boss and its country (${mobs.length} monsters)`);
  assert.deepEqual([boss.def.id, boss.maxHp, boss.expScale, boss.fierce], [DEPTH_BOSSES.find((b) => b.zone === DEEP)!.type, boss.def.hp, 1, false], 'the boss is as designed');
  for (const m of mobs) {
    assert.equal(m.fierce, true);
    assert.equal(m.maxHp, Math.round(m.def.hp * DEPTH_MONSTER.hp), 'more health');
    assert.equal(m.level, m.def.level + DEPTH_MONSTER.level, 'a higher level');
    assert.deepEqual([m.atkScale, m.expScale, m.goldScale, m.dropScale], [DEPTH_MONSTER.atk, 1.1, 1.1, 1.1]);
    assert.ok(Math.hypot(m.spawnX / TILE - s.tx, m.spawnY / TILE - s.ty) > s.r + 6, 'well clear of the sanctuary');
  }
  assert.ok(p.room.spawnLog.every((l: any) => l.placed === l.wanted), 'every camp is full');
  // regions have no fierce monsters any more
  const q = join(0, 0, 'knight', 4).p;
  for (const m of q.room.monsters.values()) assert.deepEqual([m.fierce, m.expScale, m.goldScale, m.dropScale, m.meta().fz], [false, 1, 1, 1, undefined]);
  // the same kill above and below: a tenth more experience
  const twin = (deep: boolean) => world.spawn(q.room, 'boar', q.x + 40, q.y, deep ? { ...DEPTH_MONSTER, level: 0, fierce: true } : undefined);
  const e0 = q.exp; world.hurt(twin(false), 1e9, 0, q); const plain = q.exp - e0;
  const e1 = q.exp; world.hurt(twin(true), 1e9, 0, q); const bonus = q.exp - e1;
  assert.ok(Math.abs(bonus / plain - DEPTH_MONSTER.exp) < 0.05, `+10% experience (${plain} -> ${bonus})`);
});

test('the Depths: entry level and warning, the mark of a striker, protection on leaving the sanctuary, bounties and boss timers', () => {
  const h = harness({ capacity: 10 }), { world } = h;
  const out = wilds(), z = ZONES[DEEP], door = ZONES.frostveil.portals.find((p) => p.to === DEEP)!, exit = z.portals[0];
  const says = (x: { out: any[] }, re: RegExp) => x.out.some((m) => (m.t === 'sys' || m.t === 'ann') && re.test(m.text));
  // too low a level: the door stays shut
  const low = h.join(0, 0, 'knight', 5, -1, 'frostveil');
  world.relocate(low.p, low.p.room, tileCenter(door.tx), tileCenter(door.ty));
  (world as any).transfer(low.p);
  assert.equal(low.p.room.zoneId, 'frostveil');
  assert.ok(says(low, /The Depths open at level 18/));
  // the first time, a warning to agree to
  const A = h.join(0, 0, 'knight', 30, -1, 'frostveil'), a = A.p;
  world.relocate(a, a.room, tileCenter(door.tx), tileCenter(door.ty));
  (world as any).transfer(a);
  assert.equal(a.room.zoneId, 'frostveil', 'not before agreeing');
  assert.deepEqual(A.out.filter((m) => m.t === 'depthask').pop(), { t: 'depthask', zone: DEEP, level: 18 });
  world.depthEnter(a);
  assert.equal(a.room.zoneId, DEEP);
  assert.ok(inSanctuary(DEEP, a.x, a.y), 'arrives in the sanctuary');
  // stepping out of the sanctuary: a moment nobody can strike
  const B = h.join(0, 0, 'mage', 30, -1, DEEP), b = B.p;
  world.relocate(b, a.room, out.x + 48, out.y);
  h.step(2);
  world.relocate(a, a.room, out.x, out.y);
  h.step(1);
  assert.ok(a.pvpShieldUntil > Date.now() + 1500, 'protected on leaving');
  world.setTarget(b, a.id);
  assert.equal(b.pvpTarget, null);
  // striking gives the protection up, and marks the striker
  world.hurt(b, 1, 0, a);
  assert.equal(a.pvpShieldUntil, 0);
  assert.ok(a.pvpTagUntil > Date.now() + 8000);
  world.relocate(a, a.room, tileCenter(exit.tx), tileCenter(exit.ty));
  (world as any).transfer(a);
  assert.equal(a.room.zoneId, DEEP, 'no way out while marked');
  assert.ok(says(A, /cannot leave while you are fighting/));
  assert.equal(world.pvp.block(b, a), '', 'and no shelter in the sanctuary');
  a.pvpTagUntil = 0;
  assert.equal(world.pvp.block(b, a), 'That player is in the sanctuary');
  // a run of kills puts a bounty on the killer, shown to everyone there
  world.relocate(a, a.room, out.x, out.y);
  a.streak = BOUNTY_STREAK - 1;
  world.hurt(b, 1e9, 0, a);
  assert.ok(b.dead);
  assert.equal(a.streak, BOUNTY_STREAK);
  assert.ok(says(B, /There is a bounty on them/));
  h.step(40);
  assert.equal(B.out.filter((m) => m.t === 'bounty').pop().marks[0].id, a.id);
  // whoever ends it is paid in honour
  const C = h.join(0, 0, 'knight', 30, -1, DEEP);
  world.relocate(C.p, a.room, out.x + 48, out.y);
  a.pvpShieldUntil = 0;
  world.hurt(a, 1e9, 0, C.p);
  assert.ok(a.dead);
  assert.equal(a.streak, 0);
  assert.ok(says(C, new RegExp(`claims the bounty: \\+${BOUNTY_HONOR} honour`)));
  h.step(40);
  assert.deepEqual(C.out.filter((m) => m.t === 'bounty').pop().marks, []);
  // leaving unmarked
  world.relocate(C.p, C.p.room, tileCenter(exit.tx), tileCenter(exit.ty));
  C.p.pvpTagUntil = 0;
  (world as any).transfer(C.p);
  assert.equal(C.p.room.zoneId, 'frostveil');
  // boss timers for the map
  assert.deepEqual(world.depthBossState(), DEPTH_ZONES.map((zone) => ({ zone, at: 0 })));
});

test('class progression: every tier reached keeps a bonus suited to the class, and is announced', () => {
  for (const job of JOBS) {
    const d = JOB_DEFS[job];
    assert.equal(d.tiers.length, 3);
    for (let i = 0; i < 2; i++) {
      const lv = d.tiers[i + 1].level, b = TIER_BONUS[job][i], saved = { ...b };
      const withBonus = computeStats(job, lv, 0);
      // the same character without this tier's bonus
      delete b.mul;
      delete b.add;
      const without = computeStats(job, lv, 0);
      Object.assign(b, saved);
      for (const [k, v] of Object.entries(saved.mul ?? {})) {
        const got = (withBonus as any)[k] / (without as any)[k];
        assert.ok(Math.abs(got - v!) < 0.03, `${job} tier ${i + 2} ${k}: x${v} (got x${got.toFixed(3)})`);
      }
      for (const [k, v] of Object.entries(saved.add ?? {})) assert.ok(Math.abs((withBonus as any)[k] - (without as any)[k] - v!) < 0.06, `${job} tier ${i + 2} ${k}: +${v}`);
      assert.ok(Object.keys(saved.mul ?? {}).length + Object.keys(saved.add ?? {}).length >= 2, `${job} tier ${i + 2} gives at least two bonuses`);
    }
    // below the tier's level nothing of it applies
    const lv2 = d.tiers[1].level, b0 = TIER_BONUS[job][0], keep = { ...b0 };
    const before = computeStats(job, lv2 - 1, 0);
    delete b0.mul;
    delete b0.add;
    assert.deepEqual(computeStats(job, lv2 - 1, 0), before, `${job}: no bonus before level ${lv2}`);
    Object.assign(b0, keep);
  }
  // the server announces the new title to everyone nearby
  const h = harness();
  const a = h.join(0, 0, 'mage', 19), b = h.join(20, 0, 'knight', 5);
  h.world.grantExp(a.p, 1e6);
  assert.ok(b.out.some((m) => m.t === 'ann' && /has become a Runeweaver!/.test(m.text)), 'Runeweaver announced');
  assert.equal(a.p.stats.matk, computeStats('mage', a.p.level, a.p.ap.weapon, a.p.build.skills).matk);
});

// ---------------------------------------------------------------------------------------------
// Equipment sub-stats by tier, armament (level 30), Armageddon, sigils (level 50)
// ---------------------------------------------------------------------------------------------
import {
  ARM_MAX, ARMAMENT_LEVEL, armamentDrops, armBoost, armChance, armCost, armFallback, armMultipliers, cleanGear, emptyGear, rollSigil, SIGIL_LEVEL, SIGIL_SETS, SIGIL_SHAPES,
  sigilBase, sigilRanks, sigilSets, weaponAura,
} from '../shared/src/gear';
import { cleanItem as cleanItemG, itemMainStats, itemSubStats, rollItem as rollItemG, RARITY_MULT as RARITY_MULT_G, RARITY_SUB_RANGE, subRange, type Item as ItemG } from '../shared/src/items';
import { ARMAGEDDON_LEVEL } from '../shared/src/dungeons';

test('equipment tiers: each tier has stronger main stats, one more sub-stat slot and a higher random range for its sub-stats', () => {
  assert.deepEqual(RARITY_AFFIXES, [1, 2, 3, 4, 5, 6], 'one more sub-stat slot per tier');
  for (let r = 1; r < 6; r++) {
    assert.ok(RARITY_MULT_G[r] > RARITY_MULT_G[r - 1], 'better main stats');
    assert.ok(RARITY_SUB_RANGE[r][0] > RARITY_SUB_RANGE[r - 1][0] && RARITY_SUB_RANGE[r][1] > RARITY_SUB_RANGE[r - 1][1], 'a higher sub-stat range');
  }
  const rng = mulberryTest(7);
  for (let r = 0; r < 6; r++)
    for (let n = 0; n < 60; n++) {
      const it = rollItemG(rng, 'plate_cuirass', 30, r);
      assert.equal(it.aff.length, RARITY_AFFIXES[r]);
      assert.equal(new Set(it.aff.map((a) => a[0])).size, it.aff.length, 'distinct sub-stats');
      for (const [k, v] of it.aff) {
        const [lo, hi] = subRange(k, 30, r);
        assert.ok(v >= lo - 0.11 && v <= hi + 0.11, `${RARITIES[r]} ${k} ${v} in ${lo}..${hi}`);
      }
    }
  // the rolls really are random inside the range: they spread across it
  const rolls = Array.from({ length: 200 }, () => rollItemG(rng, 'plate_cuirass', 40, 5).aff.find((a) => a[0] === 'maxHp')?.[1]).filter((v): v is number => v !== undefined);
  const [lo, hi] = subRange('maxHp', 40, 5);
  assert.ok(Math.min(...rolls) < lo + (hi - lo) * 0.2 && Math.max(...rolls) > hi - (hi - lo) * 0.2, 'rolls cover the range');
  // stored data: a sub-stat above its tier's best roll is cut down to it; extra slots are dropped
  const raw = { uid: 'x1', base: 'plate_cuirass', rar: 1, ilvl: 30, up: 0, qty: 1, aff: [['maxHp', 99999], ['def', 5], ['atk', 3], ['crit', 1]] };
  const c = cleanItemG(raw, new Set())!;
  assert.equal(c.aff.length, 2);
  assert.equal(c.aff[0][1], subRange('maxHp', 30, 1)[1]);
  // main and sub-stats are kept apart: main from the base item, sub from the rolls
  const it = { ...rollItemG(rng, 'plate_cuirass', 30, 3), uid: 'm' } as ItemG;
  assert.deepEqual(Object.keys(itemSubStats(it)).sort(), it.aff.map((a) => a[0]).sort());
  assert.ok(itemMainStats(it).def! > 0);
});

test('armament: the enhancement table, the fall-back checkpoints, the boost per level and the cost', () => {
  for (let l = 0; l < 6; l++) assert.equal(armChance(l), 100, `+${l} to +${l + 1} is safe`);
  assert.deepEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(armChance), [90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5]);
  assert.deepEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(armFallback), [6, 6, 6, 9, 9, 9, 12, 12, 12, 15, 15, 15, 18, 18]);
  assert.deepEqual([1, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 20].map(armBoost), [1, 6, 7.5, 10.5, 12.5, 16.5, 19, 24, 27, 33, 38, 43], 'the boost table: +1% to +6, +1.5% to +9, +2% to +12, +2.5% to +15, +3% to +18, +5% to +20');
  assert.equal(armCost(0).mat, 'arm_shard');
  assert.equal(armCost(5).mat, 'arm_shard', 'Shards up to +6');
  assert.equal(armCost(6).mat, 'arm_core', 'Cores from +6 to +12');
  assert.equal(armCost(12).mat, 'arm_relic', 'Relics from +12');
  assert.ok(armCost(19).gold > armCost(0).gold * 50, 'gold grows with the level');
  assert.deepEqual([0, 5, 6, 11, 12, 17, 18].map(weaponAura), [0, 0, 1, 1, 2, 2, 3], 'white at +6, blue at +12, ember at +18');
  // materials: none below Nightmare; the rarer ones only from the harder dungeons
  const rng = mulberryTest(3), roll = (diff: string, lv: number) => Array.from({ length: 400 }, () => armamentDrops(rng, diff, lv)).flat();
  assert.equal(roll('hard', 32).length, 0, 'Hard bosses drop none');
  assert.ok(roll('nightmare', 8).every((i) => i.base === 'arm_shard'), 'an easy Nightmare dungeon: Shards only');
  assert.ok(roll('nightmare', 32).some((i) => i.base === 'arm_relic'), 'the hardest one: Relics too, rarely');
  const nm = roll('nightmare', 32), arma = roll('armageddon', 32);
  assert.ok(nm.filter((i) => i.base === 'arm_relic').length < nm.filter((i) => i.base === 'arm_core').length && nm.filter((i) => i.base === 'arm_core').length < nm.filter((i) => i.base === 'arm_shard').length, 'rarer at every stage');
  assert.ok(arma.length > nm.length, 'Armageddon drops more');
});

test('armament on the server: unlocks at level 30, pays gold and materials, falls back on failure, boosts only the main stats of its slot', () => {
  const { world, join, step } = harness();
  const a = join(0, 0, 'knight', 29), p = a.p;
  give(p, spec('plate_cuirass', { ilvl: 25, rar: 3 }));
  world.inventory(p, { op: 'equip', uid: p.inv.find((i) => i.base === 'plate_cuirass')!.uid });
  p.lastCombat = -1e6;
  assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), `Armament unlocks at level ${ARMAMENT_LEVEL}`);
  world.grantExp(p, 1e6);
  assert.ok(p.level >= 30);
  p.lastCombat = -1e6;
  p.gold = 0;
  assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), 'Not enough gold');
  p.gold = 1e7;
  assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), 'Requires 1 Armament Shard');
  assert.equal(world.inventory(p, { op: 'arm', slot: 'cape' }), 'Unknown armament');
  give(p, spec('arm_shard', { qty: 30 }));
  give(p, spec('arm_core', { qty: 30 }));
  const def0 = p.stats.def, main0 = itemMainStats(p.eq.armor!).def!, sub = itemSubStats(p.eq.armor!).def ?? 0;
  for (let i = 0; i < 6; i++) assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), '');
  assert.equal(p.gear.arm.armor, 6, 'six safe enhancements');
  assert.equal(p.gold, 1e7 - [0, 1, 2, 3, 4, 5].reduce((n, l) => n + armCost(l).gold, 0), 'gold paid');
  assert.equal(p.inv.find((i) => i.base === 'arm_shard')!.qty, 30 - [0, 1, 2, 3, 4, 5].reduce((n, l) => n + armCost(l).qty, 0), 'materials paid');
  // only the main stats of the armour are raised: +6%
  const boosted = itemMainStats(p.eq.armor!, 1.06).def!;
  assert.ok(boosted > main0);
  assert.ok(Math.abs(p.stats.def - def0 - (boosted - main0)) <= 1, `defence rose by the main-stat boost only (${def0} -> ${p.stats.def})`);
  assert.equal(itemSubStats(p.eq.armor!).def ?? 0, sub, 'sub-stats untouched');
  // past +6 attempts can fail; a failure falls back to the checkpoint
  p.gear.arm.armor = 8;
  const realRnd = (world as any).rnd;
  (world as any).rnd = () => 0.99; // every roll fails
  assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), '');
  assert.equal(p.gear.arm.armor, 6, '+8 to +9 failed: back to +6');
  (world as any).rnd = () => 0; // every roll succeeds
  world.inventory(p, { op: 'arm', slot: 'armor' });
  assert.equal(p.gear.arm.armor, 7);
  (world as any).rnd = realRnd;
  // the weapon armament makes the weapon glow (seen by others) once a weapon is equipped
  const other = join(30, 0, 'mage', 5);
  step(2);
  assert.ok(other.p.known.has(p.id));
  give(p, spec('longsword', { ilvl: 25 }));
  world.inventory(p, { op: 'equip', uid: p.inv.find((i) => i.base === 'longsword')!.uid });
  step(2);
  p.gear.arm.weapon = 5;
  (world as any).rnd = () => 0;
  give(p, spec('arm_shard', { qty: 10 }));
  assert.equal(world.inventory(p, { op: 'arm', slot: 'weapon' }), '');
  (world as any).rnd = realRnd;
  assert.equal(p.meta().wa, 1, 'white at +6');
  assert.equal(other.p.known.has(p.id), false, 'the others are sent the new look');
  // stored with gold and the bag in one snapshot
  assert.deepEqual((world.snapshot(p) as any).gear.arm.armor, 7);
  // not in combat
  p.lastCombat = world.tick;
  assert.equal(world.inventory(p, { op: 'arm', slot: 'armor' }), 'Cannot enhance in combat');
  step(1);
});

test('Armageddon: a difficulty for level 50 and above, harder than Nightmare', () => {
  assert.ok(DIFFICULTY.armageddon.hp > DIFFICULTY.nightmare.hp && DIFFICULTY.armageddon.atk > DIFFICULTY.nightmare.atk);
  const { world, join } = harness({ capacity: 10 });
  // offered only where the boss is level 50 or more: not in the Ancient Ruins, yes in the Molten Crucible
  assert.deepEqual([DUNGEONS.ruins.armageddon, DUNGEONS.crucible.armageddon], [false, true]);
  const g0 = ZONES.verdant.gates![0], s0 = ZONES.verdant.spawn;
  const low = join(tileCenter(g0.tx) - tileCenter(s0.tx), tileCenter(g0.ty) - tileCenter(s0.ty), 'knight', 60, -1, 'verdant');
  assert.match(world.dungeons.enter(low.p, 'ruins', 'armageddon'), /boss is level 50 or higher/);
  const gate = ZONES.emberwaste.gates![0], sp = ZONES.emberwaste.spawn;
  const a = join(tileCenter(gate.tx) - tileCenter(sp.tx), tileCenter(gate.ty) - tileCenter(sp.ty), 'knight', 49, -1, 'emberwaste');
  assert.equal(world.dungeons.enter(a.p, 'crucible', 'armageddon'), `Armageddon requires level ${ARMAGEDDON_LEVEL}`);
  world.grantExp(a.p, 1e8);
  assert.ok(a.p.level >= 50);
  assert.equal(world.dungeons.enter(a.p, 'crucible', 'armageddon'), '');
  assert.equal(world.dungeons.runs.get(a.p.room)!.diff, 'armageddon');
});

test('sigils: unlock at level 50, slot by shape, +1 to +3 to a class skill (own class, learned), symbol sets at 2, 4 and 6', () => {
  const rng = mulberryTest(11);
  for (let i = 0; i < 200; i++) {
    const s = rollSigil(rng), b = sigilBase(s.base)!;
    assert.ok(b && ITEMS[s.base].kind === 'sigil');
    assert.ok(s.st === 1 && s.sks!.length === 1 && s.sks![0][1] === 1, 'tier 1: one skill, +1');
  }
  const { world, join } = harness();
  const a = join(0, 0, 'mage', 49), p = a.p;
  grant(p, ['arcane_bolt']);
  const mk = (sym: number, shape: number, skill: string, plus: number) => give(p, { ...rollSigil(rng, 1, sym, shape), sks: undefined, st: undefined, sk: [skill, plus] });
  mk(1, 0, 'arcane_bolt', 3);
  const s0 = p.inv.find((i) => ITEMS[i.base].kind === 'sigil')!;
  assert.equal(world.inventory(p, { op: 'sigil', uid: s0.uid }), `Sigils unlock at level ${SIGIL_LEVEL}`);
  world.grantExp(p, 1e8);
  grant(p, ['arcane_bolt']);
  assert.equal(world.inventory(p, { op: 'sigil', uid: s0.uid }), '');
  assert.equal(p.gear.sig[0]?.uid, s0.uid, 'a circle sigil sits in the circle slot');
  assert.deepEqual(sigilRanks('mage', p.level, p.gear, p.build.skills), { arcane_bolt: 3 }, '+3 Arcane Bolt');
  // the skill really works at the higher rank: more damage than without the sigil
  const m = world.spawn(p.room, 'rootwarden', p.x + 80, p.y), h0 = m.hp;
  world.use(p, 'arcane_bolt', m.id);
  const withSigil = h0 - m.hp;
  // another class's skill, or a skill not learned: no effect
  mk(1, 1, 'shield_bash', 2);
  world.inventory(p, { op: 'sigil', uid: p.inv.find((i) => i.sk?.[0] === 'shield_bash')!.uid });
  assert.deepEqual(sigilRanks('mage', p.level, p.gear, p.build.skills), { arcane_bolt: 3 }, 'a knight skill does nothing for a mage');
  // two Bright Ember sigils: the first set bonus (damage +9%, critical damage +10%)
  assert.deepEqual(sigilSets(p.gear, p.level).map((x) => [x.sym, x.n, x.tier]), [['bright_ember', 2, 1]]);
  const plainAtk = computeStats('mage', p.level, p.ap.weapon, { ...p.build.skills, arcane_bolt: 4 }).matk;
  assert.ok(p.stats.matk > plainAtk, 'damage set bonus applied');
  // six of one symbol: the top tier
  for (let s = 2; s < 6; s++) {
    mk(1, s, 'meteor_strike', 1);
    world.inventory(p, { op: 'sigil', uid: p.inv.find((i) => ITEMS[i.base].kind === 'sigil' && sigilBase(i.base)!.shape === s)!.uid });
  }
  assert.deepEqual(sigilSets(p.gear, p.level).map((x) => x.tier), [3]);
  assert.deepEqual(SIGIL_SETS.bright_ember[2], { dmg: 15, critDmg: 20 });
  assert.deepEqual(SIGIL_SETS.fallen_angel.map((x) => [x.maxHp, x.mdef, x.def]), [[10, 5, 5], [15, 10, 10], [20, 15, 15]]);
  assert.deepEqual(SIGIL_SETS.dark_moon.map((x) => [x.atkTime, x.crit, x.lifesteal]), [[5, 5, 5], [7, 10, 10], [10, 15, 15]]);
  // unequipping removes the effect
  assert.equal(world.inventory(p, { op: 'unsigil', slot: 0 }), '');
  assert.deepEqual(sigilRanks('mage', p.level, p.gear, p.build.skills), {}, 'the +3 is gone with its sigil');
  assert.ok(p.inv.some((i) => i.uid === s0.uid), 'back in the bag');
  const m2 = world.spawn(p.room, 'rootwarden', p.x + 80, p.y), h2 = m2.hp;
  (p as any).cds.clear();
  p.gcd = 0;
  world.use(p, 'arcane_bolt', m2.id);
  assert.ok(h2 - m2.hp < withSigil, 'weaker without the sigil');
  // stored data: a sigil in the wrong slot or without a skill is dropped
  const g = cleanGear({ arm: { weapon: 25, ring: -1 }, sig: [{ uid: 's1', base: 'sigil_dark_moon_star', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1, sk: ['arcane_bolt', 9] }, { uid: 's2', base: 'sigil_dark_moon_triangle', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1, sk: ['arcane_bolt', 2] }] }, (r) => cleanItemG(r, new Set()));
  assert.deepEqual(g.arm, { weapon: ARM_MAX });
  assert.equal(g.sig[0], null, 'a star sigil is not a circle');
  assert.deepEqual(g.sig[1]?.sk, ['arcane_bolt', 2]);
  assert.equal(SIGIL_SHAPES.length, 6);
  assert.deepEqual(armMultipliers(emptyGear(), 60), {});
});

// ---------------------------------------------------------------------------------------------
// Levels to 200: EXP tiers, the expansion, sigil tiers, stats by source, villages kept clear
// ---------------------------------------------------------------------------------------------
import { rollSigil as rollSigil200, setEffects, SIGIL_TIERS, sigilRanks as sr, sigilSets as sigilSets200, sigilSkills, sigilTierForBoss, WORLD_BOSS_ARM_LEVEL, worldBossArmament } from '../shared/src/gear';
import { cleanItem as cleanItem200, SIGIL_SKILL_IDS } from '../shared/src/items';
import { statBreakdown } from '../shared/src/statsources';
import { MONSTER_TOWN_CLEAR } from '../shared/src/world';
import { bigAtkMul, bigHpMul, mobHp as mobHp200, WORLD_BOSS_AREA } from '../shared/src/monsters';
import { MAX_LEVEL } from '../shared/src/jobs';
import { SUBSKILLS as SUBS200 } from '../shared/src/subskills';

test('levels to 200: ten more regions with a village, a dungeon and monsters; world bosses; Armageddon only from boss level 50', () => {
  assert.equal(MAX_LEVEL, 200);
  for (const e of EXPANSION) {
    const z = ZONES[e.id], d = DUNGEONS[e.dungeon.id];
    assert.ok(z && z.town && z.gates?.[0].dungeon === d.id, `${e.id}: village and dungeon gate`);
    assert.ok(e.mobs.every((m) => MONSTERS[m.id] && MONSTERS[m.id].level >= e.level[0] && MONSTERS[m.id].level <= e.level[1]), `${e.id}: monster levels inside the region's range`);
    assert.ok(MONSTERS[e.mobs[4].id].elite, `${e.id}: an elite`);
    assert.equal(MONSTERS[d.boss].level, e.dungeon.bossLevel);
    assert.equal(d.armageddon, true, `${d.id} offers Armageddon`);
    assert.ok(SPAWNS[e.id].length >= 6);
    if (e.world) assert.ok(WORLD_BOSSES.some((b) => b.zone === e.id && b.type === e.world!.id));
  }
  for (const id of ['ruins', 'lair', 'citadel', 'temple']) assert.equal(DUNGEONS[id].armageddon, false, `${id}: its boss is below level 50`);
  // the later monsters keep fights about as long as at level 60
  assert.ok(mobHp200(200) < 40 + 24 * 200 && mobHp200(60) === 40 + 24 * 60);
  // every 20 levels elites and bosses are much harder; world bosses hit a wider area
  assert.deepEqual([bigHpMul(19), bigHpMul(40), bigHpMul(200), bigAtkMul(100)], [1, 1.4, 3, 1.5]);
  const arc = MONSTERS.shadow_knight.boss!.phases[0].pattern.find((a) => a.name === 'Reaping Arc')!;
  assert.equal(arc.aoe, Math.round(110 * WORLD_BOSS_AREA), 'Reaping Arc is half as wide again');
});

test('maps are 1.5 times larger; camps keep well away from villages', () => {
  assert.deepEqual([ZONES.eldoria.w, ZONES.verdant.w, ZONES.ashen.w, ZONES.ashen.h], [144, 144, 180, 120]);
  for (const z of REGIONS) {
    const t = ZONES[z].town!;
    for (const g of SPAWNS[z]) if (!MONSTERS[g.type].boss) assert.ok(Math.hypot(g.tx - t.tx, g.ty - t.ty) >= MONSTER_TOWN_CLEAR - 1, `${z}: ${g.type} camp clear of ${t.name}`);
  }
  const { join } = harness({ rng: Math.random, world: { monsters: true } });
  const p = join(0, 0, 'knight', 1, -1, 'verdant').p, t = ZONES.verdant.town!;
  for (const m of p.room.monsters.values()) if (!m.def.boss) assert.ok(Math.hypot(m.spawnX / TILE - t.tx, m.spawnY / TILE - t.ty) > MONSTER_TOWN_CLEAR, `${m.def.id} spawned clear of the village`);
});

test('sigil tiers: one every 30 levels from 50, more skills and higher ranks, sub-skills too, set bonus per tier; drops by boss level', () => {
  assert.deepEqual(SIGIL_TIERS.map((x) => [x.level, x.slots, x.max]), [[50, 1, 1], [80, 1, 2], [110, 2, 2], [140, 2, 3], [170, 3, 3], [200, 3, 4]]);
  assert.deepEqual([49, 50, 79, 110, 139, 200].map(sigilTierForBoss), [0, 1, 1, 3, 3, 6], 'tier 3 only from bosses of level 110 or more');
  const rng = mulberryTest(5);
  let sub = 0;
  for (let tier = 1; tier <= 6; tier++)
    for (let i = 0; i < 80; i++) {
      const s = rollSigil200(rng, tier), sk = sigilSkills(s as any);
      assert.equal(s.st, tier);
      assert.equal(sk.length, SIGIL_TIERS[tier - 1].slots);
      assert.equal(new Set(sk.map((x) => x[0])).size, sk.length, 'different skills');
      assert.ok(sk.every(([id, n]) => SIGIL_SKILL_IDS.has(id) && n >= 1 && n <= SIGIL_TIERS[tier - 1].max));
      sub += sk.filter(([id]) => SUBS200[id]).length;
    }
  assert.ok(sub > 0, 'sub-skills are in the pool');
  // stored sigils are clamped to their tier
  const bad = cleanItem200({ uid: 'z1', base: 'sigil_dark_moon_star', qty: 1, st: 2, sks: [['arcane_bolt', 9], ['arcane_bolt', 1], ['shield_bash', 2]] }, new Set());
  assert.deepEqual([bad!.st, bad!.sks], [2, [['arcane_bolt', 2]]]);
  // set effects grow by one point per tier above the first; the lowest tier in the set counts
  assert.deepEqual(setEffects('bright_ember', 1, 3), { dmg: 11, critDmg: 12 });
  assert.deepEqual(setEffects('dark_moon', 3, 6), { atkTime: 15, crit: 20, lifesteal: 20 });
  const { join } = harness();
  const p = join(0, 0, 'mage', 200).p;
  p.gear.sig[0] = { uid: 'a', ...rollSigil200(rng, 4, 1, 0) } as any;
  p.gear.sig[1] = { uid: 'b', ...rollSigil200(rng, 2, 1, 1) } as any;
  assert.deepEqual(sigilSets200(p.gear, p.level).map((x) => [x.sym, x.n, x.tier, x.st]), [['bright_ember', 2, 1, 2]], 'the lower tier sets the bonus');
  // a sigil raising a learned sub-skill makes the skill stronger, beyond the sub-skill's maximum
  grant(p, ['arcane_bolt']);
  p.build.skills['arcane_bolt.a'] = 3;
  p.gear.sig[2] = { uid: 'c', base: 'sigil_dark_moon_square', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1, st: 6, sks: [['arcane_bolt.a', 4]] } as any;
  assert.equal(sr('mage', 200, p.gear, p.build.skills)['arcane_bolt.a'], 4);
});

test('world bosses of level 30 or more drop armament material', () => {
  const rng = mulberryTest(9);
  assert.deepEqual(worldBossArmament(rng, WORLD_BOSS_ARM_LEVEL - 1), []);
  const roll = (lv: number) => Array.from({ length: 400 }, () => worldBossArmament(rng, lv)).flat();
  const at30 = roll(30), at150 = roll(150);
  assert.ok(at30.some((i) => i.base === 'arm_shard') && at30.every((i) => i.base === 'arm_shard'), 'level 30: shards only');
  assert.ok(['arm_shard', 'arm_core', 'arm_relic'].every((b) => at150.some((i) => i.base === b)), 'level 150: every material');
});

test('stats by source: the breakdown adds up to the server stats, item by item and source by source', () => {
  const { world, join } = harness();
  const p = join(0, 0, 'knight', 60).p;
  give(p, spec('longsword', { rar: 3, ilvl: 50 }));
  give(p, spec('plate_cuirass', { rar: 2, ilvl: 50 }));
  for (const it of [...p.inv]) if (ITEMS[it.base].kind === 'equip') world.inventory(p, { op: 'equip', uid: it.uid });
  p.gear.arm.weapon = 9;
  (p as any).recalc();
  const b = statBreakdown(p.job, p.level, p.ap.weapon, p.build, p.eq, p.gear, p.comp);
  for (const k of ['maxHp', 'atk', 'def', 'mdef', 'crit'] as const) assert.ok(Math.abs(b.total[k] - p.stats[k]) <= 1, `${k}: ${b.total[k]} = ${p.stats[k]}`);
  assert.ok((b.by.equip.atk ?? 0) > 0 && (b.slots.equip.weapon?.atk ?? 0) > 0, 'the weapon adds attack');
  assert.ok((b.by.arm.atk ?? 0) > 0 && (b.slots.arm.weapon?.atk ?? 0) > 0, 'its armament boosts it');
  assert.ok((b.by.class.maxHp ?? 0) > 0, 'class progression (tiers) adds health');
  assert.equal(Math.round(b.base.atk + Object.values(b.by).reduce((n, x) => n + (x.atk ?? 0), 0)), b.total.atk);
});

// ---------------------------------------------------------------------------------------------
// Journal: achievements and titles, codex, daily and weekly missions, login rewards
// ---------------------------------------------------------------------------------------------
import { ACHIEVEMENT_INDEX, CODEX_BONUS, CODEX_SETS, cleanJournal, codexNeed, dailyMissions, dayOf, emptyJournal, journalBonus, MISSIONS, rollJournal, weeklyMissions, type Journal as JournalT } from '../shared/src/journal';

test('journal: achievements from counted events, titles worn (bonus and shown to others), stored journals cleaned', () => {
  const { world, join } = harness();
  const a = join(0, 0, 'knight', 10), b = join(40, 0, 'mage', 10), p = a.p;
  const kill = (type = 'mossling') => world.hurt(world.spawn(p.room, type, p.x + 30, p.y), 1e9, 0, p);
  for (let i = 0; i < 100; i++) kill();
  assert.equal(p.journal.c.kill, 100);
  assert.ok(p.journal.a.includes('kill_100'), 'First Blood');
  assert.ok(a.out.some((m) => m.t === 'sys' && m.text === 'Achievement: First Blood.'));
  // a titled achievement, worn: the bonus applies and others see the title
  p.journal.c.kill = 999;
  kill();
  assert.ok(p.journal.a.includes('kill_1k'));
  const atk0 = p.stats.atk;
  assert.equal(world.journal(p, { op: 'title', id: 'kill_1k' }), '');
  assert.equal(p.journal.ti, 'kill_1k');
  assert.equal(p.stats.atk, Math.round(atk0 * 1.01), '+1% attack');
  assert.equal(p.meta().ti, 'kill_1k');
  assert.equal(world.journal(p, { op: 'title', id: 'pvp_500' }), 'You have not earned that title');
  assert.equal(world.journal(p, { op: 'title', id: '' }), '');
  assert.equal(p.stats.atk, atk0);
  void b;
  // levels reached before the journal are recognised
  const old = join(0, 80, 'cleric', 62).p;
  assert.ok(old.journal.a.includes('level_60') && old.journal.a.includes('level_30'));
  // stored journals: unknown things dropped, numbers bounded, a title not earned is not worn
  const c = cleanJournal({ c: { kill: 5, nope: 3, gold: -1 }, k: { mossling: 4, ghost: 9 }, a: ['kill_100', 'fake'], ti: 'kill_10k', d: { at: 3, m: [['d_kill', 999, false], ['zz', 1, true]] } });
  assert.deepEqual([c.c, c.k, c.a, c.ti, c.d.m], [{ kill: 5 }, { mossling: 4 }, ['kill_100'], '', [['d_kill', 150, false]]]);
});

test('codex: cards by kills (100 / 10 / 1), a complete region gives its lasting bonus', () => {
  assert.deepEqual([codexNeed('mossling'), codexNeed('old_tusk'), codexNeed('rune_guardian')], [100, 10, 1]);
  const set = CODEX_SETS.eldoria;
  assert.ok(set.length >= 4 && set.includes('mossling'));
  const { world, join } = harness();
  const p = join(0, 0, 'knight', 30).p;
  for (const id of set) p.journal.k[id] = codexNeed(id) - 1;
  const hp0 = p.stats.maxHp;
  for (const id of set) world.hurt(world.spawn(p.room, id, p.x + 30, p.y), 1e9, 0, p);
  assert.ok(set.every((id) => p.journal.k[id] >= codexNeed(id)));
  assert.equal(p.journal.c.codex, 1);
  assert.ok(p.journal.a.includes('codex_1'));
  assert.deepEqual(CODEX_BONUS.eldoria, { maxHp: 1 });
  assert.equal(p.stats.maxHp, Math.round(hp0 * 1.01), 'Eldoria complete: +1% health');
  assert.deepEqual(journalBonus(p.journal), { maxHp: 1 });
});

test('missions: the same three for everyone each day and week; progress from play; rewards once', () => {
  const day = 20500;
  assert.deepEqual(dailyMissions(day), dailyMissions(day), 'deterministic');
  assert.equal(new Set(dailyMissions(day)).size, 3);
  assert.equal(weeklyMissions(3000).length, 3);
  assert.ok([...Array(10).keys()].some((i) => dailyMissions(day + i).join() !== dailyMissions(day).join()), 'they change from day to day');
  const { world, join } = harness();
  const p = join(0, 0, 'knight', 40).p;
  const j: JournalT = p.journal;
  j.d = { at: dayOf(Date.now()), m: [['d_kill', 0, false], ['d_elite', 0, false], ['d_gather', 0, false]] };
  for (let i = 0; i < 150; i++) world.hurt(world.spawn(p.room, 'mossling', p.x + 30, p.y), 1e9, 0, p);
  assert.deepEqual(j.d.m[0], ['d_kill', 150, false]);
  assert.equal(world.journal(p, { op: 'claim', kind: 'daily', i: 1 }), 'That mission is not complete yet');
  const gold0 = p.gold, exp0 = p.exp + p.level * 1e9;
  assert.equal(world.journal(p, { op: 'claim', kind: 'daily', i: 0 }), '');
  assert.ok(p.gold > gold0 && p.exp + p.level * 1e9 > exp0 && p.inv.some((i) => i.base === 'upgrade_stone') && p.inv.some((i) => i.base === 'arm_shard'));
  assert.equal(world.journal(p, { op: 'claim', kind: 'daily', i: 0 }), 'Already claimed');
  assert.equal(p.journal.c.mission, 1);
  assert.ok(MISSIONS.d_kill && MISSIONS.w_wboss);
});

test('login rewards: a seven-day cycle, claimed once a day; missing a day starts again', () => {
  const j = emptyJournal(), d0 = 20000 * 86_400_000;
  rollJournal(j, d0);
  assert.deepEqual([j.l.streak, j.l.claimed, j.c.login], [1, false, 1]);
  j.l.claimed = true;
  rollJournal(j, d0 + 86_400_000);
  assert.deepEqual([j.l.streak, j.l.claimed], [2, false], 'the next day continues the cycle');
  for (let i = 2; i <= 7; i++) rollJournal(j, d0 + i * 86_400_000);
  assert.equal(j.l.streak, 1, 'after day 7 the cycle starts over');
  rollJournal(j, d0 + 10 * 86_400_000);
  assert.equal(j.l.streak, 1, 'a missed day starts again');
  const { world, join } = harness();
  const p = join(0, 0, 'knight', 20).p, g0 = p.gold;
  assert.equal(world.journal(p, { op: 'login' }), '');
  assert.ok(p.gold > g0 && p.inv.some((i) => i.base === 'hp_potion'));
  assert.equal(world.journal(p, { op: 'login' }), 'Already claimed today');
  assert.ok(ACHIEVEMENT_INDEX.login_7);
});

// ---------------------------------------------------------------------------------------------
// World events, night and weather
// ---------------------------------------------------------------------------------------------
import { darkness, DAY_CYCLE_MS, EVENTS, isNight, METEOR_COUNT, timeOfDay, weatherAt } from '../shared/src/events';

test('day and night follow the clock (an hour a day); every region has its own weather, the same for everyone', () => {
  const day0 = Math.floor(Date.now() / DAY_CYCLE_MS) * DAY_CYCLE_MS;
  assert.equal(timeOfDay(day0), 0);
  assert.deepEqual([isNight(day0), isNight(day0 + DAY_CYCLE_MS / 2), isNight(day0 + DAY_CYCLE_MS * 0.85)], [true, false, true]);
  assert.ok(darkness(day0) > 0.95 && darkness(day0 + DAY_CYCLE_MS / 2) === 0, 'midnight dark, noon bright');
  const at = day0 + 5 * DAY_CYCLE_MS;
  assert.equal(weatherAt('frostveil', 'frost', at), weatherAt('frostveil', 'frost', at), 'deterministic');
  const seen = new Set(Array.from({ length: 200 }, (_, i) => weatherAt('frostveil', 'frost', at + i * 12 * 60_000)));
  assert.ok(seen.has('snow') && !seen.has('ash') && !seen.has('rain'), `frost: snow, never ash (${[...seen]})`);
  const ash = new Set(Array.from({ length: 200 }, (_, i) => weatherAt('ashen', 'ashen', at + i * 12 * 60_000)));
  assert.ok(ash.has('ash') && !ash.has('snow'));
});

test('world events: an invasion marches on the village, is beaten back, and pays by contribution', () => {
  const { world, join } = harness({ rng: Math.random, capacity: 10 });
  const a = join(0, 0, 'knight', 12, -1, 'verdant'), b = join(30, 0, 'cleric', 12, -1, 'verdant');
  assert.equal(world.events.start(Date.now(), 'invasion', 'verdant'), true);
  const ev = world.events.cur!, t = ZONES.verdant.town!;
  assert.deepEqual([ev.st.kind, ev.st.zone, ev.st.state], ['invasion', 'verdant', 'active']);
  assert.ok(ev.st.goal >= 18);
  assert.ok(a.out.some((m) => m.t === 'ann' && /Invasion! Monsters march on Mosswatch/.test(m.text)));
  assert.ok(a.out.some((m) => m.t === 'wevent' && m.ev?.kind === 'invasion'), 'every client is told');
  const mobs = [...ev.mobs];
  assert.ok(mobs.length >= 1 && mobs.length <= 8, 'a first wave of at most eight');
  for (const m of mobs) {
    assert.ok(m.invader && m.event && m.noRespawn);
    assert.deepEqual([m.spawnX, m.spawnY], [tileCenter(t.tx), tileCenter(t.ty)], 'their home is the village: they march on it');
    assert.ok(Math.hypot(m.x / TILE - t.tx, m.y / TILE - t.ty) >= 29, 'they start outside it');
    assert.equal(m.meta().ev, 1);
  }
  // beaten back: a does most of the work, b a little
  const g0 = a.p.gold, gb = b.p.gold;
  for (let i = 0; i < ev.st.goal; i++) {
    const m = [...ev.mobs].find((x) => !x.dead)!;
    world.hurt(m, m.hp * 0.95, 0, a.p);
    world.hurt(m, 1e9, 0, i % 4 ? a.p : b.p);
    world.events.tick(Date.now());
  }
  assert.equal(ev.st.state, 'won');
  assert.ok(a.p.gold > g0 && b.p.gold > gb, 'both contributors are paid');
  assert.ok(a.p.gold - g0 > b.p.gold - gb, 'by their share');
  assert.ok(a.out.some((m) => m.t === 'ann' && m.text === 'Invasion in Verdant Reach: victory!'));
  world.events.tick(ev.st.endsAt + 1);
  assert.equal(world.events.cur, null, 'it ends, and the next one is scheduled');
  assert.ok(world.events.nextAt > Date.now());
});

test('world events: a meteor shower and a treasure goblin that flees; an event not finished in time is lost', () => {
  const { world, join, step } = harness({ rng: Math.random, capacity: 10 });
  const a = join(0, 0, 'ranger', 40, -1, 'ashen');
  world.events.start(Date.now(), 'meteor', 'ashen');
  const ev = world.events.cur!;
  assert.equal(ev.st.goal, METEOR_COUNT);
  assert.ok([...ev.mobs].every((m) => m.def.id === 'star_fragment' && m.def.still));
  for (const m of [...ev.mobs]) world.hurt(m, 1e9, 0, a.p);
  assert.equal(ev.st.state, 'won');
  assert.ok(a.p.inv.some((i) => i.base === 'star_shard'));
  world.events.tick(ev.st.endsAt + 1);
  // the goblin runs from its attacker
  world.events.start(Date.now(), 'goblin', 'ashen');
  const gob = [...world.events.cur!.mobs][0];
  assert.equal(gob.def.id, 'treasure_goblin');
  world.relocate(a.p, a.p.room, gob.x - 60, gob.y);
  const d0 = Math.hypot(gob.x - a.p.x, gob.y - a.p.y);
  world.hurt(gob, 1, 0, a.p);
  step(30);
  assert.ok(Math.hypot(gob.x - a.p.x, gob.y - a.p.y) > d0 + 40, 'it runs away');
  assert.ok(gob.hp > 0 && a.p.hp === a.p.maxHp, 'and never fights back');
  // time runs out: lost, and the goblin is gone
  world.events.tick(world.events.cur!.st.endsAt + 1);
  assert.equal(world.events.cur!.st.state, 'lost');
  assert.ok(!a.p.room.monsters.has(gob.id), 'the goblin escaped');
  assert.ok(EVENTS.goblin.ms < EVENTS.invasion.ms);
});

test('night: extra, stronger monsters of the night in every region, gone at dawn', () => {
  const { world, join } = harness({ rng: Math.random, capacity: 10, world: { monsters: true, events: true } });
  const a = join(0, 0, 'knight', 20, -1, 'frostveil');
  const day0 = Math.floor(Date.now() / DAY_CYCLE_MS) * DAY_CYCLE_MS, noon = day0 + DAY_CYCLE_MS / 2, midnight = day0 + DAY_CYCLE_MS;
  world.events.nextAt = Infinity; // no event in the way
  world.events.tick(noon);
  const before = a.p.room.monsters.size;
  world.events.tick(midnight);
  const night = [...a.p.room.monsters.values()].filter((m) => m.nightborn);
  assert.ok(night.length >= 4, `night camps (${night.length})`);
  assert.ok(night.every((m) => m.meta().nt === 1 && m.maxHp > m.def.hp * 1.5 && m.noRespawn), 'stronger, and they do not come back');
  assert.ok(a.out.some((m) => m.t === 'ann' && /Night falls/.test(m.text)));
  world.events.tick(midnight + DAY_CYCLE_MS / 2);
  assert.equal(a.p.room.monsters.size, before, 'gone at dawn');
  assert.ok(a.out.some((m) => m.t === 'ann' && /Dawn breaks/.test(m.text)));
});

// ---------------------------------------------------------------------------------------------
// The Endless Rift
// ---------------------------------------------------------------------------------------------
import { isBossFloor as riftBossFloor, RIFT_BREAK_MS, RIFT_FLOOR_MS, riftCount, riftFloorTypes, riftLevel, riftReward } from '../shared/src/rift';
import { objById as objById2 } from '../shared/src/places';

test('the Endless Rift: entered at the Rift Warden, floor after floor (a guardian every fifth), rewards per floor, ends when time runs out', async () => {
  assert.deepEqual([riftBossFloor(5), riftBossFloor(6), riftLevel(60, 1), riftLevel(60, 10)], [true, false, 57, 64]);
  assert.ok(riftCount(12, 3) > riftCount(1, 1));
  assert.ok(riftFloorTypes(5, 60).length === 1 && MONSTERS[riftFloorTypes(5, 60)[0]].boss, 'a guardian on floor 5');
  assert.ok(riftReward(5, 60).gold > riftReward(4, 60).gold * 3);
  const saved: any[] = [];
  const { world, join } = harness({ capacity: 10 });
  (world as any).rifts.repo = { saveRiftScore: async (...a: any[]) => void saved.push(a), riftTop: async () => [] };
  const w = objById2('riftwarden:eldoria')!, sp = ZONES.eldoria.spawn;
  const far = join(0, 0, 'knight', 30);
  assert.equal(await world.riftOp(far.p, { op: 'enter' }), 'Speak with the Rift Warden in Eldoria to enter the Rift');
  const low = join(w.x - tileCenter(sp.tx) + 20, w.y - tileCenter(sp.ty), 'knight', 10);
  assert.equal(await world.riftOp(low.p, { op: 'enter' }), 'Requires level 20');
  const a = join(w.x - tileCenter(sp.tx) + 20, w.y - tileCenter(sp.ty), 'knight', 40);
  assert.equal(await world.riftOp(a.p, { op: 'enter' }), '');
  assert.equal(a.p.room.zoneId, 'd_rift');
  const run = world.rifts.runs.get(a.p.room)!;
  const t0 = Date.now();
  world.rifts.tick(t0 + RIFT_BREAK_MS + 1);
  assert.equal(run.floor, 1);
  assert.ok(run.alive.size >= 4);
  const gold0 = a.p.gold;
  for (const m of [...run.alive]) world.hurt(m, 1e9, 0, a.p);
  assert.deepEqual([run.best, run.state], [1, 'break']);
  assert.ok(a.p.gold > gold0, 'a reward for the floor');
  world.rifts.tick(Date.now() + RIFT_BREAK_MS + 1);
  assert.equal(run.floor, 2);
  // floor 2 is not cleared in time: the climb ends, the score is stored
  world.rifts.tick(Date.now() + RIFT_BREAK_MS + RIFT_FLOOR_MS + 10);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(run.state, 'over');
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0][2], saved[0][4]], [a.p.name, 1], 'best floor 1 on the board');
  assert.equal(await world.riftOp(a.p, { op: 'leave' }), '');
  assert.equal(a.p.room.zoneId, 'eldoria');
});

// ---------------------------------------------------------------------------------------------
// Ascension (70+): paths, ultimates, combos, mastery, loadouts
// ---------------------------------------------------------------------------------------------
import { COMBOS, emptyAscension as emptyAsc, masteryCap as mCap, PATHS, ULT_MAX as ULTMAX, ULTIMATES } from '../shared/src/ascension';
import { ABILITIES as ABIL } from '../shared/src/abilities';

test('ascension: two paths per class at 70 with a bonus per milestone, an ultimate charged by fighting, resonance in a party', () => {
  assert.equal(PATHS.length, 12);
  for (const job of Object.keys(JOB_DEFS)) assert.equal(PATHS.filter((p) => p.job === job).length, 2, job);
  for (const p of PATHS) assert.ok(ABIL[p.ult] && ABIL[p.ult].kind === 'ult' && ABIL[p.ult].job === p.job, `${p.id} ultimate`);
  assert.equal(ULTIMATES.length, 12);
  for (const c of COMBOS) for (const s of c.steps) assert.ok(JOB_DEFS[c.job].skills.some((x) => x.id === s && x.type === 'active'), `${c.name}: ${s}`);
  const { world, join } = harness({ capacity: 10 });
  const low = join(0, 0, 'knight', 69).p;
  assert.equal(world.ascOp(low, { op: 'path', id: 'paladin' }), 'Paths open at level 70');
  const a = join(0, 0, 'knight', 70), p = a.p;
  assert.equal(world.ascOp(p, { op: 'path', id: 'archmage' }), 'Not a path of your class');
  const hp0 = p.stats.maxHp;
  assert.equal(world.ascOp(p, { op: 'path', id: 'paladin' }), '');
  assert.equal(p.stats.maxHp, Math.round(hp0 * 1.04), '+4% health at the first milestone');
  assert.ok(a.out.some((m) => m.t === 'ann' && /ascended as a Paladin/.test(m.text)));
  // a second path later costs gold, in a village
  p.gold = 0;
  assert.match(world.ascOp(p, { op: 'path', id: 'warlord' }), /costs \d+ gold/);
  // the ultimate: refused until charged; fighting charges it
  assert.equal(world.use(p, 'ult_divine_judgment', 0), 'The ultimate is not charged');
  assert.equal(world.use(p, 'ult_war_banner', 0), 'Not your ultimate');
  const m = world.spawn(p.room, 'rootwarden', p.x + 40, p.y);
  (m as any).def = { ...m.def, aggro: 0 };
  for (let i = 0; i < 80 && p.ult < ULTMAX; i++) world.hurt(m, 1, 0, p);
  assert.equal(p.ult, ULTMAX);
  const hpM = m.hp;
  assert.equal(world.use(p, 'ult_divine_judgment', 0), '');
  assert.ok(p.ult < 20, 'spent (its own hits start the next charge)');
  assert.ok(m.hp < hpM, 'it hits');
  assert.ok(a.out.some((x) => x.t === 'ult' && x.v === 100));
  // resonance: a party member's ultimate within four seconds
  const b = join(30, 0, 'cleric', 70).p;
  world.ascOp(b, { op: 'path', id: 'oracle' });
  group(world, p, b);
  p.ult = ULTMAX;
  b.ult = ULTMAX;
  world.use(p, 'ult_divine_judgment', 0);
  world.use(b, 'ult_prophecy', 0);
  assert.ok(a.out.some((x) => x.t === 'ann' && /Resonance!/.test(x.text)));
});

test('combos, mastery and loadouts', () => {
  const { world, join, step } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 70), p = a.p;
  grant(p, ['shield_bash', 'cleave', 'rallying_cry']);
  p.res = p.stats.maxRes;
  const m = world.spawn(p.room, 'rootwarden', p.x + 30, p.y);
  (m as any).def = { ...m.def, aggro: 0 };
  world.setTarget(p, m.id);
  assert.equal(world.use(p, 'shield_bash', m.id), '');
  step(12);
  assert.equal(world.use(p, 'cleave', m.id), '');
  step(12);
  const hp = m.hp;
  assert.equal(world.use(p, 'rallying_cry', 0), '');
  assert.ok(a.out.some((x) => x.t === 'combo' && x.i === 3 && x.name === 'Shockwave Rally'), 'the finisher fires');
  assert.ok(m.hp < hp, 'and hits');
  // mastery: a point per level past 70, capped per stat
  const q = join(0, 40, 'mage', 75).p;
  const matk = q.stats.matk;
  for (let i = 0; i < 5; i++) assert.equal(world.ascOp(q, { op: 'mastery', stat: 'matk' }), '');
  assert.equal(world.ascOp(q, { op: 'mastery', stat: 'matk' }), 'No mastery points left');
  assert.equal(q.stats.matk, Math.round(matk * 1.025));
  assert.equal(mCap(75), 10);
  // loadouts: saved and loaded in a village
  grant(q, ['arcane_bolt']);
  assert.equal(world.ascOp(q, { op: 'save', slot: 0, name: 'Solo' }), '');
  q.build.skills = {};
  assert.equal(world.ascOp(q, { op: 'load', slot: 0 }), '');
  assert.equal(q.build.skills.arcane_bolt, 1);
  assert.equal(world.ascOp(q, { op: 'load', slot: 2 }), 'That loadout is empty');
  assert.deepEqual(emptyAsc().loadouts, [null, null, null]);
});

// ---------------------------------------------------------------------------------------------
// Awakening (80) and rune fusion (90)
// ---------------------------------------------------------------------------------------------
import { awaken as awakenDef, awakenKind, FUSIONS, fusionsFor } from '../shared/src/awakening';

test('awakening: a full-rank skill changes how it works, once, for 10 skill points, in a village', () => {
  assert.equal(awakenKind(ABIL.shield_bash), 'ripple');
  const w = awakenDef(ABIL.shield_bash);
  assert.ok(w.hit!.splash! >= 60 && w.hit!.mul > ABIL.shield_bash.hit!.mul, 'ripples to enemies nearby');
  assert.equal(awakenKind(ABIL.blink), 'afterimage');
  assert.ok(awakenDef(ABIL.blink).field, 'an exploding afterimage');
  assert.equal(awakenKind(ABIL.cleave), 'cone');
  const { world, join } = harness({ capacity: 10 });
  const p = join(0, 0, 'knight', 80).p;
  p.build.skills.shield_bash = 1;
  assert.equal(world.ascOp(p, { op: 'awaken', id: 'shield_bash' }), 'Train the skill to its full rank first');
  p.build.skills.shield_bash = JOB_DEFS.knight.skills.find((s) => s.id === 'shield_bash')!.maxRank;
  // it costs 10 skill points: not enough free points, no awakening
  const filler = JOB_DEFS.knight.skills.filter((s) => s.id !== 'shield_bash');
  for (const n of filler) if (freePoints(p.level, p.build) > 5) p.build.skills[n.id] = Math.min(n.maxRank, freePoints(p.level, p.build) - 5);
  while (freePoints(p.level, p.build) > 5) p.build.skills.taunt = (p.build.skills.taunt ?? 0) + 1;
  assert.equal(world.ascOp(p, { op: 'awaken', id: 'shield_bash' }), 'Awakening costs 10 skill points');
  for (const n of filler) delete p.build.skills[n.id];
  delete p.build.skills.taunt;
  assert.equal(world.ascOp(p, { op: 'awaken', id: 'shield_bash' }), '');
  assert.deepEqual(p.asc.awake, ['shield_bash']);
  assert.equal(world.ascOp(p, { op: 'awaken', id: 'shield_bash' }), 'That skill is already awakened');
  assert.equal(p.build.skills['awake.shield_bash'], 10, 'the points are spent in the build');
  // the server casts the awakened form: a neighbour of the target is struck too
  p.res = p.stats.maxRes;
  const t = world.spawn(p.room, 'rootwarden', p.x + 30, p.y), n = world.spawn(p.room, 'rootwarden', p.x + 60, p.y);
  for (const m of [t, n]) (m as any).def = { ...m.def, aggro: 0 };
  assert.equal(world.use(p, 'shield_bash', t.id), '');
  assert.ok(n.hp < n.maxHp, 'the ripple reached the second monster');
});

test('rune fusion: two attuned runes at level 5 make a spell of their own, from level 90', () => {
  assert.equal(FUSIONS.length, 10);
  assert.deepEqual(fusionsFor(['fire', 'water', 'lightning']).map((f) => f.id).sort(), ['fu_plasma', 'fu_steam', 'fu_storm_surge']);
  const { world, join } = harness({ capacity: 10 });
  const p = join(0, 0, 'mage', 89).p;
  grant(p, [], ['fire', 'lightning'], 5);
  p.res = p.stats.maxRes;
  const m = world.spawn(p.room, 'rootwarden', p.x + 60, p.y);
  (m as any).def = { ...m.def, aggro: 0 };
  assert.equal(world.use(p, 'fu_plasma', m.id), 'Rune fusion opens at level 90');
  const q = join(0, 40, 'mage', 90).p;
  grant(q, [], ['fire', 'lightning'], 4);
  q.res = q.stats.maxRes;
  assert.equal(world.use(q, 'fu_plasma', m.id), 'Both runes must be level 5');
  q.build.runes.lv.fire = 5;
  q.build.runes.lv.lightning = 5;
  assert.equal(world.use(q, 'fu_steam', m.id), 'Both runes must be attuned');
  const hp = m.hp;
  assert.equal(world.use(q, 'fu_plasma', m.id), '');
  assert.ok(m.hp < hp, 'Plasma Lance strikes');
});

// ---------------------------------------------------------------------------------------------
// Raids, guild territory war, faction conquest
// ---------------------------------------------------------------------------------------------
import { bannerOf, followed, nextSiegeOf, RAIDS, raidOfWeek, SIEGE_EVERY_MS, siegeAt, TERRITORIES } from '../shared/src/conquest';
import { LADDERS, seasonBefore, seasonEndsAt, seasonOf, ladderReward } from '../shared/src/seasons';

test('G7 raids: four raid bosses in weekly turn, each built from a late boss with its own drops', () => {
  const W = 7 * 86_400_000, t0 = Date.UTC(2026, 10, 19);
  assert.deepEqual(new Set(RAIDS.map((_, i) => raidOfWeek(t0 + i * W).boss)).size, RAIDS.length, 'every raid comes round');
  for (const r of RAIDS) {
    const m = MONSTERS[r.boss];
    assert.ok(m?.boss && !m.boss.world, r.boss);
    if (r.boss === 'raid_shadow') continue; // the Shadow keeps its own raid pool
    assert.ok(BOSS_UNIQUES[r.boss]?.length, `${r.boss} drops`);
    for (const id of BOSS_UNIQUES[r.boss]) assert.ok(ITEMS[id], `${r.boss}: ${id}`);
  }
});

test('G7 seasons: monthly, the season before, rewards for the top ten, and payout once by mail', async () => {
  assert.equal(seasonOf(Date.UTC(2026, 10, 19)), '2026-11');
  assert.equal(seasonBefore('2026-01'), '2025-12');
  assert.equal(seasonBefore('2026-11'), '2026-10');
  assert.equal(seasonEndsAt(Date.UTC(2026, 11, 31, 23)), Date.UTC(2027, 0, 1));
  assert.ok(ladderReward(1)!.gold > ladderReward(2)!.gold && ladderReward(3)!.items.length === 1 && !ladderReward(4)!.items.length && ladderReward(11) === null);
  const { world, join } = harness({ capacity: 20 });
  const scores: any[] = [], mails: any[] = [], paid = new Set<string>();
  (world.seasons as any).repo = {
    seasonScore: async (...a: any[]) => void scores.push(a),
    seasonTop: async (season: string, ladder: string) => (ladder === 'raid' ? [{ id: 7, name: 'Top', job: 'knight', score: 5 }, { id: 8, name: 'Next', job: 'mage', score: 2 }] : []),
    seasonMine: async () => ({ score: 5, rank: 1 }),
    seasonClaim: async (s: string, l: string) => (paid.has(s + l) ? false : (paid.add(s + l), true)),
    systemMail: async (...a: any[]) => void mails.push(a),
  };
  const a = join(0, 0, 'knight', 30);
  world.seasons.add(a.p, 'rift', 12);
  world.seasons.add(a.p, 'honor', 0);
  assert.deepEqual(scores.map((s) => [s[1], s[3], s[4]]), [['rift', 12, 'max']], 'nothing is written for nothing');
  assert.equal(world.seasonOp(a.p, { op: 'view', ladder: 'raid' }), '');
  await new Promise((r) => setTimeout(r, 10));
  const v = a.out.find((m) => m.t === 'season');
  assert.ok(v && v.ladder === 'raid' && v.rows.length === 2 && v.me.rank === 1);
  const now = Date.UTC(2026, 11, 2);
  await world.seasons.tick(now);
  assert.equal(mails.length, 2, 'the top of last season is paid');
  assert.match(mails[0][1], /Season 2026-11: Raids, rank 1/);
  assert.ok(mails[0][4] > mails[1][4] && mails[0][3].some((i: any) => i.base === 'scroll_rare'));
  (world.seasons as any).lastCheck = 0;
  await world.seasons.tick(now + 1);
  assert.equal(mails.length, 2, 'and only once');
  assert.equal(LADDERS.length, 4);
});

test('raids: a group at the Raid Herald, two waves of elites, Aetherion\'s Shadow scaled to the raiders, rewards for everyone inside', () => {
  const { world, join } = harness({ capacity: 30, world: { raidMin: 3 } });
  const h = objById2('raidherald:eldoria')!, sp = ZONES.eldoria.spawn;
  const at = (i: number) => [h.x - tileCenter(sp.tx) + 20 + i * 8, h.y - tileCenter(sp.ty) + 20] as const;
  const far = join(0, 0, 'knight', 70).p;
  assert.equal(world.raidOp(far, { op: 'open' }), 'Speak with the Raid Herald in Eldoria');
  const low = join(...at(0), 'knight', 50).p;
  assert.equal(world.raidOp(low, { op: 'open' }), 'Raids open at level 60');
  const raiders = [0, 1, 2].map((i) => join(...at(i), (['knight', 'cleric', 'mage'] as const)[i], 80).p);
  assert.equal(world.raidOp(raiders[0], { op: 'open' }), '');
  const id = world.raids.lobbyList()[0].id;
  assert.equal(world.raidOp(raiders[1], { op: 'start' }), 'Only the raid leader can start');
  assert.equal(world.raidOp(raiders[1], { op: 'join', id }), '');
  assert.equal(world.raidOp(raiders[0], { op: 'start' }), 'A raid needs at least 3 raiders at the Raid Herald (2 here)');
  assert.equal(world.raidOp(raiders[2], { op: 'join', id }), '');
  assert.equal(world.raidOp(raiders[0], { op: 'start' }), '');
  const room = raiders[0].room, run = world.raids.runs.get(room)!;
  assert.ok(raiders.every((p) => p.room === room) && room.zoneId === 'd_raid');
  for (let stage = 1; stage <= 3; stage++) {
    world.raids.tick(Date.now() + 10_000 * stage);
    assert.equal(run.stage, stage);
    if (stage === 3) {
      const boss = [...run.alive][0];
      assert.equal(boss.def.id, raidOfWeek(Date.now()).boss, "this week's raid boss");
      assert.ok(boss.maxHp > MONSTERS[boss.def.id].hp * 0.5, 'scaled to the raid');
    } else assert.ok([...run.alive].every((m) => m.def.elite));
    for (const m of [...run.alive]) world.hurt(m, 1e9, 0, raiders[0]);
  }
  assert.equal(run.state, 'won');
  for (const p of raiders) assert.ok(p.inv.filter((i) => i.rar >= 3).length >= 2 && p.inv.some((i) => i.base === 'awakening_essence'), `${p.name}: two raid items and an essence`);
  assert.equal(world.raidOp(raiders[1], { op: 'leave' }), '');
  assert.equal(raiders[1].room.zoneId, 'eldoria');
});

test('guild territory war: sieges on the clock, guild members at the banner score, the winner holds the village and its members gain experience there', async () => {
  assert.equal(TERRITORIES.length, REGIONS.length - 1);
  const s = siegeAt(5 * SIEGE_EVERY_MS + 1000);
  assert.ok(s.open && s.zone === TERRITORIES[5 % TERRITORIES.length]);
  assert.ok(!siegeAt(5 * SIEGE_EVERY_MS + 20 * 60_000).open, 'a siege lasts fifteen minutes');
  assert.ok(nextSiegeOf('verdant', 0) >= 0);
  const { world, join } = harness({ capacity: 30 });
  const saved: any[] = [];
  (world.conquest as any).repo = { saveTerritory: async (...a: any[]) => void saved.push(a), saveFactionPoints: async () => {} };
  const b = bannerOf('verdant')!, sp = ZONES.verdant.spawn;
  const off = [tileCenter(b.tx) - tileCenter(sp.tx), tileCenter(b.ty) - tileCenter(sp.ty)] as const;
  const a1 = join(off[0], off[1], 'knight', 40, -1, 'verdant').p, a2 = join(off[0] + 20, off[1], 'mage', 40, -1, 'verdant').p, c1 = join(off[0], off[1] + 20, 'ranger', 40, -1, 'verdant').p;
  world.guilds.byId.set(901, { id: 901, name: 'Iron Wolves', tag: 'IW', members: new Map(), bank: 0 } as any);
  world.guilds.byId.set(902, { id: 902, name: 'Ash Crows', tag: 'AC', members: new Map(), bank: 0 } as any);
  world.guilds.of.set(a1.id, 901); world.guilds.of.set(a2.id, 901); world.guilds.of.set(c1.id, 902);
  world.conquest.siege = { zone: 'verdant', end: Date.now() + 60_000, points: new Map() };
  for (let i = 0; i < 10; i++) (world.conquest as any).score();
  assert.deepEqual([world.conquest.siege!.points.get(901), world.conquest.siege!.points.get(902)], [20, 10], 'two members score twice as fast as one');
  world.conquest.endSiege();
  assert.equal(world.conquest.holderOf('verdant'), 901);
  assert.deepEqual(saved[0], ['verdant', 901]);
  assert.equal(world.conquest.expBonus(a1), 1.05, 'the holder\'s members gain 5% more experience');
  assert.equal(world.conquest.expBonus(c1), 1);
  assert.deepEqual(world.conquest.territories().held.map((x) => [x.zone, x.tag]), [['verdant', 'IW']]);
});

test('faction conquest: kills score for the faction a player follows; the leader this week controls the region', () => {
  assert.equal(followed({ crown: 400 }), '', 'not yet Friendly with anyone');
  assert.equal(followed({ crown: 600, wardens: 900 }), 'wardens');
  const { world, join } = harness({ capacity: 10 });
  const p = join(0, 0, 'knight', 20, -1, 'verdant').p, q = join(30, 0, 'mage', 20, -1, 'verdant').p;
  p.rep = { wardens: 800 };
  q.rep = { forge: 800 };
  for (let i = 0; i < 3; i++) world.hurt(world.spawn(p.room, 'mossling', p.x + 30, p.y), 1e9, 0, p);
  world.hurt(world.spawn(q.room, 'mossling', q.x + 30, q.y), 1e9, 0, q);
  assert.equal(world.conquest.controllerOf('verdant'), 'wardens');
  assert.equal(world.conquest.expBonus(p), 1.05, 'its followers gain 5% more experience');
  assert.equal(world.conquest.expBonus(q), 1);
});

// ---------------------------------------------------------------------------------------------
// Pet evolution, flying mounts, professions, home, season pass, wardrobe
// ---------------------------------------------------------------------------------------------
import { petStage, PET_MAX_LEVEL as PETMAX } from '../shared/src/companions';
import { FURNITURE, GROW_MS, profExpToNext, SEASON_XP, seasonReward } from '../shared/src/life';

test('pets evolve at 20, 40 and 60 with a stronger bonus; flying mounts pass over water and trees, never walls or the map edge', () => {
  assert.equal(PETMAX, 60);
  assert.deepEqual([petStage(1), petStage(20), petStage(45), petStage(60)], [0, 1, 2, 3]);
  const d = PETS.ember_kit;
  assert.ok(petBonus(d, 60) > petBonus(d, 40) && petBonus(d, 40) > petBonus(d, 20) && petBonus(d, 20) === Math.round((d.top + d.top * 0.25) * 10) / 10);
  assert.ok(MOUNTS.sky_griffin.fly && MOUNTS.sky_griffin.level === 120 && MOUNTS.star_drake.speed > MOUNTS.void_skiff.speed);
  const map = getZoneMap('dreadmoor');
  let water: [number, number] | null = null;
  for (let y = 5; y < map.h - 5 && !water; y++) for (let x = 5; x < map.w - 5; x++) if (tileAt(map, x, y) === T.Water) { water = [x, y]; break; }
  assert.ok(water, 'dreadmoor has water');
  const [wx, wy] = water!;
  assert.equal(blocked(map, tileCenter(wx), tileCenter(wy)), true, 'water stops a walker');
  assert.equal(blocked(map, tileCenter(wx), tileCenter(wy), true), false, 'a flyer passes over it');
  assert.equal(blocked(map, tileCenter(0), tileCenter(10), true), true, 'never off the map');
});

test('professions: gathering trains and pays more as it grows; fishing at the water; forging gear with chosen sub-stats', () => {
  const { world, join } = harness({ capacity: 10 });
  const p = join(0, 0, 'knight', 40, -1, 'verdant').p;
  p.life.prof.mining.lv = 30;
  const extra = world.life.onGather(p, 'iron_ore');
  assert.ok(extra.some((s) => s.base === 'iron_ore' && s.qty === 2), 'two more ore at level 30');
  assert.ok(p.life.prof.mining.xp > 0);
  // fishing needs water
  assert.equal(world.lifeOp(p, { op: 'fish' }), 'Stand at the water to fish');
  const map = getZoneMap('verdant');
  let spot: [number, number] | null = null;
  for (let y = 5; y < map.h - 5 && !spot; y++) for (let x = 5; x < map.w - 5; x++) if (tileAt(map, x, y) === T.Water && !blocked(map, tileCenter(x - 2), tileCenter(y))) { spot = [x - 2, y]; break; }
  world.relocate(p, p.room, tileCenter(spot![0]), tileCenter(spot![1]));
  assert.equal(world.lifeOp(p, { op: 'fish' }), '');
  assert.ok(p.inv.some((i) => ['river_fish', 'moon_carp', 'star_koi'].includes(i.base)));
  assert.equal(world.lifeOp(p, { op: 'fish' }), 'The fish are not biting yet');
  // forging at a merchant: the chosen sub-stats, nothing else
  const mer = objById2('merchant:verdant')!;
  world.relocate(p, p.room, mer.x + 30, mer.y);
  p.life.prof.smithing.lv = 20;
  p.gold = 1e6;
  give(p, { base: 'iron_ore', rar: 0, ilvl: 1, aff: [], up: 0, qty: 30 });
  give(p, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 10 });
  give(p, { base: 'mithril_ore', rar: 0, ilvl: 1, aff: [], up: 0, qty: 5 });
  assert.equal(world.lifeOp(p, { op: 'forge', base: 'plate_cuirass', stats: [] }), 'Choose the sub-stats to forge');
  assert.equal(world.lifeOp(p, { op: 'forge', base: 'plate_cuirass', stats: ['crit', 'maxHp', 'def', 'atk'] }), '');
  const it = p.inv.find((i) => i.base === 'plate_cuirass')!;
  assert.equal(it.rar, 3, 'Epic at smithing 20');
  assert.deepEqual(it.aff.map((a) => a[0]), ['crit', 'maxHp', 'def'], 'the first three chosen (Epic has three)');
  assert.ok(profExpToNext(1) > 0);
});

test('home: furniture placed and picked up, a garden that grows, a bed to rest in; visits by name', () => {
  const { world, join } = harness({ capacity: 10 });
  const st = objById2('steward:eldoria')!, sp = ZONES.eldoria.spawn;
  const a = join(st.x - tileCenter(sp.tx) + 20, st.y - tileCenter(sp.ty), 'knight', 30), p = a.p;
  p.gold = 1e6;
  assert.equal(world.lifeOp(p, { op: 'buy', base: 'furn_bed' }), '');
  assert.equal(world.lifeOp(p, { op: 'buy', base: 'moonleaf_seed' }), '');
  assert.equal(world.lifeOp(p, { op: 'home' }), '');
  assert.equal(p.room.zoneId, 'h_home');
  const bed = p.inv.find((i) => i.base === 'furn_bed')!;
  assert.equal(world.lifeOp(p, { op: 'place', uid: bed.uid, tx: 6, ty: 6 }), '');
  assert.deepEqual(p.life.home.furn, [{ base: 'furn_bed', tx: 6, ty: 6 }]);
  assert.ok(FURNITURE.furn_bed.bed);
  world.relocate(p, p.room, tileCenter(6) + 20, tileCenter(6));
  assert.equal(world.lifeOp(p, { op: 'rest' }), '');
  assert.ok(p.st.some((s) => s.i === STATUS_INDEX.rested), 'rested');
  assert.equal(world.lifeOp(p, { op: 'rest' }), 'You are not tired yet');
  const seed = p.inv.find((i) => i.base === 'moonleaf_seed')!;
  assert.equal(world.lifeOp(p, { op: 'plant', plot: 0, uid: seed.uid }), '');
  assert.equal(world.lifeOp(p, { op: 'harvest', plot: 0 }), 'It is not ripe yet');
  p.life.home.garden[0]!.at -= GROW_MS;
  assert.equal(world.lifeOp(p, { op: 'harvest', plot: 0 }), '');
  assert.ok(p.inv.some((i) => i.base === 'moonleaf' && i.qty >= 6));
  // a friend visits, but cannot move the furniture
  const b = join(st.x - tileCenter(sp.tx) + 30, st.y - tileCenter(sp.ty), 'mage', 30).p;
  assert.equal(world.lifeOp(b, { op: 'home', name: p.name }), '');
  assert.equal(b.room, p.room);
  assert.equal(world.lifeOp(b, { op: 'pickup', tx: 6, ty: 6 }), 'Furniture is moved in your own home');
  assert.equal(world.lifeOp(p, { op: 'leave' }), '');
  assert.equal(p.room.zoneId, 'eldoria');
});

test('season pass and wardrobe: season experience from play, levels claimed once; looks collected and worn, glow colours', () => {
  const { world, join } = harness({ capacity: 10 });
  const a = join(0, 0, 'knight', 30), p = a.p;
  for (let i = 0; i < 4; i++) world.journals.add(p, 'mission');
  assert.equal(p.life.season.xp, 1000, 'four missions: one season level');
  assert.equal(world.lifeOp(p, { op: 'claim', level: 2 }), 'You have not reached that season level');
  const g0 = p.gold;
  assert.equal(world.lifeOp(p, { op: 'claim', level: 1 }), '');
  assert.ok(p.gold > g0);
  assert.equal(world.lifeOp(p, { op: 'claim', level: 1 }), 'Already claimed');
  assert.deepEqual(seasonReward(10), { aura: 'violet' });
  p.life.season.xp = 10 * SEASON_XP;
  assert.equal(world.lifeOp(p, { op: 'claim', level: 10 }), '');
  assert.equal(world.lifeOp(p, { op: 'aura', id: 'violet' }), '');
  assert.equal(p.meta().wk, 'violet');
  // G11: the glow shop sells looks for gold, never stats; the season's glows are not for sale
  assert.equal(world.lifeOp(p, { op: 'buyaura', id: 'violet' }), 'Not for sale');
  p.gold = 30_000;
  const stats0 = JSON.stringify(p.stats);
  assert.equal(world.lifeOp(p, { op: 'buyaura', id: 'abyss' }), 'Not enough gold');
  assert.equal(world.lifeOp(p, { op: 'buyaura', id: 'crimson' }), '');
  assert.equal(p.gold, 5_000);
  assert.ok(p.life.auras.includes('crimson') && p.meta().wk === 'crimson', 'owned and worn at once');
  assert.equal(world.lifeOp(p, { op: 'buyaura', id: 'crimson' }), 'You already own that glow');
  assert.equal(JSON.stringify(p.stats), stats0, 'no stat changes');
  if (p.eq.weapon) assert.ok(p.meta().wa! >= 1, 'a worn glow shows on any weapon');
  // the wardrobe: a helmet worn once becomes a look
  give(p, spec('plate_helm', { ilvl: 5 }));
  const helm = p.inv.find((i) => i.base === 'plate_helm');
  if (helm) {
    world.inventory(p, { op: 'equip', uid: helm.uid });
    assert.ok(p.life.looks.includes('plate_helm'));
    world.inventory(p, { op: 'unequip', slot: 'helmet' });
    assert.equal(world.lifeOp(p, { op: 'look', slot: 'helmet', base: 'plate_helm' }), '');
    assert.equal(p.ap.helmet, ITEMS.plate_helm.look!.helmet, 'the look is shown without the helmet worn');
  }
  assert.equal(world.lifeOp(p, { op: 'look', slot: 'armor', base: 'cloth_robe' }), 'You have not collected that look');
});
