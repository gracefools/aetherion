// G9 social: world and looking-for-group chat, the dungeon finder and weekly guild goals.
// Pure rules and data, shared by the server and the client.

// ---------- chat ----------
/** World and LFG chat reach every player online; each player may speak there this often. */
export const WORLD_CHAT_MS = 8000;
export const LFG_CHAT_MS = 5000;

// ---------- the dungeon finder ----------
/** A group forms as soon as this many are waiting for the same dungeon and difficulty... */
export const FINDER_FULL = 4;
/** ...or with two or more once the first of them has waited this long. */
export const FINDER_WAIT_MS = 20_000;
export const FINDER_LEVEL = 10;
export interface FinderState {
  /** What this player is queued for, and since when (server ms). */
  q: { dungeon: string; diff: string; since: number } | null;
  /** How many are waiting, by "dungeon:difficulty". */
  counts: Record<string, number>;
}

// ---------- weekly guild goals ----------
export type GoalKind = 'kills' | 'dungeons' | 'quests' | 'bosses';
export interface GoalDef {
  id: string;
  kind: GoalKind;
  n: number;
  text: string;
}
export const GOAL_POOL: GoalDef[] = [
  { id: 'hunt_1', kind: 'kills', n: 1500, text: 'Defeat 1,500 monsters together' },
  { id: 'hunt_2', kind: 'kills', n: 4000, text: 'Defeat 4,000 monsters together' },
  { id: 'delve_1', kind: 'dungeons', n: 15, text: 'Clear 15 dungeons' },
  { id: 'delve_2', kind: 'dungeons', n: 40, text: 'Clear 40 dungeons' },
  { id: 'lore_1', kind: 'quests', n: 30, text: 'Complete 30 quests' },
  { id: 'lore_2', kind: 'quests', n: 80, text: 'Complete 80 quests' },
  { id: 'slay_1', kind: 'bosses', n: 10, text: 'Defeat 10 bosses' },
  { id: 'slay_2', kind: 'bosses', n: 30, text: 'Defeat 30 bosses' },
];
export const GOALS_PER_WEEK = 3;
const WEEK_MS = 7 * 86_400_000;
export const weekOf = (now: number) => Math.floor(now / WEEK_MS);
/** The week's goals for a guild: three from the pool, different kinds where possible, chosen by guild and week. */
export function weeklyGoals(guildId: number, week: number): GoalDef[] {
  const kinds: GoalKind[] = ['kills', 'dungeons', 'quests', 'bosses'];
  let h = (guildId * 2654435761 + week * 40503) >>> 0;
  const next = () => ((h = (h * 1103515245 + 12345) >>> 0) >>> 8);
  const pick = [...kinds].sort(() => (next() & 1) - 0.5).slice(0, GOALS_PER_WEEK);
  return pick.map((k) => {
    const opts = GOAL_POOL.filter((g) => g.kind === k);
    return opts[next() % opts.length];
  });
}
/** What a completed goal gives: guild experience, and gold and upgrade stones to every member online. */
export const GOAL_REWARD = { guildExp: 600, gold: 2500, stones: 2 };
export interface GuildGoals {
  week: number;
  /** Progress per goal, in the order of weeklyGoals. */
  p: number[];
}
export const emptyGoals = (week: number): GuildGoals => ({ week, p: Array.from({ length: GOALS_PER_WEEK }, () => 0) });
export function cleanGoals(raw: unknown, week: number): GuildGoals {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  if (r.week !== week || !Array.isArray(r.p)) return emptyGoals(week);
  return { week, p: Array.from({ length: GOALS_PER_WEEK }, (_, i) => (Number.isInteger(r.p[i]) && r.p[i] > 0 ? Math.min(1e6, r.p[i]) : 0)) };
}
