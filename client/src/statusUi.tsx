// Your buffs and debuffs, above the skill bar: buffs framed green on the left, debuffs framed red
// on the right, each with its icon and the seconds it has left.
import React, { useEffect, useState } from 'react';
import { STATUS } from '../../shared/src/combat';
import { statusIcon } from './game/skillicons';
import type { Hud } from './game/Game';
import { t, tv, useT } from './i18n';
import { FOODS, foodId } from '../../shared/src/life';
import { ITEMS } from '../../shared/src/items';
import { itemIcon } from './game/icons';

export function StatusBar({ hud }: { hud: Hud }) {
  useT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hud.statusUntil.length && !Object.keys(hud.life?.food ?? {}).length) return;
    const id = setInterval(() => tick((n: number) => n + 1), 500);
    return () => clearInterval(id);
  }, [hud.statusUntil.length]);
  const now = performance.now();
  const list = hud.statusUntil.map(([i, until]) => ({ st: STATUS[i], left: Math.max(0, until - now) })).filter((x) => x.st);
  const food = FOODS.flatMap((k) => { const f = hud.life?.food[k]; return f && f.until > Date.now() ? [{ k, f }] : []; });
  if ((!list.length && !food.length) || !hud.self) return null;
  const buffs = list.filter((x) => !x.st.debuff), debuffs = list.filter((x) => x.st.debuff);
  const icon = (x: { st: (typeof STATUS)[number]; left: number }) => {
    const s = Math.ceil(x.left / 1000), long = x.left > 60_000;
    return (
      <span key={x.st.id} className={'stat ' + (x.st.debuff ? 'debuff' : 'buff')} title={`${tv(x.st.name)}${long ? '' : ` · ${s}s`}`} aria-label={`${tv(x.st.name)}, ${long ? '' : t('status.left', { n: s })}`}>
        <img src={statusIcon(x.st.id, 32)} alt="" />
        {!long && <i>{s}</i>}
      </span>
    );
  };
  return (
    <div className="hud statusbar" role="group" aria-label={t('hud.statuses')}>
      <div className="stats-buffs">{buffs.map(icon)}{food.map(({ k, f }) => {
        const m = Math.ceil((f.until - Date.now()) / 60_000), name = ITEMS[foodId(k, f.t)]?.name ?? k;
        return <span key={'f' + k} className="stat buff food" title={`${name} · ${m} min`} aria-label={`${name}, ${m} min`}><img src={itemIcon(foodId(k, f.t))} alt="" /><i>{m}m</i></span>;
      })}</div>
      <div className="stats-debuffs">{debuffs.map(icon)}</div>
    </div>
  );
}
