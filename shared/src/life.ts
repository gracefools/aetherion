// Life outside combat: gathering professions and crafting gear with chosen sub-stats, a home with
// furniture and a garden, the free season pass, and the wardrobe (how gear looks, weapon glow
// colours). Pure rules shared by server (authority) and client (display).
import { AFFIX, GEAR_STATS, ITEMS, RARITY_SUB_RANGE, type GearStat } from './items';
import type { Job } from './protocol';

// ---------------------------------------------------------------------------------------------
// Professions
// ---------------------------------------------------------------------------------------------
export const PROFESSIONS = ['mining', 'herbalism', 'fishing', 'smithing'] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const PROF_MAX = 50;
export const profExpToNext = (lv: number) => Math.round(40 * Math.pow(lv, 1.5));
/** Which profession a gathered material trains. */
export const PROF_OF_RES: Record<string, Profession> = { iron_ore: 'mining', star_shard: 'mining', moonleaf: 'herbalism' };
/** Rare finds by profession level: from 20 a rare material, more often with every level. */
export const RARE_OF: Record<Profession, string> = { mining: 'mithril_ore', herbalism: 'sunpetal', fishing: 'star_koi', smithing: 'mithril_ore' };
export const rareChance = (lv: number) => (lv < 20 ? 0 : 0.05 + (lv - 20) * 0.006);
/** Extra yield from a gathered node: one more every 15 levels. */
export const extraYield = (lv: number) => Math.floor(lv / 15);
/** Fishing: stand next to water. Catches by level. */
export const FISH = ['river_fish', 'river_fish', 'river_fish', 'moon_carp'];
export const FISH_COOLDOWN_MS = 4000;
/** Crafted gear: item level from the smith's level and the character's, rarity from the smith's level. */
export const forgeIlvl = (prof: number, level: number) => Math.max(1, Math.min(level + 2, 10 + prof * 4));
export const forgeRarity = (prof: number) => (prof >= 45 ? 5 : prof >= 35 ? 4 : prof >= 20 ? 3 : prof >= 8 ? 2 : 1);
/** Sub-stats a crafted item gets: one per rarity tier above common (the smith chooses which). */
export const forgeSlots = (rar: number) => Math.max(1, rar);
export function forgeCost(ilvl: number, rar: number): { gold: number; mats: [string, number][] } {
  const mats: [string, number][] = [['iron_ore', 4 + Math.floor(ilvl / 10)], ['upgrade_stone', 1 + rar]];
  if (rar >= 3) mats.push(['mithril_ore', rar - 2]);
  if (rar >= 4) mats.push(['star_shard', 3 * (rar - 3)]);
  return { gold: Math.round(200 * ilvl * (1 + rar * 0.5)), mats };
}
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
  if (level % 5 === 0) return { item: [level >= 15 ? 'awakening_essence' : 'arm_core', 1] };
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
}
export const emptyLife = (): Life => ({
  prof: { mining: { lv: 1, xp: 0 }, herbalism: { lv: 1, xp: 0 }, fishing: { lv: 1, xp: 0 }, smithing: { lv: 1, xp: 0 } },
  home: { furn: [], garden: Array.from({ length: GARDEN_PLOTS }, () => null), restAt: 0 },
  season: { id: 0, xp: 0, claimed: [] }, looks: [], tmog: {}, auras: [], aura: '', titles: [],
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
  return l;
}
export const seasonLevel = (xp: number) => Math.min(SEASON_LEVELS, Math.floor(xp / SEASON_XP));
