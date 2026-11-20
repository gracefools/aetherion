# Visual Performance Standards

## Measure first
Establish a baseline on representative maps and combat scenarios before optimization. Record frame time, FPS, memory, asset loading time, draw calls/batches where available, particle counts, and worst-case scene behavior.

## Potential optimization areas
- Texture atlases and batching.
- Appropriate culling and visibility management.
- Particle pooling and lifetime limits.
- Asset loading and caching.
- Avoiding redundant per-frame allocations.
- Shader and overdraw cost.
- Animation update frequency where safe.
- UI redraw behavior.

## Targets
Use the project's existing platform requirements and measured baseline to set realistic targets. A stable 60 FPS may be desirable but must not be asserted as achieved without measurement.

## Acceptance
Compare before/after measurements on the same device, scene, and test conditions. Ensure optimization does not introduce visual defects or change gameplay.
