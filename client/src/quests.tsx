// Quests and factions (M13): the quest log (L), the on-screen tracker, quest offers and turn-ins
// at a town's lorekeeper, and the faction quartermaster. Everything here displays the state the
// server sent and asks the server to act.
import React, { useState, useSyncExternalStore } from 'react';
import { ITEMS } from '../../shared/src/items';
import {
  acceptBlock, factionOfRegion, giverId, QUEST_LIST, QUESTS, REP_LEVELS, repLevel, type QuestDef,
} from '../../shared/src/quests';
import { ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';
import { Icon } from './inventory';
import { t, tm, tv, useT, type Key } from './i18n';
import { toRail } from './rail';

const TYPE_NAME: Record<string, Key> = { main: 'qt.main', side: 'qt.side', daily: 'qt.daily', repeatable: 'qt.repeatable', dungeon: 'qt.dungeon', boss: 'qt.boss', collect: 'qt.collect', faction: 'qt.faction', explore: 'qt.explore' };
const typeName = (q: QuestDef | undefined) => (q ? t(TYPE_NAME[q.type]) : '');
const useHud = (game: Game): Hud => useSyncExternalStore(game.subscribe, game.getHud);
const prog = (hud: Hud, q: QuestDef) => hud.qprog[q.id] ?? q.objectives.map(() => 0);
const complete = (hud: Hud, q: QuestDef) => prog(hud, q).every((v, i) => v >= q.objectives[i].n);
const factionName = (hud: Hud, id: string) => hud.factions.find((f) => f.id === id)?.name ?? id;
const repName = (lv: number) => tv(REP_LEVELS[lv].name);

function Reward({ hud, q }: { hud: Hud; q: QuestDef }) {
  const r = q.reward;
  return (
    <div className="reward">
      {t('quest.reward', { exp: r.exp, gold: r.gold })}
      {r.items.map(([b, n]) => <span key={b}> · {n > 1 ? `${n}× ` : ''}{ITEMS[b]?.name ?? b}</span>)}
      {r.rep.map(([f, n]) => <span key={f}> · +{n} {factionName(hud, f)}</span>)}
    </div>
  );
}
function Objectives({ hud, q, active }: { hud: Hud; q: QuestDef; active: boolean }) {
  const p = prog(hud, q);
  return (
    <ul className="stagelist">
      {q.objectives.map((o, i) => <li key={i} className={active && p[i] >= o.n ? 'better' : ''}>{o.label}{active ? ` (${Math.min(p[i], o.n)}/${o.n})` : ''}</li>)}
    </ul>
  );
}

/** At a lorekeeper: what this town offers, and what can be handed in here. */
export function QuestGiver({ hud, game, zone }: { hud: Hud; game: Game; zone: string }) {
  useT();
  const me = hud.self;
  if (!me) return null;
  const now = Date.now(), here = QUEST_LIST.filter((q) => q.zone === zone);
  const mine = here.filter((q) => hud.quests.active[q.id]);
  const offered = here.filter((q) => !hud.quests.active[q.id]).map((q) => ({ q, why: acceptBlock(q, hud.quests, me.level, hud.rep, now) }))
    // already-finished one-off quests are not shown; everything else is, with the reason it is not yet available
    .filter(({ why }) => why !== 'Already completed');
  return (
    <>
      <h3>{t('quest.title')}</h3>
      {mine.map((q) => (
        <div key={q.id} className={'quest' + (complete(hud, q) ? ' ready' : '')}>
          <h4>{q.name}<span className="qtype">{typeName(q)}</span></h4>
          <Objectives hud={hud} q={q} active />
          {complete(hud, q)
            ? <div className="actions"><button className="primary" onClick={() => game.questOp('turnin', { id: q.id })} aria-label={t('quest.turnInName', { name: q.name })}>{t('quest.turnIn')}</button></div>
            : <p className="sub">{t('quest.inProgress')}</p>}
        </div>
      ))}
      {offered.map(({ q, why }) => (
        <div key={q.id} className="quest">
          <h4>{q.name}<span className="qtype">{typeName(q)}</span> <small className="sub">{t('common.lv', { n: q.level })}</small></h4>
          <div className="sub">{q.text}</div>
          <Objectives hud={hud} q={q} active={false} />
          <Reward hud={hud} q={q} />
          <div className="actions">
            <button className="primary" disabled={!!why} title={why ? tm(why) : undefined} onClick={() => game.questOp('accept', { id: q.id })} aria-label={t('quest.acceptName', { name: q.name })}>{t('common.accept')}</button>
            {why && <span className="err">{tm(why)}</span>}
          </div>
        </div>
      ))}
      {!mine.length && !offered.length && <p className="sub">{t('quest.none')}</p>}
    </>
  );
}

/** The faction whose seat is this town sells its goods to those it trusts. */
export function FactionShop({ hud, game, zone }: { hud: Hud; game: Game; zone: string }) {
  useT();
  const f = factionOfRegion(hud.factions, zone);
  if (!f || !f.shop.length) return null;
  const pts = hud.rep[f.id] ?? 0, lv = repLevel(pts);
  return (
    <>
      <h3>{t('faction.shop', { name: f.name })}</h3>
      <p className="sub">{t('faction.standing')} <b>{repName(lv)}</b> ({pts.toLocaleString()}{lv + 1 < REP_LEVELS.length ? ` / ${t('faction.next', { n: REP_LEVELS[lv + 1].at, name: repName(lv + 1) })}` : ''})</p>
      {f.shop.map(([base, price, need]) => {
        const locked = lv < need;
        return (
          <div key={base} className="shoprow">
            <Icon base={base} size={24} />
            <span>{ITEMS[base]?.name ?? base}<small> {locked ? t('faction.requires', { name: repName(need) }) : ITEMS[base]?.desc}</small></span>
            <button className="small" disabled={locked || hud.gold < price} onClick={() => game.questOp('shop', { faction: f.id, base })} aria-label={t('faction.buy', { item: ITEMS[base]?.name ?? base, name: f.name, g: price })}>{price}g</button>
          </div>
        );
      })}
    </>
  );
}

/** The quest log: active quests, history, and standing with every faction. */
export function QuestLog({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useHud(game), [tab, setTab] = useState('active');
  const active = Object.keys(hud.quests.active).map((id) => QUESTS[id]).filter(Boolean);
  const tabs: [string, string][] = [['active', t('quest.tab.active', { n: active.length })], ['history', t('quest.tab.history')], ['factions', t('quest.tab.factions')]];
  return (
    <div className="hud qlog panel" role="dialog" aria-label={t('quest.log')}>
      <div className="sheethead">
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <button className="link panelx" onClick={onClose} aria-label={t('quest.close')}>{t('common.close')}</button>
      </div>
      {tab === 'active' && (
        <>
          {!active.length && <p className="sub">{t('quest.empty')}</p>}
          {active.map((q) => (
            <div key={q.id} className={'quest' + (complete(hud, q) ? ' ready' : '')}>
              <h4>{q.name}<span className="qtype">{typeName(q)}</span></h4>
              <div className="sub">{q.text}</div>
              <Objectives hud={hud} q={q} active />
              <Reward hud={hud} q={q} />
              <p className="sub">{complete(hud, q) ? t('quest.returnTo', { town: ZONES[q.zone].town!.name }) : t('quest.givenIn', { town: ZONES[q.zone].town!.name })}</p>
              <AbandonButton key={q.id} onConfirm={() => game.questOp('abandon', { id: q.id })} name={q.name} />
            </div>
          ))}
        </>
      )}
      {tab === 'history' && (
        hud.quests.hist.length ? hud.quests.hist.map((h, i) => (
          <div key={i} className="shoprow"><span /> <span><b>{QUESTS[h.id]?.name ?? h.id}</b> <small>{typeName(QUESTS[h.id])} · {t('quest.times', { n: hud.quests.done[h.id]?.n ?? 1 })}</small></span><small>{new Date(h.at).toLocaleString()}</small></div>
        )) : <p className="sub">{t('quest.noHistory')}</p>
      )}
      {tab === 'factions' && hud.factions.map((f) => {
        const pts = hud.rep[f.id] ?? 0, lv = repLevel(pts), next = REP_LEVELS[lv + 1];
        return (
          // the accessible name keeps the English level name, so it is stable across languages
          <div key={f.id} className="rep" aria-label={`${f.name}: ${REP_LEVELS[lv].name}`}>
            <span><b>{f.name}</b><br /><small className="sub">{f.seat} · "{f.creed}"</small></span>
            <div className="bar"><i style={{ width: next ? `${((pts - REP_LEVELS[lv].at) / (next.at - REP_LEVELS[lv].at)) * 100}%` : '100%' }} /></div>
            <b>{repName(lv)}</b>
          </div>
        );
      })}
    </div>
  );
}
function AbandonButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed
    ? <span className="confirm" role="alertdialog" aria-label={t('quest.abandonAsk', { name })}>{t('quest.abandonWarn')} <button className="danger" onClick={onConfirm}>{t('quest.abandonYes')}</button> <button onClick={() => setArmed(false)}>{t('quest.keep')}</button></span>
    : <button className="link" onClick={() => setArmed(true)}>{t('quest.abandon')}</button>;
}

/** On-screen tracker: the active quests and how far along each is. */
export function QuestTracker({ game, onOpen }: { game: Game; onOpen: () => void }) {
  useT();
  const hud = useHud(game), list = Object.keys(hud.quests.active).map((id) => QUESTS[id]).filter(Boolean).slice(0, 4);
  if (!list.length || !hud.self) return null;
  return toRail(
    <div className="qtracker" role="region" aria-label={t('quest.tracker')}>
      {list.map((q) => {
        const p = prog(hud, q), done = complete(hud, q);
        return (
          <button key={q.id} className={'qt link' + (done ? ' done' : '')} onClick={onOpen} style={{ textAlign: 'left', textDecoration: 'none' }}>
            <b>{q.name}</b>
            {done ? <small>{t('quest.trackDone', { town: ZONES[q.zone].town!.name })}</small> : q.objectives.map((o, i) => <div key={i} className={'ob' + (p[i] >= o.n ? ' ok' : '')}>{o.label}: {Math.min(p[i], o.n)}/{o.n}</div>)}
          </button>
        );
      })}
    </div>
  );
}
export { giverId };
