// G7: the seasonal ladders, as a tab of the journal.
import React, { useEffect, useState } from 'react';
import { LADDERS, ladderReward } from '../../shared/src/seasons';
import { JOB_DEFS } from '../../shared/src/jobs';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';

export function SeasonTab({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const [ladder, setLadder] = useState(LADDERS[0].id as string);
  useEffect(() => game.seasonView(ladder), [ladder]);
  const s = hud.season, def = LADDERS.find((l) => l.id === ladder)!, days = s ? Math.max(0, Math.ceil((s.ends - Date.now()) / 86_400_000)) : 0;
  return (
    <div className="jrbody season">
      <p className="sub">{t('season.help', { season: s?.season ?? '', n: days })}</p>
      <div className="tabs" role="tablist" aria-label={t('season.ladders')}>
        {LADDERS.map((l) => <button key={l.id} role="tab" aria-selected={ladder === l.id} className={ladder === l.id ? 'on' : ''} onClick={() => setLadder(l.id)}>{l.name}</button>)}
      </div>
      <p className="sub">{def.score}. {s?.me ? t('season.me', { rank: s.me.rank, score: s.me.score.toLocaleString() }) : t('season.notYet')}</p>
      <ol className="ladder">
        {(s && s.ladder === ladder ? s.rows : []).map((r, i) => {
          const rw = ladderReward(i + 1);
          return (
            <li key={r.id} className={r.id === hud.self?.id ? 'me' : ''}>
              <b>{i + 1}</b> <span>{r.name} <small>{JOB_DEFS[r.job as keyof typeof JOB_DEFS]?.name ?? r.job}</small></span> <em>{r.score.toLocaleString()}</em>
              {rw && <small className="sub"> {rw.gold.toLocaleString()}g{rw.items.length ? ' + ' + t('season.scroll') : ''}</small>}
            </li>
          );
        })}
      </ol>
      {s && s.ladder === ladder && !s.rows.length && <p className="sub">{t('season.empty')}</p>}
    </div>
  );
}
