// Armament (level 30) and sigils (level 50): character progression attached to the equipment slots.
//
// Armament: one armament per equipment slot (weapon, armor, helmet, amulet, ring), enhanced from +0
// to +20. Each level raises the MAIN stats of whatever item is equipped in that slot (never its
// sub-stats). Up to +6 every attempt succeeds; after that a failure drops back to the last
// checkpoint (+6, +9, +12, +15, +18). Materials come only from dungeon bosses on Nightmare or
// Armageddon; +6, +12 and +18 on the weapon armament make the equipped weapon glow white, blue, ember.
//
// Sigils: six slots, one per shape; a sigil goes in the slot of its shape. Each raises one class
// skill by +1 to +3 (nothing for a class without that skill), and carries one of three symbols:
// 2, 4 or 6 sigils of the same symbol give that symbol's set bonus. They drop only from bosses on
// Armageddon.
import { registerItems, SLOTS, SIGIL_SKILL_IDS, type Item, type ItemBase, type ItemSpec, type Slot } from './items';
import { SUBSKILLS } from './subskills';
import { JOB_DEFS, type Stats } from './jobs';
import type { Job } from './protocol';

// =============================================================================================
// Armament
// =============================================================================================
export const ARMAMENT_LEVEL = 30;
export const ARM_MAX = 20;
/** Chance (percent) to go from `from` to `from + 1`. */
export function armChance(from: number): number {
  const table: Record<number, number> = { 6: 90, 7: 80, 8: 70, 9: 60, 10: 50, 11: 40, 12: 30, 13: 20, 14: 10, 15: 9, 16: 8, 17: 7, 18: 6, 19: 5 };
  return from < 6 ? 100 : table[from] ?? 0;
}
/** Where a failed attempt toward `target` leaves the armament: its last checkpoint. */
export function armFallback(target: number): number {
  return target <= 6 ? target - 1 : target <= 9 ? 6 : target <= 12 ? 9 : target <= 15 ? 12 : target <= 18 ? 15 : 18;
}
/** The boost each single level gives to the slot's main stats, in percent. */
export function armStep(level: number): number {
  return level <= 6 ? 1 : level <= 9 ? 1.5 : level <= 12 ? 2 : level <= 15 ? 2.5 : level <= 18 ? 3 : 5;
}
/** Total boost at an armament level, in percent (+20: 43%). */
export function armBoost(level: number): number {
  let t = 0;
  for (let l = 1; l <= Math.min(ARM_MAX, level); l++) t += armStep(l);
  return Math.round(t * 10) / 10;
}
/** Armament materials: each stage of enhancement needs a rarer one, from harder bosses. */
export const ARM_MATERIALS = ['arm_shard', 'arm_core', 'arm_relic'] as const;
/** What the attempt from `from` to `from + 1` costs. */
export function armCost(from: number): { gold: number; mat: (typeof ARM_MATERIALS)[number]; qty: number } {
  const gold = Math.round(500 * Math.pow(from + 1, 1.5));
  if (from < 6) return { gold, mat: 'arm_shard', qty: 1 + Math.floor(from / 2) };
  if (from < 12) return { gold, mat: 'arm_core', qty: 1 + Math.floor((from - 6) / 2) };
  return { gold, mat: 'arm_relic', qty: 1 + Math.floor((from - 12) / 3) };
}
/** Weapon glow from the weapon armament: 0 none, 1 white (+6), 2 blue (+12), 3 ember (+18). */
export const weaponAura = (level: number) => (level >= 18 ? 3 : level >= 12 ? 2 : level >= 6 ? 1 : 0);
export const WEAPON_AURA_COLORS = ['', '#ffffff', '#5aa8ff', '#ff7a2a'];

/**
 * Material drops from a dungeon boss, per player. Only Nightmare and Armageddon drop any; the
 * rarer materials need the harder dungeons (by their level).
 */
export function armamentDrops(rng: () => number, diff: string, dungeonLevel: number): ItemSpec[] {
  const out: ItemSpec[] = [], mat = (base: string, qty: number) => out.push({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty });
  if (diff === 'nightmare') {
    if (rng() < 0.6) mat('arm_shard', 1 + (rng() < 0.4 ? 1 : 0));
    if (dungeonLevel >= 24 && rng() < 0.22) mat('arm_core', 1);
    if (dungeonLevel >= 32 && rng() < 0.07) mat('arm_relic', 1);
  } else if (diff === 'armageddon') {
    mat('arm_shard', 2 + (rng() < 0.5 ? 1 : 0));
    if (dungeonLevel >= 16 && rng() < 0.45) mat('arm_core', 1 + (rng() < 0.3 ? 1 : 0));
    if (dungeonLevel >= 24 && rng() < 0.15) mat('arm_relic', 1);
  }
  return out;
}
/** World bosses of this level or higher also drop armament material. */
export const WORLD_BOSS_ARM_LEVEL = 30;
/** Armament material from a world boss, per rewarded player: Shards from level 30, Cores from 60, Relics from 100. */
export function worldBossArmament(rng: () => number, bossLevel: number): ItemSpec[] {
  const out: ItemSpec[] = [], mat = (base: string, qty: number) => out.push({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty });
  if (bossLevel < WORLD_BOSS_ARM_LEVEL) return out;
  if (rng() < 0.7) mat('arm_shard', 1 + (rng() < 0.4 ? 1 : 0));
  if (bossLevel >= 60 && rng() < 0.25) mat('arm_core', 1);
  if (bossLevel >= 100 && rng() < 0.08) mat('arm_relic', 1);
  return out;
}

// =============================================================================================
// Sigils
// =============================================================================================
export const SIGIL_LEVEL = 50;
export const SIGIL_SHAPES = ['circle', 'triangle', 'square', 'diamond', 'star', 'crescent'] as const;
export const SIGIL_SHAPE_NAMES = ['Circle', 'Triangle', 'Square', 'Diamond', 'Star', 'Crescent'];
export const SIGIL_SYMBOLS = ['dark_moon', 'bright_ember', 'fallen_angel'] as const;
export const SIGIL_SYMBOL_NAMES = ['Dark Moon', 'Bright Ember', 'Fallen Angel'];
export const SIGIL_SYMBOL_COLORS = ['#9a7ee0', '#ff8a3a', '#e8e0c0'];
/** Chance a player receives a sigil from an Armageddon dungeon boss. */
export const SIGIL_DROP = 0.35;
/**
 * Sigil tiers, one every 30 levels from 50. A tier drops only from Armageddon bosses of at least
 * its level, so higher tiers need harder dungeons. `slots` different skills, each +1 to `max`.
 * Each tier above the first adds 1 point to every effect of its symbol set (and 1% less attack time).
 */
export const SIGIL_TIERS = [
  { level: 50, slots: 1, max: 1 }, { level: 80, slots: 1, max: 2 }, { level: 110, slots: 2, max: 2 },
  { level: 140, slots: 2, max: 3 }, { level: 170, slots: 3, max: 3 }, { level: 200, slots: 3, max: 4 },
];
/** The highest sigil tier an Armageddon boss of this (designed) level drops; 0 for none. */
export const sigilTierForBoss = (bossLevel: number) => SIGIL_TIERS.reduce((t, x, i) => (bossLevel >= x.level ? i + 1 : t), 0);
/** The skills a sigil raises (older sigils hold one). */
export const sigilSkills = (it: Item): [string, number][] => it.sks ?? (it.sk ? [it.sk] : []);
/** A sigil's tier (sigils from before tiers count as tier 1). */
export const sigilTier = (it: Item) => it.st ?? 1;

/** Set bonuses at 2, 4 and 6 sigils of one symbol (the highest reached applies). Values in percent or points. */
export const SIGIL_SETS: Record<(typeof SIGIL_SYMBOLS)[number], { dmg?: number; critDmg?: number; maxHp?: number; mdef?: number; def?: number; atkTime?: number; crit?: number; lifesteal?: number }[]> = {
  bright_ember: [{ dmg: 9, critDmg: 10 }, { dmg: 12, critDmg: 15 }, { dmg: 15, critDmg: 20 }],
  fallen_angel: [{ maxHp: 10, mdef: 5, def: 5 }, { maxHp: 15, mdef: 10, def: 10 }, { maxHp: 20, mdef: 15, def: 15 }],
  dark_moon: [{ atkTime: 5, crit: 5, lifesteal: 5 }, { atkTime: 7, crit: 10, lifesteal: 10 }, { atkTime: 10, crit: 15, lifesteal: 15 }],
};

const sigilBases: ItemBase[] = [];
SIGIL_SYMBOLS.forEach((sym, si) => SIGIL_SHAPES.forEach((shape, sh) => sigilBases.push({
  id: `sigil_${sym}_${shape}`, name: `${SIGIL_SYMBOL_NAMES[si]} Sigil (${SIGIL_SHAPE_NAMES[sh]})`, kind: 'sigil', sigil: { shape: sh, sym: si }, price: 4000,
  desc: `A ${SIGIL_SHAPE_NAMES[sh].toLowerCase()} sigil of the ${SIGIL_SYMBOL_NAMES[si]}. It fits the ${SIGIL_SHAPE_NAMES[sh].toLowerCase()} sigil slot and raises one class skill.`,
})));
registerItems([
  { id: 'arm_shard', name: 'Armament Shard', kind: 'material', stack: 99, price: 600, desc: 'Enhances an armament up to +6. Dropped by dungeon bosses on Nightmare and Armageddon, and by world bosses of level 30 or higher.' },
  { id: 'arm_core', name: 'Armament Core', kind: 'material', stack: 99, price: 2500, desc: 'Enhances an armament from +6 to +12. Dropped rarely by the harder dungeon bosses on Nightmare and Armageddon, and by world bosses of level 60 or higher.' },
  { id: 'awakening_essence', name: 'Awakening Essence', kind: 'material', stack: 99, price: 12000, desc: 'Awakens a fully trained skill (level 80). Dropped by Armageddon dungeon bosses and Rift guardians from floor 30.' },
  { id: 'arm_relic', name: 'Armament Relic', kind: 'material', stack: 99, price: 9000, desc: 'Enhances an armament from +12 to +20. Dropped very rarely by the hardest dungeon bosses on Nightmare and Armageddon, and by world bosses of level 100 or higher.' },
  ...sigilBases,
]);
const SKILL_LIST = [...SIGIL_SKILL_IDS];
/**
 * A new sigil of a tier: random shape and symbol (unless given), and as many different random
 * skills (class skills or sub-skills of any job) as the tier has slots, each +1 up to the tier's best.
 */
export function rollSigil(rng: () => number, tier = 1, sym?: number, shape?: number): ItemSpec {
  const si = sym ?? Math.floor(rng() * SIGIL_SYMBOLS.length), sh = shape ?? Math.floor(rng() * SIGIL_SHAPES.length);
  const t = SIGIL_TIERS[Math.max(1, Math.min(SIGIL_TIERS.length, tier)) - 1], sks: [string, number][] = [];
  while (sks.length < t.slots) {
    const skill = SKILL_LIST[Math.floor(rng() * SKILL_LIST.length)];
    if (!sks.some((x) => x[0] === skill)) sks.push([skill, 1 + Math.floor(rng() * t.max)]);
  }
  return { base: `sigil_${SIGIL_SYMBOLS[si]}_${SIGIL_SHAPES[sh]}`, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1, st: SIGIL_TIERS.indexOf(t) + 1, sks };
}
/** The job a sigil's skill (or sub-skill) belongs to. */
export const sigilSkillJob = (skill: string): Job | undefined => SUBSKILLS[skill]?.job ?? (Object.keys(JOB_DEFS) as Job[]).find((j) => JOB_DEFS[j].skills.some((n) => n.id === skill));

// =============================================================================================
// The character's armament levels and equipped sigils (stored together, with the inventory)
// =============================================================================================
export interface Gear {
  arm: Partial<Record<Slot, number>>;
  sig: (Item | null)[];
}
export const emptyGear = (): Gear => ({ arm: {}, sig: SIGIL_SHAPES.map(() => null) });
/** Main-stat multiplier per equipment slot from the armament (only while the character can use armament). */
export function armMultipliers(g: Gear, level: number): Partial<Record<Slot, number>> {
  const out: Partial<Record<Slot, number>> = {};
  if (level < ARMAMENT_LEVEL) return out;
  for (const s of SLOTS) if (g.arm[s]) out[s] = 1 + armBoost(g.arm[s]!) / 100;
  return out;
}
/** Extra ranks the equipped sigils give this job's learned skills. */
export function sigilRanks(job: Job, level: number, g: Gear, learned: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (level < SIGIL_LEVEL) return out;
  for (const it of g.sig) {
    if (!it) continue;
    for (const [skill, plus] of sigilSkills(it)) {
      if (sigilSkillJob(skill) !== job || !(learned[skill] > 0)) continue; // another class's skill, or not learned: no effect
      out[skill] = (out[skill] ?? 0) + plus;
    }
  }
  return out;
}
/** Learned ranks plus sigil ranks (the ranks the character's skills work at). */
export function effectiveRanks(job: Job, level: number, g: Gear, learned: Record<string, number>): Record<string, number> {
  const extra = sigilRanks(job, level, g, learned), out = { ...learned };
  for (const [k, v] of Object.entries(extra)) out[k] = (out[k] ?? 0) + v;
  return out;
}
/** Equipped sigils per symbol, and the set tier reached (0 none, 1 = 2 sigils, 2 = 4, 3 = 6). */
/**
 * Equipped sigils per symbol, the set step reached (0 none, 1 = 2 sigils, 2 = 4, 3 = 6), and the
 * set's sigil tier: the lowest tier among them, which adds (tier - 1) points to every effect.
 */
export function sigilSets(g: Gear, level: number): { sym: (typeof SIGIL_SYMBOLS)[number]; n: number; tier: number; st: number }[] {
  if (level < SIGIL_LEVEL) return [];
  const n = SIGIL_SYMBOLS.map(() => 0), st = SIGIL_SYMBOLS.map(() => SIGIL_TIERS.length);
  for (const it of g.sig) {
    const b = it && sigilBase(it.base);
    if (!b) continue;
    n[b.sym]++;
    st[b.sym] = Math.min(st[b.sym], sigilTier(it!));
  }
  return SIGIL_SYMBOLS.map((sym, i) => ({ sym, n: n[i], tier: n[i] >= 6 ? 3 : n[i] >= 4 ? 2 : n[i] >= 2 ? 1 : 0, st: n[i] ? st[i] : 1 })).filter((x) => x.n > 0);
}
/** A set's effects at a step, with the sigil-tier bonus added to every value. */
export function setEffects(sym: (typeof SIGIL_SYMBOLS)[number], step: number, st = 1): (typeof SIGIL_SETS)[keyof typeof SIGIL_SETS][number] {
  const base = SIGIL_SETS[sym][step - 1], out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) out[k] = v + Math.max(0, st - 1);
  return out;
}
/** Applies the sigil set bonuses to a stat block. */
export function applySigilSets(s: Stats, g: Gear, level: number) {
  for (const { sym, tier, st } of sigilSets(g, level)) {
    if (!tier) continue;
    const b = setEffects(sym, tier, st);
    if (b.dmg) {
      s.atk = Math.round(s.atk * (1 + b.dmg / 100));
      s.matk = Math.round(s.matk * (1 + b.dmg / 100));
    }
    if (b.critDmg) s.critDmg = Math.round((s.critDmg + b.critDmg / 100) * 100) / 100;
    if (b.maxHp) s.maxHp = Math.round(s.maxHp * (1 + b.maxHp / 100));
    if (b.mdef) s.mdef = Math.round(s.mdef * (1 + b.mdef / 100));
    if (b.def) s.def = Math.round(s.def * (1 + b.def / 100));
    if (b.atkTime) s.atkIntervalMs = Math.round(s.atkIntervalMs * (1 - b.atkTime / 100));
    if (b.crit) s.crit = Math.min(75, Math.round((s.crit + b.crit) * 10) / 10);
    if (b.lifesteal) s.lifesteal = Math.round((s.lifesteal + b.lifesteal) * 10) / 10;
  }
}
export const sigilBase = (base: string): { shape: number; sym: number } | undefined => {
  const m = /^sigil_(dark_moon|bright_ember|fallen_angel)_(circle|triangle|square|diamond|star|crescent)$/.exec(base);
  return m ? { sym: SIGIL_SYMBOLS.indexOf(m[1] as any), shape: SIGIL_SHAPES.indexOf(m[2] as any) } : undefined;
};
/** Validates stored armament levels and sigils. `clean` validates an item (and marks its id used). */
export function cleanGear(raw: unknown, clean: (r: unknown) => Item | null): Gear {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, g = emptyGear();
  for (const s of SLOTS) {
    const v = r.arm?.[s];
    if (Number.isInteger(v) && v > 0) g.arm[s] = Math.min(ARM_MAX, v);
  }
  if (Array.isArray(r.sig))
    r.sig.slice(0, SIGIL_SHAPES.length).forEach((x: unknown, i: number) => {
      const it = x ? clean(x) : null;
      // a sigil only sits in the slot of its own shape
      if (it && sigilBase(it.base)?.shape === i) g.sig[i] = it;
    });
  return g;
}
