// The Endless Rift: a tower of floors without end, solo or with a party. Each floor is one wave in
// the rift's hall, a little stronger than the last; every fifth floor is a boss. A floor not
// cleared in time ends the climb. The highest floor reached goes on the weekly leaderboard.
import { MONSTERS, SPAWNS } from './monsters';
import { REGIONS, ZONES } from './world';

export const RIFT_ID = 'rift';
export const RIFT_ZONE = 'd_rift';
export const RIFT_MIN_LEVEL = 20;
/** Time to clear one floor; the climb ends when it runs out. */
export const RIFT_FLOOR_MS = 120_000;
/** Pause between floors. */
export const RIFT_BREAK_MS = 4000;
export const RIFT_BOSS_EVERY = 5;
export const RIFT_TOP = 20;
/** Monster level on a floor: the climbers' average level, a little lower at first and rising with every floor. */
export const riftLevel = (avgLevel: number, floor: number) => Math.max(1, Math.min(220, Math.round(avgLevel - 4 + floor * 0.8)));
/** Extra strength on top of the level: +5% health and +3% attack per floor. */
export const riftMul = (floor: number) => ({ hp: 1 + 0.05 * (floor - 1), atk: 1 + 0.03 * (floor - 1) });
export const isBossFloor = (floor: number) => floor % RIFT_BOSS_EVERY === 0;
/** Monsters on a floor: more with more climbers and higher floors. */
export const riftCount = (floor: number, players: number) => Math.min(16, 4 + Math.floor(floor / 3) + 2 * Math.max(0, players - 1));

/** Ordinary monsters and bosses to draw from, by level (the region or dungeon nearest the level). */
const ordinary = REGIONS.flatMap((z) => (SPAWNS[z] ?? []).map((g) => g.type)).filter((t, i, a) => a.indexOf(t) === i && !MONSTERS[t].elite && !MONSTERS[t].boss);
const bosses = Object.values(MONSTERS).filter((d) => d.boss && !d.boss.world).map((d) => d.id);
const near = (list: string[], level: number, n: number) => [...list].sort((a, b) => Math.abs(MONSTERS[a].level - level) - Math.abs(MONSTERS[b].level - level)).slice(0, n);
/** The monster types of a floor (deterministic for a floor and level). */
export function riftFloorTypes(floor: number, level: number): string[] {
  if (isBossFloor(floor)) {
    const pool = near(bosses, level, 3);
    return [pool[floor / RIFT_BOSS_EVERY % pool.length]];
  }
  const pool = near(ordinary, level, 6);
  return [pool[floor % pool.length], pool[(floor * 7 + 3) % pool.length]];
}
/** Reward for every climber on clearing a floor. */
export function riftReward(floor: number, level: number): { gold: number; exp: number; items: [string, number][] } {
  const boss = isBossFloor(floor);
  const items: [string, number][] = boss ? [['upgrade_stone', 2 + Math.floor(floor / 10)], ...(floor >= 30 ? [['arm_relic', 1] as [string, number]] : []), ...(level >= 30 ? [['arm_shard', 1 + Math.floor(floor / 15)] as [string, number]] : []), ...(floor >= 20 && level >= 60 ? [['arm_core', 1] as [string, number]] : [])] : [];
  return { gold: Math.round(12 * level * (1 + floor * 0.1) * (boss ? 4 : 1)), exp: Math.round(6 * level ** 1.45 * (1 + floor * 0.06) * (boss ? 4 : 1)), items };
}
export interface RiftScore {
  name: string;
  job: string;
  floor: number;
  /** Seconds the climb took. */
  secs: number;
  party: number;
}
export const riftWeek = (ms: number) => Math.floor((Math.floor(ms / 86_400_000) + 3) / 7);
export const RIFT_NAME = 'The Endless Rift';
export const riftTheme = () => ZONES[RIFT_ZONE]?.theme ?? 'temple';
