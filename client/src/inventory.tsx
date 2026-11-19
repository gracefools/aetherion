// Inventory, equipment and shop panel, potion quick slots and loot notifications.
// Everything here only displays state and sends requests: the server decides every outcome.
import { dayOf } from '../../shared/src/journal';
import React, { useState } from 'react';
import {
  equipBlock, INVENTORY_SIZE, ITEMS, itemName, itemStats, MAX_UPGRADE, POTION_CD_MS, RARITIES, RARITY_COLOR, reqLevel, sellValue,
  DAILY_STONES, PASSIVES, SETS, SHOP_BUY_MAX, SHOP_COMPANIONS, SHOP_ONCE, SHOP_STOCK, SLOT_NAMES, SLOTS, STAT_LABEL, UPGRADE_CHANCE, upgradeCost, type GearStat, type Item, type Slot,
} from '../../shared/src/items';
import { type SortKey, SORT_KEYS } from '../../shared/src/protocol';
import type { Game, Hud } from './game/Game';
import { keyOf } from './game/Game';
import { itemIcon } from './game/icons';
import { t, tm, tv, useT, type Key } from './i18n';
import { ArmamentTab, SigilInfo, SigilTab, StatBlocks } from './gearUi';
import { hideTip, tip } from './tooltip';

const PCT: Partial<Record<GearStat, boolean>> = { crit: true, critDmg: true, lifesteal: true, dodge: true, healPower: true };
const fmt = (k: GearStat, v: number) => (PCT[k] ? `${Math.round(v * (k === 'crit' || k === 'dodge' ? 10 : 1000)) / 10}%` : String(Math.round(v)));
/** Rarity and slot names are short fixed vocabularies, translated like interface text. */
export const rarName = (r: number) => tv(RARITIES[r]);
export const slotName = (s: Slot) => tv(SLOT_NAMES[s]);

export function Icon({ item, base, size = 32 }: { item?: Item; base?: string; size?: number }) {
  const id = item?.base ?? base!;
  return <img className="icon" src={itemIcon(id)} width={size} height={size} alt="" style={{ imageRendering: 'pixelated' }} />;
}

type BagFilter = 'all' | 'equip' | 'use' | 'comp' | 'scroll' | 'mat';
/** The bag's filters: what each shows. */
const BAG_FILTERS: [BagFilter, Key, (i: Item) => boolean][] = [
  ['all', 'bag.f.all', () => true],
  ['equip', 'bag.f.equip', (i) => ITEMS[i.base].kind === 'equip'],
  ['use', 'bag.f.use', (i) => ITEMS[i.base].kind === 'potion'],
  ['comp', 'bag.f.comp', (i) => ITEMS[i.base].kind === 'pet' || ITEMS[i.base].kind === 'mount'],
  ['scroll', 'bag.f.scroll', (i) => ITEMS[i.base].kind === 'scroll'],
  ['mat', 'bag.f.mat', (i) => ITEMS[i.base].kind === 'material' || ITEMS[i.base].kind === 'sigil'],
];
/** One click on the sort icon sorts the way that suits what is shown: gear by rarity, the rest by type. */
const sortFor = (f: BagFilter): SortKey => (f === 'equip' ? 'rarity' : f === 'mat' || f === 'scroll' ? 'name' : 'kind');
function Cell({ item, sel, onClick, onUse, mark = false, hud }: { item?: Item; sel: boolean; onClick: () => void; onUse: () => void; mark?: boolean; hud?: Hud }) {
  if (!item) return <span className="cell empty" />;
  const b = ITEMS[item.base];
  const tipProps = hud ? tip(() => <ItemTip item={item} hud={hud} />) : {};
  return (
    <button
      className={'cell' + (sel ? ' sel' : '') + (mark ? ' marked' : '')} style={{ borderColor: b.kind === 'equip' ? RARITY_COLOR[item.rar] : undefined }}
      {...tipProps} onClick={onClick} onDoubleClick={(e: any) => { hideTip(); onUse(); void e; }} aria-label={`${b.kind === 'equip' ? rarName(item.rar) + ' ' : ''}${itemName(item)}${item.qty > 1 ? ` ×${item.qty}` : ''}${item.bd ? ` (${t('item.bound')})` : ''}`} aria-pressed={sel}
    >
      <Icon item={item} />
      {item.qty > 1 && <span className="qty">{item.qty}</span>}
      {item.up > 0 && <span className="up">+{item.up}</span>}
      {item.bd && <span className="bd" aria-hidden="true">⛓</span>}
    </button>
  );
}

const KIND_LINE: Record<string, Key> = { potion: 'item.kind.potion', scroll: 'item.kind.scroll', pet: 'item.kind.pet', mount: 'item.kind.mount', material: 'item.kind.material', sigil: 'item.kind.sigil' };
/**
 * The hover card for an item (or an item base, as sold in a shop): name in its rarity's colour, what
 * it is, bound or tradable, its stats and how they compare with what is worn, set and passive, its
 * description, what it sells for and what a double click does.
 */
export function ItemTip({ item, base, hud, price }: { item?: Item; base?: string; hud: Hud; price?: number }) {
  const it: Item = item ?? { uid: '', base: base!, rar: ITEMS[base!].unique?.rar ?? 0, ilvl: hud.self?.level ?? 1, aff: [], up: 0, qty: 1 };
  const b = ITEMS[it.base], me = hud.self;
  if (!b) return null;
  const worn = !!item && SLOTS.some((s) => hud.eq[s]?.uid === item.uid);
  const cur = b.slot && !worn ? hud.eq[b.slot] : undefined, st = itemStats(it), curSt = cur ? itemStats(cur) : {};
  const keys = [...new Set([...Object.keys(st), ...Object.keys(curSt)])] as GearStat[];
  const block = b.kind === 'equip' && me ? equipBlock(it, me.job, me.level) : '';
  const use = b.kind === 'equip' ? (worn ? 'tip.dblUnequip' : 'tip.dblEquip') : b.kind === 'potion' ? 'tip.dblDrink' : b.kind === 'pet' || b.kind === 'mount' ? 'tip.dblAdd' : b.kind === 'scroll' ? 'tip.dblRead' : it.base.startsWith('furn_') ? 'tip.dblPlace' : '';
  return (
    <div className="tipcard" style={{ ['--rar' as any]: b.kind === 'equip' ? RARITY_COLOR[it.rar] : '#c9a24a' }}>
      <div className="tiphead">
        <Icon item={it} size={36} />
        <div>
          <b className="tipname">{itemName(it)}{it.up > 0 ? ` +${it.up}` : ''}{it.qty > 1 ? ` ×${it.qty}` : ''}</b>
          <div className="sub">{b.kind === 'equip' ? t('item.equipLine', { rar: rarName(it.rar), slot: slotName(b.slot!), ilvl: it.ilvl, req: reqLevel(it) }) : t(KIND_LINE[b.kind] ?? 'item.kind.material', { key: keyOf('panel.companions') })}</div>
          {b.kind === 'equip' && item && <div className={'boundline' + (it.bd ? ' on' : '')}>{it.bd ? `⛓ ${t('item.bound')}` : t('item.tradable')}</div>}
        </div>
      </div>
      {b.kind === 'equip' && item && <StatBlocks item={it} hud={hud} worn={worn} />}
      {b.kind === 'equip' && !item && <div className="statgrid">{(Object.keys(st) as GearStat[]).map((k) => <div key={k}><span>{tv(STAT_LABEL[k])}</span><b>{fmt(k, st[k]!)}</b></div>)}</div>}
      {b.kind === 'equip' && cur && keys.some((k) => Math.abs((st[k] ?? 0) - (curSt[k] ?? 0)) > 1e-9) && (
        <div className="tipcompare">
          <small className="sub">{t('tip.vsWorn', { name: itemName(cur) })}</small>
          {keys.map((k) => {
            const d = (st[k] ?? 0) - (curSt[k] ?? 0);
            return Math.abs(d) > 1e-9 ? <span key={k} className={d > 0 ? 'better' : 'worse'}>{d > 0 ? '▲' : '▼'} {tv(STAT_LABEL[k])} {fmt(k, Math.abs(d))}</span> : null;
          })}
        </div>
      )}
      {b.unique?.passive && <p className="passive"><b>{PASSIVES[b.unique.passive].name}:</b> {PASSIVES[b.unique.passive].text}</p>}
      {b.unique?.set && <p className="sub"><b>{SETS[b.unique.set].name}</b>: {SETS[b.unique.set].bonus.map((x, i) => `(${i + 2}) ${x.text}`).join(' · ')}</p>}
      <p className="sub tipdesc">{b.desc}</p>
      {block && <p className="err">{tm(block)}</p>}
      <div className="tipfoot">
        {price !== undefined ? <span className="gold">{t('tip.price', { g: price })}</span> : <span className="gold">{t('tip.sells', { g: sellValue(it) * it.qty })}</span>}
        {use && item && <span>{t(use as Key)}</span>}
      </div>
    </div>
  );
}
function Details({ item, worn, hud, game, askRead = false }: { item: Item; worn: Slot | null; hud: Hud; game: Game; askRead?: boolean }) {
  const me = hud.self!, b = ITEMS[item.base], st = itemStats(item);
  const block = b.kind === 'equip' ? equipBlock(item, me.job, me.level) : '';
  const cur = b.slot && !worn ? hud.eq[b.slot] : undefined, curSt = cur ? itemStats(cur) : {};
  const cost = upgradeCost(item), stones = hud.inv.reduce((n, i) => n + (i.base === 'upgrade_stone' ? i.qty : 0), 0);
  const keys = [...new Set([...Object.keys(st), ...Object.keys(curSt)])] as GearStat[];
  return (
    <div className="itemcard" aria-live="polite">
      <div className="ithead">
        <Icon item={item} size={40} />
        <div>
          <b style={{ color: b.kind === 'equip' ? RARITY_COLOR[item.rar] : undefined }}>{itemName(item)}</b>
          <div className="sub">{b.kind === 'equip' ? t('item.equipLine', { rar: rarName(item.rar), slot: slotName(b.slot!), ilvl: item.ilvl, req: reqLevel(item) }) : t(KIND_LINE[b.kind] ?? 'item.kind.material', { key: keyOf('panel.companions') })}</div>
          {b.kind === 'equip' && <div className={'boundline' + (item.bd ? ' on' : '')} title={t(item.bd ? 'item.boundTip' : 'item.tradableTip')}>{item.bd ? `⛓ ${t('item.bound')}` : t('item.tradable')}</div>}
        </div>
      </div>
      {b.kind === 'equip' && <StatBlocks item={item} hud={hud} worn={!!worn} />}
      {b.kind === 'equip' && cur && (
        <>
          <h4 className="statsh">{t('gear.vsEquipped')}</h4>
          <div className="statgrid">
            {keys.map((k) => {
              const v = st[k] ?? 0, d = v - (curSt[k] ?? 0);
              return <div key={k}><span>{tv(STAT_LABEL[k])}</span><b>{fmt(k, v)}{Math.abs(d) > 1e-9 ? <em className={d > 0 ? 'better' : 'worse'}> {d > 0 ? '▲' : '▼'}{fmt(k, Math.abs(d))}</em> : null}</b></div>;
            })}
          </div>
        </>
      )}
      {b.kind === 'sigil' && <SigilInfo item={item} hud={hud} game={game} equipped={-1} />}
      {b.unique?.passive && <p className="passive"><b>{PASSIVES[b.unique.passive].name}:</b> {PASSIVES[b.unique.passive].text}</p>}
      {b.unique?.set && (() => {
        const set = SETS[b.unique!.set!], n = SLOTS.filter((s) => hud.eq[s] && ITEMS[hud.eq[s]!.base].unique?.set === set.id).length;
        return (
          <div className="setbox">
            <b>{set.name}</b> <small>{t('item.setCount', { n })}</small>
            {set.bonus.map((bo, i) => <div key={i} className={n >= i + 2 ? 'on' : ''}>({i + 2}) {bo.text}</div>)}
          </div>
        );
      })()}
      <p className="sub">{b.desc}</p>
      {block && <p className="err">{tm(block)}</p>}
      <div className="actions">
        {worn && <button onClick={() => game.invOp('unequip', { slot: worn })}>{t('item.unequip')}</button>}
        {!worn && b.kind === 'equip' && <button className="primary" disabled={!!block} onClick={() => game.invOp('equip', { uid: item.uid })}>{t('item.equip')}</button>}
        {!worn && (b.kind === 'potion' || b.kind === 'pet' || b.kind === 'mount') && <button className="primary" onClick={() => game.invOp('use', { uid: item.uid })}>{t('item.use')}</button>}
        {!worn && b.kind === 'scroll' && <ReadButton key={item.uid + item.qty + (askRead ? ':ask' : '')} name={b.name} armedAtFirst={askRead} onConfirm={() => game.invOp('scroll', { uid: item.uid })} />}
        {b.kind === 'equip' && item.up < MAX_UPGRADE && (
          <button
            disabled={hud.gold < cost.gold || stones < cost.stones} onClick={() => game.invOp('upgrade', { uid: item.uid })}
            title={t('item.upgradeTip', { pct: UPGRADE_CHANCE[item.up] })}
          >{t(cost.stones > 1 ? 'item.upgradeN' : 'item.upgrade1', { to: item.up + 1, gold: cost.gold, stones: cost.stones, pct: UPGRADE_CHANCE[item.up] })}</button>
        )}
        {!worn && hud.shop && <button onClick={() => game.invOp('sell', { uid: item.uid, qty: item.qty })}>{t(item.qty > 1 ? 'item.sellAll' : 'item.sell', { g: sellValue(item) * item.qty })}</button>}
        {!worn && <DestroyButton key={item.uid} onConfirm={() => game.invOp('destroy', { uid: item.uid })} />}
      </div>
    </div>
  );
}
/** Two clicks to sell many items at once: the second names exactly what will happen. */
function SellButton({ n, total, onConfirm }: { n: number; total: number; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed
    ? <button className="danger" onClick={onConfirm}>{t('bulk.confirm', { n, g: total })}</button>
    : <button className="primary" disabled={!n} onClick={() => setArmed(true)}>{t('bulk.sell')}</button>;
}
/** Reading a scroll consumes it, so it asks first. */
function ReadButton({ name, onConfirm, armedAtFirst = false }: { name: string; onConfirm: () => void; armedAtFirst?: boolean }) {
  const [armed, setArmed] = useState(armedAtFirst);
  if (!armed) return <button className="primary" onClick={() => setArmed(true)}>{t('scroll.read')}</button>;
  return (
    <span className="confirm" role="alertdialog" aria-label={t('scroll.ask', { name })}>
      {t('scroll.warn', { name })} <button className="primary" onClick={onConfirm}>{t('scroll.yes')}</button> <button onClick={() => setArmed(false)}>{t('scroll.no')}</button>
    </span>
  );
}
function DestroyButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? <button className="danger" onClick={onConfirm}>{t('item.destroyConfirm')}</button> : <button className="link" onClick={() => setArmed(true)}>{t('item.destroy')}</button>;
}

export function InventoryPanel({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  useT();
  const [sel, setSel] = useState('');
  /** A scroll double-clicked: its details open on the question whether to read it. */
  const [askRead, setAskRead] = useState('');
  // bulk sale: the set of marked item ids while "sell several" is on (null = off)
  const [marks, setMarks] = useState(null as Set<string> | null);
  const marked = marks ? hud.inv.filter((i) => marks.has(i.uid)) : [];
  const total = marked.reduce((n, i) => n + sellValue(i) * i.qty, 0);
  const toggle = (uid: string) => {
    const next = new Set(marks);
    next.has(uid) ? next.delete(uid) : next.add(uid);
    setMarks(next);
  };
  const markAll = (pred: (i: Item) => boolean) => setMarks(new Set([...marked.map((i) => i.uid), ...hud.inv.filter(pred).map((i) => i.uid)]));
  const worn = SLOTS.find((s) => hud.eq[s]?.uid === sel) ?? null;
  const item = worn ? hud.eq[worn] : hud.inv.find((i) => i.uid === sel);
  const quick = (it: Item) => {
    const k = ITEMS[it.base].kind;
    if (k === 'equip') game.invOp('equip', { uid: it.uid });
    else if (k === 'potion' || k === 'pet' || k === 'mount') game.invOp('use', { uid: it.uid });
    else if (k === 'sigil') game.invOp('sigil', { uid: it.uid });
    else if (k === 'scroll') {
      // reading uses the scroll up: a double click opens the question instead of reading at once
      setSel(it.uid);
      setAskRead(it.uid);
    } else if (it.base.startsWith('furn_') && hud.home?.mine) {
      const at = game.homeTile();
      game.lifeOp('place', { uid: it.uid, tx: at.tx, ty: at.ty });
    }
  };
  const [tab, setTab] = useState('bag' as 'bag' | 'arm' | 'sigil');
  // the bag's filter and name search (the order itself is the server's, set by sorting)
  const [filter, setFilter] = useState('all' as BagFilter);
  const [query, setQuery] = useState('');
  const fit = BAG_FILTERS.find((f) => f[0] === filter)![2], words = query.trim().toLowerCase();
  const shownItems = hud.inv.filter((i) => fit(i) && (!words || itemName(i).toLowerCase().includes(words)));
  const filtering = filter !== 'all' || !!words;
  return (
    <div className="hud bag panel" role="dialog" aria-label={t('bag.title')}>
      <div className="sheethead">
        <div><h2>{t('bag.title')}</h2><div className="sub"><b className="gold">{t('common.gold', { n: hud.gold })}</b></div></div>
        <div className="tabs" role="tablist" aria-label={t('bag.tabs')}>
          {([['bag', 'bag.tab.bag'], ['arm', 'bag.tab.arm'], ['sigil', 'bag.tab.sigil']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(label)}</button>
          ))}
        </div>
        <button className="link panelx" onClick={onClose} aria-label={t('bag.close')}>{t('common.close')}</button>
      </div>
      {tab === 'arm' && <ArmamentTab hud={hud} game={game} />}
      {tab === 'sigil' && <SigilTab hud={hud} game={game} />}
      {tab === 'bag' && <div className="bagcols">
        <div>
          <h3>{t('bag.equipped')}</h3>
          <div className="eqrow">
            {SLOTS.map((s) => (
              <div key={s} className="eqslot">
                {hud.eq[s] ? <Cell hud={hud} item={hud.eq[s]} sel={sel === hud.eq[s]!.uid} onClick={() => setSel(hud.eq[s]!.uid)} onUse={() => game.invOp('unequip', { slot: s })} /> : <span className="cell empty" />}
                <small>{slotName(s)}</small>
              </div>
            ))}
          </div>
          <h3 className="baghead">{t('bag.bag')}
            <span className="bagcap" role="meter" aria-valuenow={hud.inv.length} aria-valuemin={0} aria-valuemax={INVENTORY_SIZE} aria-label={t('bag.slots', { n: hud.inv.length, max: INVENTORY_SIZE })}>
              <i style={{ width: `${(hud.inv.length / INVENTORY_SIZE) * 100}%` }} className={hud.inv.length >= INVENTORY_SIZE * 0.9 ? 'full' : ''} /><small>{t('bag.slots', { n: hud.inv.length, max: INVENTORY_SIZE })}</small>
            </span>
          </h3>
          <div className="bagtools">
            <div className="bagfilters" role="tablist" aria-label={t('bag.filter')}>
              {BAG_FILTERS.map(([k, label, fit]) => {
                const n = hud.inv.filter(fit).length;
                return <button key={k} role="tab" aria-selected={filter === k} className={'chipbtn' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)} disabled={!n && k !== 'all'}>{t(label)} <small>{n}</small></button>;
              })}
            </div>
            <input className="bagsearch" type="search" placeholder={t('bag.search')} aria-label={t('bag.search')} value={query} onChange={(e: any) => setQuery(e.target.value)} />
            <span className="sorttools">
              <button className="iconbtn" title={t('bag.sortNow', { by: t(`sort.${sortFor(filter)}` as Key) })} aria-label={t('bag.sortNow', { by: t(`sort.${sortFor(filter)}` as Key) })} onClick={() => game.invOp('sort', { by: sortFor(filter) })}>⇅</button>
              <select className="sortsel" aria-label={t('bag.sort')} value="" onChange={(e: any) => e.target.value && game.invOp('sort', { by: e.target.value })}>
                <option value="">▾</option>
                {SORT_KEYS.map((k) => <option key={k} value={k}>{t(`sort.${k}` as Key)}</option>)}
              </select>
            </span>
          </div>
          <div className="grid baggrid" role="list">
            {shownItems.map((it) => <Cell hud={hud} key={it.uid} item={it} sel={sel === it.uid} mark={!!marks?.has(it.uid)} onClick={() => (marks ? toggle(it.uid) : (setSel(it.uid), setAskRead('')))} onUse={() => !marks && quick(it)} />)}
            {filtering ? !shownItems.length && <p className="sub">{t('bag.none')}</p>
              : Array.from({ length: Math.min(INVENTORY_SIZE - hud.inv.length, Math.max(0, 48 - hud.inv.length) + ((8 - (hud.inv.length % 8)) % 8)) }, (_, i) => <span key={`e${i}`} className="cell empty" />)}
          </div>
          {!filtering && hud.inv.length < INVENTORY_SIZE && <p className="sub">{t('bag.free', { n: INVENTORY_SIZE - hud.inv.length })}</p>}
          <p className="sub">{marks ? t('bulk.help') : t('bag.help', { hp: keyOf('potion.hp'), mp: keyOf('potion.mp') })}</p>
        </div>
        <div>
          {item ? <Details item={item} worn={worn} hud={hud} game={game} askRead={askRead === item.uid} /> : <p className="sub">{t('bag.select')}</p>}
          {hud.shop ? (
            <div className="shop merchant">
              <div className="merchhead">
                <h3>{t('shop.title')}</h3>
                <b className="gold purse">{t('common.gold', { n: hud.gold })}</b>
              </div>
              <div className="tabs" role="group" aria-label={t('shop.title')}>
                <button aria-pressed={!marks} className={!marks ? 'on' : ''} onClick={() => setMarks(null)}>{t('shop.tabBuy')}</button>
                <button aria-pressed={!!marks} className={marks ? 'on' : ''} onClick={() => setMarks(marks ?? new Set())}>{t('bulk.open')}</button>
              </div>
              {marks ? (
                <div className="bulk" role="group" aria-label={t('bulk.label')}>
                  <p className="sub">{t('bulk.help')}</p>
                  <div className="actions">
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'equip' && i.rar === 0)}>{t('bulk.common')}</button>
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'equip' && i.rar <= 1)}>{t('bulk.uncommon')}</button>
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'material')}>{t('bulk.materials')}</button>
                    <button className="small" onClick={() => setMarks(new Set())}>{t('bulk.clear')}</button>
                  </div>
                  <p role="status" className="bulktotal"><b>{marked.length}</b> {t(marked.length === 1 ? 'bulk.marked1' : 'bulk.markedN')} · <b className="gold">{t('common.gold', { n: total })}</b></p>
                  <div className="actions">
                    <button onClick={() => setMarks(null)}>{t('common.cancel')}</button>
                    <SellButton key={marked.map((i) => i.uid).join()} n={marked.length} total={total} onConfirm={() => { game.invOp('sellall', { uids: marked.map((i) => i.uid) }); setMarks(null); setSel(''); }} />
                  </div>
                </div>
              ) : (
                <div className="wares">
                  <div className="ware daily">
                    <span className="wareicon"><Icon base="upgrade_stone" size={36} /></span>
                    <span className="warename"><b>{t('shop.daily', { n: DAILY_STONES })}</b><small>{t('shop.dailyHelp')}</small></span>
                    <button className="small primary" disabled={hud.journal.s.sd === dayOf(Date.now())} onClick={() => game.invOp('dailystone')}>{hud.journal.s.sd === dayOf(Date.now()) ? t('shop.dailyDone') : t('shop.dailyTake')}</button>
                  </div>
                  {SHOP_STOCK.map((id) => <BuyRow key={id} id={id} hud={hud} game={game} />)}
                  <h4 className="statsh">{t('shop.companions')}</h4>
                  <p className="sub">{t('shop.companionsHelp')}</p>
                  {SHOP_COMPANIONS.map((id) => {
                    const done = hud.journal.s.b.includes(SHOP_ONCE[id]), poor = hud.gold < ITEMS[id].price;
                    return (
                      <div key={id} className={'ware' + (done ? ' sold' : '')}>
                        <span className="wareicon" tabIndex={0} {...tip(() => <ItemTip base={id} hud={hud} price={ITEMS[id].price} />)}><Icon base={id} size={36} /></span>
                        <span className="warename"><b>{ITEMS[id].name}</b><small>{done ? t('shop.bought') : t('shop.once')}</small></span>
                        <button className={'small' + (done ? '' : ' primary')} disabled={done || poor} onClick={() => game.invOp('buy', { base: id, qty: 1 })} aria-label={t('shop.buy', { name: ITEMS[id].name, g: ITEMS[id].price })}>{done ? '✓' : <span className={poor ? 'worse' : ''}>{ITEMS[id].price}g</span>}</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : <><h3>{t('shop.title')}</h3><p className="sub">{t('shop.away')}</p></>}
        </div>
      </div>}
    </div>
  );
}

function Potion({ base, hotkey, hud, game }: { base: string; hotkey: string; hud: Hud; game: Game }) {
  const n = hud.inv.reduce((s, i) => s + (i.base === base ? i.qty : 0), 0);
  const running = hud.potionAt > 0 && performance.now() - hud.potionAt < POTION_CD_MS;
  return (
    <button className={'slot potion' + (n ? '' : ' locked')} title={`${ITEMS[base].name}\n${ITEMS[base].desc}\n${t('potion.cd', { s: POTION_CD_MS / 1000 })}`} aria-label={t('potion.label', { name: ITEMS[base].name, key: hotkey, n })} onClick={() => game.quaff(base)}>
      <span className="glyph"><Icon base={base} size={28} /></span>
      <span className="qty">{n}</span><span className="key">{hotkey}</span>
      {running && <i key={hud.potionAt} className="cdmask" style={{ animationDuration: `${POTION_CD_MS}ms`, animationDelay: `${-(performance.now() - hud.potionAt)}ms` }} />}
    </button>
  );
}
export function PotionBar({ hud, game }: { hud: Hud; game: Game }) {
  return <div className="slots potions" aria-label={t('potion.bar')}><Potion base="hp_potion" hotkey={keyOf('potion.hp')} hud={hud} game={game} /><Potion base="mana_potion" hotkey={keyOf('potion.mp')} hud={hud} game={game} /></div>;
}
export function LootFeed({ hud }: { hud: Hud }) {
  if (!hud.loot.length) return null;
  return <div className="hud lootfeed" role="log" aria-label={t('loot.feed')}>{hud.loot.map((l) => <div key={l.id} style={{ color: l.rar < 0 ? '#ffd76a' : RARITY_COLOR[l.rar] }}>{tm(l.text)}</div>)}</div>;
}

/** One thing the shop sells in any quantity: a number box, a "max" button and the total price. */
function BuyRow({ id, hud, game }: { id: string; hud: Hud; game: Game }) {
  const [qty, setQty] = useState(1) as [number, (n: number) => void];
  const b = ITEMS[id], afford = Math.floor(hud.gold / b.price), n = Math.max(1, Math.min(SHOP_BUY_MAX, Math.floor(qty) || 1));
  const own = hud.inv.reduce((k, i) => k + (i.base === id ? i.qty : 0), 0), cost = b.price * n, poor = hud.gold < cost;
  const step = (d: number) => setQty(Math.max(1, Math.min(SHOP_BUY_MAX, n + d)));
  return (
    <div className="ware">
      <span className="wareicon" tabIndex={0} {...tip(() => <ItemTip base={id} hud={hud} price={b.price} />)}><Icon base={id} size={36} /></span>
      <span className="warename"><b>{b.name}</b><small>{b.desc}</small><small className="sub">{t('shop.own', { n: own })} · <em className="gold">{t('shop.each', { g: b.price })}</em></small></span>
      <span className="buyqty">
        <span className="stepper">
          <button className="small" onClick={() => step(-1)} aria-label={t('shop.less')} disabled={n <= 1}>−</button>
          <input type="number" min={1} max={SHOP_BUY_MAX} value={qty} onChange={(e: any) => setQty(Number(e.target.value))} aria-label={t('shop.qty', { name: b.name })} />
          <button className="small" onClick={() => step(1)} aria-label={t('shop.more')}>+</button>
        </span>
        <span className="quick">
          {[10, 50].map((k) => <button key={k} className="small link" onClick={() => setQty(k)}>×{k}</button>)}
          <button className="small link" onClick={() => setQty(Math.max(1, Math.min(SHOP_BUY_MAX, afford)))}>{t('shop.max')}</button>
        </span>
        <button className="small primary" disabled={poor} onClick={() => game.invOp('buy', { base: id, qty: n })} aria-label={t('shop.buy', { name: b.name, g: cost })}>
          {t('shop.buyN', { n, g: cost })}
        </button>
        {poor && <small className="worse">{t('shop.short', { g: cost - hud.gold })}</small>}
      </span>
    </div>
  );
}
