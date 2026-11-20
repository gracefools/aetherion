# Combat Visual Effects Standards

## Scope
Weapon trails, projectiles, elemental magic, impacts, explosions, critical hits, healing, buffs/debuffs, status indicators, damage numbers, and boss telegraphs.

## Design principles
- Each skill should have a distinct but consistent visual identity.
- Effects communicate element, direction, timing, area, and impact.
- Telegraphs must be visible before damage occurs.
- Effects should not obscure player/enemy silhouettes or critical UI.
- Use restrained flashes, particles, glow, and screen shake.
- Maintain consistent timing with the game's authoritative combat events.

## Technical safeguards
Do not change damage, cooldowns, hitboxes, targeting, server authority, or combat timing as part of a VFX-only task. Check pooling, particle lifetime, draw calls, overdraw, and cleanup behavior.

## Acceptance checks
Test at normal gameplay zoom, in crowded combat, with multiple simultaneous effects, and on the project's lower-supported hardware tier.
