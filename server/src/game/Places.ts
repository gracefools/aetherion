// World interactions: gathering, hidden caches, waystone travel and merchant crafting.
// All of it is validated here: where the player stands, what they own, what they have found.
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import { ITEM_LIST, ITEMS, pickRarity, rollItem, usableBy } from '../../../shared/src/items';
import {
  allDiscoveries, INTERACT_RANGE, NODE_RESPAWN_MS, objById, objNear, RECIPES, START_DISCOVERIES, teleportCost, waypointId, WAYSTONE_RANGE, zoneObjects,
} from '../../../shared/src/places';
import { TICK_MS } from '../../../shared/src/protocol';
import { REGIONS, ZONES } from '../../../shared/src/world';
import { award, consume, count, give, nearShop, sendInv } from './Inventory';
import type { Player, World } from './World';

/** Stored discoveries are filtered against what actually exists. */
export function cleanDiscoveries(raw: unknown): Set<string> {
  const valid = new Set(allDiscoveries()), out = new Set(START_DISCOVERIES);
  if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string' && valid.has(id)) out.add(id);
  return out;
}
export const sendDisc = (w: World, p: Player) => {
  w.send(p, { t: 'disc', list: [...p.disc] });
  w.quests.refresh(p);
};

/** Once a second: standing near a waystone keeper attunes the character to that waystone. */
export function discoverWaystones(w: World) {
  for (const p of w.online.values()) {
    const id = waypointId(p.room.zoneId);
    if (p.disc.has(id) || p.dead) continue;
    const k = zoneObjects(p.room.zoneId).find((o) => o.kind === 'waykeeper');
    if (!k || Math.hypot(k.x - p.x, k.y - p.y) > WAYSTONE_RANGE) continue;
    p.disc.add(id);
    p.discDirty = true;
    w.send(p, { t: 'sys', text: `Waystone attuned: ${ZONES[p.room.zoneId].town!.name}. You can now travel here from any waystone.`, cue: 'attune' });
    sendDisc(w, p);
  }
}

const CACHE_LORE: Record<string, string> = {
  eldoria: 'Inside: a soldier\'s pay, and a letter never sent. "When the star fell we thought it the end. It was only the beginning of the debt."',
  verdant: 'Inside: offerings left for the forest. The moss has grown around them, not over them.',
  ashen: 'Inside: a smith\'s hoard, sealed with slag. Someone meant to come back when the mountain cooled.',
  frostveil: 'Inside: provisions for a winter that was supposed to last one season.',
  dreadmoor: 'Inside: a knight\'s oath-ring, the inscription filed away.',
  astral: 'Inside: a Runewright\'s last notes. "The seal holds as long as someone remembers why."',
};

/** Executes a world interaction. Returns '' or the reason it was refused. */
export function objOp(w: World, p: Player, m: any): string {
  if (!m || typeof m !== 'object') return 'Unknown command';
  if (p.dead) return 'You are dead';
  const zone = p.room.zoneId;
  switch (m.op) {
    case 'gather': {
      const o = typeof m.id === 'string' ? objById(m.id) : undefined;
      if (!o || o.kind !== 'node' || o.zone !== zone) return 'Nothing to gather';
      if (Math.hypot(o.x - p.x, o.y - p.y) > INTERACT_RANGE + 16) return 'Too far away';
      if ((p.room.nodeReady.get(o.id) ?? 0) > w.tick) return 'Nothing left to gather here yet';
      const qty = 1 + (w.rnd() < 0.35 ? 1 : 0);
      if (!give(p, { base: o.res!, rar: 0, ilvl: 1, aff: [], up: 0, qty })) return 'Inventory is full';
      p.room.nodeReady.set(o.id, w.tick + Math.ceil(NODE_RESPAWN_MS / TICK_MS));
      for (const q of p.room.players.values()) w.send(q, { t: 'nodes', cd: [[o.id, NODE_RESPAWN_MS]] });
      // the profession: more from every node as it grows, and rare finds from level 20
      const extra = w.life.onGather(p, o.res!).filter((s) => give(p, s));
      w.send(p, { t: 'loot', gold: 0, items: [{ base: o.res!, rar: 0, qty }, ...extra.map((s) => ({ base: s.base, rar: 0, qty: s.qty }))] });
      sendInv(w, p);
      w.journals.onGather(p);
      return '';
    }
    case 'open': {
      const o = typeof m.id === 'string' ? objById(m.id) : undefined;
      if (!o || o.kind !== 'cache' || o.zone !== zone) return 'Nothing to open';
      if (Math.hypot(o.x - p.x, o.y - p.y) > INTERACT_RANGE + 16) return 'Too far away';
      if (p.disc.has(o.id)) return 'You have already emptied this cache';
      // A one-time reward per character: gold and a Rare-or-better item for their job at the region's level.
      const lv = ZONES[zone].level, pool = ITEM_LIST.filter((b) => b.kind === 'equip' && !b.unique && usableBy(b, p.job));
      const item = rollItem(w.rnd, pool[Math.floor(w.rnd() * pool.length)].id, lv[1], pickRarity(w.rnd, [0, 0, 62, 33, 5, 0]));
      p.disc.add(o.id);
      p.discDirty = true;
      award(w, p, Math.round((50 + 80 * lv[0]) * w.goldRate), [item, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 }]);
      w.send(p, { t: 'sys', text: `You found a hidden cache. ${CACHE_LORE[zone] ?? ''}`, cue: 'cache' });
      sendDisc(w, p);
      return '';
    }
    case 'tp': {
      const to = m.to;
      if (typeof to !== 'string' || !REGIONS.includes(to)) return 'Unknown destination';
      if (to === zone) return 'You are already here';
      if (!objNear(zone, p.x, p.y, 140, ['waykeeper'])) return 'You need to be at a waystone';
      if (!p.disc.has(waypointId(to))) return 'You have not attuned to that waystone yet';
      if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot travel in combat';
      const cost = teleportCost(to);
      if (p.gold < cost) return 'Not enough gold';
      p.gold -= cost;
      p.invDirty = true;
      const k = zoneObjects(to).find((o) => o.kind === 'waykeeper')!;
      w.relocate(p, w.roomIn(to, p), k.x, k.y + 48);
      sendInv(w, p);
      return '';
    }
    case 'craft': {
      const r = RECIPES.find((x) => x.id === m.recipe);
      if (!r) return 'Unknown recipe';
      if (!nearShop(p)) return 'You need to be at a merchant';
      for (const [base, n] of r.needs) if (count(p, base) < n) return `Requires ${n} ${ITEMS[base].name}`;
      if (p.gold < r.gold) return 'Not enough gold';
      if (!give(p, { base: r.out[0], rar: 0, ilvl: 1, aff: [], up: 0, qty: r.out[1] })) return 'Inventory is full';
      for (const [base, n] of r.needs) consume(p, base, n);
      p.gold -= r.gold;
      sendInv(w, p);
      return '';
    }
    default:
      return 'Unknown command';
  }
}
