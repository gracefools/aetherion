// G8: matchmaking. Two queues the Arena Master keeps: rated duels (one against one, matched by
// rating) and the Shrine Clash battleground (two teams, balanced by rating, fighting over a shrine).
// The rules here are pure so the server and the tests share them; the server runs the matches.
import { CHAMBERS, BOSS_ROOM, DUNGEON_MID } from './world';

export type MatchMode = 'ranked' | 'bg';
export const MATCH_MODES: MatchMode[] = ['ranked', 'bg'];

/** A rated duel: first to fall loses. */
export const RANKED = {
  countdownMs: 5000,
  maxMs: 180_000,
  winHonor: 20,
  loseHonor: 5,
  /** Tiles from the hall's centre where the two start. */
  apart: 8,
};
/** The Shrine Clash battleground. */
export const BG = {
  minPerTeam: 1,
  maxPerTeam: 3,
  /** With fewer than a full six, the battleground still starts once the first in line has waited this long. */
  fillWaitMs: 45_000,
  countdownMs: 10_000,
  durationMs: 6 * 60_000,
  target: 40,
  killPoints: 2,
  /** The team that alone holds the shrine scores a point this often. */
  holdEveryMs: 5000,
  shrineR: 5,
  respawnMs: 5000,
  winHonor: 60,
  loseHonor: 20,
  winGold: 200,
};
/** Both kinds of match end with everyone sent home after this long. */
export const MATCH_END_MS = 6000;
/** A fighter who is disconnected this long leaves the match (and a rated duel is lost). */
export const MATCH_DROP_MS = 20_000;
export const MATCH_ZONE = 'd_ruins';
/** Battleground places, in tiles: the two team bases and the shrine between them. */
export const BG_BASES = [{ tx: CHAMBERS[0].cx, ty: DUNGEON_MID }, { tx: CHAMBERS[2].cx, ty: DUNGEON_MID }];
export const BG_SHRINE = { tx: CHAMBERS[1].cx, ty: DUNGEON_MID };
/** Rated duels are fought in the great hall. */
export const RANKED_HALL = { tx: CHAMBERS[BOSS_ROOM].cx, ty: DUNGEON_MID };

/** How far apart in rating two players may be matched after waiting this long: it widens with time. */
export const ratingWindow = (waitMs: number) => Math.min(1000, 100 + 50 * Math.floor(Math.max(0, waitMs) / 10_000));

export interface QueueEntry { id: number; rating: number; since: number }

/** Pairs rated-duel players: closest ratings first, within both players' windows. Returns id pairs. */
export function pairRanked(q: QueueEntry[], now: number): [number, number][] {
  const s = [...q].sort((a, b) => a.rating - b.rating || a.since - b.since), out: [number, number][] = [];
  for (let i = 0; i + 1 < s.length; ) {
    const a = s[i], b = s[i + 1], gap = Math.abs(a.rating - b.rating);
    if (gap <= Math.min(ratingWindow(now - a.since), ratingWindow(now - b.since))) {
      out.push([a.id, b.id]);
      i += 2;
    } else i++;
  }
  return out;
}

/**
 * Who goes into the next battleground, if one can start: a full match at once, otherwise as many
 * as are waiting once the first in line has waited long enough. Earliest in line first.
 */
export function pickBattleground(q: QueueEntry[], now: number): QueueEntry[] | null {
  const s = [...q].sort((a, b) => a.since - b.since), full = BG.maxPerTeam * 2;
  if (s.length >= full) return s.slice(0, full);
  if (s.length >= BG.minPerTeam * 2 && now - s[0].since >= BG.fillWaitMs) return s.slice(0, s.length - (s.length % 2));
  return null;
}

/** Splits players into two teams of near-equal strength: best first, in the order A B B A A B... */
export function formTeams(players: QueueEntry[]): [number[], number[]] {
  const s = [...players].sort((a, b) => b.rating - a.rating || a.id - b.id), t: [number[], number[]] = [[], []];
  s.forEach((p, i) => t[i % 4 === 0 || i % 4 === 3 ? 0 : 1].push(p.id));
  return t;
}

/** Which team alone holds the shrine: 0 or 1, or -1 when nobody or both are on it. */
export function shrineHolder(present: [number, number]): -1 | 0 | 1 {
  if (present[0] > 0 && present[1] === 0) return 0;
  if (present[1] > 0 && present[0] === 0) return 1;
  return -1;
}

/** The state of a match as each fighter sees it. */
export interface MatchView {
  mode: MatchMode;
  /** Your team: 0 or 1. */
  side: number;
  teams: { ids: number[]; names: string[]; score: number }[];
  /** Milliseconds until the fight begins, and until it ends (from when this was sent). */
  starts: number;
  ends: number;
  /** Battleground: who holds the shrine (-1 nobody). */
  shrine: number;
  /** Set once the match is over: 'won', 'lost' or 'draw'. */
  result?: string;
}
