# Aetherion Online — the Depths (open-PvP maps)

This replaces the open-PvP areas described in `pvp-areas-and-more.md`: regions no longer have any open-PvP ground. Regions allow agreed duels only.

## What they are

- **Five maps**, one behind the fourth region and every third region after it: Frostveil, Emberwaste, Hollowfen, Cinderdeep and Voidreach. Data: `shared/src/depths.ts`.
- **Open maps**, built by the same generator as a region (roads, camps, lairs), shared by everyone in the channel. They are not instances, not regions (no quests, waystone, codex or conquest) and have no village.
- **Entrance:** a portal in the north-east of the host region. Entry needs the host region's minimum level. The first time in a session the player must agree to a warning.

## Rules

| Rule | Value |
|---|---|
| PvP | Open everywhere outside the sanctuary, at any level. Party and guild members cannot attack each other. |
| Sanctuary | The paved court at the arrival point (ringed with flowers, green ring in game). Nobody can be attacked there; monsters keep clear of it. |
| Striker's mark | After striking a player: 10 seconds without sanctuary shelter and without use of any portal. |
| Leaving the sanctuary | 3 seconds of protection, at most once every 30 seconds; ends when the player attacks. |
| Death | Return to the sanctuary. No EXP or item loss. 60-second protection after a defeat by a player; it also ends when the player attacks. |
| Monsters | +3 levels, +60% health, +35% attack; +10% EXP, gold and item drops. |
| Boss | One per map at the far end, built as a world boss of its level: contribution loot, server-wide announcements, 15-minute return. |
| Bounty | Five players defeated in a row: announced, shown on the map to everyone there, +30 honour to whoever ends it. |

## Where the code is

- Rules: `shared/src/pvp.ts` (`pvpRule`, `pvpRuleAt`, `inSanctuary`, `pvpBlock`).
- Zones and terrain: `shared/src/world.ts` (`depth`, `sanctuary` on `ZoneDef`; `DEPTH_ZONES`).
- Boss and camps: `shared/src/monsters.ts` (`DEPTH_BOSSES`).
- Server: `World.transfer` (entry checks), `World.depthTick` (bounties, boss timers), `Pvp.onHit` and `Pvp.onKill`.
- Client: `DepthAsk` in `client/src/pvp.tsx`, the map list and pins in `client/src/worldmap.tsx`, the sanctuary ring and minimap frame in `client/src/game/Game.ts`.
