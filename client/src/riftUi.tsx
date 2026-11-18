// The Endless Rift: the Rift Warden's dialog (enter, the weekly leaderboard) and the climb tracker.
import React, { useEffect, useSyncExternalStore } from 'react';
import { JOB_DEFS } from '../../shared/src/jobs';
import { RIFT_BOSS_EVERY, RIFT_FLOOR_MS, RIFT_MIN_LEVEL } from '../../shared/src/rift';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';

export function RiftWarden({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  useEffect(() => game.riftOp('top'), []);
  const me = hud.self!, low = me.level < RIFT_MIN_LEVEL, leader = !hud.party || hud.party.leader === me.id;
  return (
    <>
      <p>{t('rift.say', { s: RIFT_FLOOR_MS / 1000, n: RIFT_BOSS_EVERY })}</p>
      {low && <p className="err">{t('err.needLevelDot', { n: RIFT_MIN_LEVEL })}</p>}
      {!leader && <p className="sub">{t('rift.follower')}</p>}
      <div className="actions">
        <button className="primary" disabled={low || !leader} onClick={() => game.riftOp('enter')}>{hud.party ? t('rift.enterParty') : t('rift.enterAlone')}</button>
      </div>
      <h3>{t('rift.top')}</h3>
      {!hud.riftTop?.length ? <p className="sub">{t('rift.noScores')}</p> : (
        <table className="rifttop"><tbody>
          {hud.riftTop.map((r, i) => (
            <tr key={i} className={r.name === me.name ? 'me' : ''}><td>{i + 1}</td><td>{r.name}</td><td>{JOB_DEFS[r.job as keyof typeof JOB_DEFS]?.name ?? r.job}</td><td>{t('rift.floorN', { n: r.floor })}</td><td>{Math.floor(r.secs / 60)}:{String(r.secs % 60).padStart(2, '0')}</td><td>{r.party > 1 ? t('rift.partyOf', { n: r.party }) : t('rift.solo')}</td></tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}

export function RiftTracker({ game }: { game: Game }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const r = hud.rift;
  if (!r) return null;
  return (
    <div className="hud dtracker panel rifttracker" role="status" aria-label={t('rift.progress')}>
      <strong>{t('rift.name')}</strong> <span className="sub">{t('rift.floorN', { n: Math.max(1, r.floor) })}{r.floor % RIFT_BOSS_EVERY === 0 && r.floor ? ` · ${t('rift.bossFloor')}` : ''}</span>
      {r.state === 'fight' && <div className="sub">{t('rift.fight', { n: r.left, s: r.time })}</div>}
      {r.state === 'break' && <div className="sub">{r.floor ? t('rift.cleared', { n: r.floor }) : t('rift.starting')}</div>}
      {r.state === 'over' && <div className="sub">{t('rift.over', { n: r.best })}</div>}
      <button className="small" onClick={() => game.riftOp('leave')}>{t('rift.leave')}</button>
    </div>
  );
}
