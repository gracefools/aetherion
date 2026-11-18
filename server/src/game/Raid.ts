// Raids on the server: a lobby at the Raid Herald in Eldoria (ten to twenty raiders), then a
// private instance with two waves of elite guards and Aetherion's Shadow, whose health grows with
// the number of raiders. Everyone inside when the Shadow falls is rewarded.
import { RAID_BOSS, RAID_LEVEL, RAID_MAX, RAID_MIN, RAID_ZONE, raidHpScale, raidWave, type RaidLobby, type RaidState } from '../../../shared/src/conquest';
import { sigilTierForBoss, rollSigil } from '../../../shared/src/gear';
import { ITEMS, rollBossItem, type ItemSpec } from '../../../shared/src/items';
import { MONSTERS, mobAtk, mobHp } from '../../../shared/src/monsters';
import { INTERACT_RANGE, objNear } from '../../../shared/src/places';
import { BOSS_ROOM, CHAMBERS, REGIONS, tileCenter, ZONES } from '../../../shared/src/world';
import { SPAWNS } from '../../../shared/src/monsters';
import { award } from './Inventory';
import type { Monster, MonsterScale } from './Monster';
import { ZoneRoom, type Player, type World } from './World';

const HERALD_RANGE = INTERACT_RANGE * 2.5;
interface Lobby {
  id: number;
  leader: number;
  members: number[];
}
class RaidRun {
  stage = 0;
  state: RaidState['state'] = 'active';
  nextAt = Date.now() + 5000;
  overAt = 0;
  emptySince = 0;
  readonly alive = new Set<Monster>();
  last = '';
  constructor(readonly room: ZoneRoom, readonly level: number, readonly players: number, readonly members: number[]) {}
  snapshot(): RaidState {
    return { stage: this.stage, stages: 3, left: this.alive.size, state: this.state, players: this.players };
  }
}
const scaleFor = (type: string, level: number, k: number): MonsterScale => {
  const d = MONSTERS[type];
  return { hp: (mobHp(level) / mobHp(d.level)) * k, atk: mobAtk(level) / mobAtk(d.level), level: level - d.level, exp: 2, gold: 2, drop: 1.5 };
};

export class Raids {
  readonly lobbies = new Map<number, Lobby>();
  readonly runs = new Map<ZoneRoom, RaidRun>();
  private nextId = 1;
  constructor(private w: World) {}

  /** Raiders needed to start (tests may lower it). */
  get min() {
    return this.w.opts.raidMin ?? RAID_MIN;
  }
  isRaid(room: ZoneRoom) {
    return this.runs.has(room);
  }
  private lobbyOf(id: number) {
    for (const l of this.lobbies.values()) if (l.members.includes(id)) return l;
    return undefined;
  }
  lobbyList(): RaidLobby[] {
    return [...this.lobbies.values()].map((l) => {
      const ps = l.members.map((id) => this.w.online.get(id)).filter((x): x is Player => !!x);
      return { id: l.id, leader: this.w.online.get(l.leader)?.name ?? '?', members: ps.map((p) => p.name), avg: Math.round(ps.reduce((n, p) => n + p.level, 0) / Math.max(1, ps.length)) };
    });
  }
  private sendLobbies() {
    const list = this.lobbyList();
    for (const p of this.w.online.values()) if (p.room.zoneId === 'eldoria') this.w.send(p, { t: 'raidlobby', list });
  }
  /** `{op:'open'|'join'|'leave'|'start'|'list', id?}`. Returns '' or the reason it was refused. */
  op(p: Player, m: any): string {
    const near = !!objNear(p.room.zoneId, p.x, p.y, HERALD_RANGE, ['raidherald']);
    switch (m?.op) {
      case 'list':
        this.w.send(p, { t: 'raidlobby', list: this.lobbyList() });
        return '';
      case 'open': {
        if (!near) return 'Speak with the Raid Herald in Eldoria';
        if (p.level < RAID_LEVEL) return `Raids open at level ${RAID_LEVEL}`;
        if (this.lobbyOf(p.id)) return 'You are already in a raid group';
        const l = { id: this.nextId++, leader: p.id, members: [p.id] };
        this.lobbies.set(l.id, l);
        this.w.announce(p.room, `${p.name} is gathering a raid against Aetherion's Shadow at the Raid Herald.`, 'stage');
        this.sendLobbies();
        return '';
      }
      case 'join': {
        if (!near) return 'Speak with the Raid Herald in Eldoria';
        if (p.level < RAID_LEVEL) return `Raids open at level ${RAID_LEVEL}`;
        if (this.lobbyOf(p.id)) return 'You are already in a raid group';
        const l = this.lobbies.get(m.id);
        if (!l) return 'That raid group is gone';
        if (l.members.length >= RAID_MAX) return 'That raid group is full';
        l.members.push(p.id);
        this.sendLobbies();
        return '';
      }
      case 'leave': {
        if (this.runs.has(p.room)) return this.leave(p);
        const l = this.lobbyOf(p.id);
        if (!l) return 'You are not in a raid group';
        l.members = l.members.filter((x) => x !== p.id);
        if (!l.members.length || l.leader === p.id) this.lobbies.delete(l.id);
        this.sendLobbies();
        return '';
      }
      case 'start': {
        const l = this.lobbyOf(p.id);
        if (!l || l.leader !== p.id) return 'Only the raid leader can start';
        const ps = l.members.map((id) => this.w.online.get(id)).filter((x): x is Player => !!x && !x.dead);
        const here = ps.filter((x) => x.room.zoneId === 'eldoria' && objNear('eldoria', x.x, x.y, HERALD_RANGE, ['raidherald']));
        if (here.length < this.min) return `A raid needs at least ${this.min} raiders at the Raid Herald (${here.length} here)`;
        this.lobbies.delete(l.id);
        this.sendLobbies();
        this.open(here);
        return '';
      }
      default:
        return 'Unknown command';
    }
  }
  private open(group: Player[]) {
    const avg = Math.round(group.reduce((n, x) => n + x.level, 0) / group.length);
    const room = new ZoneRoom(RAID_ZONE, 7000 + this.nextId++);
    const run = new RaidRun(room, Math.max(RAID_LEVEL, avg + 5), group.length, group.map((p) => p.id));
    this.runs.set(room, run);
    this.w.addRoom(room);
    const sp = ZONES[RAID_ZONE].spawn;
    for (const p of group) {
      p.ret = { zone: p.room.zoneId, x: p.x, y: p.y };
      this.w.relocate(p, room, tileCenter(sp.tx), tileCenter(sp.ty));
      this.w.send(p, { t: 'raid', run: run.snapshot() });
    }
    this.w.announceAll(`A raid of ${group.length} enters the Shadow's Sanctum.`, 'worldboss');
  }
  leave(p: Player): string {
    const run = this.runs.get(p.room);
    if (!run) return 'You are not in a raid';
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : null;
    const zone = ret?.zone ?? 'eldoria', sp = ZONES[zone].spawn;
    p.ret = null;
    this.w.relocate(p, this.w.roomIn(zone, p), ret?.x ?? tileCenter(sp.tx), ret?.y ?? tileCenter(sp.ty));
    this.w.send(p, { t: 'raid', run: null });
    return '';
  }
  /** The elites of a raid wave: from the regions nearest the raid's level. */
  private eliteTypes(level: number): string[] {
    const elites = REGIONS.flatMap((z) => (SPAWNS[z] ?? []).map((g) => g.type)).filter((t, i, a) => a.indexOf(t) === i && MONSTERS[t].elite && !MONSTERS[t].boss);
    return elites.sort((a, b) => Math.abs(MONSTERS[a].level - level) - Math.abs(MONSTERS[b].level - level)).slice(0, 3);
  }
  private advance(run: RaidRun) {
    run.stage++;
    const hp = raidHpScale(run.players);
    if (run.stage <= 2) {
      const c = CHAMBERS[run.stage === 1 ? 1 : 2], types = this.eliteTypes(run.level), n = raidWave(run.stage, run.players);
      for (let i = 0; i < n; i++) {
        const t = types[i % types.length], a = (i / n) * 6.283;
        const m = this.w.spawn(run.room, t, tileCenter(c.cx) + Math.cos(a) * 110, tileCenter(c.cy) + Math.sin(a) * 110, scaleFor(t, run.level, hp * 0.5));
        m.noRespawn = true;
        run.alive.add(m);
      }
      this.w.announce(run.room, run.stage === 1 ? 'The Shadow\'s guards bar the way!' : 'Its elite guard stands before the throne!', 'stage');
    } else {
      const c = CHAMBERS[BOSS_ROOM];
      const m = this.w.spawn(run.room, RAID_BOSS, tileCenter(c.cx + 5), tileCenter(c.cy), scaleFor(RAID_BOSS, run.level, hp));
      m.noRespawn = true;
      run.alive.add(m);
      this.w.announce(run.room, 'Aetherion\'s Shadow rises from the throne. Hold together!', 'boss');
    }
  }
  onKill(m: Monster) {
    const run = this.runs.get(m.room);
    if (!run || !run.alive.delete(m) || run.alive.size || run.state !== 'active') return;
    if (run.stage < 3) {
      run.nextAt = Date.now() + 4000;
      return;
    }
    // the Shadow is down: every raider inside is rewarded
    run.state = 'won';
    run.overAt = Date.now();
    for (const p of run.room.players.values()) {
      const items: ItemSpec[] = [rollBossItem(this.w.rnd, RAID_BOSS, run.level, p.job, 'raid'), rollBossItem(this.w.rnd, RAID_BOSS, run.level, p.job, 'raid'),
        { base: 'awakening_essence', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 }, { base: 'arm_core', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 }];
      const tier = sigilTierForBoss(run.level);
      if (tier && this.w.rnd() < 0.5) items.push(rollSigil(this.w.rnd, tier));
      award(this.w, p, Math.round(400 * run.level * this.w.goldRate), items);
      this.w.journals.onBoss(p, true);
      this.w.life.season(p, 'raid');
      // the rarest prize: a flying mount's reins
      const reins = this.w.rnd() < 0.02 ? 'mount_star_drake' : this.w.rnd() < 0.05 ? 'mount_sky_griffin' : '';
      if (reins) award(this.w, p, 0, [{ base: reins, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 }]);
      for (const it of items) if (it.rar >= 5) this.w.announce(run.room, `${p.name} received Mythic loot: ${ITEMS[it.base].name}!`, 'loot');
    }
    this.w.announceAll(`Aetherion's Shadow has fallen to a raid of ${run.players}!`, 'bossdown');
  }
  tick(now: number) {
    for (const l of [...this.lobbies.values()]) {
      l.members = l.members.filter((id) => this.w.online.has(id));
      if (!l.members.includes(l.leader)) this.lobbies.delete(l.id);
    }
    for (const run of [...this.runs.values()]) {
      const room = run.room, players = [...room.players.values()];
      if (run.state === 'active' && run.nextAt && now >= run.nextAt) {
        run.nextAt = 0;
        this.advance(run);
      }
      if (run.state === 'active' && players.length && players.every((p) => p.dead)) {
        run.state = 'over';
        run.overAt = now;
        for (const m of run.alive) if (!m.dead) this.w.removeMonster(m);
        run.alive.clear();
        this.w.announce(room, 'The raid has fallen. You will be returned in 20 seconds.', 'phase');
      }
      if (run.state !== 'active' && now >= run.overAt + 30_000) for (const p of players) this.leave(p);
      if (!room.players.size) {
        run.emptySince ||= now;
        if (run.state !== 'active' || now - run.emptySince >= 30_000) {
          this.runs.delete(room);
          this.w.dropRoom(room);
          continue;
        }
      } else run.emptySince = 0;
      const snap = run.snapshot(), json = JSON.stringify(snap);
      if (json === run.last) continue;
      run.last = json;
      for (const p of room.players.values()) this.w.send(p, { t: 'raid', run: snap });
    }
  }
  stateFor(p: Player): RaidState | null {
    return this.runs.get(p.room)?.snapshot() ?? null;
  }
}
