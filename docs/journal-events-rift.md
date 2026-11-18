# Aetherion Online — Journal, mail, world events, night and weather, the Endless Rift

Versions 0.20.0–0.20.1-alpha (batches A–C of the post-200 feature list).

## A. Journal and mail

**Journal (F3, or "Journal" in the menu).** Four tabs:

| Tab | What it holds |
|---|---|
| Missions | Three daily and three weekly missions, the same for everyone that day or week. Progress comes from play: kills, elites, dungeon clears, bosses, world bosses, gathering, quests. Each mission is claimed once for gold, EXP and materials scaled to your level. The 7-day login reward is here too: missing a day starts the cycle again, and day 7 gives an Advanced Rune Scroll and an Armament Core. |
| Achievements | 39 achievements counted from server events: kills, elites, bosses, world bosses, dungeons, Armageddon, quests, gathering, PvP, duels, levels, armament, sigils, codex, logins, missions. |
| Titles | 28 achievements unlock a title. Wear one: it shows in gold above your name, other players see it, and it gives a small bonus (for example "the Hunter": +1% attack and magic). |
| Codex | A card for every monster: 100 kills for an ordinary monster, 10 for an elite, 1 for a boss. Completing a region's set gives a permanent bonus, which varies by region. |

**Stats by source.** The character sheet now shows the title and codex bonuses as their own source.

**Mail (F4, or "Mail" in the menu).**
- **Sending:** write to any character, online or not, from any village. A letter can carry up to 5 items and gold. Postage is 30 gold plus 20 per item.
- **Atomic:** sending and taking the contents are each one database transaction with your bag, so nothing is lost or taken twice.
- **New letters:** they are announced, and the menu button shows the unread count.

**Database.** Migration `010_journal_mail.sql` adds `characters.journal` and the `mail` table.

## B. World events, night and weather

**World events.** One runs at a time, in a region where players are, every 8–16 minutes. Everyone is told by a banner and on the world map (✦).

| Event | What happens |
|---|---|
| Invasion | Waves of the region's monsters (at most 8 at a time) appear 30–40 tiles out and march into the village. |
| Meteor Shower | 6 Star Fragments to break open. |
| Treasure Goblin | It runs away from whoever attacks it and never fights back. |

Win in time and everyone who did at least 3% of the work is paid by their share: gold, EXP, upgrade stones, and armament shards from region level 30.

**Day and night.** One full day per hour of real time. At night the world darkens, with soft light around you and the village. Every region except Eldoria also gets extra **night monsters** (☾, purple names): +80% health, +35% attack, +80% EXP and gold. They leave at dawn.

**Weather.** It depends on the region and changes every 12 minutes:
- rain and storms (with lightning);
- snow in frost lands;
- ash in fire lands;
- fog on the moors;
- falling stars in the astral lands.

It can be turned off in Settings → Graphics ("Night and weather").

## C. The Endless Rift

| | |
|---|---|
| Entry | Rift Warden Selwyn on the Eldoria plaza, from level 20. Alone, or with a party: every member agrees, like a dungeon. |
| Floors | One wave per floor in the rift's hall, cleared within 120 seconds. A guardian (a dungeon boss) every 5th floor. Monster level = the climbers' average level − 4 + 0.8 per floor, plus 5% health and 3% attack per floor. |
| Rewards | Gold and EXP for every floor. Guardian floors also give upgrade stones, armament shards, and Cores from floor 20. |
| End | A floor not cleared in time, or everyone fallen. You are returned after 20 seconds. |
| Leaderboard | Each character's best floor this week (faster first on the same floor), shown by the Rift Warden. Migration `011_rift.sql`. |

## Fix: blank screen after logging in (0.20.1)

**Cause:** a character standing at the entrance of one of the new dungeons crashed the interface, because the new bosses have no list of unique drops yet.

**Fix:** the entrance window handles that case. Every panel is now also isolated, so one failing panel hides itself for a few seconds instead of blanking the game.

## Tests

| Suite | Result |
|---|---|
| Unit + integration | 200 (one assertion updated for the Rift Warden; the full suite is re-run with the next batch) |
| Browser end-to-end | Passed for the journal, mail and world events. The Rift is covered by unit tests only. |

New tests:
- **Journal:** achievements and titles (the bonus, and others seeing the title); the codex set bonus; missions (the same for everyone, claimed once); the login cycle.
- **Mail:** letters stored in PostgreSQL and taken once.
- **World events:** invasion, meteor, goblin (running away, and losing when time runs out).
- **Night and weather:** night monsters and dawn; weather by climate.
- **Rift:** floors, guardian, rewards, timeout and the stored score.
