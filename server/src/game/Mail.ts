// Player mail on the server. Letters are written and read in any village; taking what a letter
// carries, and sending one, each run in one transaction with the character's bag and gold, and
// memory is restored if the transaction fails (the same rule as the bank and the auction house).
import { cleanItem, INVENTORY_SIZE, ITEMS, type Item } from '../../../shared/src/items';
import { MAIL_BODY_MAX, MAIL_GOLD_MAX, MAIL_MAX_ITEMS, MAIL_PAGE, MAIL_SUBJECT_MAX, mailPostage, type MailEntry } from '../../../shared/src/mail';
import { inTown } from '../../../shared/src/pvp';
import type { Repo } from '../db/repo';
import { give, sendInv } from './Inventory';
import type { Player, World } from './World';

const userError = (msg: string) => Object.assign(new Error(msg), { user: true });
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export class Mail {
  constructor(private w: World, private repo: Repo) {}

  /** Number of unread letters, sent on login and whenever a letter arrives. */
  async notify(p: Player) {
    try {
      this.w.send(p, { t: 'mail', unread: await this.repo.unreadMail(p.id) });
    } catch (e) {
      console.error('mail count failed', e);
    }
  }
  private async sendList(p: Player) {
    const rows = await this.repo.listMail(p.id, MAIL_PAGE);
    const list: MailEntry[] = rows.map((r: any) => ({
      id: Number(r.id), from: r.from_name, subject: r.subject, body: r.body, gold: Number(r.gold), at: new Date(r.sent_at).getTime(), read: r.read, claimed: r.claimed,
      items: (Array.isArray(r.items) ? r.items : []).filter((i: any) => ITEMS[i?.base]).map((i: any) => ({ base: i.base, rar: i.rar ?? 0, qty: i.qty ?? 1, ilvl: i.ilvl ?? 1 })),
    }));
    this.w.send(p, { t: 'mail', unread: list.filter((m) => !m.read).length, list });
  }
  private async atomic(p: Player, fn: () => Promise<string>): Promise<string> {
    if (p.econBusy) return 'Please wait for the previous request to finish';
    p.econBusy = true;
    const b = { gold: p.gold, inv: p.inv.map((i) => ({ ...i, aff: i.aff.map((a) => [a[0], a[1]] as [typeof a[0], number]) })) };
    try {
      const why = await fn();
      if (why) Object.assign(p, b);
      else p.invDirty = false; // stored by the transaction
      return why;
    } catch (e) {
      Object.assign(p, b);
      if ((e as any).user) return (e as Error).message;
      if ((e as Error).message === 'not available') return 'That letter has nothing left to take';
      console.error('mail operation failed', e);
      return 'The request could not be completed; nothing was changed';
    } finally {
      p.econBusy = false;
      sendInv(this.w, p);
    }
  }

  /** `{op:'list'|'send'|'claim'|'read'|'delete', ...}`. Returns '' or the reason it was refused. */
  async op(p: Player, m: any): Promise<string> {
    if (!m || typeof m !== 'object') return 'Unknown command';
    const town = inTown(p.room.zoneId, p.x, p.y);
    switch (m.op) {
      case 'list':
        await this.sendList(p);
        return '';
      case 'read':
        if (!Number.isInteger(m.id)) return 'Unknown letter';
        await this.repo.markMailRead(m.id, p.id);
        await this.sendList(p);
        return '';
      case 'delete':
        if (!Number.isInteger(m.id)) return 'Unknown letter';
        if (!(await this.repo.deleteMail(m.id, p.id))) return 'Take what the letter carries before deleting it';
        await this.sendList(p);
        return '';
      case 'claim': {
        if (!town) return 'Letters can be opened in a village';
        if (!Number.isInteger(m.id)) return 'Unknown letter';
        const why = await this.atomic(p, async () => {
          const got = await this.repo.claimMail(m.id, p.id, (letter) => {
            const seen = new Set(p.inv.map((i) => i.uid)), items = letter.items.map((r) => cleanItem(r, seen)).filter((x): x is Item => !!x);
            if (INVENTORY_SIZE - p.inv.length < items.length) throw userError('Make room in your bag first');
            for (const it of items) if (!give(p, it)) throw userError('Make room in your bag first');
            p.gold += letter.gold;
            return this.w.snapshot(p);
          });
          this.w.send(p, { t: 'sys', text: got.items ? `Taken from the letter: ${got.gold} gold and ${got.items} items.` : `Taken from the letter: ${got.gold} gold.` });
          return '';
        });
        await this.sendList(p);
        return why;
      }
      case 'send': {
        if (!town) return 'Letters can be sent from a village';
        const subject = clean(m.subject, MAIL_SUBJECT_MAX), body = clean(m.body, MAIL_BODY_MAX);
        if (!subject) return 'Write a subject';
        const gold = m.gold === undefined ? 0 : m.gold;
        if (!Number.isInteger(gold) || gold < 0 || gold > MAIL_GOLD_MAX) return 'Unknown amount of gold';
        const uids: string[] = Array.isArray(m.items) ? [...new Set<string>(m.items.filter((u: unknown): u is string => typeof u === 'string'))] : [];
        if (uids.length > MAIL_MAX_ITEMS) return `A letter carries at most ${MAIL_MAX_ITEMS} items`;
        const to = typeof m.to === 'string' ? await this.repo.characterByName(m.to.trim()) : undefined;
        if (!to) return 'There is no character of that name';
        if (to.id === p.id) return 'You cannot write to yourself';
        const why = await this.atomic(p, async () => {
          const items: Item[] = [];
          for (const uid of uids) {
            const it = p.inv.find((i) => i.uid === uid);
            if (!it) return 'Item not found in your bag';
            if (this.w.trades.locked(p, uid)) return 'That item is in your trade offer';
            items.push(it);
          }
          const postage = mailPostage(items.length);
          if (p.gold < gold + postage) return `You need ${gold + postage} gold (postage ${postage})`;
          for (const it of items) p.inv.splice(p.inv.indexOf(it), 1);
          p.gold -= gold + postage;
          await this.repo.sendMail({ to: to.id, from: p.id, fromName: p.name, subject, body, items, gold }, this.w.snapshot(p));
          this.w.send(p, { t: 'sys', text: `Letter sent to ${to.name} (postage ${postage} gold).` });
          return '';
        });
        if (!why) {
          const r = this.w.online.get(to.id);
          if (r) {
            this.w.send(r, { t: 'sys', text: `A letter from ${p.name} has arrived.`, cue: 'quest' });
            void this.notify(r);
          }
        }
        return why;
      }
      default:
        return 'Unknown command';
    }
  }
}
