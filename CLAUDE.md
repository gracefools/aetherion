# Project Instructions

## Existing MMORPG project
This repository contains an existing MMORPG. Preserve its current gameplay, architecture, networking, data contracts, and established visual identity unless the user explicitly approves a change.

## Visual enhancement work
For tasks involving pixel art, characters, monsters, environments, tilesets, animation, combat visual effects, rendering, or MMORPG UI presentation, use the `mmorpg-visual-director` skill.

Skill location:
`.claude/skills/mmorpg-visual-director/SKILL.md`

Supporting standards:
`.claude/skills/mmorpg-visual-director/references/`

Project-specific visual roadmap:
`docs/visual-enhancement-roadmap.md`

## Working rules
- Inspect the actual codebase and assets before recommending or changing implementation.
- Treat reference images as art-direction references, not permission to copy unrelated game identity or assets.
- Separate verified existing capabilities from recommendations and assumptions.
- Prefer incremental, reviewable changes.
- Do not change gameplay balance, combat calculations, network protocols, database schemas, or public APIs as part of a visual-only task.
- Do not claim a change is complete until it has been implemented and verified.
- Follow the repository's existing test, lint, build, and asset-pipeline conventions.
