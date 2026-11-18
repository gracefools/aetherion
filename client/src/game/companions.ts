// Pet and mount sprites (M15), drawn in code like every other piece of the game's art.
// Pets: 16x16, two frames (a small hop). Mounts: 32x24, two frames (stride), drawn under the rider.
import { MOUNTS, PETS } from '../../../shared/src/companions';

const cache = new Map<string, HTMLCanvasElement>();
function sheet(key: string, w: number, h: number, frames: number, draw: (g: CanvasRenderingContext2D, f: number) => void): HTMLCanvasElement {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w * frames;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let f = 0; f < frames; f++) {
    g.save();
    g.translate(f * w, 0);
    draw(g, f);
    g.restore();
  }
  cache.set(key, c);
  return c;
}
const px = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

export const PET_W = 16;
export function petSprite(kind: string): HTMLCanvasElement | null {
  const d = PETS[kind];
  if (!d) return null;
  const [a, b, o] = d.colors;
  return sheet('pet:' + kind, PET_W, PET_W, 2, (g, f) => {
    const y = f ? -1 : 0; // the hop
    switch (d.shape) {
      case 'fox':
        px(g, o, 3, 7 + y, 9, 6); px(g, a, 4, 8 + y, 7, 4); px(g, b, 5, 10 + y, 4, 2);
        px(g, a, 11, 5 + y, 4, 4); px(g, o, 11, 4 + y, 1, 1); px(g, o, 14, 4 + y, 1, 1); px(g, o, 13, 6 + y, 1, 1);
        px(g, a, 0, 6 + y, 3, 2); px(g, b, 0, 5 + y, 1, 1); // tail
        px(g, o, 4, 12 + y, 1, 2); px(g, o, 9, 12 + y, 1, 2);
        break;
      case 'sprout':
        px(g, o, 4, 8 + y, 8, 7); px(g, a, 5, 9 + y, 6, 5); px(g, o, 6, 11 + y, 1, 1); px(g, o, 9, 11 + y, 1, 1);
        px(g, b, 7, 4 + y, 2, 4); px(g, a, 4, 3 + y, 4, 2); px(g, b, 9, 2 + y, 4, 2);
        break;
      case 'owl':
        px(g, o, 4, 4 + y, 8, 10); px(g, a, 5, 5 + y, 6, 8); px(g, b, 5, 9 + y, 6, 4);
        px(g, '#ffffff', 5, 6 + y, 2, 2); px(g, '#ffffff', 9, 6 + y, 2, 2); px(g, o, 6, 7 + y, 1, 1); px(g, o, 9, 7 + y, 1, 1);
        px(g, '#e8b04a', 7, 8 + y, 2, 1); px(g, o, 4, 3 + y, 1, 1); px(g, o, 11, 3 + y, 1, 1);
        px(g, b, 3, 8 + y, 1, 4); px(g, b, 12, 8 + y, 1, 4);
        break;
      case 'toad':
        px(g, o, 2, 8 + y, 12, 6); px(g, a, 3, 9 + y, 10, 4); px(g, b, 5, 11 + y, 6, 2);
        px(g, o, 3, 6 + y, 4, 3); px(g, o, 9, 6 + y, 4, 3); px(g, '#ffffff', 4, 7 + y, 2, 1); px(g, '#ffffff', 10, 7 + y, 2, 1);
        px(g, o, 2, 13, 3, 1); px(g, o, 11, 13, 3, 1);
        break;
      case 'mote':
        g.globalAlpha = 0.35; px(g, b, 2, 3 + y, 12, 10); g.globalAlpha = 1;
        px(g, o, 5, 5 + y, 6, 6); px(g, b, 6, 6 + y, 4, 4); px(g, a, 7, 7 + y, 2, 2);
        px(g, a, 7, 2 + y, 2, 2); px(g, a, 7, 12 + y, 2, 2); px(g, a, 2, 7 + y, 2, 2); px(g, a, 12, 7 + y, 2, 2);
        break;
      case 'pup':
        px(g, o, 3, 7 + y, 9, 6); px(g, a, 4, 8 + y, 7, 4); px(g, b, 4, 8 + y, 3, 1);
        px(g, o, 10, 4 + y, 5, 5); px(g, a, 11, 5 + y, 3, 3); px(g, o, 12, 6 + y, 1, 1); px(g, o, 10, 3 + y, 2, 2);
        px(g, a, 1, 6 + y, 2, 2); px(g, o, 4, 12 + y, 1, 2); px(g, o, 9, 12 + y, 1, 2);
        break;
    }
  });
}

export const MOUNT_W = 32, MOUNT_H = 24;
export function mountSprite(id: string): HTMLCanvasElement | null {
  const d = MOUNTS[id];
  if (!d) return null;
  const [a, b, o] = d.colors;
  return sheet('mount:' + id, MOUNT_W, MOUNT_H, 2, (g, f) => {
    const s = f ? 1 : -1; // legs swing
    if (d.shape === 'griffin') {
      // a winged beast seen from the side, wings beating, its shadow far below
      g.globalAlpha = 0.3; px(g, o, 8, 22, 18, 2); g.globalAlpha = 1;
      const up = f ? -3 : 0;
      px(g, o, 6, 9, 18, 7); px(g, a, 7, 10, 16, 5); px(g, b, 9, 13, 12, 2);
      px(g, o, 22, 5, 7, 7); px(g, a, 23, 6, 5, 5); px(g, '#e8b04a', 28, 8, 3, 2); px(g, o, 26, 7, 1, 1);
      px(g, b, 9, 3 + up, 12, 6 - up); px(g, a, 10, 2 + up, 10, 2); px(g, o, 9, 3 + up, 1, 6 - up);
      px(g, o, 3, 10, 3, 3); px(g, o, 9, 16, 2, 4); px(g, o, 18, 16, 2, 4);
      return;
    }
    if (d.shape === 'skiff') {
      // a hovering boat of void-stuff: no legs, a soft glow under it
      g.globalAlpha = 0.35; px(g, b, 4, 20, 24, 2); g.globalAlpha = 1;
      px(g, o, 3, 11 + (f ? 1 : 0), 26, 6); px(g, a, 4, 12 + (f ? 1 : 0), 24, 4); px(g, b, 4, 12 + (f ? 1 : 0), 24, 1);
      px(g, o, 1, 9 + (f ? 1 : 0), 3, 4); px(g, o, 28, 9 + (f ? 1 : 0), 3, 4);
      px(g, b, 8, 17 + (f ? 1 : 0), 2, 1); px(g, b, 16, 17 + (f ? 1 : 0), 2, 1); px(g, b, 23, 17 + (f ? 1 : 0), 2, 1);
      return;
    }
    // a four-legged beast seen from the side, head to the right
    px(g, o, 5, 9, 20, 8); px(g, a, 6, 10, 18, 6); px(g, b, 8, 14, 14, 2);
    px(g, o, 23, 4, 7, 8); px(g, a, 24, 5, 5, 6); px(g, o, 28, 7, 1, 1);
    for (const [lx, sw] of [[7, s], [11, -s], [19, s], [23, -s]] as const) px(g, o, lx + sw, 17, 2, 6);
    px(g, o, 3, 9, 2, 5); // tail
    if (d.shape === 'charger') { px(g, b, 22, 3, 2, 3); px(g, b, 25, 3, 2, 2); px(g, b, 14, 9, 4, 1); }
    if (d.shape === 'elk') { px(g, b, 24, 0, 1, 4); px(g, b, 22, 1, 3, 1); px(g, b, 28, 0, 1, 4); px(g, b, 28, 1, 3, 1); }
    if (d.shape === 'strider') { px(g, b, 23, 4, 1, 2); px(g, b, 10, 9, 10, 1); }
  });
}

/**
 * The glow of an enhanced weapon (armament +6 white, +12 blue, +18 ember): a soft halo at the
 * weapon hand, motes rising from it, and for ember a flicker of flame. Strength grows with the tier.
 */
export function drawWeaponGlow(g: CanvasRenderingContext2D, color: string, x: number, y: number, now: number, tier: number, seed: number) {
  const pulse = 0.75 + Math.sin(now / 220 + seed) * 0.25, r = 7 + tier * 2;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.35 * pulse + tier * 0.08;
  g.fillStyle = grad;
  g.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
  // motes drifting up from the blade
  for (let i = 0; i < 2 + tier * 2; i++) {
    const ph = ((now / (700 - tier * 80) + i * 0.37 + seed * 0.01) % 1), mx = x + Math.sin(i * 2.1 + now / 300) * (3 + tier), my = y + 6 - ph * (14 + tier * 4);
    g.globalAlpha = (1 - ph) * 0.9;
    g.fillStyle = i % 2 && tier === 3 ? '#ffd24a' : color;
    g.fillRect(Math.round(mx), Math.round(my), tier === 3 ? 2 : 1, tier === 3 ? 2 : 1);
  }
  g.restore();
}
