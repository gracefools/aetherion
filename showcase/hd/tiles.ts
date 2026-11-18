// Preview of the HD tile renderer on a real zone map, at 2x.
import { buildChunk, CHUNK, CHUNK_PX } from '../../client/src/game/hdart';
import { getZoneMap } from '../../shared/src/world';
import { TILE } from '../../shared/src/protocol';

export function render(zone = 'eldoria', ox = 0, oy = 0) {
  const map = getZoneMap(zone), W = 640, H = 360;
  const cx = map.def.spawn.tx * TILE + ox - W / 2, cy = map.def.spawn.ty * TILE + oy - H / 2;
  const view = document.getElementById('view') as HTMLCanvasElement, g = view.getContext('2d')!;
  view.width = W; view.height = H;
  const t0 = performance.now(), overs: [HTMLCanvasElement, number, number][] = [];
  for (let y = Math.floor(cy / CHUNK_PX); y <= Math.floor((cy + H) / CHUNK_PX); y++)
    for (let x = Math.floor(cx / CHUNK_PX); x <= Math.floor((cx + W) / CHUNK_PX); x++) {
      if (x < 0 || y < 0 || x * CHUNK >= map.w || y * CHUNK >= map.h) continue;
      const c = buildChunk(map, x, y);
      g.drawImage(c.ground, x * CHUNK_PX - cx, y * CHUNK_PX - cy);
      if (c.over) overs.push([c.over, x * CHUNK_PX - cx, y * CHUNK_PX - cy]);
    }
  for (const [o, x, y] of overs) g.drawImage(o, x, y);
  (window as any).__ms = performance.now() - t0;
  (window as any).__done = true;
}
(window as any).__render = render;
