// Auction house and bank (M14), at a banker in any town.
//
// Every operation that moves gold or items between a character and the database runs in one
// transaction with the character's full inventory snapshot. Memory is changed inside that
// transaction and restored if it fails, so the game and the database never disagree. A player
// can have only one such operation in flight at a time.
import {
  AUCTION_CATEGORIES, AUCTION_HOURS, AUCTION_MAX_LISTINGS, AUCTION_PAGE, AUCTION_PRICE_MAX, BANK_GOLD_MAX, BANK_SIZE, categoryOf, listingFee, SORTS,
  type AuctionRates, type Listing,
} from '../../../shared/src/economy';
import { cleanItem, INVENTORY_SIZE, ITEMS, RARITIES, type Item } from '../../../shared/src/items';
import { objNear } from '../../../shared/src/places';
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import { TICK_MS } from '../../../shared/src/protocol';
import type { Repo } from '../db/repo';
import { give, newUid, sendInv } from './Inventory';
import type { Player, World } from './World';

export const BANKER_RANGE = 160;
const userError = (msg: string) => Object.assign(new Error(msg), { user: true });
type Backup = { gold: number; inv: Item[]; bank: { gold: number; items: Item[] } };
const backup = (p: Player): Backup => ({ gold: p.gold, inv: p.inv.map((i) => ({ ...i, aff: i.aff.map((a) => [a[0], a[1]] as [typeof a[0], number]) })), bank: { gold: p.bank.gold, items: p.bank.items.map((i) => ({ ...i })) } });
const restore = (p: Player, b: Backup) => {
  p.gold = b.gold;
  p.inv = b.inv;
  p.bank = b.bank;
};

export class Economy {
  constructor(private w: World, private repo: Repo, private rates: AuctionRates) {}

  nearBanker(p: Player) {
    return !!objNear(p.room.zoneId, p.x, p.y, BANKER_RANGE, ['banker']);
  }
  /** Runs one database-backed change for a player: memory is restored if the transaction fails. */
  private async atomic(p: Player, fn: () => Promise<string>): Promise<string> {
    if (p.econBusy) return 'Please wait for the previous request to finish';
    p.econBusy = true;
    const b = backup(p);
    try {
      const why = await fn();
      if (why) restore(p, b);
      else p.invDirty = false; // stored by the transaction
      return why;
    } catch (e) {
      restore(p, b);
      const msg = (e as Error).message;
      if ((e as any).user) return msg;
      if (msg === 'not available') return 'That listing is no longer available';
      if (msg === 'listing limit') return `You can have at most ${AUCTION_MAX_LISTINGS} listings`;
      console.error('economy operation failed', e);
      return 'The request could not be completed; nothing was changed';
    } finally {
      p.econBusy = false;
      sendInv(this.w, p);
      this.sendBank(p);
    }
  }
  sendBank(p: Player) {
    this.w.send(p, { t: 'bank', bank: p.bank, size: BANK_SIZE });
  }

  async op(p: Player, m: any): Promise<string> {
    if (!m || typeof m !== 'object') return 'Unknown command';
    if (p.dead) return 'You are dead';
    if (!this.nearBanker(p)) return 'You need to be at a banker';
    if (this.w.trades.active(p)) return 'Finish your trade first';
    // after a change to the auction house, the client may pass the query it is showing (`q`): it is
    // run again once the change is stored, so the list on screen is never stale
    const then = async (why: string) => {
      if (!why && m.q && typeof m.q === 'object') await this.search(p, m.q);
      return why;
    };
    switch (m.op) {
      case 'search': return this.search(p, m);
      case 'history': return this.history(p);
      case 'list': return then(await this.list(p, m));
      case 'buy': return then(await this.buy(p, m));
      case 'cancel': return then(await this.cancel(p, m));
      case 'collect': return then(await this.collect(p));
      case 'deposit': case 'withdraw': case 'depgold': case 'wdgold': return this.bankOp(p, m);
      case 'banklog': {
        const rows = await this.repo.bankLogs(p.id);
        this.w.send(p, { t: 'banklog', rows: rows.map((r) => ({ at: new Date(r.at).getTime(), op: r.op, detail: r.detail })) });
        return '';
      }
      default: return 'Unknown command';
    }
  }

  // ---------- auction house ----------
  private async search(p: Player, m: any): Promise<string> {
    const text = typeof m.text === 'string' ? m.text.trim().toLowerCase().slice(0, 40) : '';
    const cat = AUCTION_CATEGORIES.includes(m.cat) ? m.cat : '';
    const minRar = Number.isInteger(m.minRar) && m.minRar >= 0 && m.minRar < RARITIES.length ? m.minRar : 0;
    const sort = SORTS.includes(m.sort) ? m.sort : 'price_asc', page = Number.isInteger(m.page) && m.page >= 0 && m.page < 1000 ? m.page : 0;
    // name search: matched against item names on the server, never put into SQL as text
    const bases = text ? Object.values(ITEMS).filter((b) => b.name.toLowerCase().includes(text)).map((b) => b.id) : undefined;
    if (bases && !bases.length) {
      this.w.send(p, { t: 'ah', list: [], total: 0, page, claims: await this.repo.claimsOf(p.id), rates: this.rates });
      return '';
    }
    const r = await this.repo.searchListings({ bases, cat, minRar, sort, offset: page * AUCTION_PAGE, limit: AUCTION_PAGE, seller: m.mine ? p.id : undefined });
    const list: Listing[] = [];
    for (const x of r.rows) {
      const item = cleanItem(x.item, new Set());
      if (item) list.push({ id: Number(x.id), seller: x.seller, item, price: Number(x.price), expires: new Date(x.expires_at).getTime(), mine: Number(x.seller_id) === p.id });
    }
    this.w.send(p, { t: 'ah', list, total: r.total, page, claims: await this.repo.claimsOf(p.id), rates: this.rates });
    return '';
  }
  private async history(p: Player): Promise<string> {
    const rows = await this.repo.auctionHistory(p.id);
    this.w.send(p, {
      t: 'ahhist',
      rows: rows.map((r) => ({ id: Number(r.id), base: r.item?.base, rar: r.item?.rar ?? 0, qty: r.item?.qty ?? 1, price: Number(r.price), status: r.status, sold: Number(r.seller_id) === p.id, other: Number(r.seller_id) === p.id ? r.buyer ?? '' : r.seller, at: new Date(r.closed_at ?? r.created_at).getTime() })),
    });
    return '';
  }
  private list(p: Player, m: any): Promise<string> {
    return this.atomic(p, async () => {
      const it = typeof m.uid === 'string' ? p.inv.find((i) => i.uid === m.uid) : undefined;
      if (!it) return 'Item not found in your bag';
      if (this.w.trades.locked(p, it.uid)) return 'That item is in your trade offer';
      const qty = Number.isInteger(m.qty) && m.qty >= 1 ? Math.min(m.qty, it.qty) : it.qty;
      const price = m.price, hours = AUCTION_HOURS.includes(m.hours) ? m.hours : 24;
      if (!Number.isInteger(price) || price < 1 || price > AUCTION_PRICE_MAX) return `Price must be between 1 and ${AUCTION_PRICE_MAX} gold`;
      const fee = listingFee(price, hours, this.rates);
      if (p.gold < fee) return `The listing fee is ${fee} gold`;
      const cat = categoryOf(it.base)!;
      // the listed part leaves the bag now; the rest of a stack stays
      const listed: Item = { ...it, qty };
      if (qty === it.qty) p.inv.splice(p.inv.indexOf(it), 1);
      else {
        it.qty -= qty;
        listed.uid = newUid();
      }
      p.gold -= fee;
      await this.repo.createListing({ seller: p.id, name: p.name, item: listed, base: it.base, category: cat, rarity: it.rar, price, fee, hours }, this.w.snapshot(p));
      this.w.send(p, { t: 'sys', text: `Listed ${ITEMS[it.base].name}${qty > 1 ? ` x${qty}` : ''} for ${price} gold (fee ${fee}).` });
      return '';
    });
  }
  private buy(p: Player, m: any): Promise<string> {
    return this.atomic(p, async () => {
      if (!Number.isInteger(m.id)) return 'Unknown listing';
      if (m.price !== undefined && !Number.isInteger(m.price)) return 'Unknown listing';
      let bought: Item | null = null;
      await this.repo.buyListing(m.id, p.id, p.name, this.rates.taxPct, (l) => {
        // checked against the row as it is in the database, inside the transaction
        if (m.price !== undefined && l.price !== m.price) throw new Error('not available'); // the price is not what the buyer saw
        if (p.gold < l.price) throw userError('Not enough gold');
        const item = cleanItem(l.item, new Set(p.inv.map((i) => i.uid)));
        if (!item) throw new Error('bad item');
        if (!give(p, item)) throw userError('Inventory is full');
        p.gold -= l.price;
        bought = item;
        return this.w.snapshot(p);
      });
      const b = bought as Item | null;
      if (b) this.w.send(p, { t: 'sys', text: `Bought ${ITEMS[b.base].name}${b.qty > 1 ? ` x${b.qty}` : ''}.` });
      return '';
    });
  }
  private cancel(p: Player, m: any): Promise<string> {
    return this.atomic(p, async () => {
      if (!Number.isInteger(m.id)) return 'Unknown listing';
      let toClaims = false;
      await this.repo.cancelListing(m.id, p.id, (raw) => {
        const item = cleanItem(raw, new Set(p.inv.map((i) => i.uid)));
        if (item && give(p, item)) return this.w.snapshot(p);
        toClaims = true; // no room: it waits with the banker
        return null;
      });
      this.w.send(p, { t: 'sys', text: toClaims ? 'Listing cancelled. Your bag is full: the item waits with the banker (Collect).' : 'Listing cancelled. The item is back in your bag.' });
      return '';
    });
  }
  private collect(p: Player): Promise<string> {
    return this.atomic(p, async () => {
      const got = await this.repo.collectClaims(p.id, (rows) => {
        const keep: number[] = [], seen = new Set(p.inv.map((i) => i.uid));
        for (const r of rows) {
          if (r.item) {
            const item = cleanItem(r.item, seen);
            if (!item || !give(p, item)) {
              keep.push(r.id);
              continue;
            }
          }
          p.gold += r.gold;
        }
        return { snap: this.w.snapshot(p), keep };
      });
      if (!got.gold && !got.items) return 'Nothing to collect';
      this.w.send(p, { t: 'sys', text: `Collected ${got.gold} gold${got.items ? ` and ${got.items} item${got.items > 1 ? 's' : ''}` : ''} from the auction house.` });
      return '';
    });
  }

  // ---------- bank ----------
  private bankOp(p: Player, m: any): Promise<string> {
    return this.atomic(p, async () => {
      if ((this.w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Not while in combat';
      let detail: Record<string, unknown>;
      if (m.op === 'deposit' || m.op === 'withdraw') {
        const from = m.op === 'deposit' ? p.inv : p.bank.items, it = typeof m.uid === 'string' ? from.find((i) => i.uid === m.uid) : undefined;
        if (!it) return 'Item not found';
        if (m.op === 'deposit' && this.w.trades.locked(p, it.uid)) return 'That item is in your trade offer';
        const qty = Number.isInteger(m.qty) && m.qty >= 1 ? Math.min(m.qty, it.qty) : it.qty;
        const moved: Item = { ...it, qty };
        if (m.op === 'deposit') {
          if (!this.bankGive(p, moved)) return `The bank is full (${BANK_SIZE} slots)`;
        } else if ((ITEMS[it.base].stack ?? 1) === 1) {
          // a single item moves as itself, keeping its identity
          if (p.inv.length >= INVENTORY_SIZE) return 'Inventory is full';
          p.inv.push({ ...moved });
        } else if (!give(p, { ...moved })) return 'Inventory is full';
        it.qty -= qty;
        if (it.qty <= 0) from.splice(from.indexOf(it), 1);
        detail = { base: it.base, qty, rar: it.rar, uid: it.uid };
      } else {
        const n = m.gold;
        if (!Number.isInteger(n) || n <= 0) return 'Invalid amount of gold';
        if (m.op === 'depgold') {
          if (p.gold < n) return 'You do not have that much gold';
          if (p.bank.gold + n > BANK_GOLD_MAX) return 'The bank cannot hold that much gold';
          p.gold -= n;
          p.bank.gold += n;
        } else {
          if (p.bank.gold < n) return 'Your bank does not hold that much gold';
          p.bank.gold -= n;
          p.gold += n;
        }
        detail = { gold: n };
      }
      await this.repo.saveItems(this.w.snapshot(p));
      await this.repo.bankLog(p.id, m.op, detail);
      return '';
    });
  }
  /** Adds to the bank, stacking where possible (mirrors give() for the bag). */
  private bankGive(p: Player, it: Item): boolean {
    const b = ITEMS[it.base], max = b?.stack ?? 1, bank = p.bank.items;
    if (!b) return false;
    let left = it.qty;
    if (max > 1) {
      let room = (BANK_SIZE - bank.length) * max;
      for (const x of bank) if (x.base === it.base) room += max - x.qty;
      if (room < left) return false;
      for (const x of bank) {
        if (x.base !== it.base || x.qty >= max || !left) continue;
        const n = Math.min(left, max - x.qty);
        x.qty += n;
        left -= n;
      }
    } else if (bank.length >= BANK_SIZE) return false;
    let first = true;
    while (left > 0) {
      const n = Math.min(left, max);
      // the item keeps its identity when it moves whole; a split stack gets a new id
      bank.push({ ...it, uid: first && n === it.qty ? it.uid : newUid(), qty: n });
      first = false;
      left -= n;
    }
    return true;
  }
  /** Moves expired listings back to their sellers (every half minute). */
  sweep() {
    return this.repo.expireListings().catch((e) => console.error('auction sweep failed', e));
  }
}
