// Guilds (M14). The database is the source of truth: every change is written first and only then
// applied in memory, so a failed write never leaves the game and the database disagreeing.
// Operations on one guild run one after another (a per-guild queue), so two officers acting at
// the same moment cannot interleave.
import {
  can, cleanEmblem, GUILD_CREATE_COST, GUILD_CREATE_LEVEL, GUILD_INVITE_MS, GUILD_MAX_LEVEL, GUILD_MOTD_MAX, GUILD_NAME, GUILD_RANKS, GUILD_TAG,
  guildCapacity, guildExpToNext, type Emblem, type GuildPerm, type GuildView, cleanBuildings, emptyBuildings, GUILD_BUILDINGS, GUILD_BUILDING_INFO, GUILD_BUILDING_MAX, GUILD_KILL_POINTS, guildBonus, guildPointsLeft, type GuildBuilding, type GuildBuildings,
} from '../../../shared/src/economy';
import { PgError } from '../db/pgwire';
import type { Repo } from '../db/repo';
import { sendInv } from './Inventory';
import type { Player, World } from './World';

interface Member {
  id: number;
  name: string;
  job: string;
  level: number;
  rank: number;
}
export interface Guild {
  id: number;
  name: string;
  tag: string;
  emblem: Emblem;
  leader: number;
  level: number;
  exp: number;
  motd: string;
  bank: number;
  members: Map<number, Member>;
  buildings: GuildBuildings;
  /** Experience earned since the last write (written in batches). */
  pendingExp: number;
}

export class Guilds {
  readonly byId = new Map<number, Guild>();
  /** character id -> guild id */
  readonly of = new Map<number, number>();
  private invites = new Map<number, { guild: number; from: string; until: number }>();
  private queue = new Map<number, Promise<unknown>>();
  constructor(private w: World, private repo: Repo) {}

  async load() {
    const { guilds, members } = await this.repo.loadGuilds();
    for (const g of guilds)
      this.byId.set(Number(g.id), { id: Number(g.id), name: g.name, tag: g.tag, emblem: cleanEmblem(g.emblem) ?? { shape: 0, color: 0, bg: 7 }, leader: Number(g.leader_id), level: g.level, exp: Number(g.exp), motd: g.motd, bank: Number(g.bank_gold), buildings: cleanBuildings(g.buildings), members: new Map(), pendingExp: 0 });
    for (const m of members) {
      const g = this.byId.get(Number(m.guild_id));
      if (!g) continue;
      g.members.set(Number(m.character_id), { id: Number(m.character_id), name: m.name, job: m.job, level: m.level, rank: m.rank });
      this.of.set(Number(m.character_id), g.id);
    }
  }
  guildOf(p: Player) {
    const id = this.of.get(p.id);
    return id ? this.byId.get(id) : undefined;
  }
  tagOf(id: number) {
    const g = this.byId.get(this.of.get(id) ?? 0);
    return g?.tag;
  }
  /** Runs operations on one guild strictly in order. */
  private serial<T>(key: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.queue.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queue.set(key, next.catch(() => {}));
    return next;
  }

  async view(g: Guild): Promise<GuildView> {
    const got = await this.repo.guildLogs(g.id).catch(() => []), log = Array.isArray(got) ? got : [];
    return {
      id: g.id, name: g.name, tag: g.tag, emblem: g.emblem, level: g.level, exp: g.exp, next: guildExpToNext(g.level), motd: g.motd, bank: g.bank, capacity: guildCapacity(g.level), buildings: g.buildings, points: guildPointsLeft(g.level, g.buildings),
      members: [...g.members.values()].map((m) => ({ ...m, level: this.w.online.get(m.id)?.level ?? m.level, online: !!this.w.online.get(m.id)?.conn })).sort((a, b) => a.rank - b.rank || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      log: log.map((l) => ({ at: new Date(l.at).getTime(), text: l.text })),
    };
  }
  /** Sends the guild to every online member (or the given player). */
  async sync(g: Guild | undefined, only?: Player) {
    const v = g ? await this.view(g) : null;
    const to = only ? [only] : g ? [...g.members.keys()].map((id) => this.w.online.get(id)).filter((x): x is Player => !!x) : [];
    for (const p of to) this.w.send(p, { t: 'guild', guild: v, rank: v ? g!.members.get(p.id)?.rank ?? 3 : 0 });
  }
  private async log(g: Guild, text: string) {
    await this.repo.guildLog(g.id, text).catch((e) => console.error('guild log failed', e));
  }
  private tell(g: Guild, text: string) {
    for (const id of g.members.keys()) {
      const p = this.w.online.get(id);
      if (p) this.w.send(p, { t: 'sys', text, cue: 'guild' });
    }
  }
  /** Name plates show the tag: others must be told about the change. */
  private relook(id: number) {
    const p = this.w.online.get(id);
    if (p) this.w.relook(p);
  }
  private need(p: Player, perm: GuildPerm): { g: Guild; rank: number } | string {
    const g = this.guildOf(p);
    if (!g) return 'You are not in a guild';
    const rank = g.members.get(p.id)!.rank;
    if (!can(rank, perm)) return `Your rank (${GUILD_RANKS[rank]}) cannot do that`;
    return { g, rank };
  }

  /** One guild command. Resolves to '' or the reason it was refused. */
  async op(p: Player, m: any): Promise<string> {
    if (!m || typeof m !== 'object') return 'Unknown guild command';
    const gid = this.of.get(p.id) ?? 0;
    return this.serial(m.op === 'create' ? -p.id : gid || -p.id, () => this.run(p, m));
  }
  private async run(p: Player, m: any): Promise<string> {
    switch (m.op) {
      case 'create': {
        if (this.guildOf(p)) return 'You are already in a guild';
        if (p.level < GUILD_CREATE_LEVEL) return `Requires level ${GUILD_CREATE_LEVEL}`;
        const name = typeof m.name === 'string' ? m.name.trim().replace(/\s+/g, ' ') : '', tag = typeof m.tag === 'string' ? m.tag.trim().toUpperCase() : '';
        if (!GUILD_NAME.test(name)) return 'Guild name: 3-24 letters, spaces or apostrophes, starting with a letter';
        if (!GUILD_TAG.test(tag)) return 'Tag: 2-4 capital letters or digits';
        const emblem = cleanEmblem(m.emblem);
        if (!emblem) return 'Choose an emblem: a shape and two different colours';
        if (p.gold < GUILD_CREATE_COST) return `Founding a guild costs ${GUILD_CREATE_COST} gold`;
        p.gold -= GUILD_CREATE_COST;
        let id: number;
        try {
          id = await this.repo.createGuild({ name, tag, emblem, leader: p.id }, { ...this.w.snapshot(p), name: p.name });
        } catch (e) {
          p.gold += GUILD_CREATE_COST;
          if (e instanceof PgError && e.code === '23505') return /tag/.test(e.message) ? 'That tag is taken' : 'That guild name is taken';
          throw e;
        }
        p.invDirty = false;
        const g: Guild = { id, name, tag, emblem, leader: p.id, level: 1, exp: 0, motd: '', bank: 0, buildings: emptyBuildings(), members: new Map([[p.id, { id: p.id, name: p.name, job: p.job, level: p.level, rank: 0 }]]), pendingExp: 0 };
        this.byId.set(id, g);
        this.of.set(p.id, id);
        sendInv(this.w, p);
        this.relook(p.id);
        await this.sync(g);
        return '';
      }
      case 'invite': {
        const r = this.need(p, 'invite');
        if (typeof r === 'string') return r;
        const t = typeof m.name === 'string' ? [...this.w.online.values()].find((x) => x.name.toLowerCase() === m.name.trim().toLowerCase()) : Number.isInteger(m.id) ? this.w.online.get(m.id) : undefined;
        if (!t || !t.conn) return 'That player is not online';
        if (this.of.has(t.id)) return `${t.name} is already in a guild`;
        if (r.g.members.size >= guildCapacity(r.g.level)) return 'The guild is full';
        this.invites.set(t.id, { guild: r.g.id, from: p.name, until: Date.now() + GUILD_INVITE_MS });
        this.w.send(t, { t: 'ginv', guild: r.g.name, tag: r.g.tag, from: p.name, ms: GUILD_INVITE_MS });
        this.w.send(p, { t: 'sys', text: `Guild invitation sent to ${t.name}.` });
        return '';
      }
      case 'accept': {
        const inv = this.invites.get(p.id);
        this.invites.delete(p.id);
        const g = inv && inv.until >= Date.now() ? this.byId.get(inv.guild) : undefined;
        if (!g) return 'The invitation has expired';
        if (this.of.has(p.id)) return 'You are already in a guild';
        return this.serial(g.id, async () => {
          if (g.members.size >= guildCapacity(g.level)) return 'The guild is full';
          try {
            await this.repo.addGuildMember(g.id, p.id, 3);
          } catch (e) {
            if (e instanceof PgError && e.code === '23505') return 'You are already in a guild';
            throw e;
          }
          g.members.set(p.id, { id: p.id, name: p.name, job: p.job, level: p.level, rank: 3 });
          this.of.set(p.id, g.id);
          await this.log(g, `${p.name} joined (invited by ${inv!.from}).`);
          this.tell(g, `${p.name} has joined the guild.`);
          this.relook(p.id);
          await this.sync(g);
          return '';
        });
      }
      case 'decline':
        this.invites.delete(p.id);
        return '';
      case 'leave': {
        const g = this.guildOf(p);
        if (!g) return 'You are not in a guild';
        if (g.leader === p.id) return g.members.size > 1 ? 'Hand the leadership to another member first, or disband the guild' : 'You are the only member: disband the guild instead';
        await this.repo.removeGuildMember(p.id);
        g.members.delete(p.id);
        this.of.delete(p.id);
        await this.log(g, `${p.name} left.`);
        this.tell(g, `${p.name} has left the guild.`);
        this.relook(p.id);
        await this.sync(g);
        await this.sync(undefined, p);
        return '';
      }
      case 'kick': {
        const r = this.need(p, 'kick');
        if (typeof r === 'string') return r;
        const t = Number.isInteger(m.id) ? r.g.members.get(m.id) : undefined;
        if (!t) return 'That player is not in your guild';
        if (t.rank <= r.rank) return 'You can only remove members of a lower rank';
        await this.repo.removeGuildMember(t.id);
        r.g.members.delete(t.id);
        this.of.delete(t.id);
        await this.log(r.g, `${t.name} was removed by ${p.name}.`);
        this.tell(r.g, `${t.name} was removed from the guild.`);
        const op = this.w.online.get(t.id);
        if (op) {
          this.w.send(op, { t: 'sys', text: `You were removed from ${r.g.name}.`, cue: 'guild' });
          await this.sync(undefined, op);
        }
        this.relook(t.id);
        await this.sync(r.g);
        return '';
      }
      case 'rank': {
        const r = this.need(p, 'ranks');
        if (typeof r === 'string') return r;
        const t = Number.isInteger(m.id) ? r.g.members.get(m.id) : undefined, rank = m.rank;
        if (!t || t.id === p.id) return 'Choose another member of your guild';
        if (!Number.isInteger(rank) || rank < 1 || rank >= GUILD_RANKS.length) return 'Unknown rank';
        await this.repo.setGuildRank(t.id, rank);
        t.rank = rank;
        await this.log(r.g, `${p.name} made ${t.name} ${GUILD_RANKS[rank]}.`);
        await this.sync(r.g);
        return '';
      }
      case 'transfer': {
        const g = this.guildOf(p);
        if (!g || g.leader !== p.id) return 'Only the guild leader can hand over the guild';
        const t = Number.isInteger(m.id) ? g.members.get(m.id) : undefined;
        if (!t || t.id === p.id) return 'Choose another member of your guild';
        await this.repo.transferGuild(g.id, p.id, t.id);
        g.members.get(p.id)!.rank = 1;
        t.rank = 0;
        g.leader = t.id;
        await this.log(g, `${p.name} handed the leadership to ${t.name}.`);
        this.tell(g, `${t.name} now leads the guild.`);
        await this.sync(g);
        return '';
      }
      case 'motd': {
        const r = this.need(p, 'motd');
        if (typeof r === 'string') return r;
        const text = typeof m.text === 'string' ? m.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, GUILD_MOTD_MAX) : '';
        await this.repo.setGuildMotd(r.g.id, text);
        r.g.motd = text;
        await this.log(r.g, `${p.name} changed the guild message.`);
        await this.sync(r.g);
        return '';
      }
      case 'deposit':
      case 'withdraw': {
        const g = this.guildOf(p);
        if (!g) return 'You are not in a guild';
        const n = m.gold;
        if (!Number.isInteger(n) || n <= 0 || n > 1e9) return 'Invalid amount of gold';
        if (m.op === 'withdraw' && !can(g.members.get(p.id)!.rank, 'bank')) return 'Only officers and the leader can withdraw';
        if (m.op === 'deposit' && p.gold < n) return 'You do not have that much gold';
        if (m.op === 'withdraw' && g.bank < n) return 'The guild bank does not hold that much';
        const delta = m.op === 'deposit' ? n : -n;
        p.gold -= delta;
        try {
          g.bank = await this.repo.guildBank(g.id, delta, this.w.snapshot(p));
        } catch (e) {
          p.gold += delta;
          return 'The guild bank does not hold that much';
        }
        p.invDirty = false;
        await this.log(g, m.op === 'deposit' ? `${p.name} deposited ${n} gold.` : `${p.name} withdrew ${n} gold.`);
        sendInv(this.w, p);
        await this.sync(g);
        return '';
      }
      case 'disband': {
        const g = this.guildOf(p);
        if (!g || g.leader !== p.id) return 'Only the guild leader can disband the guild';
        if (m.confirm !== g.name) return `To disband, confirm with the guild's exact name: ${g.name}`;
        if (g.bank > 0) return 'Withdraw the gold in the guild bank first';
        await this.repo.deleteGuild(g.id);
        this.byId.delete(g.id);
        for (const id of g.members.keys()) {
          this.of.delete(id);
          this.relook(id);
          const op = this.w.online.get(id);
          if (op) {
            this.w.send(op, { t: 'sys', text: `${g.name} has been disbanded.`, cue: 'guild' });
            await this.sync(undefined, op);
          }
        }
        return '';
      }
      case 'get': {
        await this.sync(this.guildOf(p), p);
        return '';
      }
      case 'build': {
        // the leader and officers spend guild points on buildings; every member gains at once
        const r = this.need(p, 'motd');
        if (typeof r === 'string') return r;
        const k = m.b as GuildBuilding, g = r.g;
        if (!GUILD_BUILDINGS.includes(k)) return 'Unknown building';
        if (g.buildings[k] >= GUILD_BUILDING_MAX) return 'That building is at its highest level';
        if (guildPointsLeft(g.level, g.buildings) < 1) return 'The guild has no points to spend: it earns five with each guild level';
        g.buildings[k]++;
        await this.repo.setGuildBuildings(g.id, g.buildings);
        const info = GUILD_BUILDING_INFO[k];
        this.tell(g, `${p.name} raised the ${info.name} to level ${g.buildings[k]}: +${Math.round(info.pct * g.buildings[k] * 10) / 10}% ${info.what} for every member.`);
        await this.log(g, `${p.name} raised the ${info.name} to level ${g.buildings[k]}.`);
        for (const id of g.members.keys()) this.relook(id);
        await this.sync(g);
        return '';
      }
      default:
        return 'Unknown guild command';
    }
  }

  /** The buildings of a character's guild (null without one). */
  buildingsOf(id: number): GuildBuildings | null {
    return this.byId.get(this.of.get(id) ?? 0)?.buildings ?? null;
  }
  /** The multiplier a member gets from a building: experience (barracks) or gold (treasury). */
  bonus(p: Player, k: GuildBuilding) {
    return guildBonus(this.buildingsOf(p.id), k);
  }
  /** Members' kills feed the guild: points by the kind of monster, written in batches. */
  onKill(p: Player, kind: keyof typeof GUILD_KILL_POINTS) {
    const g = this.guildOf(p);
    if (!g || g.level >= GUILD_MAX_LEVEL) return;
    g.exp += GUILD_KILL_POINTS[kind];
    g.pendingExp++;
    let up = false;
    while (g.level < GUILD_MAX_LEVEL && g.exp >= guildExpToNext(g.level)) {
      g.exp -= guildExpToNext(g.level);
      g.level++;
      up = true;
    }
    if (up) {
      this.tell(g, `The guild has reached level ${g.level}! It can now hold ${guildCapacity(g.level)} members and has ${guildPointsLeft(g.level, g.buildings)} guild points to spend on buildings.`);
      void this.log(g, `The guild reached level ${g.level}.`);
      void this.flush(g).then(() => this.sync(g));
    }
  }
  private flush(g: Guild) {
    g.pendingExp = 0;
    return this.repo.setGuildProgress(g.id, g.level, g.exp).catch((e) => console.error('guild save failed', e));
  }
  /** Called with the autosave. */
  async save() {
    await Promise.all([...this.byId.values()].filter((g) => g.pendingExp).map((g) => this.flush(g)));
  }
  /** Guild chat: to every online member. */
  chat(p: Player, text: string) {
    const g = this.guildOf(p);
    if (!g) return void this.w.send(p, { t: 'sys', text: 'You are not in a guild.' });
    const data = JSON.stringify({ t: 'chat', from: p.name, text, ch: 'guild' });
    for (const id of g.members.keys()) {
      const o = this.w.online.get(id);
      if (o) this.w.sendRaw(o, data);
    }
  }
  /** Keeps names and levels in the member list current. */
  seen(p: Player) {
    const m = this.guildOf(p)?.members.get(p.id);
    if (m) m.level = p.level;
  }
}
