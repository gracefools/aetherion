// Job definitions: the single source of truth for attributes, derived stats, weapons, passives,
// skill trees and job progression. Pure data + pure functions; the server is the only authority
// that applies them, the client imports the same file for display.
import type { Job } from './protocol';

export const ATTRS = ['str', 'dex', 'int', 'vit', 'spi'] as const;
export type Attr = (typeof ATTRS)[number];
export type Attrs = Record<Attr, number>;
export const ATTR_NAMES: Record<Attr, string> = { str: 'Strength', dex: 'Dexterity', int: 'Intellect', vit: 'Vitality', spi: 'Spirit' };

export type WeaponKind =
  | 'sword_shield' | 'greatsword' | 'staff' | 'orb' | 'bow' | 'crossbow'
  | 'daggers' | 'holy_staff' | 'mace' | 'axe' | 'dual_axe';

export interface WeaponSpec {
  kind: WeaponKind;
  name: string;
  /** Multipliers applied while this weapon type is equipped. */
  atkMul?: number;
  matkMul?: number;
  defMul?: number;
  intervalMul?: number;
  critAdd?: number;
  note: string;
}

export interface Stats {
  maxHp: number;
  maxRes: number;
  atk: number;
  matk: number;
  def: number;
  mdef: number;
  crit: number; // percent
  critDmg: number; // multiplier
  healPower: number; // multiplier
  lifesteal: number; // percent
  moveMul: number;
  atkIntervalMs: number;
  range: number;
  dodge: number; // percent chance to avoid a monster hit
  runeCost: number; // multiplier on rune mana costs
  runeLevel: number; // bonus levels added to every attuned rune
}
export type StatKey = keyof Stats;

export interface Passive {
  id: string;
  name: string;
  level: number;
  desc: string;
  /** Stat modifiers applied by computeStats. Triggered effects (procs) are executed by the combat system in M3. */
  mul?: Partial<Record<StatKey, number>>;
  add?: Partial<Record<StatKey, number>>;
  trigger?: string;
}

export interface SkillNode {
  id: string;
  name: string;
  type: 'active' | 'passive';
  tier: 1 | 2 | 3;
  level: number;
  requires?: string[];
  maxRank: number;
  desc: string;
}

export interface JobDef {
  id: Job;
  name: string;
  role: string;
  identity: string;
  resource: 'mana' | 'rage';
  base: Attrs;
  growth: Attrs; // per level
  hpBase: number;
  hpPerVit: number;
  resBase: number;
  resPerInt: number;
  resPerSpi: number;
  atk: Partial<Attrs>; // attribute weights
  defMul: number;
  critBase: number;
  critDmg: number;
  lifesteal: number;
  moveMul: number;
  atkIntervalMs: number;
  range: number;
  weapons: [WeaponSpec, WeaponSpec];
  passives: Passive[];
  skills: SkillNode[];
  tiers: { level: number; title: string }[];
}

const sk = (id: string, name: string, type: 'active' | 'passive', tier: 1 | 2 | 3, level: number, maxRank: number, desc: string, requires?: string[]): SkillNode =>
  ({ id, name, type, tier, level, maxRank, desc, requires });

export const JOB_DEFS: Record<Job, JobDef> = {
  knight: {
    id: 'knight', name: 'Knight', role: 'Tank', resource: 'mana',
    identity: 'Holds the line. Draws enemy attention and survives what others cannot.',
    base: { str: 9, dex: 5, int: 3, vit: 10, spi: 4 }, growth: { str: 2.2, dex: 1.0, int: 0.5, vit: 2.8, spi: 0.8 },
    hpBase: 140, hpPerVit: 12, resBase: 40, resPerInt: 2, resPerSpi: 4,
    atk: { str: 2.0, vit: 0.3 }, defMul: 1.4, critBase: 3, critDmg: 1.5, lifesteal: 0, moveMul: 0.95, atkIntervalMs: 900, range: 40,
    weapons: [
      { kind: 'sword_shield', name: 'Sword and Shield', defMul: 1.2, note: '+20% defense, can block' },
      { kind: 'greatsword', name: 'Greatsword', atkMul: 1.25, intervalMul: 1.2, note: '+25% attack, slower swings, cleaves' },
    ],
    passives: [
      { id: 'bulwark', name: 'Bulwark', level: 1, desc: '+10% defense.', mul: { def: 1.1 } },
      { id: 'iron_will', name: 'Iron Will', level: 10, desc: '+12% maximum HP.', mul: { maxHp: 1.12 } },
      { id: 'retribution', name: 'Retribution', level: 25, desc: 'Blocking an attack empowers the next strike.', trigger: 'on_block' },
    ],
    skills: [
      sk('shield_bash', 'Shield Bash', 'active', 1, 1, 5, 'Strike with the shield, briefly stunning the target.'),
      sk('taunt', 'Taunt', 'active', 1, 3, 3, 'Force nearby enemies to attack you.'),
      sk('guard_stance', 'Guard Stance', 'active', 2, 10, 5, 'Greatly reduce damage taken for a short time.', ['shield_bash']),
      sk('cleave', 'Cleave', 'active', 2, 12, 5, 'Wide swing that hits all enemies in front.'),
      sk('fortify', 'Fortify', 'passive', 2, 15, 5, 'Increase armor from equipment.', ['guard_stance']),
      sk('rallying_cry', 'Rallying Cry', 'active', 3, 25, 3, 'Raise the defense of all party members.', ['taunt']),
      sk('last_stand', 'Last Stand', 'active', 3, 35, 1, 'Cannot fall below 1 HP for a few seconds.', ['fortify']),
    ],
    tiers: [{ level: 1, title: 'Knight' }, { level: 20, title: 'Vanguard' }, { level: 45, title: 'Aegis Lord' }],
  },
  mage: {
    id: 'mage', name: 'Mage', role: 'Magic DPS', resource: 'mana',
    identity: 'Elemental rune caster. Fragile, long range, strongest area damage.',
    base: { str: 3, dex: 5, int: 11, vit: 4, spi: 8 }, growth: { str: 0.4, dex: 0.9, int: 3.0, vit: 1.0, spi: 2.0 },
    hpBase: 70, hpPerVit: 8, resBase: 120, resPerInt: 6, resPerSpi: 4,
    atk: { str: 1.0 }, defMul: 0.7, critBase: 5, critDmg: 1.5, lifesteal: 0, moveMul: 1.0, atkIntervalMs: 1100, range: 260,
    weapons: [
      { kind: 'staff', name: 'Staff', matkMul: 1.15, note: '+15% magic attack' },
      { kind: 'orb', name: 'Magic Orb', intervalMul: 0.85, critAdd: 4, note: 'Faster casts, +4% crit' },
    ],
    passives: [
      { id: 'arcane_mind', name: 'Arcane Mind', level: 1, desc: '+10% maximum mana.', mul: { maxRes: 1.1 } },
      { id: 'elemental_attunement', name: 'Elemental Attunement', level: 10, desc: '+8% magic attack.', mul: { matk: 1.08 } },
      { id: 'overflow', name: 'Overflow', level: 25, desc: 'Critical spells refund part of their mana cost.', trigger: 'on_spell_crit' },
    ],
    skills: [
      sk('arcane_bolt', 'Arcane Bolt', 'active', 1, 1, 5, 'Fast single-target bolt.'),
      sk('rune_focus', 'Rune Focus', 'passive', 1, 3, 5, 'Reduce rune mana costs.'),
      sk('blink', 'Blink', 'active', 2, 10, 3, 'Teleport a short distance.'),
      sk('elemental_surge', 'Elemental Surge', 'active', 2, 12, 5, 'Next rune spell deals bonus area damage.', ['arcane_bolt']),
      sk('mana_shield', 'Mana Shield', 'active', 2, 15, 5, 'Absorb damage with mana.', ['rune_focus']),
      sk('rune_mastery', 'Rune Mastery', 'passive', 3, 25, 5, 'Increase the level of all slotted runes.', ['elemental_surge']),
      sk('cataclysm', 'Cataclysm', 'active', 3, 35, 1, 'Channel a massive area explosion.', ['rune_mastery']),
    ],
    tiers: [{ level: 1, title: 'Mage' }, { level: 20, title: 'Runeweaver' }, { level: 45, title: 'Archmagus' }],
  },
  ranger: {
    id: 'ranger', name: 'Ranger', role: 'Ranged DPS', resource: 'mana',
    identity: 'Sustained ranged damage, traps and poison. Controls space.',
    base: { str: 5, dex: 10, int: 4, vit: 6, spi: 5 }, growth: { str: 1.0, dex: 2.8, int: 0.6, vit: 1.4, spi: 1.0 },
    hpBase: 90, hpPerVit: 9, resBase: 60, resPerInt: 2, resPerSpi: 3,
    atk: { dex: 2.0, str: 0.4 }, defMul: 0.9, critBase: 13, critDmg: 1.75, lifesteal: 0, moveMul: 1.05, atkIntervalMs: 800, range: 240,
    weapons: [
      { kind: 'bow', name: 'Bow', intervalMul: 0.9, note: 'Faster shots' },
      { kind: 'crossbow', name: 'Crossbow', atkMul: 1.3, intervalMul: 1.3, note: '+30% attack, slow reload, pierces' },
    ],
    passives: [
      { id: 'eagle_eye', name: 'Eagle Eye', level: 1, desc: '+5% critical chance.', add: { crit: 5 } },
      { id: 'steady_aim', name: 'Steady Aim', level: 10, desc: '+15% critical damage.', add: { critDmg: 0.15 } },
      { id: 'toxicology', name: 'Toxicology', level: 25, desc: 'Poisons last longer and stack once more.', trigger: 'on_poison' },
    ],
    skills: [
      sk('power_shot', 'Power Shot', 'active', 1, 1, 5, 'Charged shot with bonus critical chance.'),
      sk('snare_trap', 'Snare Trap', 'active', 1, 3, 5, 'Place a trap that roots the first enemy to step on it.'),
      sk('poison_arrow', 'Poison Arrow', 'active', 2, 10, 5, 'Arrow that applies damage over time.', ['power_shot']),
      sk('explosive_trap', 'Explosive Trap', 'active', 2, 12, 5, 'Trap that detonates for area damage.', ['snare_trap']),
      sk('fleet_step', 'Fleet Step', 'active', 2, 15, 3, 'Leap backwards, away from the target.'),
      sk('volley', 'Volley', 'active', 3, 25, 5, 'Rain arrows over an area.', ['poison_arrow']),
      sk('hunters_mark', "Hunter's Mark", 'active', 3, 35, 1, 'Marked target takes more damage from the whole party.', ['volley']),
    ],
    tiers: [{ level: 1, title: 'Ranger' }, { level: 20, title: 'Pathfinder' }, { level: 45, title: 'Stormwarden' }],
  },
  assassin: {
    id: 'assassin', name: 'Assassin', role: 'Burst DPS', resource: 'mana',
    identity: 'Stealth opener and critical burst. Fastest on foot, least forgiving.',
    base: { str: 6, dex: 11, int: 3, vit: 5, spi: 4 }, growth: { str: 1.4, dex: 3.0, int: 0.4, vit: 1.1, spi: 0.8 },
    hpBase: 85, hpPerVit: 9, resBase: 50, resPerInt: 2, resPerSpi: 3,
    atk: { dex: 1.7, str: 0.8 }, defMul: 0.8, critBase: 17, critDmg: 2.0, lifesteal: 0, moveMul: 1.15, atkIntervalMs: 600, range: 36,
    weapons: [
      { kind: 'daggers', name: 'Dual Daggers', critAdd: 5, note: '+5% crit, attacks strike twice' },
      { kind: 'daggers', name: 'Venom Daggers', atkMul: 0.9, note: '-10% attack, hits apply poison' },
    ],
    passives: [
      { id: 'fleet_foot', name: 'Fleet Foot', level: 1, desc: '+5% movement speed.', mul: { moveMul: 1.05 } },
      { id: 'lethality', name: 'Lethality', level: 10, desc: '+20% critical damage.', add: { critDmg: 0.2 } },
      { id: 'ambush', name: 'Ambush', level: 25, desc: 'Attacks from stealth always critically hit.', trigger: 'from_stealth' },
    ],
    skills: [
      sk('backstab', 'Backstab', 'active', 1, 1, 5, 'Heavy strike; bonus damage from behind.'),
      sk('stealth', 'Stealth', 'active', 1, 3, 3, 'Become invisible to enemies until you attack.'),
      sk('shadow_step', 'Shadow Step', 'active', 2, 10, 3, 'Dash behind the target.', ['stealth']),
      sk('twin_fangs', 'Twin Fangs', 'active', 2, 12, 5, 'Two rapid strikes with high crit chance.', ['backstab']),
      sk('evasion', 'Evasion', 'passive', 2, 15, 5, 'Chance to dodge attacks.'),
      sk('smoke_bomb', 'Smoke Bomb', 'active', 3, 25, 3, 'Blind nearby enemies and re-enter stealth.', ['shadow_step']),
      sk('death_mark', 'Death Mark', 'active', 3, 35, 1, 'After a delay the target takes a share of damage dealt.', ['twin_fangs']),
    ],
    tiers: [{ level: 1, title: 'Assassin' }, { level: 20, title: 'Nightblade' }, { level: 45, title: 'Umbral Phantom' }],
  },
  cleric: {
    id: 'cleric', name: 'Cleric', role: 'Healer / Support', resource: 'mana',
    identity: 'Keeps the party alive. Heals, buffs and resurrects.',
    base: { str: 4, dex: 4, int: 8, vit: 7, spi: 11 }, growth: { str: 0.7, dex: 0.7, int: 1.8, vit: 1.6, spi: 3.0 },
    hpBase: 100, hpPerVit: 10, resBase: 110, resPerInt: 3, resPerSpi: 6,
    atk: { str: 1.4, spi: 0.4 }, defMul: 1.0, critBase: 4, critDmg: 1.5, lifesteal: 0, moveMul: 1.0, atkIntervalMs: 1000, range: 200,
    weapons: [
      { kind: 'holy_staff', name: 'Holy Staff', matkMul: 1.1, note: '+10% magic attack and healing at range' },
      { kind: 'mace', name: 'Mace', atkMul: 1.3, defMul: 1.1, note: 'Melee: +30% attack, +10% defense' },
    ],
    passives: [
      { id: 'devotion', name: 'Devotion', level: 1, desc: '+10% healing power.', mul: { healPower: 1.1 } },
      { id: 'serenity', name: 'Serenity', level: 10, desc: '+12% maximum mana.', mul: { maxRes: 1.12 } },
      { id: 'guardian_spirit', name: 'Guardian Spirit', level: 25, desc: 'Heals leave a small shield on the target.', trigger: 'on_heal' },
    ],
    skills: [
      sk('mend', 'Mend', 'active', 1, 1, 5, 'Heal one ally.'),
      sk('smite', 'Smite', 'active', 1, 3, 5, 'Holy damage to one enemy.'),
      sk('blessing', 'Blessing', 'active', 2, 10, 5, 'Party buff: attack and defense.', ['mend']),
      sk('purify', 'Purify', 'active', 2, 12, 3, 'Remove debuffs from an ally.'),
      sk('sanctuary', 'Sanctuary', 'active', 2, 15, 5, 'Ground area that heals allies inside.', ['mend']),
      sk('resurrection', 'Resurrection', 'active', 3, 25, 3, 'Revive a fallen party member.', ['blessing']),
      sk('divine_aegis', 'Divine Aegis', 'active', 3, 35, 1, 'Party-wide damage immunity for a moment.', ['sanctuary']),
    ],
    tiers: [{ level: 1, title: 'Cleric' }, { level: 20, title: 'Lightbinder' }, { level: 45, title: 'Dawn Oracle' }],
  },
  berserker: {
    id: 'berserker', name: 'Berserker', role: 'Melee DPS', resource: 'rage',
    identity: 'Builds rage by fighting and spends it on brutal attacks. Heals by dealing damage.',
    base: { str: 11, dex: 6, int: 2, vit: 8, spi: 3 }, growth: { str: 3.0, dex: 1.2, int: 0.3, vit: 2.2, spi: 0.5 },
    hpBase: 120, hpPerVit: 11, resBase: 100, resPerInt: 0, resPerSpi: 0,
    atk: { str: 2.3 }, defMul: 1.0, critBase: 6, critDmg: 1.6, lifesteal: 3, moveMul: 1.0, atkIntervalMs: 850, range: 44,
    weapons: [
      { kind: 'axe', name: 'Great Axe', atkMul: 1.2, note: '+20% attack, wide arc' },
      { kind: 'dual_axe', name: 'Dual Axes', intervalMul: 0.8, note: 'Faster attacks, generates rage quicker' },
    ],
    passives: [
      { id: 'bloodthirst', name: 'Bloodthirst', level: 1, desc: '+2% lifesteal.', add: { lifesteal: 2 } },
      { id: 'brutality', name: 'Brutality', level: 10, desc: '+10% attack.', mul: { atk: 1.1 } },
      { id: 'undying_fury', name: 'Undying Fury', level: 25, desc: 'Deal more damage the lower your HP.', trigger: 'low_hp' },
    ],
    skills: [
      sk('rend', 'Rend', 'active', 1, 1, 5, 'Bleeding strike that builds extra rage.'),
      sk('war_cry', 'War Cry', 'active', 1, 3, 3, 'Gain rage instantly and attack speed briefly.'),
      sk('whirlwind', 'Whirlwind', 'active', 2, 10, 5, 'Spin, hitting everything around you. Costs rage.', ['rend']),
      sk('blood_pact', 'Blood Pact', 'passive', 2, 12, 5, 'Increase lifesteal.'),
      sk('charge', 'Charge', 'active', 2, 15, 3, 'Rush to the target.'),
      sk('frenzy', 'Frenzy', 'active', 3, 25, 5, 'Spend all rage: attack speed and lifesteal surge.', ['whirlwind', 'blood_pact']),
      sk('executioner', 'Executioner', 'active', 3, 35, 1, 'Massive hit on low-health targets.', ['frenzy']),
    ],
    tiers: [{ level: 1, title: 'Berserker' }, { level: 20, title: 'Ravager' }, { level: 45, title: 'Bloodreaver' }],
  },
};

export const MAX_LEVEL = 200;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function attrsAt(job: Job, level: number): Attrs {
  const d = JOB_DEFS[job];
  const out = {} as Attrs;
  for (const a of ATTRS) out[a] = Math.floor(d.base[a] + d.growth[a] * (level - 1));
  return out;
}

/**
 * Class progression bonuses: reaching a job's second tier (level 20) and third tier (level 45)
 * grants a lasting bonus suited to the class. `mul` multiplies a stat, `add` adds to it.
 */
export interface TierBonus {
  mul?: Partial<Record<StatKey, number>>;
  add?: Partial<Record<StatKey, number>>;
}
export const TIER_BONUS: Record<Job, [TierBonus, TierBonus]> = {
  knight: [{ mul: { maxHp: 1.08, def: 1.1 } }, { mul: { maxHp: 1.06, def: 1.12, mdef: 1.08 } }],
  mage: [{ mul: { matk: 1.1, runeCost: 0.95 } }, { mul: { matk: 1.12, maxRes: 1.08 }, add: { crit: 3 } }],
  ranger: [{ mul: { atk: 1.08, moveMul: 1.05 }, add: { crit: 3 } }, { mul: { atk: 1.1 }, add: { critDmg: 0.1, range: 20 } }],
  assassin: [{ mul: { atk: 1.08 }, add: { crit: 5 } }, { add: { critDmg: 0.15, dodge: 5 }, mul: { moveMul: 1.05 } }],
  cleric: [{ mul: { healPower: 1.1, maxRes: 1.08 } }, { mul: { healPower: 1.12, mdef: 1.08, maxHp: 1.08 } }],
  berserker: [{ mul: { atk: 1.08 }, add: { lifesteal: 3 } }, { mul: { atk: 1.1, maxHp: 1.08, atkIntervalMs: 0.94 } }],
};
/** The progression tiers reached at a level, from the second on, with their bonuses. */
export function tierBonuses(job: Job, level: number): { level: number; title: string; bonus: TierBonus }[] {
  return JOB_DEFS[job].tiers.slice(1).map((t, i) => ({ ...t, bonus: TIER_BONUS[job][i] })).filter((t) => level >= t.level);
}
export function jobTitle(job: Job, level: number): string {
  const t = JOB_DEFS[job].tiers;
  let title = t[0].title;
  for (const x of t) if (level >= x.level) title = x.title;
  return title;
}

export const unlockedPassives = (job: Job, level: number) => JOB_DEFS[job].passives.filter((p) => level >= p.level);

/** Passive skill-tree nodes: stat change per rank. */
export const PASSIVE_NODES: Record<string, (s: Stats, rank: number) => void> = {
  fortify: (s, r) => void (s.def *= 1 + 0.05 * r),
  rune_focus: (s, r) => void (s.runeCost *= 1 - 0.06 * r),
  rune_mastery: (s, r) => void (s.runeLevel += r),
  evasion: (s, r) => void (s.dodge += 3 * r),
  blood_pact: (s, r) => void (s.lifesteal += 1.5 * r),
};

/**
 * Derived combat stats for a job at a level with a given weapon choice (0 or 1) and learned
 * skill ranks (passive nodes only matter here). Equipment bonuses arrive in M6.
 */
export function computeStats(job: Job, level: number, weapon: number, ranks: Record<string, number> = {}, parts: { cls?: boolean } = {}): Stats {
  const d = JOB_DEFS[job];
  const a = attrsAt(job, level);
  const w = d.weapons[weapon] ?? d.weapons[0];
  let atk = 0;
  for (const k of ATTRS) atk += (d.atk[k] ?? 0) * a[k];
  const s: Stats = {
    maxHp: d.hpBase + a.vit * d.hpPerVit + level * 6,
    maxRes: d.resource === 'rage' ? d.resBase : d.resBase + a.int * d.resPerInt + a.spi * d.resPerSpi,
    atk: atk * (w.atkMul ?? 1),
    matk: (a.int * 2 + a.spi * 0.5) * (w.matkMul ?? 1),
    def: (a.vit * 1.2 + a.str * 0.3) * d.defMul * (w.defMul ?? 1),
    mdef: a.spi + a.int * 0.4,
    crit: d.critBase + a.dex * 0.1 + (w.critAdd ?? 0),
    critDmg: d.critDmg,
    healPower: 1 + a.spi * 0.01,
    lifesteal: d.lifesteal,
    moveMul: d.moveMul,
    atkIntervalMs: d.atkIntervalMs * (w.intervalMul ?? 1),
    range: d.range,
    dodge: 0,
    runeCost: 1,
    runeLevel: 0,
  };
  // sigils may lift a passive above its maximum rank, and each extra rank counts like a learned one
  for (const n of d.skills) if (n.type === 'passive' && ranks[n.id] > 0) PASSIVE_NODES[n.id]?.(s, ranks[n.id]);
  for (const p of parts.cls === false ? [] : unlockedPassives(job, level)) {
    if (p.mul) for (const k in p.mul) s[k as StatKey] *= p.mul[k as StatKey]!;
    if (p.add) for (const k in p.add) s[k as StatKey] += p.add[k as StatKey]!;
  }
  // class progression: every tier reached keeps its bonus
  for (const { bonus } of parts.cls === false ? [] : tierBonuses(job, level)) {
    if (bonus.mul) for (const k in bonus.mul) s[k as StatKey] *= bonus.mul[k as StatKey]!;
    if (bonus.add) for (const k in bonus.add) s[k as StatKey] += bonus.add[k as StatKey]!;
  }
  s.maxHp = Math.round(s.maxHp);
  s.maxRes = Math.round(s.maxRes);
  s.atk = Math.round(s.atk);
  s.matk = Math.round(s.matk);
  s.def = Math.round(s.def);
  s.mdef = Math.round(s.mdef);
  s.crit = Math.min(75, r1(s.crit));
  s.critDmg = Math.round(s.critDmg * 100) / 100;
  s.healPower = Math.round(s.healPower * 100) / 100;
  s.lifesteal = r1(s.lifesteal);
  s.moveMul = Math.round(s.moveMul * 1000) / 1000;
  s.atkIntervalMs = Math.round(s.atkIntervalMs);
  s.dodge = Math.min(40, r1(s.dodge));
  s.runeCost = Math.round(s.runeCost * 100) / 100;
  return s;
}
