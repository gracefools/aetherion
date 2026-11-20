// The auto hunter. It plays the character the way a person would: it decides where to walk and
// what to press, and the game client sends the same movement inputs, target, attack, ability and
// potion commands a keyboard would. The server validates every one of them as usual.
//
// It never walks where a route does not exist, never attacks through an obstacle, stays inside
// the hunting area, recovers when stuck, and stops when the character dies, the connection
// drops, the zone changes, or the player touches a movement key or the Stop button.
//
// To reach a target it plans where to stand, not where the monster is: the nearest spot it can walk
// to from which the monster is within reach and in plain sight. A monster behind a wall is attacked
// from around the corner; a flying one over a tree or a pond from the bank. A monster with no such
// spot (sealed off, or hovering over the middle of an obstacle out of reach) is not chosen at all,
// instead of being chased in circles.
import { ABILITIES } from '../../../shared/src/abilities';
import { autoKind, autoTargetable, chooseSkill, chooseTarget, type AutoConfig, type TargetView } from '../../../shared/src/autohunt';
import { MONSTERS } from '../../../shared/src/monsters';
import { attackSpot, clearLine, findPath, lineOfSight, navOf, tileOf, tileXY, walkField, type Nav } from '../../../shared/src/nav';
import { TILE } from '../../../shared/src/protocol';
import type { ZoneMap } from '../../../shared/src/world';

/** What the hunter can see and do. Implemented by the game client. */
export interface HunterHost {
  pos(): { x: number; y: number };
  map(): ZoneMap;
  playing(): boolean;
  dead(): boolean;
  hp(): number;
  maxHp(): number;
  res(): number;
  maxRes(): number;
  /** Basic attack reach in world units. */
  range(): number;
  monsters(): (TargetView & { mhp: number })[];
  targetId(): number;
  setTarget(id: number): void;
  attacking(): boolean;
  attack(): void;
  abilityReady(id: string): boolean;
  abilityCost(id: string): number;
  useAbility(id: string): void;
  /** The ascension ultimate, when its gauge is full (null otherwise). */
  ultReady(): string | null;
  potions(base: string): number;
  potionReady(): boolean;
  quaff(base: string): void;
  usesMana(): boolean;
  bagFull(): boolean;
  notify(text: string): void;
}
export interface Step {
  ix: number;
  iy: number;
  run: boolean;
}
const SKIP_MS = 20_000, DECIDE_EVERY = 4;

export class AutoHunter {
  on = false;
  /** One line for the status indicator. */
  status = 'Stopped';
  targetName = '';
  cfg!: AutoConfig;
  private anchor = { x: 0, y: 0 };
  private nav!: Nav;
  private n = 0;
  private path: number[] = [];
  private pathGoal = -1;
  private pathAt = 0;
  private skip = new Map<number, number>(); // target id -> time it may be tried again
  private lastPos = { x: 0, y: 0, at: 0 };
  private stuck = 0;
  private dodgeUntil = 0;
  private dodge = [0, 0];
  private lastAttack = 0;
  private lastSkill = 0;
  private told = new Set<string>();
  private returning: { x: number; y: number } | null = null;
  private dir: Step | null = null;
  /** Open PvP: the player to fight first, by the player's mode (predator: anyone; prepared: the hostile). */
  foe: (() => { id: number; x: number; y: number; name: string } | null) | null = null;
  /** Only these monster types are hunted (a quest's targets); null: as configured. */
  focus: Set<string> | null = null;
  /** Following a party leader: the hunting area moves with them and their target comes first. */
  leader: (() => { x: number; y: number; tgt: number } | null) | null = null;
  /** Called when the hunter stops by its own decision (not by the Stop button). */
  onStop: (why: string) => void = () => {};

  constructor(private host: HunterHost) {}

  start(cfg: AutoConfig, now: number) {
    const p = this.host.pos();
    this.cfg = cfg;
    this.on = true;
    this.anchor = { x: p.x, y: p.y };
    this.nav = navOf(this.host.map().def.id);
    this.path.length = 0;
    this.skip.clear();
    this.told.clear();
    this.stuck = 0;
    this.returning = null;
    this.lastPos = { x: p.x, y: p.y, at: now };
    this.status = 'Looking for a target';
  }
  /** Stops at once. With `walkTo`, the character first walks to that point (return to a safe location). */
  stop(why = 'Stopped', walkTo: { x: number; y: number } | null = null) {
    this.on = false;
    this.focus = null;
    this.dir = null;
    this.path.length = 0;
    this.targetName = '';
    this.status = why;
    this.returning = walkTo;
    if (walkTo) this.status = `${why}. Returning`;
  }
  /**
   * The player is steering with the movement keys: the hunt pauses its own movement and takes up
   * the hunting area around wherever the player lets go.
   */
  steer(now: number) {
    const p = this.host.pos();
    this.anchor = { x: p.x, y: p.y };
    this.path.length = 0;
    this.pathAt = 0;
    this.dir = null;
    this.stuck = 0;
    this.lastPos = { x: p.x, y: p.y, at: now };
    this.status = 'You are steering';
  }
  /** Cancels a return walk (the player took the controls). */
  cancelReturn() {
    this.returning = null;
  }
  get busy() {
    return this.on || !!this.returning;
  }
  /** The hunting area, for the overlay: centre and radius in world units. */
  area() {
    return { ...this.anchor, r: this.cfg.radius * TILE };
  }

  /** One simulation step (20 per second). Returns the movement to make, or null to stand still. */
  step(now: number): Step | null {
    const h = this.host;
    if (!h.playing() || h.dead()) {
      if (this.busy) this.stop(h.dead() ? 'Stopped: you died' : 'Stopped: connection lost');
      return null;
    }
    if (this.returning) {
      const at = h.pos(), d = Math.hypot(this.returning.x - at.x, this.returning.y - at.y);
      if (d < 20) {
        this.returning = null;
        this.status = this.status.replace('. Returning', '. Back at the safe spot');
        return null;
      }
      const s = this.walk(this.returning.x, this.returning.y, now, 40_000);
      if (!s) {
        this.returning = null;
        this.status = this.status.replace('. Returning', '. No route back');
      }
      return s;
    }
    if (!this.on) return null;
    if (this.n++ % DECIDE_EVERY === 0) this.decide(now);
    return this.dir;
  }

  private selfStop(why: string) {
    const cfg = this.cfg, map = this.host.map(), town = map.def.town;
    const to = cfg.returnTo === 'start' ? this.anchor : cfg.returnTo === 'town' && town ? { x: (town.tx + 0.5) * TILE, y: (town.ty + 2.5) * TILE } : null;
    this.stop(`Stopped: ${why}`, to);
    this.onStop(why);
  }
  private tell(key: string, text: string) {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.host.notify(text);
  }

  private decide(now: number) {
    const h = this.host, cfg = this.cfg, me = h.pos(), map = h.map(), radius = cfg.radius * TILE;
    const hpPct = (h.hp() / Math.max(1, h.maxHp())) * 100, resPct = (h.res() / Math.max(1, h.maxRes())) * 100;

    // --- potions: only when needed, only when one exists, only off cooldown (the server checks all three again) ---
    if (cfg.potions) {
      if (hpPct < cfg.hpPct && h.hp() < h.maxHp()) {
        if (h.potions('hp_potion') > 0) {
          if (h.potionReady()) h.quaff('hp_potion');
        } else {
          this.tell('hp', 'Auto hunting: out of Health Potions');
          if (hpPct < cfg.hpPct / 2) return this.selfStop('out of Health Potions and badly hurt');
        }
      } else if (h.usesMana() && resPct < cfg.mpPct && h.res() < h.maxRes()) {
        if (h.potions('mana_potion') > 0) {
          if (h.potionReady()) h.quaff('mana_potion');
        } else this.tell('mp', 'Auto hunting: out of Mana Potions');
      }
    }
    if (cfg.loot && cfg.onFull === 'stop' && h.bagFull()) return this.selfStop('your inventory is full');

    // --- another player first, where the mode says so: close in and strike ---
    const foe = this.foe?.() ?? null;
    if (foe) {
      if (h.targetId() !== foe.id) h.setTarget(foe.id);
      this.targetName = foe.name;
      const reachP = h.range(), dP = Math.hypot(foe.x - me.x, foe.y - me.y);
      if (dP <= (reachP > 100 ? reachP * 0.85 : reachP + 8) && lineOfSight(map, me.x, me.y, foe.x, foe.y)) {
        this.dir = null;
        this.status = `Fighting ${foe.name}`;
        if (cfg.attack && !h.attacking() && now - this.lastAttack > 400) { this.lastAttack = now; h.attack(); }
      } else {
        this.status = `Moving to ${foe.name}`;
        this.dir = this.walk(foe.x, foe.y, now, 4000);
      }
      return;
    }
    // --- target: keep a valid one, otherwise the one that is quickest to hit inside the hunting area ---
    const all = h.monsters(), mobs = this.focus ? all.filter((m) => this.focus!.has(m.type)) : all, reach = h.range(), reachEff = reach > 100 ? reach * 0.85 : reach - 2;
    // with a leader: hunt around them, wherever they go
    const lead = this.leader?.() ?? null;
    if (lead) this.anchor = { x: lead.x, y: lead.y };
    for (const [id, until] of this.skip) if (until < now) this.skip.delete(id);
    // one sweep of walking distances from here answers "how far to a spot I can hit it from" for every monster
    const field = walkField(this.nav, tileOf(me.x), tileOf(me.y), cfg.radius * 2 + 16);
    const spots = new Map<number, { x: number; y: number; steps: number } | null>();
    const spotOf = (m: TargetView) => {
      if (!spots.has(m.id)) {
        const d = MONSTERS[m.type];
        const here = Math.hypot(m.x - me.x, m.y - me.y) - (d?.radius ?? 0) <= reachEff && lineOfSight(map, me.x, me.y, m.x, m.y, !!d?.flying);
        spots.set(m.id, here ? { x: me.x, y: me.y, steps: 0 } : attackSpot(this.nav, field, m.x, m.y, d?.radius ?? 0, reachEff * 0.95, !!d?.flying));
      }
      return spots.get(m.id)!;
    };
    let tid = chooseTarget(cfg, me, this.anchor, radius, mobs, h.targetId(), (m) => spotOf(m)?.steps ?? Infinity, (id) => this.skip.has(id));
    // the leader's target comes first, when it is in sight and not given up on
    if (lead?.tgt && !this.skip.has(lead.tgt) && all.some((m) => m.id === lead.tgt && m.hp > 0)) tid = lead.tgt;
    if (tid !== h.targetId()) h.setTarget(tid);
    const t = all.find((m) => m.id === tid);
    if (!t) {
      this.targetName = '';
      // nothing to hunt: go back to the middle of the hunting area and wait there
      if (Math.hypot(me.x - this.anchor.x, me.y - this.anchor.y) > 40) {
        this.status = 'Returning to the hunting spot';
        this.dir = this.walk(this.anchor.x, this.anchor.y, now);
      } else {
        // say why nothing is happening instead of standing silently
        const huntable = mobs.filter((m) => m.hp > 0 && autoTargetable(cfg, m.type));
        this.status = !huntable.length
          ? `No monsters within ${cfg.radius} tiles. Walk to a hunting ground or widen the radius`
          : huntable.every((m) => Math.hypot(m.x - this.anchor.x, m.y - this.anchor.y) > radius)
            ? `Monsters are outside the ${cfg.radius}-tile hunting area. Widen the radius or start closer`
            : 'Looking for a target';
        this.dir = null;
      }
      return;
    }
    const def = MONSTERS[t.type];
    this.targetName = def.name;
    const dist = Math.hypot(t.x - me.x, t.y - me.y) - def.radius;
    // a flyer over an obstacle is in sight: the solid ground under it does not hide it
    const sight = lineOfSight(map, me.x, me.y, t.x, t.y, !!def.flying);
    const inPlace = sight && dist <= reachEff;

    // --- the ultimate first, as soon as it is charged and the target is in sight ---
    const ult = cfg.skills && cfg.ult !== false ? h.ultReady() : null;
    if (ult && sight && dist <= 220 && now - this.lastSkill > 300) {
      this.lastSkill = now;
      h.useAbility(ult);
    }
    // --- skills: by priority, each under its own conditions; never through an obstacle ---
    else if (cfg.skills && now - this.lastSkill > 300) {
      const near = (cx: number, cy: number, r: number) => mobs.filter((m) => m.hp > 0 && Math.hypot(m.x - cx, m.y - cy) <= r + (MONSTERS[m.type]?.radius ?? 0)).length;
      const id = chooseSkill(cfg, {
        hpPct, resPct, res: h.res(), hasTarget: sight, targetDist: dist, targetHpFrac: t.hp / Math.max(1, t.mhp), targetElite: def.elite,
        enemiesNearMe: (r) => near(me.x, me.y, r), enemiesNearTarget: (r) => near(t.x, t.y, r),
        ready: (sid) => h.abilityReady(sid), cost: (sid) => h.abilityCost(sid),
      });
      if (id) {
        this.lastSkill = now;
        h.useAbility(id);
      }
    }

    if (inPlace) {
      this.dir = null;
      this.path.length = 0;
      this.stuck = 0;
      this.lastPos = { x: me.x, y: me.y, at: now };
      this.status = `Fighting ${def.name}`;
      if (cfg.attack && !h.attacking() && now - this.lastAttack > 400) {
        this.lastAttack = now;
        h.attack();
      }
      return;
    }

    // --- approach, with stuck detection and recovery ---
    this.status = `Moving to ${def.name}`;
    if (now < this.dodgeUntil) {
      this.dir = { ix: this.dodge[0], iy: this.dodge[1], run: true };
      return;
    }
    if (now - this.lastPos.at > 1000) {
      const moved = Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y);
      this.lastPos = { x: me.x, y: me.y, at: now };
      if (moved < 10 && this.dir) {
        this.stuck++;
        this.path.length = 0;
        this.pathAt = 0;
        if (this.stuck >= 3) {
          // three tries without progress: this target is given up for a while
          this.skip.set(t.id, now + SKIP_MS);
          this.stuck = 0;
          this.dir = null;
          h.setTarget(0);
          return;
        }
        // recovery movement: step sideways from the way we were heading, then plan again
        this.dodge = this.dir.ix && this.dir.iy ? [this.dir.ix, 0] : [this.dir.iy, this.dir.ix];
        if (this.stuck === 2) this.dodge = [-this.dodge[0], -this.dodge[1]];
        this.dodgeUntil = now + 350;
        return;
      }
      this.stuck = 0;
    }
    // walk to where it can be hit from, not into it
    const spot = spotOf(t);
    const step = spot ? this.walk(spot.x, spot.y, now, 4000) : null;
    if (!step && spot && Math.hypot(spot.x - me.x, spot.y - me.y) < 8) {
      // already standing on the spot (a few pixels off its centre): swing rather than give up
      if (cfg.attack && !h.attacking() && now - this.lastAttack > 400) {
        this.lastAttack = now;
        h.attack();
      }
      this.dir = null;
      return;
    }
    if (!step) {
      // no spot or no route: give it up for a while rather than run in circles or push against a wall
      this.skip.set(t.id, now + SKIP_MS);
      h.setTarget(0);
    }
    this.dir = step;
  }

  /** One movement toward a point: straight when the line is walkable, otherwise along a route over the tile grid. */
  private walk(x: number, y: number, now: number, budget?: number): Step | null {
    const me = this.host.pos(), map = this.host.map();
    const toward = (tx: number, ty: number): Step | null => {
      const dx = tx - me.x, dy = ty - me.y, ix = Math.abs(dx) > 3 ? Math.sign(dx) : 0, iy = Math.abs(dy) > 3 ? Math.sign(dy) : 0;
      return ix || iy ? { ix, iy, run: true } : null;
    };
    if (clearLine(map, me.x, me.y, x, y)) {
      this.path.length = 0;
      return toward(x, y);
    }
    const goal = tileOf(x) + tileOf(y) * map.w;
    if ((!this.path.length || this.pathGoal !== goal) && now >= this.pathAt) {
      this.pathAt = now + 500;
      this.pathGoal = goal;
      this.path = findPath(this.nav, tileOf(me.x), tileOf(me.y), tileOf(x), tileOf(y), budget) ?? [];
      if (!this.path.length) return null;
    }
    if (!this.path.length) return null; // no route known yet: stand still rather than push against a wall
    while (this.path.length) {
      const p = tileXY(this.nav, this.path[0]);
      if (Math.abs(p.x - me.x) <= 5 && Math.abs(p.y - me.y) <= 5) this.path.shift();
      else return toward(p.x, p.y);
    }
    return toward(x, y);
  }
}

/** The ability's cost for the panel and the hunter (rune spells cost less with rune mastery). */
export const autoLabel = (id: string) => `${ABILITIES[id]?.name ?? id} · ${({ enemy: 'target', area: 'area', heal: 'heal', buff: 'buff' } as Record<string, string>)[autoKind(ABILITIES[id]) ?? ''] ?? ''}`;
