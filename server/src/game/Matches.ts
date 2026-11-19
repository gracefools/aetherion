// G8: matchmaking and battlegrounds. Players queue at the Arena Master (and may then go about their
// business anywhere); when a match is found they are taken to a private hall and brought back to
// where they were when it ends. Rated duels change rating; the battleground pays honour to both sides.
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import {
  BG, BG_BASES, BG_SHRINE, formTeams, MATCH_DROP_MS, MATCH_END_MS, MATCH_ZONE, pairRanked, pickBattleground, RANKED, RANKED_HALL,
  shrineHolder, type MatchMode, type MatchView, type QueueEntry,
} from '../../../shared/src/matches';
import { ratingDelta } from '../../../shared/src/pvp';
import { TICK_MS, TILE } from '../../../shared/src/protocol';
import { tileCenter, ZONES } from '../../../shared/src/world';
import { clearStatuses } from './entity';
import type { Pvp } from './Pvp';
import type { Player, World } from './World';
import { ZoneRoom } from './World';

interface Match {
  id: number;
  mode: MatchMode;
  room: ZoneRoom;
  /** Everyone who was placed in it, and their side. */
  side: Map<number, number>;
  /** Those still in it. */
  fighters: Set<Player>;
  names: [string[], string[]];
  ids: [number[], number[]];
  score: number[];
  startsAt: number;
  endsAt: number;
  /** When it was decided (0 while it runs); everyone goes home MATCH_END_MS later. */
  overAt: number;
  winner: -1 | 0 | 1;
  shrine: -1 | 0 | 1;
  nextHold: number;
  /** Fighters who are disconnected, since when. */
  away: Map<number, number>;
}

export class Matches {
  /** player id -> what they queued for and since when */
  private queue = new Map<number, { mode: MatchMode; since: number }>();
  private matches = new Set<Match>();
  private of = new Map<number, Match>();
  private rooms = new Set<ZoneRoom>();
  private nextId = 1;
  constructor(private w: World, private pvp: Pvp) {}

  isMatch(room: ZoneRoom) {
    return this.rooms.has(room);
  }
  private matchOf(p: Player) {
    const m = this.of.get(p.id);
    return m && m.room === p.room ? m : undefined;
  }
  /** A number that stands in for the party inside a match: team-mates never hurt each other. */
  teamKey(p: Player): number {
    const m = this.matchOf(p);
    return m ? -(m.id * 2 + (m.side.get(p.id) ?? 0) + 1) : 0;
  }
  queued(p: Player) {
    return this.queue.get(p.id)?.mode ?? null;
  }

  /** Why a player cannot be taken into a match right now ('' if they can). */
  private unfit(p: Player): string {
    if (!p.conn) return 'offline';
    if (p.dead) return 'You are dead';
    if (this.of.has(p.id)) return 'You are already in a match';
    if ((ZONES[p.room.zoneId].kind === 'dungeon' && !this.pvp.isArena(p.room)) || this.w.life.isHome(p.room)) return 'Leave the dungeon first';
    if ((this.w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Not while in combat';
    return '';
  }
  join(p: Player, mode: unknown): string {
    if (mode !== 'ranked' && mode !== 'bg') return 'Unknown command';
    if (this.of.has(p.id)) return 'You are already in a match';
    if ((ZONES[p.room.zoneId].kind === 'dungeon' && !this.pvp.isArena(p.room)) || this.w.life.isHome(p.room)) return 'Leave the dungeon first';
    this.queue.set(p.id, { mode, since: Date.now() });
    this.w.send(p, { t: 'mq', mode });
    this.w.send(p, { t: 'sys', text: mode === 'ranked' ? 'You are in line for a rated duel. You may go about your business until it is found.' : 'You are in line for the Shrine Clash. You may go about your business until it is found.' });
    return '';
  }
  leaveQueue(p: Player): string {
    if (!this.queue.delete(p.id)) return 'You are not in line';
    this.w.send(p, { t: 'mq', mode: null });
    return '';
  }

  tick(now: number) {
    for (const [id, q] of this.queue) {
      const p = this.w.online.get(id);
      if (!p || !p.conn) this.queue.delete(id);
    }
    this.findMatches(now);
    for (const m of this.matches) this.run(m, now);
  }

  private findMatches(now: number) {
    const fit = (mode: MatchMode): QueueEntry[] => {
      const out: QueueEntry[] = [];
      for (const [id, q] of this.queue) {
        const p = this.w.online.get(id);
        if (q.mode === mode && p && !this.unfit(p)) out.push({ id, rating: this.pvp.rating.get(id) ?? 1000, since: q.since });
      }
      return out;
    };
    for (const [a, b] of pairRanked(fit('ranked'), now)) this.start('ranked', [[a], [b]], now);
    const bg = pickBattleground(fit('bg'), now);
    if (bg) this.start('bg', formTeams(bg), now);
  }

  private start(mode: MatchMode, teams: [number[], number[]], now: number) {
    const id = this.nextId++, room = new ZoneRoom(MATCH_ZONE, 910_000 + id);
    this.w.addRoom(room);
    this.rooms.add(room);
    const lead = mode === 'ranked' ? RANKED.countdownMs : BG.countdownMs;
    const m: Match = {
      id, mode, room, side: new Map(), fighters: new Set(), names: [[], []], ids: [[], []], score: [0, 0],
      startsAt: now + lead, endsAt: now + lead + (mode === 'ranked' ? RANKED.maxMs : BG.durationMs), overAt: 0, winner: -1, shrine: -1,
      nextHold: now + lead + BG.holdEveryMs, away: new Map(),
    };
    this.matches.add(m);
    teams.forEach((ids, side) => {
      for (const pid of ids) {
        const p = this.w.online.get(pid)!;
        this.queue.delete(pid);
        m.side.set(pid, side);
        m.fighters.add(p);
        m.ids[side].push(pid);
        m.names[side].push(p.name);
        this.of.set(pid, m);
      }
    });
    for (const p of m.fighters) {
      if (!this.pvp.isArena(p.room)) p.ret = { zone: p.room.zoneId, x: p.x, y: p.y }; // from the arena, home is still where they came from
      const at = this.spot(m, p);
      this.w.relocate(p, room, at.x, at.y);
      p.pvpShieldUntil = m.startsAt; // nobody can be hurt before the start
      p.hp = p.maxHp;
      p.sver++;
      this.w.send(p, { t: 'mq', mode: null });
      this.w.send(p, { t: 'ann', text: mode === 'ranked' ? `A rated duel against ${this.names(m, 1 - m.side.get(p.id)!)}. It begins in ${Math.round(lead / 1000)} seconds.` : `The Shrine Clash begins in ${Math.round(lead / 1000)} seconds. Hold the shrine between the bases and defeat the other team: the first to ${BG.target} points wins.`, cue: 'pvp' });
    }
    this.broadcast(m, now);
  }
  private names(m: Match, side: number) {
    return m.names[side].join(', ');
  }
  /** Where a fighter starts or comes back. */
  private spot(m: Match, p: Player) {
    const side = m.side.get(p.id) ?? 0, j = () => (this.w.rnd() - 0.5) * TILE * 3;
    if (m.mode === 'ranked') return { x: tileCenter(RANKED_HALL.tx + (side ? RANKED.apart : -RANKED.apart)), y: tileCenter(RANKED_HALL.ty) + j() };
    const b = BG_BASES[side];
    return { x: tileCenter(b.tx) + j(), y: tileCenter(b.ty) + j() };
  }
  spawnFor(p: Player) {
    const m = this.matchOf(p);
    return m ? this.spot(m, p) : null;
  }

  private view(m: Match, side: number, now: number): MatchView {
    return {
      mode: m.mode, side,
      teams: [0, 1].map((s) => ({ ids: m.ids[s], names: m.names[s], score: m.score[s] })),
      starts: Math.max(0, m.startsAt - now), ends: Math.max(0, m.endsAt - now), shrine: m.shrine,
      result: m.overAt ? (m.winner === -1 ? 'draw' : m.winner === side ? 'won' : 'lost') : undefined,
    };
  }
  private broadcast(m: Match, now: number) {
    for (const p of m.fighters) this.w.send(p, { t: 'match', v: this.view(m, m.side.get(p.id) ?? 0, now) });
  }

  private run(m: Match, now: number) {
    // whoever left the hall, or stayed disconnected too long, is out of it
    for (const p of [...m.fighters]) {
      if (p.room !== m.room || !this.w.online.has(p.id)) this.drop(m, p, now, false);
      else if (!p.conn) {
        if (!m.away.has(p.id)) m.away.set(p.id, now);
        else if (now - m.away.get(p.id)! >= MATCH_DROP_MS) this.leave(p);
      } else m.away.delete(p.id);
    }
    if (!this.matches.has(m)) return;
    if (m.overAt) {
      if (now - m.overAt >= MATCH_END_MS) this.close(m);
      return;
    }
    if (m.mode === 'bg') {
      // the fallen come back at their base
      for (const p of m.fighters) if (p.dead && (this.w.tick - p.deadTick) * TICK_MS >= BG.respawnMs) this.w.requestRespawn(p);
      if (now >= m.startsAt && now >= m.nextHold) {
        m.nextHold += BG.holdEveryMs;
        const present: [number, number] = [0, 0];
        for (const p of m.fighters) if (!p.dead && Math.hypot(p.x / TILE - BG_SHRINE.tx - 0.5, p.y / TILE - BG_SHRINE.ty - 0.5) <= BG.shrineR) present[m.side.get(p.id)!]++;
        const h = shrineHolder(present);
        if (h !== m.shrine) {
          m.shrine = h;
          if (h >= 0) for (const p of m.fighters) this.w.send(p, { t: 'sys', text: m.side.get(p.id) === h ? 'Your team holds the shrine.' : 'The other team holds the shrine.', cue: 'pvp' });
        }
        if (h >= 0) m.score[h]++;
        if (!this.checkScore(m, now)) this.broadcast(m, now);
      }
    }
    if (now >= m.endsAt) this.finish(m, m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1, now);
  }
  private checkScore(m: Match, now: number) {
    const w = m.score[0] >= BG.target ? 0 : m.score[1] >= BG.target ? 1 : -1;
    if (w < 0) return false;
    this.finish(m, w, now);
    return true;
  }

  /** A fighter fell to another fighter. */
  onKill(k: Player, v: Player) {
    const m = this.matchOf(v), now = Date.now();
    if (!m || m.overAt || m !== this.matchOf(k)) return;
    if (m.mode === 'ranked') return this.finish(m, m.side.get(k.id) as 0 | 1, now);
    m.score[m.side.get(k.id)!] += BG.killPoints;
    v.pvpShieldUntil = now + BG.respawnMs + 3000;
    this.pvp.bump(k, { arena_kills: 1 });
    this.pvp.bump(v, { arena_deaths: 1 });
    this.w.send(k, { t: 'sys', text: `You defeated ${v.name}: +${BG.killPoints} points for your team.`, cue: 'pvp' });
    if (!this.checkScore(m, now)) this.broadcast(m, now);
  }

  private finish(m: Match, winner: -1 | 0 | 1, now: number) {
    m.overAt = now;
    m.winner = winner;
    for (const p of m.fighters) {
      p.pvpShieldUntil = now + MATCH_END_MS + 1000; // the fight is over
      p.attacking = false;
      p.pvpTarget = null;
      p.selfDirty = true;
    }
    if (m.mode === 'ranked') {
      const [a, b] = [...m.fighters].sort((x, y) => m.side.get(x.id)! - m.side.get(y.id)!);
      if (winner >= 0 && a && b) this.payRanked(winner === 0 ? a : b, winner === 0 ? b : a, false);
      else for (const p of m.fighters) this.w.send(p, { t: 'sys', text: 'The rated duel ended in a draw.' });
    } else {
      for (const p of m.fighters) {
        const side = m.side.get(p.id)!, won = side === winner;
        this.pvp.bump(p, won ? { honor: BG.winHonor, bg_won: 1 } : { honor: BG.loseHonor, bg_lost: 1 });
        if (won) {
          p.gold += BG.winGold;
          p.invDirty = true;
          this.w.syncInv(p);
        }
        this.w.journals.add(p, 'pvp');
        this.w.send(p, { t: 'sys', text: winner < 0 ? `The Shrine Clash ended in a draw, ${m.score[side]} to ${m.score[1 - side]}: +${BG.loseHonor} honour.` : won ? `Victory in the Shrine Clash, ${m.score[side]} to ${m.score[1 - side]}: +${BG.winHonor} honour, +${BG.winGold} gold.` : `Defeat in the Shrine Clash, ${m.score[side]} to ${m.score[1 - side]}: +${BG.loseHonor} honour.`, cue: 'pvp' });
      }
    }
    this.broadcast(m, now);
  }
  private payRanked(win: Player, lose: Player, forfeit: boolean) {
    const delta = ratingDelta(this.pvp.rating.get(win.id) ?? 1000, this.pvp.rating.get(lose.id) ?? 1000);
    this.pvp.bump(win, { duels_won: 1, rating: delta, honor: RANKED.winHonor });
    this.pvp.bump(lose, { duels_lost: 1, rating: -delta, honor: forfeit ? 0 : RANKED.loseHonor });
    this.w.journals.add(win, 'duel');
    this.w.send(win, { t: 'sys', text: `You won the rated duel against ${lose.name}${forfeit ? ' (they left)' : ''}: rating +${delta}, +${RANKED.winHonor} honour.`, cue: 'pvp' });
    this.w.send(lose, { t: 'sys', text: forfeit ? `You left the rated duel and lost it: rating -${delta}.` : `You lost the rated duel against ${win.name}: rating -${delta}, +${RANKED.loseHonor} honour.` });
  }

  /** A fighter is taken out of a match (left, or gone): a rated duel is lost by whoever leaves first. */
  private drop(m: Match, p: Player, now: number, home: boolean) {
    if (!m.fighters.delete(p)) return;
    this.of.delete(p.id);
    m.away.delete(p.id);
    if (!m.overAt) {
      if (m.mode === 'ranked') {
        const other = [...m.fighters][0];
        m.overAt = now;
        m.winner = (1 - m.side.get(p.id)!) as 0 | 1;
        if (other) this.payRanked(other, p, true);
        this.broadcast(m, now);
      } else {
        this.w.send(p, { t: 'sys', text: 'You left the Shrine Clash before the end: no reward.' });
        if (![...m.fighters].some((x) => m.side.get(x.id) === m.side.get(p.id))) this.finish(m, (1 - m.side.get(p.id)!) as 0 | 1, now);
      }
    }
    this.w.send(p, { t: 'match', v: null });
    if (home) this.sendHome(p);
  }
  /** The player asked to leave (or was away too long). */
  leave(p: Player): string {
    const m = this.of.get(p.id);
    if (!m) return 'You are not in a match';
    this.drop(m, p, Date.now(), true);
    return '';
  }
  private sendHome(p: Player) {
    if (p.dead) {
      // back on their feet before they go
      p.deadTick = -1e9;
      this.w.requestRespawn(p);
    }
    clearStatuses(p);
    p.sver++;
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : { zone: 'eldoria', x: tileCenter(ZONES.eldoria.spawn.tx), y: tileCenter(ZONES.eldoria.spawn.ty) };
    p.ret = null;
    p.pvpShieldUntil = 0;
    this.w.relocate(p, this.w.roomIn(ret.zone, p), ret.x, ret.y);
  }
  private close(m: Match) {
    for (const p of [...m.fighters]) {
      m.fighters.delete(p);
      this.of.delete(p.id);
      this.w.send(p, { t: 'match', v: null });
      if (p.room === m.room) this.sendHome(p);
    }
    this.matches.delete(m);
    this.rooms.delete(m.room);
    this.w.dropRoom(m.room);
  }
}
