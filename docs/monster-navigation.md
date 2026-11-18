# Monster spawn, navigation and map fix

## What was wrong (measured, not guessed)

`scripts/spawn-audit.ts` places every zone's monsters 20 times with different seeds and checks each position.

| Zone | Monsters checked | Sealed off from the zone | In a nook with no room | Total bad |
|---|---|---|---|---|
| Eldoria | 620 | 3 | 12 | 2.4% |
| Verdant Reach | 480 | 47 | 2 | 10.2% |
| Ashen Highlands | 620 | 11 | 3 | 2.3% |
| Frostveil | 620 | 10 | 0 | 1.6% |
| Dreadmoor | 520 | 21 | 2 | 4.4% |
| Astral Ruins | 520 | 29 | 6 | 6.7% |
| **All** | **3,380** | **121** | **25** | **4.3%** |

Two root causes:

1. **Spawn points were only checked for "is this one tile free".** The terrain is generated from noise, so it contains pockets of walkable ground completely enclosed by trees or water. A monster placed in one could never leave, and no player could reach it: the "trapped monster".
2. **Monsters had no pathfinding.** They walked in a straight line at their target. Anything in the way stopped them; after 1.5 seconds they gave up. Idle monsters only shuffled within 70 units of where they stood.

Not the cause: collision tiles, map boundaries and leash logic were correct.

## The fix

**Navigation data** (`shared/src/nav.ts`), computed once per zone and shared by server and client: which tiles are walkable, which of those are connected to where players arrive (flood fill), how much room there is around a tile, a line-of-walk check, a line-of-sight check, and an A* route search with a node budget.

**Spawn validation.** Before a monster is activated its position must be: inside the map; clear of walls and objects; connected to the rest of the zone; with at least nine reachable tiles within three steps (room to patrol); not on an arrival point; and at least two tiles from any other monster, so a camp spreads over its hunting ground instead of stacking. Rejected candidates are counted by reason, and each region's result is kept (`room.spawnLog`); a region that could not place all its monsters logs a warning.

After the fix the same audit reports **0 of 3,380** in a bad position.

**Movement.** Monsters walk straight while the straight line is clear and otherwise follow a route around the obstacle. They patrol to valid points inside their patrol radius, chase, attack in range, give up a target that cannot be reached (and record why), and walk home along a route.

**AI states:** idle, patrol, chase, attack, return, dead (respawn at the spawn point).

**Spawn regions as configuration** (`spawnRegions(zone)` in `shared/src/monsters.ts`): region id, map id, monster id, centre and radius of the spawn points, count, respawn interval, patrol radius, aggro radius, leash radius, level range, restrictions.

**Cost.** At most 12 route searches per simulation tick across all monsters, each monster at most twice a second, each search at most 900 nodes. In the test with every monster in Eldoria set to hunt 30 players, a tick averaged 0.86 ms (budget 50 ms); few searches were needed there because most straight lines were clear.

## Developer debug overlay

Start the server with `DEBUG_OVERLAY=1`, then press **F9** in game. It shows collision tiles (red), walkable ground that is cut off (orange), and for every monster its spawn point, patrol radius (green), leash radius (blue), aggro radius (dotted red), AI state, current route (yellow) and the reason its last move failed.

Ordinary players cannot see it: without that setting the server does not advertise the overlay, ignores requests for the data, and the F9 key does nothing. Never enable it on a public server; it is all-or-nothing for the whole server until admin roles exist (M17).

## Tests

Six new unit tests and one browser check: the navigation rules and each spawn fault; every monster in every region on valid ground over six seeds, spread out, with complete logs; a monster walking around a real obstacle to hit its target and going home afterwards; patrols staying inside their radius on valid ground with 90% or more of monsters moving within a minute; an unreachable target being dropped with the reason recorded; the search budget; the overlay being refused when disabled; and the overlay drawing in the real page.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Monsters spawn only on valid walkable tiles | **Met** (0 of 3,380) |
| Not trapped inside walls or objects | **Met** |
| Can patrol and wander | **Met** |
| Detect and chase players | **Met**, now around obstacles |
| Attack within valid range | **Met** (unchanged rule) |
| Return to their spawn area | **Met** |
| Distributed across the hunting area | **Met** |
| No excessive pathfinding CPU | **Met**, bounded and measured |
| Debug mode can identify invalid spawns and navigation issues | **Met** |

## Limits

- Flying monsters ignore terrain by design; they only need to spawn clear of obstacles.
- Dungeon monsters and monsters summoned by bosses are placed by the dungeon code at fixed room positions and are not re-validated.
- Routes are over tiles, four directions, so a monster rounding a corner walks square paths rather than cutting diagonally.
- Nobody has watched the monsters move in the game; this was verified by tests and one screenshot.
