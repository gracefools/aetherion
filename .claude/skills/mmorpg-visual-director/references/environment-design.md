# Environment and Tileset Design

## Scope
Review towns, wilderness, dungeons, caves, castles, interiors, boss arenas, and transitional areas that exist in the project.

## Environment layers
Identify the project's actual layer model. Common layers include ground, ground detail, collision/obstacles, props, foreground occlusion, background scenery, lighting, and ambient effects.

## Quality standards
- Tile edges connect cleanly without visible seams.
- Terrain transitions are intentional.
- Walkable and non-walkable areas remain readable.
- Props use consistent perspective, scale, palette, and light direction.
- Environmental details support navigation rather than obscure it.
- Repeated tiles avoid obvious pattern artifacts where practical.
- Distinct biomes have coherent palettes and landmark assets.

## Atmosphere
Use lighting, particles, weather, animated objects, and depth selectively. Preserve gameplay visibility and ensure ambient effects do not obscure telegraphs, characters, or interactable objects.

## Technical checks
Verify tile dimensions, atlas padding, collision metadata, map references, sorting, occlusion, and asset import settings before changing tilesets.
