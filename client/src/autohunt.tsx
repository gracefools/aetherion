// Auto hunting panel: a compact status box with Start/Stop, and the settings behind a toggle.
// It only displays state and changes the configuration; the hunter lives in game/autohunt.ts
// and every action it takes is validated by the server.
import React, { useState } from 'react';
import { ABILITIES } from '../../shared/src/abilities';
import { AUTO_RADIUS, autoKind, autoRadius, type AutoConfig, type AutoSkill } from '../../shared/src/autohunt';
import { JOB_DEFS } from '../../shared/src/jobs';
import type { Game, Hud } from './game/Game';
import { t, tm, useT, type Key } from './i18n';
import { keyOf } from './game/Game';
import { toRail } from './rail';
import { Icon } from './ui/icons';

const TOGGLES: [keyof AutoConfig, Key, Key][] = [
  ['attack', 'auto.t.attack', 'auto.t.attackTip'],
  ['skills', 'auto.t.skills', 'auto.t.skillsTip'],
  ['potions', 'auto.t.potions', 'auto.t.potionsTip'],
  ['loot', 'auto.t.loot', 'auto.t.lootTip'],
  ['target', 'auto.t.target', 'auto.t.targetTip'],
  ['elites', 'auto.t.elites', 'auto.t.elitesTip'],
  ['bosses', 'auto.t.bosses', 'auto.t.bossesTip'],
];
const MIN_KEY = 'aetherion.autoMin';
const readMin = () => {
  try {
    return localStorage.getItem(MIN_KEY) === '1';
  } catch {
    return false;
  }
};
const KIND: Record<string, Key> = { enemy: 'auto.kind.target', area: 'auto.kind.area', heal: 'auto.kind.heal', buff: 'auto.kind.buff' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Num({ label, value, min, max, onChange, unit = '%' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <span className="num">
      <input type="number" aria-label={label} min={min} max={max} value={value} onChange={(e: any) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v)))); }} />
      {unit}
    </span>
  );
}

export function AutoPanel({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  useT();
  const [open, setOpen] = useState(false);
  // minimised: one compact bar with the status and Start/Stop, remembered in this browser
  const [min, setMinState] = useState(readMin);
  const setMin = (v: boolean) => {
    setMinState(v);
    try {
      localStorage.setItem(MIN_KEY, v ? '1' : '0');
    } catch { /* storage unavailable */ }
  };
  const a = hud.auto, cfg = a.cfg, me = hud.self, s = hud.stats;
  if (!me || !s) return null;
  const set = (patch: Partial<AutoConfig>) => game.setAutoCfg({ ...cfg, ...patch });
  const setSkill = (id: string, patch: Partial<AutoSkill>) => set({ skillList: cfg.skillList.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const order = [...cfg.skillList].sort((x, y) => x.pri - y.pri);
  // moving a skill up or down swaps its priority with its neighbour
  const move = (id: string, by: number) => {
    const i = order.findIndex((x) => x.id === id), j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = order.map((x) => ({ ...x }));
    [next[i], next[j]] = [next[j], next[i]];
    set({ skillList: next.map((x, k) => ({ ...x, pri: k })) });
  };
  const mana = JOB_DEFS[me.job].resource !== 'rage', res = mana ? t('auto.mp') : t('auto.rage');
  const hpPct = Math.round((hud.hp / s.maxHp) * 100), resPct = Math.round((hud.res / s.maxRes) * 100);
  const key = keyOf('auto.toggle');
  const startStop = a.on
    ? <button className="danger small" onClick={() => game.stopAuto()} title={t('auto.keyTip', { key })}>{t('auto.stop')}</button>
    : <button className="primary small" disabled={hud.dead > 0 || hud.status !== 'playing'} onClick={() => game.startAuto()} title={t('auto.keyTip', { key })}>{t('auto.start')}</button>;
  if (min)
    return toRail(
      <div className={'hud autopanel automin panel' + (a.on ? ' on' : '')} role="region" aria-label={t('auto.title')}>
        <strong>{t('auto.short')}</strong>
        <span className={'chip ' + (a.on ? 'live' : 'idle')} role="status" aria-label={t('auto.statusLabel')}>{a.on ? t('auto.running') : t('auto.off')}</span>
        <span className="autominstat" aria-live="polite">{a.on ? `${tm(a.status)} · ${a.stats.kills}` : `${key}`}</span>
        {startStop}
        <button className="link" onClick={() => setMin(false)} aria-label={t('auto.expand')} title={t('auto.expand')}><Icon name="expand" size={14} /></button>
        {!a.on && <button className="link" onClick={onClose} aria-label={t('auto.close')}><Icon name="close" size={14} /></button>}
      </div>
    );
  return toRail(
    <div className={'hud autopanel panel' + (a.on ? ' on' : '')} role="region" aria-label={t('auto.title')}>
      <div className="autohead">
        <strong>{t('auto.title')}</strong>
        <span className={'chip ' + (a.on ? 'live' : 'idle')} role="status" aria-label={t('auto.statusLabel')}>{a.on ? t('auto.running') : t('auto.off')}</span>
        <button className="link" onClick={() => setMin(true)} aria-label={t('auto.minimize')} title={t('auto.minimize')}><Icon name="minimize" size={14} /></button>
        <button className="link" onClick={onClose} aria-label={t('auto.close')}>{t('common.close')}</button>
      </div>
      <div className="autostatus" aria-live="polite">{tm(a.status)}</div>
      {a.on && a.xp !== undefined && <div className={'sub autoxp' + (a.xp < 0.8 ? ' err' : '')}>{t('auto.xp', { pct: Math.round(a.xp * 100) })}{a.xp < 0.8 ? ` ${t('auto.weary')}` : ''}</div>}
      <div className="autogrid">
        <span>{t('auto.target')}</span><b>{a.target || '—'}</b>
        <span>{t('auto.hpRes', { res })}</span><b>{hpPct}% / {resPct}%</b>
        <span>{t('auto.potionsAt')}</span><b>{cfg.potions ? `${t('auto.hpBelow', { n: cfg.hpPct })}${mana ? ` · ${t('auto.mpBelow', { n: cfg.mpPct })}` : ''}` : t('auto.offWord')}</b>
        <span>{t('auto.skills')}</span><b>{cfg.skills ? order.filter((x) => x.on).map((x) => ABILITIES[x.id].name).join(', ') || t('auto.noneTicked') : t('auto.offWord')}</b>
        <span>{t('auto.kills')}</span><b>{a.stats.kills}</b>
        <span>{t('auto.exp')}</span><b>{a.stats.exp.toLocaleString()}</b>
        <span>{t('auto.items')}</span><b>{a.stats.items}{a.stats.skipped ? ` ${t('auto.left', { n: a.stats.skipped })}` : ''} · {a.stats.gold.toLocaleString()}g</b>
        {a.on && <><span>{t('auto.time')}</span><b>{mmss(a.stats.secs)}</b></>}
      </div>
      <div className="actions">
        <button className="small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t('auto.hideSettings') : t('auto.settings')}</button>
        {a.on
          ? <button className="danger" onClick={() => game.stopAuto()} title={t('auto.keyTip', { key })}>{t('auto.stop')}</button>
          : <button className="primary" disabled={hud.dead > 0 || hud.status !== 'playing'} onClick={() => game.startAuto()} title={t('auto.keyTip', { key })}>{t('auto.start')}</button>}
        <small className="sub">{t('auto.keyHint', { key })}</small>
      </div>
      {open && (
        <div className="autocfg">
          <div className="switches">
            {TOGGLES.map(([key, label, tip]) => (
              <label className="switch" key={key} title={t(tip)}>
                <input type="checkbox" checked={cfg[key] as boolean} onChange={(e: any) => set({ [key]: e.target.checked })} />{t(label)}
              </label>
            ))}
          </div>
          <div className="autorow"><span>{t('auto.hpPotion')}</span><Num label={t('auto.hpThreshold')} value={cfg.hpPct} min={5} max={95} onChange={(v) => set({ hpPct: v })} /></div>
          {mana && <div className="autorow"><span>{t('auto.mpPotion')}</span><Num label={t('auto.mpThreshold')} value={cfg.mpPct} min={5} max={95} onChange={(v) => set({ mpPct: v })} /></div>}
          <div className="autorow"><span>{t('auto.radius')}</span><Num label={t('auto.radius')} value={cfg.radius} min={AUTO_RADIUS.min} max={AUTO_RADIUS.max} unit={` ${t('auto.tiles')}`} onChange={(v) => set({ radius: v })} /></div>
          <h3>{t('auto.skillOrder')}</h3>
          {order.length === 0 && <p className="sub">{t('auto.noSkills')}</p>}
          {order.map((sk, i) => {
            const def = ABILITIES[sk.id], kind = autoKind(def)!, area = kind === 'area' || autoRadius(def) > 0;
            return (
              <div key={sk.id} className={'autoskill' + (sk.on ? ' on' : '')}>
                <label className="switch"><input type="checkbox" aria-label={t('auto.useAuto', { name: def.name })} checked={sk.on} onChange={(e: any) => setSkill(sk.id, { on: e.target.checked })} /><b>{def.name}</b> <small>{t(KIND[kind])}</small></label>
                <span className="pctl">
                  <button className="small" disabled={i === 0} onClick={() => move(sk.id, -1)} aria-label={t('auto.raise', { name: def.name })}>▲</button>
                  <button className="small" disabled={i === order.length - 1} onClick={() => move(sk.id, 1)} aria-label={t('auto.lower', { name: def.name })}>▼</button>
                </span>
                <div className="conds">
                  {kind !== 'heal' && <span>{res} ≥ <Num label={t('auto.minRes', { name: def.name, res })} value={sk.minMp} min={0} max={100} onChange={(v) => setSkill(sk.id, { minMp: v })} /></span>}
                  {area && kind !== 'heal' && kind !== 'buff' && <span>{t('auto.enemies')} ≥ <Num label={t('auto.minEnemies', { name: def.name })} value={sk.minEnemies} min={1} max={9} unit="" onChange={(v) => setSkill(sk.id, { minEnemies: v })} /></span>}
                  {(kind === 'heal' || kind === 'buff') && <span>{t('auto.hpUnder')} <Num label={t('auto.useBelow', { name: def.name })} value={sk.hpBelow} min={1} max={100} onChange={(v) => setSkill(sk.id, { hpBelow: v })} /></span>}
                </div>
              </div>
            );
          })}
          <label className="switch" title={t('auto.finishTip')}><input type="checkbox" checked={cfg.finishWithSkills} onChange={(e: any) => set({ finishWithSkills: e.target.checked })} />{t('auto.finish')}</label>
          <h3>{t('auto.loot')}</h3>
          <div className="autorow"><span>{t('auto.collect')}</span>
            <select aria-label={t('auto.lootMode')} value={cfg.lootMode} disabled={!cfg.loot} onChange={(e: any) => set({ lootMode: e.target.value })}>
              <option value="all">{t('auto.loot.all')}</option><option value="equip">{t('auto.loot.equip')}</option><option value="rare">{t('auto.loot.rare')}</option>
            </select>
          </div>
          <div className="switches">
            {(['potion', 'material', 'scroll'] as const).map((k) => (
              <label className="switch" key={k}><input type="checkbox" disabled={!cfg.loot} checked={cfg.ignore.includes(k)} onChange={(e: any) => set({ ignore: e.target.checked ? [...cfg.ignore, k] : cfg.ignore.filter((x) => x !== k) })} />{t(`auto.ignore.${k}` as Key)}</label>
            ))}
          </div>
          <div className="autorow"><span>{t('auto.full')}</span>
            <select aria-label={t('auto.full')} value={cfg.onFull} onChange={(e: any) => set({ onFull: e.target.value })}><option value="continue">{t('auto.full.continue')}</option><option value="stop">{t('auto.full.stop')}</option></select>
          </div>
          <div className="autorow"><span>{t('auto.ends')}</span>
            <select aria-label={t('auto.returnLabel')} value={cfg.returnTo} onChange={(e: any) => set({ returnTo: e.target.value })}><option value="none">{t('auto.ret.none')}</option><option value="start">{t('auto.ret.start')}</option><option value="town">{t('auto.ret.town')}</option></select>
          </div>
          <p className="sub">{t('auto.help')}</p>
        </div>
      )}
    </div>
  );
}
