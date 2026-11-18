// Life outside combat: professions (and forging gear with chosen sub-stats, fishing), the home,
// the season pass and the wardrobe. Plus the Housing Steward's dialog.
import React, { useState, useSyncExternalStore } from 'react';
import { ITEMS, RARITIES, RARITY_COLOR, STAT_LABEL, type GearStat } from '../../shared/src/items';
import {
  AURA_SKINS, FORGEABLE, forgeCost, forgeIlvl, forgeRarity, forgeSlots, FURNITURE, GEAR_STATS, GROW_MS, PROF_MAX, PROFESSIONS, profExpToNext, rareChance, SEASON_LEVELS,
  SEASON_XP, seasonEnds, seasonLevel, seasonReward, SEEDS,
} from '../../shared/src/life';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';

const TABS = ['prof', 'home', 'season', 'wardrobe'] as const;
type Tab = (typeof TABS)[number];

export function LifePanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [tab, setTab] = useState('prof' as Tab) as [Tab, (t: Tab) => void];
  const [base, setBase] = useState('');
  const [stats, setStats] = useState([] as GearStat[]) as [GearStat[], (s: GearStat[]) => void];
  const me = hud.self, l = hud.life;
  if (!me || !l) return null;
  const smith = l.prof.smithing.lv, rar = forgeRarity(smith), ilvl = forgeIlvl(smith, me.level), slots = forgeSlots(rar), cost = forgeCost(ilvl, rar);
  const sl = seasonLevel(l.season.xp), days = Math.max(0, Math.ceil((seasonEnds(Date.now()) - Date.now()) / 86_400_000));
  return (
    <div className="hud lifepanel panel" role="dialog" aria-label={t('life.title')}>
      <div className="sheethead">
        <h2>{t('life.title')}</h2>
        <button className="link panelx" onClick={onClose} aria-label={t('life.close')}>{t('common.close')}</button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`life.tab.${x}` as any)}</button>)}
      </div>
      {tab === 'prof' && (
        <div className="jrbody">
          {PROFESSIONS.map((p) => {
            const s = l.prof[p];
            return (
              <div key={p} className="mission">
                <span>{t(`life.prof.${p}` as any)} <b>{s.lv}</b></span>
                <div className="bar"><i style={{ width: `${s.lv >= PROF_MAX ? 100 : (s.xp / profExpToNext(s.lv)) * 100}%` }} /></div>
                <small>{rareChance(s.lv) ? t('life.rare', { n: Math.round(rareChance(s.lv) * 100) }) : t('life.rareAt')}</small>
                {p === 'fishing' ? <button className="small" onClick={() => game.lifeOp('fish')}>{t('life.fish')}</button> : <span />}
              </div>
            );
          })}
          <h3>{t('life.forge')} <small className="sub">{t('life.forgeHelp', { ilvl, rar: RARITIES[rar], n: slots })}</small></h3>
          <select value={base} onChange={(e: any) => setBase(e.target.value)} aria-label={t('life.forgeItem')}>
            <option value="">{t('life.forgeItem')}</option>
            {FORGEABLE(me.job).map((id) => <option key={id} value={id}>{ITEMS[id].name}</option>)}
          </select>
          <div className="mailitems" role="group" aria-label={t('life.forgeStats', { n: slots })}>
            {GEAR_STATS.map((k) => (
              <button key={k} type="button" className={stats.includes(k) ? 'on' : ''} aria-pressed={stats.includes(k)} onClick={() => setStats(stats.includes(k) ? stats.filter((x) => x !== k) : stats.length < slots ? [...stats, k] : stats)}>{STAT_LABEL[k]}</button>
            ))}
          </div>
          <div className="actions">
            <span className="sub">{t('life.cost', { g: cost.gold.toLocaleString(), mats: cost.mats.map(([b, n]) => `${ITEMS[b].name} ×${n}`).join(', ') })}</span>
            <button className="primary" disabled={!base || !stats.length} onClick={() => game.lifeOp('forge', { base, stats })} style={{ color: RARITY_COLOR[rar] }}>{t('life.forgeIt')}</button>
          </div>
        </div>
      )}
      {tab === 'home' && <HomeTab hud={hud} game={game} />}
      {tab === 'season' && (
        <div className="jrbody">
          <p className="sub">{t('life.seasonHelp', { n: l.season.id, d: days, lv: sl, max: SEASON_LEVELS })}</p>
          <div className="bar"><i style={{ width: `${(l.season.xp / (SEASON_LEVELS * SEASON_XP)) * 100}%` }} /></div>
          <ol className="seasonlist">
            {Array.from({ length: SEASON_LEVELS }, (_, i) => {
              const lv = i + 1, r = seasonReward(lv), got = l.season.claimed.includes(lv), ok = sl >= lv;
              return (
                <li key={lv} className={got ? 'done' : ok ? 'now' : ''}>
                  <b>{lv}</b>
                  <small>{r.gold ? `${r.gold.toLocaleString()}g` : r.item ? `${ITEMS[r.item[0]].name} ×${r.item[1]}` : ''}{r.aura ? ` ✦ ${AURA_SKINS[r.aura].name}` : ''}</small>
                  <button className="small" disabled={!ok || got} onClick={() => game.lifeOp('claim', { level: lv })}>{got ? '✔' : t('jr.claim')}</button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {tab === 'wardrobe' && (
        <div className="jrbody">
          <p className="sub">{t('life.wardrobeHelp')}</p>
          {(['armor', 'helmet'] as const).map((slot) => (
            <div key={slot} className="titlelist">
              <button className={!l.tmog[slot] ? 'on' : ''} onClick={() => game.lifeOp('look', { slot, base: '' })}>{t('life.ownLook', { slot: t(`life.slot.${slot}` as any) })}</button>
              {l.looks.filter((b) => ITEMS[b].slot === slot).map((b) => <button key={b} className={l.tmog[slot] === b ? 'on' : ''} onClick={() => game.lifeOp('look', { slot, base: b })}>{ITEMS[b].name}</button>)}
            </div>
          ))}
          <h3>{t('life.auras')}</h3>
          <div className="titlelist">
            <button className={!l.aura ? 'on' : ''} onClick={() => game.lifeOp('aura', { id: '' })}>{t('life.auraNone')}</button>
            {Object.entries(AURA_SKINS).map(([id, a]) => <button key={id} disabled={!l.auras.includes(id)} className={l.aura === id ? 'on' : ''} onClick={() => game.lifeOp('aura', { id })} style={{ color: a.color }}>✦ {a.name}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

function HomeTab({ hud, game }: { hud: Hud; game: Game }) {
  const [sel, setSel] = useState('');
  const l = hud.life!, h = hud.home, inMine = !!h?.mine;
  const furn = hud.inv.filter((i) => FURNITURE[i.base]), seeds = hud.inv.filter((i) => SEEDS[i.base]);
  if (!inMine)
    return (
      <div className="jrbody">
        <p className="sub">{t('life.homeHelp')}</p>
        <p>{t('life.homeHas', { n: l.home.furn.length, g: l.home.garden.filter(Boolean).length })}</p>
        {h?.owner && <button onClick={() => game.lifeOp('leave')}>{t('life.leaveHome')}</button>}
      </div>
    );
  return (
    <div className="jrbody">
      <p className="sub">{t('life.placeHelp')}</p>
      <div className="mailitems">
        {furn.map((i) => <button key={i.uid} className={sel === i.uid ? 'on' : ''} onClick={() => setSel(sel === i.uid ? '' : i.uid)}>{FURNITURE[i.base].glyph} {ITEMS[i.base].name}</button>)}
      </div>
      {sel && <button className="primary" onClick={() => { const at = game.homeTile(); game.lifeOp('place', { uid: sel, tx: at.tx, ty: at.ty }); setSel(''); }}>{t('life.placeHere')}</button>}
      <button onClick={() => { const at = game.homeTile(); game.lifeOp('pickup', at); }}>{t('life.pickup')}</button>
      <button onClick={() => game.lifeOp('rest')}>{t('life.rest')}</button>
      <h3>{t('life.garden')}</h3>
      {l.home.garden.map((g, i) => {
        const ripe = g && Date.now() - g.at >= GROW_MS, left = g ? Math.max(0, Math.ceil((g.at + GROW_MS - Date.now()) / 60000)) : 0;
        return (
          <div key={i} className="mrow">
            <span>{t('life.plot', { n: i + 1 })}: {g ? `${SEEDS[g.seed].name} · ${ripe ? t('life.ripe') : t('life.grows', { n: left })}` : t('life.empty')}</span>
            <span />
            {g ? <button className="small" disabled={!ripe} onClick={() => game.lifeOp('harvest', { plot: i })}>{t('life.harvest')}</button>
              : <select onChange={(e: any) => e.target.value && game.lifeOp('plant', { plot: i, uid: e.target.value })} value=""><option value="">{t('life.plant')}</option>{seeds.map((s) => <option key={s.uid} value={s.uid}>{ITEMS[s.base].name}</option>)}</select>}
          </div>
        );
      })}
      <button onClick={() => game.lifeOp('leave')}>{t('life.leaveHome')}</button>
    </div>
  );
}

/** The Housing Steward: go home, visit a friend, buy furniture and seeds. */
export function Steward({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const [name, setName] = useState('');
  return (
    <>
      <p>{t('life.stewardSay')}</p>
      <div className="actions">
        <button className="primary" onClick={() => game.lifeOp('home')}>{t('life.goHome')}</button>
        <input placeholder={t('life.visitName')} value={name} maxLength={20} onChange={(e: any) => setName(e.target.value)} />
        <button disabled={!name} onClick={() => game.lifeOp('home', { name })}>{t('life.visit')}</button>
      </div>
      <h3>{t('life.shop')}</h3>
      {[...Object.keys(FURNITURE), ...Object.keys(SEEDS)].map((b) => (
        <div key={b} className="shoprow">
          <span className="glyph">{FURNITURE[b]?.glyph ?? '🌱'}</span>
          <span>{ITEMS[b].name} <small className="gold">{(FURNITURE[b]?.price ?? ITEMS[b].price).toLocaleString()}g</small><small> {ITEMS[b].desc}</small></span>
          <button className="small" disabled={hud.gold < (FURNITURE[b]?.price ?? ITEMS[b].price)} onClick={() => game.lifeOp('buy', { base: b })}>{t('life.buy')}</button>
        </div>
      ))}
    </>
  );
}
