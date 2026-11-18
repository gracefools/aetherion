// Player versus player rules (M15). Every decision is made on the server; the client uses the
// same function only to know whom it may click on as an enemy.
import { VILLAGE_LEAVE_TILES } from './audio';
import { TILE } from './protocol';
import { BOSS_ROOM, CHAMBERS, MONSTER_TOWN_CLEAR, REGIONS, ZONES } from './world';

/**
 *  safe  - no player may attack another, not even in a duel (dungeons; inside the arena its own rules apply).
 *  duel  - only agreed duels: every region.
 *  open  - anyone may attack anyone: the Depths (depths.ts), outside their arrival sanctuary.
 */
export type PvpRule = 'safe' | 'duel' | 'open';
/** The rule of a whole zone: the Depths are open, every region allows duels, dungeons are safe. */
export const pvpRule = (zone: string): PvpRule => (ZONES[zone]?.depth ? 'open' : REGIONS.includes(zone) ? 'duel' : 'safe');
/** Inside the arrival sanctuary of the Depths: nobody can be attacked there. */
export function inSanctuary(zone: string, x: number, y: number): boolean {
  const s = ZONES[zone]?.sanctuary;
  return !!s && Math.hypot(x / TILE - s.tx, y / TILE - s.ty) <= s.r;
}
/** The rule where a point is: the Depths are open outside their sanctuary. */
export function pvpRuleAt(zone: string, x: number, y: number): PvpRule {
  const r = pvpRule(zone);
  return r === 'open' && inSanctuary(zone, x, y) ? 'safe' : r;
}
/** After dying to a player, nobody may attack you for this long. */
export const PVP_RESPAWN_SHIELD_MS = 60_000;
/** Killing the same player again within this time gives no honour or rating. */
export const PVP_REPEAT_MS = 10 * 60_000;
/** Player-versus-player damage is scaled down: players have far less health than the monsters the game is balanced around. */
export const PVP_DAMAGE = 0.6;
export const DUEL_RANGE = 300;
/** A duel ends if the two move further apart than this. */
export const DUEL_LEASH = 700;
export const DUEL_COUNTDOWN_MS = 3000;
export const DUEL_MAX_MS = 120_000;
export const HONOR_PER_KILL = 10;
export const ARENA_HONOR = 6;
export const ARENA_GOLD = 25;
export const RATING_START = 1000;
export const RATING_K = 24;
/** Arena: a monster-free hall of an existing dungeon map. */
export const ARENA_ZONE = 'd_ruins';
/** Entering the arena: the boss hall (chamber 3) of the map. */
export const ARENA_SPAWN = { tx: CHAMBERS[BOSS_ROOM].cx, ty: CHAMBERS[BOSS_ROOM].cy };

/**
 * Monsters keep this far (tiles) from a village's centre: no camp is placed, no patrol leads and
 * no chase follows inside it. It is the village radius plus a wide margin of open ground.
 */
export { MONSTER_TOWN_CLEAR };
/** Monsters chasing a player give up at this distance (tiles) from a village's centre. */
export const MONSTER_TOWN_CHASE = VILLAGE_LEAVE_TILES + 6;
/** Within `tiles` of the village centre of a zone. */
export function nearTown(zone: string, x: number, y: number, tiles: number): boolean {
  const t = ZONES[zone]?.town, s = ZONES[zone]?.sanctuary;
  // a sanctuary is kept clear the same way, by the same margin beyond its edge
  if (s && Math.hypot(x / TILE - s.tx, y / TILE - s.ty) <= s.r + (tiles - VILLAGE_LEAVE_TILES)) return true;
  return !!t && Math.hypot(x / TILE - t.tx, y / TILE - t.ty) <= tiles;
}
/** Inside the safe radius of a town (open-PvP zones still protect their villages). */
export function inTown(zone: string, x: number, y: number): boolean {
  const t = ZONES[zone]?.town;
  return !!t && Math.hypot(x / TILE - t.tx, y / TILE - t.ty) <= VILLAGE_LEAVE_TILES;
}
export interface PvpView {
  id: number;
  level: number;
  x: number;
  y: number;
  party: number; // party id, 0 = none
  shieldUntil: number;
  duel: number; // id of the duel opponent while a duel is running, else 0
  /** Guild tag ('' or absent: none): guild members do not fight each other. */
  guild?: string;
  /** Until when the sanctuary does not shelter this player (they struck another player). */
  tagUntil?: number;
}
/**
 * Whether `a` may attack `b` right now. `arena` is true inside the arena room.
 * Returns '' when allowed, otherwise the reason.
 */
export function pvpBlock(a: PvpView, b: PvpView, zone: string, arena: boolean, now: number): string {
  if (a.id === b.id) return 'You cannot attack yourself';
  if (a.duel && a.duel === b.id && b.duel === a.id) return ''; // a running duel overrides everything else
  if (arena) return a.party && a.party === b.party ? 'That player is on your team' : now < b.shieldUntil ? 'That player has just returned to the fight' : '';
  if (a.party && a.party === b.party) return 'You cannot attack a member of your party';
  if (pvpRule(zone) === 'safe') return 'Fighting other players is not allowed here';
  if (inTown(zone, a.x, a.y) || inTown(zone, b.x, b.y)) return 'Fighting is not allowed in town';
  if (pvpRule(zone) !== 'open') return 'Only duels are allowed here';
  if (a.guild && a.guild === b.guild) return 'You cannot attack a member of your guild';
  // the sanctuary shelters everyone but those who have just struck another player
  const tagA = (a.tagUntil ?? 0) > now, tagB = (b.tagUntil ?? 0) > now;
  if (inSanctuary(zone, b.x, b.y) && !tagB) return 'That player is in the sanctuary';
  if (inSanctuary(zone, a.x, a.y) && !tagA && !tagB) return 'You cannot fight from the sanctuary';
  if (now < b.shieldUntil) return 'That player is protected for a moment';
  return '';
}
/** Elo update: returns the winner's gain (the loser loses the same). */
export function ratingDelta(winner: number, loser: number): number {
  const expected = 1 / (1 + Math.pow(10, (loser - winner) / 400));
  return Math.max(1, Math.round(RATING_K * (1 - expected)));
}
