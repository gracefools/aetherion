// Ascension (level 70+): choose a path, see its bonus grow at each milestone, the ultimate and
// the combo chain; spend mastery points; save and load skill loadouts.
import React, { useState, useSyncExternalStore } from 'react';
import { ABILITIES } from '../../shared/src/abilities';
import {
  ASCENSION_LEVEL, comboOf, LOADOUTS, MASTERY_STATS, MASTERY_VALUE, masteryCap, masteryEarned, masterySpent, MILESTONES, milestonesAt, PATH_INDEX, pathsOf, ultScale, ULT_MAX,
  type PathDef,
} from '../../shared/src/ascension';
import { JOB_DEFS } from '../../shared/src/jobs';
import { AWAKEN_LEVEL, awakenCost, awakenKind } from '../../shared/src/awakening';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';

const STAT_KEY: Record<string, string> = { atk: 'stat.atk', matk: 'stat.matk', maxHp: 'stat.hp', def: 'stat.def', mdef: 'stat.mdef', crit: 'stat.crit', critDmg: 'stat.critDmg', healPower: 'stat.heal', maxRes: 'stat.mana', moveMul: 'stat.speed', atkIntervalMs: 'stat.atkTime', range: 'stat.range', dodge: 'stat.dodge', lifesteal: 'stat.lifesteal', runeCost: 'stat.runeCost' };
/** A path's bonus per milestone, in words. */
export function pathBonusText(d: PathDef, n = 1): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d.mul ?? {})) {
    const pct = Math.round((Math.pow(v!, n) - 1) * 1000) / 10;
    parts.push(`${pct > 0 ? '+' : ''}${pct}% ${t(STAT_KEY[k] as any)}`);
  }
  for (const [k, v] of Object.entries(d.add ?? {})) {
    const x = Math.round(v! * n * 100) / 100;
    parts.push(`+${k === 'critDmg' ? `${Math.round(x * 100)}%` : x}${k === 'crit' || k === 'dodge' || k === 'lifesteal' ? '%' : ''} ${t(STAT_KEY[k] as any)}`);
  }
  return parts.join(', ');
}

export function AscensionPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [name, setName] = useState('');
  const me = hud.self, a = hud.asc;
  if (!me) return null;
  const n = milestonesAt(me.level), path = PATH_INDEX[a.path], combo = comboOf(me.job);
  const earned = masteryEarned(me.level, a.extra), spent = masterySpent(a), cap = masteryCap(me.level);
  return (
    <div className="hud ascension panel" role="dialog" aria-label={t('asc.title')}>
      <div className="sheethead">
        <h2>{t('asc.title')}</h2>
        <button className="link" onClick={onClose} aria-label={t('asc.close')}>{t('common.close')}</button>
      </div>
      {me.level < ASCENSION_LEVEL && <p className="sub">{t('asc.locked', { n: ASCENSION_LEVEL })}</p>}
      <section aria-label={t('asc.paths')}>
        <h3>{t('asc.paths')} <small className="sub">{t('asc.milestones', { list: MILESTONES.join(' · '), n })}</small></h3>
        <div className="paths">
          {pathsOf(me.job).map((d) => {
            const u = ABILITIES[d.ult], on = a.path === d.id;
            return (
              <div key={d.id} className={'pathcard' + (on ? ' on' : '')}>
                <b>{d.title}</b>
                <p className="sub">{d.desc}</p>
                <p>{t('asc.bonusPer')}: {pathBonusText(d)}</p>
                {on && n > 0 && <p className="better">{t('asc.bonusNow', { n })}: {pathBonusText(d, n)}</p>}
                <p><b>{t('asc.ultimate')}: {u.name}</b> <small className="sub">{u.desc}</small></p>
                <button className={on ? '' : 'primary'} disabled={on || me.level < ASCENSION_LEVEL} onClick={() => game.ascOp('path', { id: d.id })}>
                  {on ? t('asc.chosen') : a.path ? t('asc.change') : t('asc.choose')}
                </button>
              </div>
            );
          })}
        </div>
        {path && <p className="sub">{t('asc.ultHelp', { max: ULT_MAX, key: 'ultimate', pct: Math.round((ultScale(me.level) - 1) * 100) })}</p>}
      </section>
      {combo && (
        <section aria-label={t('asc.combo')}>
          <h3>{t('asc.combo')}: {combo.name}</h3>
          <p className="sub">{t('asc.comboHelp', { steps: combo.steps.map((s) => JOB_DEFS[me.job].skills.find((x) => x.id === s)?.name ?? s).join(' → '), n: ASCENSION_LEVEL })}</p>
        </section>
      )}
      <section aria-label={t('aw.title')}>
        <h3>{t('aw.title')} <small className="sub">{t('aw.help', { n: AWAKEN_LEVEL, e: awakenCost(me.level).essence, g: awakenCost(me.level).gold.toLocaleString(), have: hud.inv.filter((i) => i.base === 'awakening_essence').reduce((n, i) => n + i.qty, 0) })}</small></h3>
        <div className="mastery">
          {JOB_DEFS[me.job].skills.filter((s) => s.type === 'active').map((s) => {
            const on = a.awake.includes(s.id), full = (hud.build?.skills[s.id] ?? 0) >= s.maxRank;
            return (
              <div key={s.id} className="mrow" title={t(`aw.kind.${awakenKind(ABILITIES[s.id])}` as any)}>
                <span>{on ? '✦ ' : ''}{s.name}</span>
                <small className="sub">{on ? t('aw.done') : t(`aw.kind.${awakenKind(ABILITIES[s.id])}` as any)}</small>
                <button className="small" disabled={on || !full || me.level < AWAKEN_LEVEL} onClick={() => game.ascOp('awaken', { id: s.id })}>{on ? '✦' : t('aw.awaken')}</button>
              </div>
            );
          })}
        </div>
      </section>
      <section aria-label={t('asc.mastery')}>
        <h3>{t('asc.mastery')} <small className="sub">{t('asc.points', { n: earned - spent, of: earned, cap })}</small></h3>
        <div className="mastery">
          {MASTERY_STATS.map((k) => {
            const v = a.mastery[k] ?? 0;
            return (
              <div key={k} className="mrow">
                <span>{t(STAT_KEY[k] as any)}</span>
                <small className="sub">{v} / {cap} · +{Math.round(v * MASTERY_VALUE[k] * 10) / 10}{k === 'crit' ? '' : '%'}</small>
                <button className="small" disabled={earned - spent < 1 || v >= cap} onClick={() => game.ascOp('mastery', { stat: k })} aria-label={t('asc.add', { stat: t(STAT_KEY[k] as any) })}>+</button>
              </div>
            );
          })}
        </div>
        <button className="small" disabled={!spent} onClick={() => game.ascOp('mreset')}>{t('asc.reset', { n: 5000 * Math.max(1, spent) })}</button>
      </section>
      <section aria-label={t('asc.loadouts')}>
        <h3>{t('asc.loadouts')}</h3>
        <p className="sub">{t('asc.loadoutHelp')}</p>
        <input placeholder={t('asc.loadoutName')} value={name} maxLength={20} onChange={(e: any) => setName(e.target.value)} />
        {Array.from({ length: LOADOUTS }, (_, i) => {
          const l = a.loadouts[i];
          return (
            <div key={i} className="mrow">
              <span>{l ? l.name : t('asc.empty', { n: i + 1 })}</span>
              <small className="sub">{l ? t('asc.skillsN', { n: Object.keys(l.skills).length }) : ''}</small>
              <span>
                <button className="small" onClick={() => game.ascOp('save', { slot: i, name })}>{t('asc.save')}</button>
                <button className="small" disabled={!l} onClick={() => game.ascOp('load', { slot: i })}>{t('asc.load')}</button>
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
