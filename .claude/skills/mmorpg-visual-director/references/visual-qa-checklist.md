# Visual QA Checklist

## Art consistency
- [ ] Pixel scale and density are consistent.
- [ ] Palette and material shading match the art direction.
- [ ] Silhouettes remain readable at gameplay zoom.
- [ ] No accidental blur, seams, flicker, or scaling artifacts.

## Characters and animation
- [ ] Character identity and equipment remain recognizable.
- [ ] Pivots, ground contact, and facing are correct.
- [ ] No frame jitter, clipping, or transition pops.
- [ ] Gameplay animation events remain synchronized.

## Environment
- [ ] Tiles connect without seams.
- [ ] Collision and walkability are unchanged.
- [ ] Props and occlusion render in the correct order.
- [ ] Navigation and interactables remain readable.

## Combat VFX
- [ ] Skill identity and telegraphs are clear.
- [ ] Effects do not obscure critical gameplay information.
- [ ] Effects clean up correctly and remain performant.
- [ ] Combat calculations and timing are unchanged.

## UI
- [ ] Existing interactions and shortcuts work.
- [ ] Text and icons remain readable.
- [ ] Layout works at supported resolutions.
- [ ] No overlap, clipping, or broken state indicators.

## Engineering
- [ ] Relevant tests/build/lint checks pass.
- [ ] Performance is measured where relevant.
- [ ] No unrelated gameplay, network, API, or database changes.
- [ ] Changed files and known limitations are documented.
