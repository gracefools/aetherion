// Region traits in the HUD (G4): a badge in the right-hand column naming the region's signature
// mechanic, with what it does and how to play against it.
import React from 'react';
import { traitIn } from '../../shared/src/traits';
import type { Hud } from './game/Game';
import { t, useT } from './i18n';
import { toRail } from './rail';

export function TraitBadge({ hud }: { hud: Hud }) {
  useT();
  const tr = traitIn(hud.zoneId, hud.dungeon?.diff, Date.now()), affix = !!hud.dungeon && !!tr;
  if (!tr || !hud.self) return null;
  return toRail(
    <div className="hud traitbadge panel" role="note" aria-label={t('trait.label', { name: tr.name })} style={{ borderColor: tr.color }}>
      <b style={{ color: tr.color }}>{affix ? `${t('affix.weekly')}: ` : ''}{tr.name}</b>
      <span>{tr.desc}</span>
      <small>{tr.tip}</small>
    </div>,
  );
}
