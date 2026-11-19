// Ability definitions: job skills (keyed by skill-tree node id) and rune spells. Pure data.
// The server executes them (server/src/game/Abilities.ts); the client reads the same table for
// the hotbar, tooltips, local pre-checks and visual effects.
import type { StatusId } from './combat';
import { JOB_DEFS } from './jobs';
import { JOBS, type Job } from './protocol';
import { SUBSKILL_LIST, SUBSKILLS } from './subskills';
import { ULTIMATES } from './ascension';
import { FUSIONS } from './awakening';
import { isTalentKey, talentBlock, talentKey, TALENT_TIERS } from './talents';

export const ELEMENTS = ['fire', 'water', 'lightning', 'earth', 'wind'] as const;
export type Element = (typeof ELEMENTS)[number];
export const ELEMENT_NAMES: Record<Element, string> = { fire: 'Fire Rune', water: 'Water Rune', lightning: 'Lightning Rune', earth: 'Earth Rune', wind: 'Wind Rune' };
export const ELEMENT_COLORS: Record<Element, string> = { fire: '#ff8a3a', water: '#4fa8f0', lightning: '#f4e04a', earth: '#b08a50', wind: '#8fe0b0' };

export interface Hit {
  mul: number; // of attack (or magic attack) power
  magic?: boolean;
  /** Also hits everything within this radius of the primary target at `splashMul`. */
  splash?: number;
  splashMul?: number;
  /** Area around the caster instead of a single target. */
  aoeSelf?: number;
  /** Area around the aimed point. */
  aoe?: number;
  /** Cone toward the target: half-angle in radians, reaching `range`. */
  cone?: number;
  /** Jumps to this many further enemies, each for 70% of the previous hit. */
  chain?: number;
  hits?: number; // repeated strikes on the primary target
  critAdd?: number;
  behindMul?: number; // multiplier when striking from behind the target
  executeBelow?: number; // target HP fraction under which executeMul applies
  executeMul?: number;
  maxTargets?: number;
}
export interface StatusApply {
  id: StatusId;
  on: 'enemy' | 'self' | 'ally' | 'allies';
  chance?: number; // percent, default 100
  stacks?: number;
  /** Duration multiplier (sub-skills that make effects last longer). */
  durMul?: number;
}
export interface FieldSpec {
  kind: 'zone' | 'trap';
  at: 'self' | 'target';
  r: number;
  ms: number;
  everyMs?: number; // zones pulse; traps fire once when an enemy steps in
  hit?: Hit;
  heal?: number; // per pulse, multiple of magic attack, on allies inside
  status?: StatusApply[];
}
export type FxType = 'proj' | 'ring' | 'bolt' | 'chain' | 'meteor' | 'zone' | 'trap' | 'aura' | 'slash' | 'shield' | 'dash' | 'smoke';
export interface AbilityDef {
  id: string;
  name: string;
  desc: string;
  kind: 'skill' | 'rune' | 'ult' | 'fusion';
  job?: Job;
  el?: Element;
  unlock?: number; // rune level that unlocks the spell
  cost: number; // mana (rage for berserker skills)
  costAll?: boolean; // spends all rage (minimum `cost`)
  gain?: number; // rage generated
  cdMs: number;
  castMs?: number; // moving or being stunned cancels a cast
  range: number; // 0 = on the caster
  target: 'enemy' | 'self' | 'ally' | 'deadAlly';
  hit?: Hit;
  status?: StatusApply[];
  heal?: number; // multiple of magic attack
  healOn?: 'ally' | 'allies';
  radius?: number; // for 'allies' effects and taunt
  taunt?: boolean;
  move?: 'blink' | 'toTarget' | 'behind' | 'back';
  dist?: number;
  field?: FieldSpec;
  special?: 'cleanse' | 'revive' | 'deathMark';
  /** Using it does not reveal a stealthed caster. */
  quiet?: boolean;
  /** Barrier strength as a multiple of magic attack (stone shield). */
  barrier?: number;
  fx: { t: FxType; c: string; v?: string };
}

const RUNE = (el: Element, unlock: number, a: Omit<AbilityDef, 'kind' | 'el' | 'unlock'>): AbilityDef => ({ ...a, kind: 'rune', el, unlock });
const SK = (job: Job, a: Omit<AbilityDef, 'kind' | 'job' | 'name' | 'desc'>): AbilityDef => {
  const node = JOB_DEFS[job].skills.find((s) => s.id === a.id)!;
  return { ...a, kind: 'skill', job, name: node.name, desc: node.desc };
};

export const ABILITY_LIST: AbilityDef[] = [
  // ------------------------------ FIRE ------------------------------
  RUNE('fire', 1, { id: 'fireball', name: 'Fireball', desc: 'Hurl a ball of fire that splashes nearby enemies and may set them burning.', cost: 14, cdMs: 2500, range: 240, target: 'enemy',
    hit: { mul: 1.6, magic: true, splash: 44, splashMul: 0.5 }, status: [{ id: 'burn', on: 'enemy', chance: 50 }], fx: { t: 'proj', c: '#ff8a3a', v: 'fire' } }),
  RUNE('fire', 3, { id: 'flame_burst', name: 'Flame Burst', desc: 'A ring of flame erupts around you, burning everything close.', cost: 24, cdMs: 7000, range: 0, target: 'self',
    hit: { mul: 1.3, magic: true, aoeSelf: 90 }, status: [{ id: 'burn', on: 'enemy' }], fx: { t: 'ring', c: '#ff6a2a', v: 'fire' } }),
  RUNE('fire', 6, { id: 'meteor_strike', name: 'Meteor Strike', desc: 'Call down a meteor on your target. Long cast, devastating area damage.', cost: 55, cdMs: 20000, castMs: 1200, range: 260, target: 'enemy',
    hit: { mul: 3.6, magic: true, aoe: 80 }, status: [{ id: 'burn', on: 'enemy' }], fx: { t: 'meteor', c: '#ff5a2a' } }),
  // ------------------------------ WATER ------------------------------
  RUNE('water', 1, { id: 'water_bolt', name: 'Water Bolt', desc: 'A fast bolt of pressurised water.', cost: 10, cdMs: 2000, range: 240, target: 'enemy',
    hit: { mul: 1.4, magic: true }, fx: { t: 'proj', c: '#4fa8f0', v: 'water' } }),
  RUNE('water', 3, { id: 'healing_rain', name: 'Healing Rain', desc: 'Rain falls on an ally, healing everyone inside for six seconds.', cost: 30, cdMs: 15000, castMs: 600, range: 200, target: 'ally',
    field: { kind: 'zone', at: 'target', r: 70, ms: 6000, everyMs: 1000, heal: 0.5 }, fx: { t: 'zone', c: '#6fd6e8', v: 'rain' } }),
  RUNE('water', 5, { id: 'ice_spear', name: 'Ice Spear', desc: 'A spear of ice that hits hard and slows the target.', cost: 22, cdMs: 6000, range: 260, target: 'enemy',
    hit: { mul: 2.2, magic: true }, status: [{ id: 'slow', on: 'enemy' }], fx: { t: 'proj', c: '#c8f0ff', v: 'ice' } }),
  // ------------------------------ LIGHTNING ------------------------------
  RUNE('lightning', 1, { id: 'thunder_strike', name: 'Thunder Strike', desc: 'Lightning strikes the target, briefly stunning it.', cost: 16, cdMs: 4000, range: 220, target: 'enemy',
    hit: { mul: 1.9, magic: true }, status: [{ id: 'shock', on: 'enemy' }], fx: { t: 'bolt', c: '#f4e04a' } }),
  RUNE('lightning', 4, { id: 'chain_lightning', name: 'Chain Lightning', desc: 'Lightning that arcs from the target to up to three more enemies.', cost: 32, cdMs: 9000, range: 220, target: 'enemy',
    hit: { mul: 1.5, magic: true, chain: 3 }, fx: { t: 'chain', c: '#fff06a' } }),
  // ------------------------------ EARTH ------------------------------
  RUNE('earth', 1, { id: 'stone_shield', name: 'Stone Shield', desc: 'Orbiting stones absorb damage for you or an ally.', cost: 20, cdMs: 12000, range: 200, target: 'ally',
    barrier: 3, status: [{ id: 'barrier', on: 'ally' }], fx: { t: 'shield', c: '#b08a50' } }),
  RUNE('earth', 4, { id: 'earthquake', name: 'Earthquake', desc: 'The ground heaves around you three times, damaging and slowing enemies.', cost: 40, cdMs: 16000, castMs: 500, range: 0, target: 'self',
    field: { kind: 'zone', at: 'self', r: 110, ms: 1800, everyMs: 600, hit: { mul: 0.9, magic: true }, status: [{ id: 'slow', on: 'enemy' }] }, fx: { t: 'zone', c: '#a07a48', v: 'quake' } }),
  // ------------------------------ WIND ------------------------------
  RUNE('wind', 1, { id: 'wind_slash', name: 'Wind Slash', desc: 'Blades of wind cut through every enemy in a cone.', cost: 9, cdMs: 1500, range: 170, target: 'enemy',
    hit: { mul: 1.2, magic: true, cone: 0.6, maxTargets: 4 }, fx: { t: 'slash', c: '#8fe0b0', v: 'wind' } }),
  RUNE('wind', 4, { id: 'tornado', name: 'Tornado', desc: 'A whirlwind rages at the target for four seconds, damaging and slowing.', cost: 36, cdMs: 14000, range: 220, target: 'enemy',
    field: { kind: 'zone', at: 'target', r: 60, ms: 4000, everyMs: 500, hit: { mul: 0.55, magic: true }, status: [{ id: 'slow', on: 'enemy' }] }, fx: { t: 'zone', c: '#b8f0d0', v: 'tornado' } }),

  // ------------------------------ KNIGHT ------------------------------
  SK('knight', { id: 'shield_bash', cost: 8, cdMs: 6000, range: 44, target: 'enemy', hit: { mul: 1.3 }, status: [{ id: 'stun', on: 'enemy' }], fx: { t: 'slash', c: '#c8d0da' } }),
  SK('knight', { id: 'taunt', cost: 6, cdMs: 8000, range: 0, target: 'self', taunt: true, radius: 170, fx: { t: 'ring', c: '#e2523f', v: 'shout' } }),
  SK('knight', { id: 'guard_stance', cost: 12, cdMs: 20000, range: 0, target: 'self', status: [{ id: 'guard', on: 'self' }], fx: { t: 'aura', c: '#7fb4ff' } }),
  SK('knight', { id: 'cleave', cost: 10, cdMs: 5000, range: 52, target: 'enemy', hit: { mul: 1.2, cone: 1.1, maxTargets: 5 }, fx: { t: 'slash', c: '#f4f8fb', v: 'wide' } }),
  SK('knight', { id: 'rallying_cry', cost: 20, cdMs: 30000, range: 0, target: 'self', radius: 200, status: [{ id: 'rally', on: 'allies' }], fx: { t: 'ring', c: '#ffd24a', v: 'shout' } }),
  SK('knight', { id: 'last_stand', cost: 25, cdMs: 120000, range: 0, target: 'self', status: [{ id: 'last_stand', on: 'self' }], fx: { t: 'aura', c: '#ffb347' } }),
  // ------------------------------ MAGE ------------------------------
  SK('mage', { id: 'arcane_bolt', cost: 6, cdMs: 1200, range: 260, target: 'enemy', hit: { mul: 1.5, magic: true }, fx: { t: 'proj', c: '#b9a2ff', v: 'arcane' } }),
  SK('mage', { id: 'blink', cost: 12, cdMs: 8000, range: 0, target: 'self', move: 'blink', dist: 130, quiet: true, fx: { t: 'dash', c: '#b9a2ff' } }),
  SK('mage', { id: 'elemental_surge', cost: 15, cdMs: 20000, range: 0, target: 'self', status: [{ id: 'surge', on: 'self' }], fx: { t: 'aura', c: '#ff9a5a' } }),
  SK('mage', { id: 'mana_shield', cost: 10, cdMs: 25000, range: 0, target: 'self', status: [{ id: 'mana_shield', on: 'self' }], fx: { t: 'shield', c: '#6fb4ff' } }),
  SK('mage', { id: 'cataclysm', cost: 90, cdMs: 60000, castMs: 2000, range: 0, target: 'self', hit: { mul: 5, magic: true, aoeSelf: 150 }, status: [{ id: 'burn', on: 'enemy' }], fx: { t: 'ring', c: '#d07aff', v: 'cataclysm' } }),
  // ------------------------------ RANGER ------------------------------
  SK('ranger', { id: 'power_shot', cost: 8, cdMs: 5000, range: 260, target: 'enemy', hit: { mul: 2, critAdd: 25 }, fx: { t: 'proj', c: '#f4f0e2', v: 'arrow' } }),
  SK('ranger', { id: 'snare_trap', cost: 8, cdMs: 10000, range: 0, target: 'self', field: { kind: 'trap', at: 'self', r: 34, ms: 30000, status: [{ id: 'root', on: 'enemy' }] }, fx: { t: 'trap', c: '#a8743c' } }),
  SK('ranger', { id: 'poison_arrow', cost: 10, cdMs: 7000, range: 250, target: 'enemy', hit: { mul: 1.1 }, status: [{ id: 'poison', on: 'enemy', stacks: 2 }], fx: { t: 'proj', c: '#9be06a', v: 'arrow' } }),
  SK('ranger', { id: 'explosive_trap', cost: 14, cdMs: 14000, range: 0, target: 'self', field: { kind: 'trap', at: 'self', r: 34, ms: 30000, hit: { mul: 2.2, aoe: 70 }, status: [{ id: 'burn', on: 'enemy' }] }, fx: { t: 'trap', c: '#e2523f' } }),
  SK('ranger', { id: 'fleet_step', cost: 6, cdMs: 9000, range: 0, target: 'self', move: 'back', dist: 110, quiet: true, fx: { t: 'dash', c: '#9be06a' } }),
  SK('ranger', { id: 'volley', cost: 22, cdMs: 16000, range: 250, target: 'enemy', field: { kind: 'zone', at: 'target', r: 75, ms: 2400, everyMs: 600, hit: { mul: 0.7 } }, fx: { t: 'zone', c: '#e9e3d0', v: 'volley' } }),
  SK('ranger', { id: 'hunters_mark', cost: 10, cdMs: 20000, range: 280, target: 'enemy', status: [{ id: 'mark', on: 'enemy' }], quiet: true, fx: { t: 'aura', c: '#ff5a4a' } }),
  // ------------------------------ ASSASSIN ------------------------------
  SK('assassin', { id: 'backstab', cost: 8, cdMs: 5000, range: 40, target: 'enemy', hit: { mul: 1.8, behindMul: 1.5 }, fx: { t: 'slash', c: '#d0c0ff' } }),
  SK('assassin', { id: 'stealth', cost: 10, cdMs: 20000, range: 0, target: 'self', status: [{ id: 'stealth', on: 'self' }], quiet: true, fx: { t: 'smoke', c: '#6a6478' } }),
  SK('assassin', { id: 'shadow_step', cost: 10, cdMs: 10000, range: 220, target: 'enemy', move: 'behind', quiet: true, fx: { t: 'dash', c: '#6a4ab0' } }),
  SK('assassin', { id: 'twin_fangs', cost: 12, cdMs: 7000, range: 40, target: 'enemy', hit: { mul: 1, hits: 2, critAdd: 30 }, fx: { t: 'slash', c: '#9be06a', v: 'double' } }),
  SK('assassin', { id: 'smoke_bomb', cost: 18, cdMs: 30000, range: 0, target: 'self', radius: 90, status: [{ id: 'weaken', on: 'enemy' }, { id: 'stealth', on: 'self' }], quiet: true, fx: { t: 'smoke', c: '#8a8498', v: 'big' } }),
  SK('assassin', { id: 'death_mark', cost: 20, cdMs: 45000, range: 60, target: 'enemy', special: 'deathMark', status: [{ id: 'death_mark', on: 'enemy' }], fx: { t: 'aura', c: '#b03ad0' } }),
  // ------------------------------ CLERIC ------------------------------
  SK('cleric', { id: 'mend', cost: 14, cdMs: 2500, range: 220, target: 'ally', heal: 2.2, healOn: 'ally', fx: { t: 'aura', c: '#7be08a', v: 'heal' } }),
  SK('cleric', { id: 'smite', cost: 8, cdMs: 2000, range: 220, target: 'enemy', hit: { mul: 1.5, magic: true }, fx: { t: 'bolt', c: '#fff3b8', v: 'holy' } }),
  SK('cleric', { id: 'blessing', cost: 25, cdMs: 30000, range: 0, target: 'self', radius: 200, status: [{ id: 'blessing', on: 'allies' }], fx: { t: 'ring', c: '#fff3b8', v: 'shout' } }),
  SK('cleric', { id: 'purify', cost: 10, cdMs: 8000, range: 220, target: 'ally', special: 'cleanse', fx: { t: 'aura', c: '#c8f0ff', v: 'heal' } }),
  SK('cleric', { id: 'sanctuary', cost: 35, cdMs: 30000, range: 0, target: 'self', field: { kind: 'zone', at: 'self', r: 85, ms: 8000, everyMs: 1000, heal: 0.45 }, fx: { t: 'zone', c: '#ffe89a', v: 'sanctuary' } }),
  SK('cleric', { id: 'resurrection', cost: 60, cdMs: 60000, castMs: 3000, range: 200, target: 'deadAlly', special: 'revive', fx: { t: 'aura', c: '#fff3b8', v: 'heal' } }),
  SK('cleric', { id: 'divine_aegis', cost: 50, cdMs: 120000, range: 0, target: 'self', radius: 200, status: [{ id: 'aegis', on: 'allies' }], fx: { t: 'ring', c: '#ffffff', v: 'shout' } }),
  // ------------------------------ BERSERKER (rage) ------------------------------
  SK('berserker', { id: 'rend', cost: 0, gain: 12, cdMs: 6000, range: 46, target: 'enemy', hit: { mul: 1.2 }, status: [{ id: 'bleed', on: 'enemy' }], fx: { t: 'slash', c: '#e2523f' } }),
  SK('berserker', { id: 'war_cry', cost: 0, gain: 30, cdMs: 25000, range: 0, target: 'self', status: [{ id: 'haste', on: 'self' }], fx: { t: 'ring', c: '#ff6a4a', v: 'shout' } }),
  SK('berserker', { id: 'whirlwind', cost: 30, cdMs: 6000, range: 0, target: 'self', hit: { mul: 1.5, aoeSelf: 70 }, fx: { t: 'ring', c: '#f4f8fb', v: 'spin' } }),
  SK('berserker', { id: 'charge', cost: 0, gain: 10, cdMs: 12000, range: 260, target: 'enemy', move: 'toTarget', hit: { mul: 0.8 }, status: [{ id: 'shock', on: 'enemy' }], fx: { t: 'dash', c: '#ff6a4a' } }),
  SK('berserker', { id: 'frenzy', cost: 20, costAll: true, cdMs: 40000, range: 0, target: 'self', status: [{ id: 'frenzy', on: 'self' }], fx: { t: 'aura', c: '#ff3a2a' } }),
  SK('berserker', { id: 'executioner', cost: 40, cdMs: 15000, range: 46, target: 'enemy', hit: { mul: 2.2, executeBelow: 0.3, executeMul: 2 }, fx: { t: 'slash', c: '#ff3a2a', v: 'wide' } }),
];
ABILITY_LIST.push(...ULTIMATES, ...FUSIONS);
export const ABILITIES: Record<string, AbilityDef> = Object.fromEntries(ABILITY_LIST.map((a) => [a.id, a]));
export const ABILITY_INDEX: Record<string, number> = Object.fromEntries(ABILITY_LIST.map((a, i) => [a.id, i]));

export const GCD_MS = 500;
export const RANK_SCALE = 0.12; // +12% effect per skill rank above 1
export const RUNE_LEVEL_SCALE = 0.02; // +2% effect per rune level above 1 (level 50: +98%)
export const RUNE_MAX_LEVEL = 50;
export const RUNE_XP_PER_CAST = 10;
/** Each level asks for much more than the last: 30 at level 1, about 1,500 at 10, 9,700 at 20, 264,000 at 49. */
export const runeExpToNext = (level: number) => Math.round(30 * Math.pow(level, 1.5) * Math.pow(1.07, level - 1));
export const runeSlots = (job: Job) => (job === 'mage' ? 3 : 2);
export const runeSpells = (el: Element) => ABILITY_LIST.filter((a) => a.el === el);
/** Active skills of a job in hotbar order (skill-tree order). */
export const jobActives = (job: Job) => JOB_DEFS[job].skills.filter((s) => s.type === 'active').map((s) => ABILITIES[s.id]);

/** Persistent build: learned skill ranks and rune attunement/progress. */
export interface Build {
  skills: Record<string, number>;
  runes: { slots: (Element | null)[]; lv: Partial<Record<Element, number>>; xp: Partial<Record<Element, number>> };
}
export const emptyBuild = (job: Job): Build => ({ skills: {}, runes: { slots: Array.from({ length: runeSlots(job) }, () => null), lv: {}, xp: {} } });
export const spentPoints = (b: Build) => Object.entries(b.skills).reduce((n, [k, r]) => (isTalentKey(k) ? n : n + r), 0); // talents cost no points
/** One skill point per character level. */
export const freePoints = (level: number, b: Build) => level - spentPoints(b);
/** Why a skill cannot be learned right now, or '' if it can. */
export function learnBlock(job: Job, level: number, b: Build, id: string): string {
  if (isTalentKey(id)) return talentBlock(level, b.skills, id);
  if (id.startsWith('awake.')) return 'Awaken skills at the Ascension panel';
  const sub = SUBSKILLS[id];
  if (sub) {
    if (sub.job !== job) return 'Not a skill of this job';
    if ((b.skills[id] ?? 0) >= sub.maxRank) return 'Already at maximum rank';
    if (!(b.skills[sub.parent] > 0)) return `Learn ${JOB_DEFS[job].skills.find((s) => s.id === sub.parent)!.name} first`;
    if (freePoints(level, b) < 1) return 'No skill points';
    return '';
  }
  const node = JOB_DEFS[job].skills.find((s) => s.id === id);
  if (!node) return 'Not a skill of this job';
  if ((b.skills[id] ?? 0) >= node.maxRank) return 'Already at maximum rank';
  if (level < node.level) return `Requires level ${node.level}`;
  for (const r of node.requires ?? []) if (!(b.skills[r] > 0)) return `Requires ${JOB_DEFS[job].skills.find((s) => s.id === r)!.name}`;
  if (freePoints(level, b) < 1) return 'No skill points';
  return '';
}
/** Sanitises a build loaded from storage: unknown ids dropped, ranks and levels clamped, points never overspent. */
export function cleanBuild(job: Job, level: number, raw: unknown): Build {
  const b = emptyBuild(job), src = (raw && typeof raw === 'object' ? raw : {}) as any;
  for (const n of JOB_DEFS[job].skills) {
    const r = src.skills?.[n.id];
    if (Number.isInteger(r) && r > 0) b.skills[n.id] = Math.min(n.maxRank, r);
  }
  // sub-skills: only those of this job, and only while their skill is learned
  for (const sb of SUBSKILL_LIST) {
    const r = src.skills?.[sb.id];
    if (sb.job === job && Number.isInteger(r) && r > 0 && b.skills[sb.parent] > 0) b.skills[sb.id] = Math.min(sb.maxRank, r);
  }
  if (spentPoints(b) > level) b.skills = {};
  // awakenings: 10 points each, only for a fully trained active skill from level 80
  for (const n of JOB_DEFS[job].skills) {
    if (n.type === 'active' && src.skills?.['awake.' + n.id] === 10 && level >= 80 && b.skills[n.id] === n.maxRank && spentPoints(b) + 10 <= level) b.skills['awake.' + n.id] = 10;
  }
  // talents: one choice per tier the character has reached
  TALENT_TIERS.forEach((t, i) => {
    const c = src.skills?.[talentKey(i + 1)];
    if (Number.isInteger(c) && c >= 1 && c <= t.options.length && level >= t.level) b.skills[talentKey(i + 1)] = c;
  });
  for (let i = 0; i < b.runes.slots.length; i++) {
    const el = src.runes?.slots?.[i];
    if (ELEMENTS.includes(el) && !b.runes.slots.includes(el)) b.runes.slots[i] = el;
  }
  for (const el of ELEMENTS) {
    const lv = src.runes?.lv?.[el], xp = src.runes?.xp?.[el];
    if (Number.isInteger(lv) && lv > 0) b.runes.lv[el] = Math.min(RUNE_MAX_LEVEL, lv);
    if (Number.isInteger(xp) && xp > 0 && b.runes.lv[el]) b.runes.xp[el] = xp;
  }
  for (const el of b.runes.slots) if (el && !b.runes.lv[el]) b.runes.lv[el] = 1;
  return b;
}
export { JOBS };
