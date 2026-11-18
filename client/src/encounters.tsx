// Boss bar, zone banner, dungeon entrance dialog and dungeon tracker.
import React, { useState } from 'react';
import { ARMAGEDDON_BOSS_LEVEL, ARMAGEDDON_LEVEL, DIFFICULTY, difficultiesOf, DUNGEONS, type Difficulty } from '../../shared/src/dungeons';
import { BOSS_RARITY, BOSS_UNIQUES, ITEMS, RARITY_COLOR } from '../../shared/src/items';
import { MONSTERS } from '../../shared/src/monsters';
import { ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { rarName } from './inventory';
import { t, tm, tv, useT } from './i18n';

export function BossBar({ hud }: { hud: Hud }) {
  useT();
  const b = hud.boss;
  if (!b) return null;
  return (
    <div className="hud bossbar" role="status" aria-label={t('boss.label', { name: b.name })}>
      <div className="bossname"><strong>{b.name}</strong> <span className="sub">{t('common.lv', { n: b.level })} · {b.title}</span></div>
      <div className="vbar hp boss" role="meter" aria-label={t('boss.health')} aria-valuenow={b.hp} aria-valuemax={b.mhp}>
        <i style={{ width: `${(b.hp / b.mhp) * 100}%` }} /><span>{b.hp.toLocaleString()} / {b.mhp.toLocaleString()}</span>
      </div>
      <div className="phases" aria-label={t('boss.phaseOf', { n: b.phase + 1, of: b.phases, name: b.phaseName })}>
        {Array.from({ length: b.phases }, (_, i) => <span key={i} className={i < b.phase ? 'done' : i === b.phase ? 'on' : ''} />)}
        <em>{t('boss.phase', { n: b.phase + 1, name: b.phaseName })}</em>
      </div>
    </div>
  );
}

export function Banner({ hud }: { hud: Hud }) {
  useT();
  return hud.banner ? <div key={hud.banner.id} className="hud banner" role="alert">{tm(hud.banner.text)}</div> : null;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function DungeonTracker({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const d = hud.dungeon;
  if (!d) return null;
  const def = DUNGEONS[d.id];
  return (
    <div className="hud dtracker panel" role="status" aria-label={t('dng.progress')}>
      <strong>{def.name}</strong> <span className="sub">{tv(DIFFICULTY[d.diff].name)}</span>
      <div className="stages">{def.stages.map((s, i) => <span key={i} className={d.state === 'cleared' || i < d.stage ? 'done' : i === d.stage ? 'on' : ''} title={s.name} />)}</div>
      {d.state === 'cleared'
        ? <div className="sub">{t('dng.cleared', { time: mmss(d.elapsed), n: d.closeIn })}</div>
        : <div className="sub">{t('dng.stage', { name: d.stageName, n: d.left, time: mmss(d.elapsed) })}</div>}
      <button className="small" onClick={() => game.dungeonOp('leave')}>{t('dng.leave')}</button>
    </div>
  );
}

/** The world event running now: what, where, how long is left and how far it has come. */
export function WorldEventTracker({ hud }: { hud: Hud }) {
  useT();
  const ev = hud.wevent;
  if (!ev) return null;
  const left = Math.max(0, Math.ceil((ev.endsAt - Date.now()) / 1000)), here = hud.zoneId === ev.zone, z = ZONES[ev.zone];
  return (
    <div className={'hud weventbar panel ' + ev.state} role="status" aria-label={t('ev.label')}>
      <b>{t(`ev.${ev.kind}` as any)}</b> <small className="sub">{z?.name}{z?.town ? ` · ${z.town.name}` : ''}{here ? ` · ${t('ev.here')}` : ''}</small>
      {ev.state === 'active' ? (
        <>
          <div className="vbar"><i style={{ width: `${(ev.progress / Math.max(1, ev.goal)) * 100}%` }} /><span>{ev.progress} / {ev.goal}</span></div>
          <small>{t(`ev.${ev.kind}.goal` as any)} · {mmss(left)}</small>
        </>
      ) : <small className={ev.state === 'won' ? 'better' : 'worse'}>{ev.state === 'won' ? t('ev.won') : t('ev.lost')}</small>}
    </div>
  );
}

/** A dungeon ready check: every party member agrees before the party goes in. */
export function ReadyCheck({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const r = hud.dready;
  if (!r) return null;
  const def = DUNGEONS[r.id] ?? (r.id === 'rift' ? { name: t('rift.name') } : undefined), me = hud.self?.name ?? '', agreed = r.ok.includes(me), secs = Math.max(0, Math.ceil((r.until - performance.now()) / 1000));
  return (
    <div className="hud readycheck panel" role="alertdialog" aria-label={t('dng.readyTitle', { name: def?.name ?? r.id })}>
      <h3>{t('dng.readyTitle', { name: def?.name ?? r.id })}</h3>
      <p className="sub">{t('dng.readyAsk', { a: r.from, diff: tv(DIFFICULTY[r.diff as Difficulty]?.name ?? r.diff), n: secs })}</p>
      <ul className="readylist">
        {r.ok.map((n) => <li key={n} className="better">✔ {n}</li>)}
        {r.wait.map((n) => <li key={n} className="sub">… {n}</li>)}
      </ul>
      <div className="actions">
        {agreed ? <span className="sub">{t('dng.readyWaiting')}</span> : <button className="primary" onClick={() => game.dungeonReady(true)}>{t('dng.readyYes')}</button>}
        <button onClick={() => game.dungeonReady(false)}>{agreed ? t('common.cancel') : t('dng.readyNo')}</button>
      </div>
    </div>
  );
}

/** Shown while standing at a dungeon entrance. Entering is free and unlimited. */
export function GateDialog({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const [diff, setDiff] = useState('normal' as Difficulty) as [Difficulty, (d: Difficulty) => void];
  const [hidden, setHidden] = useState('');
  if (!hud.gate || hud.dungeon || hidden === hud.gate) return null;
  const def = DUNGEONS[hud.gate], me = hud.self!, boss = MONSTERS[def.boss], w = BOSS_RARITY[diff];
  const leader = !hud.party || hud.party.leader === me.id, low = me.level < def.minLevel;
  return (
    <div className="hud gate panel" role="dialog" aria-label={t('dng.dialog', { name: def.name })}>
      <div className="sheethead"><div><h2>{def.name}</h2><div className="sub">{t('dng.rec', { n: def.level })}</div></div>
        <button className="link" onClick={() => setHidden(hud.gate!)} aria-label={t('dng.close')}>{t('common.close')}</button></div>
      <p className="sub">{def.blurb}</p>
      <ol className="stagelist">{def.stages.map((s, i) => <li key={i}><b>{s.name}</b> <small>{s.spawns.map(([m, n]) => `${n > 1 ? n + '× ' : ''}${MONSTERS[m].name}`).join(', ')}</small></li>)}</ol>
      <div className="diffs" role="radiogroup" aria-label={t('dng.difficulty')}>
        {difficultiesOf(def).map((d) => (
          <button key={d} role="radio" aria-checked={diff === d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)} disabled={d === 'armageddon' && me.level < ARMAGEDDON_LEVEL} title={d === 'armageddon' && me.level < ARMAGEDDON_LEVEL ? t('dng.armLocked', { n: ARMAGEDDON_LEVEL }) : undefined}>
            {tv(DIFFICULTY[d].name)}<small>{d === 'normal' ? t('dng.standard') : t('dng.harder', { hp: Math.round((DIFFICULTY[d].hp - 1) * 100), atk: Math.round((DIFFICULTY[d].atk - 1) * 100) })}</small>
          </button>
        ))}
      </div>
      <div className="sub">
        {t('dng.drops', { name: boss.name })}{' '}
        {[3, 4, 5].map((r, i) => <b key={r} style={{ color: RARITY_COLOR[r] }}>{rarName(r)} {w[i]}%{i < 2 ? ' · ' : ''}</b>)}
      </div>
      <div className="uniques">{(BOSS_UNIQUES[def.boss] ?? []).map((id) => <span key={id} style={{ color: RARITY_COLOR[ITEMS[id].unique!.rar] }}>{ITEMS[id].name}</span>)}</div>
      {low && <p className="err">{t('err.needLevelDot', { n: def.minLevel })}</p>}
      {diff === 'nightmare' && <p className="sub">{t('dng.nightmareDrops')}</p>}
      {diff === 'armageddon' && <p className="sub">{t('dng.armageddonDrops')}</p>}
      {!def.armageddon && <p className="sub">{t('dng.noArmageddon', { n: ARMAGEDDON_BOSS_LEVEL })}</p>}
      {!leader && <p className="sub">{t('dng.follower')}</p>}
      <div className="actions">
        <button className="primary" disabled={low} onClick={() => game.dungeonOp('enter', def.id, diff)}>{leader ? (hud.party ? t('dng.enterParty') : t('dng.enterAlone')) : t('dng.join')}</button>
      </div>
    </div>
  );
}
