# Prompt: Install and Configure the MMORPG Visual Director

Use this prompt in Claude Code from the root of the existing MMORPG repository.

---

Create and configure a reusable MMORPG Visual Enhancement Skill system using the files in this package as the starting standard.

First inspect the actual repository, its instructions, engine, rendering architecture, asset pipeline, source assets, and tests. Do not assume technologies or dimensions.

1. Integrate `.claude/skills/mmorpg-visual-director/` into the project.
2. Preserve existing `CLAUDE.md` instructions. Merge only the concise skill-discovery guidance; never overwrite unrelated instructions.
3. Review every reference document and tailor it to verified project facts.
4. Fill `references/rendering-architecture.md` with actual findings. Mark unknowns explicitly.
5. Update `docs/visual-enhancement-roadmap.md` with project-specific modules, dependencies, and acceptance criteria.
6. Verify skill frontmatter, paths, and references.
7. Do not modify production game code or assets during this setup task.
8. Report files created/updated, project facts discovered, unknowns, and how to invoke the skill.

After setup, wait for approval before implementing visual changes.

## Reference image instruction

Attach the desired pixel-art screenshot and say:

“Use this image as the visual quality and art-direction reference. Analyze pixel density, palette, outlines, shading, lighting, environment detail, sprite readability, VFX, and UI finish. Preserve my game's own characters, maps, layout, mechanics, and identity. Translate the reference into concrete asset and rendering requirements; do not merely apply filters or create a mockup. Do not modify production assets until I approve the implementation plan.”
