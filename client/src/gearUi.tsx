// Armament (level 30) and sigils (level 50) in the inventory, and the main/sub-stat view of an item.
// Everything here shows the server's state and sends requests; the server decides every outcome.
import React from 'react';
import {
  ARM_MAX, ARMAMENT_LEVEL, armBoost, armChance, armCost, armFallback, armStep, SIGIL_LEVEL, SIGIL_SETS, SIGIL_SHAPE_NAMES, SIGIL_SHAPES, SIGIL_SYMBOL_COLORS,
  SIGIL_SYMBOL_NAMES, SIGIL_SYMBOLS, SIGIL_TIERS, sigilBase, sigilRanks, sigilSets, sigilSkillJob, sigilSkills, sigilTier, setEffects, WEAPON_AURA_COLORS, weaponAura,
} from '../../shared/src/gear';
import { ITEMS, itemMainStats, RARITY_AFFIXES, SLOT_NAMES, SLOTS, STAT_LABEL, subRange, type GearStat, type Item } from '../../shared/src/items';
import { JOB_DEFS } from '../../shared/src/jobs';
import { SUBSKILLS } from '../../shared/src/subskills';
import type { Game, Hud } from './game/Game';
import { Icon, slotName } from './inventory';
import { t, tv, type Key } from './i18n';

const PCT: Partial<Record<GearStat, boolean>> = { crit: true, critDmg: true, lifesteal: true, dodge: true, healPower: true };
const fmt = (k: GearStat, v: number) => (PCT[k] ? `${Math.round(v * (k === 'crit' || k === 'dodge' || k === 'lifesteal' ? 10 : 1000)) / 10}%` : String(Math.round(v)));
const SHAPE_GLYPH = ['●', '▲', '■', '◆', '★', '☾'];
export const skillName = (id: string): { name: string; job: string } => {
  const sub = SUBSKILLS[id];
  if (sub) return { name: `${sub.name} (${skillName(sub.parent).name})`, job: JOB_DEFS[sub.job].name };
  for (const d of Object.values(JOB_DEFS)) {
    const n = d.skills.find((x) => x.id === id);
    if (n) return { name: n.name, job: d.name };
  }
  return { name: id, job: '' };
};

/** An equipment item's main stats (with the armament boost when worn) and its sub-stats with their ranges. */
export function StatBlocks({ item, hud, worn }: { item: Item; hud: Hud; worn: boolean }) {
  const slot = ITEMS[item.base].slot!, lv = hud.self?.level ?? 0;
  const armLv = worn && lv >= ARMAMENT_LEVEL ? hud.gear.arm[slot] ?? 0 : 0, boost = 1 + armBoost(armLv) / 100;
  const main = itemMainStats(item, boost), base = itemMainStats(item);
  return (
    <>
      <h4 className="statsh">{t('gear.main')}{armLv ? <small className="better"> {t('gear.armBoost', { n: armLv, pct: armBoost(armLv) })}</small> : null}</h4>
      <div className="statgrid">
        {(Object.keys(main) as GearStat[]).map((k) => <div key={k}><span>{tv(STAT_LABEL[k])}</span><b>{fmt(k, main[k]!)}{armLv && main[k] !== base[k] ? <em className="better"> (+{fmt(k, main[k]! - base[k]!)})</em> : null}</b></div>)}
      </div>
      <h4 className="statsh">{t('gear.sub', { n: item.aff.length, max: RARITY_AFFIXES[item.rar] })}</h4>
      {item.aff.length ? (
        <div className="substats">
          {item.aff.map(([k, v]) => {
            const [lo, hi] = subRange(k, item.ilvl, item.rar), q = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 1;
            return (
              <div key={k} className="substat" title={t('gear.range', { lo: fmt(k, lo), hi: fmt(k, hi) })}>
                <span>{tv(STAT_LABEL[k])}</span><b>+{fmt(k, v)}</b>
                <span className="rollbar" aria-label={t('gear.roll', { n: Math.round(q * 100) })}><i style={{ width: `${q * 100}%` }} /></span>
                <small className="sub">{fmt(k, lo)}–{fmt(k, hi)}</small>
              </div>
            );
          })}
        </div>
      ) : <p className="sub">{t('gear.noSub')}</p>}
    </>
  );
}

/** A sigil item: shape, symbol and the skill it raises. */
export function SigilInfo({ item, hud, game, equipped }: { item: Item; hud: Hud; game: Game; equipped: number }) {
  const sb = sigilBase(item.base)!, me = hud.self!, tier = sigilTier(item);
  return (
    <div className="sigilinfo">
      <div className="sub"><b style={{ color: SIGIL_SYMBOL_COLORS[sb.sym] }}>{SHAPE_GLYPH[sb.shape]} {SIGIL_SYMBOL_NAMES[sb.sym]}</b> · {t('sigil.shape', { s: SIGIL_SHAPE_NAMES[sb.shape] })} · <b>{t('sigil.tier', { n: tier })}</b></div>
      {sigilSkills(item).map(([id, n]) => {
        const sn = skillName(id), mine = sigilSkillJob(id) === me.job, learned = (hud.build?.skills[id] ?? 0) > 0;
        return <p key={id}>{t('sigil.skill', { n, skill: sn.name, job: sn.job })} {!mine ? <em className="worse">{t('sigil.otherClass')}</em> : !learned ? <em className="worse">{t('sigil.notLearned')}</em> : <em className="better">{t('sigil.active')}</em>}</p>;
      })}
      {tier > 1 && <p className="sub">{t('sigil.tierSet', { n: tier - 1 })}</p>}
      {equipped < 0 && (me.level < SIGIL_LEVEL
        ? <p className="err">{t('sigil.locked', { n: SIGIL_LEVEL })}</p>
        : <button className="primary" onClick={() => game.invOp('sigil', { uid: item.uid })}>{t('sigil.equip')}</button>)}
    </div>
  );
}

export function ArmamentTab({ hud, game }: { hud: Hud; game: Game }) {
  const me = hud.self!, count = (base: string) => hud.inv.reduce((n, i) => n + (i.base === base ? i.qty : 0), 0);
  if (me.level < ARMAMENT_LEVEL) return <p className="sub">{t('arm.locked', { n: ARMAMENT_LEVEL })}</p>;
  return (
    <>
      <p className="sub">{t('arm.help')}</p>
      <div className="armlist">
        {SLOTS.map((s) => {
          const lv = hud.gear.arm[s] ?? 0, item = hud.eq[s], max = lv >= ARM_MAX;
          const cost = max ? null : armCost(lv), chance = max ? 0 : armChance(lv), back = max ? lv : armFallback(lv + 1), aura = s === 'weapon' ? weaponAura(lv) : 0;
          const have = cost ? count(cost.mat) : 0, can = !!cost && hud.gold >= cost.gold && have >= cost.qty;
          return (
            <div key={s} className="armrow" role="group" aria-label={t('arm.slot', { slot: slotName(s) })}>
              <div className="armslot">
                {item ? <Icon item={item} size={32} /> : <span className="cell empty" />}
                <div>
                  <b>{slotName(s)} +{lv}</b> {aura ? <span className="aurachip" style={{ color: WEAPON_AURA_COLORS[aura] }}>✦ {t(`arm.aura${aura}` as Key)}</span> : null}
                  <div className="sub">{t('arm.boost', { pct: armBoost(lv) })}{item ? '' : ` · ${t('arm.noItem')}`}</div>
                </div>
              </div>
              {max ? <span className="better">{t('arm.max')}</span> : (
                <div className="armnext">
                  <div className="sub">
                    {t('arm.next', { to: lv + 1, pct: armStep(lv + 1), total: armBoost(lv + 1) })} · <b>{t('arm.chance', { n: chance })}</b>{chance < 100 ? ` · ${t('arm.fail', { n: back })}` : ''}
                  </div>
                  <div className="sub">{t('arm.cost', { g: cost!.gold, qty: cost!.qty, mat: ITEMS[cost!.mat].name, have })}</div>
                  <button className={chance < 100 ? 'danger small' : 'primary small'} disabled={!can} onClick={() => game.invOp('arm', { slot: s })} aria-label={t('arm.enhance', { slot: slotName(s), to: lv + 1 })}>{t('arm.enhanceShort', { to: lv + 1 })}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="sub">{t('arm.where')}</p>
    </>
  );
}

const SET_LINE: Record<string, Key> = { dmg: 'set.dmg', critDmg: 'set.critDmg', maxHp: 'set.maxHp', mdef: 'set.mdef', def: 'set.def', atkTime: 'set.atkTime', crit: 'set.crit', lifesteal: 'set.lifesteal' };
const setText = (b: Record<string, number>) => Object.entries(b).map(([k, v]) => t(SET_LINE[k], { n: v })).join(', ');

export function SigilTab({ hud, game }: { hud: Hud; game: Game }) {
  const me = hud.self!;
  if (me.level < SIGIL_LEVEL) return <p className="sub">{t('sigil.lockedTab', { n: SIGIL_LEVEL })}</p>;
  const sets = sigilSets(hud.gear, me.level), ranks = sigilRanks(me.job, me.level, hud.gear, hud.build?.skills ?? {});
  const bag = hud.inv.filter((i) => ITEMS[i.base]?.kind === 'sigil');
  return (
    <>
      <p className="sub">{t('sigil.help')}</p>
      <div className="sigilslots" role="list" aria-label={t('sigil.slots')}>
        {SIGIL_SHAPES.map((_, i) => {
          const it = hud.gear.sig[i], sb = it && sigilBase(it.base);
          return (
            <div key={i} className={'sigilslot' + (it ? ' on' : '')} role="listitem" aria-label={t('sigil.slot', { s: SIGIL_SHAPE_NAMES[i] })}>
              <span className="glyph" style={{ color: sb ? SIGIL_SYMBOL_COLORS[sb.sym] : undefined }}>{SHAPE_GLYPH[i]}</span>
              {it && sb ? (
                <>
                  <b style={{ color: SIGIL_SYMBOL_COLORS[sb.sym] }}>{SIGIL_SYMBOL_NAMES[sb.sym]} <small>{t('sigil.tierShort', { n: sigilTier(it) })}</small></b>
                  {sigilSkills(it).map(([id, n]) => <small key={id}>{t('sigil.skillShort', { n, skill: skillName(id).name })}{sigilSkillJob(id) !== me.job ? ` · ${t('sigil.otherClass')}` : ''}</small>)}
                  <button className="link" onClick={() => game.invOp('unsigil', { slot: i })} aria-label={t('sigil.remove', { s: SIGIL_SHAPE_NAMES[i] })}>{t('sigil.removeShort')}</button>
                </>
              ) : <small className="sub">{SIGIL_SHAPE_NAMES[i]}</small>}
            </div>
          );
        })}
      </div>
      <h3>{t('sigil.sets')}</h3>
      {SIGIL_SYMBOLS.map((sym, si) => {
        const cur = sets.find((x) => x.sym === sym);
        return (
          <div key={sym} className="setbox">
            <b style={{ color: SIGIL_SYMBOL_COLORS[si] }}>{SIGIL_SYMBOL_NAMES[si]}</b> <small>({cur?.n ?? 0} / 6){cur && cur.st > 1 ? ` · ${t('sigil.tierShort', { n: cur.st })}` : ''}</small>
            {SIGIL_SETS[sym].map((_, k) => <div key={k} className={cur && cur.tier >= k + 1 ? 'on' : ''}>({(k + 1) * 2}) {setText(setEffects(sym, k + 1, cur?.st ?? 1) as Record<string, number>)}</div>)}
          </div>
        );
      })}
      {Object.keys(ranks).length > 0 && (
        <>
          <h3>{t('sigil.skillBonus')}</h3>
          <p>{Object.entries(ranks).map(([id, n]) => t('sigil.skillShort', { n, skill: skillName(id).name })).join(' · ')}</p>
        </>
      )}
      <h3>{t('sigil.tiers')}</h3>
      <table className="sigiltiers"><tbody>
        {SIGIL_TIERS.map((x, i) => <tr key={i}><td>{t('sigil.tierShort', { n: i + 1 })}</td><td>{t('sigil.tierFrom', { n: x.level })}</td><td>{t('sigil.tierSlots', { n: x.slots, max: x.max })}</td></tr>)}
      </tbody></table>
      <h3>{t('sigil.inBag', { n: bag.length })}</h3>
      {!bag.length && <p className="sub">{t('sigil.none')}</p>}
      {bag.map((it) => {
        const sb = sigilBase(it.base)!;
        return (
          <div key={it.uid} className="shoprow">
            <span className="glyph" style={{ color: SIGIL_SYMBOL_COLORS[sb.sym] }}>{SHAPE_GLYPH[sb.shape]}</span>
            <span>{ITEMS[it.base].name} <b>{t('sigil.tierShort', { n: sigilTier(it) })}</b><small> {sigilSkills(it).map(([id, n]) => { const sn = skillName(id); return t('sigil.skill', { n, skill: sn.name, job: sn.job }); }).join(' · ')}</small></span>
            <button className="small" onClick={() => game.invOp('sigil', { uid: it.uid })} aria-label={t('sigil.equipName', { name: ITEMS[it.base].name })}>{t('sigil.equip')}</button>
          </div>
        );
      })}
    </>
  );
}
export { SLOT_NAMES };
