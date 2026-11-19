// Monster entity + AI state machine: idle/wander -> chase -> telegraphed attack (-> dash) -> leash/return.
import { Dmg, missChance, mitigate, STATUS_INDEX } from '../../../shared/src/combat';
import { patternOf, phaseAt, type MonsterAttack, type MonsterDef } from '../../../shared/src/monsters';
import { Act, Dir, Move, PLAYER_HALF, TICK_MS, TILE, type Cue, type EntityMeta } from '../../../shared/src/protocol';
import { blocked, stepMove, type ZoneMap } from '../../../shared/src/world';
import { MONSTER_TOWN_CHASE, MONSTER_TOWN_CLEAR, nearTown } from '../../../shared/src/pvp';
import { clearLine, findPath, navOf, spawnFault, tileOf, tileXY, type Nav } from '../../../shared/src/nav';
import { applyStatus, clearStatuses, emit, NO_MODS, pushDmg, tickStatuses, type Ent } from './entity';
import type { Player, ZoneRoom } from './World';

/** Services the world provides to the AI. */
export interface CombatCtx {
  tick: number;
  rnd(): number;
  hurt(target: Ent, amount: number, flags: number, src: Ent | null): void;
  nearestPlayer(room: ZoneRoom, x: number, y: number, r: number): Player | null;
  playersWithin(room: ZoneRoom, x: number, y: number, r: number, out: Player[]): void;
  entById(room: ZoneRoom, id: number): Ent | null;
  /** Banner + chat line for everyone in the room. */
  announce(room: ZoneRoom, text: string, cue?: Cue): void;
  /** Banner for every player online (world boss news). */
  announceAll(text: string, cue?: Cue): void;
  /** A monster's blow landed (region traits react to it). */
  traitHit(m: Monster, p: Player, dealt: number): void;
  /** Spawns helpers next to a monster; they vanish when their summoner resets or dies. */
  summon(by: Monster, type: string, count: number): void;
  dismiss(by: Monster): void;
}
export interface MonsterScale {
  hp: number;
  atk: number;
  level: number;
  exp: number;
  /** Gold and item-drop multipliers (open-PvP areas pay more gold and drop fewer items). */
  gold?: number;
  drop?: number;
  /** Lives in an open-PvP area: shown to players as fierce. */
  fierce?: boolean;
}

type State = 'idle' | 'chase' | 'windup' | 'dash' | 'return' | 'dead';
const CORPSE_TICKS = 24;
/** Path searches allowed per simulation tick, over all monsters: pathfinding can never dominate a tick. */
export const PATHS_PER_TICK = 12;
let pathTick = -1, pathsLeft = 0;
const ticks = (ms: number) => Math.ceil(ms / TICK_MS);
const q = (v: number) => Math.round(v * 100) / 100;

export class Monster implements Ent {
  readonly isPlayer = false;
  cell = 0;
  level: number;
  dir: number = Dir.Down;
  moving: number = Move.Idle;
  ver = 1;
  sver = 1;
  hp: number;
  maxHp: number;
  dead = false;
  st = [] as Ent['st'];
  mask = 0;
  mods = NO_MODS;
  lastCombat = -1000;
  evs: number[][] = [];
  evTick = -1;
  dmgs: number[][] = [];
  dmgTick = -1;
  inGrid = true;

  state: State = 'idle';
  /** Threat per player id; the highest valid entry is the target. */
  threat = new Map<number, number>();
  /** Damage dealt per player id, for EXP shares. */
  dmgBy = new Map<number, number>();
  private pat = 0;
  private nextAttack = 0;
  private windupEnd = 0;
  private aimX = 0;
  private aimY = 0;
  private aimId = 0;
  private dashTicks = 0;
  private dashIx = 0;
  private dashIy = 0;
  private stuck = 0;
  private wx = 0;
  private wy = 0;
  private nextWander = 0;
  private scratch: Player[] = [];
  private dots: number[] = [];
  respawnTick = 0;
  private removeTick = 0;
  /** Boss phase (index into def.boss.phases). */
  phase = 0;
  /** Tick the current fight started; 0 while idle. */
  engagedAt = 0;
  /** Restless Dead (region trait): rises at this tick; has already risen once this life. */
  riseAt = 0;
  risen = false;
  /** Hard enrage reached. */
  fury = false;
  atkScale = 1;
  expScale = 1;
  /** Ticks spent walking home. */
  private returning = 0;
  /** Lives in an instance (dungeon, rift, raid): no leash, no walking home while players live. */
  get instanced() {
    return this.room.map.def.kind === 'dungeon';
  }
  goldScale = 1;
  dropScale = 1;
  fierce = false;
  /** Part of a world event (counted and removed by it). */
  event = false;
  /** An invader of a village (world event): it may enter villages. */
  invader = false;
  /** A monster of the night, gone at dawn. */
  nightborn = false;
  /** Dungeon monsters and summoned helpers never come back. */
  noRespawn = false;
  /** Id of the monster that summoned this one. */
  summoner = 0;
  /** Contribution per player id: damage dealt plus half of damage soaked and healing given. */
  contrib = new Map<number, number>();
  immune = 0;
  /** World bosses: server-configurable multiplier on the respawn time. */
  respawnMul = 1;
  private aims: number[] = [];
  /** Spawn region this monster belongs to ('' for monsters placed by hand, dungeons and summons). */
  region = '';
  /** How far from its spawn point it roams while idle (world units). */
  patrolR = 96;
  // navigation: the route being followed (tile indices), and why movement last failed
  private nav: Nav | null = null;
  private path: number[] = [];
  private pathGoal = -1;
  private pathAt = 0;
  private direct = true;
  private lineAt = 0;
  /** Why the last attempt to move failed ('' = it did not). Shown in the developer overlay. */
  blockedBy = '';

  constructor(readonly id: number, readonly def: MonsterDef, readonly room: ZoneRoom, public x: number, public y: number, scale?: MonsterScale) {
    this.level = def.level + (scale?.level ?? 0);
    this.hp = this.maxHp = Math.round(def.hp * (scale?.hp ?? 1));
    this.atkScale = scale?.atk ?? 1;
    this.expScale = scale?.exp ?? 1;
    this.goldScale = scale?.gold ?? 1;
    this.dropScale = scale?.drop ?? 1;
    this.fierce = !!scale?.fierce;
    if (def.boss) this.immune = (1 << STATUS_INDEX.stun) | (1 << STATUS_INDEX.root);
    this.wx = this.spawnX = x;
    this.wy = this.spawnY = y;
  }
  spawnX: number;
  spawnY: number;

  meta(): EntityMeta {
    return { id: this.id, name: this.def.name, level: this.level, x: this.x, y: this.y, d: this.dir, hp: this.hp, mhp: this.maxHp, st: this.mask, mt: this.def.id, ...(this.fierce ? { fz: 1 } : {}), ...(this.nightborn ? { nt: 1 } : {}), ...(this.event ? { ev: 1 } : {}) };
  }
  onStatusChange() {}

  addThreat(playerId: number, amount: number) {
    if (this.dead || this.state === 'return') return;
    this.threat.set(playerId, (this.threat.get(playerId) ?? 0) + amount);
  }
  /** True while walking home: attacks against it are ignored. */
  get evading() {
    return this.state === 'return';
  }

  die(tick: number) {
    this.dead = true;
    this.state = 'dead';
    this.moving = Move.Idle;
    this.ver++;
    this.threat.clear();
    clearStatuses(this);
    this.respawnTick = this.noRespawn ? Infinity : tick + ticks(this.def.respawnMs * this.respawnMul);
    this.engagedAt = 0;
    this.removeTick = tick + CORPSE_TICKS;
  }

  update(c: CombatCtx) {
    const tick = c.tick, room = this.room, def = this.def;
    if (this.dead) {
      if (this.inGrid && tick >= this.removeTick) {
        room.grid.remove(this);
        this.inGrid = false;
      }
      if (tick >= this.respawnTick) {
        this.dead = false;
        this.state = 'idle';
        this.hp = this.maxHp;
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.dmgBy.clear();
        this.contrib.clear();
        this.phase = 0;
        this.fury = false;
        this.pat = 0;
        this.risen = false;
        this.riseAt = 0;
        if (def.boss?.world) c.announceAll(`${def.name} has returned to ${room.map.def.name}!`, 'worldboss');
        this.ver++;
        this.sver++;
        if (this.inGrid) room.grid.update(this);
        else room.grid.insert(this);
        this.inGrid = true;
      }
      return;
    }
    if (this.st.length) {
      this.dots.length = 0;
      tickStatuses(this, tick, this.dots);
      for (let i = 0; i < this.dots.length; i += 2) c.hurt(this, this.dots[i], Dmg.Dot, c.entById(room, this.dots[i + 1]));
      if (this.dead) return;
    }
    if (this.mods.stun) {
      this.setMoving(Move.Idle);
      return;
    }
    switch (this.state) {
      case 'idle': {
        if (def.aggro && (tick + this.id) % 5 === 0) {
          const p = c.nearestPlayer(room, this.x, this.y, def.aggro);
          if (p) this.aggroOn(p.id, c);
        }
        if (this.threat.size) {
          this.state = 'chase';
          this.stuck = 0;
          this.engage(c);
          break;
        }
        if (tick >= this.nextWander) {
          this.nextWander = tick + 60 + Math.floor(c.rnd() * 140);
          // patrol: a new point inside the patrol radius that can actually be stood on and walked to
          for (let tries = 0; tries < 5; tries++) {
            const a = c.rnd() * 6.283, r = Math.sqrt(c.rnd()) * this.patrolR;
            const wx = this.spawnX + Math.cos(a) * r, wy = this.spawnY + Math.sin(a) * r;
            if (spawnFault(this.navData(), wx, wy, def.flying) && !def.flying) continue;
            if (this.keepsOut() && nearTown(this.room.zoneId, wx, wy, MONSTER_TOWN_CLEAR)) continue; // never wander towards a village
            // a straight walk: a route around an obstacle could lead outside the patrol circle
            if (!def.flying && !clearLine(this.room.map, this.x, this.y, wx, wy)) continue;
            this.wx = wx;
            this.wy = wy;
            break;
          }
        }
        if (Math.abs(this.wx - this.x) > 4 || Math.abs(this.wy - this.y) > 4) {
          if (!this.travel(this.wx, this.wy, def.speed * 0.4, Move.Walk, tick)) {
            this.wx = this.x;
            this.wy = this.y;
          }
        } else this.setMoving(Move.Idle);
        break;
      }
      case 'chase': {
        const t = this.pickTarget();
        if (def.flee && t) {
          // run straight away from whoever is closest; give up the chase once far enough
          const dx = this.x - t.x, dy = this.y - t.y, d = Math.hypot(dx, dy) || 1;
          if (d > 520) {
            this.threat.clear();
            this.state = 'idle';
            this.setMoving(Move.Idle);
            break;
          }
          // straight away if the way is open; otherwise the nearest open direction to either side
          const away = Math.atan2(dy, dx) + (c.rnd() - 0.5) * 0.5;
          let fled = false;
          for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) {
            const a2 = away + turn;
            if (this.travel(this.x + Math.cos(a2) * 110, this.y + Math.sin(a2) * 110, def.speed * this.mods.move, Move.Run, tick)) { fled = true; break; }
          }
          if (!fled) this.setMoving(Move.Idle);
          break;
        }
        if (def.still) {
          this.setMoving(Move.Idle);
          if (!t) {
            this.state = 'idle';
            break;
          }
        }
        const home = Math.hypot(this.x - this.spawnX, this.y - this.spawnY);
        // inside an instance (dungeon, rift, raid) there is no leash: a monster never walks home healing while
        // someone is still fighting in the room. It resets only when nobody alive is left.
        if (this.instanced) {
          if (!t) {
            let alive = false;
            for (const p of room.players.values()) if (!p.dead) { alive = true; break; }
            if (!alive) this.goHome(c);
            else { // lost its target: stand guard here, keep its wounds, and fight again when struck or approached
              this.state = 'idle';
              this.wx = this.x; this.wy = this.y;
              this.setMoving(Move.Idle);
            }
            break;
          }
        } else
        // a village is a refuge: monsters break off before they reach it
        if (!t || home > def.leash || (this.keepsOut() && nearTown(this.room.zoneId, this.x, this.y, MONSTER_TOWN_CHASE))) {
          this.goHome(c);
          break;
        }
        if (def.boss && !this.fury && this.engagedAt && (tick - this.engagedAt) * TICK_MS >= def.boss.enrageMs) {
          this.fury = true;
          this.sver++;
          c.announce(room, `${def.name} goes berserk!`, 'phase');
        }
        const atk = this.attack();
        const d = Math.hypot(t.x - this.x, t.y - this.y);
        if (d <= atk.range + PLAYER_HALF) {
          this.face(t.x, t.y);
          this.setMoving(Move.Idle);
          this.stuck = 0;
          if (tick >= this.nextAttack) {
            this.state = 'windup';
            this.windupEnd = tick + ticks(atk.windupMs);
            this.aimX = t.x;
            this.aimY = t.y;
            this.aimId = t.id;
            this.aims.length = 0;
            if (atk.multi && atk.aoe) {
              // one warning circle under each of up to `multi` different players, the current target first
              const pool = [...this.room.players.values()].filter((p) => !p.dead && p !== t && Math.hypot(p.x - this.x, p.y - this.y) <= 520);
              const picks = [t];
              while (picks.length < atk.multi && pool.length) picks.push(pool.splice(Math.floor(c.rnd() * pool.length), 1)[0]);
              // spare circles land around the target so a solo player still has to move
              for (let i = picks.length; i < atk.multi; i++) {
                const a = c.rnd() * 6.283, r = atk.aoe * (1.2 + c.rnd() * 1.2);
                this.aims.push(Math.round(t.x + Math.cos(a) * r), Math.round(t.y + Math.sin(a) * r));
              }
              for (const p of picks) this.aims.push(Math.round(p.x), Math.round(p.y));
              for (let i = 0; i < this.aims.length; i += 2) emit(this, tick, [this.id, Act.Telegraph, this.aims[i], this.aims[i + 1], atk.aoe, atk.windupMs]);
            } else if (atk.aoe) emit(this, tick, [this.id, Act.Telegraph, Math.round(atk.self ? this.x : t.x), Math.round(atk.self ? this.y : t.y), atk.aoe, atk.windupMs, 0, atk.donut ?? 0]);
            else if (atk.charge) emit(this, tick, [this.id, Act.Telegraph, Math.round(t.x), Math.round(t.y), 18, atk.windupMs]);
          }
        } else if (this.mods.move === 0) {
          this.setMoving(Move.Idle); // rooted: hold position, do not count as stuck
        } else if (!this.travel(t.x, t.y, def.speed * this.mods.move, Move.Run, tick)) {
          // No way forward (no route, or the route is blocked): after 1.5s forget this target.
          if (++this.stuck > 30) {
            this.stuck = 0;
            if (this.instanced) {
              // never give up inside an instance: step to open ground beside the target instead
              const a = c.rnd() * 6.283, nx = t.x + Math.cos(a) * 40, ny = t.y + Math.sin(a) * 40;
              if (!blocked(this.room.map, nx, ny, def.flying)) { this.x = nx; this.y = ny; room.grid.update(this); this.ver++; }
              this.blockedBy = 'target unreachable: moved beside it';
            } else {
              this.threat.delete(t.id);
              this.blockedBy = 'target unreachable: gave up';
            }
          }
        } else this.stuck = 0;
        break;
      }
      case 'windup': {
        if (tick < this.windupEnd) break;
        const atk = this.attack();
        emit(this, tick, [this.id, Act.Attack, this.aimId]);
        if (atk.summon) {
          c.summon(this, atk.summon.type, atk.summon.count);
          this.afterAttack(tick);
          break;
        }
        if (atk.charge) {
          const dx = this.aimX - this.x, dy = this.aimY - this.y, m = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
          this.dashIx = Math.abs(dx) / m > 0.38 ? Math.sign(dx) : 0;
          this.dashIy = Math.abs(dy) / m > 0.38 ? Math.sign(dy) : 0;
          this.dashTicks = 8;
          this.state = 'dash';
          break;
        }
        const out = this.scratch;
        out.length = 0;
        if (atk.multi && atk.aoe) {
          for (let i = 0; i < this.aims.length; i += 2) c.playersWithin(room, this.aims[i], this.aims[i + 1], atk.aoe + PLAYER_HALF, out);
          for (let i = out.length - 1; i > 0; i--) if (out.indexOf(out[i]) !== i) out.splice(i, 1); // overlapping circles hit once
        } else if (atk.aoe) {
          c.playersWithin(room, atk.self ? this.x : this.aimX, atk.self ? this.y : this.aimY, atk.aoe + PLAYER_HALF, out);
          if (atk.donut) for (let i = out.length - 1; i >= 0; i--) if (Math.hypot(out[i].x - this.x, out[i].y - this.y) < atk.donut) out.splice(i, 1); // safe next to the monster
        }
        else {
          const t = room.players.get(this.aimId);
          if (t && !t.dead) {
            const reach = (atk.ranged ? atk.range * 1.4 : atk.range + 22) + PLAYER_HALF;
            if (Math.hypot(t.x - this.x, t.y - this.y) <= reach) out.push(t);
            else pushDmg(t, tick, 0, Dmg.Miss, this.id); // dodged by moving away
          }
        }
        for (const p of out) this.hit(p, atk, c);
        this.afterAttack(tick);
        break;
      }
      case 'dash': {
        const step = q(def.speed * 3.2 * (TICK_MS / 1000));
        const ox = this.x, oy = this.y;
        stepMove(this, this.dashIx, this.dashIy, room.map, step);
        if (this.x !== ox || this.y !== oy) {
          this.face(this.x + this.dashIx, this.y + this.dashIy);
          this.moving = Move.Run;
          this.ver++;
          room.grid.update(this);
        } else this.dashTicks = 0;
        const out = this.scratch;
        out.length = 0;
        c.playersWithin(room, this.x, this.y, def.radius + PLAYER_HALF + 4, out);
        if (out.length) {
          this.hit(out[0], this.attack(), c);
          this.dashTicks = 0;
        }
        if (--this.dashTicks <= 0) this.afterAttack(tick);
        break;
      }
      case 'return': {
        const near = Math.hypot(this.x - this.spawnX, this.y - this.spawnY) < 6;
        const moved = !near && this.travel(this.spawnX, this.spawnY, def.speed * 1.4, Move.Run, tick);
        // the walk home is bounded: after eight seconds the monster is simply put back
        if (near || (!moved && ++this.stuck > 40) || ++this.returning > 160) {
          this.returning = 0;
          this.x = this.spawnX; // never strand a monster away from its camp
          this.y = this.spawnY;
          room.grid.update(this);
          this.hp = this.maxHp;
          this.sver++;
          this.ver++;
          this.state = 'idle';
          this.moving = Move.Idle;
        } else {
          if (moved) this.stuck = 0;
          if (this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + Math.ceil(this.maxHp * 0.05));
            this.sver++;
          }
        }
        break;
      }
    }
  }

  private aggroOn(playerId: number, c: CombatCtx) {
    this.addThreat(playerId, 1);
    if (!this.def.pack) return;
    for (const m of this.room.monsters.values())
      if (m !== this && m.def.id === this.def.id && !m.dead && m.state === 'idle' && Math.hypot(m.x - this.x, m.y - this.y) < 170) m.addThreat(playerId, 1);
  }
  /** Called by the world when a player damages this monster. */
  onDamaged(playerId: number, amount: number, c: CombatCtx) {
    this.dmgBy.set(playerId, (this.dmgBy.get(playerId) ?? 0) + amount);
    this.contrib.set(playerId, (this.contrib.get(playerId) ?? 0) + amount);
    const first = this.threat.size === 0;
    this.addThreat(playerId, amount + 1);
    this.engage(c);
    this.checkPhase(c);
    if (first && this.def.pack) this.aggroOn(playerId, c);
    if (this.def.enrageAt && !this.dead && this.hp / this.maxHp < this.def.enrageAt && !(this.mask & (1 << STATUS_INDEX.enrage)))
      applyStatus(this, STATUS_INDEX.enrage, c.tick, this.def.atk, this.id);
  }

  private pickTarget(): Player | null {
    let best: Player | null = null, top = -1;
    for (const [id, th] of this.threat) {
      const p = this.room.players.get(id);
      if (!p || p.dead || p.mods.stealth) {
        this.threat.delete(id);
        continue;
      }
      if (th > top) {
        top = th;
        best = p;
      }
    }
    return best;
  }
  /** Marks the start of a fight (first threat or first damage). */
  private engage(c: CombatCtx) {
    if (this.engagedAt || this.dead || this.state === 'return') return;
    this.engagedAt = Math.max(1, c.tick);
    if (this.def.boss) c.announce(this.room, this.def.boss.intro, 'boss');
  }
  /** The attack the monster will use next. */
  private attack(): MonsterAttack {
    const p = patternOf(this.def, this.phase);
    return p[this.pat % p.length];
  }
  /** Bosses change phase as their health falls; each phase has its own attack pattern. */
  private checkPhase(c: CombatCtx) {
    const b = this.def.boss;
    if (!b || this.dead) return;
    const ph = phaseAt(this.def, this.hp / this.maxHp);
    if (ph <= this.phase) return;
    this.phase = ph;
    this.pat = 0;
    this.sver++;
    // a short pause between phases; an attack already winding up is abandoned
    if (this.state === 'windup' || this.state === 'dash') this.state = 'chase';
    this.nextAttack = c.tick + ticks(1500);
    if (b.phases[ph].say) c.announce(this.room, b.phases[ph].say, 'phase');
  }
  /** Support (healing fighters, soaking the monster's hits) counts toward contribution at half value. */
  credit(playerId: number, amount: number) {
    if (!this.dead && this.engagedAt) this.contrib.set(playerId, (this.contrib.get(playerId) ?? 0) + amount * 0.5);
  }
  private outside?: boolean;
  /** A monster whose camp lies outside a village keeps out of it (bosses and summons excepted). */
  private keepsOut(): boolean {
    return (this.outside ??= !this.def.boss && !this.invader && !nearTown(this.room.zoneId, this.spawnX, this.spawnY, MONSTER_TOWN_CLEAR));
  }
  private goHome(c?: CombatCtx) {
    this.threat.clear();
    this.state = 'return';
    this.stuck = 0;
    this.returning = 0;
    clearStatuses(this);
    // a boss that loses its targets starts over: full fight, no partial progress
    this.engagedAt = 0;
    this.fury = false;
    this.contrib.clear();
    this.dmgBy.clear();
    if (this.def.boss) {
      this.phase = 0;
      this.pat = 0;
      c?.dismiss(this);
      c?.announce(this.room, `${this.def.name} returns to its place, restored.`);
    }
  }
  private afterAttack(tick: number) {
    this.pat++;
    this.nextAttack = tick + ticks(this.def.intervalMs * this.mods.interval * (this.def.boss?.phases[this.phase].interval ?? 1));
    this.state = this.threat.size ? 'chase' : 'idle';
    this.setMoving(Move.Idle);
  }

  private hit(p: Player, atk: MonsterAttack, c: CombatCtx) {
    if (p.dead) return;
    if (c.rnd() * 100 < missChance(this.level, p.level) + p.stats.dodge) return void pushDmg(p, c.tick, 0, Dmg.Miss, this.id);
    const power = this.def.atk * this.atkScale * this.mods.atk * (this.def.boss?.phases[this.phase].atk ?? 1) * (this.fury ? 3 : 1);
    let dmg = mitigate(power * atk.mul * (0.9 + c.rnd() * 0.2), (atk.magic ? p.stats.mdef : p.stats.def) * p.mods.def);
    let flags = 0;
    if (!atk.magic && p.rule.block && c.rnd() * 100 < p.rule.block) {
      dmg *= 0.5;
      flags |= Dmg.Block;
      // Knight passive (level 25): a block empowers the next strike.
      if (p.job === 'knight' && p.level >= 25) applyStatus(p, STATUS_INDEX.retribution, c.tick, 0, p.id);
    }
    const dealt = Math.max(1, Math.round(dmg));
    c.hurt(p, dealt, flags, this);
    c.traitHit(this, p, dealt);
    // Thorns (unique passive): melee attackers take part of the blow back.
    if (!atk.ranged && !atk.magic && p.passives.includes('thorns') && !this.dead) c.hurt(this, Math.max(1, Math.round(dealt * 0.2)), 0, p);
    if (atk.status && !p.dead && c.rnd() * 100 < atk.status.chance) applyStatus(p, STATUS_INDEX[atk.status.id], c.tick, power, this.id);
  }

  private face(tx: number, ty: number) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    if (d !== this.dir) {
      this.dir = d;
      this.ver++;
    }
  }
  private setMoving(m: number) {
    if (this.moving !== m) {
      this.moving = m;
      this.ver++;
    }
  }
  private navData(): Nav {
    return (this.nav ??= navOf(this.room.zoneId));
  }
  /**
   * One step toward a destination, around obstacles. Walks straight while the straight line is
   * clear; otherwise follows a route found on the tile grid (searched at most twice a second per
   * monster and PATHS_PER_TICK times a tick overall). Returns false when no progress is possible.
   */
  private travel(tx: number, ty: number, speed: number, gait: number, tick: number): boolean {
    if (this.def.flying) return this.moveToward(tx, ty, speed, gait);
    const map = this.room.map, nav = this.navData();
    if (tick >= this.lineAt) {
      this.lineAt = tick + 5;
      this.direct = clearLine(map, this.x, this.y, tx, ty);
    }
    if (this.direct) {
      this.path.length = 0;
      if (this.moveToward(tx, ty, speed, gait)) {
        this.blockedBy = '';
        return true;
      }
      if (Math.hypot(tx - this.x, ty - this.y) < 6) return false; // arrived
      this.direct = false;
    }
    const goal = tileOf(tx) + tileOf(ty) * map.w;
    if ((!this.path.length || this.pathGoal !== goal) && tick >= this.pathAt) {
      if (pathTick !== tick) {
        pathTick = tick;
        pathsLeft = PATHS_PER_TICK;
      }
      if (pathsLeft <= 0) return this.path.length ? this.follow(nav, speed, gait) : false; // wait for a turn
      pathsLeft--;
      this.pathAt = tick + 10;
      this.pathGoal = goal;
      const p = findPath(nav, tileOf(this.x), tileOf(this.y), tileOf(tx), tileOf(ty));
      if (!p) {
        this.path.length = 0;
        this.blockedBy = 'no route to destination';
        return false;
      }
      this.path = p;
    }
    if (!this.path.length) return false;
    return this.follow(nav, speed, gait);
  }
  /** Advances along the current route, one tile centre at a time. */
  private follow(nav: Nav, speed: number, gait: number): boolean {
    const near = Math.max(3, speed * (TICK_MS / 1000) * 0.7);
    while (this.path.length) {
      const { x, y } = tileXY(nav, this.path[0]);
      if (Math.abs(x - this.x) <= near && Math.abs(y - this.y) <= near) {
        this.path.shift();
        continue;
      }
      if (this.moveToward(x, y, speed, gait)) {
        this.blockedBy = '';
        return true;
      }
      this.path.length = 0;
      this.blockedBy = 'route blocked';
      return false;
    }
    this.lineAt = 0; // route finished: the destination should now be in a straight line
    return true;
  }
  /** What the AI is doing, in the words of the design: idle, patrol, chase, attack, return, dead. */
  get aiState(): string {
    return this.state === 'windup' || this.state === 'dash' ? 'attack' : this.state === 'idle' ? (this.moving ? 'patrol' : 'idle') : this.state;
  }
  /** Developer overlay data: [id, state, x, y, spawnX, spawnY, patrol, aggro, leash, blocked reason, route as x,y pairs...]. */
  debugInfo(): (number | string)[] {
    const out: (number | string)[] = [this.id, this.aiState, Math.round(this.x), Math.round(this.y), Math.round(this.spawnX), Math.round(this.spawnY), this.patrolR, this.def.aggro, this.def.leash, this.blockedBy];
    if (this.nav) for (const i of this.path.slice(0, 40)) {
      const p = tileXY(this.nav, i);
      out.push(p.x, p.y);
    }
    return out;
  }
  /** One step toward a point. Returns false if no progress was possible. */
  private moveToward(tx: number, ty: number, speed: number, gait: number): boolean {
    const step = q(speed * (TICK_MS / 1000));
    const dx = tx - this.x, dy = ty - this.y;
    const ix = Math.abs(dx) > step * 0.6 ? Math.sign(dx) : 0, iy = Math.abs(dy) > step * 0.6 ? Math.sign(dy) : 0;
    if (!ix && !iy) return false;
    const ox = this.x, oy = this.y;
    if (this.def.flying) flyStep(this, ix, iy, step, this.room.map);
    else stepMove(this, ix, iy, this.room.map, step);
    if (this.x === ox && this.y === oy) return false;
    this.face(tx, ty);
    this.moving = gait;
    this.ver++;
    this.room.grid.update(this);
    return true;
  }
}

/** Flyers ignore terrain but stay inside the map. */
function flyStep(m: { x: number; y: number }, ix: number, iy: number, step: number, map: ZoneMap) {
  const k = ix && iy ? Math.SQRT1_2 : 1;
  m.x = q(Math.max(TILE * 2, Math.min(map.w * TILE - TILE * 2, m.x + ix * step * k)));
  m.y = q(Math.max(TILE * 2, Math.min(map.h * TILE - TILE * 2, m.y + iy * step * k)));
}

export const canStand = (map: ZoneMap, x: number, y: number) => !blocked(map, x, y);
