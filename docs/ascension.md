# Aetherion Online — Ascension: paths, ultimates, combos, mastery and loadouts (level 70+)

Version **0.21.0-alpha** (batch D). Open it with **F6** or **Ascend** in the menu. The button shows **!** at level 70 until a path is chosen, then the number of unspent mastery points.

## Paths

At level 70 every class chooses one of two paths. A path gives:
- **a title**, worn instead of the class title;
- **a lasting bonus** that applies again at each milestone (70, 100, 130, 160 and 190);
- **an ultimate**.

Changing path later costs 20,000 gold × (level ÷ 10), in a village.

| Class | Path | Bonus per milestone | Ultimate |
|---|---|---|---|
| Knight | Paladin | +4% HP, +5% healing, +4% resist | Divine Judgment: holy area damage, heals and rallies allies, stuns |
| Knight | Warlord | +4% attack, +4% defence, +1 crit | War Banner: allies blessed and rallied, a 10-second zone that weakens enemies |
| Mage | Archmage | +5% magic, −3% rune cost | Astral Storm: stars fall on an area for 6 s |
| Mage | Chronomancer | +3% magic, +5% mana, −3% attack time, +1 dodge | Time Stop: enemies around held and stunned, arcane burst, surge |
| Ranger | Beastmaster | +3% attack, +4% HP, +1% speed | Stampede: a cone of spirit beasts, stun and bleed |
| Ranger | Sniper | +4% attack, +1.5 crit, +4% crit damage, +6 range | Deadeye: one huge shot, extra damage below half health |
| Assassin | Phantom | +4% attack, +1.5 dodge, +1 crit | Shadow Legion: five strikes on every enemy around, stealth |
| Assassin | Venomlord | +5% attack, +4% crit damage | Plague Burst: area damage, three poison stacks, weaken |
| Cleric | Oracle | +6% healing, +4% mana, +3% resist | Prophecy: a great heal, divine aegis and blessing on allies |
| Cleric | Inquisitor | +5% magic, +2% HP, +1 lifesteal | Holy Fire: a 5-second pillar that burns enemies and heals allies |
| Berserker | Warbringer | +4% attack, −2% attack time, +1 lifesteal | Warpath: two whirling area blows, frenzy and haste |
| Berserker | Bloodlord | +6% HP, +2% attack, +1.5 lifesteal | Blood Moon: cannot fall for a moment, frenzy, area bleed |

## Ultimates

- **Charging:** fighting fills a gauge from 0 to 100. Each hit dealt gives 1.5, each hit taken 2, each kill 3.
- **Using it:** when the gauge is full, the ultimate's slot on the hotbar glows; press **8** (bindable as "Ultimate").
- **Strength:** +20% for every milestone after the first.
- **Resonance:** two party members using ultimates within 4 seconds of each other, close together, both receive Blessing, announced as "Resonance!".

## Combo chains (from level 70)

Three skills used in order, each within 2 seconds of the last, unleash a finisher: area damage around you (+10% per milestone after the first) and an announcement. While a chain is running, the next skill glows on the hotbar.

| Class | Combo | Order |
|---|---|---|
| Knight | Shockwave Rally | Shield Bash → Cleave → Rallying Cry |
| Mage | Arcane Cascade | Arcane Bolt → Elemental Surge → Arcane Bolt |
| Ranger | Hunter's Volley | Poison Arrow → Power Shot → Power Shot |
| Assassin | Death Lotus | Shadow Step → Backstab → Twin Fangs |
| Cleric | Judgment Hymn | Smite → Mend → Smite |
| Berserker | Carnage | Rend → Whirlwind → Executioner |

## Mastery

**Earning points:** one point for every level from 71. At level 200, experience keeps counting: every tenth of a level-199 bar gives another point.

**What a point gives:**

| Stat | Per point |
|---|---|
| Attack, magic, health, defence, resist, healing | +0.5% |
| Critical rate | +0.2 |
| Critical damage | +1% |

**Limit:** each stat holds up to 10 points per milestone reached (10 at 70, 50 at 190).

**Reset:** in a village, for 5,000 gold per point spent.

## Loadouts

Three slots save your skill ranks (including sub-skills) and rune slots. Loading one needs a village and no recent combat. The server checks the saved build against your level.

## Where to see it

| Place | What shows |
|---|---|
| Character sheet | The path title. |
| "Stats by source" | "Path and mastery" as its own source. |

## Technical

| | |
|---|---|
| New | `shared/src/ascension.ts`, `client/src/ascensionUi.tsx`, migration `012_ascension.sql` (`characters.ascension`) |
| Changed | Abilities (kind `ult`, the gauge, combos), World (stats, the `asc` command, mastery from experience past the cap), the hotbar (ultimate slot, combo glow), the dock, stats by source, settings (Ultimate key, F6), icons and sounds for the 12 ultimates |

## Tests

| Suite | Result |
|---|---|
| Unit + integration | **202 / 202** |
| Browser end-to-end | A path chosen at 70; the ultimate charged and unleashed from the hotbar with its key |

New unit tests:
- the paths, ultimates and combos are all defined;
- the path bonus;
- the ultimate refused until charged, and only your own;
- resonance;
- the combo finisher firing and hitting;
- mastery points and their limit;
- loadouts saved and loaded.

## Not judged by a person

These numbers have not been played yet:
- the path bonuses;
- ultimate strength and the gauge rates;
- the combo finishers;
- mastery values;
- the cost of a path change.

---

# Batch E: skill awakening (level 80) and rune fusion (level 90)

Version **0.22.0-alpha**.

## Awakening

- **What it is:** from level 80, any active skill at its full rank can be **awakened** once, in the Ascension panel. Awakening changes how the skill works, not only how strong it is. The skill's name gains a ✦ and its effect turns gold.
- **Cost:** 3 **Awakening Essence** plus 50,000 gold + 500 × level, paid in a village.
- **Essence drops from:**
  - Armageddon dungeon bosses: 30% per player;
  - Rift guardians from floor 30.

What awakening does depends on the shape of the skill:

| Skill shape | Awakened |
|---|---|
| Single-target hit | +30% damage, and the hit ripples to enemies within 60 px (60%) |
| Area hit | Area 35% wider, and an aftershock zone for 2.5 s |
| Cone | Twice the targets, +15% damage, and bleeding |
| Field (trap or zone) | Radius +25%, lasts 50% longer |
| Movement (charge, blink, steps) | Leaves an exploding afterimage where it started |
| Heal or barrier | Reaches every ally within 200 px |
| Self buff | Shared with allies within 200 px |
| Anything else | 30% shorter cooldown |

## Rune fusion

From level 90, any two attuned runes that are both level 5 or higher make a **fusion spell**. The fusions appear on their own hotbar row; keys **9**, **0** and **-**, bindable. They cost 45 mana (less with rune cost reductions) and have an 18-second cooldown. Their strength follows the lower of the two rune levels.

| Runes | Fusion | Effect |
|---|---|---|
| Fire + Water | Steam Burst | Area damage, weakens |
| Fire + Lightning | Plasma Lance | One enormous hit, burn |
| Fire + Earth | Magma Pool | A 5 s zone that burns and slows |
| Fire + Wind | Firestorm | Fire all around you |
| Water + Lightning | Storm Surge | Chains through 6 enemies, may stun |
| Water + Earth | Mudslide | A cone that roots up to 8 enemies |
| Water + Wind | Blizzard | A 6 s zone that slows |
| Lightning + Earth | Magnetic Crush | Area damage, root and stun |
| Lightning + Wind | Tempest | Chains through 5 enemies, slows |
| Earth + Wind | Sandstorm | A 5 s zone around you that weakens |

## Tests

New unit tests:
- **Awakening:** each shape changes the right thing; the full-rank, essence and gold rules; the server casts the awakened form (the ripple reaches a second monster).
- **Fusion:** the pairs; the level 90, attunement and rune-level rules; a fusion that hits.

Updated: icons and sounds for all 22 new abilities (12 ultimates and 10 fusions), and the regenerated asset templates.
