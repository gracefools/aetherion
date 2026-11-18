// Sprites for world objects that are not characters: resource nodes, hidden caches, waystones.
// 32x32, anchored at the bottom centre, drawn with the same rules as the rest of the art.
import { mk } from './art';
import { disc, outlined, p1 } from './chars';

type G = CanvasRenderingContext2D;
const cache = new Map<string, HTMLCanvasElement>();
function finish(c: HTMLCanvasElement) {
  const g = c.getContext('2d', { willReadFrequently: true })!, d = g.getImageData(0, 0, 32, 32);
  g.putImageData(new ImageData(outlined(d.data, 32, 32), 32, 32), 0, 0);
  return c;
}
const DRAW: Record<string, (g: G) => void> = {
  iron_ore: (g) => {
    for (const [x, y, r] of [[15, 22, 8], [9, 25, 5], [22, 25, 5], [15, 16, 5]]) disc(g, '#5c5f6a', x, y + 1, r);
    for (const [x, y, r] of [[15, 22, 8], [9, 25, 5], [22, 25, 5], [15, 16, 5]]) disc(g, '#8a8e9c', x - 1, y - 1, r - 2);
    for (const [x, y] of [[11, 19], [18, 16], [20, 24], [13, 26], [8, 24]]) { p1(g, '#d9a66a', x, y, 3, 2); p1(g, '#ffe0a8', x, y, 1, 1); p1(g, '#8a5a2c', x + 1, y + 2, 2, 1); }
  },
  moonleaf: (g) => {
    for (const [dx, h] of [[-6, 9], [-2, 13], [3, 11], [7, 8]]) {
      for (let i = 0; i < h; i++) p1(g, '#3f7a52', 15 + dx + Math.round(Math.sin(i / 3) * 1.5), 28 - i, 1, 1);
      const tx = 15 + dx + Math.round(Math.sin(h / 3) * 1.5), ty = 28 - h;
      disc(g, '#6fb88a', tx, ty, 3); disc(g, '#c8f0d8', tx - 1, ty - 1, 1); p1(g, '#e8fff0', tx - 1, ty - 2, 1, 1);
      p1(g, '#4f9a68', tx + 2, ty + 3, 3, 1); p1(g, '#4f9a68', tx - 4, ty + 5, 3, 1);
    }
  },
  star_shard: (g) => {
    const shard = (cx: number, base: number, h: number, w: number) => {
      for (let y = 0; y < h; y++) {
        const half = Math.round(w * Math.min(1, y / (h * 0.3)));
        p1(g, '#4a3a9a', cx - half, base - h + y, half * 2 + 1, 1); p1(g, '#b9a2ff', cx - half, base - h + y, Math.max(1, half), 1);
      }
      p1(g, '#ffffff', cx, base - h, 1, 2);
    };
    shard(10, 29, 11, 2); shard(22, 29, 9, 2); shard(16, 30, 19, 3);
    for (const [x, y] of [[6, 12], [25, 9], [20, 5]]) p1(g, '#e8dcff', x, y, 1, 1);
  },
  cache: (g) => {
    p1(g, '#5a3c1e', 6, 16, 20, 13); p1(g, '#8a5a33', 7, 17, 18, 11); p1(g, '#a26c3e', 7, 17, 18, 2);
    p1(g, '#5a3c1e', 6, 11, 20, 6); p1(g, '#9a6a3c', 7, 12, 18, 4); p1(g, '#b98a50', 7, 12, 18, 1);
    for (const x of [9, 22]) p1(g, '#c9a24a', x, 11, 2, 18);
    p1(g, '#c9a24a', 6, 16, 20, 1); p1(g, '#ffe08a', 15, 15, 3, 4); p1(g, '#8f6f1c', 16, 17, 1, 2);
  },
  cache_open: (g) => {
    p1(g, '#5a3c1e', 6, 18, 20, 11); p1(g, '#8a5a33', 7, 19, 18, 9); p1(g, '#2a1c10', 8, 19, 16, 4);
    p1(g, '#5a3c1e', 6, 7, 20, 8); p1(g, '#9a6a3c', 7, 8, 18, 6); p1(g, '#6a4420', 7, 13, 18, 1);
    for (const x of [9, 22]) { p1(g, '#c9a24a', x, 7, 2, 8); p1(g, '#c9a24a', x, 18, 2, 11); }
  },
  waystone: (g) => {
    p1(g, '#4c4868', 9, 26, 15, 4); p1(g, '#7d7896', 10, 26, 13, 2);
    for (let y = 4; y < 26; y++) { const w = y < 8 ? y - 3 : 5; p1(g, '#5f5a7c', 16 - w, y, w * 2, 1); p1(g, '#8a86a6', 16 - w, y, 2, 1); p1(g, '#3a3654', 16 + w - 2, y, 2, 1); }
    for (const y of [10, 15, 20]) { p1(g, '#b9a2ff', 14, y, 4, 2); p1(g, '#ffffff', 15, y, 1, 1); }
  },
};
export const PROP_KINDS = Object.keys(DRAW);
export function setPropSprite(kind: string, sprite: HTMLCanvasElement) {
  cache.set(kind, sprite);
}
export function propSprite(kind: string): HTMLCanvasElement {
  let c = cache.get(kind);
  if (!c) {
    c = mk(32, 32);
    (DRAW[kind] ?? DRAW.iron_ore)(c.getContext('2d')!);
    cache.set(kind, finish(c));
  }
  return c;
}
