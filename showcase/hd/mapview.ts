// Whole-map preview: one pixel block per tile, to judge roads and terrain layout.
import { getZoneMap, T } from '../../shared/src/world';
export function render(zone = 'eldoria') {
  const m = getZoneMap(zone), c = document.getElementById('view') as HTMLCanvasElement, g = c.getContext('2d')!, S = Math.floor(Math.min(1280 / m.w, 720 / m.h));
  c.width = 1280; c.height = 720; g.fillStyle = '#111'; g.fillRect(0, 0, 1280, 720);
  const col: Record<number, string> = { [T.Grass]: '#7fb04a', [T.Path]: '#d2b077', [T.Water]: '#3f86c8', [T.Tree]: '#2f6a2e', [T.Wall]: '#e2d6bd', [T.Roof]: '#b84a3a', [T.Portal]: '#b070ff', [T.Flower]: '#f2a0c0', [T.Plaza]: '#c3b8a2', [T.Rock]: '#666', [T.Gate]: '#ff9040' };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { g.fillStyle = col[m.tiles[x + y * m.w]] ?? '#f0f'; g.fillRect(x * S, y * S, S, S); }
  (window as any).__ms = 0; (window as any).__done = true;
}
(window as any).__render = render;
