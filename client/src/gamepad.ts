// Gamepad support (U8). A controller drives the same actions as the keyboard: each button press is
// sent as the first key bound to its action, so rebinding keys in the settings also moves what the
// controller does, and every panel shortcut works without extra code.
//
// Standard layout (Xbox names; PlayStation in brackets):
//   left stick / d-pad  move              A [Cross]    attack        B [Circle]   interact, or close the top window
//   X [Square]          skill 1           Y [Triangle] skill 2       LB [L1]      next target
//   RB [R1]             skill 3           LT [L2]      health potion RT [R2]      skill 4
//   View [Share]        world map         Menu [Options] inventory   L3           dodge roll
//   R3                  auto-hunt on/off
import type { Action } from '../../shared/src/settings';
import { settings } from './settings';
import { openWindows } from './windows';

const BUTTONS: (Action | null)[] = [
  'attack', 'interact', 'skill.1', 'skill.2', 'target', 'skill.3', 'potion.hp', 'skill.4', 'panel.map', 'panel.bag', 'dodge', 'auto.toggle',
  'move.up', 'move.down', 'move.left', 'move.right',
];
const DEAD = 0.45;

function send(type: 'keydown' | 'keyup', action: Action | 'escape') {
  const code = action === 'escape' ? 'Escape' : settings.get().keys[action]?.[0];
  if (!code) return;
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
}

/** Starts reading connected controllers every frame. Returns a function that stops it. */
export function startGamepad(onConnect?: (name: string) => void): () => void {
  const held = new Map<string, Action | 'escape'>(); // button or stick direction -> what was pressed
  let raf = 0;
  const press = (id: string, on: boolean, action: Action | 'escape') => {
    const was = held.get(id);
    if (on && !was) {
      held.set(id, action);
      send('keydown', action);
    } else if (!on && was) {
      held.delete(id);
      send('keyup', was);
    }
  };
  const poll = () => {
    raf = requestAnimationFrame(poll);
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    // B closes the window on top while one is open (and does not talk to whoever stands nearby)
    pad.buttons.forEach((b, i) => {
      const a = BUTTONS[i];
      if (!a) return;
      const on = b.pressed || b.value > 0.5;
      const id = 'b' + i;
      if (i === 1 && on && !held.has(id) && openWindows().length) press(id, true, 'escape');
      else press(id, on, held.get(id) ?? a);
    });
    const [x = 0, y = 0] = pad.axes;
    press('sx-', x < -DEAD, 'move.left');
    press('sx+', x > DEAD, 'move.right');
    press('sy-', y < -DEAD, 'move.up');
    press('sy+', y > DEAD, 'move.down');
  };
  const connected = (e: GamepadEvent) => onConnect?.(e.gamepad.id);
  const lost = () => {
    for (const [id, a] of held) send('keyup', a), held.delete(id);
  };
  window.addEventListener('gamepadconnected', connected);
  window.addEventListener('gamepaddisconnected', lost);
  window.addEventListener('blur', lost);
  raf = requestAnimationFrame(poll);
  return () => {
    cancelAnimationFrame(raf);
    lost();
    window.removeEventListener('gamepadconnected', connected);
    window.removeEventListener('gamepaddisconnected', lost);
    window.removeEventListener('blur', lost);
  };
}
