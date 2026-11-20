// Things that stand in the world: town NPCs, resource nodes and hidden caches.
// Everything here is derived deterministically from the zone map, so server and client agree
// without sending any of it over the network. NPCs are scenery with a role; the server only
// checks that a player is close enough to the right one.
import { defaultAppearance, type Appearance } from './appearance';
import { TILE, type Job } from './protocol';
import { EXPANSION } from './expansion';
import { CITY, getZoneMap, REGIONS, T, tileAt, tileCenter, ZONES } from './world';
import { matOf, TIER_MATS } from './life';
import { ITEMS } from './items';

export type ObjKind = 'merchant' | 'waykeeper' | 'lorekeeper' | 'runesmith' | 'banker' | 'arenamaster' | 'riftwarden' | 'raidherald' | 'steward' | 'node' | 'cache';
export interface WorldObj {
  id: string;
  kind: ObjKind;
  name: string;
  zone: string;
  x: number;
  y: number;
  /** NPCs: how they look. */
  job?: Job;
  ap?: Appearance;
  /** Resource nodes: the material they yield. */
  res?: string;
}
export const INTERACT_RANGE = 64;
export const NODE_RESPAWN_MS = 45000;
/** Gathering takes this long, standing still and out of combat. */
export const GATHER_MS = 5000;
export const WAYSTONE_RANGE = 220;
export const isNpc = (o: WorldObj) => o.kind === 'merchant' || o.kind === 'waykeeper' || o.kind === 'lorekeeper' || o.kind === 'runesmith' || o.kind === 'banker' || o.kind === 'arenamaster' || o.kind === 'riftwarden' || o.kind === 'raidherald' || o.kind === 'steward';
/** How close a player must stand to the Rune Merchant to buy. */
export const RUNE_SHOP_RANGE = 160;
/** M14: the banker of each town (bank, auction house). M15: the Arena Master in the capital. */
export const BANKER_NAMES: Record<string, string> = {
  eldoria: 'Treasurer Aldwin', verdant: 'Keeper of Coin Brisa', ashen: 'Vault-warden Hesk', frostveil: 'Strongbox Marit', dreadmoor: 'Pawnbroker Ilse', astral: 'Ledger-scholar Quen',
};
export const ARENA_MASTER = 'Arena Master Corvane';
export const RIFT_WARDEN = 'Rift Warden Selwyn';
export const RAID_HERALD = 'Raid Herald Oriane';
export const HOUSING_STEWARD = 'Housing Steward Pell';
/** The Rune Merchant of each town. */
export const RUNESMITH_NAMES: Record<string, string> = {
  eldoria: 'Runewright Maelis', verdant: 'Runecarver Sorrel', ashen: 'Runeforger Tavi', frostveil: 'Runesinger Yrsa', dreadmoor: 'Runebinder Corvin', astral: 'Rune Scholar Ilyan',
};

/**
 * What each region's two gathering spots yield: its herb and its ore, of the region's tier
 * (life.ts: tier 1 below level 30, then a tier every 30 levels).
 */
export const REGION_RES: Record<string, [string, string]> = {};
for (const e of EXPANSION) {
  BANKER_NAMES[e.id] = e.npcs[3];
  RUNESMITH_NAMES[e.id] = e.npcs[4];
}
for (const z of REGIONS) REGION_RES[z] = [matOf('herbalism', z), matOf('mining', z)];
export const NODE_NAMES: Record<string, string> = Object.fromEntries([...TIER_MATS.herbalism.map((id) => [id, `${ITEMS[id].name} Patch`]), ...TIER_MATS.mining.map((id) => [id, `${ITEMS[id].name} Vein`])]);

/** Things a merchant makes from gathered materials. */
export interface Recipe {
  id: string;
  out: [base: string, qty: number];
  needs: [base: string, qty: number][];
  gold: number;
}
export const RECIPES: Recipe[] = [
  { id: 'stone', out: ['upgrade_stone', 1], needs: [['iron_ore', 4]], gold: 30 },
  { id: 'stone2', out: ['upgrade_stone', 2], needs: [['mithril_ore', 3]], gold: 50 },
  { id: 'hp', out: ['hp_potion', 1], needs: [['moonleaf', 3]], gold: 0 },
  { id: 'mana', out: ['mana_potion', 2], needs: [['moonleaf', 2], ['river_fish', 1]], gold: 0 },
];

/** Waystone travel: the fee to arrive in a region. No other cost or limit. */
export const teleportCost = (to: string) => ZONES[to].level[0] * 5;
export const waypointId = (zone: string) => `wp:${zone}`;
/** Every character starts knowing the capital's waystone. */
export const START_DISCOVERIES = [waypointId('eldoria')];

const NPC_LOOK: Record<string, { job: Job; tweak: Partial<Appearance> }> = {
  merchant: { job: 'ranger', tweak: { clothing: 2, color1: 3, color2: 8, helmet: 1, helmetColor: 3, hair: 2, hairColor: 2, accessory: 1 } as Partial<Appearance> },
  waykeeper: { job: 'mage', tweak: { clothing: 3, color1: 5, color2: 10, helmet: 2, helmetColor: 5, cape: 2, capeColor: 5, hair: 6, hairColor: 8, aura: 2 } as Partial<Appearance> },
  banker: { job: 'knight', tweak: { clothing: 1, color1: 6, color2: 3, helmet: 0, hair: 1, hairColor: 3, accessory: 1, accessoryColor: 3 } as Partial<Appearance> },
  steward: { job: 'cleric', tweak: { clothing: 2, color1: 4, color2: 8, helmet: 0, hair: 3, hairColor: 4, accessory: 1 } as Partial<Appearance> },
  raidherald: { job: 'knight', tweak: { clothing: 1, color1: 2, color2: 3, helmet: 4, helmetColor: 3, cape: 2, capeColor: 3, hair: 1, hairColor: 2, aura: 3 } as Partial<Appearance> },
  riftwarden: { job: 'mage', tweak: { clothing: 3, color1: 10, color2: 5, helmet: 3, helmetColor: 10, cape: 2, capeColor: 10, hair: 6, hairColor: 9, aura: 3 } as Partial<Appearance> },
  arenamaster: { job: 'berserker', tweak: { clothing: 2, color1: 1, color2: 6, helmet: 4, helmetColor: 1, cape: 2, capeColor: 1, hair: 5, hairColor: 1, aura: 3 } as Partial<Appearance> },
  runesmith: { job: 'mage', tweak: { clothing: 2, color1: 7, color2: 4, helmet: 3, helmetColor: 7, cape: 1, capeColor: 4, hair: 3, hairColor: 5, aura: 1, accessory: 2 } as Partial<Appearance> },
  lorekeeper: { job: 'cleric', tweak: { clothing: 1, color1: 9, color2: 2, helmet: 0, hair: 4, hairColor: 9, cape: 1, capeColor: 9, accessory: 2 } as Partial<Appearance> },
};
const NPC_NAMES: Record<string, [string, string, string]> = {
  eldoria: ['Quartermaster Bren', 'Waykeeper Ilse', 'Archivist Odalric'], verdant: ['Trader Fenna', 'Waykeeper Thorne', 'Mossreader Hale'],
  ashen: ['Smith Karrow', 'Waykeeper Ember', 'Ashwife Dunya'], frostveil: ['Furrier Solveig', 'Waykeeper Rime', 'Skald Ingvar'],
  dreadmoor: ['Peddler Wick', 'Waykeeper Lantern', 'Gravewarden Ossa'], astral: ['Salvager Quill', 'Waykeeper Vesper', 'Last Runewright Aurel'],
};
for (const e of EXPANSION) NPC_NAMES[e.id] = [e.npcs[0], e.npcs[1], e.npcs[2]];

function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SOLID_T = (t: T) => t === T.Water || t === T.Tree || t === T.Wall || t === T.Roof || t === T.Rock || t === T.Block;

const cache = new Map<string, WorldObj[]>();
export function zoneObjects(zoneId: string): WorldObj[] {
  let list = cache.get(zoneId);
  if (list) return list;
  list = [];
  cache.set(zoneId, list);
  const def = ZONES[zoneId];
  if (!def || def.kind === 'dungeon' || !def.town) return list;
  const map = getZoneMap(zoneId), { tx, ty } = def.town, names = NPC_NAMES[zoneId];
  const npc = (kind: 'merchant' | 'waykeeper' | 'lorekeeper', i: number, dx: number, dy: number) => {
    const look = NPC_LOOK[kind];
    list!.push({ id: `${kind}:${zoneId}`, kind, name: names[i], zone: zoneId, x: tileCenter(tx + dx), y: tileCenter(ty + dy), job: look.job, ap: { ...defaultAppearance(look.job), ...look.tweak } });
  };
  // the three townsfolk stand on the plaza, clear of the spawn point
  npc('merchant', 0, -3, -2);
  npc('waykeeper', 1, 3, -2);
  npc('lorekeeper', 2, 0, 2 + (zoneId === 'eldoria' ? 2 : 0));
  {
    // M12: the Rune Merchant stands at the edge of the plaza
    const look = NPC_LOOK.runesmith, dx = zoneId === 'eldoria' ? 5 : 3, dy = 2;
    const bl = NPC_LOOK.banker, bdx = zoneId === 'eldoria' ? -5 : -3;
    list.push({ id: `banker:${zoneId}`, kind: 'banker', name: BANKER_NAMES[zoneId] ?? 'Banker', zone: zoneId, x: tileCenter(tx + bdx), y: tileCenter(ty + dy), job: bl.job, ap: { ...defaultAppearance(bl.job), ...bl.tweak } });
    if (zoneId === 'eldoria') {
      const al = NPC_LOOK.arenamaster;
      list.push({ id: 'arenamaster:eldoria', kind: 'arenamaster', name: ARENA_MASTER, zone: zoneId, x: tileCenter(tx), y: tileCenter(ty - 5), job: al.job, ap: { ...defaultAppearance(al.job), ...al.tweak } });
      const rw = NPC_LOOK.riftwarden;
      list.push({ id: 'riftwarden:eldoria', kind: 'riftwarden', name: RIFT_WARDEN, zone: zoneId, x: tileCenter(tx + 5), y: tileCenter(ty - 5), job: rw.job, ap: { ...defaultAppearance(rw.job), ...rw.tweak } });
      const sw = NPC_LOOK.steward;
      list.push({ id: 'steward:eldoria', kind: 'steward', name: HOUSING_STEWARD, zone: zoneId, x: tileCenter(tx + 5), y: tileCenter(ty + 5), job: sw.job, ap: { ...defaultAppearance(sw.job), ...sw.tweak } });
      const rh = NPC_LOOK.raidherald;
      list.push({ id: 'raidherald:eldoria', kind: 'raidherald', name: RAID_HERALD, zone: zoneId, x: tileCenter(tx - 5), y: tileCenter(ty - 5), job: rh.job, ap: { ...defaultAppearance(rh.job), ...rh.tweak } });
    }
    list.push({ id: `runesmith:${zoneId}`, kind: 'runesmith', name: RUNESMITH_NAMES[zoneId] ?? 'Rune Merchant', zone: zoneId, x: tileCenter(tx + dx), y: tileCenter(ty + dy), job: look.job, ap: { ...defaultAppearance(look.job), ...look.tweak } });
  }

  // the capital: everyone stands at the house or yard of their trade (CITY in world.ts)
  if (zoneId === 'eldoria') for (const o of list) { const at = CITY.npcs[o.kind]; if (at) { o.x = tileCenter(tx + at[0]); o.y = tileCenter(ty + at[1]); } }

  // Reachable ground, found once by flood fill from the spawn point.
  const seen = new Uint8Array(map.w * map.h), stack = [def.spawn.tx + def.spawn.ty * map.w];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!, x = i % map.w, y = (i / map.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = nx + ny * map.w;
      if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1 || seen[j] || SOLID_T(tileAt(map, nx, ny))) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const rnd = mulberry(def.seed ^ 0x9e3779b9);
  const far = (x: number, y: number, min: number) => Math.hypot(x - tx, y - ty) >= min && Math.hypot(x - def.spawn.tx, y - def.spawn.ty) >= min && list!.every((o) => Math.hypot(o.x / TILE - x, o.y / TILE - y) >= 7);
  const open = (x: number, y: number) => seen[x + y * map.w] && tileAt(map, x, y) === T.Grass;
  // Resource nodes: two gathering spots per region, always in the same places, four nodes each:
  // one for the region's first resource and one for its second (a mine, a meadow...), so a player
  // learns where to go rather than searching the whole map.
  const res = REGION_RES[zoneId] ?? [matOf('herbalism', zoneId), matOf('mining', zoneId)];
  let n = 0;
  for (let spot = 0; spot < 2; spot++) {
    const r = res[spot];
    for (let tries = 0; tries < 4000; tries++) {
      const cx = 6 + Math.floor(rnd() * (map.w - 12)), cy = 6 + Math.floor(rnd() * (map.h - 12));
      if (!open(cx, cy) || !far(cx, cy, 14)) continue;
      // the spot's nodes: open, reachable grass within a few tiles of its centre, two tiles apart
      const here: [number, number][] = [];
      for (let k = 0; k < 60 && here.length < 4; k++) {
        const x = cx + Math.round((rnd() - 0.5) * 7), y = cy + Math.round((rnd() - 0.5) * 7);
        if (open(x, y) && here.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 2)) here.push([x, y]);
      }
      if (here.length < 4) continue;
      for (const [x, y] of here) list.push({ id: `node:${zoneId}:${n++}`, kind: 'node', name: NODE_NAMES[r], zone: zoneId, x: tileCenter(x), y: tileCenter(y), res: r });
      break;
    }
  }
  // Hidden caches: the most enclosed reachable spots far from any road (best of many candidates).
  const hidden = (x: number, y: number) => {
    let walls = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = tileAt(map, x + dx, y + dy);
      if (t === T.Path || t === T.Plaza) return -1; // in sight of a road: not hidden
      if (SOLID_T(t)) walls++;
    }
    return walls;
  };
  const cands: [number, number, number][] = [];
  for (let tries = 0; tries < 6000; tries++) {
    const x = 4 + Math.floor(rnd() * (map.w - 8)), y = 4 + Math.floor(rnd() * (map.h - 8));
    if (!open(x, y) || !far(x, y, 18)) continue;
    const h = hidden(x, y);
    if (h >= 9) cands.push([h, x, y]);
  }
  cands.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const picked: [number, number][] = [];
  for (const [, x, y] of cands) {
    if (picked.length >= 2) break;
    if (picked.some(([px, py]) => Math.hypot(px - x, py - y) < 25)) continue;
    picked.push([x, y]);
    list.push({ id: `cache:${zoneId}:${picked.length - 1}`, kind: 'cache', name: 'Hidden Cache', zone: zoneId, x: tileCenter(x), y: tileCenter(y) });
  }
  return list;
}
const byId = new Map<string, WorldObj>();
export function objById(id: string): WorldObj | undefined {
  if (!byId.size) for (const z of REGIONS) for (const o of zoneObjects(z)) byId.set(o.id, o);
  return byId.get(id);
}
/** The nearest object of the given kinds within range of a position, if any. */
export function objNear(zoneId: string, x: number, y: number, range: number, kinds?: ObjKind[]): WorldObj | undefined {
  let best: WorldObj | undefined, bd = range;
  for (const o of zoneObjects(zoneId)) {
    if (kinds && !kinds.includes(o.kind)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d <= bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}
/** Total hidden things in the world, for the journal. */
export const allDiscoveries = () => REGIONS.flatMap((z) => [waypointId(z), ...zoneObjects(z).filter((o) => o.kind === 'cache').map((o) => o.id)]);
