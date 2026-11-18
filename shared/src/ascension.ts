// Ascension (level 70 and beyond): every class chooses one of two paths. The path gives a title,
// a lasting bonus that grows at each milestone (70, 100, 130, 160, 190), and an ultimate skill
// charged by fighting. Also here: combo chains, mastery points and saved skill loadouts.
// Pure rules shared by server (authority) and client (display).
import type { AbilityDef, Build } from './abilities';
import type { StatKey, Stats } from './jobs';
import type { Job } from './protocol';
import { JOB_DEFS } from './jobs';

export const ASCENSION_LEVEL = 70;
export const MILESTONES = [70, 100, 130, 160, 190];
export const milestonesAt = (level: number) => MILESTONES.filter((m) => level >= m).length;

export interface PathDef {
  id: string;
  job: Job;
  name: string;
  /** The class title worn from level 70 on. */
  title: string;
  desc: string;
  /** Bonus per milestone reached (multipliers grow, additions add up). */
  mul?: Partial<Record<StatKey, number>>;
  add?: Partial<Record<StatKey, number>>;
  ult: string;
}
const P = (job: Job, id: string, name: string, desc: string, ult: string, b: { mul?: PathDef['mul']; add?: PathDef['add'] }): PathDef => ({ id, job, name, title: name, desc, ult, ...b });
export const PATHS: PathDef[] = [
  P('knight', 'paladin', 'Paladin', 'Holy warrior: tougher, and heals allies as it fights.', 'ult_divine_judgment', { mul: { maxHp: 1.04, healPower: 1.05, mdef: 1.04 } }),
  P('knight', 'warlord', 'Warlord', 'Battlefield commander: banners and shouts that carry the party.', 'ult_war_banner', { mul: { atk: 1.04, def: 1.04 }, add: { crit: 1 } }),
  P('mage', 'archmage', 'Archmage', 'Master of runes: stronger spells for less mana.', 'ult_astral_storm', { mul: { matk: 1.05, runeCost: 0.97 } }),
  P('mage', 'chronomancer', 'Chronomancer', 'Bends time: faster casting, enemies held still.', 'ult_time_stop', { mul: { matk: 1.03, maxRes: 1.05, atkIntervalMs: 0.97 }, add: { dodge: 1 } }),
  P('ranger', 'beastmaster', 'Beastmaster', 'Hunts with the wild: steadier, and its pet bites harder.', 'ult_stampede', { mul: { atk: 1.03, maxHp: 1.04, moveMul: 1.01 } }),
  P('ranger', 'sniper', 'Sniper', 'Deadly at range: longer reach, critical shots.', 'ult_deadeye', { mul: { atk: 1.04 }, add: { crit: 1.5, critDmg: 0.04, range: 6 } }),
  P('assassin', 'phantom', 'Phantom', 'A blade from nowhere: dodges and strikes twice.', 'ult_shadow_legion', { mul: { atk: 1.04 }, add: { dodge: 1.5, crit: 1 } }),
  P('assassin', 'venomlord', 'Venomlord', 'Poison made art: every wound festers.', 'ult_plague_burst', { mul: { atk: 1.05 }, add: { critDmg: 0.04 } }),
  P('cleric', 'oracle', 'Oracle', 'Sees harm coming: shields and stronger healing.', 'ult_prophecy', { mul: { healPower: 1.06, maxRes: 1.04, mdef: 1.03 } }),
  P('cleric', 'inquisitor', 'Inquisitor', 'Faith as a weapon: heals by smiting.', 'ult_holy_fire', { mul: { matk: 1.05, maxHp: 1.02 }, add: { lifesteal: 1 } }),
  P('berserker', 'warbringer', 'Warbringer', 'Each kill feeds the war: harder hits, faster swings.', 'ult_warpath', { mul: { atk: 1.04, atkIntervalMs: 0.98 }, add: { lifesteal: 1 } }),
  P('berserker', 'bloodlord', 'Bloodlord', 'Blood for power: huge health, drinks from every wound.', 'ult_blood_moon', { mul: { maxHp: 1.06, atk: 1.02 }, add: { lifesteal: 1.5 } }),
];
export const PATH_INDEX: Record<string, PathDef> = Object.fromEntries(PATHS.map((p) => [p.id, p]));
export const pathsOf = (job: Job) => PATHS.filter((p) => p.job === job);

const U = (job: Job, id: string, name: string, desc: string, a: Omit<AbilityDef, 'id' | 'name' | 'desc' | 'kind' | 'job' | 'cost' | 'cdMs'>): AbilityDef => ({ ...a, id, name, desc, kind: 'ult', job, cost: 0, cdMs: 3000 });
/** Ultimate skills: one per path, cast when the ultimate gauge is full. */
export const ULTIMATES: AbilityDef[] = [
  U('knight', 'ult_divine_judgment', 'Divine Judgment', 'Holy light crashes down around you: heavy damage, and every ally nearby is healed and protected.', { range: 0, target: 'self', hit: { mul: 6, aoeSelf: 170 }, heal: 4, healOn: 'allies', radius: 220, status: [{ id: 'rally', on: 'allies' }, { id: 'stun', on: 'enemy' }], fx: { t: 'ring', c: '#fff0a8', v: 'cataclysm' } }),
  U('knight', 'ult_war_banner', 'War Banner', 'Plant a banner: allies inside fight harder and are protected, enemies are weakened.', { range: 0, target: 'self', radius: 240, status: [{ id: 'blessing', on: 'allies' }, { id: 'rally', on: 'allies' }], field: { kind: 'zone', at: 'self', r: 160, ms: 10000, everyMs: 1000, hit: { mul: 0.8 }, status: [{ id: 'weaken', on: 'enemy' }] }, fx: { t: 'zone', c: '#ffd24a', v: 'quake' } }),
  U('mage', 'ult_astral_storm', 'Astral Storm', 'Stars fall around the target for six seconds.', { range: 280, target: 'enemy', field: { kind: 'zone', at: 'target', r: 130, ms: 6000, everyMs: 500, hit: { mul: 1.4, magic: true }, status: [{ id: 'burn', on: 'enemy' }] }, fx: { t: 'meteor', c: '#b9a2ff' } }),
  U('mage', 'ult_time_stop', 'Time Stop', 'Time halts around you: enemies are frozen and take a burst of arcane damage.', { range: 0, target: 'self', hit: { mul: 4.5, magic: true, aoeSelf: 200 }, status: [{ id: 'root', on: 'enemy' }, { id: 'stun', on: 'enemy' }, { id: 'surge', on: 'self' }], fx: { t: 'ring', c: '#9fe8ff', v: 'cataclysm' } }),
  U('ranger', 'ult_stampede', 'Stampede', 'A herd of spirit beasts tramples everything in front of you.', { range: 260, target: 'enemy', hit: { mul: 5, cone: 0.9, maxTargets: 10 }, status: [{ id: 'stun', on: 'enemy' }, { id: 'bleed', on: 'enemy', stacks: 2 }], fx: { t: 'slash', c: '#c8a46a', v: 'wide' } }),
  U('ranger', 'ult_deadeye', 'Deadeye', 'One perfect shot: enormous damage, certain to be critical on weakened targets.', { range: 340, target: 'enemy', hit: { mul: 12, critAdd: 60, executeBelow: 0.5, executeMul: 1.5 }, status: [{ id: 'mark', on: 'enemy' }], fx: { t: 'proj', c: '#ffe08a', v: 'arrow' } }),
  U('assassin', 'ult_shadow_legion', 'Shadow Legion', 'Shadows strike every enemy around you five times.', { range: 0, target: 'self', hit: { mul: 1.6, aoeSelf: 150, hits: 5 }, status: [{ id: 'stealth', on: 'self' }], fx: { t: 'smoke', c: '#6a5aa8' } }),
  U('assassin', 'ult_plague_burst', 'Plague Burst', 'Every poison in reach bursts: heavy damage and a plague that spreads.', { range: 0, target: 'self', hit: { mul: 4, aoeSelf: 180 }, status: [{ id: 'poison', on: 'enemy', stacks: 3 }, { id: 'weaken', on: 'enemy' }], fx: { t: 'ring', c: '#9be06a', v: 'fire' } }),
  U('cleric', 'ult_prophecy', 'Prophecy', 'Allies nearby are healed in full measure and wrapped in divine protection.', { range: 0, target: 'self', heal: 10, healOn: 'allies', radius: 260, status: [{ id: 'aegis', on: 'allies' }, { id: 'blessing', on: 'allies' }], fx: { t: 'aura', c: '#fff6c8' } }),
  U('cleric', 'ult_holy_fire', 'Holy Fire', 'A pillar of holy fire burns the area for five seconds and heals allies inside.', { range: 260, target: 'enemy', field: { kind: 'zone', at: 'target', r: 120, ms: 5000, everyMs: 500, hit: { mul: 1.3, magic: true }, heal: 0.6, status: [{ id: 'burn', on: 'enemy' }] }, fx: { t: 'zone', c: '#ffd27a', v: 'rain' } }),
  U('berserker', 'ult_warpath', 'Warpath', 'Become war itself: a whirling storm of blows and a long frenzy.', { range: 0, target: 'self', hit: { mul: 5.5, aoeSelf: 140, hits: 2 }, status: [{ id: 'frenzy', on: 'self' }, { id: 'haste', on: 'self' }], fx: { t: 'ring', c: '#ff3a2a', v: 'shout' } }),
  U('berserker', 'ult_blood_moon', 'Blood Moon', 'The moon bleeds: you cannot fall for a moment, and every wound you deal heals you.', { range: 0, target: 'self', hit: { mul: 3.5, aoeSelf: 160 }, status: [{ id: 'last_stand', on: 'self' }, { id: 'frenzy', on: 'self' }, { id: 'bleed', on: 'enemy', stacks: 2 }], fx: { t: 'aura', c: '#c8102e' } }),
];
/** The ultimate gauge: filled by fighting, spent in one cast. */
export const ULT_MAX = 100;
export const ULT_PER_HIT = 1.5;
export const ULT_PER_HURT = 2;
export const ULT_PER_KILL = 3;
/** Ultimates get stronger at every milestone. */
export const ultScale = (level: number) => 1 + 0.2 * Math.max(0, milestonesAt(level) - 1);
/** Two party members casting ultimates within this time of each other resonate. */
export const RESONANCE_MS = 4000;

/** The path's lasting bonus applied to a stat block, once per milestone reached. */
export function applyPath(s: Stats, path: string, level: number) {
  const d = PATH_INDEX[path];
  if (!d || level < ASCENSION_LEVEL) return;
  const n = milestonesAt(level);
  for (const [k, v] of Object.entries(d.mul ?? {})) s[k as StatKey] = s[k as StatKey] * Math.pow(v!, n);
  for (const [k, v] of Object.entries(d.add ?? {})) s[k as StatKey] = s[k as StatKey] + v! * n;
  s.maxHp = Math.round(s.maxHp);
  s.maxRes = Math.round(s.maxRes);
  s.atk = Math.round(s.atk);
  s.matk = Math.round(s.matk);
  s.def = Math.round(s.def);
  s.mdef = Math.round(s.mdef);
  s.atkIntervalMs = Math.round(s.atkIntervalMs);
  s.crit = Math.min(75, Math.round(s.crit * 10) / 10);
  s.dodge = Math.min(40, Math.round(s.dodge * 10) / 10);
  s.critDmg = Math.round(s.critDmg * 100) / 100;
  s.healPower = Math.round(s.healPower * 100) / 100;
  s.moveMul = Math.round(s.moveMul * 1000) / 1000;
  s.runeCost = Math.round(s.runeCost * 100) / 100;
  s.lifesteal = Math.round(s.lifesteal * 10) / 10;
}

// ---------------------------------------------------------------------------------------------
// Combo chains: three skills in order, each within two seconds of the last, unleash a finisher
// ---------------------------------------------------------------------------------------------
export const COMBO_LEVEL = 70;
export const COMBO_WINDOW_MS = 2000;
export interface ComboDef {
  job: Job;
  name: string;
  steps: [string, string, string];
  /** The finisher: damage around the caster (multiple of attack or magic attack), and a status. */
  mul: number;
  magic?: boolean;
  r: number;
}
export const COMBOS: ComboDef[] = [
  { job: 'knight', name: 'Shockwave Rally', steps: ['shield_bash', 'cleave', 'rallying_cry'], mul: 3, r: 130 },
  { job: 'mage', name: 'Arcane Cascade', steps: ['arcane_bolt', 'elemental_surge', 'arcane_bolt'], mul: 3.2, magic: true, r: 110 },
  { job: 'ranger', name: 'Hunter\'s Volley', steps: ['poison_arrow', 'power_shot', 'power_shot'], mul: 3.2, r: 100 },
  { job: 'assassin', name: 'Death Lotus', steps: ['shadow_step', 'backstab', 'twin_fangs'], mul: 3.4, r: 110 },
  { job: 'cleric', name: 'Judgment Hymn', steps: ['smite', 'mend', 'smite'], mul: 3, magic: true, r: 120 },
  { job: 'berserker', name: 'Carnage', steps: ['rend', 'whirlwind', 'executioner'], mul: 3.6, r: 120 },
];
export const comboOf = (job: Job) => COMBOS.find((c) => c.job === job);

// ---------------------------------------------------------------------------------------------
// Mastery: a point for every level from 71, and more for experience past the level cap
// ---------------------------------------------------------------------------------------------
export const MASTERY_STATS = ['atk', 'matk', 'maxHp', 'def', 'mdef', 'crit', 'critDmg', 'healPower'] as const;
export type MasteryStat = (typeof MASTERY_STATS)[number];
/** Value of one point: percent, or points for crit (and critical damage in percent of the multiplier). */
export const MASTERY_VALUE: Record<MasteryStat, number> = { atk: 0.5, matk: 0.5, maxHp: 0.5, def: 0.5, mdef: 0.5, crit: 0.2, critDmg: 1, healPower: 0.5 };
/** Points one stat may hold: 10 for every tier of 30 levels reached from 70. */
export const masteryCap = (level: number) => 10 * Math.max(1, milestonesAt(level));
export const masteryEarned = (level: number, extra: number) => Math.max(0, level - ASCENSION_LEVEL) + extra;
export function applyMastery(s: Stats, m: Partial<Record<MasteryStat, number>>) {
  for (const k of MASTERY_STATS) {
    const n = m[k] ?? 0;
    if (!n) continue;
    const v = MASTERY_VALUE[k] * n;
    if (k === 'crit') s.crit = Math.min(75, Math.round((s.crit + v) * 10) / 10);
    else if (k === 'critDmg') s.critDmg = Math.round((s.critDmg + v / 100) * 100) / 100;
    else if (k === 'healPower') s.healPower = Math.round(s.healPower * (1 + v / 100) * 100) / 100;
    else s[k] = Math.round(s[k] * (1 + v / 100));
  }
}

// ---------------------------------------------------------------------------------------------
// The stored state
// ---------------------------------------------------------------------------------------------
export const LOADOUTS = 3;
export interface Loadout {
  name: string;
  skills: Record<string, number>;
  slots: Build['runes']['slots'];
}
export interface Ascension {
  /** The chosen path ('' before choosing). */
  path: string;
  /** Mastery points spent per stat, and points earned beyond the level cap. */
  mastery: Partial<Record<MasteryStat, number>>;
  extra: number;
  loadouts: (Loadout | null)[];
  /** Awakened skills (level 80). */
  awake: string[];
}
export const emptyAscension = (): Ascension => ({ path: '', mastery: {}, extra: 0, loadouts: Array.from({ length: LOADOUTS }, () => null), awake: [] });
export const masterySpent = (a: Ascension) => Object.values(a.mastery).reduce((n, v) => n + (v ?? 0), 0);
export function cleanAscension(raw: unknown, job: Job, level: number): Ascension {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, a = emptyAscension();
  if (typeof r.path === 'string' && PATH_INDEX[r.path]?.job === job && level >= ASCENSION_LEVEL) a.path = r.path;
  a.extra = Number.isInteger(r.extra) && r.extra > 0 ? Math.min(r.extra, 100000) : 0;
  const cap = masteryCap(level);
  let left = masteryEarned(level, a.extra);
  for (const k of MASTERY_STATS) {
    const v = r.mastery?.[k];
    if (Number.isInteger(v) && v > 0 && left > 0) {
      a.mastery[k] = Math.min(v, cap, left);
      left -= a.mastery[k]!;
    }
  }
  if (Array.isArray(r.awake)) a.awake = [...new Set<string>(r.awake.filter((x: unknown): x is string => typeof x === 'string' && JOB_DEFS[job].skills.some((s) => s.id === x && s.type === 'active')))];
  if (Array.isArray(r.loadouts))
    r.loadouts.slice(0, LOADOUTS).forEach((l: any, i: number) => {
      if (!l || typeof l !== 'object' || typeof l.name !== 'string') return;
      const skills: Record<string, number> = {};
      for (const [k, v] of Object.entries(l.skills ?? {})) if (typeof k === 'string' && Number.isInteger(v) && (v as number) > 0) skills[k] = Math.min(v as number, 9);
      a.loadouts[i] = { name: l.name.replace(/[^\p{L}\p{N} '\-]/gu, '').slice(0, 20) || `Loadout ${i + 1}`, skills, slots: Array.isArray(l.slots) ? l.slots.slice(0, 3).map((x: unknown) => (typeof x === 'string' ? x : null)) as any : [] };
    });
  return a;
}
