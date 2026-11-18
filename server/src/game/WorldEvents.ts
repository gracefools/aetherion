// Dynamic world events and the monsters of the night. One event runs at a time somewhere in the
// world, in a region where players are: an invasion of a village, a meteor shower, or a treasure
// goblin to catch. Everyone who helped is rewarded by their share. At nightfall every region
// gets extra, stronger camps of night monsters, which leave again at dawn.
import {
  EVENT_GAP_MS, EVENT_KINDS, EVENT_MIN_SHARE, EVENTS, eventReward, invasionGoal, isNight, METEOR_COUNT, NIGHT_CAMP_COUNT, NIGHT_CAMPS, NIGHT_MONSTER,
  type EventKind, type WorldEventState,
} from '../../../shared/src/events';
import { MONSTERS, mobAtk, mobHp, SPAWNS } from '../../../shared/src/monsters';
import { spawnFault } from '../../../shared/src/nav';
import { navOf } from '../../../shared/src/nav';
import { TILE } from '../../../shared/src/protocol';
import { REGIONS, tileCenter, ZONES } from '../../../shared/src/world';
import { award } from './Inventory';
import type { Monster, MonsterScale } from './Monster';
import type { Player, World, ZoneRoom } from './World';

interface Running {
  st: WorldEventState;
  room: ZoneRoom;
  mobs: Set<Monster>;
  /** Damage dealt to the event's monsters, per player. */
  contrib: Map<number, number>;
  spawned: number;
  last: string;
}
/** A scale that makes a monster fight like one of `level` (health and attack from the level curves). */
function levelScale(type: string, level: number, k = 1): MonsterScale {
  const d = MONSTERS[type];
  return { hp: (mobHp(level) / mobHp(d.level)) * k, atk: (mobAtk(level) / mobAtk(d.level)) * k, level: level - d.level, exp: 1.5, gold: 1.5, drop: 1.2, fierce: true };
}

export class WorldEvents {
  cur: Running | null = null;
  nextAt = 0;
  private nextId = 1;
  private night: boolean | null = null;
  readonly nightMobs = new Set<Monster>();
  constructor(private w: World) {}

  /** What every client is told about the running event (null when none). */
  state(): WorldEventState | null {
    return this.cur?.st ?? null;
  }
  private broadcast() {
    const st = this.state(), json = JSON.stringify(st);
    if (this.cur && json === this.cur.last) return;
    if (this.cur) this.cur.last = json;
    for (const p of this.w.online.values()) this.w.send(p, { t: 'wevent', ev: st });
  }
  sendTo(p: Player) {
    this.w.send(p, { t: 'wevent', ev: this.state() });
  }

  /** Once a second. */
  tick(now: number) {
    if (this.w.opts.events !== false) this.nightTick(now);
    if (!this.cur) {
      if (this.w.opts.events === false) return;
      if (!this.nextAt) this.nextAt = now + EVENT_GAP_MS.min;
      if (now >= this.nextAt) this.start(now);
      return;
    }
    const c = this.cur;
    if (c.st.state !== 'active') {
      if (now >= c.st.endsAt) this.cleanup(now);
      return;
    }
    if (c.st.kind === 'invasion') this.reinforce(c);
    if (now >= c.st.endsAt) this.finish(false, now);
    else this.broadcast();
  }

  /** Starts an event (a kind and a region may be forced, e.g. by tests). Returns false when nobody is playing. */
  start(now: number, kind?: EventKind, zone?: string): boolean {
    const rooms = this.w.openRooms().filter((r) => REGIONS.includes(r.zoneId) && r.players.size && (!zone || r.zoneId === zone));
    if (!rooms.length) {
      this.nextAt = now + 60_000;
      return false;
    }
    const room = rooms[Math.floor(this.w.rnd() * rooms.length)], z = ZONES[room.zoneId], t = z.town!;
    const k = kind ?? EVENT_KINDS[Math.floor(this.w.rnd() * EVENT_KINDS.length)];
    const st: WorldEventState = { id: this.nextId++, kind: k, zone: room.zoneId, tx: t.tx, ty: t.ty, endsAt: now + EVENTS[k].ms, progress: 0, goal: 1, state: 'active' };
    this.cur = { st, room, mobs: new Set(), contrib: new Map(), spawned: 0, last: '' };
    const lv = Math.round((z.level[0] + z.level[1]) / 2);
    if (k === 'invasion') {
      st.goal = invasionGoal(room.players.size);
      this.reinforce(this.cur);
      this.w.announceAll(`Invasion! Monsters march on ${t.name} in ${z.name}. Defend the village!`, 'worldboss');
    } else if (k === 'meteor') {
      st.goal = METEOR_COUNT;
      for (let i = 0; i < METEOR_COUNT; i++) {
        const at = this.openSpot(room, 20, 0);
        if (at) this.track(this.w.spawn(room, 'star_fragment', at.x, at.y, levelScale('star_fragment', lv, 8)));
      }
      const first = [...this.cur.mobs][0];
      if (first) [st.tx, st.ty] = [Math.floor(first.x / TILE), Math.floor(first.y / TILE)];
      this.w.announceAll(`A meteor shower strikes ${z.name}! Break the star fragments open for shards and gold.`, 'worldboss');
    } else {
      st.goal = 1;
      const at = this.openSpot(room, 30, 0);
      if (at) {
        const g = this.w.spawn(room, 'treasure_goblin', at.x, at.y, levelScale('treasure_goblin', lv, 20));
        this.track(g);
        [st.tx, st.ty] = [Math.floor(at.x / TILE), Math.floor(at.y / TILE)];
      }
      this.w.announceAll(`A treasure goblin has been sighted in ${z.name}! Catch it before it escapes.`, 'worldboss');
    }
    this.broadcast();
    return true;
  }
  private track(m: Monster) {
    m.noRespawn = true;
    m.event = true;
    this.cur!.mobs.add(m);
    this.cur!.spawned++;
  }
  /** A random open point at least `minTiles` from the village (and from the arrival point). */
  private openSpot(room: ZoneRoom, minTiles: number, maxTiles: number): { x: number; y: number } | null {
    const z = ZONES[room.zoneId], t = z.town!, nav = navOf(room.zoneId);
    for (let i = 0; i < 400; i++) {
      let tx: number, ty: number;
      if (maxTiles) {
        const a = this.w.rnd() * 6.283, r = minTiles + this.w.rnd() * (maxTiles - minTiles);
        tx = Math.round(t.tx + Math.cos(a) * r);
        ty = Math.round(t.ty + Math.sin(a) * r);
      } else {
        tx = 6 + Math.floor(this.w.rnd() * (z.w - 12));
        ty = 6 + Math.floor(this.w.rnd() * (z.h - 12));
      }
      if (Math.hypot(tx - t.tx, ty - t.ty) < minTiles || Math.hypot(tx - z.spawn.tx, ty - z.spawn.ty) < 10) continue;
      const x = tileCenter(tx), y = tileCenter(ty);
      if (!spawnFault(nav, x, y, false)) return { x, y };
    }
    return null;
  }
  /** Invaders come in waves: up to eight at a time, until the goal is reached. They march on the village. */
  private reinforce(c: Running) {
    const z = ZONES[c.room.zoneId], t = z.town!, lv = z.level[0] + 2;
    const types = (SPAWNS[c.room.zoneId] ?? []).map((g) => g.type).filter((ty) => !MONSTERS[ty].elite && !MONSTERS[ty].boss);
    let alive = 0;
    for (const m of c.mobs) if (!m.dead) alive++;
    while (alive < 8 && c.spawned < c.st.goal && types.length) {
      const at = this.openSpot(c.room, 30, 40);
      if (!at) break;
      const m = this.w.spawn(c.room, types[c.spawned % types.length], at.x, at.y, levelScale(types[c.spawned % types.length], lv, 1.2));
      // their home is the village: wandering home means marching into it
      m.spawnX = tileCenter(t.tx);
      m.spawnY = tileCenter(t.ty);
      m.patrolR = 4 * TILE;
      m.invader = true;
      this.track(m);
      alive++;
    }
  }

  /** Called for every monster death. */
  onKill(m: Monster) {
    const c = this.cur;
    if (!c || !m.event || !c.mobs.has(m) || c.st.state !== 'active') return;
    for (const [id, d] of m.dmgBy) c.contrib.set(id, (c.contrib.get(id) ?? 0) + d);
    c.st.progress++;
    if (c.st.progress >= c.st.goal) this.finish(true, Date.now());
    else this.broadcast();
  }

  private finish(won: boolean, now: number) {
    const c = this.cur!, z = ZONES[c.st.zone], def = EVENTS[c.st.kind];
    c.st.state = won ? 'won' : 'lost';
    c.st.endsAt = now + 15_000; // the result stays on screen for a moment
    if (won) {
      const total = [...c.contrib.values()].reduce((n, v) => n + v, 0) || 1, lv = Math.round((z.level[0] + z.level[1]) / 2);
      for (const [id, d] of c.contrib) {
        const p = this.w.online.get(id), share = d / total;
        if (!p || share < EVENT_MIN_SHARE) continue;
        const r = eventReward(c.st.kind, lv, share);
        const items = [{ base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: r.stones }, ...(r.shards ? [{ base: 'arm_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: r.shards }] : []),
          ...(c.st.kind === 'meteor' ? [{ base: 'star_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 }] : [])];
        award(this.w, p, r.gold, items as any);
        this.w.grantExp(p, r.exp);
        this.w.send(p, { t: 'sys', text: `${def.name} won: ${r.gold} gold and ${r.exp} EXP for your part (${Math.round(share * 100)}%).`, cue: 'questdone' });
        this.w.journals.add(p, 'mission', 0);
      }
      this.w.announceAll(`${def.name} in ${z.name}: victory!`, 'bossdown');
    } else this.w.announceAll(c.st.kind === 'goblin' ? `${def.name} in ${z.name} is over: the goblin escaped.` : `${def.name} in ${z.name} is over: it was not stopped in time.`, 'phase');
    // what is left of it leaves the world
    for (const m of c.mobs) if (!m.dead) this.w.removeMonster(m);
    this.broadcast();
  }
  private cleanup(now: number) {
    this.cur = null;
    this.nextAt = now + EVENT_GAP_MS.min + Math.floor(this.w.rnd() * (EVENT_GAP_MS.max - EVENT_GAP_MS.min));
    this.broadcast();
    for (const p of this.w.online.values()) this.w.send(p, { t: 'wevent', ev: null });
  }

  // ---------- the night ----------
  private nightTick(now: number) {
    const night = isNight(now);
    if (night === this.night) return;
    const first = this.night === null;
    this.night = night;
    if (night) {
      for (const room of this.w.openRooms()) this.nightfall(room);
      if (!first) this.w.announceAll('Night falls. Stronger monsters of the night are abroad.', 'phase');
    } else {
      for (const m of this.nightMobs) if (!m.dead) this.w.removeMonster(m);
      this.nightMobs.clear();
      if (!first) this.w.announceAll('Dawn breaks. The monsters of the night withdraw.', 'phase');
    }
  }
  /** A room opened at night gets its night camps too. */
  onRoomOpened(room: ZoneRoom) {
    if (this.night && this.w.opts.events !== false) this.nightfall(room);
  }
  private nightfall(room: ZoneRoom) {
    if (!REGIONS.includes(room.zoneId) || room.zoneId === 'eldoria') return;
    const nav = navOf(room.zoneId), groups = (SPAWNS[room.zoneId] ?? []).filter((g) => !MONSTERS[g.type].elite && !MONSTERS[g.type].boss).slice(0, NIGHT_CAMPS);
    for (const g of groups)
      for (let i = 0, tries = 0; i < NIGHT_CAMP_COUNT && tries < 200; tries++) {
        const a = this.w.rnd() * 6.283, r = Math.sqrt(this.w.rnd()) * g.r;
        const x = tileCenter(Math.round(g.tx + Math.cos(a) * r)), y = tileCenter(Math.round(g.ty + Math.sin(a) * r));
        if (spawnFault(nav, x, y, MONSTERS[g.type].flying)) continue;
        const m = this.w.spawn(room, g.type, x, y, { ...NIGHT_MONSTER });
        m.noRespawn = true;
        m.nightborn = true;
        this.nightMobs.add(m);
        i++;
      }
  }
}
