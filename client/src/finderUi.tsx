// G9: the dungeon finder. Pick a difficulty, queue for a dungeon; when enough players are waiting
// the server forms the party, brings everyone to the gate and opens the dungeon.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { DIFFICULTY, difficultiesOf, DUNGEONS, type Difficulty } from '../../shared/src/dungeons';
import { FINDER_FULL, FINDER_LEVEL, FINDER_WAIT_MS } from '../../shared/src/social';
import { REGIONS, ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { t, tv, useT } from './i18n';

const GATED = new Set(REGIONS.flatMap((z) => (ZONES[z].gates ?? []).map((g) => g.dungeon)));

export function FinderPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud: Hud = useSyncExternalStore(game.subscribe, game.getHud);
  const [diff, setDiff] = useState('normal' as Difficulty);
  const [, tick] = useState(0);
  useEffect(() => { game.finderOp('state'); }, []);
  useEffect(() => {
    if (!hud.finder?.q) return;
    const id = setInterval(() => tick((n: number) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hud.finder?.q?.since]);
  const me = hud.self, f = hud.finder, q = f?.q;
  if (!me) return null;
  const list = Object.values(DUNGEONS).filter((d) => GATED.has(d.id)).sort((a, b) => a.minLevel - b.minLevel);
  const waited = q ? Math.max(0, Math.floor((Date.now() - q.since) / 1000)) : 0;
  return (
    <div className="hud qlog panel finder" role="dialog" aria-label={t('finder.title')}>
      <div className="sheethead"><div><h2>{t('finder.title')}</h2><div className="sub">{t('finder.help', { n: FINDER_FULL, s: FINDER_WAIT_MS / 1000 })}</div></div>
        <button className="link panelx" onClick={onClose} aria-label={t('finder.close')}>{t('common.close')}</button></div>
      {q && (
        <div className="finderq" role="status">
          <b>{t('finder.queued', { name: DUNGEONS[q.dungeon]?.name ?? q.dungeon, diff: tv(DIFFICULTY[q.diff as Difficulty]?.name ?? q.diff) })}</b>
          <span>{t('finder.waiting', { n: f!.counts[`${q.dungeon}:${q.diff}`] ?? 1, s: waited })}</span>
          <button onClick={() => game.finderOp('leave')}>{t('finder.leave')}</button>
        </div>
      )}
      <div className="tabs" role="radiogroup" aria-label={t('dng.difficulty')}>
        {(['normal', 'hard', 'nightmare', 'armageddon'] as Difficulty[]).map((d) => (
          <button key={d} role="radio" aria-checked={diff === d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>{tv(DIFFICULTY[d].name)}</button>
        ))}
      </div>
      {me.level < FINDER_LEVEL && <p className="err">{t('err.needLevel', { n: FINDER_LEVEL })}</p>}
      {list.map((d) => {
        const offered = difficultiesOf(d).includes(diff), low = me.level < Math.max(FINDER_LEVEL, d.minLevel), n = f?.counts[`${d.id}:${diff}`] ?? 0;
        const mine = q?.dungeon === d.id && q?.diff === diff;
        return (
          <div key={d.id} className={'shoprow finderrow' + (low || !offered ? ' locked' : '')}>
            <span className="lv">{t('common.lv', { n: d.level })}</span>
            <span>{d.name}<small> {low ? t('err.needLevel', { n: Math.max(FINDER_LEVEL, d.minLevel) }) : !offered ? t('finder.noDiff') : n ? t('finder.count', { n }) : t('finder.nobody')}</small></span>
            <button className="small" disabled={low || !offered || !!hud.party || mine} onClick={() => game.finderOp('join', { dungeon: d.id, diff })}
              aria-label={t('finder.joinName', { name: d.name })}>{mine ? t('finder.inQueue') : t('finder.join')}</button>
          </div>
        );
      })}
      {hud.party && <p className="sub">{t('finder.party')}</p>}
    </div>
  );
}
