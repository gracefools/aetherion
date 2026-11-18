// What players and monsters have in common: replicated state, statuses, per-tick event buffers.
import { modsOf, STATUS, type Mods, type StatusInst } from '../../../shared/src/combat';
import { TICK_MS, type EntityMeta } from '../../../shared/src/protocol';
import type { GridItem } from './SpatialGrid';

export interface Ent extends GridItem {
  readonly id: number;
  readonly isPlayer: boolean;
  level: number;
  dir: number;
  moving: number;
  ver: number; // movement/facing version
  sver: number; // vitals version (hp, max hp, statuses)
  hp: number;
  maxHp: number;
  dead: boolean;
  st: StatusInst[];
  mask: number;
  mods: Mods;
  lastCombat: number; // tick
  /** Bitmask of status indices this entity ignores (bosses cannot be stunned or rooted). */
  immune?: number;
  evs: number[][]; // events emitted this tick (valid when evTick === tick)
  evTick: number;
  dmgs: number[][]; // damage events received this tick
  dmgTick: number;
  meta(): EntityMeta;
  /** Called when statuses changed so derived values (move step etc.) can be refreshed. */
  onStatusChange(): void;
}

export const NO_MODS: Mods = modsOf(0);

export function emit(e: Ent, tick: number, ev: number[]) {
  if (e.evTick !== tick) {
    e.evTick = tick;
    e.evs.length = 0;
  }
  e.evs.push(ev);
}
export function pushDmg(e: Ent, tick: number, amount: number, flags: number, src: number) {
  if (e.dmgTick !== tick) {
    e.dmgTick = tick;
    e.dmgs.length = 0;
  }
  e.dmgs.push([e.id, amount, flags, src]);
}

function refresh(e: Ent) {
  let mask = 0;
  for (const s of e.st) mask |= 1 << s.i;
  e.mask = mask;
  e.mods = mask ? modsOf(mask) : NO_MODS;
  e.sver++;
  e.onStatusChange();
}

export function applyStatus(e: Ent, idx: number, tick: number, power: number, src: number, stacks = 1, extraMax = 0, durMul = 1) {
  if (e.dead || (e.immune && e.immune & (1 << idx))) return;
  const def = STATUS[idx], until = tick + Math.ceil((def.ms * durMul) / TICK_MS), max = def.maxStacks + extraMax;
  const cur = e.st.find((s) => s.i === idx);
  if (cur) {
    cur.until = until;
    cur.stacks = Math.min(max, cur.stacks + stacks);
    cur.power = Math.max(cur.power, power);
    cur.src = src;
  } else e.st.push({ i: idx, until, stacks: Math.min(max, stacks), power, nextDot: tick + 20, src });
  refresh(e);
}

export function removeStatus(e: Ent, idx: number) {
  const i = e.st.findIndex((s) => s.i === idx);
  if (i < 0) return false;
  e.st.splice(i, 1);
  refresh(e);
  return true;
}
/** Removes every debuff; returns how many were removed. */
export function cleanse(e: Ent): number {
  const n = e.st.length;
  e.st = e.st.filter((s) => !STATUS[s.i].debuff);
  if (e.st.length !== n) refresh(e);
  return n - e.st.length;
}

export function clearStatuses(e: Ent) {
  if (!e.st.length) return;
  e.st.length = 0;
  refresh(e);
}

/** Expires statuses and returns damage-over-time ticks to apply: [amount, srcId] pairs. */
export function tickStatuses(e: Ent, tick: number, out: number[]) {
  if (!e.st.length) return;
  let changed = false;
  for (let i = e.st.length - 1; i >= 0; i--) {
    const s = e.st[i];
    if (tick >= s.until) {
      e.st.splice(i, 1);
      changed = true;
      continue;
    }
    const dot = STATUS[s.i].dot;
    if (dot && tick >= s.nextDot) {
      s.nextDot += 20;
      out.push(Math.max(1, Math.round(s.power * dot * s.stacks)), s.src);
    }
  }
  if (changed) refresh(e);
}
