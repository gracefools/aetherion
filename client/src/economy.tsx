// Bank and auction house (M14), at any town's banker. Everything here shows what the server sent
// and asks it to act; the server checks every request and stores every change in one transaction.
import React, { useEffect, useState } from 'react';
import {
  AUCTION_CATEGORIES, AUCTION_HOURS, AUCTION_PAGE, BANK_SIZE, categoryOf, DEFAULT_AUCTION_RATES, listingFee, saleTax, SORTS, type AuctionQuery,
} from '../../shared/src/economy';
import { ITEMS, itemName, RARITIES, RARITY_COLOR, type Item } from '../../shared/src/items';
import type { Game, Hud } from './game/Game';
import { Icon, rarName } from './inventory';
import { t, useT, type Key } from './i18n';

const BANK_OP: Record<string, Key> = { deposit: 'bank.op.deposit', withdraw: 'bank.op.withdraw', depgold: 'bank.op.depgold', wdgold: 'bank.op.wdgold' };
const left = (ms: number) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const nameOf = (it: Item) => `${itemName(it)}${it.qty > 1 ? ` ×${it.qty}` : ''}`;
const colorOf = (it: { base: string; rar: number }) => (ITEMS[it.base]?.kind === 'equip' ? RARITY_COLOR[it.rar] : undefined);

export function BankerDialog({ hud, game, name, town }: { hud: Hud; game: Game; name: string; town: string }) {
  useT();
  const [tab, setTab] = useState(('bank') as 'bank' | 'ah');
  return (
    <div className="hud econ panel" role="dialog" aria-label={name}>
      <div className="sheethead">
        <div><h2>{name}</h2><div className="sub">{t('npc.role.banker')} · {town}</div></div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'bank'} className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>{t('bank.title')}</button>
          <button role="tab" aria-selected={tab === 'ah'} className={tab === 'ah' ? 'on' : ''} onClick={() => setTab('ah')}>{t('ah.title')}</button>
        </div>
        <button className="link" onClick={() => game.closeTalk()} aria-label={t('npc.end')}>{t('common.close')}</button>
      </div>
      {tab === 'bank' ? <BankTab hud={hud} game={game} /> : <AuctionTab hud={hud} game={game} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------------------------
function BankTab({ hud, game }: { hud: Hud; game: Game }) {
  const [amount, setAmount] = useState('');
  const [gold, setGold] = useState('');
  const [showLog, setShowLog] = useState(false);
  const n = Math.floor(Number(amount)), qty = amount && n > 0 ? { qty: n } : {};
  const g = Math.floor(Number(gold));
  const okGold = gold !== '' && g > 0;
  return (
    <>
      <p className="sub">{t('bank.help')}</p>
      <div className="banksplit">
        <section aria-label={t('bag.bag')}>
          <h3>{t('bag.bag')} <small className="sub">{t('common.gold', { n: hud.gold })}</small></h3>
          <div className="grid">
            {hud.inv.map((it) => (
              <button key={it.uid} className="slot" onClick={() => game.ecoOp('deposit', { uid: it.uid, ...qty })} title={t('bank.deposit', { name: nameOf(it) })} aria-label={t('bank.deposit', { name: nameOf(it) })}>
                <Icon item={it} size={32} />{it.qty > 1 && <span className="qty">{it.qty}</span>}
              </button>
            ))}
          </div>
        </section>
        <section aria-label={t('bank.title')}>
          <h3>{t('bank.title')} <small className="sub">{hud.bank.items.length} / {BANK_SIZE} · {t('common.gold', { n: hud.bank.gold })}</small></h3>
          <div className="grid">
            {hud.bank.items.map((it) => (
              <button key={it.uid} className="slot" onClick={() => game.ecoOp('withdraw', { uid: it.uid, ...qty })} title={t('bank.withdraw', { name: nameOf(it) })} aria-label={t('bank.withdraw', { name: nameOf(it) })}>
                <Icon item={it} size={32} />{it.qty > 1 && <span className="qty">{it.qty}</span>}
              </button>
            ))}
            {!hud.bank.items.length && <span className="sub" style={{ gridColumn: '1 / -1' }}>{t('bank.empty')}</span>}
          </div>
        </section>
      </div>
      <div className="actions">
        <label>{t('bank.amount')} <input type="number" min={1} value={amount} onChange={(e: any) => setAmount(e.target.value)} placeholder={t('bank.all')} style={{ width: 70 }} aria-label={t('bank.amountLabel')} /></label>
      </div>
      <div className="actions">
        <label>{t('bank.gold')} <input type="number" min={1} value={gold} onChange={(e: any) => setGold(e.target.value)} style={{ width: 110 }} aria-label={t('bank.goldLabel')} /></label>
        <button disabled={!okGold || g > hud.gold} onClick={() => { game.ecoOp('depgold', { gold: g }); setGold(''); }}>{t('bank.depGold')}</button>
        <button disabled={!okGold || g > hud.bank.gold} onClick={() => { game.ecoOp('wdgold', { gold: g }); setGold(''); }}>{t('bank.wdGold')}</button>
        <button className="link" onClick={() => { setShowLog(!showLog); if (!showLog) game.ecoOp('banklog'); }}>{showLog ? t('bank.hideHistory') : t('bank.history')}</button>
      </div>
      {showLog && (
        <div className="ahlist" aria-label={t('bank.historyLabel')}>
          {!hud.banklog.length && <p className="sub">{t('common.nothingYet')}</p>}
          {hud.banklog.map((r, i) => {
            const d = r.detail ?? {};
            const what = d.base ? `${ITEMS[d.base]?.name ?? d.base}${d.qty > 1 ? ` ×${d.qty}` : ''}` : t('common.gold', { n: Number(d.gold ?? 0) });
            return <div key={i} className="shoprow"><span /><span>{BANK_OP[r.op] ? t(BANK_OP[r.op]) : r.op}: {what}</span><small>{new Date(r.at).toLocaleString()}</small></div>;
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Auction house
// ---------------------------------------------------------------------------------------------
function AuctionTab({ hud, game }: { hud: Hud; game: Game }) {
  const [sub, setSub] = useState(('browse') as 'browse' | 'sell' | 'mine' | 'hist');
  const [q, setQ] = useState(({ text: '', cat: '', minRar: 0, sort: 'price_asc', page: 0 }) as AuctionQuery);
  const query = sub === 'mine' ? { mine: true, sort: 'newest' as const, page: 0 } : q;
  const run = (nq: AuctionQuery) => game.ecoOp('search', nq as Record<string, unknown>);
  useEffect(() => {
    if (sub === 'browse' || sub === 'mine') run(query);
    if (sub === 'hist') game.ecoOp('history');
  }, [sub]);
  const ah = hud.ah, claims = ah?.claims;
  const subs: [typeof sub, Key][] = [['browse', 'ah.browse'], ['sell', 'ah.sell'], ['mine', 'ah.mine'], ['hist', 'ah.history']];
  return (
    <>
      <div className="tabs" role="tablist" aria-label={t('ah.label')}>
        {subs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{t(label)}</button>
        ))}
      </div>
      {claims && (claims.gold > 0 || claims.items > 0) && (
        <div className="claims" role="status">
          {t('ah.waiting')} {claims.gold > 0 && <b className="gold">{t('common.gold', { n: claims.gold })}</b>}{claims.gold > 0 && claims.items > 0 && ` ${t('common.and')} `}{claims.items > 0 && <b>{t(claims.items > 1 ? 'ah.itemsN' : 'ah.items1', { n: claims.items })}</b>}
          <button className="primary small" onClick={() => game.ecoOp('collect', { q: query })}>{t('ah.collect')}</button>
        </div>
      )}
      {sub === 'browse' && (
        <>
          <form className="ahfilter" onSubmit={(e: any) => { e.preventDefault(); const nq = { ...q, page: 0 }; setQ(nq); run(nq); }}>
            <input value={q.text} onChange={(e: any) => setQ({ ...q, text: e.target.value })} placeholder={t('ah.itemName')} maxLength={40} aria-label={t('ah.searchName')} />
            <select value={q.cat} onChange={(e: any) => setQ({ ...q, cat: e.target.value as any })} aria-label={t('ah.category')}>
              <option value="">{t('ah.allCats')}</option>
              {AUCTION_CATEGORIES.map((c) => <option key={c} value={c}>{t(`ah.cat.${c}` as Key)}</option>)}
            </select>
            <select value={q.minRar} onChange={(e: any) => setQ({ ...q, minRar: Number(e.target.value) })} aria-label={t('ah.minRarity')}>
              {RARITIES.map((r, i) => <option key={r} value={i}>{i ? t('ah.orBetter', { r: rarName(i) }) : t('ah.anyRarity')}</option>)}
            </select>
            <select value={q.sort} onChange={(e: any) => { const nq = { ...q, sort: e.target.value as any, page: 0 }; setQ(nq); run(nq); }} aria-label={t('ah.sort')}>
              {SORTS.map((s) => <option key={s} value={s}>{t(`ah.sort.${s}` as Key)}</option>)}
            </select>
            <button className="primary" type="submit">{t('ah.search')}</button>
          </form>
          <Listings hud={hud} game={game} query={q} />
          {ah && ah.total > AUCTION_PAGE && (
            <div className="actions">
              <button disabled={ah.page <= 0} onClick={() => { const nq = { ...q, page: ah.page - 1 }; setQ(nq); run(nq); }}>{t('common.previous')}</button>
              <span className="sub">{t('ah.page', { n: ah.page + 1, of: Math.ceil(ah.total / AUCTION_PAGE), total: ah.total })}</span>
              <button disabled={(ah.page + 1) * AUCTION_PAGE >= ah.total} onClick={() => { const nq = { ...q, page: ah.page + 1 }; setQ(nq); run(nq); }}>{t('common.next')}</button>
            </div>
          )}
        </>
      )}
      {sub === 'mine' && <Listings hud={hud} game={game} query={query} />}
      {sub === 'sell' && <Sell hud={hud} game={game} />}
      {sub === 'hist' && (
        <div className="ahlist" aria-label={t('ah.historyLabel')}>
          {!hud.ahhist.length && <p className="sub">{t('ah.noHistory')}</p>}
          {hud.ahhist.map((r) => (
            <div key={r.id} className="shoprow">
              <Icon base={r.base} size={24} />
              <span style={{ color: colorOf(r) }}>{ITEMS[r.base]?.name ?? r.base}{r.qty > 1 ? ` ×${r.qty}` : ''}<small> {r.sold ? (r.status === 'sold' ? t('ah.soldTo', { name: r.other }) : t(`ah.status.${r.status}` as Key)) : t('ah.boughtFrom', { name: r.other })} · {new Date(r.at).toLocaleString()}</small></span>
              <b className="gold">{r.price.toLocaleString()}g</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Listings({ hud, game, query }: { hud: Hud; game: Game; query: AuctionQuery }) {
  const [armed, setArmed] = useState(0);
  const ah = hud.ah;
  if (!ah) return <p className="sub">{t('ah.searching')}</p>;
  return (
    <div className="ahlist" role="table" aria-label={t('ah.listings')}>
      {!ah.list.length && <p className="sub">{query.mine ? t('ah.nothingMine') : t('ah.nothing')}</p>}
      {ah.list.map((l) => (
        <div key={l.id} className="ahrow" role="row">
          <Icon item={l.item} size={28} />
          <span role="cell"><b style={{ color: colorOf(l.item) }}>{nameOf(l.item)}</b><small className="sub"> {ITEMS[l.item.base].kind === 'equip' ? `${rarName(l.item.rar)} · ${t('common.lv', { n: l.item.ilvl })}${l.item.up ? ` · +${l.item.up}` : ''} · ` : ''}{l.mine ? t('ah.yours') : l.seller} · {t('ah.left', { time: left(l.expires) })}</small></span>
          <b className="gold" role="cell">{l.price.toLocaleString()}g</b>
          {l.mine
            ? <button className="small" onClick={() => game.ecoOp('cancel', { id: l.id, q: query })} aria-label={t('ah.cancelName', { name: nameOf(l.item) })}>{t('common.cancel')}</button>
            : armed === l.id
              ? <span className="confirm" role="alertdialog" aria-label={t('ah.buyAsk', { name: nameOf(l.item), g: String(l.price) })}>
                <button className="primary small" onClick={() => { setArmed(0); game.ecoOp('buy', { id: l.id, price: l.price, q: query }); }}>{t('ah.pay', { g: l.price })}</button>
                <button className="small" onClick={() => setArmed(0)}>{t('common.no')}</button>
              </span>
              : <button className="small" disabled={hud.gold < l.price} onClick={() => setArmed(l.id)} aria-label={t('ah.buyName', { name: nameOf(l.item), g: String(l.price) })}>{t('ah.buy')}</button>}
        </div>
      ))}
    </div>
  );
}

function Sell({ hud, game }: { hud: Hud; game: Game }) {
  const [uid, setUid] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [hours, setHours] = useState(24);
  const it = hud.inv.find((i) => i.uid === uid);
  const p = Math.floor(Number(price)), n = Math.floor(Number(qty)) || it?.qty || 1;
  const rates = hud.ah?.rates ?? DEFAULT_AUCTION_RATES, fee = p > 0 ? listingFee(p, hours, rates) : 0;
  const sellable = hud.inv.filter((i) => categoryOf(i.base));
  return (
    <>
      <p className="sub">{t('ah.sellHelp')}</p>
      <div className="grid" aria-label={t('ah.sellable')}>
        {sellable.map((i) => (
          <button key={i.uid} className={'slot' + (i.uid === uid ? ' on' : '')} onClick={() => { setUid(i.uid); setQty(''); setPrice(price || String(Math.max(1, (ITEMS[i.base].price || 10)))); }} aria-label={t('ah.sellName', { name: nameOf(i) })} aria-pressed={i.uid === uid}>
            <Icon item={i} size={32} />{i.qty > 1 && <span className="qty">{i.qty}</span>}
          </button>
        ))}
      </div>
      {it && (
        <form className="ahsell" onSubmit={(e: any) => {
          e.preventDefault();
          game.ecoOp('list', { uid: it.uid, price: p, hours, ...(it.qty > 1 ? { qty: Math.min(n, it.qty) } : {}), q: { mine: true, sort: 'newest', page: 0 } });
          setUid('');
          setPrice('');
        }}>
          <b style={{ color: colorOf(it) }}>{nameOf(it)}</b>
          {it.qty > 1 && <label>{t('bank.amount')} <input type="number" min={1} max={it.qty} value={qty} placeholder={String(it.qty)} onChange={(e: any) => setQty(e.target.value)} style={{ width: 64 }} aria-label={t('ah.amountLabel')} /></label>}
          <label>{t('ah.price')} <input type="number" min={1} value={price} onChange={(e: any) => setPrice(e.target.value)} style={{ width: 100 }} aria-label={t('ah.priceLabel')} /></label>
          <label>{t('ah.duration')} <select value={hours} onChange={(e: any) => setHours(Number(e.target.value))} aria-label={t('ah.duration')}>{AUCTION_HOURS.map((h) => <option key={h} value={h}>{t('ah.hours', { n: h })}</option>)}</select></label>
          <span className="sub">{t('ah.feeLine', { fee, get: p > 0 ? p - saleTax(p, rates) : 0 })}</span>
          <button className="primary" type="submit" disabled={!(p > 0) || hud.gold < fee}>{t('ah.list')}</button>
        </form>
      )}
    </>
  );
}
