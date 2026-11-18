// Skill awakening (level 80) and rune fusion (level 90). An awakened skill changes how it works,
// not only how strong it is; a fusion joins two attuned runes into a spell of its own.
// Pure rules shared by server and client.
import type { AbilityDef, Element } from './abilities';

export const AWAKEN_LEVEL = 80;
export const FUSION_LEVEL = 90;
/** Both runes of a fusion must be at least this level. */
export const FUSION_RUNE_LEVEL = 5;
/** What an awakening costs: Awakening Essence (Armageddon bosses, high Rift floors) and gold. */
export const awakenCost = (level: number) => ({ essence: 3, gold: 50_000 + level * 500 });

/** How an awakening changes a skill, in words (for the tooltip and the panel). */
export function awakenKind(def: AbilityDef): string {
  if (def.move) return 'afterimage';
  if (def.field) return 'field';
  if (def.hit?.cone) return 'cone';
  if (def.hit?.aoe || def.hit?.aoeSelf) return 'aftershock';
  if (def.hit) return 'ripple';
  if (def.heal || def.barrier) return 'chorus';
  if (def.status?.some((s) => s.on === 'self')) return 'share';
  return 'echo';
}
/** The awakened form of a skill: one change to how it works, chosen by its shape. */
export function awaken(def: AbilityDef): AbilityDef {
  const k = awakenKind(def), out: AbilityDef = { ...def, name: `${def.name} ✦`, fx: { ...def.fx, c: '#ffd24a' } };
  switch (k) {
    case 'afterimage':
      // leaves an exploding afterimage where it started
      out.field = { kind: 'zone', at: 'self', r: 70, ms: 600, everyMs: 500, hit: { mul: 1.6 } };
      break;
    case 'field':
      out.field = { ...def.field!, r: Math.round(def.field!.r * 1.25), ms: Math.round(def.field!.ms * 1.5) };
      break;
    case 'cone':
      out.hit = { ...def.hit!, maxTargets: (def.hit!.maxTargets ?? 3) * 2, mul: def.hit!.mul * 1.15 };
      out.status = [...(def.status ?? []), { id: 'bleed', on: 'enemy' }];
      break;
    case 'aftershock':
      out.hit = { ...def.hit!, ...(def.hit!.aoe ? { aoe: Math.round(def.hit!.aoe * 1.35) } : { aoeSelf: Math.round(def.hit!.aoeSelf! * 1.35) }) };
      out.field = { kind: 'zone', at: def.hit!.aoeSelf ? 'self' : 'target', r: Math.round((def.hit!.aoe ?? def.hit!.aoeSelf!) * 1.1), ms: 2500, everyMs: 500, hit: { mul: def.hit!.mul * 0.2, magic: def.hit!.magic } };
      break;
    case 'ripple':
      out.hit = { ...def.hit!, mul: def.hit!.mul * 1.3, splash: Math.max(def.hit!.splash ?? 0, 60), splashMul: Math.max(def.hit!.splashMul ?? 0, 0.6) };
      break;
    case 'chorus':
      out.healOn = 'allies';
      out.radius = Math.max(def.radius ?? 0, 200);
      if (def.heal) out.heal = def.heal * 0.8;
      break;
    case 'share':
      out.status = (def.status ?? []).map((s) => (s.on === 'self' ? { ...s, on: 'allies' } : s));
      out.radius = Math.max(def.radius ?? 0, 200);
      break;
    default:
      out.cdMs = Math.round(def.cdMs * 0.7);
  }
  return out;
}

/** Rune fusions: two elements, one spell. */
export interface FusionDef extends AbilityDef {
  els: [Element, Element];
}
const F = (a: Element, b: Element, f: Omit<FusionDef, 'kind' | 'els' | 'cost' | 'cdMs'> & { cost?: number; cdMs?: number }): FusionDef => ({ cost: 45, cdMs: 18000, ...f, kind: 'fusion', els: [a, b] });
export const FUSIONS: FusionDef[] = [
  F('fire', 'water', { id: 'fu_steam', name: 'Steam Burst', desc: 'Scalding steam bursts around the target: damage and blinding (weakened).', range: 240, target: 'enemy', hit: { mul: 2.6, magic: true, aoe: 90 }, status: [{ id: 'weaken', on: 'enemy' }], fx: { t: 'ring', c: '#e8f0f0', v: 'fire' } }),
  F('fire', 'lightning', { id: 'fu_plasma', name: 'Plasma Lance', desc: 'A lance of white plasma: one target, enormous damage.', range: 280, target: 'enemy', hit: { mul: 6, magic: true, critAdd: 20 }, status: [{ id: 'burn', on: 'enemy' }], fx: { t: 'bolt', c: '#fff0ff' } }),
  F('fire', 'earth', { id: 'fu_magma', name: 'Magma Pool', desc: 'Molten rock pools around the target for five seconds.', range: 240, target: 'enemy', field: { kind: 'zone', at: 'target', r: 90, ms: 5000, everyMs: 500, hit: { mul: 0.9, magic: true }, status: [{ id: 'burn', on: 'enemy' }, { id: 'slow', on: 'enemy' }] }, fx: { t: 'zone', c: '#ff6a2a', v: 'quake' } }),
  F('fire', 'wind', { id: 'fu_firestorm', name: 'Firestorm', desc: 'A whirling storm of fire around you.', range: 0, target: 'self', hit: { mul: 3.2, magic: true, aoeSelf: 150 }, status: [{ id: 'burn', on: 'enemy' }], fx: { t: 'ring', c: '#ff8a3a', v: 'fire' } }),
  F('water', 'lightning', { id: 'fu_storm_surge', name: 'Storm Surge', desc: 'Charged water arcs through up to six enemies.', range: 240, target: 'enemy', hit: { mul: 2.4, magic: true, chain: 6 }, status: [{ id: 'shock', on: 'enemy', chance: 40 }], fx: { t: 'chain', c: '#7fd6ff' } }),
  F('water', 'earth', { id: 'fu_mudslide', name: 'Mudslide', desc: 'A wave of mud roots everything in front of you.', range: 220, target: 'enemy', hit: { mul: 2.2, magic: true, cone: 0.8, maxTargets: 8 }, status: [{ id: 'root', on: 'enemy' }], fx: { t: 'slash', c: '#8a6a3a', v: 'wide' } }),
  F('water', 'wind', { id: 'fu_blizzard', name: 'Blizzard', desc: 'A blizzard rages on the target for six seconds, slowing everything inside.', range: 240, target: 'enemy', field: { kind: 'zone', at: 'target', r: 110, ms: 6000, everyMs: 600, hit: { mul: 0.7, magic: true }, status: [{ id: 'slow', on: 'enemy' }] }, fx: { t: 'zone', c: '#e0f4ff', v: 'tornado' } }),
  F('lightning', 'earth', { id: 'fu_magnetism', name: 'Magnetic Crush', desc: 'Pulls the ground together around the target: damage and a long root.', range: 240, target: 'enemy', hit: { mul: 3, magic: true, aoe: 100 }, status: [{ id: 'root', on: 'enemy' }, { id: 'shock', on: 'enemy' }], fx: { t: 'ring', c: '#c8c0ff', v: 'quake' } }),
  F('lightning', 'wind', { id: 'fu_tempest', name: 'Tempest', desc: 'Wind-driven lightning chains through enemies and slows them.', range: 250, target: 'enemy', hit: { mul: 2.2, magic: true, chain: 5 }, status: [{ id: 'slow', on: 'enemy' }], fx: { t: 'chain', c: '#f4f8a0' } }),
  F('earth', 'wind', { id: 'fu_sandstorm', name: 'Sandstorm', desc: 'Scouring sand around you weakens every enemy for five seconds.', range: 0, target: 'self', field: { kind: 'zone', at: 'self', r: 140, ms: 5000, everyMs: 700, hit: { mul: 0.8, magic: true }, status: [{ id: 'weaken', on: 'enemy' }] }, fx: { t: 'zone', c: '#d8b878', v: 'tornado' } }),
];
export const FUSION_INDEX: Record<string, FusionDef> = Object.fromEntries(FUSIONS.map((f) => [f.id, f]));
/** The fusion of two elements (in either order). */
export const fusionOf = (a: Element, b: Element) => FUSIONS.find((f) => (f.els[0] === a && f.els[1] === b) || (f.els[0] === b && f.els[1] === a));
/** The fusions a set of attuned rune slots makes possible (every pair of slots). */
export function fusionsFor(slots: (Element | null)[]): FusionDef[] {
  const out: FusionDef[] = [], els = slots.filter((x): x is Element => !!x);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const f = fusionOf(els[i], els[j]);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}
