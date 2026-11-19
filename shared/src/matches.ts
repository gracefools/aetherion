// G8: matchmaking. Two queues the Arena Master keeps: rated duels (one against one, matched by
// rating) and the Shrine Clash battleground (two teams, balanced by rating, fighting over a shrine).
// The rules here are pure so the server and the tests share them; the server runs the matches.
import { CHAMBERS, BOSS_ROOM, DUNGEON_MID } from './world';

export type MatchMode = 'ranked' | 'ranked2' | 'bg';
export const MATCH_MODES: MatchMode[] = ['ranked', 'ranked2', 'bg'];
/** Rated matches (one against one, two against two): rating changes, and the fallen stay down. */
export const isRated = (m: MatchMode) => m === 'ranked' || m === 'ranked2';

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

/** How far apart in level two sides may be after waiting this long; after three minutes, any gap (a quiet server still finds matches). */
export const levelWindow = (waitMs: number) => (waitMs >= 180_000 ? Infinity : 10 + 10 * Math.floor(Math.max(0, waitMs) / 20_000));

/** One player in line; `group` (a party) goes in together, on the same team. */
export interface QueueEntry { id: number; rating: number; since: number; group?: number; level?: number }
/** Whether two sides are close enough in (average) level for everyone's wait. */
function levelsFit(a: QueueEntry[], b: QueueEntry[], now: number) {
  const avg = (s: QueueEntry[]) => s.reduce((t, e) => t + (e.level ?? 1), 0) / Math.max(1, s.length);
  return Math.abs(avg(a) - avg(b)) <= Math.min(...[...a, ...b].map((e) => levelWindow(now - e.since)));
}

/** Pairs rated-duel players: closest ratings first, within both players' windows. Returns id pairs. */
export function pairRanked(q: QueueEntry[], now: number): [number, number][] {
  const s = [...q].sort((a, b) => a.rating - b.rating || a.since - b.since), out: [number, number][] = [];
  for (let i = 0; i + 1 < s.length; ) {
    const a = s[i], b = s[i + 1], gap = Math.abs(a.rating - b.rating);
    if (gap <= Math.min(ratingWindow(now - a.since), ratingWindow(now - b.since)) && levelsFit([a], [b], now)) {
      out.push([a.id, b.id]);
      i += 2;
    } else i++;
  }
  return out;
}

interface Group { ids: number[]; rating: number; since: number }
/** Queue entries gathered into the groups that go in together: a party, or one player alone. Earliest in line first. */
function groupsOf(q: QueueEntry[]): Group[] {
  const by = new Map<number, Group>();
  for (const e of q) {
    const key = e.group ? e.group : -e.id - 1, g = by.get(key);
    if (g) {
      g.ids.push(e.id);
      g.rating += e.rating;
      g.since = Math.min(g.since, e.since);
    } else by.set(key, { ids: [e.id], rating: e.rating, since: e.since });
  }
  return [...by.values()].sort((x, y) => x.since - y.since || x.ids[0] - y.ids[0]);
}
/** The fairest split of whole groups into two teams of exactly k players each that `ok` accepts (null if none). */
function split(gs: Group[], k: number, ok: (t: [number[], number[]]) => boolean = () => true): [number[], number[]] | null {
  let best: [number[], number[]] | null = null, bestGap = Infinity;
  for (let mask = 0; mask < 1 << gs.length; mask++) {
    let n = 0, ra = 0, rb = 0;
    gs.forEach((g, i) => (mask & (1 << i) ? ((n += g.ids.length), (ra += g.rating)) : (rb += g.rating)));
    if (n !== k || !(mask & 1)) continue; // the first group always on the first team: each split is counted once
    if (Math.abs(ra - rb) >= bestGap) continue;
    const t: [number[], number[]] = [gs.filter((_, i) => mask & (1 << i)).flatMap((g) => g.ids), gs.filter((_, i) => !(mask & (1 << i))).flatMap((g) => g.ids)];
    if (!ok(t)) continue;
    bestGap = Math.abs(ra - rb);
    best = t;
  }
  return best;
}
/** The earliest groups in line whose players make up two teams of k (null if they cannot). */
function choose(gs: Group[], k: number, ok: (t: [number[], number[]]) => boolean = () => true): [number[], number[]] | null {
  const pick: Group[] = [];
  const go = (i: number, n: number): [number[], number[]] | null => {
    if (n === 2 * k) {
      return split(pick, k, ok);
    }
    if (i >= gs.length) return null;
    if (gs[i].ids.length <= k && n + gs[i].ids.length <= 2 * k) {
      pick.push(gs[i]);
      const r = go(i + 1, n + gs[i].ids.length);
      pick.pop();
      if (r) return r;
    }
    return go(i + 1, n);
  };
  return go(0, 0);
}
/**
 * The next battleground's two teams, if one can start. A party always fights on one team. Full
 * teams start at once; smaller (but equal) ones once the first in line has waited long enough.
 * Teams are balanced by rating; those earliest in line go first.
 */
/**
 * The next rated two-against-two, if one can be made: a party of two is one team, players alone are
 * paired. The two teams' average ratings must be within the rating window of everyone in it.
 */
export function pickRanked2(q: QueueEntry[], now: number): [number[], number[]] | null {
  const by = new Map(q.map((e) => [e.id, e]));
  const avg = (ids: number[]) => ids.reduce((s, id) => s + by.get(id)!.rating, 0) / ids.length;
  return choose(groupsOf(q).filter((g) => g.ids.length <= 2).slice(0, 12), 2, (t) =>
    Math.abs(avg(t[0]) - avg(t[1])) <= Math.min(...[...t[0], ...t[1]].map((id) => ratingWindow(now - by.get(id)!.since))) && levelsFit(t[0].map((id) => by.get(id)!), t[1].map((id) => by.get(id)!), now));
}

export function pickBattleground(q: QueueEntry[], now: number): [number[], number[]] | null {
  const gs = groupsOf(q).slice(0, 12), by = new Map(q.map((e) => [e.id, e]));
  if (!gs.length) return null;
  const fair = (t: [number[], number[]]) => levelsFit(t[0].map((id) => by.get(id)!), t[1].map((id) => by.get(id)!), now);
  for (let k = BG.maxPerTeam; k >= BG.minPerTeam; k--) {
    if (k < BG.maxPerTeam && now - gs[0].since < BG.fillWaitMs) break;
    const t = choose(gs, k, fair);
    if (t) return t;
  }
  return null;
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
