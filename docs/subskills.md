# Aetherion Online — Sub-skills (skill enhancement branches)

Version **0.16.1-alpha**. Requested after M16: two sub-skill branches for every active skill of every job, levelled with skill points, each enhancing its skill.

## What the player gets

- Under every active skill in the skill book (K), two branches, each with up to **3 ranks**. That is 74 branches: knight 6 skills, mage 5, ranger 7, assassin 6, cleric 7, berserker 6, times two.
- A branch can be learned once its skill is learned. Each rank costs **one skill point**, from the same pool as skills (one point per character level). "Reset skills" refunds branches too.
- Each branch shows what it does now and at its next rank. The skill line, hotbar tooltip, cooldown sweep and the effect drawn on screen show the enhanced numbers.

## The kinds of enhancement (per rank)

| Kind | Per rank | Changes |
|---|---|---|
| Damage | +8% | the skill's hit and its ground effect |
| Cooldown | −8% | time between uses |
| Cost | −12% | mana or rage spent |
| Area | +12% | area, splash, cone reach, trap or zone radius, effect radius (taunt, cry, smoke) |
| Duration | +15% | buffs and debuffs the skill applies, and how long its ground effect lasts |
| Critical | +6 points | critical chance of the skill |
| Healing | +10% | healing and barriers |
| Range | +12% | reach, and the distance of Blink and Fleet Step |
| Cast time | −15% | casting time |
| Targets | +1 | targets of Cleave |
| Status | +15% chance | a new effect on enemies hit: slow (Power Shot), poison (Twin Fangs), weaken (Smite), bleed (Whirlwind) |

Each skill's two branches are of different kinds, chosen to fit it. Damage skills, for example, get damage plus crit, cost or a new status; buffs get duration and cooldown; area skills get area. The full table is in `shared/src/subskills.ts`. A unit test checks that every branch changes something its skill actually has.

## How it works

- `shared/src/subskills.ts` defines the branches. `enhance(skill, build)` returns the skill as that build casts it: a copy, so the shared definitions never change.
- The server resolves every cast with the enhanced copy: cost, cooldown, cast time, damage, area, statuses, healing, fields and movement. Status durations use a new per-application multiplier (`durMul`).
- Ranks are stored in the character's build next to skill ranks. This needs no database change: they persist, and respec and point accounting work as before.
- Stored builds are checked when loaded. Branches of another job, of an unlearned skill, or above rank 3 are dropped or clamped, and the build is reset if it spends more points than the level allows.
- The client uses the same `enhance` for its own skills: cost and range checks, cooldown display, tooltips, effect size. Other players' effects are drawn at base size.
- Interface text is in English and Indonesian. Branch names are content, like skill names, and are in English.

## Tests

| Suite | Result |
|---|---|
| Type check | 0 errors |
| Unit + integration | **174 / 174** (170 before) |
| Browser end-to-end | **passed**, with a new sub-skill section |

New unit tests:
- **The table:** two branches of different kinds for every active skill of every job, none for passives or rune spells, every branch with its own name and with an effect on its skill.
- **The arithmetic** of every kind of enhancement, rank by rank, with the shared definitions left unchanged.
- **Learning:** the skill must be learned first, at most 3 ranks, one point each, no points left means no learning, another job's branch is refused, stored builds are cleaned, and a reset refunds.
- **Real casts on the server:**
  - more damage and a lower cost (Arcane Bolt);
  - a shorter cooldown and a longer buff (Guard Stance);
  - a monster just outside a plain Whirlwind is hit by the wider one;
  - Whirlwind with its bleed branch makes its target bleed.

Browser: the branches of Arcane Bolt in the skill book; learning one with a skill point (stored on the server); the effect text moving to the next rank; the hotbar showing the cheaper cost.

## Not judged by a person

Balance. The values per rank are first estimates, and nobody has played with the branches yet.
