// Player-to-player trade window. It shows what the server says is on the table and sends
// requests; the server alone decides what is offered, who has confirmed, and the exchange.
import React, { useEffect, useState } from 'react';
import { ITEMS, itemName, RARITY_COLOR, type Item } from '../../shared/src/items';
import { TRADE_MAX_ITEMS, type TradeOffer } from '../../shared/src/protocol';
import type { Game, Hud } from './game/Game';
import { Icon, rarName } from './inventory';
import { t, useT } from './i18n';
import { tip } from './tooltip';
import { ItemTip } from './inventory';

function Offered({ offer, onRemove }: { offer: TradeOffer; onRemove?: (uid: string) => void }) {
  return (
    <div className="offer">
      {offer.items.length === 0 && offer.gold === 0 && <p className="sub">{t('trade.nothing')}</p>}
      {offer.items.map((it) => (
        <button key={it.uid} className="offerrow" disabled={!onRemove} onClick={() => onRemove?.(it.uid)} title={onRemove ? t('trade.takeBack') : undefined} aria-label={`${itemName(it)}${it.qty > 1 ? ` ×${it.qty}` : ''}`}>
          <Icon item={it} size={24} />
          <span style={{ color: ITEMS[it.base].kind === 'equip' ? RARITY_COLOR[it.rar] : undefined }}>{itemName(it)}{it.qty > 1 ? ` ×${it.qty}` : ''}</span>
          {ITEMS[it.base].kind === 'equip' && <small>{rarName(it.rar)} · {t('common.lv', { n: it.ilvl })}</small>}
        </button>
      ))}
      {offer.gold > 0 && <div className="offerrow"><b className="gold">{t('common.gold', { n: offer.gold })}</b></div>}
      <div className={'chip ' + (offer.ok ? 'live' : 'idle')}>{offer.ok ? t('trade.confirmed') : t('trade.notConfirmed')}</div>
    </div>
  );
}

export function TradePanel({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const tr = hud.trade;
  const [gold, setGold] = useState('0');
  const [qty, setQty] = useState({} as Record<string, string>);
  useEffect(() => setGold(String(tr?.mine.gold ?? 0)), [tr?.mine.gold, !tr]);
  if (!tr) return null;
  const mine = new Map(tr.mine.items.map((i) => [i.uid, i.qty]));
  const bag = hud.inv.filter((i) => !mine.has(i.uid) && !i.bd); // bound items cannot be traded
  const offer = (it: Item) => game.tradeOp('offer', { uid: it.uid, qty: Math.max(1, Math.min(it.qty, Number(qty[it.uid]) || it.qty)) });
  return (
    <div className="hud trade panel" role="dialog" aria-label={t('trade.with', { name: tr.with.name })}>
      <div className="sheethead"><div><h2>{t('trade.with', { name: tr.with.name })}</h2><div className="sub">{t('trade.help')}</div></div></div>
      <div className="tradecols">
        <div><h3>{t('trade.yours')}</h3><Offered offer={tr.mine} onRemove={(uid) => game.tradeOp('remove', { uid })} /></div>
        <div><h3>{t('trade.theirs', { name: tr.with.name })}</h3><Offered offer={tr.theirs} /></div>
      </div>
      <div className="autorow">
        <span>{t('trade.goldGive', { n: hud.gold })}</span>
        <span className="num">
          <input type="number" aria-label={t('trade.goldLabel')} min={0} max={hud.gold} value={gold} onChange={(e: any) => setGold(e.target.value)} />
          <button className="small" onClick={() => game.tradeOp('gold', { gold: Math.max(0, Math.floor(Number(gold) || 0)) })}>{t('trade.setGold')}</button>
        </span>
      </div>
      <h3>{t('trade.bag', { n: tr.mine.items.length, max: TRADE_MAX_ITEMS })}</h3>
      <div className="tradebag">
        {bag.length === 0 && <p className="sub">{t('trade.empty')}</p>}
        {bag.map((it) => (
          <span key={it.uid} className="bagitem">
            <button className="cell" style={{ borderColor: ITEMS[it.base].kind === 'equip' ? RARITY_COLOR[it.rar] : undefined }} onClick={() => offer(it)} aria-label={t('trade.offer', { name: `${itemName(it)}${it.qty > 1 ? ` ×${it.qty}` : ''}` })} {...tip(() => <ItemTip item={it} hud={hud} />)}>
              <Icon item={it} />{it.qty > 1 && <span className="qty">{it.qty}</span>}{it.up > 0 && <span className="up">+{it.up}</span>}
            </button>
            {it.qty > 1 && <input type="number" className="qtyin" aria-label={t('trade.qty', { name: itemName(it) })} min={1} max={it.qty} placeholder={String(it.qty)} value={qty[it.uid] ?? ''} onChange={(e: any) => setQty({ ...qty, [it.uid]: e.target.value })} />}
          </span>
        ))}
      </div>
      <div className="actions">
        <button onClick={() => game.tradeOp('cancel')}>{t('trade.cancel')}</button>
        {tr.mine.ok
          ? <button onClick={() => game.tradeOp('unconfirm')}>{t('trade.change')}</button>
          : <button className="primary" onClick={() => game.tradeOp('confirm')}>{t('trade.confirm')}</button>}
      </div>
      {tr.mine.ok && !tr.theirs.ok && <p className="sub" role="status">{t('trade.waiting', { name: tr.with.name })}</p>}
    </div>
  );
}

export function TradeInvite({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const inv = hud.tradeInvite;
  if (!inv) return null;
  return (
    <div className="hud inviteask panel" role="alertdialog" aria-label={t('trade.request')}>
      <p>{t('trade.wants', { name: inv.from })}</p>
      <div className="actions"><button onClick={() => game.tradeOp('decline')}>{t('common.decline')}</button><button className="primary" onClick={() => game.tradeOp('accept')}>{t('trade.button')}</button></div>
    </div>
  );
}
