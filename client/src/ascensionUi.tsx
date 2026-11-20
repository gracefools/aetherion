// Ascension (level 70+): choose a path, see its bonus grow at each milestone, the ultimate and
// the combo chain; spend mastery points; save and load skill loadouts.
import React, { useState, useSyncExternalStore } from 'react';
import { ABILITIES } from '../../shared/src/abilities';
import {
  ASCENSION_LEVEL, comboOf, LOADOUTS, MASTERY_STATS, MASTERY_VALUE, masteryCap, masteryEarned, masterySpent, MILESTONES, milestonesAt, PATH_INDEX, pathsOf, ultScale, ULT_MAX,
  type PathDef,
} from '../../shared/src/ascension';
import { JOB_DEFS } from '../../shared/src/jobs';
import { AWAKEN_LEVEL, AWAKEN_POINTS, awakenKind } from '../../shared/src/awakening';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';
import { skillIcon } from './game/skillicons';
import { SkillFacts } from './skillInfo';

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

/** The panel's sections, as tabs. */
type AscTab = 'path' | 'awaken' | 'mastery' | 'loadouts';
const PATH_HUE = ['#c9a24a', '#7fb8ff', '#d07aff', '#7fe0a0', '#ff8a6a', '#7fe8ff'];

export function AscensionPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [name, setName] = useState('');
  const [tab, setTab] = useState('path' as AscTab);
  const me = hud.self, a = hud.asc;
  if (!me) return null;
  const n = milestonesAt(me.level), path = PATH_INDEX[a.path], combo = comboOf(me.job);
  const earned = masteryEarned(me.level, a.extra), spent = masterySpent(a), cap = masteryCap(me.level), free = earned - spent;
  const paths = pathsOf(me.job), hue = path ? PATH_HUE[paths.findIndex((d) => d.id === path.id) % PATH_HUE.length] : '#8a8fa8';
  const tabs: [AscTab, string, string][] = [
    ['path', t('asc.paths'), ''], ['awaken', t('aw.title'), String(a.awake.length || '')],
    ['mastery', t('asc.mastery'), free > 0 ? String(free) : ''], ['loadouts', t('asc.loadouts'), ''],
  ];
  return (
    <div className="hud ascension panel" role="dialog" aria-label={t('asc.title')}>
      <div className="sheethead">
        <h2>{t('asc.title')}</h2>
        <button className="link panelx" onClick={onClose} aria-label={t('asc.close')}>{t('common.close')}</button>
      </div>
      {/* who you are becoming: the path, and the milestones on the way */}
      <div className="aschero" style={{ ['--hue' as any]: hue }}>
        <div className="aschero-title">
          <small className="sub">{path ? t('asc.chosen') : me.level < ASCENSION_LEVEL ? t('asc.locked', { n: ASCENSION_LEVEL }) : t('asc.pickOne')}</small>
          <b>{path ? path.title : JOB_DEFS[me.job].name}</b>
          {path && n > 0 && <span className="better">{pathBonusText(path, n)}</span>}
        </div>
        <ol className="milestones" aria-label={t('asc.milestones', { list: MILESTONES.join(' · '), n })}>
          {MILESTONES.map((m) => <li key={m} className={me.level >= m ? 'on' : ''}><i /><small>{t('common.lv', { n: m })}</small></li>)}
        </ol>
      </div>
      <div className="tabs" role="tablist" aria-label={t('asc.title')}>
        {tabs.map(([k, l, badge]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{badge && <span className="tabbadge">{badge}</span>}</button>)}
      </div>
      {tab === 'path' && (
        <section aria-label={t('asc.paths')}>
          <div className="paths">
            {paths.map((d, i) => {
              const u = ABILITIES[d.ult], on = a.path === d.id;
              return (
                <div key={d.id} className={'pathcard' + (on ? ' on' : '')} style={{ ['--hue' as any]: PATH_HUE[i % PATH_HUE.length] }}>
                  <div className="pathtop">
                    <img className="pathult" src={skillIcon(u.id)} alt="" />
                    <div><b>{d.title}</b><p className="sub">{d.desc}</p></div>
                  </div>
                  <div className="chips"><span className="chip">{t('asc.bonusPer')}: {pathBonusText(d)}</span>{on && n > 0 && <span className="chip better">{t('asc.bonusNow', { n })}: {pathBonusText(d, n)}</span>}</div>
                  <p className="ultline"><b>{t('asc.ultimate')}: {u.name}</b> <small className="sub">{u.desc}</small></p>
                  <SkillFacts def={u} hud={hud} cost={u.cost} />
                  <button className={on ? '' : 'primary'} disabled={on || me.level < ASCENSION_LEVEL} onClick={() => game.ascOp('path', { id: d.id })}>
                    {on ? t('asc.chosen') : a.path ? t('asc.change') : t('asc.choose')}
                  </button>
                </div>
              );
            })}
          </div>
          {path && <p className="sub">{t('asc.ultHelp', { max: ULT_MAX, key: 'ultimate', pct: Math.round((ultScale(me.level) - 1) * 100) })}</p>}
          {combo && <div className="combobox"><b>{t('asc.combo')}: {combo.name}</b><div className="combosteps">{combo.steps.map((s, i) => <React.Fragment key={s}>{i > 0 && <span className="arrow">→</span>}<span className="step"><img src={skillIcon(s)} alt="" />{JOB_DEFS[me.job].skills.find((x) => x.id === s)?.name ?? s}</span></React.Fragment>)}</div><p className="sub">{t('asc.comboHelp', { steps: combo.steps.map((s) => JOB_DEFS[me.job].skills.find((x) => x.id === s)?.name ?? s).join(' → '), n: ASCENSION_LEVEL })}</p></div>}
        </section>
      )}
      {tab === 'awaken' && (
        <section aria-label={t('aw.title')}>
          <p className="sub">{t('aw.help', { n: AWAKEN_LEVEL, e: AWAKEN_POINTS, have: hud.points })}</p>
          <div className="awakengrid">
            {JOB_DEFS[me.job].skills.filter((s) => s.type === 'active').map((s) => {
              const on = a.awake.includes(s.id), full = (hud.build?.skills[s.id] ?? 0) >= s.maxRank;
              return (
                <div key={s.id} className={'awakecard' + (on ? ' on' : '')} title={t(`aw.kind.${awakenKind(ABILITIES[s.id])}` as any)}>
                  <img src={skillIcon(s.id)} alt="" />
                  <div><b>{s.name}</b><small className="sub">{on ? t('aw.done') : t(`aw.kind.${awakenKind(ABILITIES[s.id])}` as any)}</small></div>
                  <button className="small" disabled={on || !full || me.level < AWAKEN_LEVEL || hud.points < AWAKEN_POINTS} onClick={() => game.ascOp('awaken', { id: s.id })}>{on ? '✦' : t('aw.awaken')}</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {tab === 'mastery' && (
        <section aria-label={t('asc.mastery')}>
          <p className="sub">{t('asc.points', { n: free, of: earned, cap })}</p>
          <div className="mastery">
            {MASTERY_STATS.map((k) => {
              const v = a.mastery[k] ?? 0;
              return (
                <div key={k} className="mrow mbar">
                  <span>{t(STAT_KEY[k] as any)}</span>
                  <small className="sub">+{Math.round(v * MASTERY_VALUE[k] * 10) / 10}{k === 'crit' ? '' : '%'}</small>
                  <button className="small" disabled={free < 1 || v >= cap} onClick={() => game.ascOp('mastery', { stat: k })} aria-label={t('asc.add', { stat: t(STAT_KEY[k] as any) })}>+</button>
                  <div className="meterbar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={cap} aria-label={`${v} / ${cap}`}><i style={{ width: `${cap ? (v / cap) * 100 : 0}%` }} /><small>{v} / {cap}</small></div>
                </div>
              );
            })}
          </div>
          <button className="small" disabled={!spent} onClick={() => game.ascOp('mreset')}>{t('asc.reset', { n: 5000 * Math.max(1, spent) })}</button>
        </section>
      )}
      {tab === 'loadouts' && (
        <section aria-label={t('asc.loadouts')}>
          <p className="sub">{t('asc.loadoutHelp')}</p>
          <input placeholder={t('asc.loadoutName')} value={name} maxLength={20} onChange={(e: any) => setName(e.target.value)} />
          <div className="loadouts">
            {Array.from({ length: LOADOUTS }, (_, i) => {
              const l = a.loadouts[i];
              return (
                <div key={i} className={'loadcard' + (l ? ' used' : '')}>
                  <b>{l ? l.name : t('asc.empty', { n: i + 1 })}</b>
                  <small className="sub">{l ? t('asc.skillsN', { n: Object.keys(l.skills).length }) : ''}</small>
                  <span className="actions">
                    <button className="small" onClick={() => game.ascOp('save', { slot: i, name })}>{t('asc.save')}</button>
                    <button className="small primary" disabled={!l} onClick={() => game.ascOp('load', { slot: i })}>{t('asc.load')}</button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The ascension at a glance, for the character sheet: the path and its milestones, what the path
 * adds now and at the next milestone, the mastery points spent and what they give, and the skills
 * awakened. Read-only; choices are made in the Ascension panel.
 */
export function AscensionSummary({ hud }: { hud: Hud }) {
  useT();
  const me = hud.self, a = hud.asc;
  if (!me) return null;
  const n = milestonesAt(me.level), path = PATH_INDEX[a.path], next = MILESTONES.find((m) => m > me.level);
  const mastery = MASTERY_STATS.filter((k) => (a.mastery[k] ?? 0) > 0);
  return (
    <div className="ascsum">
      <div className="ascsum-head">
        <b>{path ? path.title : me.level < ASCENSION_LEVEL ? t('asc.sumLocked', { n: ASCENSION_LEVEL }) : t('asc.pickOne')}</b>
        <ol className="milestones" aria-label={t('asc.milestones', { list: MILESTONES.join(' · '), n })}>
          {MILESTONES.map((m) => <li key={m} className={me.level >= m ? 'on' : ''}><i /><small>{t('common.lv', { n: m })}</small></li>)}
        </ol>
      </div>
      {path && (
        <div className="chips">
          {n > 0 ? <span className="chip better">{t('asc.bonusNow', { n })}: {pathBonusText(path, n)}</span> : <span className="chip">{t('asc.sumNone')}</span>}
          {next && <span className="chip">{t('asc.sumNext', { lv: next })}: {pathBonusText(path, n + 1)}</span>}
        </div>
      )}
      {mastery.length > 0 && (
        <div className="chips">
          <span className="sub">{t('asc.mastery')}:</span>
          {mastery.map((k) => <span key={k} className="chip">{t(STAT_KEY[k] as any)} +{Math.round((a.mastery[k] ?? 0) * MASTERY_VALUE[k] * 10) / 10}{k === 'crit' ? '' : '%'}</span>)}
        </div>
      )}
      {a.awake.length > 0 && <p className="sub">{t('asc.sumAwake', { n: a.awake.length, list: a.awake.map((id) => ABILITIES[id]?.name ?? id).join(', ') })}</p>}
    </div>
  );
}
