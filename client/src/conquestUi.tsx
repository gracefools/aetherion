// Raids (the Raid Herald's lobby and the raid tracker) and the guild siege tracker.
import React, { useEffect, useSyncExternalStore } from 'react';
import { RAID_LEVEL, RAID_MAX, RAID_MIN, SIEGE_LEVEL } from '../../shared/src/conquest';
import { ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';
import { toRail } from './rail';
import { Icon } from './ui/icons';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function RaidHerald({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  useEffect(() => game.raidOp('list'), []);
  const me = hud.self!, list = hud.raidLobbies ?? [], mine = list.find((l) => l.members.includes(me.name)), low = me.level < RAID_LEVEL;
  return (
    <>
      <p>{t('raid.say', { min: RAID_MIN, max: RAID_MAX })}</p>
      {low && <p className="err">{t('err.needLevelDot', { n: RAID_LEVEL })}</p>}
      <div className="actions">
        {!mine && <button className="primary" disabled={low} onClick={() => game.raidOp('open')}>{t('raid.open')}</button>}
        {mine && mine.leader === me.name && <button className="primary" onClick={() => game.raidOp('start')}>{t('raid.start', { n: mine.members.length })}</button>}
        {mine && <button onClick={() => game.raidOp('leave')}>{t('raid.leaveGroup')}</button>}
      </div>
      <h3>{t('raid.groups')}</h3>
      {!list.length && <p className="sub">{t('raid.none')}</p>}
      {list.map((l) => (
        <div key={l.id} className="shoprow">
          <span className="glyph"><Icon name="auto" size={18} /></span>
          <span>{t('raid.groupOf', { name: l.leader, n: l.members.length, max: RAID_MAX, lv: l.avg })}<small> {l.members.join(', ')}</small></span>
          {!mine && <button className="small" disabled={low || l.members.length >= RAID_MAX} onClick={() => game.raidOp('join', l.id)}>{t('raid.join')}</button>}
        </div>
      ))}
    </>
  );
}

export function RaidTracker({ game }: { game: Game }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const r = hud.raid;
  if (!r) return null;
  return toRail(
    <div className="hud dtracker panel" role="status" aria-label={t('raid.progress')}>
      <strong>{t('raid.name')}</strong> <span className="sub">{t('raid.raiders', { n: r.players })}</span>
      <div className="stages">{[1, 2, 3].map((s) => <span key={s} className={r.stage > s || r.state === 'won' ? 'done' : r.stage === s ? 'on' : ''} />)}</div>
      <div className="sub">{r.state === 'won' ? t('raid.won') : r.state === 'over' ? t('raid.lost') : r.stage === 0 ? t('raid.starting') : r.stage < 3 ? t('raid.wave', { n: r.stage, left: r.left }) : t('raid.boss')}</div>
      <button className="small" onClick={() => game.raidOp('leave')}>{t('raid.leave')}</button>
    </div>
  );
}

export function SiegeTracker({ game }: { game: Game }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const s = hud.siege;
  if (!s || !hud.self) return null;
  const z = ZONES[s.zone], here = hud.zoneId === s.zone, left = Math.ceil((s.end - Date.now()) / 1000);
  return (
    <div className={'hud siegebar panel' + (here ? ' here' : '')} role="status" aria-label={t('siege.label')}>
      <b>{t('siege.title', { town: z.town!.name })}</b> <small className="sub">{z.name} · {mmss(left)}{s.holder ? ` · ${t('siege.holder', { tag: s.holder })}` : ''}</small>
      {s.scores.length ? (
        <ol>{s.scores.map((x) => <li key={x.guild}>[{x.tag}] <b>{x.points}</b></li>)}</ol>
      ) : <small className="sub">{t('siege.help', { n: SIEGE_LEVEL })}</small>}
    </div>
  );
}
