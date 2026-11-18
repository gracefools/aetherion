# Aetherion Online — Raids, guild territory war and faction conquest

Version **0.23.0-alpha** (batch F).

## Raids (10–20 players, level 60+)

**Raid Herald Oriane** stands on the Eldoria plaza.

1. **Gather:** one player opens a **raid group**; others join it from the herald's list. A group holds up to 20 players.
2. **Start:** the leader starts the raid once at least **10** members stand at the herald.
3. **Fight:** inside the Shadow's Sanctum come:
   - wave 1: elite guards;
   - wave 2: a larger elite guard;
   - **Aetherion's Shadow**, a raid boss built on the Demon Lord's fight with wider areas, more simultaneous targets and summons, and a 15-minute enrage.

**Scaling.** Monster level is the raiders' average level + 5 (at least 60). Monster health grows with the number of raiders, by 12% per raider.

**Rewards.** Every raider inside when the Shadow falls receives:
- **two** boss items at raid odds (Epic 15%, Legendary 50%, Mythic 35%);
- an Awakening Essence and an Armament Core;
- a 50% chance of a sigil of the raid level's tier;
- gold.

**Defeat.** If every raider is down at once, the raid has failed; everyone is returned after a short wait.

## Guild territory war

| | |
|---|---|
| Territories | Every village outside Eldoria (15). |
| Sieges | Every 2 hours, in the next territory in turn, lasting 15 minutes, announced to the whole server. |
| Scoring | Each second, every guild member (level 30+) within 8 tiles of the village banner scores 1 point for their guild. At most 10 members of one guild count at once. The holder's members count 1.5×. |
| Result | The guild with the most points holds the village until its next siege. With nobody at the banner, the holder keeps it. |
| Benefit | Members of the holding guild gain **5% more experience** from monsters in that region. |
| Shown | A siege banner on screen (time left, the leading guilds), and 🏰[TAG] on the world map. |

## Faction conquest

**Scoring.** Every monster you defeat in a region scores a point for the faction you **follow**: the faction that respects you most, from Friendly (500 reputation) up.

**Control.** The faction with the most points this week controls the region (⚑ on the world map). Its followers gain **5% more experience** from monsters there. Points reset every Monday (UTC).

The territory and faction bonuses add up: up to +10% experience.

## Technical

| | |
|---|---|
| New | `shared/src/conquest.ts`, `server/src/game/Conquest.ts`, `server/src/game/Raid.ts`, `client/src/conquestUi.tsx`, migration `013_conquest_raid.sql` (`territories`, `faction_points`) |
| Changed | The raid boss and its map, the Raid Herald NPC, raid boss odds, kill experience (territory and faction bonuses), the world map badges |

## Tests

New unit tests:
- **Raid:** the herald, level and group rules; minimum raiders; two elite waves and the scaled Shadow; rewards for every raider; leaving.
- **Siege:** the schedule; points by members present; the winner held and stored; its experience bonus.
- **Faction conquest:** the followed faction; points from kills; control; the bonus.

## Not judged by a person

These are first estimates that nobody has played yet:
- the raid boss's strength and health per raider;
- the siege timing and scoring;
- the 5% bonuses.

With only a few players online, a raid of 10 is hard to gather. The minimum is one constant (`RAID_MIN`) if it should be lower while the game is small.
