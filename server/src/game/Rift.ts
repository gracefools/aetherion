// The Endless Rift on the server: a private instance per climb (solo or a party, entered through
// the Rift Warden in Eldoria with the same agreement as a dungeon). Floors come one after
// another in the rift's hall until one is not cleared in time, or everyone inside has fallen.
// The highest floor cleared is stored on the weekly leaderboard.
import { MONSTERS, mobAtk, mobHp } from '../../../shared/src/monsters';
import { INTERACT_RANGE, objNear } from '../../../shared/src/places';
import {
  isBossFloor, RIFT_BREAK_MS, RIFT_FLOOR_MS, RIFT_MIN_LEVEL, RIFT_NAME, RIFT_TOP, RIFT_ZONE, riftCount, riftFloorTypes, riftLevel, riftMul, riftReward, riftWeek,
  type RiftScore,
} from '../../../shared/src/rift';
import { BOSS_ROOM, CHAMBERS, tileCenter, ZONES } from '../../../shared/src/world';
import type { Repo } from '../db/repo';
import { award } from './Inventory';
import type { Monster, MonsterScale } from './Monster';
import type { Party } from './Party';
import { ZoneRoom, type Player, type World } from './World';

/** What the client shows while climbing. */
export interface RiftState {
  floor: number;
  left: number;
  /** Seconds left on this floor (0 during a break). */
  time: number;
  state: 'break' | 'fight' | 'over';
  /** Highest floor cleared in this climb. */
  best: number;
}
class RiftRun {
  floor = 0;
  best = 0;
  state: RiftState['state'] = 'break';
  nextAt = Date.now() + RIFT_BREAK_MS;
  endsAt = 0;
  overAt = 0;
  emptySince = 0;
  readonly startedAt = Date.now();
  readonly alive = new Set<Monster>();
  readonly entered = new Map<number, { name: string; job: string }>();
  last = '';
  constructor(readonly room: ZoneRoom, readonly party: Party | null, readonly level: number) {}
  snapshot(now: number): RiftState {
    return { floor: this.floor, left: this.alive.size, time: this.state === 'fight' ? Math.max(0, Math.ceil((this.endsAt - now) / 1000)) : 0, state: this.state, best: this.best };
  }
}
const WARDEN_RANGE = INTERACT_RANGE * 2.2;
const scaleFor = (type: string, level: number, floor: number): MonsterScale => {
  const d = MONSTERS[type], m = riftMul(floor);
  return { hp: (mobHp(level) / mobHp(d.level)) * m.hp, atk: (mobAtk(level) / mobAtk(d.level)) * m.atk, level: level - d.level, exp: 1, gold: 1, drop: 0.8 };
};

export class Rifts {
  readonly runs = new Map<ZoneRoom, RiftRun>();
  private nextId = 9000;
  constructor(private w: World, private repo: Repo) {}

  isRift(room: ZoneRoom) {
    return this.runs.has(room);
  }
  /** `{op:'enter'|'leave'|'top'}`. Returns '' or the reason it was refused. */
  async op(p: Player, m: any): Promise<string> {
    switch (m?.op) {
      case 'top': {
        const rows = await this.repo.riftTop(riftWeek(Date.now()), RIFT_TOP).catch(() => [] as RiftScore[]);
        this.w.send(p, { t: 'rifttop', rows, week: riftWeek(Date.now()) });
        return '';
      }
      case 'leave':
        return this.leave(p);
      case 'enter': {
        if (p.dead) return 'You are dead';
        if (this.runs.has(p.room) || this.w.dungeons.runs.has(p.room)) return 'You are already inside a dungeon';
        if (!objNear(p.room.zoneId, p.x, p.y, WARDEN_RANGE, ['riftwarden'])) return 'Speak with the Rift Warden in Eldoria to enter the Rift';
        if (p.level < RIFT_MIN_LEVEL) return `Requires level ${RIFT_MIN_LEVEL}`;
        return this.w.dungeons.gather(p, 'rift');
      }
      default:
        return 'Unknown command';
    }
  }
  /** Opens a climb and takes the group inside (called once everyone agreed). */
  open(group: Player[]): string {
    const lead = group[0], avg = Math.round(group.reduce((n, x) => n + x.level, 0) / group.length);
    const room = new ZoneRoom(RIFT_ZONE, this.nextId++);
    const run = new RiftRun(room, lead.party, avg);
    this.runs.set(room, run);
    this.w.addRoom(room);
    const sp = ZONES[RIFT_ZONE].spawn;
    for (const p of group) {
      p.ret = { zone: p.room.zoneId, x: p.x, y: p.y };
      this.w.relocate(p, room, tileCenter(sp.tx), tileCenter(sp.ty));
      run.entered.set(p.id, { name: p.name, job: p.job });
      this.w.send(p, { t: 'rift', run: run.snapshot(Date.now()) });
    }
    this.w.announce(room, `${RIFT_NAME}: the first floor opens in a moment. Every floor must be cleared within ${RIFT_FLOOR_MS / 1000} seconds.`, 'stage');
    return '';
  }
  leave(p: Player): string {
    const run = this.runs.get(p.room);
    if (!run) return 'You are not in the Rift';
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : null;
    const zone = ret?.zone ?? 'eldoria', sp = ZONES[zone].spawn;
    p.ret = null;
    this.w.relocate(p, this.w.roomIn(zone, p), ret?.x ?? tileCenter(sp.tx), ret?.y ?? tileCenter(sp.ty));
    this.w.send(p, { t: 'rift', run: null });
    return '';
  }
  private floor(run: RiftRun, now: number) {
    run.floor++;
    run.state = 'fight';
    run.endsAt = now + RIFT_FLOOR_MS;
    const level = riftLevel(run.level, run.floor), types = riftFloorTypes(run.floor, level), c = CHAMBERS[BOSS_ROOM];
    const n = isBossFloor(run.floor) ? 1 : riftCount(run.floor, run.room.players.size);
    for (let i = 0; i < n; i++) {
      const type = types[i % types.length], a = (i / n) * 6.283, r = isBossFloor(run.floor) ? 0 : 3.5 + (i % 3) * 1.4;
      const m = this.w.spawn(run.room, type, tileCenter(c.cx + 4) + Math.cos(a) * r * 32, tileCenter(c.cy) + Math.sin(a) * r * 32, { ...scaleFor(type, level, run.floor), exp: 0, gold: 0 });
      m.noRespawn = true;
      run.alive.add(m);
    }
    this.w.announce(run.room, isBossFloor(run.floor) ? `Floor ${run.floor}: ${MONSTERS[types[0]].name} guards the way up!` : `Floor ${run.floor}`, 'stage');
  }
  onKill(m: Monster) {
    const run = this.runs.get(m.room);
    if (!run || !run.alive.delete(m) || run.alive.size || run.state !== 'fight') return;
    run.best = run.floor;
    run.state = 'break';
    run.nextAt = Date.now() + RIFT_BREAK_MS;
    const level = riftLevel(run.level, run.floor), r = riftReward(run.floor, level);
    for (const p of run.room.players.values()) {
      award(this.w, p, Math.round(r.gold * this.w.goldRate), r.items.map(([base, qty]) => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty })));
      this.w.life.season(p, 'rift');
      this.w.grantExp(p, r.exp);
    }
    this.w.announce(run.room, `Floor ${run.floor} cleared! The next floor opens in ${RIFT_BREAK_MS / 1000} seconds.`, 'clear');
  }
  private async end(run: RiftRun, why: string, now: number) {
    run.state = 'over';
    run.overAt = now;
    for (const m of run.alive) if (!m.dead) this.w.removeMonster(m);
    run.alive.clear();
    this.w.announce(run.room, `${why} You reached floor ${run.best}. You will be returned in 20 seconds.`, 'phase');
    const secs = Math.round((now - run.startedAt) / 1000), week = riftWeek(now);
    if (run.best > 0)
      for (const id of run.entered.keys()) { const o = this.w.online.get(id); if (o) this.w.seasons.add(o, 'rift', run.best); }
    if (run.best > 0)
      for (const [id, x] of run.entered)
        await this.repo.saveRiftScore(week, id, x.name, x.job, run.best, secs, run.entered.size).catch((e) => console.error('rift score failed', e));
  }
  /** Once a second. */
  tick(now: number) {
    for (const run of [...this.runs.values()]) {
      const room = run.room;
      if (run.state === 'break' && now >= run.nextAt) this.floor(run, now);
      else if (run.state === 'fight') {
        const players = [...room.players.values()];
        if (now >= run.endsAt) void this.end(run, `Floor ${run.floor} was not cleared in time.`, now);
        else if (players.length && players.every((p) => p.dead)) void this.end(run, 'Everyone in the Rift has fallen.', now);
      } else if (run.state === 'over' && now >= run.overAt + 20_000) for (const p of [...room.players.values()]) this.leave(p);
      if (!room.players.size) {
        run.emptySince ||= now;
        if (run.state === 'over' || now - run.emptySince >= 20_000) {
          if (run.state !== 'over' && run.best > 0) void this.end(run, 'The climb was abandoned.', now);
          this.runs.delete(room);
          this.w.dropRoom(room);
          continue;
        }
      } else run.emptySince = 0;
      const snap = run.snapshot(now), json = JSON.stringify(snap);
      if (json === run.last) continue;
      run.last = json;
      for (const p of room.players.values()) this.w.send(p, { t: 'rift', run: snap });
    }
  }
  stateFor(p: Player): RiftState | null {
    return this.runs.get(p.room)?.snapshot(Date.now()) ?? null;
  }
}
