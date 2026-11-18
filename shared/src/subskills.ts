// Sub-skills: two enhancement branches for every active job skill. Each is learned with skill
// points (up to 3 ranks, once its skill is learned) and changes that skill and nothing else:
// more damage, a shorter cooldown, a lower cost, a larger area, longer effects, and so on.
// `enhance` turns a skill into its enhanced form for one build; the server resolves casts with it,
// and the client shows the same numbers.
import type { AbilityDef, Build, Hit, StatusApply } from './abilities';
import type { StatusId } from './combat';
import type { Job } from './protocol';

/** What one rank of a sub-skill changes. Values are per rank. */
export type SubMod =
  | { k: 'dmg'; pct: number } // damage of the skill (hits and ground effects)
  | { k: 'cd'; pct: number } // shorter cooldown
  | { k: 'cost'; pct: number } // lower mana or rage cost
  | { k: 'area'; pct: number } // larger radius, splash, cone reach, field and effect radius
  | { k: 'dur'; pct: number } // longer statuses (buffs and debuffs) and ground effects
  | { k: 'crit'; add: number } // added critical chance, in points
  | { k: 'heal'; pct: number } // stronger healing and barriers
  | { k: 'range'; pct: number } // longer reach, and longer jumps for movement skills
  | { k: 'cast'; pct: number } // shorter cast time
  | { k: 'targets'; add: number } // more targets for a cleave or a chain
  | { k: 'apply'; status: StatusId; chance: number }; // a status on enemies hit, chance per rank

export interface SubSkillDef {
  id: string; // `${parent}.a` or `${parent}.b`
  parent: string;
  job: Job;
  name: string;
  mod: SubMod;
  maxRank: number;
}
export const SUB_MAX_RANK = 3;
/** Per-rank strength of each kind of change. */
const V = { dmg: 0.08, cd: 0.08, cost: 0.12, area: 0.12, dur: 0.15, crit: 6, heal: 0.1, range: 0.12, cast: 0.15, targets: 1 };

type Pair = [string, SubMod, string, SubMod];
const dmg = { k: 'dmg', pct: V.dmg } as const, cd = { k: 'cd', pct: V.cd } as const, cost = { k: 'cost', pct: V.cost } as const;
const area = { k: 'area', pct: V.area } as const, dur = { k: 'dur', pct: V.dur } as const, crit = { k: 'crit', add: V.crit } as const;
const heal = { k: 'heal', pct: V.heal } as const, range = { k: 'range', pct: V.range } as const, cast = { k: 'cast', pct: V.cast } as const;
const targets = { k: 'targets', add: V.targets } as const;
const apply = (status: StatusId, chance: number) => ({ k: 'apply', status, chance }) as const;

/** The two branches of every active skill, by job. */
const TABLE: Record<Job, Record<string, Pair>> = {
  knight: {
    shield_bash: ['Crushing Bash', dmg, 'Concussive Rim', dur],
    taunt: ['Booming Challenge', area, 'Unshaken Resolve', cd],
    guard_stance: ['Bulwark Discipline', dur, 'Ready Stance', cd],
    cleave: ['Wide Arc', targets, 'Heavy Edge', dmg],
    rallying_cry: ['Banner Voice', area, 'Long Echo', dur],
    last_stand: ['Iron Will', dur, 'Second Breath', cd],
  },
  mage: {
    arcane_bolt: ['Focused Bolt', dmg, 'Lucid Flow', cost],
    blink: ['Far Step', range, 'Quick Fold', cd],
    elemental_surge: ['Deep Current', dur, 'Swift Attunement', cd],
    mana_shield: ['Lasting Ward', dur, 'Thrifty Ward', cost],
    cataclysm: ['World Breaker', dmg, 'Quickened Ruin', cast],
  },
  ranger: {
    power_shot: ['Keen Aim', crit, 'Pinning Shot', apply('slow', 15)],
    snare_trap: ['Wide Snare', area, 'Tough Cord', dur],
    poison_arrow: ['Virulent Tips', dur, 'Barbed Shafts', dmg],
    explosive_trap: ['Blasting Powder', dmg, 'Wide Charge', area],
    fleet_step: ['Long Leap', range, 'Light Feet', cd],
    volley: ['Arrow Storm', area, 'Steady Barrage', dur],
    hunters_mark: ['Lingering Mark', dur, 'Quick Mark', cd],
  },
  assassin: {
    backstab: ['Vital Strike', dmg, 'Cruel Edge', crit],
    stealth: ['Deep Shadow', dur, 'Fade Quickly', cd],
    shadow_step: ['Long Shadow', range, 'Slipstep', cd],
    twin_fangs: ['Venom Fangs', apply('poison', 15), 'Serrated Fangs', dmg],
    smoke_bomb: ['Thick Smoke', area, 'Choking Cloud', dur],
    death_mark: ['Swift Sentence', cd, 'Cheap Contract', cost],
  },
  cleric: {
    mend: ['Gentle Hands', heal, 'Calm Prayer', cost],
    smite: ['Radiant Smite', dmg, 'Judgement', apply('weaken', 15)],
    blessing: ['Wide Blessing', area, 'Enduring Grace', dur],
    purify: ['Swift Purity', cd, 'Far Reach', range],
    sanctuary: ['Holy Ground', heal, 'Hallowed Expanse', area],
    resurrection: ['Quick Rite', cast, 'Ready Rite', cd],
    divine_aegis: ['Long Aegis', dur, 'Swift Aegis', cd],
  },
  berserker: {
    rend: ['Deep Wounds', dur, 'Savage Rend', dmg],
    war_cry: ['Echoing Roar', dur, 'Quick Fury', cd],
    whirlwind: ['Wide Spin', area, 'Bloodied Spin', apply('bleed', 15)],
    charge: ['Long Charge', range, 'Battering Ram', dmg],
    frenzy: ['Endless Frenzy', dur, 'Hungry Fury', cd],
    executioner: ['Headsman', dmg, 'Swift Axe', cd],
  },
};

export const SUBSKILL_LIST: SubSkillDef[] = (Object.keys(TABLE) as Job[]).flatMap((job) =>
  Object.entries(TABLE[job]).flatMap(([parent, [na, ma, nb, mb]]) => [
    { id: `${parent}.a`, parent, job, name: na, mod: ma, maxRank: SUB_MAX_RANK },
    { id: `${parent}.b`, parent, job, name: nb, mod: mb, maxRank: SUB_MAX_RANK },
  ]),
);
export const SUBSKILLS: Record<string, SubSkillDef> = Object.fromEntries(SUBSKILL_LIST.map((s) => [s.id, s]));
/** The two sub-skills of a skill. */
export const subsOf = (parent: string) => SUBSKILL_LIST.filter((s) => s.parent === parent);

/** What the sub-skill does at a given rank, in words (English; the client translates the template). */
export function subEffect(s: SubSkillDef, rank: number): string {
  const m = s.mod, n = Math.max(1, rank);
  switch (m.k) {
    case 'dmg': return `+${pct(m.pct * n)}% damage`;
    case 'cd': return `-${pct(m.pct * n)}% cooldown`;
    case 'cost': return `-${pct(m.pct * n)}% cost`;
    case 'area': return `+${pct(m.pct * n)}% area`;
    case 'dur': return `+${pct(m.pct * n)}% duration`;
    case 'crit': return `+${m.add * n}% critical chance`;
    case 'heal': return `+${pct(m.pct * n)}% healing`;
    case 'range': return `+${pct(m.pct * n)}% range`;
    case 'cast': return `-${pct(m.pct * n)}% cast time`;
    case 'targets': return `+${m.add * n} target${m.add * n > 1 ? 's' : ''}`;
    case 'apply': return `${Math.min(100, m.chance * n)}% chance to apply ${m.status}`;
  }
}
const pct = (v: number) => Math.round(v * 100);

// ---------------------------------------------------------------------------------------------
// Applying the enhancements
// ---------------------------------------------------------------------------------------------
const mulHit = (h: Hit | undefined, f: (h: Hit) => Hit) => (h ? f({ ...h }) : h);
const scaleStatus = (l: StatusApply[] | undefined, mul: number) => l?.map((s) => ({ ...s, durMul: (s.durMul ?? 1) * mul }));

function applyMod(d: AbilityDef, m: SubMod, r: number): AbilityDef {
  const o: AbilityDef = { ...d, field: d.field ? { ...d.field } : undefined };
  switch (m.k) {
    case 'dmg': {
      const k = 1 + m.pct * r;
      o.hit = mulHit(d.hit, (h) => ({ ...h, mul: h.mul * k }));
      if (o.field?.hit) o.field.hit = { ...o.field.hit, mul: o.field.hit.mul * k };
      break;
    }
    case 'cd': o.cdMs = Math.round(d.cdMs * (1 - m.pct * r)); break;
    case 'cost': o.cost = Math.round(d.cost * (1 - m.pct * r)); break;
    case 'area': {
      const k = 1 + m.pct * r, up = (v?: number) => (v ? Math.round(v * k) : v);
      o.hit = mulHit(d.hit, (h) => ({ ...h, aoe: up(h.aoe), aoeSelf: up(h.aoeSelf), splash: up(h.splash) }));
      // a cone reaches further, at the same angle
      if (d.hit?.cone) o.range = Math.round(d.range * k);
      if (o.field) o.field.r = Math.round(o.field.r * k);
      o.radius = up(d.radius);
      break;
    }
    case 'dur': {
      const k = 1 + m.pct * r;
      o.status = scaleStatus(d.status, k);
      if (o.field) {
        o.field.ms = Math.round(o.field.ms * k);
        o.field.status = scaleStatus(o.field.status, k);
      }
      break;
    }
    case 'crit':
      o.hit = mulHit(d.hit, (h) => ({ ...h, critAdd: (h.critAdd ?? 0) + m.add * r }));
      break;
    case 'heal': {
      const k = 1 + m.pct * r;
      if (d.heal) o.heal = d.heal * k;
      if (d.barrier) o.barrier = d.barrier * k;
      if (o.field?.heal) o.field.heal = o.field.heal * k;
      break;
    }
    case 'range': {
      const k = 1 + m.pct * r;
      if (d.range) o.range = Math.round(d.range * k);
      o.dist = Math.round((d.dist ?? 160) * k);
      break;
    }
    case 'cast': if (d.castMs) o.castMs = Math.round(d.castMs * (1 - m.pct * r)); break;
    case 'targets':
      o.hit = mulHit(d.hit, (h) => ({ ...h, maxTargets: h.maxTargets ? h.maxTargets + m.add * r : h.maxTargets, chain: h.chain ? h.chain + m.add * r : h.chain }));
      break;
    case 'apply':
      o.status = [...(d.status ?? []), { id: m.status, on: 'enemy', chance: Math.min(100, m.chance * r) }];
      break;
  }
  return o;
}

/** The skill as this build casts it. Rune spells and skills without learned sub-skills are returned as they are. */
export function enhance(def: AbilityDef, b: Build | null | undefined, extra: Record<string, number> = {}): AbilityDef {
  if (!b || def.kind !== 'skill') return def;
  let out = def;
  for (const s of subsOf(def.id)) {
    // sigils add ranks to a learned sub-skill, beyond its normal maximum
    const learned = Math.min(s.maxRank, b.skills[s.id] ?? 0), r = learned > 0 ? learned + (extra[s.id] ?? 0) : 0;
    if (r > 0) out = applyMod(out, s.mod, r);
  }
  return out;
}
