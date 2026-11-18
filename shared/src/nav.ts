// Navigation data for a zone: which tiles can be walked, which of those are connected to where
// players arrive, and a bounded path search between tiles. Derived deterministically from the
// zone map, so server (monster AI, spawn validation, auto hunting) and client (auto hunting,
// developer overlay) agree without sending anything.
import { TILE } from './protocol';
import { blocked, getZoneMap, SOLID, tileAt, tileCenter, type ZoneMap } from './world';

export interface Nav {
  map: ZoneMap;
  /** 1 = the tile is not solid. */
  walk: Uint8Array;
  /** 1 = walkable and connected (by walking) to the zone's arrival point. */
  reach: Uint8Array;
  /** Number of reachable tiles. */
  size: number;
}
const cache = new Map<string, Nav>();
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function navOf(zoneId: string): Nav {
  let nav = cache.get(zoneId);
  if (nav) return nav;
  const map = getZoneMap(zoneId), n = map.w * map.h, walk = new Uint8Array(n), reach = new Uint8Array(n);
  for (let i = 0; i < n; i++) walk[i] = SOLID[map.tiles[i]] ? 0 : 1;
  // flood fill from where players arrive; the outermost ring of tiles is never used
  const start = map.def.spawn.tx + map.def.spawn.ty * map.w, stack = [start];
  let size = 0;
  if (walk[start]) reach[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    if (!reach[i]) continue;
    size++;
    const x = i % map.w, y = (i / map.w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy, j = nx + ny * map.w;
      if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1 || reach[j] || !walk[j]) continue;
      reach[j] = 1;
      stack.push(j);
    }
  }
  nav = { map, walk, reach, size };
  cache.set(zoneId, nav);
  return nav;
}
export const tileOf = (v: number) => Math.floor(v / TILE);
export const reachableAt = (nav: Nav, x: number, y: number) => {
  const tx = tileOf(x), ty = tileOf(y);
  return tx >= 0 && ty >= 0 && tx < nav.map.w && ty < nav.map.h && nav.reach[tx + ty * nav.map.w] === 1;
};

/** Reachable tiles within `r` tiles (walking distance) of a tile, up to `cap`. A measure of elbow room. */
export function roomAround(nav: Nav, tx: number, ty: number, r: number, cap = 64): number {
  const w = nav.map.w, start = tx + ty * w;
  if (!nav.reach[start]) return 0;
  const seen = new Map<number, number>([[start, 0]]), queue = [start];
  for (let h = 0; h < queue.length && seen.size < cap; h++) {
    const i = queue[h], d = seen.get(i)!;
    if (d >= r) continue;
    for (const [dx, dy] of N4) {
      const j = i + dx + dy * w;
      if (!nav.reach[j] || seen.has(j)) continue;
      seen.set(j, d + 1);
      queue.push(j);
    }
  }
  return seen.size;
}

/** Why a monster may not be placed here; '' when the position is good. */
export type SpawnFault = '' | 'out-of-bounds' | 'inside-obstacle' | 'unreachable' | 'cramped';
/** A spawn needs this many reachable tiles within 3 steps (itself included): room to patrol, not a nook. */
export const SPAWN_MIN_ROOM = 9;
/**
 * Validates a spawn position. Walkers must stand clear of walls and objects, on ground that is
 * connected to the rest of the zone, with space to move. Flyers only need to be inside the map.
 */
export function spawnFault(nav: Nav, x: number, y: number, flying = false): SpawnFault {
  const map = nav.map, tx = tileOf(x), ty = tileOf(y);
  if (tx < 2 || ty < 2 || tx >= map.w - 2 || ty >= map.h - 2) return 'out-of-bounds';
  if (blocked(map, x, y)) return 'inside-obstacle';
  // flyers cross terrain freely, so they need neither a walking route nor elbow room
  if (flying) return '';
  if (!nav.reach[tx + ty * map.w]) return 'unreachable';
  if (roomAround(nav, tx, ty, 3, SPAWN_MIN_ROOM) < SPAWN_MIN_ROOM) return 'cramped';
  return '';
}

/** True if a body can walk the straight line between two points (sampled with the collision box). */
export function clearLine(map: ZoneMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 10);
  for (let i = 1; i <= n; i++) if (blocked(map, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)) return false;
  return true;
}
/**
 * True if nothing solid lies between two points (for attacks that need line of sight). With
 * `openEnd`, the tile the target is in does not count: a flying creature hovering over a tree or a
 * rock is in plain sight even though the ground under it is solid.
 */
export function lineOfSight(map: ZoneMap, x0: number, y0: number, x1: number, y1: number, openEnd = false): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 12), ex = tileOf(x1), ey = tileOf(y1);
  for (let i = 1; i < n; i++) {
    const sx = tileOf(x0 + ((x1 - x0) * i) / n), sy = tileOf(y0 + ((y1 - y0) * i) / n);
    if (openEnd && sx === ex && sy === ey) continue;
    const t = tileAt(map, sx, sy);
    // water does not block sight or projectiles; trees, walls, roofs and rock do
    if (SOLID[t] && t !== 2) return false;
  }
  return true;
}

// ---- A* over tiles, 4-connected, with a node budget so one search can never stall a tick ----
let gScore = new Float32Array(0), cameFrom = new Int32Array(0), stamp = new Uint32Array(0), closed = new Uint32Array(0), gen = 0;
const heap: number[] = [], heapF: number[] = [];
function push(i: number, f: number) {
  let k = heap.length;
  heap.push(i);
  heapF.push(f);
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heap[k] = heap[p];
    heapF[k] = heapF[p];
    k = p;
  }
  heap[k] = i;
  heapF[k] = f;
}
function pop(): number {
  const top = heap[0], li = heap.pop()!, lf = heapF.pop()!, n = heap.length;
  if (n) {
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heap[k] = heap[c];
      heapF[k] = heapF[c];
      k = c;
    }
    heap[k] = li;
    heapF[k] = lf;
  }
  return top;
}
export const PATH_BUDGET = 900;
const noPath = (): null => {
  pathStats.failed++;
  return null;
};
// (declared before use below)
/** Searches performed and nodes expanded since the counters were last reset (for CPU measurements). */
export const pathStats = { searches: 0, nodes: 0, failed: 0 };
/**
 * Shortest walkable route between two tiles as a list of tile indices (start excluded, goal
 * included). Returns null when there is none within the node budget.
 */
export function findPath(nav: Nav, sx: number, sy: number, gx: number, gy: number, budget = PATH_BUDGET): number[] | null {
  const w = nav.map.w, n = w * nav.map.h, start = sx + sy * w, goal = gx + gy * w;
  pathStats.searches++;
  if (start === goal) return [];
  if (sx < 0 || sy < 0 || gx < 0 || gy < 0 || sx >= w || gx >= w || start >= n || goal >= n || !nav.walk[start] || !nav.walk[goal]) return noPath();
  // different islands can never be joined: answer at once instead of spending the budget
  if (nav.reach[start] !== nav.reach[goal]) return noPath();
  if (gScore.length < n) {
    gScore = new Float32Array(n);
    cameFrom = new Int32Array(n);
    stamp = new Uint32Array(n);
    closed = new Uint32Array(n);
  }
  gen++;
  heap.length = heapF.length = 0;
  gScore[start] = 0;
  stamp[start] = gen;
  push(start, Math.abs(gx - sx) + Math.abs(gy - sy));
  let used = 0;
  while (heap.length && used < budget) {
    const cur = pop();
    if (cur === goal) {
      const out: number[] = [];
      for (let i = goal; i !== start; i = cameFrom[i]) out.push(i);
      pathStats.nodes += used;
      return out.reverse();
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    used++;
    const cx = cur % w, cy = (cur / w) | 0, g = gScore[cur] + 1;
    for (const [dx, dy] of N4) {
      const nx = cx + dx, ny = cy + dy, j = nx + ny * w;
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= nav.map.h - 1 || !nav.walk[j] || closed[j] === gen) continue;
      if (stamp[j] === gen && gScore[j] <= g) continue;
      stamp[j] = gen;
      gScore[j] = g;
      cameFrom[j] = cur;
      push(j, g + Math.abs(gx - nx) + Math.abs(gy - ny));
    }
  }
  pathStats.nodes += used;
  pathStats.failed++;
  return null;
}
export const tileXY = (nav: Nav, i: number) => ({ x: tileCenter(i % nav.map.w), y: tileCenter((i / nav.map.w) | 0) });

/**
 * Walking distance (in steps) from a tile to every tile reachable from it within `maxSteps`: one
 * breadth-first sweep, shared by every question the auto hunter asks in a decision.
 */
export function walkField(nav: Nav, sx: number, sy: number, maxSteps: number, cap = 6000): Map<number, number> {
  const w = nav.map.w, start = sx + sy * w, out = new Map<number, number>();
  if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= nav.map.h - 1 || !nav.walk[start]) return out;
  out.set(start, 0);
  const queue = [start];
  for (let h = 0; h < queue.length && out.size < cap; h++) {
    const i = queue[h], d = out.get(i)!;
    if (d >= maxSteps) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy, j = nx + ny * w;
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= nav.map.h - 1 || !nav.walk[j] || out.has(j)) continue;
      out.set(j, d + 1);
      queue.push(j);
    }
  }
  return out;
}
/**
 * Where to stand to hit a target: the reachable tile (fewest steps in `field`) from which the
 * target is within `reach` (measured to its body, `radius`) and in plain sight. Null when there is
 * none: the target is behind obstacles that cannot be walked around within the field.
 */
export function attackSpot(nav: Nav, field: Map<number, number>, tx: number, ty: number, radius: number, reach: number, flying = false): { x: number; y: number; steps: number } | null {
  const map = nav.map, w = map.w, cx = tileOf(tx), cy = tileOf(ty), r = Math.ceil((reach + radius) / TILE) + 1;
  let best: { x: number; y: number; steps: number } | null = null, bestD = Infinity;
  for (let y = Math.max(1, cy - r); y <= Math.min(map.h - 2, cy + r); y++)
    for (let x = Math.max(1, cx - r); x <= Math.min(w - 2, cx + r); x++) {
      const steps = field.get(x + y * w);
      if (steps === undefined || (best && steps > best.steps)) continue;
      const px = tileCenter(x), py = tileCenter(y), d = Math.hypot(tx - px, ty - py) - radius;
      if (d > reach || !lineOfSight(map, px, py, tx, ty, flying)) continue;
      // equal steps: prefer the spot nearer the target, so a melee fighter stands next to it
      if (!best || steps < best.steps || d < bestD) {
        best = { x: px, y: py, steps };
        bestD = d;
      }
    }
  return best;
}
