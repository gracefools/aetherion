// Life outside combat: gathering professions and crafting gear with chosen sub-stats, a home with
// furniture and a garden, the free season pass, and the wardrobe (how gear looks, weapon glow
// colours). Pure rules shared by server (authority) and client (display).
import { AFFIX, GEAR_STATS, ITEMS, RARITY_SUB_RANGE, type GearStat } from './items';
import type { Job } from './protocol';
import type { Stats } from './jobs';
import { ZONES } from './world';

// ---------------------------------------------------------------------------------------------
// Professions
// ---------------------------------------------------------------------------------------------
export const PROFESSIONS = ['mining', 'herbalism', 'fishing', 'smithing'] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const PROF_MAX = 50;
export const profExpToNext = (lv: number) => Math.round(40 * Math.pow(lv, 1.5));
/**
 * Gathering materials have four tiers, by the level of the region: tier 1 below level 30, then a
 * tier every 30 levels, tier 4 from level 90.
 */
export const TIER_MATS: Record<'mining' | 'herbalism' | 'fishing', [string, string, string, string]> = {
  mining: ['iron_ore', 'mithril_ore', 'star_shard', 'aether_ore'],
  herbalism: ['moonleaf', 'sunpetal', 'frostbloom', 'starlily'],
  fishing: ['river_fish', 'moon_carp', 'star_koi', 'void_eel'],
};
/** The tier of a gathering material (0 for anything else). */
export const MAT_TIER: Record<string, number> = Object.fromEntries(Object.values(TIER_MATS).flatMap((l) => l.map((id, i) => [id, i + 1])));
/** Which profession a gathered material trains. */
export const PROF_OF_RES: Record<string, Profession> = Object.fromEntries(Object.entries(TIER_MATS).flatMap(([p, l]) => l.map((id) => [id, p as Profession])));
export const tierOfLevel = (level: number) => Math.min(4, 1 + Math.floor(Math.max(0, level) / 30));
/** The tier of what is gathered and caught in a region (the Depths count as their own level). */
export const zoneTier = (zone: string) => tierOfLevel(ZONES[zone]?.level[0] ?? 1);
export const matOf = (prof: 'mining' | 'herbalism' | 'fishing', zone: string) => TIER_MATS[prof][zoneTier(zone) - 1];

/** Gathering energy: 200, filled again every day (UTC). Each gathering or catch costs by its tier. */
export const ENERGY_MAX = 200;
export const ENERGY_COST = [0, 5, 10, 15, 20];
export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
/** Energy now (a new day fills it). */
export const energyNow = (l: Life, now: number) => (l.energy.day === dayOf(now) ? l.energy.n : ENERGY_MAX);
/** Spends energy; false (nothing spent) when there is not enough. */
export function spendEnergy(l: Life, n: number, now: number): boolean {
  const have = energyNow(l, now);
  if (have < n) return false;
  l.energy = { n: have - n, day: dayOf(now) };
  return true;
}

/**
 * Herbalism and fishing: every two levels give +2% for a double haul, +1.5% for a triple and
 * +0.5% for a quadruple (at level 50: 50% / 37.5% / 12.5%, never a single one).
 */
export function haulChances(lv: number): { x2: number; x3: number; x4: number } {
  const k = Math.floor(lv / 2);
  return { x2: k * 0.02, x3: k * 0.015, x4: k * 0.005 };
}
export function haulRoll(lv: number, r: number): number {
  const c = haulChances(lv);
  return r < c.x4 ? 4 : r < c.x4 + c.x3 ? 3 : r < c.x4 + c.x3 + c.x2 ? 2 : 1;
}
/** Mining: one more every 15 levels. */
export const extraYield = (lv: number) => Math.floor(lv / 15);
export const FISH_COOLDOWN_MS = 4000;

// ---------------------------------------------------------------------------------------------
// Food: cooked from five herbs and five fish of a tier; eaten for half an hour. Each dish gives its
// own bonus; eating a dish again (any tier) replaces the one before.
// ---------------------------------------------------------------------------------------------
export const FOODS = ['steak', 'soup', 'pie', 'juice', 'drink'] as const;
export type FoodKind = (typeof FOODS)[number];
export const FOOD_MS = 30 * 60_000;
export const FOOD_STAT: Record<FoodKind, { stat: 'atk' | 'matk' | 'maxHp' | 'def' | 'moveMul'; v: [number, number, number, number] }> = {
  steak: { stat: 'atk', v: [30, 90, 180, 360] },
  soup: { stat: 'matk', v: [30, 90, 180, 360] },
  pie: { stat: 'maxHp', v: [300, 900, 1800, 3600] },
  juice: { stat: 'def', v: [20, 60, 120, 240] },
  drink: { stat: 'moveMul', v: [5, 10, 15, 20] }, // percent
};
export const COOK_COST = 5;
export const foodId = (k: FoodKind, tier: number) => `food_${k}_${tier}`;
export const foodOf = (base: string): { kind: FoodKind; tier: number } | null => {
  const m = /^food_([a-z]+)_([1-4])$/.exec(base);
  return m && (FOODS as readonly string[]).includes(m[1]) ? { kind: m[1] as FoodKind, tier: Number(m[2]) } : null;
};
/** What cooking a dish of a tier takes: five of that tier's herb and five of its fish. */
export const cookCost = (tier: number): [string, number][] => [[TIER_MATS.herbalism[tier - 1], COOK_COST], [TIER_MATS.fishing[tier - 1], COOK_COST]];
/** The food bonuses still running, added to the stats. */
export function applyFood(s: Stats, food: Life['food'], now: number) {
  for (const k of FOODS) {
    const f = food[k];
    if (!f || f.until <= now) continue;
    const d = FOOD_STAT[k], v = d.v[f.t - 1];
    if (d.stat === 'moveMul') s.moveMul *= 1 + v / 100;
    else s[d.stat] += v;
  }
}

// ---------------------------------------------------------------------------------------------
// Forging: gear of level 30, 60, 90 or 120 from that tier's ore; the rarity is rolled, better odds
// with smithing. The smith chooses the sub-stats in order; the item takes as many as its rarity has.
// ---------------------------------------------------------------------------------------------
export const FORGE_LEVELS: { ilvl: number; tier: number; ore: number }[] = [
  { ilvl: 30, tier: 1, ore: 40 }, { ilvl: 60, tier: 2, ore: 50 }, { ilvl: 90, tier: 3, ore: 70 }, { ilvl: 120, tier: 4, ore: 100 },
];
/** Rarities a forge can give: normal, rare, epic, legendary, mythic (indexes into RARITIES). */
export const FORGE_RARITIES = [0, 2, 3, 4, 5];
const FORGE_BASE = [35, 25, 20, 15, 5], FORGE_STEP = [-1, -1, -1, 2, 1];
/** The chance (percent, adding up to 100) of each forge rarity at a smithing level: every two levels gained shift the odds up. */
export function forgeRates(smith: number): number[] {
  const k = Math.floor((Math.max(1, smith) - 1) / 2), raw = FORGE_BASE.map((b, i) => Math.max(0, b + FORGE_STEP[i] * k)), sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => Math.round((v / sum) * 1000) / 10);
}
export function rollForge(smith: number, r: number): number {
  const rates = forgeRates(smith);
  let acc = 0;
  for (let i = 0; i < rates.length; i++) if (r * 100 < (acc += rates[i])) return FORGE_RARITIES[i];
  return FORGE_RARITIES[rates.length - 1];
}
export function forgeCost(ilvl: number): { gold: number; mats: [string, number][] } {
  const f = FORGE_LEVELS.find((x) => x.ilvl === ilvl) ?? FORGE_LEVELS[0];
  return { gold: 150 * f.ilvl, mats: [[TIER_MATS.mining[f.tier - 1], f.ore]] };
}
/** Sub-stats a forged item gets: one per rarity tier above common (the smith chooses which, in order). */
export const forgeSlots = (rar: number) => Math.max(1, rar);
/** A crafted sub-stat: the smith's chosen stat, in the top half of its tier's range. */
export function forgedAffix(k: GearStat, ilvl: number, rar: number, rng: () => number): [GearStat, number] {
  const [lo, hi] = RARITY_SUB_RANGE[rar], v = (AFFIX[k][0] + AFFIX[k][1] * ilvl) * (lo + (hi - lo) * (0.5 + 0.5 * rng()));
  return [k, k === 'crit' || k === 'dodge' || k === 'lifesteal' ? Math.round(v * 10) / 10 : k === 'critDmg' || k === 'healPower' ? Math.round(v * 100) / 100 : Math.round(v)];
}
export const FORGEABLE = (job: Job) => Object.values(ITEMS).filter((b) => b.kind === 'equip' && !b.unique && (b.job ? b.job === job : !b.jobs || b.jobs.includes(job))).map((b) => b.id);
export { GEAR_STATS };

// ---------------------------------------------------------------------------------------------
// Housing: a home of one's own, furniture, a garden
// ---------------------------------------------------------------------------------------------
export const HOME_ZONE = 'h_home';
export const HOME_W = 26, HOME_H = 18;
/** Floor tiles where furniture can stand (inside the walls, clear of the door). */
export const HOME_SLOTS = { x0: 3, y0: 3, x1: HOME_W - 4, y1: HOME_H - 4 };
export const FURNITURE_MAX = 30;
export const GARDEN_PLOTS = 3;
/** A seed grows in two hours of real time. */
export const GROW_MS = 2 * 60 * 60_000;
export const SEEDS: Record<string, { name: string; yields: [string, number] }> = {
  moonleaf_seed: { name: 'Moonleaf Seed', yields: ['moonleaf', 6] },
  sunpetal_seed: { name: 'Sunpetal Seed', yields: ['sunpetal', 2] },
  ore_spore: { name: 'Ore Spore', yields: ['iron_ore', 6] },
};
export const FURNITURE: Record<string, { name: string; glyph: string; price: number; bed?: boolean }> = {
  furn_bed: { name: 'Feather Bed', glyph: '🛏', price: 3000, bed: true },
  furn_table: { name: 'Oak Table', glyph: '🪵', price: 800 },
  furn_chair: { name: 'Carved Chair', glyph: '🪑', price: 400 },
  furn_lamp: { name: 'Star Lamp', glyph: '🪔', price: 1200 },
  furn_banner: { name: 'House Banner', glyph: '🚩', price: 1500 },
  furn_plant: { name: 'Potted Fern', glyph: '🪴', price: 600 },
  furn_trophy: { name: 'Boss Trophy', glyph: '🏆', price: 25000 },
  furn_chest: { name: 'Treasure Chest', glyph: '🧰', price: 2000 },
};
/** Sleeping in one's own bed once a day: rested for half an hour. */
export const REST_MS = 30 * 60_000;
export const REST_EVERY_MS = 20 * 60 * 60_000;

// ---------------------------------------------------------------------------------------------
// The season pass (free): 30 levels a season, earned by playing
// ---------------------------------------------------------------------------------------------
export const SEASON_MS = 42 * 86_400_000; // six weeks
export const SEASON_LEVELS = 30;
export const SEASON_XP = 1000; // per level
export const seasonOf = (ms: number) => Math.floor(ms / SEASON_MS) + 1;
export const seasonEnds = (ms: number) => seasonOf(ms) * SEASON_MS;
/** Season experience for what the character does. */
export const SEASON_GAIN = { kill: 2, elite: 20, dungeon: 150, boss: 120, wboss: 300, raid: 600, rift: 40, mission: 250, login: 150, quest: 80 };
export type SeasonReward = { gold?: number; item?: [string, number]; aura?: string; title?: string };
/** What each level gives (every 5th level a cosmetic). */
export function seasonReward(level: number): SeasonReward {
  if (level === 30) return { title: 'Season Champion', aura: 'aurora' };
  if (level % 10 === 0) return { aura: level === 10 ? 'violet' : 'emerald' };
  if (level % 5 === 0) return { item: [level >= 15 ? 'arm_relic' : 'arm_core', 1] };
  if (level % 3 === 0) return { item: ['arm_shard', 2] };
  return { gold: 1000 * level };
}

// ---------------------------------------------------------------------------------------------
// Wardrobe: how gear looks (any armour or helmet ever worn), and weapon glow colours
// ---------------------------------------------------------------------------------------------
export const AURA_SKINS: Record<string, { name: string; color: string; price?: number }> = {
  violet: { name: 'Violet Glow', color: '#b07aff' },
  emerald: { name: 'Emerald Glow', color: '#5fe08a' },
  aurora: { name: 'Aurora Glow', color: '#7fe8ff' },
  // G11: the cosmetics shop (gold only; a look, never a stat)
  crimson: { name: 'Crimson Glow', color: '#ff4a5a', price: 25_000 },
  sakura: { name: 'Blossom Glow', color: '#ffa8d0', price: 40_000 },
  solar: { name: 'Solar Glow', color: '#ffd24a', price: 40_000 },
  abyss: { name: 'Abyssal Glow', color: '#5a3aff', price: 60_000 },
  starlight: { name: 'Starlight Glow', color: '#f4f8ff', price: 120_000 },
};
/** The glow skins for sale; the others come from the season pass. */
export const AURA_SHOP = Object.keys(AURA_SKINS).filter((id) => AURA_SKINS[id].price);

// ---------------------------------------------------------------------------------------------
// The stored state
// ---------------------------------------------------------------------------------------------
export interface Life {
  prof: Record<Profession, { lv: number; xp: number }>;
  home: { furn: { base: string; tx: number; ty: number }[]; garden: ({ seed: string; at: number } | null)[]; restAt: number };
  season: { id: number; xp: number; claimed: number[] };
  /** Wardrobe: looks collected (armour and helmet item ids), looks worn instead, glow skins owned and worn. */
  looks: string[];
  tmog: { armor?: string; helmet?: string };
  auras: string[];
  aura: string;
  titles: string[];
  /** Gathering energy, and the day it was last spent on. */
  energy: { n: number; day: number };
  /** Food eaten: tier and when it wears off, per dish. */
  food: Partial<Record<FoodKind, { t: number; until: number }>>;
}
export const emptyLife = (): Life => ({
  prof: { mining: { lv: 1, xp: 0 }, herbalism: { lv: 1, xp: 0 }, fishing: { lv: 1, xp: 0 }, smithing: { lv: 1, xp: 0 } },
  home: { furn: [], garden: Array.from({ length: GARDEN_PLOTS }, () => null), restAt: 0 },
  season: { id: 0, xp: 0, claimed: [] }, looks: [], tmog: {}, auras: [], aura: '', titles: [], energy: { n: ENERGY_MAX, day: 0 }, food: {},
});
const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
export function cleanLife(raw: unknown): Life {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, l = emptyLife();
  for (const p of PROFESSIONS) l.prof[p] = { lv: int(r.prof?.[p]?.lv, 1, PROF_MAX, 1), xp: int(r.prof?.[p]?.xp, 0, 1e9, 0) };
  if (Array.isArray(r.home?.furn))
    for (const f of r.home.furn.slice(0, FURNITURE_MAX)) if (f && FURNITURE[f.base] && Number.isInteger(f.tx) && Number.isInteger(f.ty) && f.tx >= HOME_SLOTS.x0 && f.tx <= HOME_SLOTS.x1 && f.ty >= HOME_SLOTS.y0 && f.ty <= HOME_SLOTS.y1) l.home.furn.push({ base: f.base, tx: f.tx, ty: f.ty });
  if (Array.isArray(r.home?.garden)) r.home.garden.slice(0, GARDEN_PLOTS).forEach((g: any, i: number) => { if (g && SEEDS[g.seed] && Number.isFinite(g.at)) l.home.garden[i] = { seed: g.seed, at: g.at }; });
  l.home.restAt = Number.isFinite(r.home?.restAt) ? r.home.restAt : 0;
  l.season = { id: int(r.season?.id, 0, 1e6, 0), xp: int(r.season?.xp, 0, SEASON_LEVELS * SEASON_XP, 0), claimed: Array.isArray(r.season?.claimed) ? [...new Set<number>(r.season.claimed.filter((x: unknown) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= SEASON_LEVELS))] : [] };
  l.looks = Array.isArray(r.looks) ? [...new Set<string>(r.looks.filter((x: unknown): x is string => typeof x === 'string' && ITEMS[x]?.kind === 'equip' && (ITEMS[x].slot === 'armor' || ITEMS[x].slot === 'helmet')))] : [];
  for (const s of ['armor', 'helmet'] as const) if (typeof r.tmog?.[s] === 'string' && l.looks.includes(r.tmog[s]) && ITEMS[r.tmog[s]].slot === s) l.tmog[s] = r.tmog[s];
  l.auras = Array.isArray(r.auras) ? [...new Set<string>(r.auras.filter((x: unknown): x is string => typeof x === 'string' && !!AURA_SKINS[x]))] : [];
  l.aura = typeof r.aura === 'string' && l.auras.includes(r.aura) ? r.aura : '';
  l.titles = Array.isArray(r.titles) ? [...new Set<string>(r.titles.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 30))] : [];
  l.energy = { n: int(r.energy?.n, 0, ENERGY_MAX, ENERGY_MAX), day: int(r.energy?.day, 0, 1e7, 0) };
  for (const k of FOODS) { const f = r.food?.[k]; if (f && Number.isInteger(f.t) && f.t >= 1 && f.t <= 4 && Number.isFinite(f.until)) l.food[k] = { t: f.t, until: f.until }; }
  return l;
}
export const seasonLevel = (xp: number) => Math.min(SEASON_LEVELS, Math.floor(xp / SEASON_XP));
