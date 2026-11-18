// Guild territory war and faction conquest on the server.
import {
  bannerOf, conquestWeek, FACTION_EXP, followed, SIEGE_CAP, SIEGE_DEFENDER, SIEGE_LEVEL, SIEGE_RADIUS, siegeAt, TERRITORIES, TERRITORY_EXP,
  type SiegeState, type TerritoryState,
} from '../../../shared/src/conquest';
import { TILE } from '../../../shared/src/protocol';
import { ZONES } from '../../../shared/src/world';
import type { Repo } from '../db/repo';
import type { Player, World } from './World';

export class Conquest {
  /** zone -> holding guild id */
  readonly holders = new Map<string, number>();
  /** The siege running now, with points per guild. */
  siege: { zone: string; end: number; points: Map<number, number> } | null = null;
  /** This week's faction points: zone -> faction -> points. */
  readonly faction = new Map<string, Map<string, number>>();
  week = conquestWeek(Date.now());
  private dirtyFaction = new Set<string>();
  private lastFlush = 0;
  private last = '';
  constructor(private w: World, private repo: Repo) {}

  async load() {
    try {
      for (const r of await this.repo.loadTerritories()) if (TERRITORIES.includes(r.zone)) this.holders.set(r.zone, r.guild_id);
      for (const r of await this.repo.loadFactionPoints(this.week)) {
        if (!this.faction.has(r.zone)) this.faction.set(r.zone, new Map());
        this.faction.get(r.zone)!.set(r.faction, r.points);
      }
    } catch (e) {
      console.error('conquest load failed', e);
    }
  }

  // ---------- what a player gets ----------
  /** The guild holding a region (0 none). */
  holderOf(zone: string) {
    const id = this.holders.get(zone) ?? 0;
    return this.w.guilds.byId.has(id) ? id : 0;
  }
  /** The faction controlling a region this week ('' none). */
  controllerOf(zone: string) {
    let best = '', v = 0;
    for (const [f, n] of this.faction.get(zone) ?? []) if (n > v) [best, v] = [f, n];
    return best;
  }
  /** Extra experience from kills: the holder guild's members and the controlling faction's followers. */
  expBonus(p: Player): number {
    const z = p.room.zoneId;
    let k = 1;
    const g = this.w.guilds.of.get(p.id);
    if (g && g === this.holderOf(z)) k += TERRITORY_EXP;
    const f = this.controllerOf(z);
    if (f && followed(p.rep) === f) k += FACTION_EXP;
    return k;
  }

  // ---------- events ----------
  /** A monster was defeated: a point for the killer's faction in that region. */
  onKill(p: Player) {
    const z = p.room.zoneId, f = followed(p.rep);
    if (!f || !TERRITORIES.includes(z) && z !== 'eldoria') return;
    if (!this.faction.has(z)) this.faction.set(z, new Map());
    const m = this.faction.get(z)!;
    m.set(f, (m.get(f) ?? 0) + 1);
    this.dirtyFaction.add(z);
  }

  // ---------- the clock ----------
  tick(now: number) {
    const wk = conquestWeek(now);
    if (wk !== this.week) {
      this.week = wk;
      this.faction.clear();
    }
    const s = siegeAt(now);
    if (this.w.opts.events === false) s.open = false; // test worlds: no clock-driven sieges
    if (s.open && (!this.siege || this.siege.zone !== s.zone)) {
      this.siege = { zone: s.zone, end: s.end, points: new Map() };
      this.w.announceAll(`A siege begins at ${ZONES[s.zone].town!.name} in ${ZONES[s.zone].name}! Guilds, gather at the village banner.`, 'worldboss');
    }
    if (this.siege) {
      if (now >= this.siege.end) this.endSiege();
      else this.score();
    }
    this.broadcast();
    if (now - this.lastFlush > 60_000) {
      this.lastFlush = now;
      void this.flush();
    }
  }
  /** Each second of a siege: every guild's members at the banner add to its points. */
  private score() {
    const s = this.siege!, b = bannerOf(s.zone)!, holder = this.holderOf(s.zone);
    const present = new Map<number, number>();
    for (const room of this.w.openRooms()) {
      if (room.zoneId !== s.zone) continue;
      for (const p of room.players.values()) {
        const g = this.w.guilds.of.get(p.id);
        if (!g || p.dead || p.level < SIEGE_LEVEL) continue;
        if (Math.hypot(p.x / TILE - b.tx, p.y / TILE - b.ty) > SIEGE_RADIUS) continue;
        present.set(g, Math.min(SIEGE_CAP, (present.get(g) ?? 0) + 1));
      }
    }
    for (const [g, n] of present) s.points.set(g, (s.points.get(g) ?? 0) + n * (g === holder ? SIEGE_DEFENDER : 1));
  }
  /** Ends a siege: the guild with the most points holds the village (or the holder keeps it). */
  endSiege() {
    const s = this.siege!;
    this.siege = null;
    let best = 0, v = 0;
    for (const [g, n] of s.points) if (n > v && this.w.guilds.byId.has(g)) [best, v] = [g, n];
    const z = ZONES[s.zone], town = z.town!.name;
    if (!best) {
      this.w.announceAll(`The siege of ${town} ends with no guild at the banner.`, 'phase');
      return;
    }
    const g = this.w.guilds.byId.get(best)!, kept = this.holderOf(s.zone) === best;
    this.holders.set(s.zone, best);
    void this.repo.saveTerritory(s.zone, best).catch((e) => console.error('territory save failed', e));
    this.w.announceAll(kept ? `[${g.tag}] ${g.name} holds ${town} in ${z.name}.` : `[${g.tag}] ${g.name} has taken ${town} in ${z.name}!`, 'bossdown');
  }
  /** Siege state to everyone (only when it changed). */
  private broadcast() {
    const st = this.siegeState(), json = JSON.stringify(st);
    if (json === this.last) return;
    this.last = json;
    for (const p of this.w.online.values()) this.w.send(p, { t: 'siege', siege: st });
  }
  siegeState(): SiegeState | null {
    const s = this.siege;
    if (!s) return null;
    const scores = [...s.points].map(([g, n]) => ({ guild: g, tag: this.w.guilds.byId.get(g)?.tag ?? '?', points: Math.floor(n) })).sort((a, b) => b.points - a.points).slice(0, 5);
    const h = this.w.guilds.byId.get(this.holderOf(s.zone));
    return { zone: s.zone, end: s.end, scores, holder: h ? h.tag : '' };
  }
  /** Who holds what and which faction controls each region (for the world map). */
  territories(): { held: TerritoryState[]; factions: Record<string, string> } {
    const held: TerritoryState[] = [];
    for (const z of TERRITORIES) {
      const g = this.w.guilds.byId.get(this.holderOf(z));
      if (g) held.push({ zone: z, guild: g.id, tag: g.tag, name: g.name });
    }
    const factions: Record<string, string> = {};
    for (const z of [...TERRITORIES, 'eldoria']) {
      const f = this.controllerOf(z);
      if (f) factions[z] = f;
    }
    return { held, factions };
  }
  sendTo(p: Player) {
    this.w.send(p, { t: 'territory', ...this.territories() });
    this.w.send(p, { t: 'siege', siege: this.siegeState() });
  }
  async flush() {
    const zones = [...this.dirtyFaction];
    this.dirtyFaction.clear();
    for (const z of zones)
      for (const [f, n] of this.faction.get(z) ?? []) await this.repo.saveFactionPoints(this.week, z, f, n).catch((e) => console.error('faction points save failed', e));
  }
}
