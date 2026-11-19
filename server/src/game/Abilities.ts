// Server-side execution of job skills and rune spells: validation, cost, cooldown, cast time,
// targeting, effects, ground fields (zones, traps) and delayed effects. All authoritative.
import { awaken, AWAKEN_LEVEL, FUSION_INDEX, FUSION_LEVEL, FUSION_RUNE_LEVEL } from '../../../shared/src/awakening';
import { ASCENSION_LEVEL, COMBO_LEVEL, COMBO_WINDOW_MS, comboOf, milestonesAt, PATH_INDEX, RESONANCE_MS, ULT_MAX, ultScale } from '../../../shared/src/ascension';
import { enhance } from '../../../shared/src/subskills';
import { sigilRanks } from '../../../shared/src/gear';
import {
  ABILITIES, ABILITY_INDEX, ELEMENTS, freePoints, GCD_MS, learnBlock, RANK_SCALE, RUNE_LEVEL_SCALE, RUNE_MAX_LEVEL, RUNE_XP_PER_CAST,
  runeExpToNext, type AbilityDef, type Element, type FieldSpec, type Hit, type StatusApply,
} from '../../../shared/src/abilities';
import { COMBAT_TIMEOUT_MS, Dmg, STATUS, STATUS_INDEX } from '../../../shared/src/combat';
import { ownsRune } from '../../../shared/src/runes';
import { dismount } from './Companions';
import { JOB_DEFS } from '../../../shared/src/jobs';
import { Act, Dir, PLAYER_HALF, TICK_MS } from '../../../shared/src/protocol';
import { blocked, stepMove } from '../../../shared/src/world';
import { applyStatus, cleanse, emit, removeStatus, type Ent } from './entity';
import { Monster } from './Monster';
import type { Player, World, ZoneRoom } from './World';
import { isTalentKey, talentKey } from '../../../shared/src/talents';

const ticks = (ms: number) => Math.ceil(ms / TICK_MS);

export interface Casting {
  def: AbilityDef;
  scale: number;
  cost: number;
  endTick: number;
  tid: number;
  x: number;
  y: number;
}
export interface Field {
  key: number;
  def: AbilityDef;
  spec: FieldSpec;
  owner: number;
  x: number;
  y: number;
  until: number;
  next: number;
  scale: number;
  /** Player the field was cast on, if any. */
  tid?: number;
  /** Death Mark: damage dealt by the owner to this monster while the mark lasts. */
  mark?: { target: number; acc: number };
}

const isRage = (p: Player) => JOB_DEFS[p.job].resource === 'rage';
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Effective level of an attuned rune (0 if the element is not in a slot). */
export function runeLevel(p: Player, el: Element): number {
  if (!p.build.runes.slots.includes(el)) return 0;
  return Math.min(RUNE_MAX_LEVEL + 5, (p.build.runes.lv[el] ?? 1) + p.stats.runeLevel);
}

/** Validates and starts an ability. Returns '' on success or a short reason for the client. */
export function useAbility(w: World, p: Player, id: unknown, tid: unknown): string {
  const base = typeof id === 'string' ? ABILITIES[id] : undefined;
  if (!base) return 'Unknown ability';
  // the skill as this character casts it: learned sub-skills change cost, cooldown, damage, area...
  // awakened skills (level 80) work differently
  const plain = enhance(base, p.build, sigilRanks(p.job, p.level, p.gear, p.build.skills));
  const def = base.kind === 'skill' && p.asc.awake.includes(base.id) && p.level >= AWAKEN_LEVEL ? awaken(plain) : plain;
  if (p.dead) return 'You are dead';
  if (p.mods.stun) return 'Stunned';
  if (p.casting) return 'Already casting';
  let scale: number, cost = def.cost;
  if (def.kind === 'ult') {
    // an ultimate: the character's path, level 70, and a full gauge
    if (PATH_INDEX[p.asc.path]?.ult !== def.id) return 'Not your ultimate';
    if (p.ult < ULT_MAX) return 'The ultimate is not charged';
    scale = ultScale(p.level);
    cost = 0;
  } else if (def.kind === 'fusion') {
    // a rune fusion: both runes attuned, both at level 5 or more, from level 90
    const f = FUSION_INDEX[def.id];
    if (p.level < FUSION_LEVEL) return `Rune fusion opens at level ${FUSION_LEVEL}`;
    const l1 = runeLevel(p, f.els[0]), l2 = runeLevel(p, f.els[1]);
    if (!l1 || !l2) return 'Both runes must be attuned';
    if (Math.min(l1, l2) < FUSION_RUNE_LEVEL) return `Both runes must be level ${FUSION_RUNE_LEVEL}`;
    scale = (1 + RUNE_LEVEL_SCALE * (Math.min(l1, l2) - 1)) * p.mods.rune;
    cost = Math.round(def.cost * p.stats.runeCost);
  } else if (def.kind === 'skill') {
    const learned = def.job === p.job ? p.build.skills[def.id] ?? 0 : 0;
    if (learned < 1) return 'Skill not learned';
    // sigils raise a learned skill above its normal maximum rank
    const rank = learned + (sigilRanks(p.job, p.level, p.gear, p.build.skills)[def.id] ?? 0);
    scale = 1 + RANK_SCALE * (rank - 1);
    if (def.costAll) cost = Math.max(def.cost, p.res);
  } else {
    const lv = runeLevel(p, def.el!);
    if (!lv) return 'Rune not attuned';
    if (lv < def.unlock!) return `Requires rune level ${def.unlock}`;
    scale = (1 + RUNE_LEVEL_SCALE * (lv - 1)) * p.mods.rune;
    cost = Math.round(def.cost * p.stats.runeCost);
  }
  const tick = w.tick;
  if (tick < p.gcd || tick < (p.cds.get(def.id) ?? 0)) return 'Not ready';
  if (p.res < cost) return isRage(p) ? 'Not enough rage' : 'Not enough mana';

  // --- target ---
  let target: Ent | null = null, x = p.x, y = p.y;
  const room = p.room, tnum = Number.isInteger(tid) ? (tid as number) : 0;
  if (def.target === 'enemy' && (tnum > 0 || (!tnum && p.pvpTarget))) {
    // PvP: single-target damage abilities only. Area effects, fields, movement and specials stay PvE.
    const v = tnum > 0 ? room.players.get(tnum) : p.pvpTarget!;
    if (!v) return 'No target';
    if (!pvpUsable(def)) return 'This ability cannot be used on players';
    const why = w.pvp.block(p, v);
    if (why) return why;
    if (dist(v, p) > def.range + PLAYER_HALF * 2) return 'Out of range';
    target = v;
    x = v.x;
    y = v.y;
  } else if (def.target === 'enemy') {
    let m = tnum < 0 ? room.monsters.get(tnum) ?? null : p.target;
    if (!m || m.dead) {
      m = null;
      let bd = def.range + 40;
      for (const o of room.monsters.values()) {
        if (o.dead) continue;
        const d = dist(o, p) - o.def.radius;
        if (d < bd) {
          bd = d;
          m = o;
        }
      }
    }
    if (!m) return 'No target';
    if (dist(m, p) > def.range + m.def.radius + PLAYER_HALF) return 'Out of range';
    target = m;
    x = m.x;
    y = m.y;
    if (p.target !== m) {
      p.target = m;
      p.selfDirty = true;
    }
  } else if (def.target === 'ally') {
    const a = tnum > 0 ? room.players.get(tnum) : undefined;
    target = a && !a.dead && dist(a, p) <= def.range + PLAYER_HALF ? a : p;
    x = target.x;
    y = target.y;
  } else if (def.target === 'deadAlly') {
    const a = tnum > 0 ? room.players.get(tnum) : undefined;
    if (!a || !a.dead || a === p) return 'Select a fallen ally';
    if (dist(a, p) > def.range + PLAYER_HALF) return 'Out of range';
    target = a;
    x = a.x;
    y = a.y;
  }

  if (def.castMs) {
    dismount(w, p);
    p.casting = { def, scale, cost, endTick: tick + ticks(def.castMs), tid: target ? target.id : 0, x, y };
    emit(p, w.evt, [p.id, Act.Cast, ABILITY_INDEX[def.id], def.castMs]);
    const r = def.hit?.aoe ?? def.hit?.aoeSelf ?? (def.field ? def.field.r : 0);
    if (r) emit(p, w.evt, [p.id, Act.Telegraph, Math.round(def.hit?.aoeSelf || def.field?.at === 'self' ? p.x : x), Math.round(def.hit?.aoeSelf || def.field?.at === 'self' ? p.y : y), r, def.castMs, 1]);
    p.gcd = tick + ticks(GCD_MS);
    return '';
  }
  if (def.kind === 'ult') spendUlt(w, p, def);
  resolve(w, p, def, scale, cost, target, x, y);
  if (def.kind === 'skill') comboStep(w, p, def.id);
  return '';
}

/** Spends the ultimate gauge; two party members casting theirs close together resonate. */
function spendUlt(w: World, p: Player, def: AbilityDef) {
  p.ult = 0;
  p.ultAt = Date.now();
  w.send(p, { t: 'ult', v: 0 });
  w.announce(p.room, `${p.name} unleashes ${def.name}!`, 'phase');
  const mate = p.party ? w.parties.members(p.party).find((m) => m !== p && m.room === p.room && Date.now() - m.ultAt <= RESONANCE_MS && Math.hypot(m.x - p.x, m.y - p.y) <= 420) : undefined;
  if (mate) {
    for (const x of [p, mate]) applyStatus(x, STATUS_INDEX.blessing, w.tick, 0, p.id);
    w.announce(p.room, `Resonance! ${mate.name} and ${p.name} fight as one.`, 'phase');
  }
}
/** Fills the ultimate gauge (hits dealt and taken, kills), for characters on a path. */
export function chargeUlt(w: World, p: Player, n: number) {
  if (!p.asc.path || p.level < ASCENSION_LEVEL || p.ult >= ULT_MAX) return;
  const before = Math.floor(p.ult / 5);
  p.ult = Math.min(ULT_MAX, p.ult + n);
  if (Math.floor(p.ult / 5) !== before || p.ult >= ULT_MAX) w.send(p, { t: 'ult', v: Math.floor(p.ult) });
}
/** Combo chains: the job's three skills in order, each within the window, unleash the finisher. */
function comboStep(w: World, p: Player, id: string) {
  const c = comboOf(p.job);
  if (!c || p.level < COMBO_LEVEL) return;
  const now = Date.now(), fresh = now - p.combo.at <= COMBO_WINDOW_MS;
  if (fresh && c.steps[p.combo.i] === id) p.combo = { i: p.combo.i + 1, at: now };
  else p.combo = { i: c.steps[0] === id ? 1 : 0, at: now };
  if (p.combo.i >= c.steps.length) {
    p.combo = { i: 0, at: 0 };
    const hit: Hit = { mul: c.mul, magic: c.magic, aoeSelf: c.r };
    doHit(w, p, hit, 1 + 0.1 * Math.max(0, milestonesAt(p.level) - 1), null, p.x, p.y, 0, 0);
    emit(p, w.evt, [p.id, Act.Cast, ABILITY_INDEX[c.steps[2]], 0]);
    w.send(p, { t: 'combo', name: c.name, i: 3 });
    w.announce(p.room, `${p.name}: ${c.name}!`, 'phase');
  } else w.send(p, { t: 'combo', name: c.name, i: p.combo.i });
}

export function cancelCast(w: World, p: Player) {
  if (!p.casting) return;
  emit(p, w.evt, [p.id, Act.Cast, ABILITY_INDEX[p.casting.def.id], 0]);
  p.casting = null;
}

/** Called every tick for a casting player. */
export function tickCast(w: World, p: Player) {
  const c = p.casting!;
  if (w.tick < c.endTick) return;
  p.casting = null;
  let target: Ent | null = null;
  if (c.def.target !== 'self') {
    target = w.entById(p.room, c.tid);
    const gone = !target || (c.def.target === 'deadAlly' ? !target.dead : target.dead);
    // Area spells still land where they were aimed; everything else needs its target.
    if (gone && !c.def.hit?.aoe) return void emit(p, w.evt, [p.id, Act.Cast, ABILITY_INDEX[c.def.id], 0]);
    if (gone) target = null;
  }
  if (p.res < c.cost) return void emit(p, w.evt, [p.id, Act.Cast, ABILITY_INDEX[c.def.id], 0]);
  resolve(w, p, c.def, c.scale, c.cost, target, target && !c.def.hit?.aoe ? target.x : c.x, target && !c.def.hit?.aoe ? target.y : c.y);
}

function monstersNear(room: ZoneRoom, x: number, y: number, r: number): Monster[] {
  const out: Monster[] = [];
  for (const m of room.monsters.values()) if (!m.dead && Math.hypot(m.x - x, m.y - y) <= r + m.def.radius) out.push(m);
  return out;
}
/** Allies for area effects: the caster and party members within the radius (see Parties.allies). */
const alliesNear = (w: World, p: Player, x: number, y: number, r: number): Player[] => w.parties.allies(p, x, y, r + PLAYER_HALF).filter((a) => !a.dead && Math.hypot(a.x - x, a.y - y) <= r + PLAYER_HALF);

/** Applies a Hit spec; returns the monsters that were struck. */
function doHit(w: World, p: Player, hit: Hit, scale: number, primary: Monster | null, x: number, y: number, range: number, critAdd: number, chain?: number[]): Monster[] {
  let targets: Monster[];
  const room = p.room;
  if (hit.aoeSelf) targets = monstersNear(room, p.x, p.y, hit.aoeSelf);
  else if (hit.aoe) targets = monstersNear(room, x, y, hit.aoe);
  else if (hit.cone) {
    const ang = Math.atan2(y - p.y, x - p.x);
    targets = monstersNear(room, p.x, p.y, range)
      .filter((m) => m === primary || Math.abs(((Math.atan2(m.y - p.y, m.x - p.x) - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI) <= hit.cone!)
      .sort((a, b) => dist(a, p) - dist(b, p));
  } else targets = primary ? [primary] : [];
  if (hit.maxTargets) targets = targets.slice(0, hit.maxTargets);
  const struck: Monster[] = [];
  const one = (m: Monster, mul: number) => {
    let k = mul * scale;
    if (hit.behindMul) {
      // "Behind" = the monster is facing away from the attacker.
      const fx = m.dir === Dir.Left ? -1 : m.dir === Dir.Right ? 1 : 0, fy = m.dir === Dir.Up ? -1 : m.dir === Dir.Down ? 1 : 0;
      if (fx * (p.x - m.x) + fy * (p.y - m.y) < 0) k *= hit.behindMul;
    }
    if (hit.executeBelow && m.hp / m.maxHp < hit.executeBelow) k *= hit.executeMul ?? 1;
    for (let i = 0; i < (hit.hits ?? 1); i++) w.strike(p, m, k, !!hit.magic, (hit.critAdd ?? 0) + critAdd, false);
    struck.push(m);
  };
  for (const m of targets) one(m, hit.mul);
  if (primary && hit.splash) for (const m of monstersNear(room, primary.x, primary.y, hit.splash)) if (m !== primary) one(m, hit.mul * (hit.splashMul ?? 0.5));
  if (primary && hit.chain) {
    let from: Monster = primary, mul = hit.mul;
    for (let i = 0; i < hit.chain; i++) {
      mul *= 0.7;
      const next = monstersNear(room, from.x, from.y, 130).filter((m) => !struck.includes(m)).sort((a, b) => dist(a, from) - dist(b, from))[0];
      if (!next) break;
      one(next, mul);
      chain?.push(next.id);
      from = next;
    }
  }
  return struck;
}

function applyStatuses(w: World, p: Player, list: StatusApply[] | undefined, struck: Monster[], ally: Ent | null, def: AbilityDef, scale: number, x: number, y: number) {
  if (!list) return;
  const power = p.stats[def.hit?.magic || def.kind === 'rune' ? 'matk' : 'atk'] * p.mods.atk;
  for (const s of list) {
    const idx = STATUS_INDEX[s.id];
    if (s.on === 'enemy') {
      const targets = struck.length || def.hit ? struck : def.radius ? monstersNear(p.room, x, y, def.radius) : [];
      for (const m of targets) {
        if (m.dead || (s.chance !== undefined && w.rnd() * 100 >= s.chance)) continue;
        // Ranger passive (level 25): poisons stack once more.
        const tox = s.id === 'poison' && p.job === 'ranger' && p.level >= 25 ? 1 : 0;
        applyStatus(m, idx, w.tick, power, p.id, (s.stacks ?? 1) + tox, tox, s.durMul ?? 1);
        m.addThreat(p.id, 1);
      }
    } else {
      const who: Ent[] = s.on === 'self' ? [p] : s.on === 'ally' ? [ally ?? p] : alliesNear(w, p, p.x, p.y, def.radius ?? 200);
      for (const e of who) {
        applyStatus(e, idx, w.tick, s.id === 'barrier' ? Math.round(p.stats.matk * (def.barrier ?? 1) * scale) : power, p.id, 1, 0, s.durMul ?? 1);
        if (s.id === 'stealth') for (const m of p.room.monsters.values()) m.threat.delete(e.id);
      }
    }
  }
}

let nextKey = 1;

/** Abilities that may hit a player: a direct hit on one target, nothing else. */
export const pvpUsable = (def: AbilityDef) => !!def.hit && !def.hit.aoe && !def.hit.aoeSelf && !def.field && !def.move && !def.special && def.target === 'enemy';

/** A damage ability landing on a player (PvP). Costs, cooldown, rune growth and the effect event as usual. */
function resolvePvp(w: World, p: Player, def: AbilityDef, scale: number, cost: number, v: Player) {
  const tick = w.tick, idx = ABILITY_INDEX[def.id];
  if (w.pvp.block(p, v)) return void emit(p, w.evt, [p.id, Act.Cast, idx, 0]);
  p.res = Math.max(0, p.res - cost);
  if (def.gain) p.res = Math.min(p.stats.maxRes, p.res + def.gain);
  p.cds.set(def.id, tick + ticks(def.cdMs));
  p.gcd = Math.max(p.gcd, tick + ticks(GCD_MS));
  p.selfDirty = true;
  p.lastCombat = tick;
  if (p.mods.stealth && !def.quiet) removeStatus(p, STATUS_INDEX.stealth);
  dismount(w, p);
  const hit = def.hit!;
  for (let i = 0; i < (hit.hits ?? 1) && !v.dead; i++) w.pvp.strike(p, v, hit.mul * scale, !!hit.magic, hit.critAdd ?? 0, false);
  const power = p.stats[hit.magic || def.kind === 'rune' ? 'matk' : 'atk'] * p.mods.atk;
  for (const s of def.status ?? []) {
    if (s.on !== 'enemy' || v.dead || (s.chance !== undefined && w.rnd() * 100 >= s.chance)) continue;
    applyStatus(v, STATUS_INDEX[s.id], tick, power, p.id, s.stacks ?? 1, 0, s.durMul ?? 1);
  }
  growRune(w, p, def);
  const dx = v.x - p.x, dy = v.y - p.y;
  p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
  p.ver++;
  emit(p, w.evt, [p.id, Act.Fx, idx, Math.round(v.x), Math.round(v.y), v.id, 0]);
}

function resolve(w: World, p: Player, def: AbilityDef, scale: number, cost: number, target: Ent | null, x: number, y: number) {
  if (def.target === 'enemy' && target && target.isPlayer) return resolvePvp(w, p, def, scale, cost, target as Player);
  const tick = w.tick, room = p.room, idx = ABILITY_INDEX[def.id];
  // --- pay ---
  p.res = Math.max(0, p.res - cost);
  if (def.gain) p.res = Math.min(p.stats.maxRes, p.res + def.gain);
  p.cds.set(def.id, tick + ticks(def.cdMs));
  p.gcd = Math.max(p.gcd, tick + ticks(GCD_MS));
  p.selfDirty = true;
  if (def.target === 'enemy' || def.hit || def.field?.hit) p.lastCombat = tick;
  // Assassin passive (level 25): the first strike out of stealth always crits.
  let critAdd = 0;
  if (p.mods.stealth && !def.quiet) {
    if (p.job === 'assassin' && p.level >= 25) critAdd = 100;
    removeStatus(p, STATUS_INDEX.stealth);
  }
  const monster = target instanceof Monster ? target : null;
  const fromX = p.x, fromY = p.y;

  // --- movement ---
  if (def.move) {
    let dx = 0, dy = 0, steps = Math.round((def.dist ?? 0) / 8);
    if (def.move === 'blink') {
      dx = p.dir === Dir.Left ? -1 : p.dir === Dir.Right ? 1 : 0;
      dy = p.dir === Dir.Up ? -1 : p.dir === Dir.Down ? 1 : 0;
    } else if (def.move === 'back') {
      const from = p.target && !p.target.dead ? p.target : null;
      if (from) {
        dx = Math.sign(p.x - from.x);
        dy = Math.sign(p.y - from.y);
      } else {
        dx = p.dir === Dir.Left ? 1 : p.dir === Dir.Right ? -1 : 0;
        dy = p.dir === Dir.Up ? 1 : p.dir === Dir.Down ? -1 : 0;
      }
      if (!dx && !dy) dy = 1;
    } else if (monster) {
      // Land next to (or behind) the target on the nearest walkable spot.
      const gap = monster.def.radius + PLAYER_HALF + 6;
      let ux = monster.x - p.x, uy = monster.y - p.y;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      const side = def.move === 'behind' ? 1 : -1;
      for (const g of [gap, gap + 8, gap + 16, 0]) {
        const nx = Math.round((monster.x + ux * g * side) * 100) / 100, ny = Math.round((monster.y + uy * g * side) * 100) / 100;
        if (g === 0 || !blocked(room.map, nx, ny)) {
          if (g !== 0) {
            p.x = nx;
            p.y = ny;
          }
          break;
        }
      }
      steps = 0;
    }
    for (let i = 0; i < steps; i++) stepMove(p, dx, dy, room.map, 8);
    room.grid.update(p);
    p.ver++;
    p.dirty = true;
    p.inQ.length = 0; // queued inputs were predicted from the old position
    p.needAck = true;
    if (monster) {
      const ddx = monster.x - p.x, ddy = monster.y - p.y;
      p.dir = Math.abs(ddx) >= Math.abs(ddy) ? (ddx < 0 ? Dir.Left : Dir.Right) : ddy < 0 ? Dir.Up : Dir.Down;
    }
  } else if (monster) {
    const ddx = monster.x - p.x, ddy = monster.y - p.y;
    p.dir = Math.abs(ddx) >= Math.abs(ddy) ? (ddx < 0 ? Dir.Left : Dir.Right) : ddy < 0 ? Dir.Up : Dir.Down;
    p.ver++;
  }

  // --- effects ---
  const chain: number[] = [];
  const mana0 = p.res;
  w.lastCrit = false;
  const struck = def.hit ? doHit(w, p, def.hit, scale, monster, x, y, def.range + 20, critAdd, chain) : [];
  // Mage passive (level 25): critical spells refund part of their cost.
  if (w.lastCrit && p.job === 'mage' && p.level >= 25 && def.hit?.magic) p.res = Math.min(p.stats.maxRes, Math.max(p.res, mana0) + Math.round(cost * 0.3));
  applyStatuses(w, p, def.status, struck.length ? struck : monster ? [monster] : [], target instanceof Monster ? null : target, def, scale, p.x, p.y);
  if (def.heal) {
    const amount = Math.max(1, Math.round(p.stats.matk * def.heal * scale * p.stats.healPower));
    const who = def.healOn === 'allies' ? alliesNear(w, p, p.x, p.y, def.radius ?? 200) : [(target as Player | null) ?? p];
    for (const a of who) healAlly(w, p, a, amount);
  }
  if (def.taunt) {
    for (const m of monstersNear(room, p.x, p.y, def.radius ?? 160)) {
      let top = 0;
      for (const v of m.threat.values()) top = Math.max(top, v);
      if (!m.evading) m.threat.set(p.id, top * 1.5 + 200);
    }
  }
  let key = 0;
  if (def.field) {
    const f = def.field, fx = f.at === 'self' ? p.x : x, fy = f.at === 'self' ? p.y : y;
    key = nextKey++;
    room.fields.push({ key, def, spec: f, owner: p.id, x: fx, y: fy, until: tick + ticks(f.ms), next: tick + (f.kind === 'zone' ? ticks(Math.min(300, f.everyMs ?? 1000)) : 0), scale, tid: target && target.isPlayer ? target.id : 0 });
    x = fx;
    y = fy;
  }
  if (def.special === 'cleanse' && target) cleanse(target);
  if (def.special === 'revive' && target && target.isPlayer && target.dead) w.revive(target as Player, 0.4);
  if (def.special === 'deathMark' && monster) {
    key = nextKey++;
    room.fields.push({ key, def, spec: { kind: 'zone', at: 'target', r: 0, ms: STATUS[STATUS_INDEX.death_mark].ms }, owner: p.id, x, y, until: tick + ticks(STATUS[STATUS_INDEX.death_mark].ms), next: Infinity, scale, mark: { target: monster.id, acc: 0 } });
  }

  // --- rune progression ---
  growRune(w, p, def);
  const ev = [p.id, Act.Fx, idx, Math.round(def.move ? fromX : x), Math.round(def.move ? fromY : y), target ? target.id : 0, key];
  for (const id of chain) ev.push(id);
  emit(p, w.evt, ev);
}

/** Casting a rune spell grows the rune. */
function growRune(w: World, p: Player, def: AbilityDef) {
  if (def.kind === 'rune') {
    const el = def.el!, r = p.build.runes;
    const lv = r.lv[el] ?? 1;
    if (lv < RUNE_MAX_LEVEL) {
      r.xp[el] = (r.xp[el] ?? 0) + RUNE_XP_PER_CAST;
      if (r.xp[el]! >= runeExpToNext(lv)) {
        r.xp[el]! -= runeExpToNext(lv);
        r.lv[el] = lv + 1;
        w.send(p, { t: 'sys', text: `Your ${el[0].toUpperCase() + el.slice(1)} Rune reached level ${lv + 1}.` });
      }
      p.buildDirty = true;
      w.send(p, { t: 'build', build: p.build });
    }
  }
}

function healAlly(w: World, caster: Player, a: Player, amount: number) {
  w.heal(a, amount, caster);
  // Cleric passive (level 25): heals leave a small barrier.
  if (caster.job === 'cleric' && caster.level >= 25) applyStatus(a, STATUS_INDEX.barrier, w.tick, Math.round(amount * 0.25), caster.id);
}

/** Zones pulse, traps wait for a victim, death marks detonate. */
export function updateFields(w: World, room: ZoneRoom) {
  const tick = w.tick, list = room.fields;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i], owner = room.players.get(f.owner);
    if (!owner) {
      list.splice(i, 1);
      continue;
    }
    if (f.mark) {
      if (tick < f.until) continue;
      const m = room.monsters.get(f.mark.target);
      if (m && !m.dead && f.mark.acc > 0) w.hurt(m, Math.max(1, Math.round(f.mark.acc * 0.4 * f.scale)), 0, owner);
      list.splice(i, 1);
      continue;
    }
    const s = f.spec;
    if (s.kind === 'trap') {
      const victims = monstersNear(room, f.x, f.y, s.r).filter((m) => !m.def.flying);
      if (victims.length) {
        const struck = s.hit ? doHit(w, owner, s.hit, f.scale, victims[0], f.x, f.y, 0, 0) : victims;
        applyStatuses(w, owner, s.status, struck, null, { ...f.def, hit: s.hit }, f.scale, f.x, f.y);
        emit(owner, w.evt, [owner.id, Act.FxEnd, f.key, 1]);
        list.splice(i, 1);
      } else if (tick >= f.until) {
        emit(owner, w.evt, [owner.id, Act.FxEnd, f.key, 0]);
        list.splice(i, 1);
      }
      continue;
    }
    if (tick >= f.next) {
      f.next += ticks(s.everyMs ?? 1000);
      if (s.hit) {
        const struck = doHit(w, owner, { ...s.hit, aoe: s.r }, f.scale, null, f.x, f.y, 0, 0);
        applyStatuses(w, owner, s.status, struck, null, { ...f.def, hit: s.hit }, f.scale, f.x, f.y);
      }
      if (s.heal) {
        const amount = Math.max(1, Math.round(owner.stats.matk * s.heal * f.scale * owner.stats.healPower));
        const inside = alliesNear(w, owner, f.x, f.y, s.r);
        // A zone cast on someone outside the party (Healing Rain on a stranger) still heals that person.
        const t = f.tid ? room.players.get(f.tid) : undefined;
        if (t && !t.dead && !inside.includes(t) && Math.hypot(t.x - f.x, t.y - f.y) <= s.r + PLAYER_HALF) inside.push(t);
        for (const a of inside) healAlly(w, owner, a, amount);
      }
    }
    if (tick >= f.until) list.splice(i, 1);
  }
}

/** Death Mark bookkeeping: called by the world whenever a player damages a monster. */
export function noteDamage(room: ZoneRoom, playerId: number, monsterId: number, amount: number) {
  for (const f of room.fields) if (f.mark && f.owner === playerId && f.mark.target === monsterId) f.mark.acc += amount;
}

// ---------- build management ----------
export function learn(w: World, p: Player, id: unknown): string {
  if (typeof id !== 'string') return 'Unknown skill';
  const why = learnBlock(p.job, p.level, p.build, id);
  if (why) return why;
  if (isTalentKey(id)) {
    // talents are free, one per tier, and can be changed outside combat
    if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot do that in combat';
    const [, tier, choice] = id.split('.');
    p.build.skills[talentKey(Number(tier))] = Number(choice);
    buildChanged(w, p);
    return '';
  }
  p.build.skills[id] = (p.build.skills[id] ?? 0) + 1;
  buildChanged(w, p);
  return '';
}
export function respec(w: World, p: Player): string {
  if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot do that in combat';
  p.build.skills = {};
  // awakenings were paid for with skill points: a respec takes them back too
  if (p.asc.awake.length) {
    p.asc.awake = [];
    p.progDirty = true;
    w.sendAsc(p);
  }
  buildChanged(w, p);
  return '';
}
export function attune(w: World, p: Player, slot: unknown, el: unknown): string {
  const slots = p.build.runes.slots;
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= slots.length) return 'No such rune slot';
  if (el !== null && !ELEMENTS.includes(el as Element)) return 'Unknown rune';
  if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot change runes in combat';
  if (el && slots.some((s, i) => s === el && i !== slot)) return 'That rune is already in another slot';
  // M12: a rune has to be obtained (merchant or scroll) before it can be attuned
  if (el && !ownsRune(p.build, el as Element)) return 'You do not own that rune yet';
  slots[slot as number] = el as Element | null;
  buildChanged(w, p);
  return '';
}
export function buildChanged(w: World, p: Player) {
  p.buildDirty = true;
  const hpFrac = p.hp / p.maxHp;
  p.recalc();
  p.hp = Math.max(p.dead ? 0 : 1, Math.min(p.maxHp, Math.round(p.maxHp * hpFrac)));
  p.sver++;
  w.send(p, { t: 'build', build: p.build });
  w.send(p, { t: 'stats', level: p.level, stats: p.stats, exp: p.exp, next: w.nextExp(p) });
}
export { freePoints };
