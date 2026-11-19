// Parties: invitations, membership, leadership and the state shown in party frames.
// In-memory only: a party lives as long as its members are online. All rules are enforced here.
import { LOOT_MODE_NAMES, LOOT_MODES, PARTY_INVITE_MS, PARTY_MAX, PARTY_SHARE_RANGE, type LootMode, type PartyState } from '../../../shared/src/protocol';
import type { Player, World, ZoneRoom } from './World';

export interface Party {
  id: number;
  leader: number;
  members: number[]; // character ids in join order
  last: string; // last state sent, to send only on change
  loot: LootMode;
  /** Round-robin pointer: index into `members` of whoever receives the next drop. */
  rr: number;
}

export class Parties {
  private list = new Map<number, Party>();
  private nextId = 1;
  constructor(private w: World) {}

  get count() {
    return this.list.size;
  }
  private find(ref: unknown): Player | undefined {
    if (Number.isInteger(ref)) return this.w.online.get(ref as number);
    if (typeof ref !== 'string') return undefined;
    const name = ref.trim().toLowerCase();
    if (!name || name.length > 20) return undefined;
    for (const p of this.w.online.values()) if (p.name.toLowerCase() === name) return p;
    return undefined;
  }
  /** Online member objects (including those in other zones). */
  members(party: Party): Player[] {
    const out: Player[] = [];
    for (const id of party.members) {
      const p = this.w.online.get(id);
      if (p) out.push(p);
    }
    return out;
  }
  private tell(party: Party, text: string) {
    for (const m of this.members(party)) this.w.send(m, { t: 'sys', text });
  }

  /** Invite by character id or name. Returns '' or the reason it was refused. */
  invite(p: Player, ref: unknown): string {
    const now = Date.now();
    if (now - p.lastInvite < 1500) return 'Wait a moment before inviting again';
    const t = this.find(ref);
    if (!t) return 'Player not found';
    if (t === p) return 'You cannot invite yourself';
    if (p.party && p.party.leader !== p.id) return 'Only the party leader can invite';
    if (p.party && p.party.members.length >= PARTY_MAX) return `The party is full (${PARTY_MAX})`;
    if (t.party) return `${t.name} is already in a party`;
    if (t.invite && t.invite.until > now) return `${t.name} already has a pending invitation`;
    p.lastInvite = now;
    t.invite = { from: p.id, until: now + PARTY_INVITE_MS };
    this.w.send(t, { t: 'pinv', from: p.name, id: p.id, ms: PARTY_INVITE_MS });
    this.w.send(p, { t: 'sys', text: `Invitation sent to ${t.name}.` });
    return '';
  }

  respond(p: Player, accept: unknown): string {
    const inv = p.invite;
    p.invite = null;
    if (!inv || inv.until < Date.now()) return 'The invitation has expired';
    const from = this.w.online.get(inv.from);
    if (!accept) {
      if (from) this.w.send(from, { t: 'sys', text: `${p.name} declined your invitation.` });
      return '';
    }
    if (!from) return 'The inviter is no longer online';
    if (p.party) return 'You are already in a party';
    let party = from.party;
    if (party && party.leader !== from.id) return 'The invitation is no longer valid';
    if (party && party.members.length >= PARTY_MAX) return `The party is full (${PARTY_MAX})`;
    if (!party) {
      party = { id: this.nextId++, leader: from.id, members: [from.id], last: '', loot: 'personal', rr: 0 };
      this.list.set(party.id, party);
      from.party = party;
    }
    party.members.push(p.id);
    p.party = party;
    this.tell(party, `${p.name} joined the party.`);
    this.sync(party);
    return '';
  }

  /** A party formed by the dungeon finder: the first player leads. Players must not be in a party. */
  form(players: Player[]) {
    const party: Party = { id: this.nextId++, leader: players[0].id, members: players.map((p) => p.id), last: '', loot: 'personal', rr: 0 };
    this.list.set(party.id, party);
    for (const p of players) p.party = party;
    this.tell(party, `${players.map((p) => p.name).join(', ')} formed a party.`);
    this.sync(party);
    return party;
  }

  /** Leave voluntarily, be kicked, or drop out on logout. */
  remove(p: Player, why: 'left' | 'kicked' | 'offline') {
    const party = p.party;
    if (!party) return;
    party.members = party.members.filter((id) => id !== p.id);
    p.party = null;
    this.w.send(p, { t: 'party', party: null });
    if (why !== 'offline') this.w.send(p, { t: 'sys', text: why === 'kicked' ? 'You were removed from the party.' : 'You left the party.' });
    if (party.members.length < 2) {
      for (const m of this.members(party)) {
        m.party = null;
        this.w.send(m, { t: 'party', party: null });
        this.w.send(m, { t: 'sys', text: 'The party has been disbanded.' });
      }
      this.list.delete(party.id);
      return;
    }
    this.tell(party, why === 'kicked' ? `${p.name} was removed from the party.` : `${p.name} left the party.`);
    if (party.leader === p.id) {
      party.leader = party.members[0];
      const l = this.w.online.get(party.leader);
      if (l) this.tell(party, `${l.name} is now the party leader.`);
    }
    this.sync(party);
  }
  kick(p: Player, id: unknown): string {
    const party = p.party;
    if (!party) return 'You are not in a party';
    if (party.leader !== p.id) return 'Only the party leader can do that';
    const t = Number.isInteger(id) ? this.w.online.get(id as number) : undefined;
    if (!t || t.party !== party || t === p) return 'That player is not in your party';
    this.remove(t, 'kicked');
    return '';
  }
  /** The leader chooses how ordinary drops are shared. */
  setLoot(p: Player, mode: unknown): string {
    const party = p.party;
    if (!party) return 'You are not in a party';
    if (party.leader !== p.id) return 'Only the party leader can do that';
    if (!LOOT_MODES.includes(mode as LootMode)) return 'Unknown loot mode';
    if (party.loot === mode) return '';
    party.loot = mode as LootMode;
    this.tell(party, `Loot is now shared: ${LOOT_MODE_NAMES[party.loot]}.`);
    this.sync(party);
    return '';
  }
  promote(p: Player, id: unknown): string {
    const party = p.party;
    if (!party) return 'You are not in a party';
    if (party.leader !== p.id) return 'Only the party leader can do that';
    const t = Number.isInteger(id) ? this.w.online.get(id as number) : undefined;
    if (!t || t.party !== party || t === p) return 'That player is not in your party';
    party.leader = t.id;
    this.tell(party, `${t.name} is now the party leader.`);
    this.sync(party);
    return '';
  }

  /** Party members who count as allies for area effects: same room, within `r` of the point. Always includes `p`. */
  allies(p: Player, x: number, y: number, r: number): Player[] {
    const out: Player[] = [p];
    if (!p.party) return out;
    for (const id of p.party.members) {
      const m = p.room.players.get(id);
      if (m && m !== p && !m.dead && Math.hypot(m.x - x, m.y - y) <= r) out.push(m);
    }
    return out;
  }
  /** Members eligible for a share of a kill: same room, near the monster, alive (or having contributed). */
  sharers(party: Party, room: ZoneRoom, x: number, y: number, contributed: (id: number) => boolean): Player[] {
    const out: Player[] = [];
    for (const id of party.members) {
      const m = room.players.get(id);
      if (m && Math.hypot(m.x - x, m.y - y) <= PARTY_SHARE_RANGE && (!m.dead || contributed(id))) out.push(m);
    }
    return out;
  }
  /** A room in `zone` that already holds a party member and has space, if any. */
  roomFor(p: Player, zone: string, capacity: number): ZoneRoom | null {
    if (!p.party) return null;
    for (const m of this.members(p.party)) if (m !== p && m.room.zoneId === zone && m.room.players.size < capacity) return m.room;
    return null;
  }

  state(party: Party): PartyState {
    return {
      id: party.id,
      leader: party.leader,
      loot: party.loot,
      members: party.members.map((id) => {
        const m = this.w.online.get(id)!;
        return { id, name: m.name, job: m.job, level: m.level, hp: m.hp, mhp: m.maxHp, zone: m.room.zoneId, ch: m.room.channel, x: Math.round(m.x), y: Math.round(m.y), on: !!m.conn };
      }),
    };
  }
  /** Sends the party state to every member if it changed since the last send. */
  sync(party: Party, force = false) {
    const st = this.state(party), json = JSON.stringify(st);
    if (!force && json === party.last) return;
    party.last = json;
    for (const m of this.members(party)) this.w.send(m, { t: 'party', party: st });
  }
  /** Once a second: refresh frames (HP, position, zone, online) and drop expired invitations. */
  tick(now: number) {
    for (const party of this.list.values()) this.sync(party);
    for (const p of this.w.online.values()) if (p.invite && p.invite.until < now) p.invite = null;
  }
}
