# Character, Monster, and Boss Design

## Design goals
Every player class, NPC, monster, and boss should have a readable silhouette, recognizable identity, and consistent pixel-art treatment.

## Review
- Silhouette at normal gameplay zoom and reduced minimap/icon scale.
- Proportions, pose, facing direction, and pivot/origin.
- Palette separation between skin, hair, clothing, armor, weapon, and accessories.
- Material shading and highlight placement.
- Team, faction, rarity, or boss cues where used by the game.
- Compatibility with existing equipment, skins, and class systems.

## Animation states
Audit the states actually supported by the game. Common candidates include idle, walk, run, attack, cast, hit, skill, death, emote, and mounted movement.

## Boss readability
Bosses should communicate scale, threat, phase, and attack intent through silhouette, pose, telegraphs, and controlled effects. Preserve hitboxes and combat behavior unless gameplay changes are explicitly requested.

## Asset acceptance
Check consistent frame dimensions where required, alignment, pivot, transparent padding, palette, edge quality, facing consistency, and in-engine appearance.
