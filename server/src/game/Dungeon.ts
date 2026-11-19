// Instanced dungeons. Each run owns a private room: stages spawn one after another, the boss
// last. No entry cost, no lockout: a run can be started again as soon as the last one ends.
import {
  ARMAGEDDON_LEVEL, DIFFICULTIES, DIFFICULTY, DUNGEON_CLOSE_MS, DUNGEON_EMPTY_MS, DUNGEON_GATHER_RANGE, DUNGEON_MAX_PLAYERS, DUNGEON_READY_MS, DUNGEONS, partyHpScale,
  type Difficulty, type DungeonDef, type DungeonState,
} from '../../../shared/src/dungeons';
import { MONSTERS } from '../../../shared/src/monsters';
import { RIFT_ID, RIFT_MIN_LEVEL, RIFT_NAME, RIFT_ZONE } from '../../../shared/src/rift';
/** The Endless Rift, as the ready check sees it. */
const RIFT_DEF: DungeonDef = { id: RIFT_ID, name: RIFT_NAME, zone: RIFT_ZONE, level: RIFT_MIN_LEVEL, minLevel: RIFT_MIN_LEVEL, boss: '', stages: [], blurb: '', armageddon: false };
import { CHAMBERS, gateNear, tileCenter, ZONES } from '../../../shared/src/world';
import { give } from './Inventory';
import type { Monster, MonsterScale } from './Monster';
import type { Party } from './Party';
import { ZoneRoom, type Player, type World } from './World';

export class DungeonRun {
  stage = -1;
  state: 'active' | 'cleared' = 'active';
  readonly startedAt = Date.now();
  clearedAt = 0;
  emptySince = 0;
  nextStageAt = 0;
  alive = new Set<Monster>();
  last = '';
  /** Everyone who has been inside, so completion rewards are paid once per player per run. */
  readonly entered = new Set<number>();
  constructor(readonly id: number, readonly def: DungeonDef, readonly diff: Difficulty, readonly room: ZoneRoom, readonly scale: MonsterScale, readonly party: Party | null, readonly owner: number) {}

  snapshot(now: number): DungeonState {
    const st = this.def.stages[Math.max(0, Math.min(this.stage, this.def.stages.length - 1))];
    return {
      id: this.def.id, diff: this.diff, stage: Math.max(0, this.stage), stages: this.def.stages.length, stageName: this.state === 'cleared' ? 'Cleared' : st.name,
      left: this.alive.size, state: this.state, elapsed: Math.round(((this.clearedAt || now) - this.startedAt) / 1000),
      closeIn: this.clearedAt ? Math.max(0, Math.ceil((this.clearedAt + DUNGEON_CLOSE_MS - now) / 1000)) : 0,
    };
  }
}

/** A party waiting for every member to agree to enter. */
interface ReadyCheck {
  party: Party;
  leader: Player;
  def: DungeonDef;
  diff: Difficulty;
  ok: Set<number>;
  until: number;
}
export class Dungeons {
  readonly runs = new Map<ZoneRoom, DungeonRun>();
  readonly checks = new Map<Party, ReadyCheck>();
  private nextId = 1;
  constructor(private w: World) {}

  /** The active run a player may join: their party's, or their own solo run. */
  private runFor(p: Player, id: string): DungeonRun | undefined {
    for (const r of this.runs.values()) if (r.def.id === id && r.state === 'active' && (p.party ? r.party === p.party : !r.party && r.owner === p.id)) return r;
    return undefined;
  }

  /** `enter` from a dungeon gate. Returns '' or the reason it was refused. */
  enter(p: Player, id: unknown, diff: unknown): string {
    const def = typeof id === 'string' ? DUNGEONS[id] : undefined;
    if (!def) return 'Unknown dungeon';
    const d: Difficulty = DIFFICULTIES.includes(diff as Difficulty) ? (diff as Difficulty) : 'normal';
    if (p.dead) return 'You are dead';
    if (this.runs.has(p.room)) return 'You are already inside a dungeon';
    const gate = gateNear(p.room.map, p.x, p.y);
    if (!gate || gate.dungeon !== def.id) return 'You need to stand at the dungeon entrance';
    if (p.level < def.minLevel) return `Requires level ${def.minLevel}`;
    if (d === 'armageddon' && !def.armageddon) return 'Armageddon is only offered in dungeons whose boss is level 50 or higher';
    if (d === 'armageddon' && p.level < ARMAGEDDON_LEVEL) return `Armageddon requires level ${ARMAGEDDON_LEVEL}`;
    let run = this.runFor(p, def.id);
    if (run && run.diff === 'armageddon' && p.level < ARMAGEDDON_LEVEL) return `Armageddon requires level ${ARMAGEDDON_LEVEL}`;
    if (run) {
      // Join a run the party already started (same difficulty the leader chose).
      if (run.room.players.size >= DUNGEON_MAX_PLAYERS) return 'The dungeon is full';
      this.move(p, run);
      return '';
    }
    return this.gather(p, def, d);
  }
  /** A party goes in together, once everyone agreed; alone, at once. Also used for the Endless Rift. */
  gather(p: Player, which: DungeonDef | 'rift', d: Difficulty = 'normal'): string {
    const def = which === 'rift' ? RIFT_DEF : which;
    if (p.party && p.party.leader !== p.id) return 'Only the party leader can open a dungeon';
    if (!p.party) return this.open(p, def, d, [p]);
    // A party goes in together: every member must stand at the entrance, alive and high enough
    // in level, and every member must agree.
    if (this.checks.has(p.party)) return 'Already waiting for the party to agree';
    const away = this.notReady(p, def, d);
    if (away.length) return `Every party member must be at the dungeon entrance: ${away.join(', ')}`;
    const check: ReadyCheck = { party: p.party, leader: p, def, diff: d, ok: new Set([p.id]), until: Date.now() + DUNGEON_READY_MS };
    this.checks.set(p.party, check);
    this.sendCheck(check);
    return '';
  }
  /** Names of the party members who cannot go in right now (not at the gate, dead, too low). */
  private notReady(p: Player, def: DungeonDef, d: Difficulty): string[] {
    const out: string[] = [];
    for (const id of p.party!.members) {
      const m = this.w.online.get(id);
      if (!m || m === p) continue;
      const here = m.room === p.room && Math.hypot(m.x - p.x, m.y - p.y) <= DUNGEON_GATHER_RANGE && !m.dead;
      if (!here || m.level < def.minLevel || (d === 'armageddon' && m.level < ARMAGEDDON_LEVEL)) out.push(m.name);
    }
    return out;
  }
  private sendCheck(c: ReadyCheck, end = false) {
    const names = (ids: number[]) => ids.map((id) => this.w.online.get(id)?.name ?? '').filter(Boolean);
    const all = [...c.party.members], ok = names(all.filter((id) => c.ok.has(id))), wait = names(all.filter((id) => !c.ok.has(id)));
    for (const id of all) {
      const m = this.w.online.get(id);
      if (m) this.w.send(m, { t: 'dready', id: end ? '' : c.def.id, diff: c.diff, from: c.leader.name, ms: Math.max(0, c.until - Date.now()), ok, wait });
    }
  }
  private endCheck(c: ReadyCheck, why: string) {
    this.checks.delete(c.party);
    this.sendCheck(c, true);
    for (const id of c.party.members) {
      const m = this.w.online.get(id);
      if (m && why) this.w.send(m, { t: 'sys', text: why });
    }
  }
  /** A party member answers the ready check. */
  ready(p: Player, yes: unknown): string {
    const c = p.party && this.checks.get(p.party);
    if (!c) return 'There is nothing to agree to';
    if (yes !== true) {
      this.endCheck(c, `${p.name} declined to enter ${c.def.name}.`);
      return '';
    }
    c.ok.add(p.id);
    if ([...c.party.members].some((id) => !c.ok.has(id))) {
      this.sendCheck(c);
      return '';
    }
    // everyone agreed: one last look that everyone is still at the gate
    this.checks.delete(c.party);
    this.sendCheck(c, true);
    const leader = this.w.online.get(c.leader.id);
    if (!leader || c.party.leader !== leader.id) return 'The party leader is no longer here';
    const away = this.notReady(leader, c.def, c.diff);
    if (away.length) {
      const why = `Every party member must be at the dungeon entrance: ${away.join(', ')}`;
      for (const id of c.party.members) { const m = this.w.online.get(id); if (m) this.w.send(m, { t: 'no', a: 'dng', why }); }
      return '';
    }
    const why = this.open(leader, c.def, c.diff, [...c.party.members].map((id) => this.w.online.get(id)!).filter(Boolean));
    if (why) this.w.send(leader, { t: 'no', a: 'dng', why });
    return '';
  }
  /** Opens a new instance and takes the group inside. */
  private open(p: Player, def: DungeonDef, d: Difficulty, group: Player[]): string {
    if (def.id === RIFT_ID) return this.w.rifts.open([p, ...group.filter((x) => x !== p)]);
    const k = DIFFICULTY[d];
    const scale: MonsterScale = { hp: k.hp * partyHpScale(group.length), atk: k.atk, level: k.level, exp: k.exp };
    const room = new ZoneRoom(def.zone, this.nextId);
    const run = new DungeonRun(this.nextId++, def, d, room, scale, p.party, p.id);
    this.runs.set(room, run);
    this.w.addRoom(room);
    this.advance(run);
    for (const m of group) this.move(m, run);
    this.w.announce(room, `${def.name} (${k.name}): ${def.stages[0].name}`, 'stage');
    return '';
  }

  private move(p: Player, run: DungeonRun) {
    p.ret = { zone: p.room.zoneId, x: p.x, y: p.y };
    const sp = ZONES[run.def.zone].spawn;
    this.w.relocate(p, run.room, tileCenter(sp.tx), tileCenter(sp.ty));
    run.entered.add(p.id);
    run.emptySince = 0;
    this.w.send(p, { t: 'dng', run: run.snapshot(Date.now()) });
  }

  /** `leave` command, the exit portal, or the instance closing: back to where the player came in. */
  leave(p: Player): string {
    const run = this.runs.get(p.room);
    if (!run) return 'You are not in a dungeon';
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : null;
    const zone = ret?.zone ?? 'eldoria', sp = ZONES[zone].spawn;
    p.ret = null;
    this.w.relocate(p, this.w.roomIn(zone, p), ret?.x ?? tileCenter(sp.tx), ret?.y ?? tileCenter(sp.ty));
    this.w.send(p, { t: 'dng', run: null });
    return '';
  }

  private advance(run: DungeonRun) {
    run.stage++;
    run.nextStageAt = 0;
    const st = run.def.stages[run.stage], c = CHAMBERS[st.room];
    let i = 0, total = 0;
    for (const [, n] of st.spawns) total += n;
    for (const [type, n] of st.spawns)
      for (let k = 0; k < n; k++, i++) {
        // the boss stands at the far end of its hall; everything else forms a loose ring
        const boss = !!MONSTERS[type].boss, a = (i / total) * 6.283, r = boss ? 0 : 3.2 + (i % 2) * 1.6;
        const m = this.w.spawn(run.room, type, tileCenter(c.cx + (boss ? 5 : 0)) + Math.cos(a) * r * 32, tileCenter(c.cy) + Math.sin(a) * r * 32, boss ? run.scale : { ...run.scale, exp: 0, gold: 0 });
        m.noRespawn = true;
        run.alive.add(m);
      }
    if (run.stage > 0) this.w.announce(run.room, run.stage === run.def.stages.length - 1 ? `The way to ${MONSTERS[run.def.boss].name} is open.` : `Stage ${run.stage + 1}: ${st.name}`, 'stage');
  }

  /** Called by the world for every monster death. */
  onKill(m: Monster) {
    const run = this.runs.get(m.room);
    if (!run || !run.alive.delete(m) || run.alive.size) return;
    if (run.stage < run.def.stages.length - 1) {
      run.nextStageAt = Date.now() + 2500;
      return;
    }
    // Boss down: the dungeon is cleared. Everyone inside is rewarded once, then the instance winds down.
    run.state = 'cleared';
    run.clearedAt = Date.now();
    const k = DIFFICULTY[run.diff], secs = Math.round((run.clearedAt - run.startedAt) / 1000);
    const gold = Math.round(40 * run.def.level * k.gold * this.w.goldRate);
    for (const p of run.room.players.values()) {
      this.w.quests.onClear(p, run.def.id);
      if (run.diff !== 'normal') this.w.seasons.add(p, 'dungeon', 1);
      this.w.journals.onClear(p, run.diff);
      p.gold += gold;
      const stones = 1 + (run.diff === 'normal' ? 0 : run.diff === 'hard' ? 1 : 2);
      const got = give(p, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: stones });
      p.invDirty = true;
      this.w.send(p, { t: 'loot', gold, items: got ? [{ base: 'upgrade_stone', rar: 0, qty: stones }] : [] });
      this.w.syncInv(p);
    }
    this.w.announce(run.room, `${run.def.name} cleared in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}! The dungeon closes in ${DUNGEON_CLOSE_MS / 1000} seconds.`, 'clear');
  }

  /** Once a second: next stages, closing, discarding empty instances, HUD updates. */
  tick(now: number) {
    for (const c of [...this.checks.values()]) {
      const gone = !this.w.online.has(c.leader.id) || c.party.leader !== c.leader.id || !c.party.members.length;
      if (gone) this.endCheck(c, `Entering ${c.def.name} was cancelled.`);
      else if (now >= c.until) this.endCheck(c, `Not everyone agreed to enter ${c.def.name} in time.`);
    }
    for (const run of [...this.runs.values()]) {
      const room = run.room;
      if (run.state === 'active' && run.nextStageAt && now >= run.nextStageAt) this.advance(run);
      if (run.state === 'cleared' && now >= run.clearedAt + DUNGEON_CLOSE_MS) for (const p of [...room.players.values()]) this.leave(p);
      if (!room.players.size) {
        run.emptySince ||= now;
        if (run.state === 'cleared' || now - run.emptySince >= DUNGEON_EMPTY_MS) {
          this.runs.delete(room);
          this.w.dropRoom(room);
          continue;
        }
      } else run.emptySince = 0;
      const snap = run.snapshot(now), json = JSON.stringify(snap);
      if (json === run.last) continue;
      run.last = json;
      for (const p of room.players.values()) this.w.send(p, { t: 'dng', run: snap });
    }
  }
  /** Sent with `welcome` so a reconnecting client shows the dungeon tracker again. */
  stateFor(p: Player): DungeonState | null {
    return this.runs.get(p.room)?.snapshot(Date.now()) ?? null;
  }
}
