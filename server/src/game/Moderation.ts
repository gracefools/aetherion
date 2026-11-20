// T4: moderation for administrators: ban (refused at login and when joining), mute (chat refused),
// kick, and an item and gold audit of a character (what it holds now, its recent trades and bank
// use). Every action is written to the moderation log.
import type { Repo } from '../db/repo';
import type { Player, World } from './World';

/** A ban or mute without an end. */
export const PERMANENT = Date.UTC(9999, 0, 1);
export interface AccountMod {
  username: string;
  is_admin: boolean;
  banned_until: Date | string | null;
  ban_reason: string;
  muted_until: Date | string | null;
}
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);
const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
/** Why a banned account cannot play, or '' when it can. */
export function banText(until: Date | string | null | undefined, reason = ''): string {
  const t = ms(until), r = reason || '-';
  if (t <= Date.now()) return '';
  return t >= PERMANENT ? `This account is banned. Reason: ${r}` : `This account is banned until ${when(t)} UTC. Reason: ${r}`;
}
export const MOD_OPS = ['ban', 'unban', 'mute', 'unmute', 'kick', 'audit'] as const;

export class Moderation {
  private admins: Set<string>;
  constructor(private w: World, private repo: Repo, admins: string[] = []) {
    this.admins = new Set(admins.map((a) => a.trim().toLowerCase()).filter(Boolean));
  }
  /** Called when a character joins: whether its account moderates, and whether it is muted. */
  attach(p: Player, m: AccountMod | undefined) {
    p.admin = !!m && (!!m.is_admin || this.admins.has(m.username.toLowerCase()));
    p.mutedUntil = ms(m?.muted_until);
  }
  /** Why this character may not chat now, or ''. */
  muted(p: Player): string {
    const left = p.mutedUntil - Date.now();
    if (left <= 0) return '';
    return p.mutedUntil >= PERMANENT ? 'You are muted.' : `You are muted for ${Math.ceil(left / 60_000)} more minutes.`;
  }
  private tell(p: Player, m: { text: string }) {
    this.w.send(p, { t: 'sys', text: m.text });
  }
  private onlineByName(name: string): Player | undefined {
    const n = name.toLowerCase();
    for (const o of this.w.online.values()) if (o.name.toLowerCase() === n) return o;
    return undefined;
  }
  /** The account's characters that are online. */
  private ofAccount(accountId: number): Player[] {
    return [...this.w.online.values()].filter((o) => o.accountId === accountId);
  }
  /** A slash command from an administrator: /ban, /unban, /mute, /unmute, /kick, /audit. */
  async command(p: Player, op: unknown, arg: unknown) {
    if (!p.admin) return this.tell(p, { text: 'Unknown command' }); // not a moderator: nothing to reveal
    const args = typeof arg === 'string' ? arg.trim().split(/\s+/).filter(Boolean) : [];
    const name = (args[0] ?? '').slice(0, 20);
    if (!MOD_OPS.includes(op as (typeof MOD_OPS)[number]) || !name)
      return this.tell(p, { text: 'Usage: /ban Name [hours] [reason], /unban Name, /mute Name [minutes] [reason], /unmute Name, /kick Name [reason], /audit Name' });
    const num = Number(args[1]), timed = Number.isFinite(num) && num > 0 && /^\d+(\.\d+)?$/.test(args[1] ?? '');
    const reason = args.slice(timed ? 2 : 1).join(' ').slice(0, 120);
    try {
      if (op === 'kick') {
        const o = this.onlineByName(name);
        if (!o) return this.tell(p, { text: 'That player is not online.' });
        this.w.send(o, { t: 'kick', reason: reason ? `Removed by a moderator: ${reason}` : 'Removed by a moderator.' });
        o.conn?.close();
        await this.repo.modLog(p.name, 'kick', o.name, reason);
        return this.tell(p, { text: `Kicked ${o.name}.` });
      }
      if (op === 'audit') return await this.audit(p, name);
      const acc = await this.repo.accountOfCharacter(name);
      if (!acc) return this.tell(p, { text: 'Player not found' });
      if (acc.account_id === p.accountId && (op === 'ban' || op === 'mute')) return this.tell(p, { text: 'You cannot do that to your own account.' });
      if (op === 'ban' || op === 'unban') {
        const until = op === 'unban' ? 0 : timed ? Date.now() + num * 3_600_000 : PERMANENT;
        await this.repo.setBan(acc.account_id, until ? new Date(until) : null, reason);
        await this.repo.modLog(p.name, op, acc.name, op === 'ban' ? `${timed ? num + 'h' : 'permanent'} ${reason}`.trim() : '');
        if (op === 'unban') return this.tell(p, { text: `Lifted the ban on ${acc.name}.` });
        for (const o of this.ofAccount(acc.account_id)) {
          this.w.send(o, { t: 'kick', reason: banText(new Date(until), reason) });
          o.conn?.close();
        }
        return this.tell(p, { text: timed ? `Banned ${acc.name} for ${num} hours.` : `Banned ${acc.name} permanently.` });
      }
      // mute / unmute (60 minutes unless a length is given)
      const mins = timed ? num : 60, until = op === 'unmute' ? 0 : Date.now() + mins * 60_000;
      await this.repo.setMute(acc.account_id, until ? new Date(until) : null);
      await this.repo.modLog(p.name, String(op), acc.name, op === 'mute' ? `${mins}m ${reason}`.trim() : '');
      for (const o of this.ofAccount(acc.account_id)) {
        o.mutedUntil = until;
        this.tell(o, { text: until ? `A moderator muted you for ${mins} minutes.` : 'A moderator lifted your mute.' });
      }
      return this.tell(p, { text: until ? `Muted ${acc.name} for ${mins} minutes.` : `Lifted the mute on ${acc.name}.` });
    } catch (e) {
      console.error('moderation failed', e);
      this.tell(p, { text: 'The request could not be completed; nothing was changed' });
    }
  }
  /** What a character holds (live when online), with its recent trades and bank use. */
  private async audit(p: Player, name: string) {
    const a = await this.repo.auditCharacter(name);
    if (!a) return this.tell(p, { text: 'Player not found' });
    const o = this.w.online.get(a.id);
    const gold = o ? o.gold : a.gold, bag = o ? o.inv.length : a.bag, bankItems = o ? o.bank.items.length : a.bank_items, bankGold = o ? o.bank.gold : a.bank_gold;
    await this.repo.modLog(p.name, 'audit', a.name, '');
    this.tell(p, { text: `Audit of ${a.name}, level ${o?.level ?? a.level}${o ? ', online' : ''}: ${gold} gold, ${bag} items in the bag, ${bankItems} items and ${bankGold} gold in the bank.` });
    const sum = (g: { gold?: number; items?: unknown[] }) => `${g?.gold ?? 0} gold and ${g?.items?.length ?? 0} items`;
    if (!a.trades.length) this.tell(p, { text: 'No recent trades.' });
    for (const t of a.trades) {
      const mine = t.a_id === a.id, other = mine ? t.b_name : t.a_name;
      this.tell(p, { text: `Trade on ${when(ms(t.at))} with ${other}: gave ${sum(mine ? t.a_gave : t.b_gave)}, received ${sum(mine ? t.b_gave : t.a_gave)}.` });
    }
    for (const b of a.bank) this.tell(p, { text: `Bank on ${when(ms(b.at))}: ${b.op} ${JSON.stringify(b.detail).slice(0, 120)}` });
  }
}
