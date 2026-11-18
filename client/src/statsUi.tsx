// Character stats with where they come from: "Attack 250 (200 + 50)", and on demand each source
// (class progression, skills, sigil skill ranks, equipment and armament item by item, sigil sets,
// pet and mount).
import React, { useState } from 'react';
import { emptyGear } from '../../shared/src/gear';
import { ITEMS, SLOTS } from '../../shared/src/items';
import { JOB_DEFS, type Stats } from '../../shared/src/jobs';
import { BREAKDOWN_STATS, STAT_SOURCES, statBreakdown, type BreakdownStat, type StatSource } from '../../shared/src/statsources';
import type { Hud } from './game/Game';
import { t, useT } from './i18n';
import { slotName } from './inventory';

const LABEL: Partial<Record<BreakdownStat, string>> = {
  maxHp: 'stat.hp', atk: 'stat.atk', matk: 'stat.matk', def: 'stat.def', mdef: 'stat.mdef', crit: 'stat.crit', critDmg: 'stat.critDmg',
  moveMul: 'stat.speed', atkIntervalMs: 'stat.atkTime', range: 'stat.range', lifesteal: 'stat.lifesteal', healPower: 'stat.heal', dodge: 'stat.dodge', runeCost: 'stat.runeCost',
};
/** A value as shown: percentages, multipliers and seconds where the stat is one. */
export function fmtStat(k: BreakdownStat, v: number, delta = false): string {
  const sign = delta && v > 0 ? '+' : '';
  switch (k) {
    case 'crit': case 'lifesteal': case 'dodge': return `${sign}${Math.round(v * 10) / 10}%`;
    case 'critDmg': return delta ? `${sign}${Math.round(v * 100)}%` : `×${v}`;
    case 'healPower': case 'moveMul': return delta ? `${sign}${Math.round(v * 100)}%` : `${Math.round(v * 100)}%`;
    case 'runeCost': return delta ? `${sign}${Math.round(v * 100)}%` : `${Math.round(v * 100)}%`;
    case 'atkIntervalMs': return delta ? `${sign}${(v / 1000).toFixed(2)}s` : `${(v / 1000).toFixed(2)}s`;
    default: return `${sign}${Math.round(v * 10) / 10}`;
  }
}

export function StatSources({ hud }: { hud: Hud }) {
  useT();
  const [open, setOpen] = useState('' as BreakdownStat | '') as [BreakdownStat | '', (v: BreakdownStat | '') => void];
  const me = hud.self!, s = hud.stats!, d = JOB_DEFS[me.job];
  const b = statBreakdown(me.job, me.level, me.ap.weapon, hud.build!, hud.eq ?? {}, hud.gear ?? emptyGear(), hud.comp, hud.journal, hud.asc, hud.guild?.buildings);
  const shown = BREAKDOWN_STATS.filter((k) => LABEL[k] || k === 'maxRes');
  return (
    <div className="statsrc" role="list" aria-label={t('src.title')}>
      {shown.map((k) => {
        const total = (s as Stats)[k], base = b.base[k], extra = Math.round((total - base) * 1000) / 1000;
        const other = Math.round((total - b.total[k]) * 1000) / 1000; // statuses and buffs active right now
        const label = k === 'maxRes' ? (d.resource === 'rage' ? t('stat.rage') : t('stat.mana')) : t(LABEL[k] as any);
        const lines = STAT_SOURCES.filter((src) => b.by[src][k]);
        const isOpen = open === k, any = lines.length > 0 || other !== 0;
        return (
          <div key={k} role="listitem" className={'srcrow' + (isOpen ? ' open' : '')}>
            <button className="srchead" disabled={!any} aria-expanded={any ? isOpen : undefined} onClick={() => setOpen(isOpen ? '' : k)}>
              <span>{label}</span>
              <b>{fmtStat(k, total)}</b>
              {extra !== 0 && <small className={(k === 'atkIntervalMs' || k === 'runeCost' ? extra < 0 : extra > 0) ? 'better' : 'worse'}>({fmtStat(k, base)} {extra > 0 ? '+' : '−'} {fmtStat(k, Math.abs(extra)).replace(/^[×]/, '')})</small>}
            </button>
            {isOpen && (
              <ul className="srclist">
                <li><span>{t('src.base')}</span><b>{fmtStat(k, base)}</b></li>
                {lines.map((src) => <SourceLine key={src} src={src} k={k} v={b.by[src][k]!} b={b} hud={hud} />)}
                {other !== 0 && <li><span>{t('src.other')}</span><b>{fmtStat(k, other, true)}</b></li>}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceLine({ src, k, v, b, hud }: { src: StatSource; k: BreakdownStat; v: number; b: ReturnType<typeof statBreakdown>; hud: Hud }) {
  const per = src === 'equip' || src === 'arm' ? b.slots[src] : null;
  const parts = per ? SLOTS.filter((sl) => per[sl]?.[k]) : [];
  return (
    <li>
      <span>{t(`src.${src}` as any)}</span><b>{fmtStat(k, v, true)}</b>
      {parts.length > 0 && (
        <ul>
          {parts.map((sl) => (
            <li key={sl}><span>{slotName(sl)}{src === 'equip' && hud.eq?.[sl] ? ` · ${ITEMS[hud.eq[sl]!.base].name}` : src === 'arm' ? ` +${hud.gear.arm[sl] ?? 0}` : ''}</span><b>{fmtStat(k, per![sl]![k]!, true)}</b></li>
          ))}
        </ul>
      )}
    </li>
  );
}
