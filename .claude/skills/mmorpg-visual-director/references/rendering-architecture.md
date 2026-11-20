# Rendering Architecture Reference

## Purpose
Document the actual rendering architecture discovered in this repository. This file begins as an inspection template; fill it with verified project facts before major rendering changes.

## Record
- Engine/framework and version:
- Rendering API/backend:
- Camera and projection:
- World coordinate system:
- Internal resolution and scaling:
- Sprite/tileset formats:
- Asset import/build pipeline:
- Texture atlas strategy:
- Animation system:
- Layering and sorting:
- Lighting/shader system:
- Particle/VFX system:
- UI rendering system:
- Supported platforms:
- Relevant source paths:

## Change procedure
Trace the render path from asset loading through update, culling, sorting, batching, and draw submission. Identify the smallest safe extension point. Document compatibility and rollback considerations before replacing a core subsystem.
