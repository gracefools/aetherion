# Aetherion Online — Development Progress

Tracks the extended specification (M10–M18 and the monster spawn/navigation fix). Milestones M1–M9 are reported in `docs/M1.md` … `docs/M9.md`.

Last updated: 2026-11-18 · version 0.19.0-alpha

## Milestone status

| Milestone | Status | Report |
|---|---|---|
| M10 — Audio, original music and sound effects | **System done and tested. Audio assets are temporary placeholders**: the Suno MCP integration was not available | [docs/M10.md](docs/M10.md) |
| Monster spawn, navigation and map bug | **Fixed and tested** (bad spawn positions 4.3% → 0%; pathfinding; developer overlay) | [docs/monster-navigation.md](docs/monster-navigation.md) |
| M11 — Auto hunting | **Done and tested** | [docs/M11.md](docs/M11.md) |
| M12 — Skill icons, rune scrolls, asset pipeline | **Done and tested**, with limits listed below | [docs/M12.md](docs/M12.md) |
| M13 — Quests and faction reputation | **Done and tested** | [docs/M13.md](docs/M13.md) |
| M14 — Guild and player economy | **Done and tested** (guilds, bank, auction house; trading, bulk sale and sorting from M11) | [docs/M14.md](docs/M14.md), [docs/M11.md](docs/M11.md) section 4 |
| M15 — PvP, pets and mounts | **Done and tested**, with limits listed below | [docs/M15.md](docs/M15.md) |
| M16 — World map, tutorial and settings | **Done and tested**, with limits listed below (game content is not translated yet) | [docs/M16.md](docs/M16.md) |
| M17 — Account security, moderation, admin panel | Not started | — |
| M18 — Integration, testing, alpha readiness | Not started | — |

## Completed features (this specification)

**M10** — Web Audio engine; dynamic music (16 tracks) from authoritative state; 68 sound effects; 5 ambience loops; audio settings saved per account; autoplay handling; audio asset pipeline. Later additions: a harder combat track, a faster elite track and a battle-start impact.

**Monster navigation** — navigation data per zone; spawn validation with logged rejections; spawn regions as configuration; patrol, chase around obstacles, give up unreachable targets, return home; bounded route search; developer overlay (F9 with `DEBUG_OVERLAY=1`).

**M11** — auto hunting panel and hunter (attack, skills with per-skill conditions and priorities, potions at thresholds, target choice, hunting radius, stuck recovery, return to a safe location); server session (figures, loot filter, automatic stops); configuration saved per character.

**0.19.0** — levels to 200: tiered EXP (×3 every 30 levels), EXP down to 30 levels below, ten new regions with villages, dungeons and five more world bosses, maps 1.5× larger, monsters kept away from villages, longer dungeons with more monsters and party agreement to enter, Armageddon only from boss level 50, sigil tiers (and sub-skills on sigils), armament material from world bosses, stats by source on the character sheet, a grouped menu dock; auto hunting keeps running in the background, moving steers instead of stopping, F2 also toggles it, and shortcuts no longer fire while typing ([docs/levels-200.md](docs/levels-200.md)).

**Requested after M16** — sub-skills: two enhancement branches (3 ranks each, skill points) for every active skill of every job, 74 in all, applied by the server to each cast ([docs/subskills.md](docs/subskills.md)).

**Requested after M16 (4)** — equipment sub-stats by tier (1 to 6 slots, rising random ranges); armament from level 30 (one per equipment slot, +0 to +20 with the requested chances, checkpoints and boosts, main stats only, materials from Nightmare and Armageddon bosses, weapon glow at +6/+12/+18); Armageddon difficulty for level 50+; sigils from level 50 (six shapes, three symbols, +1 to +3 class skill ranks, set bonuses at 2/4/6) ([docs/gear.md](docs/gear.md)). Migration 009 adds `characters.gear`.

**Requested after M16 (3)** — every region split 5 : 1 into free ground (duels only) and one open-PvP area with fierce monsters (+50% EXP and gold, −40% item drops); class progression bonuses at levels 20 and 45 for every job; auto hunting start/stop key, minimised bar and an optional boss switch; larger, colour-coded combat text; Guild in the chat channel list; a Settings button beside the minimap ([docs/pvp-areas-and-more.md](docs/pvp-areas-and-more.md)).

**Requested after M16 (2)** — more monsters and faster respawns: ordinary camps hold 1.6 times as many monsters on slightly larger ground; ordinary monsters respawn in 45% of their former time, elites in 60%; bosses unchanged (`SPAWN_DENSITY`, `RESPAWN_SPEED` in `shared/src/monsters.ts`). Monsters now patrol only along straight lines inside their patrol circle, so a route around an obstacle can no longer carry them outside it. Smarter auto hunting: the hunter plans where to stand (the nearest reachable spot with the target in reach and in plain sight) and chooses targets by walking distance; it attacks from around a corner instead of circling a monster behind an obstacle, attacks flying monsters hovering over trees and rocks from the edge, and leaves alone monsters it cannot hit from anywhere.

**Requested alongside** — bulk sale with confirmation; server-side inventory sorting; secure player trading of items and gold with an audit log; richer skill effects (glow, sparks, shockwaves, screen shake).

**M13** — 48 quests of nine types from town lorekeepers; quest log, tracker, history; six factions as database records with reputation levels, gifts, faction quests and shops.

**M14** — guilds (founding with name, tag and emblem; four ranks and permissions; invitations; guild chat; message of the day; guild bank and log; leadership transfer; disband); a private bank at every town's banker (60 slots and gold, with history); an auction house (search, filters, sorting, pages, listing fee, sales tax, cancel, expiry, collection, history), race-safe and transactional.

**M15** — PvP rules per zone (safe, duel-only, open) with level, town, party and post-defeat protection; server-resolved player combat; duels that end at 1 health; an arena with rewards; PvP records and rankings (also over HTTP); six pets with passive bonuses and levels; four mounts with speed through the normal movement rules; original sprites for both.

**M16** — interactive world map (regions, explored and unexplored, towns, waystones, dungeons, hunting grounds, elites, world bosses, roads, player and party positions, personal markers, travel at a waystone); a 12-step tutorial driven by what the player does, with skip, resume, read again and start over; settings for audio, key binding (37 actions, two keys each, conflict detection, restore defaults), graphics, interface scale, full screen, language, camera and movement, saved per account; an internationalisation layer with English and Indonesian for the whole interface and every server message.

**M12** — 112 original icons with a manifest; runes as collectibles (owning, equipping and upgrading kept separate); Rune Merchant in every town; eight Rune Scrolls with reward tables; scroll drops from monsters, elites, dungeon bosses and world bosses; asset pipeline extended to icons, NPC sheets, tilesets and effect strips with derived metadata.

## Incomplete features

| Item | Why | What it needs |
|---|---|---|
| Original music generated with Suno | No Suno MCP server is connected | A Suno account and a Suno MCP server added to Claude Code (docs/M10.md sections 2 and 10) |
| A person listening to the audio and looking at the effects and icons | The assistant can neither hear nor judge by eye | Play it; report what is wrong |
| Rune Scrolls from events | No event system | An event system (quests now give scrolls) |
| Game loading of imported NPC sheets, tilesets, effect strips and character layers | Validated and described, but the renderer draws these from code | Renderer support per type |
| Hand-designed icons for the 22 passives | They use sigils derived from their ids | Design, or imported art |
| Server-side line-of-sight rule for attacks | The game has never required line of sight; the auto hunter requires it of itself | A design decision |
| Special Event music trigger, wood footsteps | No event system, no wooden floors | Those systems |
| Tab-targeting players; matched arena teams or queues | Players are targeted by clicking; the arena is one shared room | Design and implementation |
| PvP balance between jobs | Not tuned; PvP damage is a flat 60% of normal | Play testing |
| Tuning of PvP-area monsters and class bonuses | First estimates | Play testing |
| Tuning of armament costs, material and sigil drop rates, Armageddon | First estimates | Play testing |
| Indonesian names and descriptions of items, skills, monsters, places and quests, and lore | Content was out of this pass; the interface and all messages are translated | Content keys for the data files (the catalog approach of M16 extends to them) |
| A native speaker reading the Indonesian text | Written by the assistant | Review |

## Known bugs and limitations

- All audio is placeholder and unheard; relative loudness is an estimate.
- New characters own no rune until they visit a Rune Merchant (the first rune is free); the M16 tutorial now says so.
- Scroll drop rates, rune prices and sub-skill values are untuned first values.
- The developer overlay is enabled for a whole server, not per account (no admin roles until M17).
- Routes are four-directional over tiles: monsters and the auto hunter turn square corners.
- One integration test (portal travel) failed once in a full run and passed three times alone; it looks timing-sensitive and is being watched.
- Tutorial progress and map markers are per account, not per character: a second character starts with the first one's ticks (it can start over from F1).
- During M16 the browser test once failed to clear a target with Escape right after the Tab step; it passed in every later run. A diagnostic message is in the test in case it returns.
- The browser test is timing-sensitive in this container: across nine runs during M14/M15 it failed on early steps that do not involve the new work (the free-swing animation and a combat target with a wandering monster nearby, auto hunting under low frame rates). The client's idle frame rate was measured against the deployed M13 build and is the same (both 35–60 fps), so the new code did not slow it. Two locator bugs in the test itself were fixed (duplicate loot names; a role name that matched the PvP badge). The final run passed end to end.
- Everything listed under "Keterbatasan yang diketahui" in `docs/M9.md` that is not listed as fixed above still applies.

## Database migrations

| File | Milestone | Content |
|---|---|---|
| 001_init.sql | M1 | accounts, sessions, characters |
| 002_appearance_v2.sql | M2 | appearance |
| 003_build.sql | M4 | skills and runes |
| 004_inventory.sql | M6 | gold, inventory, equipment |
| 005_discoveries.sql | M8 | waystones and caches |
| 006_settings.sql | M10 | `account_settings` (audio) |
| 007_autohunt_trade.sql | M11 | `characters.auto_hunt`; `trade_log` audit table |
| 009_gear.sql | after M16 | `characters.gear` (armament levels, equipped sigils) |
| **008_quests_guilds_economy_pvp.sql** | **M13–M15** | **`characters.quests`, `reputation`, `bank`, `companions`; tables `factions` (seeded), `guilds`, `guild_members`, `guild_log`, `auction_listings`, `auction_claims`, `bank_log`, `pvp_stats`** |

Migrations run automatically when the server starts. 006 and 007 only add a table and a column.

## Test results

2026-11-17, in the dev container (`deploy/Dockerfile.dev`) on Docker Desktop for Windows:

| Suite | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` (unit + integration with real PostgreSQL and Redis) | 185 / 185 passed |
| `npm run test:browser` (headless Chromium, two players) | passed, including quests, guild, bank, auction house, pets, mounts, a duel, the arena, the world map, key binding, the Indonesian interface, the tutorial, sub-skills, PvP areas, the auto hunting key and bar, guild chat and combat text; frame-rate reading 45 (this container's readings vary between 25 and 60) |
| `npx tsx scripts/spawn-audit.ts 20` | 0 of 3,380 monsters in a bad position (146 before the fix) |
| `npm run audio:check` | 89 of 89 audio assets valid |
| `npx tsx scripts/validate-assets.ts assets/templates` | 201 assets (112 icons), 0 errors |

With 1.6 times as many monsters (about 1,360 in the six regions over five rooms each, 49 per Eldoria room), the server's tick and the client's drawing do more work; the tick measurement in the unit tests still passes, but the load tests below have not been repeated. Not run in this pass: the load tests, the soak test and `scripts/verify-deploy.sh`. Monster pathfinding adds work to the simulation tick; it is bounded and was measured in a unit test (0.86 ms per tick with 30 players and every Eldoria monster hunting), but the 150 to 300 client load tests of docs/M9.md have **not** been repeated with it.

## Asset requirements

| Asset | Have | Need |
|---|---|---|
| Music, 16 tracks | Temporary synthesised stand-ins | Suno-generated originals (docs/M10.md section 10) |
| Sound effects (68), ambience (5) | Temporary synthesised stand-ins | Optional replacement, same ids and paths |
| Skill, status, attack and rune icons (112) | Original, drawn by code; exported to `assets/templates/icons` | Optional replacement: drop a 64×64 PNG in `assets/game/icons/<kind>/` and add one manifest entry |
| Character, monster, NPC, tile and effect art | Generated by code | Artist or generated art through the pipeline; renderer support for NPC sheets, tilesets and effects |

## Next development tasks

1. **Play it**: listen to the audio, watch the effects, look at the icons, try auto hunting and a trade with a second account. Report what is wrong.
2. **Connect a Suno MCP server** and generate the real soundtrack.
3. **M17**: account security, moderation and the admin panel.
4. Translate game content into Indonesian, and have a native speaker read the interface text.
