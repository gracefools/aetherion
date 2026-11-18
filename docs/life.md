# Aetherion Online — Pet evolution, flying mounts, professions, housing, season pass, wardrobe

Version **0.24.0-alpha** (batch G, the last of the post-200 feature list). Most of it lives in the new **Life** panel: **F7**, or "Life" in the menu. Its button counts season levels waiting to be claimed.

## Pet evolution

Pets now level to **60** and evolve at 20, 40 and 60 into Grown, Elder and Mythic forms. Each evolution:
- adds a quarter of the pet's top bonus;
- draws the pet larger, with a glow that changes colour (white, blue, gold);
- adds the stage to its name in the companions panel.

## Flying mounts (level 120)

| Mount | Level | Speed | How to get it |
|---|---|---|---|
| Sky Griffin | 120 | ×1.7 | 3% from world bosses of level 120+, 5% from the raid boss |
| Star Drake | 160 | ×1.85 | 1.5% from world bosses of level 160+, 2% from the raid boss |

While riding one you fly over **water and forests**; walls, rock and the edge of the map still stop you. The rule is the same on the server and in the client's movement prediction. Flyers are drawn higher, with their shadow below.

## Professions

| Profession | Trained by | Gets |
|---|---|---|
| Mining | Iron and star-shard nodes | One more ore every 15 levels; **Mithril Ore** from level 20 |
| Herbalism | Moonleaf nodes, harvesting the garden | More leaves; **Sunpetal** from 20 |
| Fishing | "Fish here" next to any water (every 4 s) | River Fish, Moon Carp; **Star Koi** from 20 |
| Smithing | Forging | Better forged gear |

**Levels:** 1 to 50.

**Rare finds:** from level 20 the chance starts at 5% and rises 0.6% per level.

**Forging at a merchant:** choose an equipment piece of your class and the sub-stats it should have.

| Smithing level | Rarity | Sub-stats you choose |
|---|---|---|
| 1 | Uncommon | 1 |
| 8 | Rare | 2 |
| 20 | Epic | 3 |
| 35 | Legendary | 4 |
| 45 | Mythic | 5 |

- **Values:** each chosen sub-stat rolls in the top half of its tier's range.
- **Item level:** 10 + 4 × smithing level, at most your level + 2.
- **Cost:** gold plus iron ore and upgrade stones, with mithril from Epic and star shards from Legendary.

**Cooking:** a merchant cooks 3 River Fish into 3 health potions.

## Housing

**Housing Steward Pell** on the Eldoria plaza:
- takes you to **your home**, a private house of your own, or lets you **visit** a friend who is online;
- sells **furniture** (bed, table, chair, lamp, banner, fern, trophy, chest) and **seeds**.

**Inside your own home:**
- **Furniture:** stand where a piece should go and place it, up to 30 pieces. Pick a piece up to move it. Visitors see it but cannot move it.
- **Garden:** three plots. A Moonleaf Seed gives 6 Moonleaf, a Sunpetal Seed 2 Sunpetal, and an Ore Spore 6 Iron Ore, each two hours after planting.
- **Bed:** sleep once a day to wake up **Rested**: +5% attack and defence for half an hour.

## Season pass (free)

- **Length:** a season lasts six weeks and has 30 levels of 1,000 season experience each.
- **Season experience from:** kills (2), elites (20), quests (80), dungeon bosses (120), dungeons (150), missions (250), world bosses (300), Rift floors (40) and raids (600).
- **Rewards:** gold, Armament Shards and Cores, Awakening Essence, and **weapon glow colours** (Violet at level 10, Emerald at 20, Aurora at 30). Each level is claimed once in the Life panel.

## Wardrobe

- **Looks:** every armour and helmet you equip is collected as a **look**. Wear any collected look over your real gear: others see the look, while your stats stay those of what you actually wear.
- **Glow colour:** the weapon glow (from armament +6) can wear a colour from the season pass, and others see it too.

## Technical

| | |
|---|---|
| New | `shared/src/life.ts`, `server/src/game/Life.ts`, `client/src/lifeUi.tsx`, migration `014_life.sql` (`characters.life`) |
| Changed | Companions (pet stages, flying mounts), movement (flying over water and trees), the home map, items (materials, seeds, furniture, reins), the Rested status, gathering, the wardrobe in the character's look, season experience from the journal's events |

## Tests

New unit tests:
- pet evolution and its bonus;
- flying over water but never off the map;
- gathering and rare finds;
- fishing at the water and its pace;
- forging with chosen sub-stats;
- furniture, the garden and the bed;
- visits;
- season experience and claims;
- looks and glow colours.

## Not judged by a person

These are first estimates that nobody has played yet:
- profession pace and rare chances;
- forging costs;
- the season experience values;
- furniture prices;
- flying mount drop rates.

The furniture and the garden are drawn as simple symbols; hand-made art would replace them.
