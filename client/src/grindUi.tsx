// G5 in the HUD: the Battle Rhythm streak (kills made by hand in quick succession earn more
// experience) shown above the hotbar while it lasts.
import React, { useEffect, useState } from 'react';
import { RHYTHM_EXP, RHYTHM_MAX } from '../../shared/src/talents';
import type { Hud } from './game/Game';
import { t, useT } from './i18n';

export function RhythmMeter({ hud }: { hud: Hud }) {
  useT();
  const [, tick] = useState(0);
  const r = hud.rhythm, left = r ? r.until - performance.now() : 0;
  useEffect(() => {
    if (!r || left <= 0) return;
    const id = setInterval(() => tick((n: number) => n + 1), 250);
    return () => clearInterval(id);
  }, [r?.until]);
  if (!r || left <= 0 || hud.auto.on || r.n < 2) return null;
  const pct = Math.round(RHYTHM_EXP * r.n * 100);
  return (
    <div className={'hud rhythm' + (r.n >= RHYTHM_MAX ? ' max' : '')} role="status" aria-label={t('rhythm.label', { n: r.n, pct })}>
      <b>{t('rhythm.name')} ×{r.n}</b> <span>+{pct}% EXP</span>
      <i style={{ width: `${Math.max(0, Math.min(100, (left / 12000) * 100))}%` }} />
    </div>
  );
}
