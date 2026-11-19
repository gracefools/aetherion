// What makes the world feel alive between the fights: the wind in the trees, glints wandering over
// water, and motes in the air that belong to each place and hour (pollen and drifting leaves by day,
// fireflies at night, dust in the ashlands, embers in the lairs, spores on the moor, motes of light
// among the stars). All cheap: a few hundred particles at most, and nothing on the server.
import { TILE } from '../../../shared/src/protocol';
import { T, type Theme, type ZoneMap } from '../../../shared/src/world';

/** How hard the wind blows in each kind of place (0 = still air, as indoors and in vaults). */
export function windOf(theme: Theme): number {
  return theme === 'frost' || theme === 'moor' ? 1.4 : theme === 'kingdom' || theme === 'forest' ? 1 : theme === 'ashen' ? 0.8 : theme === 'astral' ? 0.5 : 0.25;
}

interface Mote { x: number; y: number; vx: number; vy: number; s: number; life: number; kind: number }
/** What floats in the air of each kind of place, by day and by night. */
const AIR: Record<Theme, { day: number[]; night: number[]; n: number }> = {
  kingdom: { day: [0, 1], night: [2], n: 34 },
  forest: { day: [1, 0, 1], night: [2, 2, 0], n: 48 },
  ashen: { day: [3, 4], night: [4, 3], n: 44 },
  frost: { day: [5], night: [5, 2], n: 30 },
  moor: { day: [6, 3], night: [6, 2], n: 42 },
  astral: { day: [7], night: [7, 2], n: 40 },
  ruins: { day: [3], night: [3], n: 18 },
  lair: { day: [4, 3], night: [4], n: 26 },
  citadel: { day: [3], night: [2], n: 16 },
  temple: { day: [7, 3], night: [7], n: 22 },
};
// 0 pollen, 1 leaf, 2 firefly, 3 dust, 4 ember, 5 ice glitter, 6 spore, 7 star mote

/** A soft round glow painted once per colour and size, then stamped (a gradient per particle per frame is far dearer). */
const glows = new Map<string, HTMLCanvasElement>();
export function glowSprite(rgb: string, r: number): HTMLCanvasElement {
  const key = rgb + '/' + r;
  let c = glows.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = r * 2;
    const g = c.getContext('2d')!, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, `rgba(${rgb},0.95)`); gr.addColorStop(0.3, `rgba(${rgb},0.45)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, r * 2, r * 2);
    glows.set(key, c);
  }
  return c;
}

class Ambient {
  /** Water tiles of the map last drawn, by row: found once, not searched for every frame. */
  private waterOf: ZoneMap | null = null;
  private waterRows: number[][] = [];
  private list: Mote[] = [];
  private theme: Theme | null = null;

  /** Glints on water tiles in view: a few at a time, each a short twinkle in its own place and moment. */
  water(g: CanvasRenderingContext2D, map: ZoneMap, camX: number, camY: number, vw: number, vh: number, now: number) {
    const x0 = Math.max(0, Math.floor(camX / TILE)), y0 = Math.max(0, Math.floor(camY / TILE));
    const x1 = Math.min(map.w - 1, Math.ceil((camX + vw) / TILE)), y1 = Math.min(map.h - 1, Math.ceil((camY + vh) / TILE));
    if (this.waterOf !== map) {
      this.waterOf = map;
      this.waterRows = Array.from({ length: map.h }, (_, ty) => { const row: number[] = []; for (let tx = 0; tx < map.w; tx++) if (map.tiles[tx + ty * map.w] === T.Water) row.push(tx); return row; });
    }
    g.save();
    for (let ty = y0; ty <= y1; ty++) for (const tx of this.waterRows[ty]) {
      if (tx < x0 || tx > x1) continue;
      // two glints per tile, each living on its own rhythm
      for (let k = 0; k < 2; k++) {
        const h = ((tx * 73856093) ^ (ty * 19349663) ^ (k * 83492791)) >>> 0;
        const period = 2200 + (h % 1800), ph = ((now + (h % 997) * 7) % period) / period;
        if (ph > 0.22) continue; // most of the time a spot is dark
        const a = Math.sin((ph / 0.22) * Math.PI), px = tx * TILE + 4 + ((h >>> 8) % (TILE - 8)), py = ty * TILE + 4 + ((h >>> 16) % (TILE - 8));
        g.globalAlpha = 0.75 * a;
        g.fillStyle = '#eaf8ff';
        g.fillRect(px - 2, py, 5, 1);
        g.fillRect(px, py - 1, 1, 3);
      }
      // slow ripples drifting across larger water
      const r = ((tx * 31 + ty * 17) % 7) / 7, ph2 = ((now / 3400 + r) % 1);
      if ((tx + ty * 3) % 5 === 0) {
        g.globalAlpha = 0.22 * Math.sin(ph2 * Math.PI);
        g.strokeStyle = '#dff4ff';
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 4 + ph2 * 12, 2 + ph2 * 5, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.restore();
  }

  /** The motes of the air, in screen space. `dark` 0 (day) .. 1 (night). */
  motes(g: CanvasRenderingContext2D, W: number, H: number, now: number, dt: number, theme: Theme, dark: number, density: number) {
    const air = AIR[theme];
    if (theme !== this.theme) { this.theme = theme; this.list = []; }
    const want = Math.round(air.n * Math.max(0.25, density) * (W * H) / (1280 * 720));
    const kinds = dark > 0.45 ? air.night : air.day;
    while (this.list.length < want) this.list.push(this.spawn(W, H, kinds[Math.floor(Math.random() * kinds.length)], true));
    if (this.list.length > want) this.list.length = want;
    g.save();
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      m.life -= dt;
      // drift, with a sway of its own
      m.x += (m.vx + Math.sin(now / 900 + m.s * 9) * (m.kind === 1 ? 18 : 6)) * dt;
      m.y += (m.vy + Math.cos(now / 1300 + m.s * 7) * 4) * dt;
      if (m.life <= 0 || m.x < -20 || m.x > W + 20 || m.y < -20 || m.y > H + 20) {
        this.list[i] = this.spawn(W, H, kinds[Math.floor(Math.random() * kinds.length)], false);
        continue;
      }
      const fade = Math.min(1, m.life / 1.2, (m.s * 3 + 1) * 0.5);
      switch (m.kind) {
        case 0: g.globalAlpha = 0.55 * fade; g.fillStyle = '#fff6c0'; g.fillRect(m.x, m.y, 2, 2); break;
        case 1: { // a leaf turning as it falls
          const turn = Math.sin(now / 280 + m.s * 20);
          g.globalAlpha = 0.85 * fade;
          g.fillStyle = m.s > 0.5 ? '#8fb84a' : '#d0a040';
          g.fillRect(m.x, m.y, 2 + Math.abs(turn) * 3, 2);
          break;
        }
        case 2: { // a firefly: a soft glow that breathes
          const glow = 0.5 + 0.5 * Math.sin(now / 340 + m.s * 30);
          g.globalAlpha = (0.25 + 0.75 * glow) * fade;
          const r = 5 + glow * 4;
          g.drawImage(glowSprite('210,255,110', 9), m.x - r, m.y - r, r * 2, r * 2);
          break;
        }
        case 3: g.globalAlpha = 0.35 * fade; g.fillStyle = '#d8c8a8'; g.fillRect(m.x, m.y, 1.5, 1.5); break;
        case 4: { // an ember rising and cooling
          const heat = Math.min(1, m.life / 4);
          g.globalAlpha = fade;
          g.fillStyle = heat > 0.5 ? '#ffd080' : '#ff6a30';
          g.fillRect(m.x, m.y, 2, 2);
          break;
        }
        case 5: g.globalAlpha = (0.4 + 0.6 * Math.abs(Math.sin(now / 200 + m.s * 40))) * fade; g.fillStyle = '#ffffff'; g.fillRect(m.x, m.y, 1.5, 1.5); break;
        case 6: g.globalAlpha = 0.5 * fade; g.fillStyle = m.s > 0.5 ? '#c8a8ff' : '#a8e0b0'; g.beginPath(); g.arc(m.x, m.y, 1.6, 0, Math.PI * 2); g.fill(); break;
        default: { // star mote: a tiny cross of light
          const tw = 0.5 + 0.5 * Math.sin(now / 260 + m.s * 50);
          g.globalAlpha = (0.3 + 0.7 * tw) * fade;
          g.fillStyle = '#e8e0ff';
          g.fillRect(m.x - 2, m.y, 5, 1); g.fillRect(m.x, m.y - 2, 1, 5);
        }
      }
    }
    g.restore();
  }

  // ---- sparks: short-lived particles in map coordinates (hits, projectile trails, hoof dust, pet glitter) ----
  private sparks: { x: number; y: number; vx: number; vy: number; t0: number; life: number; color: string; size: number; grav: number }[] = [];
  private lastPos = new Map<number, { x: number; y: number; at: number; moved: number }>();
  /** A burst of `n` sparks flying out from a point. */
  burst(x: number, y: number, color: string, n: number, speed = 70, now = performance.now(), grav = 160, size = 2) {
    if (this.sparks.length > 420) return; // never more than the frame can carry
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.65);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - speed * 0.25, t0: now, life: 260 + Math.random() * 260, color, size, grav });
    }
  }
  /** One soft puff that drifts and fades (dust, a trail's glow). */
  puff(x: number, y: number, color: string, now = performance.now(), size = 3, life = 380) {
    if (this.sparks.length > 420) return;
    this.sparks.push({ x, y, vx: (Math.random() - 0.5) * 14, vy: -8 - Math.random() * 10, t0: now, life, color, size, grav: 0 });
  }
  /** How fast something has been moving lately (map pixels a second), from where it was drawn last. */
  speedOf(id: number, x: number, y: number, now: number): number {
    const p = this.lastPos.get(id);
    if (!p) { this.lastPos.set(id, { x, y, at: now, moved: 0 }); return 0; }
    const dt = now - p.at;
    if (dt > 0) { p.moved = dt > 500 ? 0 : (Math.hypot(x - p.x, y - p.y) / dt) * 1000 * 0.5 + p.moved * 0.5; p.x = x; p.y = y; p.at = now; }
    if (this.lastPos.size > 600) this.lastPos.clear();
    return p.moved;
  }
  /** Draws and ages the sparks (map coordinates). */
  drawSparks(g: CanvasRenderingContext2D, now: number) {
    g.save();
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i], age = now - s.t0;
      if (age < 0) continue;
      if (age >= s.life) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
      const t = age / 1000, k = age / s.life;
      const x = s.x + s.vx * t, y = s.y + s.vy * t + 0.5 * s.grav * t * t;
      g.globalAlpha = (1 - k) * (s.grav ? 1 : 0.55);
      g.fillStyle = s.color;
      const sz = s.grav ? s.size * (1 - k * 0.5) : s.size * (1 + k * 1.6);
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    g.restore();
  }

  private spawn(W: number, H: number, kind: number, anywhere: boolean): Mote {
    const s = Math.random();
    const m: Mote = { x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, s, life: 6 + Math.random() * 10, kind };
    if (kind === 1) { m.vx = 14 + s * 16; m.vy = 18 + s * 14; if (!anywhere) { m.x = Math.random() * W * 0.8 - 40; m.y = -10; } }
    else if (kind === 4) { m.vx = (s - 0.5) * 10; m.vy = -(18 + s * 24); if (!anywhere) m.y = H + 10; }
    else if (kind === 3) { m.vx = 10 + s * 14; m.vy = (s - 0.5) * 4; }
    else if (kind === 5) { m.vx = 6 * (s - 0.5); m.vy = 8 + s * 6; }
    else { m.vx = (s - 0.5) * 12; m.vy = (s - 0.6) * 8; }
    return m;
  }
}
export const ambient = new Ambient();
