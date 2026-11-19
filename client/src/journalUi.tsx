// The adventurer's journal: missions and the login reward, achievements, titles and the codex.
// It shows the journal the server sent and asks for rewards; the server decides everything.
import React, { useState, useSyncExternalStore } from 'react';
import { ITEMS } from '../../shared/src/items';
import {
  ACHIEVEMENTS, CODEX_BONUS, CODEX_SETS, codexCard, codexComplete, codexNeed, loginGold, LOGIN_REWARDS, MISSIONS, missionReward, TITLES, type Bonus,
} from '../../shared/src/journal';
import { MONSTERS } from '../../shared/src/monsters';
import { REGIONS, ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';
import { SeasonTab } from './seasonUi';

const BONUS_KEY: Record<string, string> = { atk: 'stat.atk', matk: 'stat.matk', maxHp: 'stat.hp', def: 'stat.def', mdef: 'stat.mdef', crit: 'stat.crit', critDmg: 'stat.critDmg', healPower: 'stat.heal', moveMul: 'stat.speed', lifesteal: 'stat.lifesteal', dodge: 'stat.dodge' };
export const bonusText = (b: Bonus) => Object.entries(b).map(([k, v]) => `+${v}${k === 'crit' || k === 'dodge' || k === 'lifesteal' ? '' : '%'} ${t(BONUS_KEY[k] as any)}`).join(', ');
const TABS = ['missions', 'achievements', 'titles', 'codex', 'season'] as const;
type Tab = (typeof TABS)[number];

export function JournalPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [tab, setTab] = useState('missions' as Tab) as [Tab, (t: Tab) => void];
  const j = hud.journal, me = hud.self;
  if (!me) return null;
  const earned = new Set(j.a);
  return (
    <div className="hud journal panel" role="dialog" aria-label={t('jr.title')}>
      <div className="sheethead">
        <h2>{t('jr.title')}</h2>
        <button className="link panelx" onClick={onClose} aria-label={t('jr.close')}>{t('common.close')}</button>
      </div>
      <div className="tabs" role="tablist" aria-label={t('jr.sections')}>
        {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`jr.tab.${x}` as any)}</button>)}
      </div>
      {tab === 'season' && <SeasonTab hud={hud} game={game} />}
      {tab === 'missions' && (
        <div className="jrbody">
          <section className="jrlogin" aria-label={t('jr.login')}>
            <h3>{t('jr.login')} <small className="sub">{t('jr.streak', { n: Math.max(1, j.l.streak) })}</small></h3>
            <ol className="logindays">
              {LOGIN_REWARDS.map((r, i) => {
                const day = i + 1, cur = Math.max(1, j.l.streak), state = day < cur || (day === cur && j.l.claimed) ? 'done' : day === cur ? 'now' : '';
                return (
                  <li key={i} className={state}>
                    <b>{t('jr.day', { n: day })}</b>
                    <small>{loginGold(i, me.level).toLocaleString()}g</small>
                    <small>{r.items.map(([b, q]) => `${ITEMS[b].name} ×${q}`).join(', ')}</small>
                  </li>
                );
              })}
            </ol>
            <button className="primary" disabled={j.l.claimed} onClick={() => game.journalOp('login')}>{j.l.claimed ? t('jr.loginDone') : t('jr.loginClaim', { n: Math.max(1, j.l.streak) })}</button>
          </section>
          {(['daily', 'weekly'] as const).map((kind) => {
            const period = kind === 'daily' ? j.d : j.w, r = missionReward(kind, me.level);
            return (
              <section key={kind} aria-label={t(`jr.${kind}` as any)}>
                <h3>{t(`jr.${kind}` as any)} <small className="sub">{t('jr.reward', { g: r.gold.toLocaleString(), e: r.exp.toLocaleString() })} · {r.items.map((i) => `${ITEMS[i.base].name} ×${i.qty}`).join(', ')}</small></h3>
                {period.m.map(([id, n, claimed], i) => {
                  const def = MISSIONS[id], done = n >= def.n;
                  return (
                    <div key={id} className={'mission' + (claimed ? ' claimed' : done ? ' done' : '')}>
                      <span>{def.name}</span>
                      <div className="bar"><i style={{ width: `${(n / def.n) * 100}%` }} /></div>
                      <small>{n.toLocaleString()} / {def.n.toLocaleString()}</small>
                      <button className="small" disabled={!done || claimed} onClick={() => game.journalOp('claim', { kind, i })}>{claimed ? t('jr.claimed') : t('jr.claim')}</button>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      {tab === 'achievements' && (
        <div className="jrbody">
          <p className="sub">{t('jr.achCount', { n: j.a.length, of: ACHIEVEMENTS.length })}</p>
          <ul className="achlist">
            {ACHIEVEMENTS.map((a) => {
              const have = earned.has(a.id), v = Math.min(a.n, j.c[a.counter] ?? 0);
              return (
                <li key={a.id} className={have ? 'on' : ''}>
                  <b>{have ? '★' : '☆'} {a.name}</b> <small className="sub">{a.desc}</small>
                  {a.title && <small className="ach-title">{t('jr.unlocksTitle', { name: a.title.name })} · {bonusText(a.title.bonus)}</small>}
                  {!have && <div className="bar"><i style={{ width: `${(v / a.n) * 100}%` }} /></div>}
                  {!have && <small className="sub">{v.toLocaleString()} / {a.n.toLocaleString()}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {tab === 'titles' && (
        <div className="jrbody">
          <p className="sub">{t('jr.titleHelp')}</p>
          <div className="titlelist" role="radiogroup" aria-label={t('jr.tab.titles')}>
            <button role="radio" aria-checked={!j.ti} className={!j.ti ? 'on' : ''} onClick={() => game.journalOp('title', { id: '' })}>{t('jr.noTitle')}</button>
            {TITLES.map((a) => {
              const have = earned.has(a.id);
              return (
                <button key={a.id} role="radio" aria-checked={j.ti === a.id} className={j.ti === a.id ? 'on' : ''} disabled={!have} onClick={() => game.journalOp('title', { id: a.id })} title={a.desc}>
                  « {a.title!.name} » <small>{have ? bonusText(a.title!.bonus) : t('jr.locked', { name: a.name })}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {tab === 'codex' && (
        <div className="jrbody">
          <p className="sub">{t('jr.codexHelp')}</p>
          {REGIONS.map((z) => {
            const done = codexComplete(j.k, z), set = CODEX_SETS[z];
            return (
              <section key={z} className={'codexset' + (done ? ' on' : '')} aria-label={ZONES[z].name}>
                <h3>{ZONES[z].name} <small className="sub">{set.filter((id) => codexCard(j.k, id)).length} / {set.length} · {done ? t('jr.setDone') : t('jr.setBonus')}: {bonusText(CODEX_BONUS[z])}</small></h3>
                <div className="cards">
                  {set.map((id) => {
                    const have = codexCard(j.k, id), n = Math.min(codexNeed(id), j.k[id] ?? 0);
                    return (
                      <div key={id} className={'card' + (have ? ' on' : '')} title={`${MONSTERS[id].name}: ${n} / ${codexNeed(id)}`}>
                        <b>{have || n ? MONSTERS[id].name : '???'}</b>
                        <small>{t('common.lv', { n: MONSTERS[id].level })}{MONSTERS[id].boss ? ' · ★' : MONSTERS[id].elite ? ' · ◆' : ''}</small>
                        <small>{n} / {codexNeed(id)}</small>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
