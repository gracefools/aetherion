// U3: the virtual joystick's deflection as movement keys (kept apart from the React code for tests).
import type { Action } from '../../shared/src/settings';

/** Joystick deflection (-1..1 on each axis) to the movement actions held: eight directions, with a dead zone. */
export function stickKeys(x: number, y: number): Action[] {
  const out: Action[] = [];
  if (Math.hypot(x, y) < 0.3) return out;
  const a = Math.atan2(y, x), sx = Math.cos(a), sy = Math.sin(a);
  if (sy < -0.38) out.push('move.up');
  if (sy > 0.38) out.push('move.down');
  if (sx < -0.38) out.push('move.left');
  if (sx > 0.38) out.push('move.right');
  return out;
}
