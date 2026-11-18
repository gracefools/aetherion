// Secure player-to-player trading. Everything happens on the server:
//   invite -> accept -> both sides put items and gold on the table -> both confirm -> exchange.
// Rules that keep it safe:
//   - both players must be online, alive, in the same room and within TRADE_RANGE, from the
//     invitation to the exchange; otherwise the trade is cancelled and nothing moves;
//   - any change to either offer clears BOTH confirmations, so nobody can confirm one offer and
//     receive another;
//   - items on the table are locked: they cannot be sold, used, equipped, upgraded or destroyed;
//   - the exchange re-checks ownership, quantities, gold and bag space, then moves everything in
//     one step and stores both inventories and the audit row in one database transaction;
//   - items are moved, never copied: each instance keeps existing exactly once.
import { INVENTORY_SIZE, ITEMS, type Item, type ItemSpec } from '../../../shared/src/items';
import { TRADE_GOLD_MAX, TRADE_INVITE_MS, TRADE_MAX_ITEMS, TRADE_RANGE, type TradeOffer, type TradeState } from '../../../shared/src/protocol';
import { give, sendInv } from './Inventory';
import type { Player, World } from './World';

interface Side {
  p: Player;
  /** Item uid -> quantity offered. */
  items: Map<string, number>;
  gold: number;
  ok: boolean;
}
interface Session {
  a: Side;
  b: Side;
}
export interface TradeRecord {
  zone: string;
  a: { id: number; name: string; gold: number; items: ItemSpec[] };
  b: { id: number; name: string; gold: number; items: ItemSpec[] };
}
const spec = (it: Item, qty: number): ItemSpec => ({ base: it.base, rar: it.rar, ilvl: it.ilvl, aff: it.aff.map((a) => [a[0], a[1]]), up: it.up, qty });

export class Trades {
  private sessions = new Map<number, Session>(); // player id -> session
  private invites = new Map<number, { from: number; until: number }>(); // invited player id -> invitation
  /** Completed trades since start (for tests and metrics). */
  completed = 0;
  constructor(private w: World, private log: (r: TradeRecord, a: Player, b: Player) => void) {}

  /** Whether an item is on the table in a trade (and therefore cannot be changed). */
  locked(p: Player, uid: string): boolean {
    const s = this.sessions.get(p.id);
    return !!s && this.side(s, p).items.has(uid);
  }
  active(p: Player) {
    return this.sessions.has(p.id);
  }
  private side(s: Session, p: Player): Side {
    return s.a.p === p ? s.a : s.b;
  }
  private other(s: Session, p: Player): Side {
    return s.a.p === p ? s.b : s.a;
  }
  /** Why two players cannot trade right now ('' if they can). */
  private blocked(a: Player, b: Player): string {
    if (!a.conn || !b.conn) return 'The other player is offline';
    if (a.dead || b.dead) return 'Trading is not possible while dead';
    if (a.room !== b.room) return 'The other player is not here';
    if (Math.hypot(a.x - b.x, a.y - b.y) > TRADE_RANGE) return 'Too far away to trade';
    return '';
  }

  /** One trade command. Returns '' or the reason it was refused. */
  op(p: Player, m: any, now: number): string {
    if (!m || typeof m !== 'object') return 'Unknown trade command';
    const s = this.sessions.get(p.id);
    switch (m.op) {
      case 'invite': {
        if (s) return 'You are already trading';
        const t = Number.isInteger(m.id) ? this.w.online.get(m.id) : typeof m.name === 'string' ? [...this.w.online.values()].find((x) => x.name.toLowerCase() === m.name.toLowerCase()) : undefined;
        if (!t || t === p) return 'Player not found';
        if (this.sessions.has(t.id)) return `${t.name} is already trading`;
        const why = this.blocked(p, t);
        if (why) return why;
        if (now < p.lastTradeInvite + 3000) return 'Wait a moment before inviting again';
        p.lastTradeInvite = now;
        this.invites.set(t.id, { from: p.id, until: now + TRADE_INVITE_MS });
        this.w.send(t, { t: 'tinv', from: p.name, id: p.id, ms: TRADE_INVITE_MS });
        this.w.send(p, { t: 'sys', text: `Trade request sent to ${t.name}.` });
        return '';
      }
      case 'accept': {
        const inv = this.invites.get(p.id), from = inv && inv.until >= now ? this.w.online.get(inv.from) : undefined;
        this.invites.delete(p.id);
        if (!from) return 'The trade request has expired';
        if (s || this.sessions.has(from.id)) return 'One of you is already trading';
        const why = this.blocked(p, from);
        if (why) return why;
        const session: Session = { a: { p: from, items: new Map(), gold: 0, ok: false }, b: { p, items: new Map(), gold: 0, ok: false } };
        this.sessions.set(p.id, session);
        this.sessions.set(from.id, session);
        this.sync(session);
        return '';
      }
      case 'decline': {
        const inv = this.invites.get(p.id), from = inv ? this.w.online.get(inv.from) : undefined;
        this.invites.delete(p.id);
        if (from) this.w.send(from, { t: 'sys', text: `${p.name} declined your trade request.` });
        return '';
      }
    }
    if (!s) return 'You are not trading';
    const me = this.side(s, p);
    switch (m.op) {
      case 'offer': {
        const it = typeof m.uid === 'string' ? p.inv.find((x) => x.uid === m.uid) : undefined;
        if (!it) return 'Item not found in your bag';
        const qty = Number.isInteger(m.qty) && m.qty > 0 ? Math.min(m.qty as number, it.qty) : it.qty;
        if (!me.items.has(it.uid) && me.items.size >= TRADE_MAX_ITEMS) return `At most ${TRADE_MAX_ITEMS} items per trade`;
        me.items.set(it.uid, qty);
        break;
      }
      case 'remove':
        if (typeof m.uid !== 'string' || !me.items.delete(m.uid)) return 'That item is not in your offer';
        break;
      case 'gold': {
        if (!Number.isInteger(m.gold) || m.gold < 0 || m.gold > TRADE_GOLD_MAX) return 'Invalid amount of gold';
        if (m.gold > p.gold) return 'You do not have that much gold';
        me.gold = m.gold;
        break;
      }
      case 'confirm': {
        const why = this.blocked(s.a.p, s.b.p) || this.check(s);
        if (why) return why;
        me.ok = true;
        if (s.a.ok && s.b.ok) return this.exchange(s);
        this.sync(s);
        return '';
      }
      case 'unconfirm':
        me.ok = false;
        this.sync(s);
        return '';
      case 'cancel':
        this.end(s, `${p.name} cancelled the trade.`);
        return '';
      default:
        return 'Unknown trade command';
    }
    // the table changed: whatever either side had agreed to no longer exists
    s.a.ok = s.b.ok = false;
    this.sync(s);
    return '';
  }

  /** Ownership, quantities, gold and bag space, checked against the inventories as they are now. */
  private check(s: Session): string {
    for (const [me, them] of [[s.a, s.b], [s.b, s.a]] as const) {
      if (!Number.isInteger(me.gold) || me.gold < 0 || me.gold > me.p.gold) return `${me.p.name} does not have the gold offered`;
      const incoming: ItemSpec[] = [];
      for (const [uid, qty] of them.items) {
        const it = them.p.inv.find((x) => x.uid === uid);
        if (!it || it.qty < qty || qty < 1) return `${them.p.name} no longer has an offered item`;
        incoming.push(spec(it, qty));
      }
      // would everything fit once this side's own offered items have left the bag?
      const bag = me.p.inv.map((x) => ({ ...x })).filter((x) => {
        const out = me.items.get(x.uid) ?? 0;
        x.qty -= out;
        return x.qty > 0;
      });
      const trial = { inv: bag, invDirty: false } as unknown as Player;
      for (const sp of incoming) if (!give(trial, sp)) return `${me.p.name} does not have enough bag space (${INVENTORY_SIZE} slots)`;
    }
    return '';
  }

  private exchange(s: Session): string {
    const why = this.blocked(s.a.p, s.b.p) || this.check(s);
    if (why) {
      this.end(s, `Trade cancelled: ${why}.`);
      return '';
    }
    const { a, b } = s;
    const takeOut = (side: Side): ItemSpec[] => {
      const out: ItemSpec[] = [];
      for (const [uid, qty] of side.items) {
        const it = side.p.inv.find((x) => x.uid === uid)!;
        out.push(spec(it, qty));
        it.qty -= qty;
        if (it.qty <= 0) side.p.inv.splice(side.p.inv.indexOf(it), 1);
      }
      return out;
    };
    // everything leaves both bags first, then arrives: an item is never in two bags at once
    const fromA = takeOut(a), fromB = takeOut(b);
    for (const sp of fromB) give(a.p, sp);
    for (const sp of fromA) give(b.p, sp);
    a.p.gold += b.gold - a.gold;
    b.p.gold += a.gold - b.gold;
    a.p.invDirty = b.p.invDirty = true;
    this.completed++;
    this.log({ zone: a.p.room.zoneId, a: { id: a.p.id, name: a.p.name, gold: a.gold, items: fromA }, b: { id: b.p.id, name: b.p.name, gold: b.gold, items: fromB } }, a.p, b.p);
    this.close(s);
    for (const [me, got, gold, them] of [[a, fromB, b.gold, b], [b, fromA, a.gold, a]] as const) {
      sendInv(this.w, me.p);
      this.w.send(me.p, { t: 'trade', trade: null, done: true });
      const what = [...got.map((x) => `${ITEMS[x.base]?.name ?? x.base}${x.qty > 1 ? ' x' + x.qty : ''}`), ...(gold ? [`${gold} gold`] : [])];
      this.w.send(me.p, { t: 'sys', text: `Trade with ${them.p.name} complete. You received: ${what.join(', ') || 'nothing'}.` });
    }
    return '';
  }

  private close(s: Session) {
    this.sessions.delete(s.a.p.id);
    this.sessions.delete(s.b.p.id);
  }
  private end(s: Session, text: string) {
    this.close(s);
    for (const side of [s.a, s.b]) {
      this.w.send(side.p, { t: 'trade', trade: null });
      this.w.send(side.p, { t: 'sys', text });
    }
  }
  /** A player died, left the room or went offline: any trade they were in is cancelled. */
  drop(p: Player, why: string) {
    this.invites.delete(p.id);
    const s = this.sessions.get(p.id);
    if (s) this.end(s, `Trade cancelled: ${why}.`);
  }
  /** Called a few times a second: trades end when the players can no longer trade; old invitations expire. */
  tick(now: number) {
    for (const [id, inv] of this.invites) if (inv.until < now) this.invites.delete(id);
    const seen = new Set<Session>();
    for (const s of this.sessions.values()) {
      if (seen.has(s)) continue;
      seen.add(s);
      const why = this.blocked(s.a.p, s.b.p);
      if (why) this.end(s, `Trade cancelled: ${why.toLowerCase()}.`);
    }
  }

  private offer(side: Side): TradeOffer {
    const items: Item[] = [];
    for (const [uid, qty] of side.items) {
      const it = side.p.inv.find((x) => x.uid === uid);
      if (it) items.push({ ...it, qty: Math.min(qty, it.qty) });
    }
    return { items, gold: side.gold, ok: side.ok };
  }
  private sync(s: Session) {
    for (const me of [s.a, s.b]) {
      const them = this.other(s, me.p);
      const trade: TradeState = { with: { id: them.p.id, name: them.p.name }, mine: this.offer(me), theirs: this.offer(them) };
      this.w.send(me.p, { t: 'trade', trade });
    }
  }
}
