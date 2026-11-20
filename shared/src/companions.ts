// Pets and mounts (M15). A pet follows its owner, levels up alongside them and gives a passive
// bonus; it never blocks anyone (no collision). A mount raises movement speed through the same
// stat the movement code already uses, so it obeys collision exactly like walking does.
import type { Stats } from './jobs';

export interface PetDef {
  id: string;
  name: string;
  /** The stat raised, and by how much at level 1 and at the top level. */
  stat: 'maxHp' | 'atk' | 'matk' | 'def' | 'crit' | 'dodge';
  base: number;
  top: number;
  /** Percent of the stat (true) or flat points (false). */
  pct: boolean;
  colors: [string, string, string];
  shape: 'fox' | 'sprout' | 'owl' | 'toad' | 'mote' | 'pup';
}
export const PETS: Record<string, PetDef> = {
  ember_kit: { id: 'ember_kit', name: 'Ember Kit', stat: 'atk', base: 3, top: 8, pct: true, colors: ['#e0703a', '#ffd08a', '#3a2418'], shape: 'fox' },
  moss_sprout: { id: 'moss_sprout', name: 'Moss Sprout', stat: 'maxHp', base: 4, top: 10, pct: true, colors: ['#5fae4a', '#c8f09a', '#2a4a1c'], shape: 'sprout' },
  frost_owlet: { id: 'frost_owlet', name: 'Frost Owlet', stat: 'crit', base: 2, top: 5, pct: false, colors: ['#d8f0ff', '#8fc4e8', '#2a3a5a'], shape: 'owl' },
  bog_toad: { id: 'bog_toad', name: 'Bog Toad', stat: 'def', base: 4, top: 10, pct: true, colors: ['#6a8a3a', '#d8c060', '#2a3418'], shape: 'toad' },
  star_mote: { id: 'star_mote', name: 'Star Mote', stat: 'matk', base: 4, top: 10, pct: true, colors: ['#fff0a0', '#c9a8ff', '#5a3ab0'], shape: 'mote' },
  iron_pup: { id: 'iron_pup', name: 'Iron Pup', stat: 'dodge', base: 2, top: 5, pct: false, colors: ['#a8b4c6', '#eef2fa', '#3a4250'], shape: 'pup' },
};
export const PET_MAX_LEVEL = 60;
/** G10: each pet has one skill it uses on its own while its owner fights a monster. Pets never attack players. */
export interface PetSkill {
  name: string;
  /** strike: the owner's target; area: around it; heal and shield: the owner, when hurt. */
  kind: 'strike' | 'area' | 'heal' | 'shield';
  cdMs: number;
  /** Damage as a share of the owner's attack (strike, area), or of their health (heal, shield), at level 1. */
  mul: number;
  magic?: boolean;
  /** A status the blow leaves on the monster. */
  status?: 'burn' | 'slow' | 'stun';
  radius?: number;
  /** Heal and shield wait until the owner's health is below this share. */
  below?: number;
}
export const PET_SKILLS: Record<string, PetSkill> = {
  ember_kit: { name: 'Ember Bite', kind: 'strike', cdMs: 6000, mul: 0.6, magic: true, status: 'burn' },
  moss_sprout: { name: 'Mending Spores', kind: 'heal', cdMs: 12000, mul: 0.06, below: 0.75 },
  frost_owlet: { name: 'Frost Gust', kind: 'strike', cdMs: 8000, mul: 0.5, magic: true, status: 'slow' },
  bog_toad: { name: 'Mud Shell', kind: 'shield', cdMs: 20000, mul: 0.08, below: 0.6 },
  star_mote: { name: 'Starfall', kind: 'area', cdMs: 10000, mul: 0.45, magic: true, radius: 70 },
  iron_pup: { name: 'Pounce', kind: 'strike', cdMs: 7000, mul: 0.7, status: 'stun' },
};
/** How far from its owner a pet reaches a monster. */
export const PET_REACH = 260;
/** The skill grows with the pet: 1% a level and 15% more at each evolution; its tier multiplies it. */
export const petSkillPower = (level: number, tier = 0) => Math.round((1 + 0.01 * (level - 1)) * (1 + 0.15 * petStage(level)) * petTierMul(tier) * 1000) / 1000;

// Tiers: a pet climbs from Normal to Mythic by eating other pets. A tier multiplies the pet's
// percentage bonus and its skill, and raises the flat bonus its grade gives.
export const PET_TIERS = ['normal', 'rare', 'epic', 'legend', 'mythic'] as const;
export const PET_TIER_NAMES = ['Normal', 'Rare', 'Epic', 'Legend', 'Mythic'];
export const PET_TIER_COLOR = ['#c8ccd6', '#5aa8ff', '#b86bff', '#ffb43a', '#ff5a6a'];
export const MAX_PET_TIER = PET_TIERS.length - 1;
/** Tier exp to climb from tier i to tier i+1 (Normal to Rare, Rare to Epic, ...). */
export const PET_TIER_NEED = [10, 100, 500, 1000];
/** Tier exp a pet gives when eaten, by its own tier. */
export const PET_FEED_EXP = [5, 10, 20, 50, 200];
/** A pet of another kind gives this share of its exp. */
export const PET_OFFKIND_SHARE = 0.4;
export const PET_TIER_MULS = [1, 1.2, 1.4, 1.7, 2];
export const petTierMul = (tier: number) => PET_TIER_MULS[Math.max(0, Math.min(MAX_PET_TIER, tier | 0))];
/** The flat bonus at level 60 with a 100% grade, by stat and tier. */
export const PET_FLAT_TOP: Record<PetDef['stat'], number[]> = {
  atk: [60, 150, 250, 400, 600],
  matk: [60, 150, 250, 400, 600],
  def: [90, 225, 375, 600, 900],
  maxHp: [600, 1500, 2500, 4000, 6000],
  crit: [1, 2.5, 4, 6, 8],
  dodge: [1, 2.5, 4, 6, 8],
};
/** Grades: rolled once when the pet first joins, a percentage of the tier's flat bonus. */
export const PET_GRADES = [
  { g: 'D', lo: 30, hi: 50, w: 35 },
  { g: 'C', lo: 51, hi: 60, w: 25 },
  { g: 'B', lo: 61, hi: 70, w: 18 },
  { g: 'A', lo: 71, hi: 80, w: 12 },
  { g: 'S', lo: 81, hi: 90, w: 7 },
  { g: 'SS', lo: 91, hi: 100, w: 3 },
] as const;
export const PET_GRADE_COLOR: Record<string, string> = { D: '#9aa0ac', C: '#8fd18a', B: '#5aa8ff', A: '#b86bff', S: '#ffb43a', SS: '#ff5a6a' };
export const gradeOf = (pct: number) => (PET_GRADES.find((b) => pct >= b.lo && pct <= b.hi) ?? PET_GRADES[0]).g;
/** A weighted band, then an even percentage inside it. */
export function rollGrade(rng: () => number = Math.random): number {
  let r = rng() * 100;
  for (const b of PET_GRADES) {
    if (r < b.w) return b.lo + Math.floor(rng() * (b.hi - b.lo + 1));
    r -= b.w;
  }
  return 30;
}
/** The flat bonus from the grade: the tier's top value, times the grade, times level / 60. */
export function petFlat(d: PetDef, p: { level: number; tier: number; gr: number }): number {
  const v = (PET_FLAT_TOP[d.stat][Math.max(0, Math.min(MAX_PET_TIER, p.tier))] * p.gr * Math.min(p.level, PET_MAX_LEVEL)) / (100 * PET_MAX_LEVEL);
  return d.stat === 'crit' || d.stat === 'dodge' ? Math.round(v * 10) / 10 : Math.round(v);
}
/** Tier exp a pet gives when eaten by another. */
export const feedExp = (target: { kind: string }, food: { kind: string; tier: number }) => Math.round(PET_FEED_EXP[Math.max(0, Math.min(MAX_PET_TIER, food.tier))] * (food.kind === target.kind ? 1 : PET_OFFKIND_SHARE));
/** The tier and tier exp after gaining some: leftover carries on; a Mythic pet keeps none. */
export function addTierExp(tier: number, tx: number, gain: number): { tier: number; tx: number } {
  tx += gain;
  while (tier < MAX_PET_TIER && tx >= PET_TIER_NEED[tier]) { tx -= PET_TIER_NEED[tier]; tier++; }
  return { tier, tx: tier >= MAX_PET_TIER ? 0 : tx };
}
/** The pet kinds in a fixed order (their index travels in events). */
export const PET_IDS = Object.keys(PETS);
/** Pets evolve at levels 20, 40 and 60: a new name, a larger body and a stronger bonus. */
export const PET_STAGES = [1, 20, 40, 60];
export const PET_STAGE_NAMES = ['', 'Grown', 'Elder', 'Mythic'];
export const petStage = (level: number) => PET_STAGES.filter((l) => level >= l).length - 1;
/** Share of the owner's experience the summoned pet gains. */
export const PET_EXP_SHARE = 0.15;
export const petExpToNext = (level: number) => Math.round(120 * Math.pow(level, 1.35));
/** The pet's bonus: from base to top over levels 1-20, then a quarter of the top more at each evolution; the tier multiplies it. */
export const petBonus = (d: PetDef, level: number, tier = 0) => Math.round((d.base + ((d.top - d.base) * (Math.min(level, 20) - 1)) / 19 + d.top * 0.25 * petStage(level)) * petTierMul(tier) * 10) / 10;
export const PET_NAME = /^[A-Za-z][A-Za-z ]{1,13}$/;

export interface MountDef {
  id: string;
  name: string;
  /** Movement speed multiplier while riding. */
  speed: number;
  level: number;
  colors: [string, string, string];
  shape: 'strider' | 'charger' | 'elk' | 'skiff' | 'griffin';
  /** Flies: water and trees do not block it (walls and rock still do). */
  fly?: boolean;
}
export const MOUNTS: Record<string, MountDef> = {
  plains_strider: { id: 'plains_strider', name: 'Plains Strider', speed: 1.3, level: 10, colors: ['#c9a06a', '#f0dcb0', '#5a3c20'], shape: 'strider' },
  ashen_charger: { id: 'ashen_charger', name: 'Ashen Charger', speed: 1.4, level: 20, colors: ['#4a4040', '#ff8a3a', '#1a1414'], shape: 'charger' },
  frost_elk: { id: 'frost_elk', name: 'Frost Elk', speed: 1.4, level: 20, colors: ['#e8f0f8', '#8fc4e8', '#4a5a6a'], shape: 'elk' },
  void_skiff: { id: 'void_skiff', name: 'Void Skiff', speed: 1.5, level: 30, colors: ['#5a3ab0', '#c9a8ff', '#1a1030'], shape: 'skiff' },
  sky_griffin: { id: 'sky_griffin', name: 'Sky Griffin', speed: 1.7, level: 120, colors: ['#e8c06a', '#fff4d0', '#5a3a18'], shape: 'griffin', fly: true },
  star_drake: { id: 'star_drake', name: 'Star Drake', speed: 1.85, level: 160, colors: ['#3a5ab0', '#bfe4ff', '#101a40'], shape: 'griffin', fly: true },
};
/** Flying mounts open at this level. */
export const FLY_LEVEL = 120;
export const isFlying = (c: Companions | null | undefined) => !!c?.riding && !!MOUNTS[c.riding]?.fly;
/** Riding is not possible inside dungeon instances and the arena (their zones are of kind 'dungeon'). */
export const MOUNT_FORBIDDEN_KINDS = ['dungeon'];
/** After moving this long without a pause, a player who owns a mount climbs onto it. */
export const AUTO_MOUNT_MS = 3000;

export interface OwnedPet {
  uid: string;
  kind: string;
  name: string;
  level: number;
  exp: number;
  /** Tier (0 Normal .. 4 Mythic) and the tier exp toward the next. */
  tier: number;
  tx: number;
  /** Grade: 30-100, a percentage of the tier's flat bonus, rolled once. */
  gr: number;
}
export interface Companions {
  pets: OwnedPet[];
  /** uid of the summoned pet, or ''. */
  pet: string;
  mounts: string[];
  /** The mount being ridden, or ''. */
  riding: string;
}
export const emptyCompanions = (): Companions => ({ pets: [], pet: '', mounts: [], riding: '' });
export const MAX_PETS = 24;

/** Restores a saved collection. A pet saved before grades existed gets its grade rolled now, once. */
export function cleanCompanions(raw: unknown, rng: () => number = Math.random): Companions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, out = emptyCompanions(), uids = new Set<string>();
  if (Array.isArray(r.pets))
    for (const p of r.pets.slice(0, MAX_PETS)) {
      if (!p || !PETS[p.kind] || typeof p.uid !== 'string' || p.uid.length > 40 || uids.has(p.uid)) continue;
      uids.add(p.uid);
      const level = Number.isInteger(p.level) ? Math.max(1, Math.min(PET_MAX_LEVEL, p.level)) : 1;
      const tier = Number.isInteger(p.tier) ? Math.max(0, Math.min(MAX_PET_TIER, p.tier)) : 0;
      out.pets.push({
        uid: p.uid, kind: p.kind, name: typeof p.name === 'string' && PET_NAME.test(p.name) ? p.name : PETS[p.kind].name, level, exp: Number.isInteger(p.exp) && p.exp > 0 && level < PET_MAX_LEVEL ? Math.min(p.exp, petExpToNext(level) - 1) : 0,
        tier, tx: Number.isInteger(p.tx) && p.tx > 0 && tier < MAX_PET_TIER ? Math.min(p.tx, PET_TIER_NEED[tier] - 1) : 0,
        gr: Number.isInteger(p.gr) && p.gr >= 30 && p.gr <= 100 ? p.gr : rollGrade(rng),
      });
    }
  if (typeof r.pet === 'string' && uids.has(r.pet)) out.pet = r.pet;
  if (Array.isArray(r.mounts)) out.mounts = [...new Set(r.mounts.filter((m: unknown) => typeof m === 'string' && MOUNTS[m]))] as string[];
  return out; // `riding` is never restored: a character always logs in on foot
}
/** Applies the summoned pet's bonus and the ridden mount's speed to computed stats. */
export function applyCompanions(s: Stats, c: Companions) {
  const owned = c.pet ? c.pets.find((p) => p.uid === c.pet) : undefined, def = owned && PETS[owned.kind];
  if (def) {
    const v = petBonus(def, owned!.level, owned!.tier);
    if (def.pct) s[def.stat] = Math.round(s[def.stat] * (1 + v / 100));
    else s[def.stat] = Math.round((s[def.stat] + v) * 10) / 10;
    // the grade's flat bonus (no percentage)
    const f = petFlat(def, owned!);
    s[def.stat] = def.stat === 'crit' || def.stat === 'dodge' ? Math.round((s[def.stat] + f) * 10) / 10 : s[def.stat] + f;
  }
  if (c.riding && MOUNTS[c.riding]) s.moveMul = Math.round(s.moveMul * MOUNTS[c.riding].speed * 1000) / 1000;
}
/** What other players see: [pet kind, pet name, pet level] and the mount being ridden. */
export function companionLook(c: Companions): { pet?: [string, string, number]; mnt?: string } {
  const p = c.pet ? c.pets.find((x) => x.uid === c.pet) : undefined;
  return { ...(p ? { pet: [p.kind, p.name, p.level] as [string, string, number] } : {}), ...(c.riding ? { mnt: c.riding } : {}) };
}
