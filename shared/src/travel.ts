// Smart travel: the quickest way from one place in the world to another, walking through portals or
// teleporting from a waystone when that is shorter. Pure and shared: the client plans with it (click
// on the world map, a quest, following the party leader) and tests check its choices.
//
// The world is a small graph: each region's portals and its waykeeper are the points of interest.
// Distances inside a region are straight lines stretched a little (paths wind around obstacles); a
// teleport costs a fixed equivalent of walking (the time at the waystone), so a short walk is never
// replaced by a detour through a waystone.
import { teleportCost, waypointId, zoneObjects } from './places';
import { TILE } from './protocol';
import { REGIONS, tileCenter, ZONES } from './world';

export interface TravelCtx {
  level: number;
  gold: number;
  /** Discoveries (attuned waystones are `wp:<zone>`). */
  disc: Iterable<string>;
  /** Regions refuse characters below their level (the server's rule; off in some tests). */
  levelGates?: boolean;
  /** Recently fought: waystones refuse travel in combat. */
  inCombat?: boolean;
}
export interface Place { zone: string; x: number; y: number }
export type Leg =
  /** Walk to the point: the end of the journey. */
  | ({ kind: 'walk' } & Place)
  /** Walk onto the portal at the point; it leads to `to`. */
  | ({ kind: 'portal'; to: string } & Place)
  /** Walk to the waykeeper at the point and teleport to `to`. */
  | ({ kind: 'tp'; to: string; cost: number } & Place);
export interface Route { legs: Leg[]; /** Walking distance, with teleports at their fixed cost. */ cost: number; /** Gold spent on teleports. */ gold: number }

/** Paths wind: a straight line inside a region is taken as this much longer. */
const WIND = 1.25;
/** A teleport is worth this much walking (about five seconds on foot). */
export const TELEPORT_WALK = 900;
/** Where a teleport arrives, relative to the waykeeper (as the server places the traveller). */
const ARRIVE_DY = 48;

const waykeeper = (zone: string) => zoneObjects(zone).find((o) => o.kind === 'waykeeper');
/** Whether this character may enter the zone at all. */
export function canEnter(zone: string, ctx: TravelCtx): boolean {
  const z = ZONES[zone];
  if (!z || z.kind === 'dungeon') return false;
  if (z.depth) return ctx.level >= ZONES[z.depth.host].level[0];
  return ctx.levelGates === false || !REGIONS.includes(zone) || ctx.level >= z.level[0];
}

interface Node extends Place { d: number; prev: Node | null; via: Leg | null; gold: number; done?: boolean }

/** The quickest route, or null when the destination cannot be reached (unknown, a dungeon, or closed to this level). */
export function planRoute(from: Place, to: Place, ctx: TravelCtx): Route | null {
  if (!ZONES[from.zone] || !canEnter(to.zone, ctx)) return null;
  const disc = new Set(ctx.disc);
  const open: Node[] = [{ ...from, d: 0, prev: null, via: null, gold: 0 }];
  // the best distance known to each point of interest
  const best = new Map<string, number>();
  const key = (p: Place) => `${p.zone}:${Math.round(p.x)}:${Math.round(p.y)}`;
  const push = (n: Node) => {
    const k = key(n);
    if ((best.get(k) ?? Infinity) <= n.d) return;
    best.set(k, n.d);
    open.push(n);
  };
  const walk = (a: Place, x: number, y: number) => Math.hypot(a.x - x, a.y - y) * WIND;
  for (let guard = 0; guard < 4000 && open.length; guard++) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.d > (best.get(key(cur)) ?? Infinity)) continue;
    if (cur.via?.kind === 'walk') {
      const legs: Leg[] = [];
      for (let n: Node | null = cur; n; n = n.prev) if (n.via) legs.unshift(n.via);
      return { legs, cost: cur.d, gold: cur.gold };
    }
    // the destination, when it is in this region
    if (cur.zone === to.zone) push({ ...to, d: cur.d + walk(cur, to.x, to.y), prev: cur, via: { kind: 'walk', ...to }, gold: cur.gold });
    // each portal of this region
    for (const p of ZONES[cur.zone].portals) {
      if (!ZONES[p.to] || !canEnter(p.to, ctx)) continue;
      const px = tileCenter(p.tx), py = tileCenter(p.ty);
      push({ zone: p.to, x: tileCenter(p.toTx), y: tileCenter(p.toTy), d: cur.d + walk(cur, px, py) + TILE, prev: cur, via: { kind: 'portal', zone: cur.zone, x: px, y: py, to: p.to }, gold: cur.gold });
    }
    // the waystone: to every attuned region the character may enter and can pay for
    const wk = ctx.inCombat ? undefined : waykeeper(cur.zone);
    if (wk)
      for (const z of REGIONS) {
        if (z === cur.zone || !disc.has(waypointId(z)) || !canEnter(z, ctx)) continue;
        const there = waykeeper(z), cost = teleportCost(z);
        if (!there || cur.gold + cost > ctx.gold) continue;
        push({ zone: z, x: there.x, y: there.y + ARRIVE_DY, d: cur.d + walk(cur, wk.x, wk.y) + TELEPORT_WALK, prev: cur, via: { kind: 'tp', zone: cur.zone, x: wk.x, y: wk.y, to: z, cost }, gold: cur.gold + cost });
      }
  }
  return null;
}
/** A short description of a route for the status line: "walk", or the regions passed and how. */
export function routeSummary(r: Route): { tp: number; portals: number; zones: string[] } {
  return { tp: r.legs.filter((l) => l.kind === 'tp').length, portals: r.legs.filter((l) => l.kind === 'portal').length, zones: r.legs.filter((l) => l.kind !== 'walk').map((l) => (l as { to: string }).to) };
}
