// The adventurer's journal: achievements and titles, the monster codex, daily and weekly missions
// and login rewards. Pure rules shared by server (authority) and client (display). Everything is
// counted from events the server resolved itself; the client only shows the journal it is sent.
import { expToNext } from './combat';
import type { ItemSpec } from './items';
import type { Stats } from './jobs';
import { MONSTERS, SPAWNS, WORLD_BOSSES } from './monsters';
import { REGIONS, ZONES } from './world';

// ---------------------------------------------------------------------------------------------
// Counters: what the journal counts
// ---------------------------------------------------------------------------------------------
import { SHOP_ONCE } from './items';
export const COUNTERS = ['kill', 'elite', 'boss', 'wboss', 'dungeon', 'armageddon', 'quest', 'gather', 'pvp', 'duel', 'level', 'arm', 'sigil', 'login', 'codex', 'mission', 'gold'] as const;
export type Counter = (typeof COUNTERS)[number];
/** Counters that hold the best value reached instead of a running total. */
export const MAX_COUNTERS: Counter[] = ['level', 'arm', 'codex'];

// ---------------------------------------------------------------------------------------------
// Achievements and titles
// ---------------------------------------------------------------------------------------------
export type Bonus = Partial<Record<'atk' | 'matk' | 'maxHp' | 'def' | 'mdef' | 'crit' | 'critDmg' | 'healPower' | 'moveMul' | 'lifesteal' | 'dodge', number>>;
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  counter: Counter;
  n: number;
  /** A title the achievement unlocks, and what wearing it gives (percent, or points for crit/dodge/lifesteal). */
  title?: { name: string; bonus: Bonus };
}
const A = (id: string, name: string, desc: string, counter: Counter, n: number, title?: string, bonus: Bonus = {}): Achievement => ({ id, name, desc, counter, n, ...(title ? { title: { name: title, bonus } } : {}) });
export const ACHIEVEMENTS: Achievement[] = [
  A('kill_100', 'First Blood', 'Defeat 100 monsters.', 'kill', 100),
  A('kill_1k', 'Monster Hunter', 'Defeat 1,000 monsters.', 'kill', 1000, 'the Hunter', { atk: 1, matk: 1 }),
  A('kill_10k', 'Scourge of the Wilds', 'Defeat 10,000 monsters.', 'kill', 10000, 'the Scourge', { atk: 2, matk: 2 }),
  A('kill_100k', 'Legend of the Hunt', 'Defeat 100,000 monsters.', 'kill', 100000, 'the Unending', { atk: 3, matk: 3, crit: 1 }),
  A('elite_10', 'Elite Slayer', 'Defeat 10 elite monsters.', 'elite', 10),
  A('elite_200', 'Bane of Champions', 'Defeat 200 elite monsters.', 'elite', 200, 'Championbane', { critDmg: 3 }),
  A('boss_1', 'Bossfall', 'Defeat a dungeon boss.', 'boss', 1),
  A('boss_50', 'Dungeon Delver', 'Defeat 50 dungeon bosses.', 'boss', 50, 'the Delver', { maxHp: 2, def: 2 }),
  A('boss_500', 'Tyrant Breaker', 'Defeat 500 dungeon bosses.', 'boss', 500, 'Tyrantbreaker', { atk: 3, matk: 3, maxHp: 3 }),
  A('wboss_1', 'Giant Killer', 'Help defeat a world boss.', 'wboss', 1, 'Giantkiller', { maxHp: 1 }),
  A('wboss_50', 'Doom of Worlds', 'Help defeat 50 world bosses.', 'wboss', 50, 'Worldsbane', { atk: 2, matk: 2, def: 2 }),
  A('dungeon_10', 'Into the Dark', 'Clear 10 dungeons.', 'dungeon', 10),
  A('dungeon_100', 'Master of the Deep', 'Clear 100 dungeons.', 'dungeon', 100, 'of the Deep', { mdef: 3, def: 1 }),
  A('arma_1', 'Armageddon', 'Clear a dungeon on Armageddon.', 'armageddon', 1, 'Armageddon-Touched', { maxHp: 2 }),
  A('arma_50', 'End of Days', 'Clear 50 dungeons on Armageddon.', 'armageddon', 50, 'the Apocalypse', { atk: 4, matk: 4 }),
  A('quest_25', 'Helping Hand', 'Complete 25 quests.', 'quest', 25, 'the Helpful', { healPower: 2 }),
  A('quest_200', 'Hero of the Realm', 'Complete 200 quests.', 'quest', 200, 'Hero of the Realm', { maxHp: 2, atk: 1, matk: 1 }),
  A('gather_100', 'Gatherer', 'Gather 100 resources.', 'gather', 100, 'the Forager', { moveMul: 1 }),
  A('pvp_10', 'Blooded', 'Defeat 10 players in open combat.', 'pvp', 10, 'the Blooded', { crit: 1 }),
  A('pvp_500', 'Warlord', 'Defeat 500 players in open combat.', 'pvp', 500, 'Warlord', { atk: 3, matk: 3, crit: 2 }),
  A('duel_25', 'Duelist', 'Win 25 duels.', 'duel', 25, 'the Duelist', { dodge: 1 }),
  A('level_30', 'Seasoned', 'Reach level 30.', 'level', 30),
  A('level_60', 'Veteran', 'Reach level 60.', 'level', 60, 'the Veteran', { maxHp: 1 }),
  A('level_100', 'Centurion', 'Reach level 100.', 'level', 100, 'Centurion', { maxHp: 2, def: 1 }),
  A('level_150', 'Paragon', 'Reach level 150.', 'level', 150, 'Paragon', { atk: 2, matk: 2, maxHp: 2 }),
  A('level_200', 'Ascendant', 'Reach level 200.', 'level', 200, 'the Ascendant', { atk: 4, matk: 4, maxHp: 4, def: 2 }),
  A('arm_6', 'Tempered', 'Enhance an armament to +6.', 'arm', 6),
  A('arm_12', 'Forged in Blue', 'Enhance an armament to +12.', 'arm', 12, 'the Tempered', { def: 2 }),
  A('arm_18', 'Ember-Forged', 'Enhance an armament to +18.', 'arm', 18, 'Emberforged', { atk: 3, matk: 3 }),
  A('arm_20', 'Perfection', 'Enhance an armament to +20.', 'arm', 20, 'the Flawless', { atk: 4, matk: 4, critDmg: 5 }),
  A('sigil_1', 'Sigil Bearer', 'Find a sigil.', 'sigil', 1),
  A('sigil_30', 'Keeper of Sigils', 'Find 30 sigils.', 'sigil', 30, 'Sigilkeeper', { mdef: 3 }),
  A('codex_1', 'Naturalist', 'Complete the codex of one region.', 'codex', 1, 'the Naturalist', { def: 1 }),
  A('codex_8', 'Bestiarist', 'Complete the codex of eight regions.', 'codex', 8, 'the Bestiarist', { atk: 2, matk: 2 }),
  A('codex_16', 'Keeper of All Names', 'Complete the codex of every region.', 'codex', 16, 'Keeper of Names', { atk: 3, matk: 3, maxHp: 3 }),
  A('login_7', 'Regular', 'Log in on 7 days.', 'login', 7),
  A('login_60', 'Devoted', 'Log in on 60 days.', 'login', 60, 'the Devoted', { maxHp: 2 }),
  A('mission_30', 'Dutiful', 'Complete 30 daily or weekly missions.', 'mission', 30, 'the Dutiful', { healPower: 2, maxHp: 1 }),
];
export const ACHIEVEMENT_INDEX: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const TITLES = ACHIEVEMENTS.filter((a) => a.title);

// ---------------------------------------------------------------------------------------------
// Codex: a card for every monster, region sets with a permanent bonus
// ---------------------------------------------------------------------------------------------
/** Kills needed for a monster's card: ordinary 100, elite 10, bosses 1. */
export const codexNeed = (id: string) => (MONSTERS[id]?.boss ? 1 : MONSTERS[id]?.elite ? 10 : 100);
/** Which monsters make a region's set: its camps and its world boss. */
export const CODEX_SETS: Record<string, string[]> = Object.fromEntries(REGIONS.map((z) => [z, [...new Set([...(SPAWNS[z] ?? []).map((g) => g.type), ...WORLD_BOSSES.filter((b) => b.zone === z).map((b) => b.type)])]]));
/** The permanent bonus of each completed region set, by region order (percent, points for crit). */
const CODEX_CYCLE: Bonus[] = [{ maxHp: 1 }, { atk: 1, matk: 1 }, { def: 1 }, { mdef: 1 }, { crit: 0.5 }, { critDmg: 2 }, { healPower: 1 }, { maxHp: 1, def: 1 }];
export const CODEX_BONUS: Record<string, Bonus> = Object.fromEntries(REGIONS.map((z, i) => [z, CODEX_CYCLE[i % CODEX_CYCLE.length]]));
export const codexCard = (kills: Record<string, number>, id: string) => (kills[id] ?? 0) >= codexNeed(id);
export const codexComplete = (kills: Record<string, number>, zone: string) => CODEX_SETS[zone].every((id) => codexCard(kills, id));

// ---------------------------------------------------------------------------------------------
// Missions: three daily and three weekly, the same for everyone on a given day or week
// ---------------------------------------------------------------------------------------------
export type MissionKind = 'kill' | 'elite' | 'dungeon' | 'gather' | 'quest' | 'wboss' | 'boss';
export interface MissionDef {
  id: string;
  kind: MissionKind;
  n: number;
  name: string;
}
export const DAILY_POOL: MissionDef[] = [
  { id: 'd_kill', kind: 'kill', n: 150, name: 'Defeat 150 monsters' }, { id: 'd_kill2', kind: 'kill', n: 300, name: 'Defeat 300 monsters' },
  { id: 'd_elite', kind: 'elite', n: 3, name: 'Defeat 3 elite monsters' }, { id: 'd_dungeon', kind: 'dungeon', n: 1, name: 'Clear a dungeon' },
  { id: 'd_gather', kind: 'gather', n: 8, name: 'Gather 8 resources' }, { id: 'd_quest', kind: 'quest', n: 2, name: 'Complete 2 quests' },
  { id: 'd_boss', kind: 'boss', n: 2, name: 'Defeat 2 dungeon bosses' },
];
export const WEEKLY_POOL: MissionDef[] = [
  { id: 'w_kill', kind: 'kill', n: 2000, name: 'Defeat 2,000 monsters' }, { id: 'w_elite', kind: 'elite', n: 25, name: 'Defeat 25 elite monsters' },
  { id: 'w_dungeon', kind: 'dungeon', n: 8, name: 'Clear 8 dungeons' }, { id: 'w_wboss', kind: 'wboss', n: 1, name: 'Help defeat a world boss' },
  { id: 'w_quest', kind: 'quest', n: 10, name: 'Complete 10 quests' }, { id: 'w_gather', kind: 'gather', n: 50, name: 'Gather 50 resources' },
];
export const MISSIONS: Record<string, MissionDef> = Object.fromEntries([...DAILY_POOL, ...WEEKLY_POOL].map((m) => [m.id, m]));
export const MISSIONS_PER_PERIOD = 3;
export const DAY_MS = 86_400_000;
export const dayOf = (ms: number) => Math.floor(ms / DAY_MS);
/** Weeks start on Monday (UTC). */
export const weekOf = (ms: number) => Math.floor((dayOf(ms) + 3) / 7);
function pick(pool: MissionDef[], seed: number): string[] {
  let a = (seed * 2654435761) >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const left = [...pool], out: string[] = [];
  while (out.length < MISSIONS_PER_PERIOD && left.length) out.push(left.splice(Math.floor(rnd() * left.length), 1)[0].id);
  return out;
}
export const dailyMissions = (day: number) => pick(DAILY_POOL, day * 7 + 1);
export const weeklyMissions = (week: number) => pick(WEEKLY_POOL, week * 13 + 5);
const spec = (base: string, qty: number): ItemSpec => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty });
/** A mission's reward at the character's level: gold, experience and materials. */
export function missionReward(kind: 'daily' | 'weekly', level: number): { gold: number; exp: number; items: ItemSpec[] } {
  const w = kind === 'weekly';
  const items = [spec('upgrade_stone', w ? 6 : 2), ...(level >= 30 ? [spec('arm_shard', w ? 3 : 1)] : []), ...(w && level >= 60 ? [spec('arm_core', 1)] : []), ...(w ? [spec('scroll_advanced', 1)] : [])];
  return { gold: Math.round((w ? 400 : 80) * level), exp: Math.round(expToNext(level) * (w ? 0.5 : 0.12)), items };
}

// ---------------------------------------------------------------------------------------------
// Login rewards: a seven-day cycle; missing a day starts it again
// ---------------------------------------------------------------------------------------------
export const LOGIN_REWARDS: { gold: number; items: [string, number][] }[] = [
  { gold: 300, items: [['hp_potion', 5]] }, { gold: 500, items: [['mana_potion', 5]] }, { gold: 800, items: [['upgrade_stone', 3]] },
  { gold: 1000, items: [['scroll_random', 1]] }, { gold: 1500, items: [['arm_shard', 2]] }, { gold: 2500, items: [['upgrade_stone', 6]] },
  { gold: 5000, items: [['scroll_advanced', 1], ['arm_core', 1]] },
];
/** Gold of a login reward grows with the character's level. */
export const loginGold = (day: number, level: number) => Math.round(LOGIN_REWARDS[day].gold * (1 + level / 20));

// ---------------------------------------------------------------------------------------------
// The stored journal
// ---------------------------------------------------------------------------------------------
export interface Period {
  /** Day or week number this period belongs to. */
  at: number;
  /** Mission ids, progress and whether the reward was taken. */
  m: [id: string, progress: number, claimed: boolean][];
}
export interface Journal {
  c: Partial<Record<Counter, number>>;
  /** Kills per monster type (codex). */
  k: Record<string, number>;
  /** Achievements earned. */
  a: string[];
  /** Title worn ('' none). */
  ti: string;
  d: Period;
  w: Period;
  /** Login: the last day seen, the current streak (1-7) and whether today's reward was taken. */
  l: { day: number; streak: number; claimed: boolean };
  /** Shops: once-only purchases made (keys of SHOP_ONCE) and the day the daily stones were last taken. */
  s: { b: string[]; sd: number };
}
export const emptyJournal = (): Journal => ({ c: {}, k: {}, a: [], ti: '', d: { at: -1, m: [] }, w: { at: -1, m: [] }, l: { day: -1, streak: 0, claimed: true }, s: { b: [], sd: -1 } });
const int = (v: unknown, lo: number, hi: number, d = 0) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
function cleanPeriod(raw: any, pool: Record<string, MissionDef>): Period {
  const at = int(raw?.at, -1, 1e7, -1);
  const m = Array.isArray(raw?.m) ? raw.m.filter((x: any) => Array.isArray(x) && pool[x[0]]).slice(0, MISSIONS_PER_PERIOD).map((x: any) => [x[0], Number.isInteger(x[1]) ? Math.max(0, Math.min(pool[x[0]].n, x[1])) : 0, x[2] === true] as [string, number, boolean]) : [];
  return { at, m };
}
/** Validates a stored journal: unknown entries are dropped, numbers bounded. */
export function cleanJournal(raw: unknown): Journal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, j = emptyJournal();
  for (const c of COUNTERS) {
    const v = r.c?.[c];
    if (Number.isInteger(v) && v > 0) j.c[c] = Math.min(v, 1e12);
  }
  for (const [id, v] of Object.entries(r.k ?? {})) if (MONSTERS[id] && Number.isInteger(v) && (v as number) > 0) j.k[id] = Math.min(v as number, 1e9);
  j.a = Array.isArray(r.a) ? [...new Set<string>(r.a.filter((x: unknown): x is string => typeof x === 'string' && !!ACHIEVEMENT_INDEX[x]))] : [];
  j.ti = typeof r.ti === 'string' && j.a.includes(r.ti) && ACHIEVEMENT_INDEX[r.ti].title ? r.ti : '';
  const daily = Object.fromEntries(DAILY_POOL.map((m) => [m.id, m])), weekly = Object.fromEntries(WEEKLY_POOL.map((m) => [m.id, m]));
  j.d = cleanPeriod(r.d, daily);
  j.w = cleanPeriod(r.w, weekly);
  j.l = { day: int(r.l?.day, -1, 1e7, -1), streak: int(r.l?.streak, 0, 7, 0), claimed: r.l?.claimed !== false };
  const once = new Set(Object.values(SHOP_ONCE));
  j.s = { b: Array.isArray(r.s?.b) ? [...new Set<string>(r.s.b.filter((x: unknown): x is string => typeof x === 'string' && once.has(x)))] : [], sd: int(r.s?.sd, -1, 1e7, -1) };
  return j;
}
/** Brings the missions and the login streak up to the current day and week. Returns true if anything changed. */
export function rollJournal(j: Journal, now: number): boolean {
  const day = dayOf(now), week = weekOf(now);
  let changed = false;
  if (j.d.at !== day) {
    j.d = { at: day, m: dailyMissions(day).map((id) => [id, 0, false]) };
    changed = true;
  }
  if (j.w.at !== week) {
    j.w = { at: week, m: weeklyMissions(week).map((id) => [id, 0, false]) };
    changed = true;
  }
  if (j.l.day !== day) {
    // the next day of the cycle if yesterday was a login day, else the cycle starts again
    j.l = { day, streak: j.l.day === day - 1 ? (j.l.streak % 7) + 1 : 1, claimed: false };
    j.c.login = (j.c.login ?? 0) + 1;
    changed = true;
  }
  return changed;
}
/** Achievements a journal has reached but not yet recorded. */
export const newAchievements = (j: Journal): Achievement[] => ACHIEVEMENTS.filter((a) => !j.a.includes(a.id) && (j.c[a.counter] ?? 0) >= a.n);
/** Completed codex region sets. */
export const completedSets = (j: Journal) => REGIONS.filter((z) => codexComplete(j.k, z));

/** Every lasting bonus of the journal: the title worn, and each completed codex set. */
export function journalBonus(j: Journal): Bonus {
  const out: Bonus = {};
  const add = (b: Bonus) => {
    for (const [k, v] of Object.entries(b)) out[k as keyof Bonus] = Math.round(((out[k as keyof Bonus] ?? 0) + v!) * 100) / 100;
  };
  if (j.ti && ACHIEVEMENT_INDEX[j.ti]?.title) add(ACHIEVEMENT_INDEX[j.ti].title!.bonus);
  for (const z of completedSets(j)) add(CODEX_BONUS[z]);
  return out;
}
/** Applies the journal's bonus to a stat block (percentages; crit, dodge and lifesteal in points). */
export function applyJournal(s: Stats, j: Journal | null | undefined) {
  if (!j) return;
  const b = journalBonus(j);
  for (const k of ['atk', 'matk', 'maxHp', 'def', 'mdef'] as const) if (b[k]) s[k] = Math.round(s[k] * (1 + b[k]! / 100));
  if (b.healPower) s.healPower = Math.round(s.healPower * (1 + b.healPower / 100) * 100) / 100;
  if (b.moveMul) s.moveMul = Math.round(s.moveMul * (1 + b.moveMul / 100) * 1000) / 1000;
  if (b.critDmg) s.critDmg = Math.round((s.critDmg + b.critDmg / 100) * 100) / 100;
  if (b.crit) s.crit = Math.min(75, Math.round((s.crit + b.crit) * 10) / 10);
  if (b.dodge) s.dodge = Math.min(40, Math.round((s.dodge + b.dodge) * 10) / 10);
  if (b.lifesteal) s.lifesteal = Math.round((s.lifesteal + b.lifesteal) * 10) / 10;
}
/** The region a monster type belongs to in the codex (its first region set). */
export const codexRegionOf = (id: string) => REGIONS.find((z) => CODEX_SETS[z].includes(id));
export const regionName = (z: string) => ZONES[z]?.name ?? z;
