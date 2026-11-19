// G9: the dungeon finder. Players queue for a dungeon and a difficulty; when four are waiting, or
// two or more once the first has waited twenty seconds, the server forms a party, brings everyone
// to the dungeon's gate and opens it with the ready check already answered.
import { DUNGEONS, DIFFICULTIES } from '../../../shared/src/dungeons';
import { FINDER_FULL, FINDER_LEVEL, FINDER_WAIT_MS, type FinderState } from '../../../shared/src/social';
import { REGIONS, tileCenter, ZONES } from '../../../shared/src/world';
import type { Player, World } from './World';

interface Entry { p: Player; dungeon: string; diff: string; since: number }

export class Finder {
  private q = new Map<number, Entry>();
  constructor(private w: World) {}

  private gateOf(dungeon: string) {
    for (const z of REGIONS) {
      const g = ZONES[z].gates?.find((x) => x.dungeon === dungeon);
      if (g) return { zone: z, x: tileCenter(g.tx), y: tileCenter(g.ty) + 40 };
    }
    return null;
  }

  op(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown command';
    if (m.op === 'state') return void this.send(p), '';
    if (m.op === 'leave') {
      if (this.q.delete(p.id)) this.broadcast();
      return '';
    }
    if (m.op !== 'join') return 'Unknown command';
    const def = typeof m.dungeon === 'string' ? DUNGEONS[m.dungeon] : undefined;
    if (!def || !this.gateOf(def.id)) return 'Unknown dungeon';
    if (!DIFFICULTIES.includes(m.diff) || (m.diff === 'armageddon' && !def.armageddon)) return 'Unknown difficulty';
    if (p.level < Math.max(FINDER_LEVEL, def.minLevel)) return `Requires level ${Math.max(FINDER_LEVEL, def.minLevel)}`;
    if (p.party) return 'Leave your party first, or go in together from the gate';
    if (this.w.dungeons.runs.has(p.room)) return 'You are already inside a dungeon';
    if (p.dead) return 'You are dead';
    this.q.set(p.id, { p, dungeon: def.id, diff: m.diff, since: Date.now() });
    this.broadcast();
    return '';
  }

  /** The finder as one player sees it. */
  state(p: Player): FinderState {
    const counts: Record<string, number> = {};
    for (const e of this.q.values()) counts[`${e.dungeon}:${e.diff}`] = (counts[`${e.dungeon}:${e.diff}`] ?? 0) + 1;
    const e = this.q.get(p.id);
    return { q: e ? { dungeon: e.dungeon, diff: e.diff, since: e.since } : null, counts };
  }
  send(p: Player) {
    this.w.send(p, { t: 'finder', ...this.state(p) });
  }
  private broadcast() {
    for (const e of this.q.values()) this.send(e.p);
  }

  /** About once a second: drop those who can no longer go, and form the groups that are ready. */
  tick(now: number) {
    let changed = false;
    for (const [id, e] of this.q) {
      if (!this.w.online.has(id) || !e.p.conn || e.p.party || e.p.dead || this.w.dungeons.runs.has(e.p.room)) { this.q.delete(id); changed = true; }
    }
    const groups = new Map<string, Entry[]>();
    for (const e of this.q.values()) {
      const k = `${e.dungeon}:${e.diff}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.since - b.since);
      while (list.length >= FINDER_FULL || (list.length >= 2 && now - list[0].since >= FINDER_WAIT_MS)) {
        this.form(list.splice(0, FINDER_FULL));
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  private form(group: Entry[]) {
    const def = DUNGEONS[group[0].dungeon], gate = this.gateOf(def.id)!, diff = group[0].diff;
    for (const e of group) this.q.delete(e.p.id);
    const players = group.map((e) => e.p), leader = players[0];
    this.w.parties.form(players);
    // everyone to the gate, side by side
    players.forEach((p, i) => this.w.relocate(p, this.w.roomIn(gate.zone, leader), gate.x + (i - (players.length - 1) / 2) * 28, gate.y));
    for (const p of players) {
      this.send(p);
      this.w.send(p, { t: 'sys', text: `The dungeon finder found a group for ${def.name}: ${players.map((x) => x.name).join(', ')}.`, cue: 'quest' });
    }
    // open it, with the ready check already answered: everyone asked for this
    const why = this.w.dungeon(leader, 'enter', def.id, diff);
    if (!why) for (const p of players.slice(1)) this.w.dungeons.ready(p, true);
  }
}
