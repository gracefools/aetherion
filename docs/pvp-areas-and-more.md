# Aetherion Online — PvP areas, class progression, auto hunting and interface improvements

Version **0.17.0-alpha**.

## Open-PvP areas: free ground and PvP ground at 5 : 1

- **Every region** (all six) is split into free ground and **one open-PvP area** covering a sixth of the map. That is 5 : 1 by area; the measured share is 16.4–16.8% per region.
- **Free ground:** no open combat; duels are allowed anywhere in a region, the capital included.
- **Inside the area:** open PvP under the existing rules: both players level 20+, at most 10 levels apart, a 60-second shield after a defeat, no repeat rewards for 10 minutes. Both players must be inside the area. Dungeons stay safe.
- **Placement:** the area is chosen from the map data and is the same on server and client. It is a rectangle (square, wide or tall) that keeps clear of the town, the roads between regions, dungeon entrances, the arrival point and the world boss, so nobody has to cross it. It is placed over monster camps, as far from the town as possible.
- **Its monsters are fierce:**

  | | |
  |---|---|
  | Health | ×1.6 |
  | Damage | ×1.35 |
  | Level | +3 |
  | Experience | **+50%** |
  | Gold | **+50%** (on top of the gold the higher level brings) |
  | Item drop chance | **−40%** |

  They are marked ⚔ with a red name and "Fierce" on the target frame. The values are `PVP_AREA_MONSTER` in `shared/src/pvp.ts`.
- **How players see it:**
  - **On the ground:** a red tint with a moving dashed border.
  - **Minimap:** a red outline.
  - **World map:** a red block with a pin explaining the rules, a legend entry and a ⚔ badge on each region.
  - **Crossing the edge:** "Open PvP area" on screen and a chat line, and the PvP badge reads "Open PvP" or "Free zone".

## Class progression bonuses

Reaching a job's second tier (level 20) and third tier (level 45) gives a lasting bonus. It is announced to everyone nearby ("X has become a Vanguard!"), and the character sheet lists each tier's bonus and whether it is reached.

| Job | Tier 2 (level 20) | Tier 3 (level 45) |
|---|---|---|
| Knight | Vanguard: +8% HP, +10% defence | Aegis Lord: +6% HP, +12% defence, +8% resist |
| Mage | Runeweaver: +10% magic, −5% rune cost | Archmagus: +12% magic, +8% mana, +3% crit |
| Ranger | Pathfinder: +8% attack, +5% speed, +3% crit | Stormwarden: +10% attack, +10% crit damage, +20 range |
| Assassin | Nightblade: +8% attack, +5% crit | Umbral Phantom: +15% crit damage, +5% dodge, +5% speed |
| Cleric | Lightbinder: +10% healing, +8% mana | Dawn Oracle: +12% healing, +8% resist, +8% HP |
| Berserker | Ravager: +8% attack, +3% lifesteal | Bloodreaver: +10% attack, +8% HP, −6% attack time |

The bonuses are applied in the shared stat calculation, so the server and the client agree (`TIER_BONUS` in `shared/src/jobs.ts`).

## Auto hunting

- **Shortcut:** a new rebindable action, "Start / stop auto hunting", default key **`** (backquote). It works from anywhere in the game; the panel shows the key.
- **Minimise:** ▁ shrinks the panel to one bar showing status, kills, and the Start/Stop button. ▢ expands it again. The choice is remembered in the browser.
- **Bosses:** a new "Fight bosses" switch, off by default. With it on, dungeon and world bosses are chosen like other monsters, and a boss you target yourself is fought too. The hunter does not dodge boss attacks.

## Combat text

Floating numbers now come in distinct styles: large, with a thick outline, a pop-in, and stacking so numbers appearing together do not overlap.

| | Style |
|---|---|
| Your hits | 19 px, warm white |
| Critical hits | 28 px orange with "!" |
| Damage you take | 21 px red |
| Healing | 21 px green, "+N" |
| EXP | 18 px purple, "+N EXP" |
| Gold | 17 px gold, "+N gold" |
| Other players' fights | small and faint, so your own numbers stand out |

The "Damage numbers" setting now hides only the damage numbers; it used to hide the hit sparks instead.

## Chat and settings

- **Chat:** the channel list now has **Guild** next to Zone and Party, available when you are in a guild.
- **Settings:** a **⚙ Settings** button beside the minimap opens the settings, as the O key does. It has five tabs: Audio (volumes), Controls (key binding), Graphics, Interface (UI size 80–150%, language, full screen), and Camera & movement.

## Tests

| Suite | Result |
|---|---|
| Type check | 0 errors |
| Unit + integration | **179 / 179** |
| Browser end-to-end | **passed** |

**New unit tests:**
- **Areas:** one per region; a sixth of the map; clear of the town, roads, dungeon entrances, the world boss and the arrival point; with monster camps inside.
- **Fierce monsters:** health, level, damage, EXP, gold and drop factors on every monster placed inside an area and none outside; the same kill gives +50% EXP.
- **PvP rules:** open combat only when both players are inside the area, and duels allowed everywhere else in a region.
- **Class progression:** every tier bonus is applied exactly as listed and not before its level; the new title is announced.
- **Auto hunting:** bosses are chosen only with the switch on.

**New browser checks:** the settings button; sending on the Guild channel; walking into an open-PvP area (announcement, badge, a fierce monster); the auto-hunting key starting and stopping the hunter; the minimised bar; the new combat text.

**Older tests updated for the new rules:**
- Duels are now allowed in the capital.
- Unit tests that use level 30 and 60 characters account for their class bonuses.
- The browser music test picks hunting grounds outside PvP areas and away from elites (a fierce camp had killed the test character).

**Test fixes:**
- **Run speed:** measured against the page's own clock, so a slow moment of the test machine no longer fails it.
- **Auto hunting:** the "walk to a far target" check now places that target beyond every spell's range; before, it could sometimes be hit without walking.

## Not judged by a person

All of these values are first estimates and nobody has played with them: the PvP-area multipliers, the tier bonuses, the colours and sizes of the combat text, and how the areas feel to cross.
