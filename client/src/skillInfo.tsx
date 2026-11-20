// What a skill, rune spell, fusion or ultimate actually does, in numbers: damage as a share of attack
// or magic and roughly how much that is now, areas, cones and chains, healing and barriers, the
// effects it applies and for how long, and its cost, cooldown, cast time and range. Worked out with
// the same rules the server uses (rank and sigil bonuses, rune level, milestones).
import React from 'react';
import { RANK_SCALE, RUNE_LEVEL_SCALE, type AbilityDef, type Element, type Hit, type StatusApply } from '../../shared/src/abilities';
import { ultScale } from '../../shared/src/ascension';
import { FUSION_INDEX } from '../../shared/src/awakening';
import { STATUS } from '../../shared/src/combat';
import type { Stats } from '../../shared/src/jobs';
import type { Hud } from './game/Game';
import { t } from './i18n';

/** How strongly this character casts the ability right now (1 = as listed). */
export function abilityScale(def: AbilityDef, hud: Hud, sigil: Record<string, number> = {}): number {
  const b = hud.build, s = hud.stats, lv = hud.self?.level ?? 1;
  if (!b || !s) return 1;
  const rune = (el: Element) => (b.runes.lv[el] ?? 1) + (s.runeLevel ?? 0);
  if (def.kind === 'skill') { const r = (b.skills[def.id] ?? 0) + (sigil[def.id] ?? 0); return 1 + RANK_SCALE * (Math.max(1, r) - 1); }
  if (def.kind === 'rune') return 1 + RUNE_LEVEL_SCALE * (rune(def.el!) - 1);
  if (def.kind === 'fusion') { const f = FUSION_INDEX[def.id]; return f ? 1 + RUNE_LEVEL_SCALE * (Math.min(rune(f.els[0]), rune(f.els[1])) - 1) : 1; }
  return ultScale(lv);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
function hitFacts(h: Hit, k: number, s: Stats, out: string[], prefix = '') {
  const power = h.magic ? s.matk : s.atk, each = h.mul * k;
  out.push(`${prefix}${t('si.damage', { p: pct(each), stat: t(h.magic ? 'stat.matk' : 'stat.atk'), n: Math.round(each * power) })}${h.hits && h.hits > 1 ? ` ×${h.hits}` : ''}`);
  if (h.aoeSelf) out.push(t('si.aroundYou', { r: h.aoeSelf }));
  if (h.aoe) out.push(t('si.area', { r: h.aoe }));
  if (h.cone) out.push(t('si.cone', { a: Math.round((h.cone * 2 * 180) / Math.PI), n: h.maxTargets ?? '∞' }));
  else if (h.maxTargets) out.push(t('si.upTo', { n: h.maxTargets }));
  if (h.splash) out.push(t('si.splash', { r: h.splash, p: pct(h.splashMul ?? 0.5) }));
  if (h.chain) out.push(t('si.chain', { n: h.chain }));
  if (h.critAdd) out.push(t('si.crit', { n: h.critAdd }));
  if (h.behindMul) out.push(t('si.behind', { p: pct(h.behindMul) }));
}
function statusFacts(list: StatusApply[] | undefined, out: string[]) {
  for (const a of list ?? []) {
    const st = STATUS.find((x) => x.id === a.id);
    if (!st) continue;
    const dur = Math.round(((st.ms ?? 0) * (a.durMul ?? 1)) / 100) / 10;
    out.push(t('si.status', { name: st.name, s: dur, who: t(`si.on.${a.on}` as any), c: a.chance && a.chance < 100 ? ` (${a.chance}%)` : '' }));
  }
}
/** The facts as short lines. */
export function abilityFacts(def: AbilityDef, hud: Hud, sigil: Record<string, number> = {}): string[] {
  const s = hud.stats, out: string[] = [];
  if (!s) return out;
  const k = abilityScale(def, hud, sigil);
  if (def.hit) hitFacts(def.hit, k, s, out);
  if (def.heal) out.push(t('si.heal', { n: Math.round(def.heal * k * s.matk * (s.healPower ?? 1)), who: t(def.healOn === 'allies' ? 'si.healAll' : 'si.healOne') }));
  if (def.barrier) out.push(t('si.barrier', { n: Math.round(def.barrier * k * s.matk) }));
  if (def.field) {
    const f = def.field;
    out.push(t(f.kind === 'trap' ? 'si.trap' : 'si.zone', { r: f.r, s: f.ms / 1000, every: (f.everyMs ?? 0) / 1000 }));
    if (f.hit) hitFacts(f.hit, k, s, out, t('si.perPulse') + ' ');
    if (f.heal) out.push(t('si.healPulse', { n: Math.round(f.heal * k * s.matk * (s.healPower ?? 1)) }));
    statusFacts(f.status, out);
  }
  statusFacts(def.status, out);
  if (def.taunt) out.push(t('si.taunt', { r: def.radius ?? 0 }));
  if (def.move) out.push(t(`si.move.${def.move}` as any, { d: def.dist ?? def.range }));
  if (def.special) out.push(t(`si.special.${def.special}` as any));
  if (k !== 1) out.push(t('si.scaled', { p: `+${Math.round((k - 1) * 100)}%` }));
  return out;
}
/** The cost, cooldown, cast time and range, as chips. */
export function abilityMeta(def: AbilityDef, cost: number, rage: boolean): string[] {
  return [
    def.costAll ? t('skill.allRage') : cost ? t(rage ? 'skill.costRage' : 'skill.costMana', { n: cost }) : t('skill.free'),
    t('skill.cd', { s: def.cdMs / 1000 }),
    ...(def.castMs ? [t('skill.cast', { s: def.castMs / 1000 })] : []),
    def.range ? t('skill.range', { n: def.range }) : t('si.self'),
  ];
}
/** Facts and meta together, as a compact block. */
export function SkillFacts({ def, hud, cost, rage = false, sigil }: { def: AbilityDef; hud: Hud; cost: number; rage?: boolean; sigil?: Record<string, number> }) {
  const facts = abilityFacts(def, hud, sigil);
  return (
    <div className="skillfacts">
      {facts.length > 0 && <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      <div className="tipstats">{abilityMeta(def, cost, rage).map((m) => <span key={m}>{m}</span>)}</div>
    </div>
  );
}
