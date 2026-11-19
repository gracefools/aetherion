// Region traits on the server (G4): the signature mechanic of each region past level 45
// (shared/src/traits.ts). Hooks: a monster's blow lands (onHit), a monster dies (onDeath), and a
// tick per region room (tick) for what happens over time. Delayed blows (burning ground, a dying
// monster's burst, lightning) are shown first as warning circles, like any monster area attack.
import { Act, TICK_MS } from '../../../shared/src/protocol';
import { mitigate, STATUS_INDEX } from '../../../shared/src/combat';
import { traitOf } from '../../../shared/src/traits';
import { blocked } from '../../../shared/src/world';
import { applyStatus, emit } from './entity';
import type { Monster } from './Monster';
import type { Player, World, ZoneRoom } from './World';

const ticks = (ms: number) => Math.max(1, Math.round(ms / TICK_MS));
interface Hazard {
  room: ZoneRoom;
  x: number;
  y: number;
  r: number;
  /** Tick of the first blow, then every `every` ticks until `until`. */
  at: number;
  every: number;
  until: number;
  power: number;
  magic: boolean;
  status?: number;
  src: Monster;
}

export class Traits {
  private hazards: Hazard[] = [];
  private scratch: Player[] = [];
  constructor(private w: World) {}

  /** The blow a monster deals, before defence. */
  private power(m: Monster) {
    return m.def.atk * m.atkScale;
  }
  private warn(m: Monster, x: number, y: number, r: number, ms: number) {
    emit(m, this.w.tick, [m.id, Act.Telegraph, Math.round(x), Math.round(y), r, ms]);
  }
  private hazard(h: Omit<Hazard, 'until' | 'every'> & { every?: number; until?: number }) {
    this.hazards.push({ every: 0, until: h.at, ...h });
  }

  /** A monster's blow landed on a player. */
  onHit(m: Monster, p: Player, dealt: number) {
    const t = traitOf(m.room.zoneId);
    if (!t || p.dead) return;
    const tick = this.w.tick, r = this.w.rnd();
    if (t.id === 'thorns' && r < 0.2) applyStatus(p, STATUS_INDEX.root, tick, 0, m.id);
    else if (t.id === 'chill' && r < 0.35) applyStatus(p, STATUS_INDEX.slow, tick, 0, m.id);
    else if (t.id === 'static' && r < 0.5) {
      // the blow arcs to another player standing close
      this.scratch.length = 0;
      this.w.playersWithin(m.room, p.x, p.y, 110, this.scratch);
      const other = this.scratch.find((o) => o !== p && !o.dead);
      if (other) {
        this.w.hurt(other, Math.max(1, Math.round(mitigate(dealt * 0.6, other.stats.mdef * other.mods.def))), 0, m);
        applyStatus(other, STATUS_INDEX.shock, tick, 0, m.id);
      }
    }
  }

  /** A monster died (rewards are already given). */
  onDeath(m: Monster) {
    const t = traitOf(m.room.zoneId);
    if (!t || m.summoner) return;
    const tick = this.w.tick, power = this.power(m);
    if (t.id === 'embers') {
      // a patch of fire: three pulses over two seconds, after a short warning
      this.warn(m, m.x, m.y, 56, 500);
      this.hazard({ room: m.room, x: m.x, y: m.y, r: 56, at: tick + ticks(500), every: ticks(700), until: tick + ticks(2400), power: power * 0.35, magic: true, status: STATUS_INDEX.burn, src: m });
    } else if (t.id === 'volatile') {
      this.warn(m, m.x, m.y, 74, 900);
      this.hazard({ room: m.room, x: m.x, y: m.y, r: 74, at: tick + ticks(900), power: power * 1.2, magic: false, src: m });
    } else if (t.id === 'restless' && !m.risen && this.w.rnd() < 0.35) {
      // rises again a moment later, at a third of its health (only once)
      m.riseAt = tick + ticks(1000);
    }
  }

  /** Once per tick for every region room with players in it. */
  tick(room: ZoneRoom) {
    const t = traitOf(room.zoneId), tick = this.w.tick;
    if (t) {
      for (const m of room.monsters.values()) {
        if (m.riseAt && tick >= m.riseAt) this.rise(m);
        if (m.dead || m.state === 'idle' || m.state === 'return') continue;
        // staggered per monster so the work is spread over ticks
        const slot = (tick + m.id) % 20 === 0;
        if (t.id === 'phase' && slot) this.blink(m);
        else if (t.id === 'formation' && slot) this.rally(m, room);
        else if (t.id === 'regrowth' && (tick + m.id) % 60 === 0) this.regrow(m, room);
        else if (t.id === 'null' && (tick + m.id) % 180 === 0 && this.w.rnd() < 0.5) applyStatus(m, STATUS_INDEX.null_phase, tick, 0, m.id);
        else if (t.id === 'static' && (tick + m.id) % 120 === 0) this.strike(m, room);
      }
    }
    // pending blows in this room
    if (!this.hazards.length) return;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.room !== room || tick < h.at) continue;
      this.scratch.length = 0;
      this.w.playersWithin(room, h.x, h.y, h.r, this.scratch);
      for (const p of this.scratch) {
        if (p.dead) continue;
        this.w.hurt(p, Math.max(1, Math.round(mitigate(h.power * (0.9 + this.w.rnd() * 0.2), (h.magic ? p.stats.mdef : p.stats.def) * p.mods.def))), 0, h.src);
        if (h.status !== undefined) applyStatus(p, h.status, tick, h.power, h.src.id);
      }
      if (h.every && h.at + h.every <= h.until) h.at += h.every;
      else this.hazards.splice(i, 1);
    }
  }
  /** Drops pending blows of a room that emptied. */
  clear(room: ZoneRoom) {
    this.hazards = this.hazards.filter((h) => h.room !== room);
  }

  private target(m: Monster) {
    let best: Player | null = null, top = -1;
    for (const [id, th] of m.threat) {
      const p = m.room.players.get(id);
      if (p && !p.dead && th > top) { top = th; best = p; }
    }
    return best;
  }
  /** Phase Step: a monster whose target keeps its distance appears beside it. */
  private blink(m: Monster) {
    const p = this.target(m);
    if (!p || Math.hypot(p.x - m.x, p.y - m.y) < 150 || this.w.rnd() < 0.5) return;
    const a = Math.atan2(m.y - p.y, m.x - p.x), x = p.x + Math.cos(a) * 34, y = p.y + Math.sin(a) * 34;
    if (blocked(m.room.map, x, y)) return;
    this.warn(m, x, y, 22, 300);
    m.x = x;
    m.y = y;
    m.ver++;
    m.room.grid.update(m);
  }
  /** Banner Line: monsters with two allies close by rally. */
  private rally(m: Monster, room: ZoneRoom) {
    let n = 0;
    for (const o of room.monsters.values()) if (o !== m && !o.dead && Math.hypot(o.x - m.x, o.y - m.y) < 130 && ++n >= 2) break;
    if (n >= 2) applyStatus(m, STATUS_INDEX.rally, this.w.tick, 0, m.id);
  }
  /** Regrowth: a fighting monster heals the others near it. */
  private regrow(m: Monster, room: ZoneRoom) {
    for (const o of room.monsters.values()) {
      if (o === m || o.dead || o.hp >= o.maxHp || Math.hypot(o.x - m.x, o.y - m.y) > 150) continue;
      o.hp = Math.min(o.maxHp, o.hp + Math.ceil(o.maxHp * 0.05));
      o.sver++;
    }
  }
  /** Static: lightning marks the ground under a player in the fight, then strikes. */
  private strike(m: Monster, room: ZoneRoom) {
    const p = this.target(m);
    if (!p) return;
    this.warn(m, p.x, p.y, 46, 1100);
    this.hazard({ room, x: p.x, y: p.y, r: 46, at: this.w.tick + ticks(1100), power: this.power(m) * 0.9, magic: true, status: STATUS_INDEX.shock, src: m });
  }
  /** Restless Dead: the monster gets back up where it fell. */
  private rise(m: Monster) {
    m.riseAt = 0;
    if (!m.dead || !m.inGrid) return;
    m.risen = true;
    m.dead = false;
    m.state = 'idle';
    m.hp = Math.ceil(m.maxHp * 0.33);
    m.respawnTick = Infinity;
    m.ver++;
    m.sver++;
    m.room.grid.update(m);
  }
}
