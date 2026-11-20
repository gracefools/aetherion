# Animation Standards

## Core principles
Prioritize readable poses, consistent timing, clear anticipation and impact, stable pivots, and smooth transitions that retain a pixel-art look.

## Audit before editing
Determine whether animation is frame-based, skeletal, shader-driven, or mixed. Inspect frame dimensions, frame order, frame duration, playback rules, blend/transition behavior, and facing-direction conventions.

## Common animation states
Idle, walk, run, attack, cast, hit reaction, skill, death, emote, mount, and boss-specific states where supported.

## Frame guidance
Do not impose a universal frame count. Use enough frames to communicate the action clearly while respecting the established art style, asset budget, and runtime. Rendering at 60 FPS does not mean every animation needs 60 unique frames per second.

## Acceptance checks
- No frame flicker or unintended jitter.
- Stable pivot and ground contact.
- Consistent proportions and equipment across frames.
- Correct facing direction and layering.
- Timing communicates weight and impact.
- Transitions do not cause visual pops.
- Animation events remain synchronized with existing gameplay events.
