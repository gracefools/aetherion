// G7: seasonal ladders. A season is a calendar month (UTC). Four ladders rank what characters did
// this season; when it ends the top ten of each are rewarded by mail. (G8 added the rated-match ladder.)
export type LadderId = 'rift' | 'honor' | 'raid' | 'dungeon' | 'rated';
export interface LadderDef {
  id: LadderId;
  name: string;
  score: string;
  /** 'max' keeps the best result, 'add' sums them. */
  mode: 'max' | 'add';
}
export const LADDERS: LadderDef[] = [
  { id: 'rift', name: 'Endless Rift', score: 'Highest floor', mode: 'max' },
  { id: 'honor', name: 'Arena and Depths', score: 'Honour earned', mode: 'add' },
  { id: 'raid', name: 'Raids', score: 'Raid bosses defeated', mode: 'add' },
  { id: 'dungeon', name: 'Dungeons', score: 'Dungeons cleared on Hard or above', mode: 'add' },
  { id: 'rated', name: 'Rated matches', score: 'Rated duels and 2v2s won', mode: 'add' },
];
export const LADDER_TOP = 20;
/** The season a moment belongs to: "2026-11". */
export function seasonOf(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** The season before this one. */
export function seasonBefore(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** When a season ends (ms). */
export function seasonEndsAt(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
/** What each rank receives when a season closes: gold, and for the top three a rare rune scroll. */
export function ladderReward(rank: number): { gold: number; items: [string, number][] } | null {
  if (rank > 10) return null;
  const gold = rank === 1 ? 100_000 : rank === 2 ? 60_000 : rank === 3 ? 40_000 : 15_000;
  return { gold, items: rank <= 3 ? [['scroll_rare', 1]] : [] };
}
export interface LadderRow { id: number; name: string; job: string; score: number }
