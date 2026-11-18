// Monster definitions and spawn tables. Pure data; the AI lives in server/src/game/Monster.ts.
import type { StatusId } from './combat';
import { EXPANSION, EXPANSION_BY_ID } from './expansion';
import { DEPTH_LAYOUT, DEPTHS } from './depths';
import { MONSTER_TOWN_CLEAR, scaleTile, ZONES } from './world';

export interface MonsterAttack {
  name: string;
  /** Telegraph time. The attack resolves against wherever targets are when it ends, so it can be dodged. */
  windupMs: number;
  range: number; // distance at which the monster starts this attack
  mul: number; // damage multiplier on the monster's attack
  magic?: boolean;
  ranged?: boolean; // projectile; hits the target if still within range * 1.4
  /** Area attack radius. Centred on the monster if `self`, else on the aimed ground point. */
  aoe?: number;
  self?: boolean;
  /** Dash along the aim direction; damages the first player touched. */
  charge?: boolean;
  status?: { id: StatusId; chance: number };
  /** Area attack aimed at up to this many different players at once (each gets its own warning). */
  multi?: number;
  /** Ring attack around the monster: only players further than this are hit (stand close to be safe). */
  donut?: number;
  /** Calls allies instead of dealing damage. */
  summon?: { type: string; count: number };
}
export interface BossPhase {
  /** The phase starts when HP falls to this fraction (1 = from the start). */
  at: number;
  name: string;
  /** Announced to everyone in the zone when the phase starts. */
  say: string;
  pattern: MonsterAttack[];
  atk?: number; // attack multiplier in this phase
  interval?: number; // attack interval multiplier
  speed?: number;
}
export interface BossDef {
  title: string;
  phases: BossPhase[];
  /** After this long in one fight the boss goes berserk (triple damage). */
  enrageMs: number;
  /** World bosses live in open zones, track contribution and reward everyone who helped. */
  world?: boolean;
  intro: string;
}
export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  mdef: number;
  speed: number; // px/s when chasing
  /** Proximity aggro radius; 0 = neutral (fights back only). */
  aggro: number;
  leash: number; // max distance from spawn before giving up
  intervalMs: number; // pause between attacks
  exp: number;
  elite: boolean;
  radius: number; // body radius, added to attackers' reach
  /** Attack pattern, cycled in order. */
  pattern: MonsterAttack[];
  /** Pack hunters alert same-type monsters within 170px when they find a target. */
  pack?: boolean;
  /** Elites enrage below this HP fraction. */
  enrageAt?: number;
  respawnMs: number;
  flying?: boolean;
  boss?: BossDef;
  /** Runs from whoever attacks it and never fights back (the treasure goblin). */
  flee?: boolean;
  /** Never moves (a star fragment). */
  still?: boolean;
}

const bite = (mul = 1, extra: Partial<MonsterAttack> = {}): MonsterAttack => ({ name: 'Bite', windupMs: 350, range: 30, mul, ...extra });

export const MONSTERS: Record<string, MonsterDef> = {
  mossling: {
    id: 'mossling', name: 'Mossling', level: 1, hp: 60, atk: 8, def: 4, mdef: 4, speed: 70, aggro: 0, leash: 320, intervalMs: 1500, exp: 12,
    elite: false, radius: 9, respawnMs: 12000,
    pattern: [{ name: 'Bump', windupMs: 400, range: 28, mul: 1 }],
  },
  boar: {
    id: 'boar', name: 'Bramble Boar', level: 2, hp: 110, atk: 14, def: 8, mdef: 5, speed: 95, aggro: 150, leash: 420, intervalMs: 1400, exp: 22,
    elite: false, radius: 11, respawnMs: 15000,
    pattern: [bite(1, { name: 'Gore' }), bite(1, { name: 'Gore' }), { name: 'Charge', windupMs: 700, range: 150, mul: 1.6, charge: true, status: { id: 'bleed', chance: 40 } }],
  },
  duskwing: {
    id: 'duskwing', name: 'Duskwing', level: 3, hp: 95, atk: 17, def: 5, mdef: 8, speed: 130, aggro: 170, leash: 460, intervalMs: 1000, exp: 30,
    elite: false, radius: 8, respawnMs: 15000, flying: true,
    pattern: [bite(0.9, { name: 'Swoop', windupMs: 250 }), bite(0.9, { name: 'Swoop', windupMs: 250 }), { name: 'Screech', windupMs: 600, range: 60, mul: 0.6, aoe: 70, self: true, magic: true, status: { id: 'weaken', chance: 100 } }],
  },
  old_tusk: {
    id: 'old_tusk', name: 'Old Tusk', level: 5, hp: 900, atk: 30, def: 20, mdef: 14, speed: 100, aggro: 190, leash: 520, intervalMs: 1500, exp: 180,
    elite: true, radius: 16, respawnMs: 60000, enrageAt: 0.3,
    pattern: [
      bite(1, { name: 'Gore', range: 38 }),
      { name: 'Ground Slam', windupMs: 1000, range: 60, mul: 1.5, aoe: 85, self: true, status: { id: 'stun', chance: 100 } },
      bite(1, { name: 'Gore', range: 38 }),
      { name: 'Charge', windupMs: 800, range: 190, mul: 1.9, charge: true, status: { id: 'bleed', chance: 100 } },
    ],
  },
  spider: {
    id: 'spider', name: 'Glade Spider', level: 4, hp: 150, atk: 20, def: 9, mdef: 9, speed: 105, aggro: 170, leash: 460, intervalMs: 1500, exp: 42,
    elite: false, radius: 10, respawnMs: 15000,
    pattern: [
      { name: 'Venom Spit', windupMs: 450, range: 170, mul: 0.9, ranged: true, magic: true, status: { id: 'poison', chance: 50 } },
      { name: 'Web', windupMs: 700, range: 170, mul: 0.4, aoe: 44, magic: true, status: { id: 'slow', chance: 100 } },
      bite(1.1),
    ],
  },
  sporecap: {
    id: 'sporecap', name: 'Sporecap', level: 5, hp: 240, atk: 22, def: 14, mdef: 16, speed: 55, aggro: 120, leash: 360, intervalMs: 1800, exp: 55,
    elite: false, radius: 11, respawnMs: 18000,
    pattern: [{ name: 'Headbutt', windupMs: 450, range: 30, mul: 1 }, { name: 'Spore Cloud', windupMs: 900, range: 50, mul: 0.7, aoe: 75, self: true, magic: true, status: { id: 'poison', chance: 100 } }],
  },
  wolf: {
    id: 'wolf', name: 'Fen Wolf', level: 6, hp: 210, atk: 27, def: 11, mdef: 9, speed: 140, aggro: 200, leash: 560, intervalMs: 1100, exp: 68,
    elite: false, radius: 11, respawnMs: 18000, pack: true,
    pattern: [bite(1), bite(1), bite(1.4, { name: 'Rend', windupMs: 500, status: { id: 'bleed', chance: 70 } })],
  },
  rootwarden: {
    id: 'rootwarden', name: 'Rootwarden', level: 8, hp: 2200, atk: 44, def: 30, mdef: 22, speed: 70, aggro: 200, leash: 480, intervalMs: 1700, exp: 420,
    elite: true, radius: 18, respawnMs: 90000, enrageAt: 0.25,
    pattern: [
      { name: 'Branch Swipe', windupMs: 600, range: 46, mul: 1, aoe: 60, self: true },
      { name: 'Root Snare', windupMs: 900, range: 200, mul: 0.6, aoe: 50, magic: true, status: { id: 'slow', chance: 100 } },
      { name: 'Branch Swipe', windupMs: 600, range: 46, mul: 1, aoe: 60, self: true },
      { name: 'Earthshaker', windupMs: 1300, range: 80, mul: 1.8, aoe: 110, self: true, status: { id: 'stun', chance: 100 } },
    ],
  },
};

export interface SpawnGroup {
  type: string;
  count: number;
  tx: number;
  ty: number;
  r: number; // tiles
  /** Patrol radius in tiles (default: from the camp size). */
  patrol?: number;
}
export const SPAWNS: Record<string, SpawnGroup[]> = {
  eldoria: [
    { type: 'mossling', count: 6, tx: 30, ty: 64, r: 7 },
    { type: 'mossling', count: 6, tx: 67, ty: 36, r: 7 },
    { type: 'boar', count: 5, tx: 22, ty: 30, r: 8 },
    { type: 'boar', count: 4, tx: 76, ty: 72, r: 8 },
    { type: 'duskwing', count: 5, tx: 22, ty: 78, r: 7 },
    { type: 'duskwing', count: 4, tx: 78, ty: 20, r: 7 },
    { type: 'old_tusk', count: 1, tx: 12, ty: 14, r: 5 },
  ],
  verdant: [
    { type: 'spider', count: 6, tx: 24, ty: 34, r: 9 },
    { type: 'sporecap', count: 6, tx: 40, ty: 52, r: 9 },
    { type: 'wolf', count: 6, tx: 60, ty: 28, r: 10 },
    { type: 'spider', count: 5, tx: 70, ty: 58, r: 9 },
    { type: 'rootwarden', count: 1, tx: 84, ty: 40, r: 6 },
  ],
};

// ---------------------------------------------------------------------------------------------
// M7/M8 roster. Stats follow level curves so that every region plays at the same pace:
//   hp 40 + 24L, attack 6 + 3L + 0.2L^2 (player defence grows linearly and mitigation is
//   hyperbolic, so attack must outgrow it), defence 2 + 1.2L, EXP 8 * L^1.2.
// ---------------------------------------------------------------------------------------------
// Past level 60 health and defence grow more slowly, so fights keep the same length while players
// (whose attack grows linearly) level towards 200.
export const mobHp = (L: number) => (L <= 60 ? 40 + 24 * L : 1480 + 16 * (L - 60));
export const mobAtk = (L: number) => Math.round(6 + 3 * L + 0.2 * L * L);
export const mobDef = (L: number) => Math.round(L <= 60 ? 2 + 1.2 * L : 74 + 0.4 * (L - 60));
export const mobMdef = (L: number) => Math.round(L <= 60 ? 2 + 1.1 * L : 68 + 0.4 * (L - 60));
export const mobExp = (L: number) => Math.round(8 * L ** 1.2);
/**
 * Elites, bosses and world bosses get much harder every 20 levels: per step of 20, +20% health
 * and +10% attack (level 40: x1.4 / x1.2, level 100: x2 / x1.5, level 200: x3 / x2).
 */
export const BIG_STEP_LEVELS = 20;
export const bigStep = (L: number) => Math.floor(L / BIG_STEP_LEVELS);
export const bigHpMul = (L: number) => 1 + 0.2 * bigStep(L);
export const bigAtkMul = (L: number) => 1 + 0.1 * bigStep(L);
/** World bosses' area attacks are this much wider than those of other monsters. */
export const WORLD_BOSS_AREA = 1.5;
type Tier = 'normal' | 'elite' | 'boss' | 'world';
const TIER: Record<Tier, { hp: number; atk: number; exp: number; respawn: number; leash: number }> = {
  normal: { hp: 1, atk: 1, exp: 1, respawn: 18000, leash: 520 },
  elite: { hp: 8, atk: 1.3, exp: 6, respawn: 120000, leash: 600 },
  boss: { hp: 60, atk: 1.5, exp: 30, respawn: 0, leash: 900 },
  world: { hp: 250, atk: 1.7, exp: 60, respawn: 15 * 60000, leash: 800 },
};
function mob(id: string, name: string, L: number, tier: Tier, pattern: MonsterAttack[], o: Partial<MonsterDef> & { hpMul?: number; atkMul?: number } = {}): MonsterDef {
  const t = TIER[tier], { hpMul = 1, atkMul = 1, ...rest } = o, big = tier !== 'normal';
  return {
    id, name, level: L, hp: Math.round(mobHp(L) * t.hp * hpMul * (big ? bigHpMul(L) : 1)), atk: Math.round(mobAtk(L) * t.atk * atkMul * (big ? bigAtkMul(L) : 1)), def: mobDef(L), mdef: mobMdef(L),
    speed: 100, aggro: 180, leash: t.leash, intervalMs: 1500, exp: Math.round(mobExp(L) * t.exp), elite: tier !== 'normal', radius: tier === 'normal' ? 10 : tier === 'elite' ? 16 : 22,
    respawnMs: t.respawn, pattern, ...(tier === 'elite' ? { enrageAt: 0.3 } : {}), ...rest,
  };
}
const hit = (name: string, mul = 1, o: Partial<MonsterAttack> = {}): MonsterAttack => ({ name, windupMs: 400, range: 32, mul, ...o });
const spit = (name: string, st?: StatusId, chance = 50, o: Partial<MonsterAttack> = {}): MonsterAttack => ({ name, windupMs: 500, range: 190, mul: 0.9, ranged: true, magic: true, ...(st ? { status: { id: st, chance } } : {}), ...o });
const slam = (name: string, aoe: number, mul: number, st?: StatusId, o: Partial<MonsterAttack> = {}): MonsterAttack => ({ name, windupMs: 1000, range: Math.min(70, aoe * 0.7), mul, aoe, self: true, ...(st ? { status: { id: st, chance: 100 } } : {}), ...o });
const zone = (name: string, aoe: number, mul: number, st?: StatusId, o: Partial<MonsterAttack> = {}): MonsterAttack => ({ name, windupMs: 1100, range: 240, mul, aoe, magic: true, ...(st ? { status: { id: st, chance: 100 } } : {}), ...o });
const rush = (name: string, mul: number, st?: StatusId): MonsterAttack => ({ name, windupMs: 750, range: 190, mul, charge: true, ...(st ? { status: { id: st, chance: 100 } } : {}) });
const call = (type: string, count: number, name = 'Summon'): MonsterAttack => ({ name, windupMs: 1200, range: 400, mul: 0, summon: { type, count } });

const ROSTER: MonsterDef[] = [
  // ---- Ashen Highlands (10-18): fire and stone ----
  mob('ember_hound', 'Ember Hound', 11, 'normal', [hit('Bite'), hit('Bite'), rush('Pounce', 1.5, 'burn')], { speed: 145, pack: true, intervalMs: 1100, aggro: 200 }),
  mob('cinder_imp', 'Cinder Imp', 12, 'normal', [spit('Cinder Bolt', 'burn', 60), spit('Cinder Bolt', 'burn', 60), hit('Claw', 0.8, { windupMs: 250 })], { speed: 125, flying: true, hpMul: 0.8, radius: 8 }),
  mob('slag_beetle', 'Slag Beetle', 14, 'normal', [hit('Pincer', 1.1), slam('Molten Spray', 70, 0.9, 'burn', { magic: true, windupMs: 900 })], { speed: 70, hpMul: 1.5, aggro: 130 }),
  mob('ash_wraith', 'Ash Wraith', 16, 'normal', [spit('Withering Touch', 'weaken', 100, { range: 150 }), zone('Ash Cloud', 60, 0.8, 'slow')], { speed: 95, flying: true, hpMul: 0.9 }),
  mob('magma_brute', 'Magma Brute', 17, 'elite', [hit('Crush', 1.1, { range: 42 }), slam('Eruption', 100, 1.6, 'burn', { magic: true }), hit('Crush', 1.1, { range: 42 }), zone('Lava Bomb', 60, 1.3, 'burn', { multi: 2 })], { speed: 80 }),
  // ---- Frostveil (18-26): ice ----
  mob('snow_stalker', 'Snow Stalker', 19, 'normal', [hit('Bite'), hit('Bite'), hit('Hamstring', 1.3, { windupMs: 500, status: { id: 'slow', chance: 80 } })], { speed: 150, pack: true, intervalMs: 1100, aggro: 210 }),
  mob('ice_wisp', 'Ice Wisp', 20, 'normal', [spit('Frost Bolt', 'slow', 70), zone('Glacial Spike', 50, 1.1, 'root')], { speed: 90, flying: true, hpMul: 0.75, radius: 8 }),
  mob('rime_yeti', 'Rime Yeti', 22, 'normal', [hit('Maul', 1.2, { range: 38 }), hit('Maul', 1.2, { range: 38 }), slam('Snow Slam', 80, 1.3, 'slow')], { speed: 95, hpMul: 1.6 }),
  mob('glacier_beetle', 'Glacier Beetle', 24, 'normal', [hit('Pincer', 1.1), rush('Shell Charge', 1.6, 'stun')], { speed: 75, hpMul: 1.6, aggro: 130 }),
  mob('avalanche_elder', 'Avalanche Elder', 25, 'elite', [hit('Maul', 1.1, { range: 44 }), slam('Avalanche', 120, 1.7, 'stun', { windupMs: 1300 }), hit('Maul', 1.1, { range: 44 }), zone('Ice Boulder', 65, 1.4, 'slow', { multi: 3, magic: false })], { speed: 85 }),
  // ---- Dreadmoor (26-34): rot and shadow ----
  mob('bog_lurker', 'Bog Lurker', 27, 'normal', [hit('Engulf', 1, { status: { id: 'poison', chance: 60 } }), slam('Toxic Burst', 75, 0.9, 'poison', { magic: true, windupMs: 900 })], { speed: 65, hpMul: 1.4, aggro: 120 }),
  mob('grave_moth', 'Grave Moth', 28, 'normal', [hit('Flutter', 0.8, { windupMs: 250 }), hit('Flutter', 0.8, { windupMs: 250 }), slam('Dust of Sleep', 70, 0.5, 'weaken', { magic: true, windupMs: 700 })], { speed: 135, flying: true, hpMul: 0.8, radius: 8 }),
  mob('drowned_knight', 'Drowned Knight', 30, 'normal', [hit('Rusted Blade', 1.1, { range: 38 }), hit('Rusted Blade', 1.1, { range: 38 }), hit('Cleave', 1.5, { range: 44, aoe: 60, self: true, windupMs: 800, status: { id: 'bleed', chance: 100 } })], { speed: 90, hpMul: 1.3 }),
  mob('mire_serpent', 'Mire Serpent', 32, 'normal', [spit('Venom Spit', 'poison', 100), hit('Lunge', 1.4, { range: 44, windupMs: 450 }), rush('Coil Rush', 1.5, 'root')], { speed: 115 }),
  mob('gallows_tree', 'Gallows Tree', 33, 'elite', [slam('Lash', 70, 1, 'bleed', { windupMs: 650 }), zone('Grasping Roots', 55, 0.8, 'root', { multi: 3 }), slam('Lash', 70, 1, 'bleed', { windupMs: 650 }), slam('Rotfall', 130, 1.7, 'poison', { magic: true, windupMs: 1400 })], { speed: 60 }),
  // ---- Astral Ruins (34-45): constructs and the void ----
  mob('rune_sentinel', 'Rune Sentinel', 35, 'normal', [hit('Stone Fist', 1.2, { range: 40 }), zone('Rune Blast', 55, 1.1, 'shock')], { speed: 85, hpMul: 1.5 }),
  mob('void_ray', 'Void Ray', 37, 'normal', [spit('Void Lance', 'weaken', 60, { range: 210 }), spit('Void Lance', 'weaken', 60, { range: 210 }), rush('Dive', 1.5)], { speed: 140, flying: true, hpMul: 0.85 }),
  mob('star_wisp', 'Star Wisp', 39, 'normal', [spit('Starfire', 'burn', 70), zone('Falling Star', 60, 1.3, 'stun', { windupMs: 1300 })], { speed: 95, flying: true, hpMul: 0.75, radius: 8 }),
  mob('astral_stalker', 'Astral Stalker', 41, 'normal', [hit('Rend', 1.1, { status: { id: 'bleed', chance: 50 } }), hit('Rend', 1.1), rush('Blink Strike', 1.7, 'bleed')], { speed: 155, pack: true, intervalMs: 1000, aggro: 220 }),
  mob('echo_colossus', 'Echo Colossus', 43, 'elite', [hit('Hammer Arm', 1.1, { range: 46 }), slam('Resonance', 140, 1.5, 'shock', { donut: 60, magic: true, windupMs: 1300 }), hit('Hammer Arm', 1.1, { range: 46 }), zone('Echo Rift', 60, 1.3, 'slow', { multi: 3 })], { speed: 80 }),
  // ---- dungeon dwellers ----
  mob('ruin_bat', 'Ruin Bat', 8, 'normal', [hit('Bite', 0.9, { windupMs: 250 }), hit('Bite', 0.9, { windupMs: 250 }), slam('Screech', 70, 0.6, 'weaken', { magic: true, windupMs: 600 })], { speed: 135, flying: true, hpMul: 0.8, radius: 8 }),
  mob('ruin_sentry', 'Ruin Sentry', 9, 'normal', [hit('Stone Fist', 1.1, { range: 38 }), zone('Rune Spark', 50, 1, 'shock')], { speed: 85, hpMul: 1.4 }),
  mob('ruin_warden', 'Ruin Warden', 10, 'elite', [hit('Halberd', 1.1, { range: 46 }), slam('Sweep', 90, 1.4, 'bleed'), hit('Halberd', 1.1, { range: 46 }), zone('Seal of Binding', 60, 0.9, 'root', { multi: 2 })], { speed: 90, hpMul: 0.6 }),
  mob('dragon_whelp', 'Dragon Whelp', 17, 'normal', [spit('Flame Breath', 'burn', 80, { range: 150 }), hit('Snap', 1.1), rush('Swoop', 1.4)], { speed: 130, flying: true }),
  mob('frost_knight', 'Frostbound Knight', 25, 'normal', [hit('Ice Blade', 1.1, { range: 38, status: { id: 'slow', chance: 40 } }), hit('Ice Blade', 1.1, { range: 38 }), slam('Frozen Cleave', 70, 1.4, 'slow', { windupMs: 800 })], { speed: 95, hpMul: 1.3 }),
  mob('abyssal_cultist', 'Abyssal Cultist', 33, 'normal', [spit('Shadow Bolt', 'weaken', 50), spit('Shadow Bolt', 'weaken', 50), zone('Dark Rite', 60, 1.2, 'poison')], { speed: 95, hpMul: 0.9 }),

  // ---- bosses ----
  mob('rune_guardian', 'Ancient Rune Guardian', 10, 'boss', [], {
    speed: 85, radius: 24, intervalMs: 1700,
    boss: {
      title: 'Warden of the Sealed Vault', enrageMs: 6 * 60000, intro: 'Runes flare along the walls. The Ancient Rune Guardian awakens.',
      phases: [
        { at: 1, name: 'Dormant Seals', say: '', pattern: [hit('Stone Fist', 1, { range: 46 }), zone('Rune Blast', 60, 1.2, 'shock'), hit('Stone Fist', 1, { range: 46 }), slam('Tremor', 110, 1.5, 'stun', { windupMs: 1300 })] },
        { at: 0.6, name: 'Seals Unbound', say: 'The Guardian\'s seals shatter: runes rain across the vault!', atk: 1.15, pattern: [zone('Rune Storm', 55, 1.2, 'shock', { multi: 3 }), hit('Stone Fist', 1, { range: 46 }), slam('Runic Ring', 170, 1.6, 'shock', { donut: 70, magic: true, windupMs: 1500 }), call('ruin_sentry', 2, 'Awaken Sentries')] },
        { at: 0.25, name: 'Overload', say: 'The Guardian overloads: stay on the move!', atk: 1.3, interval: 0.75, pattern: [zone('Rune Storm', 55, 1.2, 'shock', { multi: 4 }), slam('Tremor', 110, 1.5, 'stun', { windupMs: 1200 }), slam('Runic Ring', 170, 1.6, 'shock', { donut: 70, magic: true, windupMs: 1300 })] },
      ],
    },
  }),
  mob('ancient_dragon', 'Ancient Dragon', 18, 'boss', [], {
    speed: 95, radius: 30, intervalMs: 1700,
    boss: {
      title: 'Vharzul, Ember of the First Dawn', enrageMs: 7 * 60000, intro: 'The mountain shudders. The Ancient Dragon opens one burning eye.',
      phases: [
        { at: 1, name: 'Grounded', say: '', pattern: [hit('Bite', 1.1, { range: 56 }), zone('Flame Breath', 90, 1.5, 'burn', { windupMs: 1200 }), slam('Tail Sweep', 120, 1.3, 'stun', { windupMs: 1000 }), hit('Bite', 1.1, { range: 56 })] },
        { at: 0.65, name: 'Skyfire', say: 'The Ancient Dragon takes wing: fire falls from above!', atk: 1.1, pattern: [zone('Meteor', 65, 1.5, 'burn', { multi: 4, windupMs: 1400 }), rush('Dive', 2, 'stun'), zone('Flame Breath', 90, 1.5, 'burn', { windupMs: 1100 }), call('dragon_whelp', 2, 'Call the Brood')] },
        { at: 0.3, name: 'Inferno', say: 'The Ancient Dragon burns white-hot. End this quickly!', atk: 1.3, interval: 0.75, pattern: [slam('Inferno Ring', 200, 1.8, 'burn', { donut: 80, magic: true, windupMs: 1500 }), zone('Meteor', 65, 1.5, 'burn', { multi: 5, windupMs: 1300 }), slam('Tail Sweep', 120, 1.3, 'stun', { windupMs: 900 }), rush('Dive', 2, 'stun')] },
      ],
    },
  }),
  mob('frost_queen', 'Frost Queen', 26, 'boss', [], {
    speed: 100, radius: 20, intervalMs: 1600,
    boss: {
      title: 'Ysolde of the Unmelting Throne', enrageMs: 7 * 60000, intro: 'Frost creeps over the floor. "Kneel, and the cold will be kind."',
      phases: [
        { at: 1, name: 'Court of Ice', say: '', pattern: [spit('Ice Lance', 'slow', 100, { range: 260, mul: 1.2 }), zone('Glacial Spike', 60, 1.3, 'root', { multi: 2 }), spit('Ice Lance', 'slow', 100, { range: 260, mul: 1.2 }), slam('Frost Nova', 120, 1.4, 'root', { magic: true })] },
        { at: 0.6, name: 'Blizzard', say: 'The Frost Queen calls the blizzard. Her knights rise!', atk: 1.15, pattern: [call('frost_knight', 2, 'Raise the Guard'), zone('Glacial Spike', 60, 1.3, 'root', { multi: 4 }), slam('Whiteout', 220, 1.5, 'slow', { donut: 90, magic: true, windupMs: 1500 }), spit('Ice Lance', 'slow', 100, { range: 260, mul: 1.3 })] },
        { at: 0.25, name: 'Absolute Zero', say: 'The air itself freezes. The Frost Queen will not fall alone!', atk: 1.3, interval: 0.7, pattern: [slam('Absolute Zero', 150, 2, 'stun', { magic: true, windupMs: 1700 }), zone('Glacial Spike', 60, 1.3, 'root', { multi: 5 }), slam('Whiteout', 220, 1.5, 'slow', { donut: 90, magic: true, windupMs: 1300 })] },
      ],
    },
  }),
  mob('abyssal_golem', 'Abyssal Golem', 34, 'boss', [], {
    speed: 80, radius: 28, intervalMs: 1800, hpMul: 1.15,
    boss: {
      title: 'Engine of the Drowned God', enrageMs: 8 * 60000, intro: 'Black water drains from the altar. Something vast stands up.',
      phases: [
        { at: 1, name: 'Stone Shell', say: '', pattern: [hit('Crushing Fist', 1.2, { range: 54 }), slam('Shockwave', 130, 1.5, 'stun', { windupMs: 1200 }), hit('Crushing Fist', 1.2, { range: 54 }), zone('Abyssal Pool', 70, 1.3, 'poison', { multi: 2 })] },
        { at: 0.7, name: 'Cracked Shell', say: 'The Golem\'s shell cracks: the abyss leaks through!', atk: 1.15, pattern: [zone('Abyssal Pool', 70, 1.3, 'poison', { multi: 4 }), rush('Juggernaut', 2.1, 'stun'), slam('Shockwave', 130, 1.5, 'stun', { windupMs: 1100 }), call('abyssal_cultist', 2, 'Summon the Faithful')] },
        { at: 0.35, name: 'Core Exposed', say: 'The core is exposed. The Golem tears the temple apart!', atk: 1.35, interval: 0.75, pattern: [slam('Collapse', 230, 1.8, 'weaken', { donut: 90, windupMs: 1500 }), zone('Abyssal Pool', 70, 1.3, 'poison', { multi: 5 }), rush('Juggernaut', 2.1, 'stun'), slam('Shockwave', 130, 1.5, 'stun', { windupMs: 1000 })] },
      ],
    },
  }),
  mob('shadow_knight', 'Shadow Knight', 30, 'world', [], {
    speed: 120, radius: 20, intervalMs: 1500,
    boss: {
      title: 'Ser Maldrec the Oathless', world: true, enrageMs: 10 * 60000, intro: 'A cold wind crosses Dreadmoor. The Shadow Knight rides again.',
      phases: [
        { at: 1, name: 'Duelist', say: '', pattern: [hit('Black Blade', 1.2, { range: 50 }), hit('Black Blade', 1.2, { range: 50 }), slam('Reaping Arc', 110, 1.5, 'bleed', { windupMs: 900 }), rush('Shadow Charge', 1.9, 'stun')] },
        { at: 0.6, name: 'Oathbreaker', say: 'The Shadow Knight casts off his oath: shades answer his call!', atk: 1.15, pattern: [call('drowned_knight', 3, 'Raise the Fallen'), zone('Grave Mark', 65, 1.4, 'weaken', { multi: 5 }), slam('Reaping Arc', 110, 1.5, 'bleed', { windupMs: 800 }), rush('Shadow Charge', 1.9, 'stun')] },
        { at: 0.25, name: 'Last Vow', say: 'The Shadow Knight swears his last vow. None shall leave!', atk: 1.35, interval: 0.7, pattern: [slam('Eclipse', 240, 1.8, 'weaken', { donut: 80, magic: true, windupMs: 1500 }), zone('Grave Mark', 65, 1.4, 'weaken', { multi: 6 }), rush('Shadow Charge', 1.9, 'stun'), slam('Reaping Arc', 110, 1.5, 'bleed', { windupMs: 700 })] },
      ],
    },
  }),
  mob('demon_lord', 'Demon Lord', 44, 'world', [], {
    speed: 105, radius: 30, intervalMs: 1600, hpMul: 1.2,
    boss: {
      title: 'Azgareth, Throne-Breaker', world: true, enrageMs: 12 * 60000, intro: 'The stars over the Astral Ruins go dark. The Demon Lord has crossed the rift.',
      phases: [
        { at: 1, name: 'Conqueror', say: '', pattern: [hit('Hellblade', 1.2, { range: 58 }), zone('Hellfire', 70, 1.4, 'burn', { multi: 4 }), slam('Dread Stomp', 140, 1.5, 'stun', { windupMs: 1100 }), hit('Hellblade', 1.2, { range: 58 })] },
        { at: 0.7, name: 'Legion', say: 'The Demon Lord opens the rift: his legion pours through!', atk: 1.1, pattern: [call('void_ray', 3, 'Open the Rift'), zone('Hellfire', 70, 1.4, 'burn', { multi: 6 }), rush('Wings of Ruin', 2, 'stun'), slam('Dread Stomp', 140, 1.5, 'stun', { windupMs: 1000 })] },
        { at: 0.4, name: 'Cataclysm', say: 'The ground splits. Stand close to the Demon Lord or burn!', atk: 1.25, pattern: [slam('Cataclysm', 280, 2, 'burn', { donut: 90, magic: true, windupMs: 1700 }), zone('Hellfire', 70, 1.4, 'burn', { multi: 6 }), slam('Dread Stomp', 140, 1.5, 'stun', { windupMs: 900 }), rush('Wings of Ruin', 2, 'stun')] },
        { at: 0.15, name: 'Unbound', say: 'The Demon Lord sheds his last chain. Finish him!', atk: 1.5, interval: 0.65, pattern: [zone('Hellfire', 70, 1.4, 'burn', { multi: 8 }), slam('Cataclysm', 280, 2, 'burn', { donut: 90, magic: true, windupMs: 1400 }), rush('Wings of Ruin', 2, 'stun')] },
      ],
    },
  }),
];
for (const m of ROSTER) MONSTERS[m.id] = m;

// ---- levels 45-200 (expansion.ts): monsters built from an existing one's attacks and art ----
const tierOf = (d: MonsterDef): Tier => (d.boss?.world ? 'world' : d.boss ? 'boss' : d.elite ? 'elite' : 'normal');
function derive(id: string, name: string, from: string, L: number, tier: Tier, o: Partial<MonsterDef> = {}): MonsterDef {
  const src = MONSTERS[from];
  if (!src) throw new Error(`expansion monster ${id}: unknown template ${from}`);
  const st = TIER[tierOf(src)], hpMul = Math.max(0.6, Math.min(1.8, src.hp / (mobHp(src.level) * st.hp * (tierOf(src) === 'normal' ? 1 : bigHpMul(src.level)))));
  const copy = JSON.parse(JSON.stringify({ pattern: src.pattern, boss: src.boss ?? null })) as { pattern: MonsterAttack[]; boss: BossDef | null };
  return mob(id, name, L, tier, copy.pattern, {
    speed: src.speed, aggro: src.aggro, intervalMs: src.intervalMs, radius: src.radius, hpMul,
    ...(src.flying ? { flying: true } : {}), ...(src.pack ? { pack: true } : {}), ...(copy.boss ? { boss: copy.boss } : {}), ...o,
  });
}
for (const e of EXPANSION) {
  const [lo, hi] = e.level, span = hi - lo;
  const levels = [lo + 2, lo + Math.round(span * 0.3), lo + Math.round(span * 0.55), lo + Math.round(span * 0.75)];
  e.mobs.slice(0, 4).forEach((x, i) => (MONSTERS[x.id] = derive(x.id, x.name, x.from, levels[i], 'normal')));
  const el = e.mobs[4];
  MONSTERS[el.id] = derive(el.id, el.name, el.from, hi - 2, 'elite');
  const minion = e.mobs[0].id, b = e.dungeon.boss;
  const bd = derive(b.id, b.name, b.from, e.dungeon.bossLevel, 'boss');
  bd.boss!.title = b.title;
  bd.boss!.intro = b.intro;
  bd.boss!.phases.forEach((ph, i) => {
    if (i) ph.say = i === bd.boss!.phases.length - 1 ? `${b.name} is enraged. End this quickly!` : `${b.name} grows stronger!`;
    for (const a of ph.pattern) if (a.summon) a.summon.type = minion;
  });
  MONSTERS[b.id] = bd;
  if (e.world) {
    const w = e.world, wd = derive(w.id, w.name, w.from, w.level, 'world');
    wd.boss!.title = w.title;
    wd.boss!.intro = w.intro;
    wd.boss!.phases.forEach((ph, i) => {
      if (i) ph.say = i === wd.boss!.phases.length - 1 ? `${w.name} unleashes everything. Finish it!` : `${w.name} grows stronger!`;
      for (const a of ph.pattern) if (a.summon) a.summon.type = e.mobs[3].id;
    });
    MONSTERS[w.id] = wd;
  }
}
// the bosses of the Depths (depths.ts): as strong as a world boss of their level
for (const d of DEPTHS) {
  const b = d.boss, bd = derive(b.id, b.name, b.from, b.level, 'world'), minion = b.minion ?? EXPANSION_BY_ID[d.host]?.mobs[3].id;
  bd.boss!.title = b.title;
  bd.boss!.intro = b.intro;
  bd.boss!.phases.forEach((ph, i) => {
    if (i) ph.say = i === bd.boss!.phases.length - 1 ? `${b.name} unleashes everything. Finish it!` : `${b.name} grows stronger!`;
    for (const a of ph.pattern) if (a.summon && minion) a.summon.type = minion;
  });
  MONSTERS[b.id] = bd;
}
// world events: a fragment of the fallen star (break it open) and the treasure goblin (catch it)
MONSTERS.star_fragment = mob('star_fragment', 'Star Fragment', 30, 'normal', [slam('Star Pulse', 70, 0.6, 'shock', { magic: true, windupMs: 1400 })], { speed: 0, aggro: 0, still: true, radius: 16, respawnMs: 0, hpMul: 0.5 });
MONSTERS.treasure_goblin = mob('treasure_goblin', 'Treasure Goblin', 30, 'normal', [hit('Flail', 0.1)], { speed: 170, aggro: 0, flee: true, radius: 11, respawnMs: 0, hpMul: 1.2 });
// the raid boss: Aetherion's Shadow (a world-boss pattern, far stronger; scaled to the raid when it is spawned)
{
  const src = MONSTERS.demon_lord, copy = JSON.parse(JSON.stringify(src.boss)) as BossDef;
  copy.title = 'What the Fallen Star Left Behind';
  copy.intro = 'The throne room goes dark. Aetherion\'s Shadow stands up.';
  copy.world = false;
  copy.enrageMs = 15 * 60000;
  copy.phases.forEach((ph, i) => {
    if (i) ph.say = i === copy.phases.length - 1 ? 'Aetherion\'s Shadow tears at the light itself. Finish it!' : 'Aetherion\'s Shadow grows stronger!';
    for (const a of ph.pattern) {
      if (a.summon) a.summon.type = 'echo_colossus';
      if (a.aoe) a.aoe = Math.round(a.aoe * 1.4);
      if (a.multi) a.multi = a.multi + 4;
    }
  });
  MONSTERS.raid_shadow = { ...src, id: 'raid_shadow', name: "Aetherion's Shadow", level: 100, hp: Math.round(src.hp * 3), radius: 34, boss: copy, respawnMs: 0 };
}
// world bosses: wider area attacks than any other monster
for (const d of Object.values(MONSTERS))
  if (d.boss?.world) for (const ph of d.boss.phases) for (const a of ph.pattern) if (a.aoe) a.aoe = Math.round(a.aoe * WORLD_BOSS_AREA);
/** The attacks a monster uses right now (bosses change pattern with their phase). */
export const patternOf = (def: MonsterDef, phase: number): MonsterAttack[] => (def.boss ? def.boss.phases[phase].pattern : def.pattern);
/** The phase a boss is in at a given HP fraction. Shared so the client can label the boss bar without extra network data. */
export function phaseAt(def: MonsterDef, frac: number): number {
  let ph = 0;
  if (def.boss) for (let i = 1; i < def.boss.phases.length; i++) if (frac <= def.boss.phases[i].at) ph = i;
  return ph;
}

Object.assign(SPAWNS, {
  ashen: [
    { type: 'ember_hound', count: 7, tx: 26, ty: 30, r: 10 }, { type: 'cinder_imp', count: 6, tx: 50, ty: 62, r: 10 }, { type: 'slag_beetle', count: 6, tx: 70, ty: 26, r: 9 },
    { type: 'ash_wraith', count: 6, tx: 84, ty: 62, r: 9 }, { type: 'ember_hound', count: 5, tx: 100, ty: 30, r: 8 }, { type: 'magma_brute', count: 1, tx: 60, ty: 12, r: 4 },
  ],
  frostveil: [
    { type: 'snow_stalker', count: 7, tx: 26, ty: 28, r: 10 }, { type: 'ice_wisp', count: 6, tx: 48, ty: 64, r: 10 }, { type: 'rime_yeti', count: 6, tx: 72, ty: 28, r: 9 },
    { type: 'glacier_beetle', count: 6, tx: 88, ty: 64, r: 9 }, { type: 'snow_stalker', count: 5, tx: 100, ty: 26, r: 8 }, { type: 'avalanche_elder', count: 1, tx: 58, ty: 12, r: 4 },
  ],
  dreadmoor: [
    { type: 'bog_lurker', count: 7, tx: 26, ty: 30, r: 10 }, { type: 'grave_moth', count: 6, tx: 46, ty: 62, r: 10 }, { type: 'drowned_knight', count: 6, tx: 72, ty: 28, r: 9 },
    { type: 'mire_serpent', count: 6, tx: 88, ty: 62, r: 9 }, { type: 'gallows_tree', count: 1, tx: 20, ty: 68, r: 4 },
  ],
  astral: [
    { type: 'rune_sentinel', count: 7, tx: 26, ty: 30, r: 10 }, { type: 'void_ray', count: 6, tx: 48, ty: 62, r: 10 }, { type: 'star_wisp', count: 6, tx: 72, ty: 28, r: 9 },
    { type: 'astral_stalker', count: 6, tx: 88, ty: 62, r: 9 }, { type: 'echo_colossus', count: 1, tx: 24, ty: 68, r: 4 },
  ],
});
// the expansion regions: four camps of ordinary monsters (one type twice) and the elite's lair
EXPANSION.forEach((e, i) => {
  const [a, b, c, d, el] = e.mobs.map((x) => x.id);
  SPAWNS[e.id] = [
    { type: a, count: 7, tx: 30, ty: 30, r: 10 }, { type: b, count: 6, tx: 48, ty: 60, r: 10 }, { type: c, count: 6, tx: 74, ty: 28, r: 9 },
    { type: d, count: 6, tx: 86, ty: 60, r: 9 }, { type: a, count: 5, tx: 102, ty: 46, r: 8 },
    { type: el, count: 1, tx: e.world ? 24 : 60, ty: e.world ? 66 : 12, r: 4 },
  ];
  if (i % 2) SPAWNS[e.id][1].tx = 40; // keep clear of a gate further east
});
// the Depths: the host region's monsters in seven camps, and its elite in two lairs
for (const d of DEPTHS) {
  const types = [...new Set((SPAWNS[d.host] ?? []).map((g) => g.type))], normal = types.filter((t) => !MONSTERS[t].elite && !MONSTERS[t].boss), elite = types.find((t) => MONSTERS[t].elite && !MONSTERS[t].boss);
  SPAWNS[d.id] = [
    ...DEPTH_LAYOUT.camps.map((c) => ({ type: normal[c.n % normal.length], count: c.count, tx: c.tx, ty: c.ty, r: c.r })),
    ...(elite ? DEPTH_LAYOUT.elites.map((e) => ({ type: elite, count: 1, tx: e.tx, ty: e.ty, r: 4 })) : []),
  ];
}
// Open-world maps are 1.5 times their designed size (world.ts): camps move with the map, spread
// over more ground and hold more monsters.
export const MAP_CAMP_COUNT = 1.3;
for (const groups of Object.values(SPAWNS))
  for (const g of groups) {
    g.tx = scaleTile(g.tx);
    g.ty = scaleTile(g.ty);
    const big = MONSTERS[g.type]?.elite || MONSTERS[g.type]?.boss;
    if (!big) {
      g.r = Math.round(g.r * 1.3);
      g.count = Math.round(g.count * MAP_CAMP_COUNT);
    }
  }
// camps keep well away from villages: a camp too close is moved straight out from the village
for (const [zone, groups] of Object.entries(SPAWNS)) {
  const z = ZONES[zone], t = z?.town;
  if (!t) continue;
  for (const g of groups) {
    const want = MONSTER_TOWN_CLEAR + g.r * 0.7, dx = g.tx - t.tx, dy = g.ty - t.ty, d = Math.hypot(dx, dy);
    if (d >= want) continue;
    const ux = d ? dx / d : 1, uy = d ? dy / d : 0;
    g.tx = Math.max(4 + g.r, Math.min(z.w - 5 - g.r, Math.round(t.tx + ux * want)));
    g.ty = Math.max(4 + g.r, Math.min(z.h - 5 - g.r, Math.round(t.ty + uy * want)));
  }
}
// ---------------------------------------------------------------------------------------------
// Population: camps hold more monsters than first designed, and the open world refills faster.
// Applied once here so every region, the spawn audit and the documentation agree.
// ---------------------------------------------------------------------------------------------
/** Ordinary camps hold this many times their designed count; their ground grows to keep monsters apart. */
export const SPAWN_DENSITY = 1.6;
/** Respawn time as a share of the designed time: ordinary monsters and elites. Bosses are unchanged. */
export const RESPAWN_SPEED = { normal: 0.45, elite: 0.6 };
for (const d of Object.values(MONSTERS)) {
  if (d.boss || !(d.respawnMs > 0)) continue;
  d.respawnMs = Math.round(d.respawnMs * (d.elite ? RESPAWN_SPEED.elite : RESPAWN_SPEED.normal));
}
for (const groups of Object.values(SPAWNS))
  for (const g of groups) {
    const d = MONSTERS[g.type];
    if (!d || d.elite || d.boss) continue;
    g.count = Math.round(g.count * SPAWN_DENSITY);
    g.r = Math.round(g.r * Math.sqrt(SPAWN_DENSITY) * 0.95);
  }

/** World bosses: one per channel of their zone, back `respawnMs` after they fall. */
export const WORLD_BOSSES: { type: string; zone: string; tx: number; ty: number }[] = [
  { type: 'shadow_knight', zone: 'dreadmoor', tx: 60, ty: 12 },
  { type: 'demon_lord', zone: 'astral', tx: 60, ty: 12 },
  ...EXPANSION.filter((e) => e.world).map((e) => ({ type: e.world!.id, zone: e.id, tx: 60, ty: 12 })),
].map((b) => ({ ...b, tx: scaleTile(b.tx), ty: scaleTile(b.ty) }));

/** The bosses of the Depths: one per channel, back after the same time as a world boss. */
export const DEPTH_BOSSES: { type: string; zone: string; tx: number; ty: number }[] = DEPTHS.map((d) => ({ type: d.boss.id, zone: d.id, tx: scaleTile(DEPTH_LAYOUT.boss.tx), ty: scaleTile(DEPTH_LAYOUT.boss.ty) }));

/** Default patrol radius for a camp, in tiles: monsters roam this far from where they spawned. */
export const patrolTiles = (g: SpawnGroup) => g.patrol ?? Math.max(3, Math.min(5, g.r));
/** A spawn region as configuration: everything about where and how a camp of monsters lives. */
export interface SpawnRegion {
  id: string;
  map: string;
  monster: string;
  /** Centre and radius (tiles) of the area spawn points are drawn from. */
  center: { tx: number; ty: number };
  radius: number;
  count: number;
  respawnMs: number;
  /** World units. */
  patrolRadius: number;
  aggroRadius: number;
  leashRadius: number;
  level: [number, number];
  /** Rules a spawn point must satisfy. */
  restrictions: string[];
}
export function spawnRegions(zone: string): SpawnRegion[] {
  return (SPAWNS[zone] ?? []).map((g, i) => {
    const d = MONSTERS[g.type];
    return {
      id: `${zone}:${i}:${g.type}`, map: zone, monster: g.type, center: { tx: g.tx, ty: g.ty }, radius: g.r, count: g.count, respawnMs: d.respawnMs,
      patrolRadius: patrolTiles(g) * 32, aggroRadius: d.aggro, leashRadius: d.leash, level: [d.level, d.level],
      restrictions: d.flying ? ['inside the map'] : ['walkable', 'not inside an obstacle', 'connected to the zone', 'room to move', 'away from arrival points', 'apart from other monsters'],
    };
  });
}
