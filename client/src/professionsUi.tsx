// Life > Professions: energy at the top, then three sections. Gathering shows each gathering
// profession as a card (what this region gives, its cost, the level's bonuses, a button that goes
// and does it); Forging walks through gear level, item, sub-stats and the odds; Cooking picks a dish
// and shows each tier with what it needs and what you have.
import React, { useEffect, useState } from 'react';
import { ITEMS, RARITIES, RARITY_COLOR, STAT_LABEL, type GearStat } from '../../shared/src/items';
import {
  cookCost, dayOf, ENERGY_COST, ENERGY_MAX, energyNow, extraYield, FOOD_STAT, FOODS, foodId, FORGE_LEVELS, FORGE_RARITIES, FORGEABLE, forgeCost, forgeRates, GEAR_STATS,
  haulChances, matOf, PROF_MAX, profExpToNext, TIER_MATS, zoneTier, type FoodKind, type Profession,
} from '../../shared/src/life';
import { zoneObjects } from '../../shared/src/places';
import { ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { t, type Key } from './i18n';
import { Icon as ItemIcon } from './inventory';
import { Icon, type IconName } from './ui/icons';

type Section = 'gather' | 'forge' | 'cook';
const SECTIONS: [Section, Key, IconName][] = [['gather', 'prof.sec.gather', 'life'], ['forge', 'prof.sec.forge', 'sword'], ['cook', 'prof.sec.cook', 'heal']];
const GATHERERS: ['mining' | 'herbalism' | 'fishing', IconName][] = [['mining', 'gem'], ['herbalism', 'sprout'], ['fishing', 'drop']];
const fmtLeft = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export function ProfessionsTab({ hud, game }: { hud: Hud; game: Game }) {
  const l = hud.life!, me = hud.self!;
  const [sec, setSec] = useState('gather' as Section);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n: number) => n + 1), 30_000); return () => clearInterval(id); }, []);
  const now = Date.now(), energy = energyNow(l, now), refill = (dayOf(now) + 1) * 86_400_000 - now;
  const have = (b: string) => hud.inv.reduce((n, i) => n + (i.base === b ? i.qty : 0), 0);
  return (
    <div className="jrbody profs">
      <div className="energycard" title={t('life.energyTip')}>
        <Icon name="bolt" size={22} />
        <div className="energymain">
          <div className="energyhead"><b>{t('life.energy')}</b><span><b>{energy}</b> / {ENERGY_MAX}</span></div>
          <div className="bar energy"><i style={{ width: `${(energy / ENERGY_MAX) * 100}%` }} /></div>
          <small className="sub">{energy < ENERGY_MAX ? t('prof.refillIn', { t: fmtLeft(refill) }) : t('prof.full')} · {t('prof.costs', { a: ENERGY_COST[1], b: ENERGY_COST[2], c: ENERGY_COST[3], d: ENERGY_COST[4] })}</small>
        </div>
      </div>
      <div className="tabs proftabs" role="tablist" aria-label={t('life.tab.prof')}>
        {SECTIONS.map(([k, label, icon]) => <button key={k} role="tab" aria-selected={sec === k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}><Icon name={icon} size={14} className="inl" /> {t(label)}</button>)}
      </div>
      {sec === 'gather' && <Gathering hud={hud} game={game} energy={energy} />}
      {sec === 'forge' && <Forging hud={hud} game={game} have={have} job={me.job} />}
      {sec === 'cook' && <Cooking hud={hud} game={game} have={have} />}
    </div>
  );
}

function LevelBar({ lv, xp }: { lv: number; xp: number }) {
  const max = lv >= PROF_MAX, next = max ? 1 : profExpToNext(lv);
  return (
    <div className="proflv">
      <span className="lvbadge">{t('prof.lv', { n: lv, max: PROF_MAX })}</span>
      <div className="bar"><i style={{ width: `${max ? 100 : (xp / next) * 100}%` }} /></div>
      <small className="sub">{max ? t('prof.mastered') : `${xp} / ${next}`}</small>
    </div>
  );
}

function Gathering({ hud, game, energy }: { hud: Hud; game: Game; energy: number }) {
  const l = hud.life!, zone = hud.zoneId, z = ZONES[zone], tier = z && !z.kind ? zoneTier(zone) : 0, cost = ENERGY_COST[tier || 1];
  const go = (p: 'mining' | 'herbalism') => {
    const mat = matOf(p, zone), me = game.pos();
    const nodes = zoneObjects(zone).filter((o) => o.kind === 'node' && o.res === mat).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    const n = nodes[0];
    if (n) game.travelTo({ zone, x: n.x, y: n.y }, { near: 44, label: n.name, then: () => game.objOp('gather', { id: n.id }) });
  };
  return (
    <>
      <p className="sub">{tier ? t('prof.hereTier', { name: z.name, n: tier }) : t('prof.noGather')}</p>
      <div className="profcards">
        {GATHERERS.map(([p, icon]) => {
          const s = l.prof[p], mat = tier ? matOf(p, zone) : TIER_MATS[p][0], c = haulChances(s.lv);
          return (
            <div key={p} className="profcard">
              <div className="profhead">
                <span className="profico"><Icon name={icon} size={20} /></span>
                <b>{t(`life.prof.${p}` as Key)}</b>
              </div>
              <LevelBar lv={s.lv} xp={s.xp} />
              <div className="profhere">
                <ItemIcon base={mat} size={28} />
                <div><b>{ITEMS[mat].name}</b><small className="sub">{tier ? t('prof.tierCost', { n: tier, e: cost }) : t('prof.noGatherShort')}</small></div>
              </div>
              <div className="chips">
                {p === 'mining' ? <span className="chip">{t('prof.extraOre', { n: 1 + extraYield(s.lv), n2: 2 + extraYield(s.lv) })}</span> : (<>
                  <span className="chip">×2 <b>{Math.round(c.x2 * 100)}%</b></span>
                  <span className="chip">×3 <b>{Math.round(c.x3 * 1000) / 10}%</b></span>
                  <span className="chip">×4 <b>{Math.round(c.x4 * 1000) / 10}%</b></span>
                </>)}
              </div>
              {p === 'fishing'
                ? <button className="primary" disabled={!tier || energy < cost} onClick={() => game.lifeOp('fish')} title={t('prof.fishTip')}>{t('life.fish')}</button>
                : <button className="primary" disabled={!tier || energy < cost} onClick={() => go(p)}>{t('prof.goGather', { name: ITEMS[mat].name })}</button>}
              {p === 'fishing' && <small className="sub">{t('prof.fishTip')}</small>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Forging({ hud, game, have, job }: { hud: Hud; game: Game; have: (b: string) => number; job: Parameters<typeof FORGEABLE>[0] }) {
  const l = hud.life!, smith = l.prof.smithing;
  const [lvl, setLvl] = useState(30), [base, setBase] = useState(''), [stats, setStats] = useState([] as GearStat[]) as [GearStat[], (s: GearStat[]) => void];
  const rates = forgeRates(smith.lv), cost = forgeCost(lvl), [ore, need] = cost.mats[0];
  const ok = !!base && stats.length > 0 && hud.gold >= cost.gold && have(ore) >= need;
  return (
    <>
      <div className="profcard wide">
        <div className="profhead"><span className="profico"><Icon name="sword" size={20} /></span><b>{t('life.prof.smithing')}</b></div>
        <LevelBar lv={smith.lv} xp={smith.xp} />
        <div className="oddsbar" aria-label={t('life.forgeOdds')}>
          {FORGE_RARITIES.map((r, i) => rates[i] > 0 && <i key={r} style={{ width: `${rates[i]}%`, background: RARITY_COLOR[r] }} title={`${RARITIES[r]} ${rates[i]}%`} />)}
        </div>
        <div className="oddslegend">{FORGE_RARITIES.map((r, i) => <span key={r} style={{ color: RARITY_COLOR[r] }}>{RARITIES[r]} <b>{rates[i]}%</b></span>)}</div>
        <small className="sub">{t('prof.oddsHelp')}</small>
      </div>
      <h4 className="stephead"><span>1</span> {t('prof.step.level')}</h4>
      <div className="lvlcards">
        {FORGE_LEVELS.map((f) => {
          const m = TIER_MATS.mining[f.tier - 1], n = have(m);
          return (
            <button key={f.ilvl} className={'lvlcard' + (lvl === f.ilvl ? ' on' : '')} aria-pressed={lvl === f.ilvl} onClick={() => setLvl(f.ilvl)}>
              <b>{t('prof.gearLv', { n: f.ilvl })}</b>
              <span><ItemIcon base={m} size={22} /> <small className={n >= f.ore ? 'okq' : 'lowq'}>{n}/{f.ore}</small></span>
            </button>
          );
        })}
      </div>
      <h4 className="stephead"><span>2</span> {t('prof.step.item')}</h4>
      <select value={base} onChange={(e: any) => setBase(e.target.value)} aria-label={t('life.forgeItem')}>
        <option value="">{t('life.forgeItem')}</option>
        {FORGEABLE(job).map((id) => <option key={id} value={id}>{ITEMS[id].name}</option>)}
      </select>
      <h4 className="stephead"><span>3</span> {t('prof.step.stats')}</h4>
      <div className="mailitems statpick" role="group" aria-label={t('life.forgeStats2')}>
        {GEAR_STATS.map((k) => (
          <button key={k} type="button" className={stats.includes(k) ? 'on' : ''} aria-pressed={stats.includes(k)} onClick={() => setStats(stats.includes(k) ? stats.filter((x) => x !== k) : stats.length < 5 ? [...stats, k] : stats)}>
            {stats.includes(k) && <b className="order">{stats.indexOf(k) + 1}</b>}{STAT_LABEL[k]}
          </button>
        ))}
      </div>
      <small className="sub">{t('life.forgeStatsHelp')}</small>
      <div className="forgefoot">
        <span className={hud.gold >= cost.gold ? 'okq' : 'lowq'}><Icon name="coin" size={14} className="inl" /> {cost.gold.toLocaleString()}</span>
        <span className={have(ore) >= need ? 'okq' : 'lowq'}><ItemIcon base={ore} size={18} /> {have(ore)}/{need}</span>
        <small className="sub">{t('prof.atMerchant')}</small>
        <button className="primary" disabled={!ok} onClick={() => game.lifeOp('forge', { base, ilvl: lvl, stats })}>{t('life.forgeIt')}</button>
      </div>
    </>
  );
}

function Cooking({ hud, game, have }: { hud: Hud; game: Game; have: (b: string) => number }) {
  const l = hud.life!, [dish, setDish] = useState('steak' as FoodKind) as [FoodKind, (k: FoodKind) => void], now = Date.now();
  const active = FOODS.filter((k) => (l.food[k]?.until ?? 0) > now);
  const fmt = (k: FoodKind, v: number) => (FOOD_STAT[k].stat === 'moveMul' ? `+${v}%` : `+${v}`);
  return (
    <>
      {active.length > 0 && (
        <div className="activefood" aria-label={t('prof.active')}>
          <small className="sub">{t('prof.active')}</small>
          {active.map((k) => { const f = l.food[k]!; return <span key={k} className="chip"><ItemIcon base={foodId(k, f.t)} size={18} /> {ITEMS[foodId(k, f.t)].name} · {fmtLeft(f.until - now)}</span>; })}
        </div>
      )}
      <div className="dishcards" role="tablist" aria-label={t('life.cookDish')}>
        {FOODS.map((k) => (
          <button key={k} role="tab" aria-selected={dish === k} className={'dishcard' + (dish === k ? ' on' : '')} onClick={() => setDish(k)}>
            <ItemIcon base={foodId(k, 1)} size={28} />
            <b>{t(`prof.dish.${k}` as Key)}</b>
            <small>{t(`prof.stat.${FOOD_STAT[k].stat}` as Key)}</small>
          </button>
        ))}
      </div>
      <small className="sub">{t('prof.cookHelp')}</small>
      <div className="tierrows">
        {[1, 2, 3, 4].map((tier) => {
          const need = cookCost(tier), ok = need.every(([b, n]) => have(b) >= n), id = foodId(dish, tier);
          return (
            <div key={tier} className="tierrow">
              <ItemIcon base={id} size={30} />
              <div className="tiermain"><b>{ITEMS[id].name}</b><small className="sub">{t('prof.tierN', { n: tier })} · {fmt(dish, FOOD_STAT[dish].v[tier - 1])} {t(`prof.stat.${FOOD_STAT[dish].stat}` as Key)} · 30 min</small></div>
              <div className="ingr">{need.map(([b, n]) => <span key={b} className={have(b) >= n ? 'okq' : 'lowq'} title={ITEMS[b].name}><ItemIcon base={b} size={18} /> {have(b)}/{n}</span>)}</div>
              <button className="small primary" disabled={!ok} onClick={() => game.lifeOp('cook', { food: dish, tier })}>{t('life.cookIt')}</button>
            </div>
          );
        })}
      </div>
    </>
  );
}
export type { Profession };
