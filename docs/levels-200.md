# Aetherion Online — Levels to 200, auto hunting fixes, dungeons, sigil tiers and the new menu

Version **0.19.0-alpha**.

## 1. Auto hunting (released first, 0.18.1)

| Change | How it works now |
|---|---|
| Start/stop shortcut | **`** (Backquote) and now also **F2**. Both can be changed in Settings → Controls. |
| Moving no longer stops it | Holding a movement key steers the character for a moment ("You are steering"). When the key is released, hunting carries on around where you let go. Stop with the button or the shortcut. |
| Keeps running in the background | Browsers stop painting a hidden or covered window, which used to stop the hunter. A timer in a worker (`/clock.js`) now keeps the game simulation running while you use another application. |
| Shortcuts while typing | One check (`shortcutAllowed`) decides for every shortcut. Nothing fires while you type in a text field, a list or editable text, or while an input method is composing a word. Nothing fires with Ctrl, Alt or the system key held (copy, paste). Space and Enter on a focused button press only the button. A button clicked with the mouse gives its focus back, so Space attacks again. |

## 2. Experience

**Experience to the next level**

```
TIER(L)          = ceil(L / 30)        // 1–30 → 1, 31–60 → 2, …, 181–200 → 7
TIER_MULTIPLIER  = 3^(TIER(L) − 1)     // ×1, ×3, ×9, ×27, ×81, ×243, ×729
EXP_REQUIRED(L)  = 40 × L^1.8 × 3^(ceil(L/30) − 1)
```

The level cap is now **200**.

**Experience by level difference**

| Monster compared with you | EXP received |
|---|---|
| Your level or higher, or up to 2 levels below | 100% |
| 10 below | 71% |
| 20 below | 36% |
| 29 below | 4% |
| 30 or more below | 0% |

From 3 levels below, the share falls evenly to nothing at 30 below: `(30 − below) / 28`.

## 3. The world to level 200

Ten new regions continue east of the Astral Ruins. Each has a village (with merchant, waystone, lorekeeper, banker and rune merchant), five monster types (four ordinary and one elite), a dungeon, quests, resource nodes and hidden caches.

| Region | Levels | Village | Dungeon (boss level) | World boss |
|---|---|---|---|---|
| Emberwaste | 45–60 | Kilnspire | The Molten Crucible (50) | — |
| Thornwild | 60–75 | Briarhold | The Briar Vault (65) | The Thorn King (72) |
| Glacierdeep | 75–90 | Coldharbor | The Icebound Vault (80) | — |
| Hollowfen | 90–105 | Wickmire | The Sunken Crypt (95) | The Lich Regent (102) |
| The Riftlands | 105–120 | Shardwatch | The Shattered Spire (110) | — |
| Crownfall | 120–135 | Last Bastion | The Throne of Ash (125) | Dragon Tyrant (132) |
| Cinderdeep | 135–150 | Ashgate | The Core of Ruin (140) | — |
| Elderwood | 150–165 | Rootsong | Heartroot Hollow (155) | The Wild God (162) |
| Stormspire | 165–180 | Galehold | Eye of the Storm (170) | — |
| Voidreach | 180–200 | Edge of Stars | Heart of Aetherion (200) | The Unmaker (198) |

**How the new monsters are made.** Each new monster borrows the attacks, movement and art of an existing monster, recoloured for its region. Its stats come from the level curves.

**Stat curves past level 60.** Health and defence grow more slowly above level 60, so fights last about as long as they do at 60 while player attack keeps growing:

| | Up to level 60 | Above level 60 |
|---|---|---|
| Health | 40 + 24L | 1480 + 16(L − 60) |
| Defence | 2 + 1.2L | 74 + 0.4(L − 60) |

Item levels go up to 220.

**Every 20 levels**, elites, dungeon bosses and world bosses get much harder: +20% health and +10% attack per step.

| Level | Health | Attack |
|---|---|---|
| 40 | ×1.4 | ×1.2 |
| 100 | ×2 | ×1.5 |
| 200 | ×3 | ×2 |

**World bosses** have area attacks 1.5 times wider.

**Maps are 1.5 times bigger.** Every open-world map grew by half in both directions, and everything on it moved with it. Camps cover more ground and hold 30% more monsters.

**Villages are kept clear.** No camp lies within 28 tiles of a village centre (the village radius is 14). A camp that was closer was moved straight out. A spawn point inside that ring is rejected. A patrol never leads into it, and a chasing monster breaks off 20 tiles from the centre. Monsters a test or a summon places inside a village are not affected, and neither are bosses.

## 4. Dungeons

- **Longer and bigger:** five combat chambers (two more than before) and a larger boss hall. Every wave holds 1.5 times the monsters (elites excepted). Two new halls, "The Deep Halls" and "The Gauntlet", mix the dungeon's monsters before the elite guard.
- **The whole party must agree.** The leader starts the entry at the gate. It is refused, with the names, unless every member is at the entrance, alive and high enough in level. Then every member is asked (30 seconds). A single "Decline" or a timeout cancels it. When everyone agrees, the position check runs once more and the whole party goes in together. Alone, you enter at once.
- **Armageddon only where the boss is level 50 or higher.** That means the ten new dungeons, not the four original ones. The gate says so. Characters still need level 50.

## 5. Armament material from world bosses

World bosses of level 30 or higher now drop armament material for every rewarded player:

| Material | From world-boss level | Chance |
|---|---|---|
| Shard | 30 | 70% (1–2) |
| Core | 60 | 25% |
| Relic | 100 | 8% |

## 6. Sigil tiers

| Tier | Drops from Armageddon bosses of level | Skills per sigil | Bonus per skill |
|---|---|---|---|
| 1 | 50+ | 1 | +1 |
| 2 | 80+ | 1 | +1 to +2 |
| 3 | 110+ | 2 | +1 to +2 |
| 4 | 140+ | 2 | +1 to +3 |
| 5 | 170+ | 3 | +1 to +3 |
| 6 | 200 | 3 | +1 to +4 |

- **Which tier drops:** a dungeon boss drops the highest tier its designed level allows. For example, tier 3 drops only from Armageddon bosses of level 110 or more.
- **Skills on one sigil:** they are always different, and can be class skills or **sub-skills** of any class. A sub-skill bonus works only if you have learned that sub-skill, and it can take it beyond its rank limit of 3.
- **Set bonus by tier:** every tier above the first adds 1 point to every effect of its symbol set. That includes 1% less attack time for Dark Moon. The lowest tier among the set's equipped sigils counts.
- **Older sigils:** sigils from before this change count as tier 1 and keep their skill.

## 7. Stats by source

The character sheet (C) now lists each combat stat as **value (base + extra)**, for example **Attack 250 (200 + 50)**. Select a stat to see each source:

- class passives and progression;
- the skill tree;
- sigil skill ranks;
- equipment, item by item;
- armament, slot by slot;
- sigil sets;
- pet and mount;
- effects active right now.

The numbers come from the same functions the server uses (`shared/src/statsources.ts`). A test checks that they add up to the server's stats.

## 8. The new menu

A **menu dock** in the lower right replaces the loose buttons (bag, auto hunting, settings, guild, companions). It groups every panel:

| Group | Panels |
|---|---|
| Character | Hero (C), Skills (K, with a badge for unspent points), Bag (I), Pets (P) |
| Adventure | Quests (L), World map (M), Auto (V, lit while hunting) |
| Social | Guild (N, with the guild tag) |
| System | Settings (O), Help (F1), Exit |

- Every button shows its icon, name and current shortcut. Open panels are lit.
- The arrow shrinks the dock to icons only; the choice is remembered in this browser.
- The long controls line is now folded away behind **Controls** next to the ping counter.

## 9. Tests

Results:

| Suite | Result |
|---|---|
| Type check | 0 errors |
| Unit + integration | **190 / 190** (185 before) |
| Browser end-to-end | **passed** (all 16 regions rendered, 105 monster sheets validated) |

New unit tests:
- the EXP tiers and the −30 level curve;
- the ten regions (village, gate, monster levels, elites, bosses, Armageddon only from boss level 50);
- stronger elites and bosses every 20 levels, and the wider world-boss areas;
- the map scale and camps clear of villages;
- sigil tiers (slots, ranges, sub-skills, stored sigils clamped, tier set bonus, sub-skill ranks);
- world-boss armament material;
- the stat breakdown adding up to the server's stats.

Updated tests:
- the party dungeon entry now agrees first (unit and integration);
- dungeons have six stages and more monsters;
- the arena hall moved with the larger dungeon map;
- discovery and camp counts;
- the audio themes of the new regions.

Fixed while testing:
- **Real bug:** on a small screen the new dock covered the bottom of the auto-hunting panel. Panels now sit above the dock, and the auto panel stops short of it.
- **Real bug:** a target cleared with Escape (or changed with Tab or a click) could come back. A snapshot sent just before the server saw the change restored the old target. The client now keeps its own choice until the server has caught up.
- **Browser test:** the camps are larger now, so the region and world-boss checks clear the visitor's surroundings first. Before, the visitor could die and wake up at the spawn point.

## 10. Not judged by a person

These are first estimates that nobody has played yet:
- the region levels and the curves past level 60;
- the "every 20 levels" step;
- the village margin;
- the dungeon wave sizes;
- world-boss material rates;
- the 30-level EXP tiers, which make the late levels very long (about 82,000 same-level kills from 199 to 200).

The new monsters reuse existing art in new colours, and the new regions reuse the music of the region of the same kind.
