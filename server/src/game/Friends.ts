// Friends on the server. Links live in PostgreSQL; each online character's list is kept in memory
// and sent whole whenever it changes. A friend's place is told only to accepted friends.
import { FRIENDS_MAX, type FriendState, type FriendView } from '../../../shared/src/friends';
import { ZONES } from '../../../shared/src/world';
import type { Repo } from '../db/repo';
import type { Player, World } from './World';

interface Entry { id: number; name: string; job: string; level: number; state: FriendState }

export class Friends {
  /** character id -> their list (online characters only). */
  private lists = new Map<number, Map<number, Entry>>();
  constructor(private w: World, private repo: Repo) {}

  /** Login: load the list, send it, and tell online friends. */
  async load(p: Player) {
    try {
      const rows = await this.repo.friendsOf(p.id), list = new Map<number, Entry>();
      for (const r of rows) list.set(Number(r.id), { id: Number(r.id), name: r.name, job: r.job, level: r.level, state: r.accepted ? 'friend' : Number(r.a) === p.id ? 'out' : 'in' });
      this.lists.set(p.id, list);
      this.send(p);
      this.announce(p, true);
    } catch (e) {
      console.error('friends load failed', e);
    }
  }
  /** Logout: forget the list and tell online friends. */
  left(p: Player) {
    this.announce(p, false);
    this.lists.delete(p.id);
  }
  private announce(p: Player, online: boolean) {
    for (const [id, e] of this.lists.get(p.id) ?? []) {
      if (e.state !== 'friend') continue;
      const o = this.w.online.get(id);
      if (!o || !this.lists.has(id)) continue;
      this.w.send(o, { t: 'sys', text: online ? `Your friend ${p.name} is now online.` : `Your friend ${p.name} went offline.`, cue: online ? 'rep' : undefined });
      this.send(o, online ? undefined : p.id);
    }
  }
  private view(p: Player, offline?: number): FriendView[] {
    const out: FriendView[] = [];
    for (const e of this.lists.get(p.id)?.values() ?? []) {
      const o = e.id === offline ? undefined : this.w.online.get(e.id), on = !!o?.conn;
      out.push({ id: e.id, name: e.name, job: o?.job ?? e.job, level: o?.level ?? e.level, state: e.state, online: on, zone: on && e.state === 'friend' ? ZONES[o!.room.zoneId]?.name ?? '' : '', party: !!o?.party });
    }
    const rank = { in: 0, friend: 1, out: 2 };
    return out.sort((a, b) => rank[a.state] - rank[b.state] || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }
  send(p: Player, offline?: number) {
    this.w.send(p, { t: 'friends', list: this.view(p, offline) });
  }
  /** Both ends of a link changed: update whoever is online. */
  private put(a: Player | undefined, e: Entry | null, otherId: number) {
    if (!a) return;
    const list = this.lists.get(a.id);
    if (!list) return;
    if (e) list.set(otherId, e);
    else list.delete(otherId);
    this.send(a);
  }

  /** `{op:'list'|'add'|'accept'|'decline'|'remove', name?, id?}`. Returns '' or the reason it was refused. */
  async op(p: Player, m: any): Promise<string> {
    if (!m || typeof m !== 'object') return 'Unknown command';
    const list = this.lists.get(p.id);
    if (!list) return 'Your friends list is still loading';
    switch (m.op) {
      case 'list':
        this.send(p);
        return '';
      case 'add': {
        // by name (anyone, online or not) or by id (someone in sight)
        let t: { id: number; name: string; job?: string; level?: number } | undefined;
        if (Number.isInteger(m.id)) {
          const o = this.w.online.get(m.id);
          if (o) t = { id: o.id, name: o.name, job: o.job, level: o.level };
        } else if (typeof m.name === 'string' && /^[A-Za-z0-9]{2,20}$/.test(m.name.trim())) {
          const name = m.name.trim().toLowerCase();
          for (const o of this.w.online.values()) if (o.name.toLowerCase() === name) t = { id: o.id, name: o.name, job: o.job, level: o.level };
          t ??= await this.repo.characterByName(m.name.trim());
        }
        if (!t) return 'Player not found';
        if (t.id === p.id) return 'You cannot add yourself';
        const have = list.get(t.id);
        if (have?.state === 'friend') return `${t.name} is already your friend`;
        if (have?.state === 'out') return `You have already asked ${t.name}`;
        if (have?.state === 'in') return this.op(p, { op: 'accept', id: t.id });
        if (list.size >= FRIENDS_MAX) return `Your friends list is full (${FRIENDS_MAX})`;
        await this.repo.addFriend(p.id, t.id);
        const o = this.w.online.get(t.id), info = await this.repo.characterInfo(t.id);
        this.put(p, { id: t.id, name: t.name, job: o?.job ?? info?.job ?? 'knight', level: o?.level ?? info?.level ?? 1, state: 'out' }, t.id);
        this.put(o, { id: p.id, name: p.name, job: p.job, level: p.level, state: 'in' }, p.id);
        if (o) this.w.send(o, { t: 'sys', text: `${p.name} wants to be your friend. Open the friends list to answer.`, cue: 'rep' });
        this.w.send(p, { t: 'sys', text: `Friend request sent to ${t.name}.` });
        return '';
      }
      case 'accept': {
        const e = Number.isInteger(m.id) ? list.get(m.id) : undefined;
        if (!e || e.state !== 'in') return 'There is no such request';
        await this.repo.acceptFriend(e.id, p.id);
        const o = this.w.online.get(e.id);
        this.put(p, { ...e, state: 'friend' }, e.id);
        this.put(o, { id: p.id, name: p.name, job: p.job, level: p.level, state: 'friend' }, p.id);
        if (o) this.w.send(o, { t: 'sys', text: `${p.name} is now your friend.`, cue: 'rep' });
        this.w.send(p, { t: 'sys', text: `${e.name} is now your friend.`, cue: 'rep' });
        return '';
      }
      case 'decline': case 'remove': {
        const e = Number.isInteger(m.id) ? list.get(m.id) : undefined;
        if (!e) return 'That player is not on your list';
        await this.repo.removeFriend(p.id, e.id);
        this.put(p, null, e.id);
        this.put(this.w.online.get(e.id), null, p.id);
        this.w.send(p, { t: 'sys', text: e.state === 'friend' ? `${e.name} is no longer your friend.` : `The request with ${e.name} was removed.` });
        return '';
      }
      default:
        return 'Unknown command';
    }
  }
}
