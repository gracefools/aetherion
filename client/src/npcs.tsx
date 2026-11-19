// Conversations with townsfolk: the merchant (trade and crafting), the waystone keeper (travel)
// and the lorekeeper (the story of the region). Plus the "press F" hint for anything in reach.
import { RiftWarden } from './riftUi';
import { RaidHerald } from './conquestUi';
import { Steward } from './lifeUi';
import { BankerDialog } from './economy';
import { ArenaMaster } from './pvp';
import React, { useEffect, useState } from 'react';
import { ITEMS } from '../../shared/src/items';
import { FACTIONS, LORE } from '../../shared/src/lore';
import { allDiscoveries, objById, RECIPES, teleportCost, waypointId, zoneObjects } from '../../shared/src/places';
import { REGIONS, ZONES } from '../../shared/src/world';
import { ELEMENT_NAMES, ELEMENTS, runeSpells, type Element } from '../../shared/src/abilities';
import { ownedRunes, ownsRune, RUNE_SHOP, RUNE_STOCK, runePrice } from '../../shared/src/runes';
import { runeIcon, skillIcon } from './game/skillicons';
import { QuestGiver, FactionShop, NpcQuests } from './quests';
import { QUESTS } from '../../shared/src/quests';
import type { Game, Hud } from './game/Game';
import { keyOf } from './game/Game';
import { Icon } from './inventory';
import { t, tm, tv, useT, type Key } from './i18n';

export function InteractHint({ hud }: { hud: Hud }) {
  useT();
  if (!hud.near || hud.talk === hud.near.id) return null;
  return <div className="hud hint" role="status"><kbd>{keyOf('interact')}</kbd> {tm(hud.near.hint)}</div>;
}

const have = (hud: Hud, base: string) => hud.inv.reduce((n, i) => n + (i.base === base ? i.qty : 0), 0);

function Merchant({ hud, game, openBag }: { hud: Hud; game: Game; openBag: () => void }) {
  return (
    <>
      <p className="sub">{t('npc.merchant.say')}</p>
      <div className="actions"><button className="primary" onClick={openBag}>{t('npc.merchant.trade')}</button></div>
      <h3>{t('npc.craft')}</h3>
      {RECIPES.map((r) => {
        const ok = r.needs.every(([b, n]) => have(hud, b) >= n) && hud.gold >= r.gold;
        return (
          <div key={r.id} className="shoprow">
            <Icon base={r.out[0]} size={24} />
            <span>{r.out[1] > 1 ? `${r.out[1]}× ` : ''}{ITEMS[r.out[0]].name}
              <small> {r.needs.map(([b, n]) => `${n} ${ITEMS[b].name} (${have(hud, b)})`).join(' + ')}{r.gold ? ` + ${r.gold}g` : ''}</small></span>
            <button className="small" disabled={!ok} onClick={() => game.objOp('craft', { recipe: r.id })} aria-label={t('npc.craftName', { name: ITEMS[r.out[0]].name, id: r.id })}>{t('npc.craftButton')}</button>
          </div>
        );
      })}
    </>
  );
}

function Waykeeper({ hud, game }: { hud: Hud; game: Game }) {
  const all = allDiscoveries(), caches = all.filter((d) => d.startsWith('cache:'));
  return (
    <>
      <p className="sub">{t('npc.way.say')}</p>
      <div className="waylist">
        {REGIONS.map((z) => {
          const def = ZONES[z], known = hud.disc.includes(waypointId(z)), here = z === hud.zoneId, cost = teleportCost(z);
          return (
            <div key={z} className={'wayrow' + (known ? '' : ' locked')}>
              <span><b>{def.town!.name}</b> <small>{def.name} · {t('common.lvRange', { a: def.level[0], b: def.level[1] })}</small></span>
              {here ? <em>{t('npc.way.here')}</em> : known
                ? <button className="small" disabled={hud.gold < cost} onClick={() => game.objOp('tp', { to: z })} aria-label={t('npc.way.travelTo', { town: def.town!.name, g: cost })}>{t('npc.way.travel', { g: cost })}</button>
                : <em>{t('npc.way.unknown')}</em>}
            </div>
          );
        })}
      </div>
      <p className="sub">{t('npc.way.caches', { n: caches.filter((c) => hud.disc.includes(c)).length, all: caches.length, here: zoneObjects(hud.zoneId).filter((o) => o.kind === 'cache' && hud.disc.includes(o.id)).length })}</p>
    </>
  );
}

function Lorekeeper({ hud, game }: { hud: Hud; game: Game }) {
  const lore = LORE[hud.zoneId], [page, setPage] = useState(0) as [number, (n: number) => void];
  const faction = FACTIONS.find((f) => f.seat.includes(ZONES[hud.zoneId].town!.name));
  if (!lore) return null;
  return (
    <>
      <h3>{lore.title}</h3>
      <p className="lore" aria-live="polite">{lore.pages[page]}</p>
      <div className="actions">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.back')}</button>
        <span className="sub">{page + 1} / {lore.pages.length}</span>
        <button disabled={page === lore.pages.length - 1} onClick={() => setPage(page + 1)}>{t('npc.lore.next')}</button>
      </div>
      {faction && <p className="sub"><b>{faction.name}</b> — "{faction.creed}" {faction.about}</p>}
      <QuestGiver hud={hud} game={game} giver={`lorekeeper:${hud.zoneId}`} />
      <FactionShop hud={hud} game={game} zone={hud.zoneId} />
    </>
  );
}

/** The Rune Merchant: browse the five rune categories, see what each does, buy with confirmation. */
function RuneMerchant({ hud, game }: { hud: Hud; game: Game }) {
  const [sel, setSel]: [Element, (e: Element) => void] = useState('fire');
  const [confirm, setConfirm] = useState('');
  const b = hud.build!, me = hud.self!, shop = RUNE_SHOP[sel], owned = ownsRune(b, sel), price = runePrice(b, sel);
  const why = owned ? '' : me.level < shop.level ? t('err.needLevel', { n: shop.level }) : hud.gold < price ? t('err.gold') : '';
  return (
    <>
      <p className="sub">{t('npc.rune.say')}</p>
      <div className="tabs" role="tablist" aria-label={t('npc.rune.cats')}>
        {ELEMENTS.map((el) => (
          <button key={el} role="tab" aria-selected={el === sel} className={'runetab' + (el === sel ? ' on' : '')} onClick={() => { setSel(el); setConfirm(''); }}>
            <img src={runeIcon(el, 32)} alt="" />{tv(el[0].toUpperCase() + el.slice(1))}{ownsRune(b, el) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="itemcard" aria-live="polite">
        <div className="ithead">
          <img src={runeIcon(sel)} width={48} height={48} alt="" />
          <div>
            <b>{ELEMENT_NAMES[sel]}</b>
            <div className="sub">{t('npc.rune.line', { el: tv(sel[0].toUpperCase() + sel.slice(1)), n: shop.level })} · {owned ? <em className="better">{t('npc.rune.owned', { n: b.runes.lv[sel] ?? 1 })}</em> : <em>{t('npc.rune.notOwned')}</em>}</div>
          </div>
        </div>
        <p className="sub">{shop.blurb}</p>
        {runeSpells(sel).map((sp) => (
          <div key={sp.id} className="node spell on">
            <img className="nodeicon" src={skillIcon(sp.id)} alt="" />
            <b>{sp.name}</b> <small>{t('rune.lv', { n: sp.unlock! })} · {t('skill.costMana', { n: sp.cost })} · {sp.cdMs / 1000}s</small>
            <div>{sp.desc}</div>
          </div>
        ))}
        <div className="actions">
          {owned ? <span className="sub">{t('npc.rune.ownedHelp', { key: keyOf('panel.skills') })}</span>
            : confirm === sel
              ? <span className="confirm" role="alertdialog" aria-label={t('npc.rune.ask', { name: ELEMENT_NAMES[sel] })}>{price ? t('npc.rune.askPrice', { name: ELEMENT_NAMES[sel], g: price }) : t('npc.rune.askFree', { name: ELEMENT_NAMES[sel] })} <button className="primary" onClick={() => { game.invOp('buyrune', { el: sel }); setConfirm(''); }}>{t('npc.rune.confirm')}</button> <button onClick={() => setConfirm('')}>{t('common.cancel')}</button></span>
              : <button className="primary" disabled={!!why} title={why} onClick={() => setConfirm(sel)}>{price ? t('npc.rune.buy', { g: price }) : t('npc.rune.buyFree')}</button>}
          {why && <span className="err">{why}</span>}
        </div>
      </div>
      <h3>{t('npc.rune.scrolls')}</h3>
      <p className="sub">{t('npc.rune.scrollsHelp', { n: ownedRunes(b).length })}</p>
      {RUNE_STOCK.map((id) => (
        <div key={id} className="shoprow">
          <Icon base={id} size={24} /><span>{ITEMS[id].name}<small> {ITEMS[id].desc}</small></span>
          <button className="small" disabled={hud.journal.s.b.includes(id) || hud.gold < ITEMS[id].price} title={t('shop.once')} onClick={() => game.invOp('buy', { base: id, qty: 1 })} aria-label={t('shop.buy', { name: ITEMS[id].name, g: ITEMS[id].price })}>{hud.journal.s.b.includes(id) ? t('shop.bought') : `${ITEMS[id].price}g`}</button>
        </div>
      ))}
    </>
  );
}

const ROLE: Record<string, Key> = { merchant: 'npc.role.merchant', waykeeper: 'npc.role.waykeeper', runesmith: 'npc.role.runesmith', arenamaster: 'npc.role.arenamaster', riftwarden: 'npc.role.riftwarden', raidherald: 'npc.role.raidherald', steward: 'npc.role.steward', lorekeeper: 'npc.role.lorekeeper' };
export function NpcDialog({ hud, game, openBag }: { hud: Hud; game: Game; openBag: () => void }) {
  useT();
  const o = hud.talk ? objById(hud.talk) : undefined;
  // opening a conversation counts for story quests that ask the player to speak to this person
  useEffect(() => {
    if (o && Object.entries(hud.quests.active).some(([id, a]) => QUESTS[id]?.objectives.some((ob, i) => ob.kind === 'talk' && ob.npc === o.id && a.p[i] < ob.n))) game.questOp('talk', { npc: o.id });
  }, [o?.id]);
  if (!o) return null;
  const quests = o.kind !== 'lorekeeper' ? <NpcQuests hud={hud} game={game} npc={o.id} /> : null;
  if (o.kind === 'banker') return <><BankerDialog hud={hud} game={game} name={o.name} town={ZONES[o.zone].town!.name} />{quests}</>;
  return (
    <div className="hud npc panel" role="dialog" aria-label={o.name}>
      <div className="sheethead"><div><h2>{o.name}</h2><div className="sub">{t(ROLE[o.kind] ?? 'npc.role.lorekeeper')} · {ZONES[o.zone].town!.name}</div></div>
        <button className="link" onClick={() => game.closeTalk()} aria-label={t('npc.end')}>{t('common.close')}</button></div>
      {o.kind === 'merchant' && <Merchant hud={hud} game={game} openBag={openBag} />}
      {o.kind === 'waykeeper' && <Waykeeper hud={hud} game={game} />}
      {o.kind === 'lorekeeper' && <Lorekeeper key={o.id} hud={hud} game={game} />}
      {o.kind === 'runesmith' && hud.build && hud.self && <RuneMerchant hud={hud} game={game} />}
      {o.kind === 'arenamaster' && <ArenaMaster hud={hud} game={game} />}
      {o.kind === 'riftwarden' && <RiftWarden hud={hud} game={game} />}
      {o.kind === 'raidherald' && <RaidHerald hud={hud} game={game} />}
      {o.kind === 'steward' && <Steward hud={hud} game={game} />}
      {quests}
    </div>
  );
}
