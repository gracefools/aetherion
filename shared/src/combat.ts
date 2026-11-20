// Combat rules shared by server (authority) and client (display, movement prediction under slow/stun).
import type { Job } from './protocol';
import type { WeaponKind } from './jobs';

export interface StatusDef {
  id: string;
  name: string;
  debuff: boolean;
  ms: number;
  maxStacks: number;
  moveMul?: number;
  atkMul?: number;
  defMul?: number;
  intervalMul?: number;
  stun?: boolean;
  /** Damage per second per stack, as a fraction of the applier's attack power. */
  dot?: number;
  runeMul?: number; // rune spell damage/heal multiplier
  lifesteal?: number; // added lifesteal percent
  cantDie?: boolean; // HP cannot drop below 1
  invuln?: boolean; // takes no damage
  stealth?: boolean; // monsters do not notice the player
  absorbMana?: number; // fraction of damage paid with mana instead of HP
  /** Damage absorbed until the pool (StatusInst.power) is used up. */
  absorbPool?: boolean;
  /** Next weapon strike is multiplied by this, then the status is consumed. */
  nextMul?: number;
}
export const STATUS: StatusDef[] = [
  { id: 'poison', name: 'Poison', debuff: true, ms: 5000, maxStacks: 3, dot: 0.12 },
  { id: 'slow', name: 'Slowed', debuff: true, ms: 3000, maxStacks: 1, moveMul: 0.55 },
  { id: 'stun', name: 'Stunned', debuff: true, ms: 1200, maxStacks: 1, stun: true },
  { id: 'weaken', name: 'Weakened', debuff: true, ms: 6000, maxStacks: 1, atkMul: 0.75 },
  { id: 'bleed', name: 'Bleeding', debuff: true, ms: 4000, maxStacks: 2, dot: 0.15 },
  { id: 'enrage', name: 'Enraged', debuff: false, ms: 60000, maxStacks: 1, atkMul: 1.35, intervalMul: 0.75, moveMul: 1.2 },
  { id: 'ward', name: 'Returning Ward', debuff: false, ms: 5000, maxStacks: 1, defMul: 2 },
  // --- M4 ---
  { id: 'burn', name: 'Burning', debuff: true, ms: 4000, maxStacks: 1, dot: 0.18 },
  { id: 'root', name: 'Rooted', debuff: true, ms: 2500, maxStacks: 1, moveMul: 0 },
  { id: 'mark', name: "Hunter's Mark", debuff: true, ms: 10000, maxStacks: 1, defMul: 0.7 },
  { id: 'guard', name: 'Guard Stance', debuff: false, ms: 6000, maxStacks: 1, defMul: 2.5 },
  { id: 'rally', name: 'Rallying Cry', debuff: false, ms: 12000, maxStacks: 1, defMul: 1.3 },
  { id: 'blessing', name: 'Blessing', debuff: false, ms: 30000, maxStacks: 1, atkMul: 1.15, defMul: 1.15 },
  { id: 'haste', name: 'War Cry', debuff: false, ms: 8000, maxStacks: 1, intervalMul: 0.75 },
  { id: 'frenzy', name: 'Frenzy', debuff: false, ms: 10000, maxStacks: 1, intervalMul: 0.6, lifesteal: 10 },
  { id: 'surge', name: 'Elemental Surge', debuff: false, ms: 8000, maxStacks: 1, runeMul: 1.35 },
  { id: 'last_stand', name: 'Last Stand', debuff: false, ms: 5000, maxStacks: 1, cantDie: true },
  { id: 'aegis', name: 'Divine Aegis', debuff: false, ms: 3000, maxStacks: 1, invuln: true },
  { id: 'stealth', name: 'Stealth', debuff: false, ms: 12000, maxStacks: 1, stealth: true },
  { id: 'mana_shield', name: 'Mana Shield', debuff: false, ms: 12000, maxStacks: 1, absorbMana: 0.7 },
  { id: 'barrier', name: 'Barrier', debuff: false, ms: 10000, maxStacks: 1, absorbPool: true },
  { id: 'retribution', name: 'Retribution', debuff: false, ms: 6000, maxStacks: 1, nextMul: 1.5 },
  { id: 'shock', name: 'Shocked', debuff: true, ms: 700, maxStacks: 1, stun: true },
  { id: 'death_mark', name: 'Death Mark', debuff: true, ms: 6000, maxStacks: 1 },
  { id: 'rested', name: 'Rested', debuff: false, ms: 30 * 60_000, maxStacks: 1, atkMul: 1.05, defMul: 1.05 },
  // --- G4 region traits ---
  { id: 'null_phase', name: 'Phased Out', debuff: false, ms: 1800, maxStacks: 1, invuln: true },
  { id: 'swift', name: 'Swiftness', debuff: false, ms: 4000, maxStacks: 1, moveMul: 1.3 },
];
export type StatusId =
  | 'poison' | 'slow' | 'stun' | 'weaken' | 'bleed' | 'enrage' | 'ward'
  | 'burn' | 'root' | 'mark' | 'guard' | 'rally' | 'blessing' | 'haste' | 'frenzy' | 'surge' | 'last_stand'
  | 'aegis' | 'stealth' | 'mana_shield' | 'barrier' | 'retribution' | 'shock' | 'death_mark' | 'rested' | 'null_phase' | 'swift';
export const STATUS_INDEX = Object.fromEntries(STATUS.map((s, i) => [s.id, i])) as Record<StatusId, number>;

export interface StatusInst {
  i: number; // index into STATUS
  until: number; // tick
  stacks: number;
  power: number; // applier attack power, for DoTs
  nextDot: number; // tick
  src: number; // applier entity id (threat / kill credit)
}
export interface Mods {
  move: number;
  atk: number;
  def: number;
  interval: number;
  stun: boolean;
  rune: number;
  lifesteal: number;
  cantDie: boolean;
  invuln: boolean;
  stealth: boolean;
  absorbMana: number;
}
export function modsOf(mask: number): Mods {
  const m: Mods = { move: 1, atk: 1, def: 1, interval: 1, stun: false, rune: 1, lifesteal: 0, cantDie: false, invuln: false, stealth: false, absorbMana: 0 };
  for (let i = 0; i < STATUS.length; i++) {
    if (!(mask & (1 << i))) continue;
    const s = STATUS[i];
    m.move *= s.moveMul ?? 1;
    m.atk *= s.atkMul ?? 1;
    m.def *= s.defMul ?? 1;
    m.interval *= s.intervalMul ?? 1;
    if (s.stun) m.stun = true;
    m.rune *= s.runeMul ?? 1;
    m.lifesteal += s.lifesteal ?? 0;
    if (s.cantDie) m.cantDie = true;
    if (s.invuln) m.invuln = true;
    if (s.stealth) m.stealth = true;
    m.absorbMana = Math.max(m.absorbMana, s.absorbMana ?? 0);
  }
  return m;
}
export const statusNames = (mask: number) => STATUS.filter((_, i) => mask & (1 << i)).map((s) => s.name);

/** Damage-event flags (bitmask on the wire). */
export const enum Dmg {
  Crit = 1,
  Miss = 2,
  Heal = 4,
  Dot = 8,
  Block = 16,
  Absorb = 32, // fully or partly soaked by a shield
}

/** Levels come in tiers of 30: 1-30 is tier 1, 31-60 tier 2 ... 181-200 tier 7. */
export const LEVEL_TIER_SIZE = 30;
export const levelTier = (level: number) => Math.max(1, Math.ceil(level / LEVEL_TIER_SIZE));
/** EXP_REQUIRED(L) = 40 x L^1.8 x 3^(TIER(L) - 1): each tier of 30 levels is three times as hard. */
export const expToNext = (level: number) => Math.round(40 * Math.pow(level, 1.8) * 3 ** (levelTier(level) - 1));
/** Damage after armour. Diminishing: every 25 defence is another "100% effective HP" step. */
export const mitigate = (raw: number, def: number) => (raw * 100) / (100 + Math.max(0, def) * 4);
/** Normal and elite monsters have this much more health than their table says (bosses as listed). */
export const MOB_HP_MUL = 2;
/** Damage over time that defence turns aside like a blow: poison and bleeding by defence, burns by magic defence. */
export const DOT_MAGIC: Record<string, boolean> = { poison: false, bleed: false, burn: true };
export const missChance = (attackerLevel: number, targetLevel: number) => Math.max(2, Math.min(25, 5 + (targetLevel - attackerLevel) * 2));
/**
 * Share of a monster's EXP received by level difference. Monsters at your level or above, or up
 * to 2 levels below, give everything; below that the share falls evenly and reaches nothing at
 * 30 levels below (for example 10 below: 71%, 20 below: 36%, 29 below: 4%).
 */
export const EXP_FLOOR_LEVELS = 30;
export const expLevelFactor = (playerLevel: number, monsterLevel: number) => {
  const below = playerLevel - monsterLevel;
  if (below <= 2) return 1;
  return Math.max(0, Math.round(((EXP_FLOOR_LEVELS - below) / (EXP_FLOOR_LEVELS - 2)) * 1000) / 1000);
};

export const RESPAWN_MIN_MS = 3000; // earliest manual respawn
export const RESPAWN_AUTO_MS = 12000;
/** G1: the dodge roll: how far, how long nothing can hurt the roller, and how often. */
export const DODGE = { dist: 72, iframeMs: 350, cdMs: 1500 };
/**
 * G1: basic attacks chain. Every third blow in a row (each within windowMs of the last) is a finisher
 * that hits harder and does what the class does best; a skill used soon after a finisher hits harder too.
 */
export const BASIC_COMBO = { hits: 3, windowMs: 1800, mul: 1.6, weaveMs: 1500, weaveMul: 1.2 };
export const FINISHERS: Record<string, string> = {
  knight: 'stuns the target (not bosses)',
  berserker: 'makes the target bleed',
  assassin: 'always strikes critically',
  ranger: 'pierces into a second monster behind',
  mage: 'bursts over monsters around the target',
  cleric: 'heals you for 3% of your health',
};
export const COMBAT_TIMEOUT_MS = 5000; // out-of-combat regeneration starts after this

/** Weapon mechanics executed by the server on basic attacks. */
export interface WeaponRule {
  magic?: boolean; // scales with magic attack vs magic resist
  ranged?: boolean; // projectile visual on the client
  block?: number; // % chance to halve an incoming physical hit
  cleave?: number; // damage fraction to up to 2 extra targets near the main one
  double?: number; // damage fraction of an immediate second strike
  pierce?: number; // fraction of target defence ignored
  poison?: number; // % chance to poison
  rageMul?: number; // berserker rage gain multiplier
}
export const WEAPON_RULES: Record<WeaponKind, WeaponRule> = {
  sword_shield: { block: 20 },
  greatsword: { cleave: 0.5 },
  staff: { magic: true, ranged: true },
  orb: { magic: true, ranged: true },
  bow: { ranged: true },
  crossbow: { ranged: true, pierce: 0.3 },
  daggers: { double: 0.4 },
  holy_staff: { magic: true, ranged: true },
  mace: {},
  axe: { cleave: 0.4 },
  dual_axe: { rageMul: 1.5 },
};
/** The assassin's second weapon slot is the venom variant of the same weapon kind. */
export const weaponRule = (job: Job, kind: WeaponKind, slot: number): WeaponRule =>
  job === 'assassin' && slot === 1 ? { double: 0.4, poison: 35 } : WEAPON_RULES[kind];

export const RAGE_PER_HIT = 8;
export const RAGE_PER_HIT_TAKEN = 4;
