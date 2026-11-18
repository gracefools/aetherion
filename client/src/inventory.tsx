// Inventory, equipment and shop panel, potion quick slots and loot notifications.
// Everything here only displays state and sends requests: the server decides every outcome.
import { dayOf } from '../../shared/src/journal';
import React, { useState } from 'react';
import {
  equipBlock, INVENTORY_SIZE, ITEMS, itemName, itemStats, MAX_UPGRADE, POTION_CD_MS, RARITIES, RARITY_COLOR, reqLevel, sellValue,
  DAILY_STONES, PASSIVES, SETS, SHOP_BUY_MAX, SHOP_COMPANIONS, SHOP_ONCE, SHOP_STOCK, SLOT_NAMES, SLOTS, STAT_LABEL, UPGRADE_CHANCE, upgradeCost, type GearStat, type Item, type Slot,
} from '../../shared/src/items';
import { SORT_KEYS } from '../../shared/src/protocol';
import type { Game, Hud } from './game/Game';
import { keyOf } from './game/Game';
import { itemIcon } from './game/icons';
import { t, tm, tv, useT, type Key } from './i18n';
import { ArmamentTab, SigilInfo, SigilTab, StatBlocks } from './gearUi';

const PCT: Partial<Record<GearStat, boolean>> = { crit: true, critDmg: true, lifesteal: true, dodge: true, healPower: true };
const fmt = (k: GearStat, v: number) => (PCT[k] ? `${Math.round(v * (k === 'crit' || k === 'dodge' ? 10 : 1000)) / 10}%` : String(Math.round(v)));
/** Rarity and slot names are short fixed vocabularies, translated like interface text. */
export const rarName = (r: number) => tv(RARITIES[r]);
export const slotName = (s: Slot) => tv(SLOT_NAMES[s]);

export function Icon({ item, base, size = 32 }: { item?: Item; base?: string; size?: number }) {
  const id = item?.base ?? base!;
  return <img className="icon" src={itemIcon(id)} width={size} height={size} alt="" style={{ imageRendering: 'pixelated' }} />;
}

function Cell({ item, sel, onClick, onUse, mark = false }: { item?: Item; sel: boolean; onClick: () => void; onUse: () => void; mark?: boolean }) {
  if (!item) return <span className="cell empty" />;
  const b = ITEMS[item.base];
  return (
    <button
      className={'cell' + (sel ? ' sel' : '') + (mark ? ' marked' : '')} style={{ borderColor: b.kind === 'equip' ? RARITY_COLOR[item.rar] : undefined }}
      onClick={onClick} onDoubleClick={onUse} aria-label={`${b.kind === 'equip' ? rarName(item.rar) + ' ' : ''}${itemName(item)}${item.qty > 1 ? ` ×${item.qty}` : ''}`} aria-pressed={sel}
    >
      <Icon item={item} />
      {item.qty > 1 && <span className="qty">{item.qty}</span>}
      {item.up > 0 && <span className="up">+{item.up}</span>}
    </button>
  );
}

const KIND_LINE: Record<string, Key> = { potion: 'item.kind.potion', scroll: 'item.kind.scroll', pet: 'item.kind.pet', mount: 'item.kind.mount', material: 'item.kind.material', sigil: 'item.kind.sigil' };
function Details({ item, worn, hud, game }: { item: Item; worn: Slot | null; hud: Hud; game: Game }) {
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
        {!worn && b.kind === 'scroll' && <ReadButton key={item.uid + item.qty} name={b.name} onConfirm={() => game.invOp('scroll', { uid: item.uid })} />}
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
function ReadButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
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
  };
  const [tab, setTab] = useState('bag' as 'bag' | 'arm' | 'sigil');
  return (
    <div className="hud bag panel" role="dialog" aria-label={t('bag.title')}>
      <div className="sheethead">
        <div><h2>{t('bag.title')}</h2><div className="sub">{t('bag.slots', { n: hud.inv.length, max: INVENTORY_SIZE })} · <b className="gold">{t('common.gold', { n: hud.gold })}</b></div></div>
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
                {hud.eq[s] ? <Cell item={hud.eq[s]} sel={sel === hud.eq[s]!.uid} onClick={() => setSel(hud.eq[s]!.uid)} onUse={() => game.invOp('unequip', { slot: s })} /> : <span className="cell empty" />}
                <small>{slotName(s)}</small>
              </div>
            ))}
          </div>
          <h3>{t('bag.bag')}
            <select className="sortsel" aria-label={t('bag.sort')} value="" onChange={(e: any) => e.target.value && game.invOp('sort', { by: e.target.value })}>
              <option value="">{t('bag.sortBy')}</option>
              {SORT_KEYS.map((k) => <option key={k} value={k}>{t(`sort.${k}` as Key)}</option>)}
            </select>
          </h3>
          <div className="grid" role="list">
            {Array.from({ length: INVENTORY_SIZE }, (_, i) => {
              const it = hud.inv[i];
              return <Cell key={it?.uid ?? `e${i}`} item={it} sel={!!it && sel === it.uid} mark={!!it && !!marks?.has(it.uid)} onClick={() => (marks ? toggle(it!.uid) : setSel(it!.uid))} onUse={() => !marks && quick(it!)} />;
            })}
          </div>
          <p className="sub">{marks ? t('bulk.help') : t('bag.help', { hp: keyOf('potion.hp'), mp: keyOf('potion.mp') })}</p>
        </div>
        <div>
          {item ? <Details item={item} worn={worn} hud={hud} game={game} /> : <p className="sub">{t('bag.select')}</p>}
          <h3>{t('shop.title')}</h3>
          {hud.shop ? (
            <div className="shop">
              {!marks ? <button className="small" onClick={() => setMarks(new Set())}>{t('bulk.open')}</button> : (
                <div className="bulk" role="group" aria-label={t('bulk.label')}>
                  <div className="actions">
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'equip' && i.rar === 0)}>{t('bulk.common')}</button>
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'equip' && i.rar <= 1)}>{t('bulk.uncommon')}</button>
                    <button className="small" onClick={() => markAll((i) => ITEMS[i.base].kind === 'material')}>{t('bulk.materials')}</button>
                    <button className="small" onClick={() => setMarks(new Set())}>{t('bulk.clear')}</button>
                  </div>
                  <p role="status"><b>{marked.length}</b> {t(marked.length === 1 ? 'bulk.marked1' : 'bulk.markedN')} · <b className="gold">{t('common.gold', { n: total })}</b></p>
                  <div className="actions">
                    <button onClick={() => setMarks(null)}>{t('common.cancel')}</button>
                    <SellButton key={marked.map((i) => i.uid).join()} n={marked.length} total={total} onConfirm={() => { game.invOp('sellall', { uids: marked.map((i) => i.uid) }); setMarks(null); setSel(''); }} />
                  </div>
                </div>
              )}
              {SHOP_STOCK.map((id) => <BuyRow key={id} id={id} hud={hud} game={game} />)}
              <div className="shoprow">
                <Icon base="upgrade_stone" size={24} /><span>{t('shop.daily', { n: DAILY_STONES })}<small> {t('shop.dailyHelp')}</small></span>
                <button className="small primary" disabled={hud.journal.s.sd === dayOf(Date.now())} onClick={() => game.invOp('dailystone')}>{hud.journal.s.sd === dayOf(Date.now()) ? t('shop.dailyDone') : t('shop.dailyTake')}</button>
              </div>
              <h3>{t('shop.companions')}</h3>
              <p className="sub">{t('shop.companionsHelp')}</p>
              {SHOP_COMPANIONS.map((id) => {
                const done = hud.journal.s.b.includes(SHOP_ONCE[id]);
                return (
                  <div key={id} className="shoprow">
                    <Icon base={id} size={24} /><span>{ITEMS[id].name}<small> {t('shop.once')}</small></span>
                    <button className="small" disabled={done || hud.gold < ITEMS[id].price} onClick={() => game.invOp('buy', { base: id, qty: 1 })} aria-label={t('shop.buy', { name: ITEMS[id].name, g: ITEMS[id].price })}>{done ? t('shop.bought') : `${ITEMS[id].price}g`}</button>
                  </div>
                );
              })}
            </div>
          ) : <p className="sub">{t('shop.away')}</p>}
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
  return (
    <div className="shoprow">
      <Icon base={id} size={24} /><span>{b.name}<small> {b.desc} · {b.price}g</small></span>
      <span className="buyqty">
        <input type="number" min={1} max={SHOP_BUY_MAX} value={qty} onChange={(e: any) => setQty(Number(e.target.value))} aria-label={t('shop.qty', { name: b.name })} />
        <button className="small" onClick={() => setQty(Math.max(1, Math.min(SHOP_BUY_MAX, afford)))}>{t('shop.max')}</button>
        <button className="small primary" disabled={hud.gold < b.price * n} onClick={() => game.invOp('buy', { base: id, qty: n })} aria-label={t('shop.buy', { name: b.name, g: b.price * n })}>{t('shop.buyN', { n, g: b.price * n })}</button>
      </span>
    </div>
  );
}
