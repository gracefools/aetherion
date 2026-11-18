# Aetherion Online — Equipment sub-stats, armament, Armageddon and sigils

Version **0.18.0-alpha**.

## 1. Equipment tiers: main stats and sub-stats

Every equipment item has **main stats** (from its base item and item level) and **sub-stats** (random rolls). Each tier (rarity) has stronger main stats, more sub-stat slots and a higher sub-stat range.

| Tier | Main stats | Sub-stat slots | Sub-stat range (share of the stat's value at that item level) |
|---|---|---|---|
| Common | ×1.00 | 1 | 50–90% |
| Uncommon | ×1.12 | 2 | 65–105% |
| Rare | ×1.28 | 3 | 80–120% |
| Epic | ×1.50 | 4 | 95–140% |
| Legendary | ×1.80 | 5 | 110–160% |
| Mythic | ×2.20 | 6 | 130–190% |

- Each sub-stat is a different stat, rolled at random anywhere inside its tier's range.
- The item card lists the main stats and the sub-stats separately. Each sub-stat shows its value, its tier's range, and a bar for how good the roll is.
- Stored items are checked: a sub-stat above its tier's best roll is cut down to it, and extra slots are dropped.
- Items made before this change keep their sub-stats (one fewer slot per tier than now).
- **Sub-stats belong to equipment only.** Armament never has sub-stats and never boosts them.

## 2. Armament (from level 30)

One armament per equipment slot: weapon, armour, helmet, amulet and ring. An armament raises the **main stats** of whatever item is worn in its slot, never the sub-stats.

| Attempt | Chance | On failure |
|---|---|---|
| +0 → +6 | 100% | — |
| +6 → +7, +7 → +8, +8 → +9 | 90%, 80%, 70% | back to +6 |
| +9 → +10, +10 → +11, +11 → +12 | 60%, 50%, 40% | back to +9 |
| +12 → +13, +13 → +14, +14 → +15 | 30%, 20%, 10% | back to +12 |
| +15 → +16, +16 → +17, +17 → +18 | 9%, 8%, 7% | back to +15 |
| +18 → +19, +19 → +20 | 6%, 5% | back to +18 |

**Boost per level:** +1% each to +6, +1.5% to +9, +2% to +12, +2.5% to +15, +3% to +18, +5% to +20. The totals at the checkpoints:

| Level | +6 | +9 | +12 | +15 | +18 | +20 |
|---|---|---|---|---|---|---|
| Total boost | 6% | 10.5% | 16.5% | 24% | 33% | 43% |

**Cost of each attempt** (paid whether it succeeds or not):

| Stage | Material per attempt | Gold |
|---|---|---|
| +0 to +6 | Armament Shard: 1, 1, 2, 2, 3, 3 | 500 × (level + 1)^1.5: 500 for the first attempt, about 44,700 for the last |
| +6 to +12 | Armament Core: 1, 1, 2, 2, 3, 3 | (same formula) |
| +12 to +20 | Armament Relic: 1, 1, 1, 2, 2, 2, 3, 3 | (same formula) |

Enhancing is refused in combat and during a trade.

**Materials** come only from dungeon bosses on **Nightmare** or **Armageddon**, rolled for every player:

| | Nightmare | Armageddon |
|---|---|---|
| Shards | 60% (1–2), any dungeon | 2–3 always |
| Cores | 22%, dungeon level 24+ | 45% (1–2), dungeon level 16+ |
| Relics | 7%, dungeon level 32+ | 15%, dungeon level 24+ |

**Weapon glow:** +6, +12 and +18 on the weapon armament make the equipped weapon glow white, blue and ember (a halo with rising motes, stronger at each step). Other players see it too.

## 3. Armageddon

A fourth dungeon difficulty that only characters of **level 50 or higher** can enter. Everyone who enters must be 50+; a party member below 50 is left at the gate.

| | Value |
|---|---|
| Monster health | ×5.5 |
| Monster damage | ×2.6 |
| Monster level | +20 |
| EXP | ×3.4 |
| Gold | ×4 |
| Boss item rarity | Epic 30%, Legendary 48%, Mythic 22% |

Its bosses drop the most armament material and the sigils.

## 4. Sigils (from level 50)

- **Drops:** a sigil drops only from dungeon bosses on Armageddon, to each player at a 35% chance. It is announced to the room.
- **Shape and slot:** there are six shapes (Circle, Triangle, Square, Diamond, Star, Crescent) and six slots, one per shape. A sigil fits only the slot of its own shape; equipping one returns the sigil already in that slot to the bag.
- **Symbol:** Dark Moon, Bright Ember or Fallen Angel.
- **Skill bonus:** each sigil raises one random class skill, from any of the six classes, active or passive, by +1 to +3.
  - It works only for a skill of the wearer's own class that the character has learned. A sigil naming another class's skill does nothing, and the panel says so.
  - The bonus can take a skill above its normal maximum rank. The server casts the skill at the higher rank, and passive skills raise the stats.
  - Taking the sigil off removes the bonus at once.
- **Set bonuses:** 2, 4 or 6 sigils of the same symbol give its set bonus. The highest tier reached applies.

| Symbol | 2 | 4 | 6 |
|---|---|---|---|
| Bright Ember | +9% damage, +10% critical damage | +12%, +15% | +15%, +20% |
| Fallen Angel | +10% max HP, +5% resist, +5% defence | +15%, +10%, +10% | +20%, +15%, +15% |
| Dark Moon | −5% attack time, +5% critical rate, +5% lifesteal | −7%, +10%, +10% | −10%, +15%, +15% |

"Damage" raises attack and magic attack. Sigils can be traded, banked and sold at the auction house (a new Sigils category).

## 5. Where it is in the game

The inventory (I) now has three tabs:
- **Bag**, with the new item card.
- **Armament:** each slot with its level and boost, the next level's boost, the success chance and fall-back, the cost and how much material you have.
- **Sigils:** the six shaped slots, the symbol sets, the skill ranks from sigils, and the sigils in your bag.

The dungeon gate offers Armageddon (locked below level 50) and says which difficulties drop armament material.

## 6. Technical

| | |
|---|---|
| New | `shared/src/gear.ts` (armament tables, costs, drops, sigils, sets, skill ranks, validation, materials and sigil items), `client/src/gearUi.tsx`, migration `009_gear.sql` (`characters.gear`) |
| Changed | `shared/src/items.ts` (tiers: sub-stat slots and ranges, main and sub-stats apart, sigil items), `shared/src/dungeons.ts` (Armageddon), `server/src/game/World.ts` (stats, storage, boss drops, weapon glow), `Inventory.ts` (commands `arm`, `sigil`, `unsigil`), `Dungeon.ts` (level 50 gate), `Abilities.ts` (sigil ranks), `server/src/db/repo.ts`, the client inventory, gate and renderer |

Armament levels and sigils are stored in `characters.gear`, written in the same statement as gold, inventory and equipment. An enhancement and the gold and materials it used are always saved together, as is a sigil moving between bag and slot.

## 7. Tests

| Suite | Result |
|---|---|
| Type check | 0 errors |
| Unit + integration | **185 / 185** (179 before) |
| Browser end-to-end | **passed** |

New unit tests:
- **Tiers:** slots and ranges by tier; rolls staying in range and covering it; stored items cut down to their tier; main and sub-stats kept apart.
- **Armament tables:** every chance, fall-back and boost value exactly as specified; materials by stage; drops by difficulty and dungeon level.
- **Armament on the server:** the level-30 gate; gold and materials paid; six safe enhancements; a failure falling back to +6; the boost reaching main stats only; the weapon glow sent to others; not in combat.
- **Armageddon:** the level-50 gate.
- **Sigils:**
  - drops and slots by shape;
  - +3 to a learned skill makes it hit harder, and stops when the sigil comes off;
  - another class's skill does nothing;
  - set bonuses at 2 and 6;
  - stored sigils in the wrong slot are dropped.

New integration test: armament and sigils are stored in PostgreSQL and come back after logging in again.

New browser checks: the item card's main and sub-stats; the weapon armament enhanced to +6 through the panel; the white glow, also seen by the other player; two sigils equipped, with their set bonus and skill rank.

Fixed while testing:
- **Real bug:** the weapon glow was not sent to other players when it changed.
- **Older browser tests,** which depended on old numbers or on timing:
  - the music check now keeps cleared monsters away (they respawn within seconds now);
  - the auto-hunting check measures from the moment hunting starts;
  - the run-speed check uses the page's own clock.

## 8. Not judged by a person

All of these values are first estimates and nobody has played with them: the costs, drop rates, Armageddon multipliers, sigil drop chance and sub-stat ranges.
