// Player versus player (M15): open-world combat where the zone allows it, agreed duels, the
// arena, records and rankings, and the rules that keep it fair. All damage is computed here.
import { Dmg, missChance, mitigate, STATUS_INDEX } from '../../../shared/src/combat';
import { JOB_DEFS } from '../../../shared/src/jobs';
import { RAGE_PER_HIT } from '../../../shared/src/combat';
import {
  ARENA_GOLD, ARENA_HONOR, ARENA_SPAWN, ARENA_ZONE, DUEL_COUNTDOWN_MS, DUEL_LEASH, DUEL_MAX_MS, DUEL_RANGE, HONOR_PER_KILL, PVP_DAMAGE, PVP_REPEAT_MS,
  PVP_RESPAWN_SHIELD_MS, pvpBlock, pvpRule, ratingDelta, type PvpView,
} from '../../../shared/src/pvp';
import { TICK_MS } from '../../../shared/src/protocol';
import { BOUNTY_HONOR, BOUNTY_STREAK, PVP_TAG_MS } from '../../../shared/src/depths';
import { objNear } from '../../../shared/src/places';
import { tileCenter, ZONES } from '../../../shared/src/world';
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import type { Repo } from '../db/repo';
import { clearStatuses } from './entity';
import type { Player, World } from './World';
import { ZoneRoom } from './World';
import { HONOR_SHOP } from '../../../shared/src/pvp';
import { INTERACT_RANGE } from '../../../shared/src/places';
import { ITEMS } from '../../../shared/src/items';
import { give, sendInv } from './Inventory';

interface Duel {
  a: Player;
  b: Player;
  startsAt: number;
  endsAt: number;
}

export class Pvp {
  private duels = new Map<number, Duel>();
  private requests = new Map<number, { from: number; until: number }>();
  /** The arena: one room on a dungeon map, with no monsters. */
  private arena: ZoneRoom | null = null;
  /** attacker id -> victim id -> last rewarded kill time */
  private recent = new Map<number, Map<number, number>>();
  /** In-memory copy of each online player's rating (the database holds the record). */
  rating = new Map<number, number>();
  constructor(private w: World, private repo: Repo) {}

  isArena(room: ZoneRoom) {
    return room === this.arena;
  }
  view(p: Player, now: number): PvpView {
    const d = this.duels.get(p.id);
    return { id: p.id, level: p.level, x: p.x, y: p.y, party: p.party ? p.party.id : 0, shieldUntil: p.pvpShieldUntil, guild: p.gtag, tagUntil: p.pvpTagUntil, duel: d && now >= d.startsAt ? (d.a === p ? d.b.id : d.a.id) : 0 };
  }
  /** Why `a` may not attack `b` ('' if it may). */
  block(a: Player, b: Player): string {
    if (b.dead || a.dead) return 'Not a valid target';
    if (a.room !== b.room) return 'Not a valid target';
    const now = Date.now();
    return pvpBlock(this.view(a, now), this.view(b, now), a.room.zoneId, this.isArena(a.room), now);
  }

  /** One weapon or spell hit from a player on a player. */
  strike(a: Player, v: Player, mul: number, magic: boolean, critAdd = 0, basic = true): number {
    const w = this.w;
    if (w.rnd() * 100 < missChance(a.level, v.level) + v.stats.dodge) {
      w.pushMiss(v, a);
      return 0;
    }
    const s = a.stats, power = (magic ? s.matk : s.atk) * a.mods.atk, def = (magic ? v.stats.mdef : v.stats.def) * v.mods.def;
    let dmg = mitigate(power * mul * (0.9 + w.rnd() * 0.2), def) * PVP_DAMAGE, flags = 0;
    if (w.rnd() * 100 < s.crit + critAdd) {
      dmg *= s.critDmg;
      flags |= Dmg.Crit;
    }
    if (!magic && v.rule.block && w.rnd() * 100 < v.rule.block) {
      dmg *= 0.5;
      flags |= Dmg.Block;
    }
    const dealt = Math.max(1, Math.round(dmg));
    w.hurt(v, dealt, flags, a);
    const ls = s.lifesteal + a.mods.lifesteal;
    if (ls > 0) w.heal(a, Math.max(1, Math.round((dealt * ls) / 100)));
    if (basic && JOB_DEFS[a.job].resource === 'rage') {
      a.res = Math.min(s.maxRes, Math.round(a.res + RAGE_PER_HIT * (a.rule.rageMul ?? 1)));
      a.selfDirty = true;
    }
    return dealt;
  }

  /**
   * A player struck another player in the open (not in the arena or their duel): the striker gives
   * up any protection, and for a while finds no shelter in a sanctuary and no way out by a portal.
   */
  onHit(a: Player, v: Player) {
    if (this.isArena(a.room)) return;
    const d = this.duels.get(a.id);
    if (d && (d.a === v || d.b === v)) return;
    a.pvpShieldUntil = 0;
    a.pvpTagUntil = Date.now() + PVP_TAG_MS;
  }
  /**
   * Called by World.hurt before damage from a player lands on a player. Returns the damage that
   * may actually be dealt: a duel ends at 1 HP instead of killing.
   */
  limit(src: Player, v: Player, amount: number): number {
    const d = this.duels.get(v.id);
    if (d && (d.a === src || d.b === src) && amount >= v.hp) {
      this.endDuel(d, src, 'won');
      return Math.max(0, v.hp - 1);
    }
    return amount;
  }
  /** A player was killed by another player (open world or arena). */
  onKill(k: Player, v: Player) {
    const now = Date.now(), arena = this.isArena(v.room);
    v.pvpShieldUntil = now + (arena ? 3000 : PVP_RESPAWN_SHIELD_MS);
    const last = this.recent.get(k.id)?.get(v.id) ?? 0, repeat = now - last < PVP_REPEAT_MS;
    if (!this.recent.has(k.id)) this.recent.set(k.id, new Map());
    this.recent.get(k.id)!.set(v.id, now);
    const delta = repeat ? 0 : ratingDelta(this.rating.get(k.id) ?? 1000, this.rating.get(v.id) ?? 1000);
    const honor = repeat ? 0 : arena ? ARENA_HONOR : HONOR_PER_KILL;
    this.bump(k, arena ? { arena_kills: 1, honor, rating: delta } : { kills: 1, honor, rating: delta });
    if (!arena && !repeat) this.w.journals.add(k, 'pvp');
    this.bump(v, arena ? { arena_deaths: 1, rating: -delta } : { deaths: 1, rating: -delta });
    if (!arena && v.room.map.def.depth) {
      // the Depths: a run of kills puts a bounty on the killer; whoever ends it is paid in honour
      if (v.streak >= BOUNTY_STREAK) {
        this.bump(k, { honor: BOUNTY_HONOR });
        this.w.announce(v.room, `${k.name} has ended the rampage of ${v.name} and claims the bounty: +${BOUNTY_HONOR} honour.`, 'pvp');
      }
      v.streak = 0;
      if (!repeat && ++k.streak === BOUNTY_STREAK) this.w.announce(k.room, `${k.name} has defeated ${BOUNTY_STREAK} players in a row. There is a bounty on them, and the map shows where they are.`, 'pvp');
    }
    if (arena && !repeat) {
      k.gold += ARENA_GOLD;
      k.invDirty = true;
      this.w.syncInv(k);
    }
    this.w.send(k, { t: 'sys', text: repeat ? `You defeated ${v.name} again. Repeated victories over the same player give no honour for ten minutes.` : `You defeated ${v.name}: +${honor} honour, rating +${delta}${arena ? `, +${ARENA_GOLD} gold` : ''}.`, cue: 'pvp' });
    this.w.send(v, { t: 'sys', text: `You were defeated by ${k.name}.${arena ? '' : ' You are protected from other players for a minute after you return.'}` });
  }
  private bump(p: Player, d: Parameters<Repo['pvpAdd']>[1]) {
    if (d.rating) this.rating.set(p.id, (this.rating.get(p.id) ?? 1000) + d.rating);
    this.repo.pvpAdd({ id: p.id, name: p.name, job: p.job }, d).catch((e) => console.error('pvp record failed', e));
  }
  async loadRating(p: Player) {
    const rows = await this.repo.pvpStats([p.id]).catch(() => []), row = Array.isArray(rows) ? rows[0] : undefined;
    this.rating.set(p.id, row ? row.rating : 1000);
  }

  // ---------- duels ----------
  op(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown command';
    const now = Date.now();
    switch (m.op) {
      case 'buy': {
        // the honour shop at the Arena Master: checked here, paid for in the database, then given
        const line = HONOR_SHOP.find(([b]) => b === m.base);
        if (!line) return 'Not sold here';
        if (!objNear(p.room.zoneId, p.x, p.y, INTERACT_RANGE * 2.2, ['arenamaster'])) return 'Visit the Arena Master';
        const [base, cost] = line, spec = { base, rar: ITEMS[base].unique?.rar ?? 0, ilvl: ITEMS[base].kind === 'equip' ? p.level : 1, aff: [], up: 0, qty: 1 };
        const trial = { inv: p.inv.map((i) => ({ ...i })) } as unknown as Player;
        if (!give(trial, spec)) return 'Inventory is full';
        void this.repo.pvpSpend(p.id, cost).then((left) => {
          if (left === null) return this.w.send(p, { t: 'sys', text: `Not enough honour: ${ITEMS[base].name} costs ${cost}.` });
          if (!give(p, spec)) return this.w.mailItems(p, `Honour: ${ITEMS[base].name}`, [spec]);
          p.invDirty = true;
          sendInv(this.w, p);
          this.w.send(p, { t: 'sys', text: `Bought ${ITEMS[base].name} for ${cost} honour.`, cue: 'loot' });
          return this.op(p, { op: 'rank' });
        }).catch((e) => console.error('honour purchase failed', e));
        return '';
      }
      case 'duel': {
        const t = Number.isInteger(m.id) ? this.w.online.get(m.id) : undefined;
        if (!t || t === p || !t.conn || t.room !== p.room) return 'That player is not here';
        if (pvpRule(p.room.zoneId) === 'safe' || this.isArena(p.room)) return 'Duels are not allowed here';
        if (this.duels.has(p.id) || this.duels.has(t.id)) return 'One of you is already in a duel';
        if (Math.hypot(t.x - p.x, t.y - p.y) > DUEL_RANGE) return 'Too far away';
        if (p.dead || t.dead) return 'Not now';
        this.requests.set(t.id, { from: p.id, until: now + 30_000 });
        this.w.send(t, { t: 'dinv', from: p.name, id: p.id, ms: 30_000 });
        this.w.send(p, { t: 'sys', text: `Duel challenge sent to ${t.name}.` });
        return '';
      }
      case 'accept': {
        const r = this.requests.get(p.id);
        this.requests.delete(p.id);
        const a = r && r.until >= now ? this.w.online.get(r.from) : undefined;
        if (!a || !a.conn || a.room !== p.room || a.dead || p.dead) return 'The challenge has expired';
        if (this.duels.has(a.id) || this.duels.has(p.id)) return 'One of you is already in a duel';
        if (Math.hypot(a.x - p.x, a.y - p.y) > DUEL_RANGE) return 'Too far away';
        const d: Duel = { a, b: p, startsAt: now + DUEL_COUNTDOWN_MS, endsAt: now + DUEL_COUNTDOWN_MS + DUEL_MAX_MS };
        this.duels.set(a.id, d);
        this.duels.set(p.id, d);
        for (const x of [a, p]) this.w.send(x, { t: 'duel', with: x === a ? p.name : a.name, id: x === a ? p.id : a.id, starts: DUEL_COUNTDOWN_MS, ends: DUEL_COUNTDOWN_MS + DUEL_MAX_MS });
        return '';
      }
      case 'decline': {
        const r = this.requests.get(p.id);
        this.requests.delete(p.id);
        const a = r ? this.w.online.get(r.from) : undefined;
        if (a) this.w.send(a, { t: 'sys', text: `${p.name} declined the duel.` });
        return '';
      }
      case 'forfeit': {
        const d = this.duels.get(p.id);
        if (!d) return 'You are not in a duel';
        this.endDuel(d, d.a === p ? d.b : d.a, 'forfeit');
        return '';
      }
      case 'arena': return this.enterArena(p);
      case 'leave': return this.leaveArena(p);
      case 'rank': {
        void this.repo.pvpRankings(m.by === 'kills' || m.by === 'duels_won' || m.by === 'arena_kills' ? m.by : 'rating').then((rows) => this.repo.pvpStats([p.id]).then(([me]) => this.w.send(p, { t: 'pvprank', rows, me: me ?? null })));
        return '';
      }
      default: return 'Unknown command';
    }
  }
  private endDuel(d: Duel, winner: Player | null, how: 'won' | 'forfeit' | 'draw' | 'left') {
    this.duels.delete(d.a.id);
    this.duels.delete(d.b.id);
    for (const x of [d.a, d.b]) {
      // whatever the duel left behind (poisons, burns, slows) ends with it
      clearStatuses(x);
      x.sver++;
      x.pvpTarget = null;
      x.selfDirty = true;
    }
    if (!winner || how === 'draw' || how === 'left') {
      for (const x of [d.a, d.b]) this.w.send(x, { t: 'duel', with: '', id: 0, starts: 0, ends: 0, result: how === 'left' ? 'The duel ended: you moved too far apart.' : 'The duel ended in a draw.' });
      return;
    }
    const loser = winner === d.a ? d.b : d.a, delta = ratingDelta(this.rating.get(winner.id) ?? 1000, this.rating.get(loser.id) ?? 1000);
    this.bump(winner, { duels_won: 1, rating: delta });
    this.bump(loser, { duels_lost: 1, rating: -delta });
    this.w.announce(winner.room, `${winner.name} has defeated ${loser.name} in a duel${how === 'forfeit' ? ' (forfeit)' : ''}.`, 'pvp');
    for (const x of [d.a, d.b]) this.w.send(x, { t: 'duel', with: '', id: 0, starts: 0, ends: 0, result: x === winner ? `You won the duel (rating +${delta}).` : `You lost the duel (rating -${delta}).` });
    this.w.journals.add(winner, 'duel');
  }
  /** Ends a player's duel when they die to something else, leave or disconnect. */
  drop(p: Player) {
    const d = this.duels.get(p.id);
    if (d) this.endDuel(d, d.a === p ? d.b : d.a, 'forfeit');
    this.requests.delete(p.id);
  }
  tick(now: number) {
    for (const d of new Set(this.duels.values())) {
      if (d.a.room !== d.b.room || !d.a.conn || !d.b.conn) this.endDuel(d, null, 'left');
      else if (Math.hypot(d.a.x - d.b.x, d.a.y - d.b.y) > DUEL_LEASH) this.endDuel(d, null, 'left');
      else if (now >= d.endsAt) this.endDuel(d, null, 'draw');
    }
    for (const [id, r] of this.requests) if (r.until < now) this.requests.delete(id);
  }

  // ---------- arena ----------
  private room(): ZoneRoom {
    if (!this.arena) {
      this.arena = new ZoneRoom(ARENA_ZONE, 900_000); // its own channel number: never matched with a dungeon run
      this.w.addRoom(this.arena);
    }
    return this.arena;
  }
  private enterArena(p: Player): string {
    if (p.dead) return 'You are dead';
    if (p.room.map.def.kind === 'dungeon') return 'Leave the dungeon first';
    if (!objNear(p.room.zoneId, p.x, p.y, 160, ['arenamaster'])) return 'Talk to the Arena Master to enter';
    if ((this.w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Not while in combat';
    p.ret = { zone: p.room.zoneId, x: p.x, y: p.y };
    this.w.relocate(p, this.room(), tileCenter(ARENA_SPAWN.tx) + (this.w.rnd() - 0.5) * 200, tileCenter(ARENA_SPAWN.ty) + (this.w.rnd() - 0.5) * 160);
    this.w.send(p, { t: 'ann', text: 'You enter the Arena. Every fighter is your enemy (party members fight together). Defeat costs nothing.', cue: 'pvp' });
    return '';
  }
  leaveArena(p: Player): string {
    if (!this.isArena(p.room)) return 'You are not in the arena';
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : { zone: 'eldoria', x: tileCenter(ZONES.eldoria.spawn.tx), y: tileCenter(ZONES.eldoria.spawn.ty) };
    p.ret = null;
    this.w.relocate(p, this.w.roomIn(ret.zone, p), ret.x, ret.y);
    return '';
  }
  /** Where a fallen arena fighter comes back. */
  arenaSpawn() {
    return { x: tileCenter(ARENA_SPAWN.tx) + (this.w.rnd() - 0.5) * 200, y: tileCenter(ARENA_SPAWN.ty) + (this.w.rnd() - 0.5) * 160 };
  }
}
