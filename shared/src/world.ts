// Deterministic world data + movement shared by server (authority) and client (prediction).
import { PLAYER_HALF, RUN_SPEED, TICK_MS, TILE, WALK_SPEED } from './protocol';
import { EXPANSION } from './expansion';
import { DEPTH_LAYOUT, DEPTH_SANCTUARY_R, DEPTHS } from './depths';

export const enum T {
  Grass = 0,
  Path = 1,
  Water = 2,
  Tree = 3,
  Wall = 4,
  Roof = 5,
  Portal = 6,
  Flower = 7,
  Plaza = 8,
  /** Solid dungeon rock. */
  Rock = 9,
  /** Dungeon entrance: walkable, opens the dungeon dialog. */
  Gate = 10,
  /** Paving that cannot be walked on: under a statue, a market stall, a tower. Drawn as plaza. */
  Block = 11,
}
export const SOLID: boolean[] = [];
SOLID[T.Water] = SOLID[T.Tree] = SOLID[T.Wall] = SOLID[T.Roof] = SOLID[T.Rock] = SOLID[T.Block] = true;

export interface Portal {
  tx: number;
  ty: number;
  to: string;
  toTx: number;
  toTy: number;
}
export interface ZoneDef {
  id: string;
  name: string;
  seed: number;
  w: number;
  h: number;
  theme: Theme;
  spawn: { tx: number; ty: number };
  portals: Portal[];
  /** Recommended character levels. */
  level: [number, number];
  kind?: 'dungeon';
  /** Centre of the settlement (plaza and houses). */
  town?: { tx: number; ty: number; name: string };
  /** Dungeon entrances. */
  gates?: { tx: number; ty: number; dungeon: string }[];
  /** Open ground kept clear of trees and water (boss arenas, landmarks). */
  clearings?: { tx: number; ty: number; r: number }[];
  /** Lairs of elite monsters: open ground in the wild, reached by a trail. */
  lairs?: { tx: number; ty: number; r: number }[];
  /** One of the Depths (depths.ts): open PvP everywhere outside its sanctuary. */
  depth?: { host: string };
  /** Where nobody can be attacked and no monster comes: the arrival court of the Depths. */
  sanctuary?: { tx: number; ty: number; r: number };
  blurb: string;
}
export type Theme = 'kingdom' | 'forest' | 'ashen' | 'frost' | 'moor' | 'astral' | 'ruins' | 'lair' | 'citadel' | 'temple';
/** Terrain generation per theme: noise thresholds for obstacles and liquid, and how often flora appears. */
const GEN: Record<Theme, { tree: number; water: number; flora: number }> = {
  kingdom: { tree: 0.72, water: 0.78, flora: 0.04 }, forest: { tree: 0.55, water: 0.78, flora: 0.04 },
  ashen: { tree: 0.7, water: 0.75, flora: 0.012 }, frost: { tree: 0.62, water: 0.8, flora: 0.015 },
  moor: { tree: 0.64, water: 0.68, flora: 0.03 }, astral: { tree: 0.7, water: 0.74, flora: 0.02 },
  ruins: { tree: 1, water: 1, flora: 0.02 }, lair: { tree: 1, water: 1, flora: 0 }, citadel: { tree: 1, water: 1, flora: 0.01 }, temple: { tree: 1, water: 1, flora: 0.01 },
};
/** Where a dungeon's exit portal leads: resolved per player by the server. */
export const EXIT = '@exit';

const region = (id: string, name: string, seed: number, theme: Theme, level: [number, number], prev: string, prevW: number, next: string | null, o: Partial<ZoneDef>): ZoneDef => ({
  id, name, seed, w: 120, h: 80, theme, level, spawn: { tx: 6, ty: 40 },
  portals: [{ tx: 2, ty: 40, to: prev, toTx: prevW - 5, toTy: 40 }, ...(next ? [{ tx: 117, ty: 40, to: next, toTx: 4, toTy: 40 }] : [])],
  blurb: '', ...o,
});
/** Dungeon interiors: an entry hall, five combat chambers along a corridor, then the boss hall. */
export const DUNGEON_W = 162, DUNGEON_H = 48, DUNGEON_MID = 24;
const dungeonZone = (id: string, name: string, seed: number, theme: Theme, level: number, blurb: string): ZoneDef => ({
  id, name, seed, w: DUNGEON_W, h: DUNGEON_H, theme, level: [level, level + 4], kind: 'dungeon', spawn: { tx: 9, ty: DUNGEON_MID },
  portals: [{ tx: 5, ty: DUNGEON_MID, to: EXIT, toTx: 0, toTy: 0 }], blurb,
});
// Six regions in a chain from west to east, plus four dungeon interiors (instanced per party).
export const ZONES: Record<string, ZoneDef> = {
  eldoria: {
    id: 'eldoria', name: 'Eldoria', seed: 0xae7e01, w: 96, h: 96, theme: 'kingdom', level: [1, 5],
    spawn: { tx: 48, ty: 50 }, town: { tx: 48, ty: 50, name: 'Eldoria' },
    portals: [{ tx: 93, ty: 48, to: 'verdant', toTx: 4, toTy: 40 }],
    blurb: 'The last free kingdom, raised on the grave of a fallen star.',
  },
  verdant: {
    id: 'verdant', name: 'Verdant Reach', seed: 0x5eed02, w: 96, h: 80, theme: 'forest', level: [4, 10],
    spawn: { tx: 6, ty: 40 }, town: { tx: 16, ty: 30, name: 'Mosswatch' },
    portals: [{ tx: 2, ty: 40, to: 'eldoria', toTx: 91, toTy: 48 }, { tx: 93, ty: 40, to: 'ashen', toTx: 4, toTy: 40 }],
    gates: [{ tx: 48, ty: 68, dungeon: 'ruins' }],
    blurb: 'An old forest that remembers the world before the kingdoms.',
  },
  ashen: region('ashen', 'Ashen Highlands', 0xa5e003, 'ashen', [10, 18], 'verdant', 96, 'frostveil', {
    town: { tx: 16, ty: 30, name: 'Cinderhold' }, gates: [{ tx: 60, ty: 68, dungeon: 'lair' }],
    blurb: 'Burnt uplands where the mountain still breathes fire.',
  }),
  frostveil: region('frostveil', 'Frostveil', 0xf05704, 'frost', [18, 26], 'ashen', 120, 'dreadmoor', {
    town: { tx: 16, ty: 30, name: 'Hearthglen' }, gates: [{ tx: 60, ty: 68, dungeon: 'citadel' }],
    blurb: 'A valley under a winter that has not ended in three hundred years.',
  }),
  dreadmoor: region('dreadmoor', 'Dreadmoor', 0xd4ead5, 'moor', [26, 34], 'frostveil', 120, 'astral', {
    town: { tx: 16, ty: 30, name: 'Lanternfen' }, gates: [{ tx: 96, ty: 68, dungeon: 'temple' }], clearings: [{ tx: 60, ty: 12, r: 9 }],
    blurb: 'Drowned battlefields where the dead keep their watch.',
  }),
  astral: region('astral', 'Astral Ruins', 0xa57a16, 'astral', [34, 45], 'dreadmoor', 120, EXPANSION[0].id, {
    town: { tx: 16, ty: 30, name: 'Starfall Camp' }, clearings: [{ tx: 60, ty: 12, r: 10 }],
    blurb: 'The shattered city of the Runewrights, adrift between the world and the void.',
  }),
  d_ruins: dungeonZone('d_ruins', 'Ancient Ruins', 0xd00001, 'ruins', 8, 'A sealed vault of the Runewrights beneath the forest floor.'),
  d_lair: dungeonZone('d_lair', "Dragon's Lair", 0xd00002, 'lair', 16, 'Caverns of cooling glass around the heart of the mountain.'),
  d_citadel: dungeonZone('d_citadel', 'Frozen Citadel', 0xd00003, 'citadel', 24, 'The throne hall of a queen who would not die.'),
  d_temple: dungeonZone('d_temple', 'Abyssal Temple', 0xd00004, 'temple', 32, 'A sunken shrine to something that should have stayed asleep.'),
};
// where the first regions' elites live (the same places as their camps in monsters.ts)
for (const [z, tx, ty] of [['ashen', 60, 12], ['frostveil', 58, 12], ['dreadmoor', 20, 68], ['astral', 24, 68]] as const) ZONES[z].lairs = [{ tx, ty, r: 5 }];
// Levels 45-200: the regions of the expansion, chained east of the Astral Ruins (see expansion.ts).
EXPANSION.forEach((e, i) => {
  const prev = i ? EXPANSION[i - 1].id : 'astral', next = EXPANSION[i + 1]?.id ?? null;
  ZONES[e.id] = region(e.id, e.name, e.seed, e.theme, e.level, prev, 120, next, {
    town: { tx: 16, ty: 30, name: e.town }, gates: [{ tx: i % 2 ? 96 : 60, ty: 68, dungeon: e.dungeon.id }],
    ...(e.world ? { clearings: [{ tx: 60, ty: 12, r: 10 }] } : {}), lairs: [{ tx: e.world ? 24 : 60, ty: e.world ? 66 : 12, r: 5 }], blurb: e.blurb,
  });
  ZONES[`d_${e.dungeon.id}`] = dungeonZone(`d_${e.dungeon.id}`, e.dungeon.name, e.seed ^ 0xd0d0, e.dungeon.theme, e.dungeon.bossLevel - 2, e.dungeon.blurb);
});
// The Depths: an open map behind a portal in every third region (depths.ts).
for (const d of DEPTHS) {
  const host = ZONES[d.host], L = DEPTH_LAYOUT;
  host.portals.push({ tx: L.door.tx, ty: L.door.ty, to: d.id, toTx: L.spawn.tx, toTy: L.spawn.ty });
  ZONES[d.id] = {
    id: d.id, name: d.name, seed: d.seed, w: 120, h: 80, theme: host.theme, level: [host.level[0] + 3, d.boss.level], spawn: { ...L.spawn },
    portals: [{ tx: L.exit.tx, ty: L.exit.ty, to: d.host, toTx: L.back.tx, toTy: L.back.ty }],
    depth: { host: d.host }, sanctuary: { tx: L.spawn.tx - 1, ty: L.spawn.ty, r: DEPTH_SANCTUARY_R },
    clearings: [{ ...L.boss }], lairs: L.elites.map((e) => ({ ...e, r: 5 })), blurb: d.blurb,
  };
}
/** The Depths, in the order of their host regions. */
export const DEPTH_ZONES = DEPTHS.map((d) => d.id);
// The Endless Rift: the same interior as a dungeon; every floor is fought in its great hall.
// a home: a small house of one's own (instanced per owner), with a door back out
ZONES.h_home = { id: 'h_home', name: 'Home', seed: 0x40e, w: 26, h: 18, theme: 'kingdom', level: [1, 1], kind: 'dungeon', spawn: { tx: 13, ty: 13 }, portals: [{ tx: 13, ty: 16, to: EXIT, toTx: 0, toTy: 0 }], blurb: 'A home of your own.' };
ZONES.d_raid = dungeonZone('d_raid', "The Shadow's Sanctum", 0xd0a0aa, 'citadel', 100, 'The throne room where the fallen star\'s shadow waits.');
ZONES.d_rift = dungeonZone('d_rift', 'The Endless Rift', 0xd0d0ff, 'temple', 20, 'A tower of floors without end, torn open where the star fell.');
/** Open-world regions in travel order. */
export const REGIONS = ['eldoria', 'verdant', 'ashen', 'frostveil', 'dreadmoor', 'astral', ...EXPANSION.map((e) => e.id)];

// ---------------------------------------------------------------------------------------------
// The shape of the world. Eldoria lies in the middle; the other regions lie around it in the eight
// compass directions, two deep: a nearer region and a farther one in each direction, in order of
// level going round from the east (east 4-18, north-east 18-34, north 34-60 ... south-east 180-200).
// Eldoria has a gate in each direction leading straight to the nearer region there; the regions
// also keep their own road from one to the next. The world map draws exactly this.
// ---------------------------------------------------------------------------------------------
export const COMPASS = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'] as const;
export type Compass = (typeof COMPASS)[number];
/** Unit steps on the map: x to the east, y to the south. */
export const COMPASS_VEC: Record<Compass, [number, number]> = { e: [1, 0], ne: [0.72, -0.72], n: [0, -1], nw: [-0.72, -0.72], w: [-1, 0], sw: [-0.72, 0.72], s: [0, 1], se: [0.72, 0.72] };
export interface WorldPlace { dir: Compass; ring: 1 | 2 }
/** Where each region lies from Eldoria (Eldoria itself is the centre and has no entry). */
export const WORLD_LAYOUT: Record<string, WorldPlace> = Object.fromEntries(
  REGIONS.slice(1).map((id, i) => [id, { dir: COMPASS[Math.floor(i / 2)], ring: ((i % 2) + 1) as 1 | 2 }]),
);
/** The nearer region in a direction: the one Eldoria's gate there leads to. */
export const innerRegion = (dir: Compass) => REGIONS.find((id) => WORLD_LAYOUT[id]?.dir === dir && WORLD_LAYOUT[id].ring === 1)!;
/** A region suits a character of this level: strong enough to hunt there, not yet far beyond it. */
export const recommendedFor = (level: number, zone: string) => !!ZONES[zone] && level >= ZONES[zone].level[0] && level <= ZONES[zone].level[1] + 2;
{
  // Eldoria's gates (designed tiles, 96x96) and, in each nearer region (120x80), the gate back on
  // the side that faces Eldoria. The east gate is the old road to Verdant Reach.
  const E_GATE: Record<Compass, [number, number]> = { e: [93, 48], ne: [88, 8], n: [48, 2], nw: [8, 8], w: [2, 48], sw: [8, 88], s: [48, 93], se: [88, 88] };
  const BACK: Record<Compass, [number, number]> = { e: [2, 40], ne: [8, 72], n: [60, 77], nw: [112, 72], w: [117, 62], sw: [112, 8], s: [34, 2], se: [8, 8] };
  const inward = (x: number, y: number, w: number, h: number): [number, number] => [x + Math.sign(w / 2 - x) * 3, y + Math.sign(h / 2 - y) * (Math.abs(h / 2 - y) > 6 ? 3 : 0)];
  for (const dir of COMPASS) {
    if (dir === 'e') continue;
    const id = innerRegion(dir), z = ZONES[id], [gx, gy] = E_GATE[dir], [bx, by] = BACK[dir];
    const [ax, ay] = inward(bx, by, z.w, z.h), [hx, hy] = inward(gx, gy, 96, 96);
    ZONES.eldoria.portals.push({ tx: gx, ty: gy, to: id, toTx: ax, toTy: ay });
    z.portals.push({ tx: bx, ty: by, to: 'eldoria', toTx: hx, toTy: hy });
  }
}

// ---------------------------------------------------------------------------------------------
// Open-world maps are 1.5 times their designed size. Every coordinate written above (spawn
// points, portals and their arrival points, villages, dungeon gates, clearings) is in designed
// tiles and is scaled here once, so the rest of the game only ever sees the final map.
// ---------------------------------------------------------------------------------------------
export const MAP_SCALE = 1.5;
/**
 * Monsters keep this far (tiles) from a village's centre: no camp is placed, no patrol leads and
 * no chase follows inside it (the village radius of 14 plus a wide margin of open ground).
 */
export const MONSTER_TOWN_CLEAR = 28;
/** A designed tile coordinate in an open-world map, as a tile of the final map. */
export const scaleTile = (v: number) => Math.round(v * MAP_SCALE);
{
  const open = (id: string) => !!ZONES[id] && ZONES[id].kind !== 'dungeon';
  for (const z of Object.values(ZONES)) {
    for (const p of z.portals)
      if (open(p.to)) {
        p.toTx = scaleTile(p.toTx);
        p.toTy = scaleTile(p.toTy);
      }
    if (z.kind === 'dungeon') continue;
    z.w = scaleTile(z.w);
    z.h = scaleTile(z.h);
    z.spawn = { tx: scaleTile(z.spawn.tx), ty: scaleTile(z.spawn.ty) };
    for (const p of z.portals) {
      p.tx = scaleTile(p.tx);
      p.ty = scaleTile(p.ty);
    }
    if (z.town) z.town = { ...z.town, tx: scaleTile(z.town.tx), ty: scaleTile(z.town.ty) };
    z.gates = z.gates?.map((g) => ({ ...g, tx: scaleTile(g.tx), ty: scaleTile(g.ty) }));
    z.clearings = z.clearings?.map((c) => ({ tx: scaleTile(c.tx), ty: scaleTile(c.ty), r: scaleTile(c.r) }));
    z.lairs = z.lairs?.map((c) => ({ tx: scaleTile(c.tx), ty: scaleTile(c.ty), r: scaleTile(c.r) }));
    if (z.sanctuary) z.sanctuary = { tx: scaleTile(z.sanctuary.tx), ty: scaleTile(z.sanctuary.ty), r: scaleTile(z.sanctuary.r) };
  }
  // portals sit on the edge: keep them two tiles in from it, and their arrival points inside the map
  for (const z of Object.values(ZONES)) {
    if (z.kind === 'dungeon') continue;
    for (const p of z.portals) {
      p.tx = Math.max(2, Math.min(z.w - 3, p.tx));
      const to = ZONES[p.to];
      if (to && to.kind !== 'dungeon') p.toTx = Math.max(4, Math.min(to.w - 5, p.toTx));
    }
  }
}
// ---------------------------------------------------------------------------------------------
// Eldoria, the capital: a walled city. Everything is in tiles from the city's centre (the spawn
// point) on the final map. The wall has a gate in each of the eight directions (the four sides
// and the four corners); inside, each trade has its own house and yard, and the townsfolk stand
// at theirs (places.ts puts them on these spots, decor.ts dresses the yards).
// ---------------------------------------------------------------------------------------------
export const CITY = {
  /** Half the wall's width and height: the wall runs along x = +-wx, y = +-wy. */
  wx: 31, wy: 28,
  /** Houses and halls: top-left corner, width (each is 3 roof rows over 2 wall rows). */
  buildings: {
    bank: [16, -8, 9], armoury: [-24, -8, 9], runeshop: [14, 3, 7], library: [-20, 3, 7], stewardhouse: [22, 12, 7],
    house1: [-28, -22, 7], house2: [-28, 12, 7], house3: [4, 15, 6], house4: [24, -17, 6],
  } as Record<string, [number, number, number]>,
  /** The arena: a walled ring of sand (outer rectangle), its gate in the middle of the south side. */
  arena: { x0: -17, y0: -24, x1: -5, y1: -17 },
  /** Where each of the townsfolk stands, by the kind of their trade. */
  npcs: {
    merchant: [-20, -3], banker: [20, -3], runesmith: [17, 9], lorekeeper: [-17, 9], steward: [25, 18],
    arenamaster: [-11, -15], riftwarden: [13, -18], raidherald: [5, -12], waykeeper: [-9, 16],
  } as Record<string, [number, number]>,
  statue: [0, -5] as [number, number],
  fountain: [0, 6] as [number, number],
  rift: [13, -21] as [number, number],
  waystone: [-9, 19] as [number, number],
  /**
   * Scenery: [kind, x, y, solid tiles]. x and y are where its foot stands, in tiles from the centre
   * (fractions allowed); with solid tiles > 0 that many tiles under it cannot be walked on.
   */
  decor: [
    ['statue', 0, -4, 0], ['fountain', 0.5, 7.2, 0], ['planter', -2.2, -3.6, 0], ['planter', 2.2, -3.6, 0],
    // the bank and its market
    ['stall_red', 15, -2, 2], ['stall_blue', 26, -2, 2], ['crate', 13.3, -1.7, 0], ['barrel', 27.6, -1.8, 0], ['crate', 24.2, -1.7, 0],
    // the armoury
    ['weapon_rack', -23.5, -2, 1], ['potion_table', -16, -2, 2], ['armor_stand', -14.4, -2, 1], ['barrel', -25.2, -1.8, 0],
    // the arena's forecourt
    ['sword_ground', -13.5, -14.2, 0], ['shield_ground', -8.5, -14.2, 0], ['sword_ground', -14.3, -12.5, 0], ['shield_ground', -7.7, -12.5, 0], ['dummy', -6.5, -13, 1],
    // the rift and the watch fire before it
    ['rift', 13.5, -20, 0], ['campfire', 11.5, -17.2, 1], ['sword_ground', 15.8, -17.4, 0],
    // the raid herald's banners, the rune shop, the library, the waygate, the housing steward
    ['war_banner', 3.5, -11.1, 0], ['war_banner', 7.5, -11.1, 0],
    ['rune_stone', 15, 9.9, 1], ['rune_stone', 20, 9.9, 1], ['bookstand', -19, 9.9, 1], ['bookstand', -14, 9.9, 1],
    ['waygate', -8.5, 19.9, 1], ['signpost', 27.5, 18.9, 0],
    // street lamps
    ['lamp', -7.5, -6, 0], ['lamp', 8.5, -6, 0], ['lamp', -7.5, 7, 0], ['lamp', 8.5, 7, 0], ['lamp', 2.6, -15, 0], ['lamp', 2.6, 16, 0], ['lamp', -15, -1.6, 0], ['lamp', 16, -1.6, 0],
    ['lamp', 2.6, -24, 0], ['lamp', 2.6, 25, 0], ['lamp', -26, -1.6, 0], ['lamp', 27, 2.4, 0],
  ] as [string, number, number, number][],
};
/** Inside the capital's wall (world pixels), or within `margin` tiles outside it. */
export function inCity(zone: string, x: number, y: number, margin = 0): boolean {
  if (zone !== 'eldoria') return false;
  const z = ZONES.eldoria;
  return Math.abs(x / TILE - z.spawn.tx - 0.5) <= CITY.wx + 1 + margin && Math.abs(y / TILE - z.spawn.ty - 0.5) <= CITY.wy + 2 + margin;
}
export interface Decor { kind: string; x: number; y: number }
const decorCache = new Map<string, Decor[]>();
/** The scenery standing in a zone (world pixels at each piece's foot). Only the capital has any. */
export function cityDecor(zoneId: string): Decor[] {
  let list = decorCache.get(zoneId);
  if (list) return list;
  list = [];
  decorCache.set(zoneId, list);
  if (zoneId !== 'eldoria') return list;
  const C = CITY, z = ZONES.eldoria, cx = z.spawn.tx, cy = z.spawn.ty, px = (fx: number, fy: number) => ({ x: Math.round((cx + fx) * TILE), y: Math.round((cy + fy) * TILE) });
  for (const [kind, fx, fy] of C.decor) list.push({ kind, ...px(fx, fy) });
  // towers: the arena's corners, both sides of each gate, and the ends of the wall at the corner gates
  const A = C.arena, G = 3, CG = 5;
  for (const [fx, fy] of [
    [A.x0 + 1, A.y0 + 3], [A.x1, A.y0 + 3], [A.x0 + 1, A.y1 + 1], [A.x1, A.y1 + 1],
    [-G + 0.5, -C.wy + 1], [G + 0.5, -C.wy + 1], [-G + 0.5, C.wy + 3], [G + 0.5, C.wy + 3],
    [-C.wx, -G + 1], [-C.wx, G + 1], [C.wx + 1, -G + 1], [C.wx + 1, G + 1],
    [-C.wx + CG + 0.5, -C.wy + 1], [C.wx - CG + 0.5, -C.wy + 1], [-C.wx + CG + 0.5, C.wy + 3], [C.wx - CG + 0.5, C.wy + 3],
  ]) list.push({ kind: 'tower', ...px(fx, fy) });
  return list;
}

/** City-wall tiles of each zone (tile index): drawn as a stone rampart, not as a house. */
export const RAMPARTS: Record<string, Set<number>> = {};
export const isRampart = (zone: string, tx: number, ty: number, w: number) => !!RAMPARTS[zone]?.has(tx + ty * w);
/** Dungeon chambers, west to east: five combat rooms and the boss hall. Coordinates in tiles. */
export const DUNGEON_ROOMS = 4;
export const CHAMBERS = Array.from({ length: DUNGEON_ROOMS }, (_, k) =>
  k < DUNGEON_ROOMS - 1
    ? { x: 20 + k * 30, y: DUNGEON_MID - 13, w: 26, h: 26, cx: 33 + k * 30, cy: DUNGEON_MID }
    : { x: 20 + k * 30 - 2, y: DUNGEON_MID - 19, w: 38, h: 38, cx: 20 + k * 30 + 17, cy: DUNGEON_MID });
/** The boss hall's chamber index. */
export const BOSS_ROOM = DUNGEON_ROOMS - 1;
export const START_ZONE = 'eldoria';

export interface ZoneMap {
  def: ZoneDef;
  w: number;
  h: number;
  tiles: Uint8Array;
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed: number, w: number, h: number, cell: number): Float32Array {
  const rnd = mulberry32(seed);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell);
    let fy = y / cell - gy;
    fy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = Math.floor(x / cell);
      let fx = x / cell - gx;
      fx = fx * fx * (3 - 2 * fx);
      const a = g[gx + gy * gw], b = g[gx + 1 + gy * gw];
      const c = g[gx + (gy + 1) * gw], d = g[gx + 1 + (gy + 1) * gw];
      out[x + y * w] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

const cache = new Map<string, ZoneMap>();

export function getZoneMap(zoneId: string): ZoneMap {
  let m = cache.get(zoneId);
  if (!m) {
    const def = ZONES[zoneId];
    if (!def) throw new Error('unknown zone ' + zoneId);
    m = generate(def);
    cache.set(zoneId, m);
  }
  return m;
}

function generateDungeon(def: ZoneDef): ZoneMap {
  const { w, h } = def, tiles = new Uint8Array(w * h).fill(T.Rock), rnd = mulberry32(def.seed);
  const rect = (x0: number, y0: number, rw: number, rh: number, t: T) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[x + y * w] = t;
  };
  rect(3, DUNGEON_MID - 5, 13, 11, T.Plaza); // entry hall
  rect(16, DUNGEON_MID - 2, w - 40, 4, T.Path); // spine corridor
  for (const c of CHAMBERS) {
    // rough-hewn rooms: corners are chipped away so chambers do not read as plain boxes
    rect(c.x, c.y, c.w, c.h, T.Grass);
    for (const [cx, cy] of [[c.x, c.y], [c.x + c.w - 3, c.y], [c.x, c.y + c.h - 3], [c.x + c.w - 3, c.y + c.h - 3]]) rect(cx, cy, 3, 3, T.Rock);
    for (const [cx, cy] of [[c.x + 2, c.y + 2], [c.x + c.w - 3, c.y + 2], [c.x + 2, c.y + c.h - 3], [c.x + c.w - 3, c.y + c.h - 3]]) rect(cx, cy, 1, 1, T.Grass);
    // pillars and pools, never on the centre rows (the fighting lane stays open)
    for (let i = 0; i < 7; i++) {
      const px = c.x + 3 + Math.floor(rnd() * (c.w - 6)), py = c.y + 3 + Math.floor(rnd() * (c.h - 6));
      if (Math.abs(py - c.cy) < 4 || Math.abs(px - c.cx) < 3) continue;
      if (rnd() < 0.3) rect(px, py, 2, 2, T.Water);
      else tiles[px + py * w] = T.Tree;
    }
    for (let i = 0; i < 10; i++) {
      const fx = c.x + 2 + Math.floor(rnd() * (c.w - 4)), fy = c.y + 2 + Math.floor(rnd() * (c.h - 4));
      if (tiles[fx + fy * w] === T.Grass && rnd() < GEN[def.theme].flora * 20) tiles[fx + fy * w] = T.Flower;
    }
    rect(c.x, DUNGEON_MID - 2, c.w, 4, T.Path);
  }
  for (const p of def.portals) tiles[p.tx + p.ty * w] = T.Portal;
  return { def, w, h, tiles };
}

function generateHome(def: ZoneDef): ZoneMap {
  const { w, h } = def, tiles = new Uint8Array(w * h).fill(T.Wall);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) tiles[x + y * w] = T.Plaza;
  // the garden along the east wall
  for (let x = 18; x < w - 2; x++) for (let y = 12; y < 15; y++) tiles[x + y * w] = T.Grass;
  for (const p of def.portals) {
    tiles[p.tx + (p.ty - 1) * w] = T.Plaza;
    tiles[p.tx + p.ty * w] = T.Portal;
  }
  return { def, w, h, tiles };
}

function generate(def: ZoneDef): ZoneMap {
  if (def.id === 'h_home') return generateHome(def);
  if (def.kind === 'dungeon') return generateDungeon(def);
  const { w, h } = def;
  const tiles = new Uint8Array(w * h);
  const rnd = mulberry32(def.seed);
  const gen = GEN[def.theme];
  const wet = valueNoise(def.seed ^ 0x1111, w, h, 12);
  const wood = valueNoise(def.seed ^ 0x2222, w, h, 6);
  // large shapes: forests gather into woods with open country between them; flowers grow in meadows
  const mass = valueNoise(def.seed ^ 0x3333, w, h, 18);
  const meadow = valueNoise(def.seed ^ 0x4444, w, h, 9);
  const set = (x: number, y: number, t: T) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[x + y * w] = t;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? (tiles[x + y * w] as T) : T.Tree);
  const rect = (x0: number, y0: number, rw: number, rh: number, t: T) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) set(x, y, t);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      let t: T = T.Grass;
      // a wood is dense at its heart and thins toward its edge; lone trees stand in open country
      const forest = wood[i] * 0.55 + mass[i] * 0.45 + (mass[i] > 0.56 ? 0.06 : -0.03);
      if (wet[i] > gen.water) t = T.Water;
      else if (forest > gen.tree && rnd() < 0.55 + (forest - gen.tree) * 4) t = T.Tree;
      else if (meadow[i] > 0.68 ? rnd() < Math.min(0.28, gen.flora * 8) : rnd() < gen.flora * 0.3) t = T.Flower;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) t = T.Tree;
      tiles[i] = t;
    }
  }

  // A stream from the wettest ground to the nearest edge, with fords to cross it.
  if (def.id !== 'eldoria') {
    let bx = 0, by = 0, best = -1;
    for (let y = 8; y < h - 8; y += 3) for (let x = 8; x < w - 8; x += 3) if (wet[x + y * w] > best) { best = wet[x + y * w]; bx = x; by = y; }
    if (best > gen.water) {
      const toEdge = by < h - by ? -1 : 1, len = toEdge < 0 ? by : h - by, ph = rnd() * 6.283;
      for (let k = 0; k < len; k++) {
        const y = by + toEdge * k, x = Math.round(bx + Math.sin(k * 0.22 + ph) * 4 + Math.sin(k * 0.07 + ph * 2) * 5);
        const ford = k % 16 >= 13; // three tiles of shallows every sixteen
        for (let dx = 0; dx < 2; dx++) if (x + dx > 2 && x + dx < w - 3 && y > 2 && y < h - 3) set(x + dx, y, ford ? T.Path : T.Water);
        for (const dx of [-1, 2]) if (get(x + dx, y) === T.Tree && x + dx > 2 && x + dx < w - 3 && y > 2 && y < h - 3) set(x + dx, y, T.Grass); // open banks
      }
    }
  }

  // Roads. Every road joins two places: the spawn, the portals, the village, dungeon gates and landmarks
  // form one network, each place joined to the nearest one already on it. Roads wander a little, never
  // stop short, and cross water on fords.
  const sp = def.spawn;
  const road = (ax: number, ay: number, bx: number, by: number, width: number, salt: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return void rect(ax - 1, ay - 1, width, width, T.Path);
    const nx = -(by - ay) / len, ny = (bx - ax) / len, amp = Math.min(5, len * 0.1), f1 = 1 + (salt % 3), ph = (salt * 1.7) % 6.283;
    const steps = Math.ceil(len * 2.5), o = Math.floor(width / 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, off = Math.sin(Math.PI * t) * (Math.sin(t * Math.PI * 2 * f1 + ph) * amp + Math.sin(t * Math.PI * 5 + ph * 2) * amp * 0.3);
      const x = Math.round(ax + (bx - ax) * t + nx * off), y = Math.round(ay + (by - ay) * t + ny * off);
      for (let dy = -o; dy < width - o; dy++) for (let dx = -o; dx < width - o; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 2 || py < 2 || px >= w - 2 || py >= h - 2) continue;
        const cur = get(px, py);
        if (cur !== T.Plaza && cur !== T.Wall && cur !== T.Roof && cur !== T.Gate && cur !== T.Portal) set(px, py, T.Path);
      }
      // verges: no tree stands against the road
      for (let dy = -o - 1; dy <= width - o; dy++) for (let dx = -o - 1; dx <= width - o; dx++) if (get(x + dx, y + dy) === T.Tree && x + dx > 1 && y + dy > 1 && x + dx < w - 2 && y + dy < h - 2) set(x + dx, y + dy, T.Grass);
    }
  };
  type Node = { x: number; y: number; main: boolean };
  const nodes: Node[] = [{ x: sp.tx, y: sp.ty, main: true }];
  for (const p of def.portals) nodes.push({ x: p.tx, y: p.ty, main: true });
  for (const z of Object.values(ZONES)) for (const p of z.portals) if (p.to === def.id) nodes.push({ x: p.toTx, y: p.toTy, main: true });
  if (def.town && def.id !== 'eldoria') nodes.push({ x: def.town.tx, y: def.town.ty + 3, main: true });
  for (const c of def.clearings ?? []) nodes.push({ x: c.tx, y: c.ty, main: false });
  for (const g of def.gates ?? []) nodes.push({ x: g.tx, y: g.ty + 2, main: false });
  for (const l of def.lairs ?? []) nodes.push({ x: l.tx, y: l.ty, main: false });

  if (def.id === 'eldoria') {
    // The capital stands on dry, open ground: no pond or thicket among the houses.
    for (let y = sp.ty - 26; y <= sp.ty + 24; y++) for (let x = sp.tx - 34; x <= sp.tx + 34; x++) {
      const d = Math.hypot((x - sp.tx) / 34, (y - sp.ty) / 25), t = get(x, y);
      if (d < 1 && (t === T.Water || (t === T.Tree && d < 0.8)) && x > 1 && y > 1 && x < w - 2 && y < h - 2) set(x, y, T.Grass);
    }
    // Three gardens on the outskirts (north, south, west): each a paved round with flowers, and a road to it.
    for (const [gx, gy] of [[sp.tx, 12], [sp.tx, h - 13], [12, sp.ty]]) {
      for (let y = gy - 5; y <= gy + 5; y++) for (let x = gx - 5; x <= gx + 5; x++) {
        const d = Math.hypot(x - gx, y - gy);
        if (d <= 5.2 && x > 1 && y > 1 && x < w - 2 && y < h - 2) set(x, y, d <= 2.6 ? T.Plaza : d <= 4.2 ? T.Flower : T.Grass);
      }
      nodes.push({ x: gx, y: gy, main: false });
    }
    // The capital: open, level ground inside the wall, then the plaza, the avenues to the eight gates,
    // the halls and houses, the arena and the courts. The wall itself is raised after the roads (below).
    const C = CITY, cx = sp.tx, cy = sp.ty;
    for (let y = cy - C.wy - 2; y <= cy + C.wy + 2; y++) for (let x = cx - C.wx - 2; x <= cx + C.wx + 2; x++) {
      const t = get(x, y);
      if (t === T.Water || t === T.Tree || t === T.Flower) set(x, y, T.Grass);
    }
    // the great plaza: round, with the statue of peace to the north and the fountain to the south
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) if (Math.hypot(x, y) <= 9.3) set(cx + x, cy + y, T.Plaza);
    // avenues: from the plaza to the middle of each side and to each corner
    const gates: [number, number][] = [[0, -C.wy], [0, C.wy], [-C.wx, 0], [C.wx, 0], [-C.wx, -C.wy], [C.wx, -C.wy], [-C.wx, C.wy], [C.wx, C.wy]];
    gates.forEach(([gx, gy], i) => {
      const len = Math.hypot(gx, gy), ux = gx / len, uy = gy / len;
      // straight and three wide: the city's streets do not wander
      for (let d = 8; d <= len + 2; d += 0.5) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const px = Math.round(cx + ux * d) + ox, py = Math.round(cy + uy * d) + oy;
        if (px > 1 && py > 1 && px < w - 2 && py < h - 2 && get(px, py) !== T.Plaza) set(px, py, T.Path);
      }
      nodes.push({ x: cx + gx + Math.sign(gx) * 3, y: cy + gy + Math.sign(gy) * 3, main: true });
      void i;
    });
    for (const [bx, by, bw] of Object.values(C.buildings)) {
      rect(cx + bx - 1, cy + by - 1, bw + 2, 7, T.Grass);
      rect(cx + bx, cy + by, bw, 3, T.Roof);
      rect(cx + bx, cy + by + 3, bw, 2, T.Wall);
      // a doorstep and a lane from the door to the nearest avenue or the plaza
      const doorX = cx + bx + Math.floor(bw / 2), doorY = cy + by + 5;
      rect(doorX - 1, doorY, 3, 2, T.Path);
      nodes.push({ x: doorX, y: doorY + 1, main: false });
    }
    // the arena: sand inside, a paved forecourt before its gate
    const A = C.arena;
    rect(cx + A.x0 + 2, cy + A.y0 + 3, A.x1 - A.x0 - 3, A.y1 - A.y0 - 5, T.Path);
    rect(cx + Math.floor((A.x0 + A.x1) / 2) - 2, cy + A.y1 + 1, 5, 4, T.Plaza);
    // courts: the townsfolk stand on paving
    for (const [nx, ny] of Object.values(C.npcs)) for (let y = -1; y <= 1; y++) for (let x = -2; x <= 2; x++) { const q = get(cx + nx + x, cy + ny + y); if (q === T.Grass || q === T.Path || q === T.Flower) set(cx + nx + x, cy + ny + y, T.Plaza); }
    // the rift: scorched ground around the tear; the waygate: a paved round
    for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) if (Math.hypot(x, y * 1.3) <= 4 && get(cx + C.rift[0] + x, cy + C.rift[1] + y) !== T.Plaza) set(cx + C.rift[0] + x, cy + C.rift[1] + y, T.Path);
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (Math.hypot(x, y) <= 3.2) set(cx + C.waystone[0] + x, cy + C.waystone[1] + y, T.Plaza);
    // flower beds along the plaza's rim and by the halls
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + 0.2, fx = Math.round(cx + Math.cos(a) * 11), fy = Math.round(cy + Math.sin(a) * 11);
      if (get(fx, fy) === T.Grass) set(fx, fy, T.Flower);
      if (get(fx + 1, fy) === T.Grass) set(fx + 1, fy, T.Flower);
    }
  } else {
    rect(sp.tx - 3, sp.ty - 3, 7, 7, T.Grass);
    if (def.town) {
      // A village: a plaza, three houses with a path to each door, and a field of flowers beside it.
      const { tx, ty } = def.town;
      rect(tx - 9, ty - 9, 19, 16, T.Grass);
      rect(tx - 4, ty - 3, 9, 7, T.Plaza);
      for (const [dx, dy] of [[-9, -9], [2, -9], [-9, 0]]) {
        rect(tx + dx, ty + dy, 6, 2, T.Roof);
        rect(tx + dx, ty + dy + 2, 6, 2, T.Wall);
        const doorX = tx + dx + 3, doorY = ty + dy + 4;
        for (let y = doorY; y <= doorY + 1; y++) if (get(doorX, y) === T.Grass) set(doorX, y, T.Path);
        // an L from the doorstep to the plaza's edge
        const px = Math.max(tx - 4, Math.min(tx + 4, doorX));
        for (let x = Math.min(doorX, px); x <= Math.max(doorX, px); x++) if (get(x, doorY + 1) === T.Grass) set(x, doorY + 1, T.Path);
        for (let y = Math.min(doorY + 1, ty - 3); y <= Math.max(doorY + 1, ty - 3); y++) if (get(px, y) === T.Grass) set(px, y, T.Path);
      }
      for (let y = ty + 1; y <= ty + 5; y += 2) for (let x = tx + 6; x <= tx + 9; x++) if (get(x, y) === T.Grass) set(x, y, T.Flower); // garden rows
    }
  }

  // join the network: nearest place first, main roads wide
  const on: Node[] = [nodes[0]], rest = nodes.slice(1);
  let salt = def.seed & 0xff;
  while (rest.length) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) for (let j = 0; j < on.length; j++) {
      // main places prefer to join main places, so the highway runs from portal to portal
      const d = Math.hypot(rest[i].x - on[j].x, rest[i].y - on[j].y) * (rest[i].main && !on[j].main ? 1.6 : 1) * (rest[i].main ? 0.6 : 1);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    const a = rest.splice(bi, 1)[0], b = on[bj];
    road(a.x, a.y, b.x, b.y, a.main && b.main ? 3 : 2, salt++);
    on.push(a);
  }

  if (def.id === 'eldoria') {
    const C = CITY, cx = sp.tx, cy = sp.ty, ramp = (RAMPARTS[def.id] = new Set<number>());
    const solid = (x: number, y: number, t: T) => { set(x, y, t); if (t === T.Wall || t === T.Roof) ramp.add(x + y * w); };
    // the statue's plinth and the fountain's basin
    rect(cx + C.statue[0] - 1, cy + C.statue[1] - 1, 2, 2, T.Block);
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.hypot(x, y) <= 2.3) set(cx + C.fountain[0] + x, cy + C.fountain[1] + y, Math.hypot(x, y) < 0.8 ? T.Block : T.Water);
    // A stretch of wall along a row (a parapet over two rows of stone) or down a column (two wide).
    // Roads are left open: wherever a street or a path crosses the line there is a gate.
    const open = (x: number, y: number) => { const t = get(x, y); return t === T.Path || t === T.Plaza || t === T.Portal; };
    const rowWall = (x0: number, x1: number, y: number, gate: (x: number) => boolean) => {
      for (let x = x0; x <= x1; x++) {
        if (gate(x) || open(x, y) || open(x, y + 1) || open(x, y + 2)) continue;
        solid(x, y, T.Roof); solid(x, y + 1, T.Wall); solid(x, y + 2, T.Wall);
      }
    };
    const colWall = (x: number, y0: number, y1: number, gate: (y: number) => boolean) => {
      let run: number[] = [];
      const flush = () => { run.forEach((y, i) => { const t = i === run.length - 1 ? T.Wall : T.Roof; solid(x, y, t); solid(x + 1, y, t); }); run = []; };
      for (let y = y0; y <= y1; y++) {
        if (gate(y) || open(x, y) || open(x + 1, y)) { if (run.length >= 2) flush(); else run = []; continue; }
        run.push(y);
      }
      if (run.length >= 2) flush();
    };
    for (const [, fx, fy, n] of C.decor) for (let k = 0; k < n; k++) set(cx + Math.floor(fx - n / 2 + k + 0.001), cy + Math.ceil(fy) - 1, T.Block);
    // the arena: north side, two halves of the south side with the gate between, and the two flanks
    const A = C.arena, ax0 = cx + A.x0, ax1 = cx + A.x1, ay0 = cy + A.y0, ay1 = cy + A.y1, amid = Math.floor((ax0 + ax1) / 2);
    rowWall(ax0 + 2, ax1 - 2, ay0, () => false);
    rowWall(ax0 + 2, ax1 - 2, ay1 - 2, (x) => Math.abs(x - amid) <= 1);
    colWall(ax0, ay0 + 3, ay1 - 3, () => false);
    colWall(ax1 - 1, ay0 + 3, ay1 - 3, () => false);
    for (const [x, y] of [[ax0, ay0], [ax1 - 1, ay0], [ax0, ay1 - 2], [ax1 - 1, ay1 - 2]]) rect(x, y, 2, 3, T.Block); // corner towers stand here
    for (let x = amid - 1; x <= amid + 1; x++) for (let y = ay1 - 2; y <= ay1; y++) set(x, y, T.Path); // the gateway
    // the city wall: the four sides, each broken by its gate; the corners are the diagonal gates
    const X0 = cx - C.wx, X1 = cx + C.wx, Y0 = cy - C.wy, Y1 = cy + C.wy, G = 2, CG = 5;
    rowWall(X0 + CG, X1 - CG, Y0 - 2, (x) => Math.abs(x - cx) <= G);
    rowWall(X0 + CG, X1 - CG, Y1, (x) => Math.abs(x - cx) <= G);
    colWall(X0 - 1, Y0 + CG, Y1 - CG, (y) => Math.abs(y - cy) <= G);
    colWall(X1, Y0 + CG, Y1 - CG, (y) => Math.abs(y - cy) <= G);
  }
  // Lairs: rough open ground where an elite waits (water and trees give way; the trail stays).
  for (const l of def.lairs ?? [])
    for (let y = l.ty - l.r; y <= l.ty + l.r; y++) for (let x = l.tx - l.r; x <= l.tx + l.r; x++) {
      const t = get(x, y);
      if (Math.hypot(x - l.tx, y - l.ty) <= l.r && x > 1 && y > 1 && x < w - 2 && y < h - 2 && (t === T.Tree || t === T.Water)) set(x, y, T.Grass);
    }
  // Landmarks: open ground around them (their roads already arrive).
  for (const c of def.clearings ?? []) {
    for (let y = c.ty - c.r; y <= c.ty + c.r; y++)
      for (let x = c.tx - c.r; x <= c.tx + c.r; x++) if (Math.hypot(x - c.tx, y - c.ty) <= c.r && x > 1 && y > 1 && x < w - 2 && y < h - 2) set(x, y, Math.hypot(x - c.tx, y - c.ty) <= c.r - 3 ? T.Plaza : get(x, y) === T.Path ? T.Path : T.Grass);
  }
  // The sanctuary of the Depths: a paved court ringed with flowers, so its edge can be seen.
  if (def.sanctuary) {
    const s = def.sanctuary;
    for (let y = s.ty - s.r - 3; y <= s.ty + s.r + 3; y++) for (let x = s.tx - s.r - 3; x <= s.tx + s.r + 3; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      const d = Math.hypot(x - s.tx, y - s.ty), t = get(x, y);
      if (d <= s.r - 1) set(x, y, T.Plaza);
      else if (d <= s.r + 0.5) set(x, y, t === T.Path ? T.Path : T.Flower);
      else if (d <= s.r + 3 && (t === T.Tree || t === T.Water)) set(x, y, T.Grass);
    }
  }
  for (const g of def.gates ?? []) {
    for (let y = g.ty - 3; y <= g.ty + 3; y++) for (let x = g.tx - 3; x <= g.tx + 3; x++) if (get(x, y) !== T.Path) set(x, y, T.Grass);
    rect(g.tx - 2, g.ty - 2, 5, 5, T.Plaza);
    set(g.tx, g.ty, T.Gate);
  }

  for (const p of def.portals) {
    rect(p.tx - 1, p.ty - 1, 3, 3, T.Path);
    set(p.tx, p.ty, T.Portal);
  }
  // Arrival points of portals from other zones must be walkable.
  for (const z of Object.values(ZONES)) {
    for (const p of z.portals) if (p.to === def.id) rect(p.toTx - 1, p.toTy - 1, 3, 3, T.Path);
  }
  for (const p of def.portals) set(p.tx, p.ty, T.Portal);
  return { def, w, h, tiles };
}

export function tileAt(m: ZoneMap, tx: number, ty: number): T {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return T.Tree;
  return m.tiles[tx + ty * m.w] as T;
}

export function blocked(m: ZoneMap, x: number, y: number, fly = false): boolean {
  const x0 = Math.floor((x - PLAYER_HALF) / TILE), x1 = Math.floor((x + PLAYER_HALF - 0.01) / TILE);
  const y0 = Math.floor((y - PLAYER_HALF) / TILE), y1 = Math.floor((y + PLAYER_HALF - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(m, tx, ty);
      if (!SOLID[t]) continue;
      // a flyer passes over water and trees, never walls, rock or the edge of the map
      if (fly && (t === T.Water || t === T.Tree) && tx > 1 && ty > 1 && tx < m.w - 2 && ty < m.h - 2) continue;
      return true;
    }
  return false;
}

export interface Pos {
  x: number;
  y: number;
}
const q = (v: number) => Math.round(v * 100) / 100;
/** Distance covered in one simulation step. Quantised so server and client agree exactly. */
export const stepSize = (moveMul: number, run: boolean) => q((((run ? RUN_SPEED : WALK_SPEED) * TICK_MS) / 1000) * moveMul);
const DIAG = Math.SQRT1_2;

/**
 * Advance one fixed simulation step. Identical on server and client; positions are quantised
 * to 0.01 so that JSON round-trips are lossless and prediction replays match exactly.
 */
export function stepMove(p: Pos, ix: number, iy: number, m: ZoneMap, step: number, fly = false): void {
  if (!ix && !iy) return;
  const k = ix && iy ? DIAG : 1;
  const nx = q(p.x + ix * step * k);
  if (!blocked(m, nx, p.y, fly)) p.x = nx;
  const ny = q(p.y + iy * step * k);
  if (!blocked(m, p.x, ny, fly)) p.y = ny;
}

/** The dungeon entrance within reach of a position, if any. */
export function gateNear(m: ZoneMap, x: number, y: number, range = 3 * TILE) {
  for (const g of m.def.gates ?? []) if (Math.hypot(tileCenter(g.tx) - x, tileCenter(g.ty) - y) <= range) return g;
  return undefined;
}

export function portalAt(m: ZoneMap, x: number, y: number): Portal | undefined {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tileAt(m, tx, ty) !== T.Portal) return undefined;
  return m.def.portals.find((p) => p.tx === tx && p.ty === ty);
}

export const tileCenter = (t: number) => t * TILE + TILE / 2;
