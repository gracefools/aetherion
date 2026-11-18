// Monster sprites (original, generated in code with the same pixel-art rules as characters).
// Sheet layout: 13 columns (idle 2, move 4, attack 3, hit 1, death 3) x 2 rows (facing right, left).
// Frames are 48px squares scaled by the monster's `scale` (elites are drawn larger).
import { MONSTER_LOOK } from '../../../shared/src/expansion';
import { mk } from './art';
import { outlined, ramp, type Ramp } from './chars';
import { ramp as hdRamp } from './hdart';
import { styleAFinish } from './stylea';

// Drawing scale: 1 for the classic 48px frames, 4/3 for HD (64px frames, the density of the HD
// characters). Every primitive below scales its own coordinates, so each monster design draws at
// either size; in HD, balls are lit smoothly from the upper left with a dithered ramp.
let K = 1;
const sk = (v: number) => Math.round(v * K);
function p1(g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) {
  g.fillStyle = c;
  if (K === 1) return void g.fillRect(x, y, w, h);
  const x0 = sk(x), y0 = sk(y);
  g.fillRect(x0, y0, Math.max(1, sk(x + w) - x0), Math.max(1, sk(y + h) - y0));
}
function disc(g: CanvasRenderingContext2D, c: string, cx: number, cy: number, r: number) {
  g.fillStyle = c;
  const X = cx * K, Y = cy * K, R = r * K;
  for (let dy = -Math.ceil(R); dy <= R; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy)) + 0.35);
    g.fillRect(Math.round(X - w), Math.round(Y + dy), w * 2 + 1, 1);
  }
}
const hdBlobRamps = new Map<string, string[]>();
function hdTones(r: Ramp): string[] { // deep shadow, shadow, base, light, highlight
  const k = r.a + r.c;
  let t = hdBlobRamps.get(k);
  if (!t) { const h = hdRamp(r.a, 0.9).map((c) => `rgb(${c[0]},${c[1]},${c[2]})`); t = [r.d, r.b, r.a, r.c, h[4]]; hdBlobRamps.set(k, t); }
  return t;
}

type G = CanvasRenderingContext2D;
export const M_FRAME = 48;
export const M_COLS = 13;
export const M_ANIMS = {
  idle: { col: 0, frames: 2, ms: 420, loop: true },
  move: { col: 2, frames: 4, ms: 110, loop: true },
  attack: { col: 6, frames: 3, ms: 110, loop: false },
  hit: { col: 9, frames: 1, ms: 170, loop: false },
  death: { col: 10, frames: 3, ms: 150, loop: false },
} as const;
export type MAnim = keyof typeof M_ANIMS;
export const mAnimDuration = (a: MAnim) => M_ANIMS[a].frames * M_ANIMS[a].ms;
export function mAnimFrame(a: MAnim, t: number): number {
  const d = M_ANIMS[a], f = Math.floor(t / d.ms);
  return d.col + (d.loop ? f % d.frames : Math.min(d.frames - 1, f));
}

const CX = 24, BASE = 42;
const INK = '#231a2b';

/** Shaded ellipse lit from the top-left. */
function blob(g: G, r: Ramp, cx: number, cy: number, rx: number, ry: number) {
  if (K !== 1) { // HD: a smoothly lit ball, dithered between tones
    const t = hdTones(r), X = cx * K, Y = cy * K, RX = rx * K, RY = ry * K;
    for (let y = Math.floor(Y - RY); y <= Y + RY; y++) for (let x = Math.floor(X - RX); x <= X + RX; x++) {
      const nx = (x + 0.5 - X) / RX, ny = (y + 0.5 - Y) / RY, q = nx * nx + ny * ny;
      if (q > 1) continue;
      const l = -0.55 * nx - 0.62 * ny + 0.55 * Math.sqrt(1 - q), f = (l + 0.6) / 1.45 * 4, k = Math.floor(f);
      g.fillStyle = t[Math.max(0, Math.min(4, k + (f - k > (((x + y) & 1) ? 0.62 : 0.38) ? 1 : 0)))];
      g.fillRect(x, y, 1, 1);
    }
    return;
  }
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))) + 0.4);
    for (let dx = -w; dx <= w; dx++) {
      const lit = dx / rx + dy / ry;
      p1(g, lit > 0.95 ? r.d : lit > 0.45 ? r.b : lit < -0.8 ? r.c : r.a, cx + dx, cy + dy);
    }
  }
}
function tri(g: G, c: string, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  x1 *= K; y1 *= K; x2 *= K; y2 *= K; x3 *= K; y3 *= K;
  const k0 = K; K = 1; // the fill below draws in pixels already scaled
  try { triPx(g, c, x1, y1, x2, y2, x3, y3); } finally { K = k0; }
}
function triPx(g: G, c: string, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
  const edge = (ax: number, ay: number, bx: number, by: number, y: number) => (ay === by ? null : (y - ay) / (by - ay) >= 0 && (y - ay) / (by - ay) <= 1 ? ax + ((y - ay) / (by - ay)) * (bx - ax) : null);
  for (let y = minY; y <= maxY; y++) {
    const xs = [edge(x1, y1, x2, y2, y), edge(x2, y2, x3, y3, y), edge(x3, y3, x1, y1, y)].filter((v): v is number => v !== null);
    if (xs.length < 2) continue;
    const a = Math.round(Math.min(...xs)), b = Math.round(Math.max(...xs));
    p1(g, c, a, y, b - a + 1, 1);
  }
}
function line(g: G, c: string, x0: number, y0: number, x1: number, y1: number, thick = 1) {
  if (K !== 1) { // HD: draw in scaled pixels with a scaled thickness
    const k0 = K, t = Math.max(1, Math.round(thick * K));
    K = 1;
    try { line(g, c, x0 * k0, y0 * k0, x1 * k0, y1 * k0, t); } finally { K = k0; }
    return;
  }
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    p1(g, c, x0, y0, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

interface Frame {
  ph: number; // walk phase -1..1
  open: number; // 0/1: wings down, jaws open, arms raised...
}
type Draw = (g: G, f: Frame) => void;

function boarDraw(body: string, bristle: string, tusk: number): Draw {
  return (g, f) => {
    const b = ramp(body), br = ramp(bristle), dark = ramp('#3a2a22');
    const legs = [[14, f.ph], [18, -f.ph], [26, -f.ph], [30, f.ph]];
    for (const [x, ph] of legs) { p1(g, dark.a, x + Math.round(ph), 36, 3, 6 - Math.max(0, Math.round(ph))); p1(g, INK, x + Math.round(ph), 41 - Math.max(0, Math.round(ph)), 3, 1); }
    line(g, b.b, 10, 30, 8, 27); p1(g, b.b, 7, 26, 2, 2); // tail
    blob(g, b, 21, 32, 11, 7);
    blob(g, b, 33, 33, 6, 5);
    for (let x = 12; x <= 30; x += 3) tri(g, x % 2 ? br.a : br.b, x, 27, x + 3, 27, x + 1 - 1, 22 - (x % 6 === 0 ? 1 : 0)); // bristles
    p1(g, '#d99a8a', 38, 33, 3, 4); p1(g, '#a8685c', 40, 35, 1, 1); p1(g, '#a8685c', 38, 36, 3, 1); // snout
    tri(g, b.b, 31, 28, 34, 28, 31, 24); // ear
    p1(g, INK, 34, 31, 2, 2); p1(g, '#ff6a4a', 35, 31, 1, 1);
    for (let i = 0; i < tusk; i++) { p1(g, '#f4f0e2', 36 + i, 37 - i, 2, 1); }
    p1(g, '#f4f0e2', 36 + tusk, 37 - tusk - 1, 1, 2);
    if (f.open) p1(g, '#7a2a2a', 36, 38, 4, 1);
  };
}

const DRAW: Record<string, { draw: Draw; scale: number; h: number; hop?: number; flap?: boolean }> = {
  mossling: {
    scale: 1, h: 20, hop: 3,
    draw: (g, f) => {
      const m = ramp('#74b24e'), leaf = ramp('#4f9a44'), belly = ramp('#b9dc8a');
      p1(g, '#3d6b34', 18 - Math.round(f.ph), 40, 4, 2); p1(g, '#3d6b34', 26 + Math.round(f.ph), 40, 4, 2);
      blob(g, m, CX, 34, 9, 7);
      blob(g, belly, CX + 1, 37, 5, 3);
      for (const [x, y] of [[18, 31], [21, 29], [28, 30], [17, 35]]) p1(g, m.d, x, y, 2, 1); // moss tufts
      const sw = Math.round(f.ph);
      line(g, leaf.d, 23, 28, 21 + sw, 23); line(g, leaf.d, 25, 28, 28 + sw, 22);
      tri(g, leaf.a, 21 + sw, 23, 16 + sw, 20, 20 + sw, 19); tri(g, leaf.c, 28 + sw, 22, 33 + sw, 19, 29 + sw, 18);
      p1(g, INK, 26, 32, 2, 3); p1(g, INK, 30, 32, 2, 3); p1(g, '#ffffff', 26, 32); p1(g, '#ffffff', 30, 32);
      p1(g, f.open ? '#7a2a2a' : m.d, 28, 37, f.open ? 3 : 2, f.open ? 2 : 1);
    },
  },
  boar: { scale: 1, h: 22, draw: boarDraw('#8a5e3c', '#4f7a3a', 2) },
  old_tusk: { scale: 1.5, h: 24, draw: boarDraw('#6a6470', '#a8343a', 4) },
  duskwing: {
    scale: 1, h: 34, flap: true,
    draw: (g, f) => {
      const b = ramp('#5d4c8c'), w = ramp('#7f6bb4');
      const wy = f.open ? 30 : 12, cy = 24;
      for (const s of [-1, 1]) {
        tri(g, w.a, CX + s * 3, cy - 2, CX + s * 17, wy, CX + s * 5, cy + 4);
        tri(g, w.b, CX + s * 3, cy + 1, CX + s * 17, wy, CX + s * 12, wy + (f.open ? -5 : 7));
        line(g, b.d, CX + s * 3, cy - 2, CX + s * 17, wy);
        line(g, b.d, CX + s * 4, cy, CX + s * 11, wy + (f.open ? -3 : 5));
      }
      blob(g, b, CX, cy, 5, 6);
      tri(g, b.a, CX - 5, cy - 4, CX - 2, cy - 5, CX - 5, cy - 10); tri(g, b.a, CX + 5, cy - 4, CX + 2, cy - 5, CX + 5, cy - 10);
      p1(g, '#ffd84a', CX - 3, cy - 2, 2, 2); p1(g, '#ffd84a', CX + 2, cy - 2, 2, 2); p1(g, INK, CX - 2, cy - 1); p1(g, INK, CX + 2, cy - 1);
      p1(g, '#f4f0e2', CX - 1, cy + 2, 1, 2); p1(g, '#f4f0e2', CX + 1, cy + 2, 1, 2);
      p1(g, b.d, CX - 2, cy + 6, 1, 2); p1(g, b.d, CX + 1, cy + 6, 1, 2);
    },
  },
  spider: {
    scale: 1, h: 20,
    draw: (g, f) => {
      const b = ramp('#44646e'), leg = '#26343a';
      for (let i = 0; i < 4; i++) {
        const ph = (i % 2 ? -1 : 1) * f.ph * 2, bx = 24 + i * 2;
        line(g, leg, bx, 34, bx + 5 + i + ph, 27 - i); line(g, leg, bx + 5 + i + ph, 27 - i, bx + 9 + i * 2 + ph, 41);
        line(g, leg, bx - 6, 34, bx - 12 - i - ph, 28 - i); line(g, leg, bx - 12 - i - ph, 28 - i, bx - 15 - i * 2 - ph, 41);
      }
      blob(g, b, 18, 33, 8, 6);
      p1(g, '#e08a3a', 17, 30, 3, 1); p1(g, '#e08a3a', 18, 31, 1, 3); p1(g, '#e08a3a', 17, 34, 3, 1); // hourglass
      blob(g, b, 29, 35, 5, 4);
      p1(g, '#ff4a3a', 31, 33); p1(g, '#ff4a3a', 33, 34); p1(g, '#ff4a3a', 30, 35);
      p1(g, '#f4f0e2', 33, 37, 1, f.open ? 3 : 2); p1(g, '#f4f0e2', 31, 38, 1, f.open ? 3 : 2);
    },
  },
  sporecap: {
    scale: 1, h: 26,
    draw: (g, f) => {
      const stem = ramp('#eadfc4'), cap = ramp('#c95a3c'), tilt = Math.round(f.ph);
      p1(g, '#7a5a3a', 19 - tilt, 40, 4, 2); p1(g, '#7a5a3a', 26 + tilt, 40, 4, 2);
      blob(g, stem, CX, 35, 5, 6);
      p1(g, INK, 22, 34, 2, 2); p1(g, INK, 27, 34, 2, 2); p1(g, '#ffffff', 22, 34); p1(g, '#ffffff', 27, 34);
      p1(g, f.open ? '#7a2a2a' : stem.d, 24, 38, 2, f.open ? 2 : 1);
      for (let dy = -9; dy <= 0; dy++) { // dome
        const w = Math.floor(12 * Math.sqrt(1 - (dy * dy) / 81) + 0.4);
        for (let dx = -w; dx <= w; dx++) p1(g, dx / 12 + dy / 9 < -0.8 ? cap.c : dx > w - 3 || dy === 0 ? cap.b : cap.a, CX + tilt + dx, 30 + dy);
      }
      p1(g, cap.d, CX + tilt - 11, 31, 23, 1); p1(g, '#f0e6cf', CX + tilt - 9, 32, 19, 1); // rim + gills
      for (const [x, y, r] of [[-6, -4, 2], [3, -6, 2], [7, -2, 1], [-1, -2, 1]]) disc(g, '#f6ecd6', CX + tilt + x, 30 + y, r);
      if (f.open) for (const [x, y] of [[-14, 24], [15, 22], [-10, 16], [11, 15], [0, 14]]) p1(g, '#b9dc6a', CX + x, y, 2, 2); // spores
    },
  },
  wolf: {
    scale: 1, h: 24,
    draw: (g, f) => {
      const b = ramp('#7f8a9e'), dark = ramp('#4a5262'), chest = ramp('#c9d0dc');
      const ph = Math.round(f.ph * 2);
      for (const [x, o] of [[12, ph], [16, -ph], [27, -ph], [31, ph]]) { p1(g, dark.a, x + o, 34, 2, 8 - Math.max(0, o)); p1(g, INK, x + o, 41 - Math.max(0, o), 3, 1); }
      tri(g, b.b, 11, 30, 4, 24 - ph, 9, 33); tri(g, chest.a, 5, 25 - ph, 4, 24 - ph, 7, 27 - ph); // tail
      blob(g, b, 21, 31, 11, 5);
      blob(g, chest, 27, 34, 4, 2);
      blob(g, b, 33, 27, 5, 4);
      p1(g, b.a, 37, 28, 4, 3); p1(g, b.b, 37, 30, 4, 1); p1(g, INK, 40, 28, 1, 1);
      tri(g, dark.a, 30, 24, 33, 24, 31, 19); tri(g, b.a, 34, 24, 37, 24, 36, 19);
      p1(g, '#ffd84a', 35, 26, 2, 1); p1(g, INK, 36, 26);
      if (f.open) { p1(g, '#7a2a2a', 37, 31, 4, 2); p1(g, '#f4f0e2', 38, 31); p1(g, '#f4f0e2', 40, 31); }
    },
  },
  rootwarden: {
    scale: 1.5, h: 40,
    draw: (g, f) => {
      const bark = ramp('#6e4c30'), leaf = ['#1f4d33', '#2c6b3a', '#3f8a44', '#63ab52', '#8fca62'];
      const sway = Math.round(f.ph), lift = f.open ? -8 : 0;
      for (const [x, dx] of [[17, -4], [21, -1], [26, 1], [30, 4]]) { tri(g, bark.b, x, 38, x + 3, 38, x + dx + 1, 42); } // roots
      for (const s of [-1, 1]) { // branch arms
        const sx = CX + s * 6, ex = CX + s * 15 + sway, ey = 30 + lift;
        line(g, bark.d, sx, 26, ex, ey, 2); line(g, bark.a, sx, 25, ex, ey - 1, 2);
        line(g, bark.d, ex, ey, ex + s * 3, ey + 4); line(g, bark.d, ex, ey, ex + s * 4, ey - 2); line(g, bark.d, ex, ey, ex, ey + 5);
      }
      for (let y = 20; y <= 40; y++) { // trunk, wider at the base
        const w = 6 + (y > 34 ? Math.round((y - 34) / 2) : 0);
        p1(g, bark.a, CX - w, y, w * 2, 1); p1(g, bark.c, CX - w, y, 2, 1); p1(g, bark.b, CX + w - 3, y, 3, 1);
      }
      for (const x of [-3, 1, 4]) line(g, bark.d, CX + x, 22, CX + x + (x > 0 ? 1 : -1), 39);
      p1(g, INK, CX - 4, 27, 3, 3); p1(g, INK, CX + 2, 27, 3, 3); p1(g, '#9dff6a', CX - 3, 28, 2, 2); p1(g, '#9dff6a', CX + 2, 28, 2, 2);
      p1(g, INK, CX - 3, 33, 7, 1); p1(g, INK, CX - 2, 34, 1, 1); p1(g, INK, CX, 34, 1, 1); p1(g, INK, CX + 2, 34, 1, 1);
      const lobes: [number, number, number][] = [[CX + sway, 14, 9], [CX - 8 + sway, 17, 6], [CX + 8 + sway, 17, 6], [CX + sway, 8, 6]];
      for (const [x, y, r] of lobes) disc(g, leaf[0], x, y + 1, r + 1);
      for (const [x, y, r] of lobes) disc(g, leaf[1], x, y, r);
      for (const [x, y, r] of lobes) disc(g, leaf[2], x - 1, y - 1, r - 2);
      for (const [x, y, r] of lobes) disc(g, leaf[3], x - 2, y - 3, Math.max(1, r - 5));
      for (const [x, y] of [[-6, 10], [3, 6], [8, 14], [-10, 16], [0, 13]]) p1(g, leaf[4], CX + sway + x, y, 2, 1);
    },
  },
};


// ---------------------------------------------------------------------------------------------
// Archetypes for the M7/M8 roster. Each returns a draw function from a few colours and options,
// so related monsters share a silhouette family but never a sprite.
// ---------------------------------------------------------------------------------------------
function quadDraw(body: string, dark: string, chest: string, eye: string, o: { mane?: string; glow?: string; horn?: boolean } = {}): Draw {
  return (g, f) => {
    const b = ramp(body), dk = ramp(dark), ch = ramp(chest), ph = Math.round(f.ph * 2);
    for (const [x, off] of [[12, ph], [16, -ph], [27, -ph], [31, ph]]) { p1(g, dk.a, x + off, 34, 2, 8 - Math.max(0, off)); p1(g, INK, x + off, 41 - Math.max(0, off), 3, 1); }
    tri(g, b.b, 11, 30, 4, 24 - ph, 9, 33); tri(g, o.glow ?? ch.a, 5, 25 - ph, 4, 24 - ph, 7, 27 - ph);
    blob(g, b, 21, 31, 11, 5);
    blob(g, ch, 27, 34, 4, 2);
    if (o.mane) for (let x = 14; x <= 30; x += 3) tri(g, o.mane, x, 27, x + 3, 27, x + 1, 22 - (x % 2));
    blob(g, b, 33, 27, 5, 4);
    p1(g, b.a, 37, 28, 4, 3); p1(g, b.b, 37, 30, 4, 1); p1(g, INK, 40, 28, 1, 1);
    tri(g, dk.a, 30, 24, 33, 24, 31, 19); tri(g, b.a, 34, 24, 37, 24, 36, 19);
    if (o.horn) { line(g, '#f4f0e2', 33, 22, 36, 17); line(g, '#f4f0e2', 30, 22, 31, 17); }
    p1(g, eye, 35, 26, 2, 1); p1(g, INK, 36, 26);
    if (o.glow) for (const [x, y] of [[16, 29], [22, 28], [26, 31]]) p1(g, o.glow, x, y, 2, 1);
    if (f.open) { p1(g, '#7a2a2a', 37, 31, 4, 2); p1(g, '#f4f0e2', 38, 31); p1(g, '#f4f0e2', 40, 31); }
  };
}
function wingDraw(body: string, wing: string, eye: string, o: { tail?: string; horn?: boolean; spots?: string } = {}): Draw {
  return (g, f) => {
    const b = ramp(body), w = ramp(wing);
    const wy = f.open ? 30 : 12, cy = 24;
    for (const s of [-1, 1]) {
      tri(g, w.a, CX + s * 3, cy - 2, CX + s * 17, wy, CX + s * 5, cy + 4);
      tri(g, w.b, CX + s * 3, cy + 1, CX + s * 17, wy, CX + s * 12, wy + (f.open ? -5 : 7));
      line(g, b.d, CX + s * 3, cy - 2, CX + s * 17, wy);
      line(g, b.d, CX + s * 4, cy, CX + s * 11, wy + (f.open ? -3 : 5));
      if (o.spots) { p1(g, o.spots, CX + s * 9, Math.round((cy + wy) / 2), 2, 2); p1(g, o.spots, CX + s * 13, Math.round((cy + wy * 2) / 3), 1, 1); }
    }
    if (o.tail) { line(g, b.b, CX, cy + 5, CX - 2 + Math.round(f.ph * 2), cy + 14, 2); tri(g, o.tail, CX - 4 + Math.round(f.ph * 2), cy + 13, CX + 1 + Math.round(f.ph * 2), cy + 13, CX - 2 + Math.round(f.ph * 2), cy + 18); }
    blob(g, b, CX, cy, 5, 6);
    if (o.horn) { tri(g, '#f4f0e2', CX - 4, cy - 5, CX - 2, cy - 5, CX - 5, cy - 11); tri(g, '#f4f0e2', CX + 4, cy - 5, CX + 2, cy - 5, CX + 5, cy - 11); }
    else { tri(g, b.a, CX - 5, cy - 4, CX - 2, cy - 5, CX - 5, cy - 10); tri(g, b.a, CX + 5, cy - 4, CX + 2, cy - 5, CX + 5, cy - 10); }
    p1(g, eye, CX - 3, cy - 2, 2, 2); p1(g, eye, CX + 2, cy - 2, 2, 2); p1(g, INK, CX - 2, cy - 1); p1(g, INK, CX + 2, cy - 1);
    p1(g, '#f4f0e2', CX - 1, cy + 2, 1, 2); p1(g, '#f4f0e2', CX + 1, cy + 2, 1, 2);
    p1(g, b.d, CX - 2, cy + 6, 1, 2); p1(g, b.d, CX + 1, cy + 6, 1, 2);
  };
}
function beetleDraw(shell: string, leg: string, glow: string): Draw {
  return (g, f) => {
    const s = ramp(shell), ph = Math.round(f.ph * 2);
    for (let i = 0; i < 3; i++) {
      const o = (i % 2 ? -1 : 1) * ph, x = 14 + i * 7;
      line(g, leg, x, 36, x - 4 + o, 41); line(g, leg, x + 2, 36, x + 6 - o, 41);
    }
    blob(g, s, 22, 31, 12, 8);
    line(g, s.d, 22, 23, 22, 38); // wing seam
    for (const [x, y] of [[15, 28], [28, 27], [18, 34], [27, 34]]) { p1(g, glow, x, y, 2, 2); p1(g, '#ffffff', x, y, 1, 1); }
    blob(g, ramp(leg), 35, 34, 4, 3);
    p1(g, glow, 36, 33, 1, 1); p1(g, glow, 38, 34, 1, 1);
    line(g, leg, 38, 35, 42, f.open ? 31 : 36); line(g, leg, 38, 36, 42, f.open ? 41 : 38); // pincers
    p1(g, s.b, 14, 25, 8, 1); p1(g, s.b, 12, 27, 3, 1);
  };
}
function wispDraw(core: string, glow: string, o: { face?: boolean; ghost?: boolean } = {}): Draw {
  return (g, f) => {
    const c = ramp(core), bob = Math.round(f.ph), cy = 24 + bob;
    if (o.ghost) { // tattered shroud
      for (let y = 0; y < 16; y++) { const w = 7 - Math.floor(y / 4) + ((y + (f.open ? 1 : 0)) % 3 === 0 ? 1 : 0); p1(g, y % 2 ? c.a : c.c, CX - w, cy + y, w * 2, 1); }
      for (const x of [-6, -2, 2, 5]) p1(g, c.c, CX + x, cy + 16, 2, 2 + ((x + 8) % 3));
    } else for (let i = 0; i < 5; i++) { p1(g, glow, CX - 3 + i + Math.round(f.ph * (i - 2)), cy + 9 + i * 2, 5 - i, 2); } // trailing flame
    disc(g, glow, CX, cy, 9); blob(g, c, CX, cy, 7, 7);
    disc(g, '#ffffff', CX - 2, cy - 2, 2);
    if (o.face || o.ghost) { p1(g, INK, CX - 4, cy - 1, 2, 3); p1(g, INK, CX + 2, cy - 1, 2, 3); p1(g, f.open ? '#ffffff' : glow, CX - 4, cy - 1); p1(g, f.open ? '#ffffff' : glow, CX + 2, cy - 1); if (f.open) p1(g, INK, CX - 2, cy + 3, 4, 2); }
    for (const [x, y] of [[-12, -6], [11, -9], [-9, 8], [13, 4]]) p1(g, glow, CX + x + (f.open ? 1 : 0), cy + y - (f.open ? 2 : 0), 1, 1); // sparks
  };
}
function slimeDraw(body: string, core: string): Draw {
  return (g, f) => {
    const b = ramp(body), sq = f.open ? 2 : 0, w = 12 + Math.abs(Math.round(f.ph)) + sq;
    blob(g, b, CX, 35 + sq, w, 7 - sq);
    blob(g, b, CX - 2, 29 + sq, 7, 5);
    for (const [x, y] of [[-8, 33], [6, 31], [-3, 27], [9, 36]]) p1(g, b.d, CX + x, y + sq, 2, 1);
    disc(g, core, CX + 1, 33 + sq, 3); p1(g, '#ffffff', CX, 32 + sq, 1, 1);
    p1(g, INK, CX - 6, 30 + sq, 2, 2); p1(g, INK, CX + 3, 29 + sq, 2, 2);
    for (const x of [-11, 10]) p1(g, b.b, CX + x + Math.round(f.ph * 2), 40, 3, 2); // drips
    if (f.open) p1(g, INK, CX - 3, 35, 6, 2);
  };
}
type Weapon = 'sword' | 'halberd' | 'staff' | 'fist' | 'none';
interface Humanoid { skin: string; armor: string; trim: string; eye: string; weapon?: Weapon; bulky?: boolean; helm?: 'horns' | 'crown' | 'hood' | 'visor' | 'none'; cape?: string; wings?: string; fur?: string; glow?: string; robe?: boolean }
function humanoidDraw(o: Humanoid): Draw {
  return (g, f) => {
    const sk = ramp(o.skin), ar = ramp(o.armor), tr = ramp(o.trim), bw = o.bulky ? 9 : 6, ph = Math.round(f.ph);
    if (o.wings) for (const s of [-1, 1]) { // bat wings behind the body
      const w = ramp(o.wings), up = f.open ? -6 : 0;
      tri(g, w.c, CX + s * 4, 22, CX + s * 21, 10 + up, CX + s * 16, 30); tri(g, w.a, CX + s * 4, 22, CX + s * 21, 10 + up, CX + s * 9, 20);
      line(g, w.d, CX + s * 4, 22, CX + s * 21, 10 + up); line(g, w.d, CX + s * 12, 18 + up / 2, CX + s * 16, 30);
    }
    if (o.cape) { const c = ramp(o.cape); tri(g, c.c, CX - bw, 22, CX + bw, 22, CX - bw - 3 - ph, 40); tri(g, c.a, CX - bw, 22, CX + bw, 22, CX + bw + 2 - ph, 39); }
    if (o.robe) { for (let y = 30; y <= 41; y++) { const w = bw - 1 + Math.round((y - 30) / 3); p1(g, y % 4 ? ar.a : ar.c, CX - w, y, w * 2, 1); } p1(g, tr.a, CX - bw - 3, 41, bw * 2 + 6, 1); }
    else for (const [x, off] of [[CX - bw + 2, ph], [CX + bw - 5, -ph]]) { // legs
      p1(g, ar.c, x + off, 33, o.bulky ? 4 : 3, 8 - Math.max(0, off)); p1(g, INK, x + off - 1, 41 - Math.max(0, off), o.bulky ? 6 : 5, 1);
    }
    blob(g, ar, CX, 27, bw, 7);
    p1(g, tr.a, CX - bw + 1, 32, bw * 2 - 2, 1); p1(g, tr.d, CX - 1, 24, 2, 8); // belt and centre line
    if (o.glow) { p1(g, o.glow, CX - 2, 26, 4, 3); p1(g, '#ffffff', CX - 1, 26, 1, 1); }
    if (o.fur) for (let x = -bw; x <= bw; x += 3) tri(g, o.fur, CX + x, 22, CX + x + 3, 22, CX + x + 1, 19);
    // arms: the weapon arm lifts on the attack frames
    const lift = f.open ? 9 : 0, hx = CX + bw + 3, hy = 31 - lift, lx = CX - bw - 3, ly = 31 - (o.weapon === 'fist' ? lift : 0);
    line(g, ar.c, CX - bw + 1, 23, lx, ly, o.bulky ? 3 : 2); line(g, ar.a, CX + bw - 1, 23, hx, hy, o.bulky ? 3 : 2);
    disc(g, sk.a, lx, ly, o.bulky ? 2 : 1); disc(g, sk.a, hx, hy, o.bulky ? 2 : 1);
    if (o.weapon === 'sword') { line(g, '#cfd6e2', hx, hy, hx + 5, hy - 15, 2); line(g, '#f4f8ff', hx, hy - 1, hx + 5, hy - 16); p1(g, tr.a, hx - 2, hy - 1, 6, 2); }
    else if (o.weapon === 'halberd') { line(g, '#6e4c30', hx, hy + 8, hx + 3, hy - 20, 1); tri(g, '#cfd6e2', hx + 3, hy - 20, hx + 9, hy - 15, hx + 2, hy - 11); p1(g, '#f4f8ff', hx + 3, hy - 19, 1, 5); }
    else if (o.weapon === 'staff') { line(g, '#6e4c30', hx, hy + 9, hx + 2, hy - 16, 1); disc(g, o.glow ?? tr.b, hx + 2, hy - 18, 3); p1(g, '#ffffff', hx + 1, hy - 19, 1, 1); }
    else if (o.weapon === 'fist') { disc(g, ar.b, hx, hy, 3); disc(g, ar.b, lx, ly, 3); }
    // head
    blob(g, sk, CX, 15, 5, 5);
    if (o.helm === 'hood') { tri(g, ar.c, CX - 7, 18, CX + 7, 18, CX, 6); p1(g, INK, CX - 3, 14, 6, 4); }
    else if (o.helm === 'visor') { p1(g, ar.a, CX - 6, 10, 12, 5); p1(g, ar.b, CX - 6, 10, 12, 1); p1(g, INK, CX - 4, 15, 8, 2); p1(g, tr.a, CX - 1, 7, 2, 3); }
    else if (o.helm === 'crown') { p1(g, tr.a, CX - 5, 9, 10, 2); for (const x of [-5, -1, 3]) tri(g, tr.b, CX + x, 9, CX + x + 2, 9, CX + x + 1, 5); p1(g, o.glow ?? '#7fd6ff', CX - 1, 9, 2, 1); }
    else if (o.helm === 'horns') { for (const s of [-1, 1]) { tri(g, '#e8dcc0', CX + s * 3, 11, CX + s * 6, 12, CX + s * 9, 3); line(g, '#a89878', CX + s * 5, 11, CX + s * 9, 3); } }
    p1(g, o.eye, CX - 3, 15, 2, 1); p1(g, o.eye, CX + 1, 15, 2, 1);
    if (f.open && o.helm !== 'visor' && o.helm !== 'hood') p1(g, INK, CX - 2, 18, 4, 1);
  };
}
function serpentDraw(body: string, belly: string, eye: string): Draw {
  return (g, f) => {
    const b = ramp(body), be = ramp(belly);
    let lx = 8, ly = 40;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, x = 8 + t * 24, y = 40 - Math.sin(t * 5 + f.ph * 1.2) * 3 - (t > 0.6 ? (t - 0.6) * 44 : 0), r = i < 3 ? 2 : i > 13 ? 3 : 4;
      disc(g, b.c, Math.round(x), Math.round(y) + 1, r); disc(g, b.a, Math.round(x), Math.round(y), r - 1); if (i % 2) p1(g, be.a, Math.round(x) - 1, Math.round(y) + r - 2, 3, 1);
      lx = x; ly = y;
    }
    const hx = Math.round(lx) + 3, hy = Math.round(ly) - 2;
    blob(g, b, hx, hy, 5, 4);
    tri(g, b.b, hx - 6, hy - 2, hx - 6, hy + 4, hx - 10, hy + 1); tri(g, b.b, hx + 2, hy - 5, hx + 6, hy - 3, hx + 1, hy - 8); // hood flares
    p1(g, eye, hx + 1, hy - 1, 2, 2); p1(g, INK, hx + 2, hy - 1, 1, 2);
    if (f.open) { p1(g, '#7a2a2a', hx + 3, hy + 1, 4, 2); p1(g, '#f4f0e2', hx + 4, hy + 1, 1, 3); p1(g, '#f4f0e2', hx + 6, hy + 1, 1, 2); } else line(g, '#d0483c', hx + 5, hy + 1, hx + 8, hy + 2);
  };
}
function dragonDraw(body: string, belly: string, wing: string, eye: string): Draw {
  return (g, f) => {
    const b = ramp(body), be = ramp(belly), w = ramp(wing), ph = Math.round(f.ph), wy = f.open ? 2 : 14;
    tri(g, b.c, 12, 30, 12, 36, 1, 38 + ph); tri(g, b.a, 12, 30, 12, 34, 2, 37 + ph); tri(g, be.b, 1, 38 + ph, 4, 35 + ph, 0, 34 + ph); // tail and its barb
    for (const s of [0, 1]) { // wings: far one darker
      const ox = s ? 0 : -4, c = s ? w.a : w.c;
      tri(g, c, 20 + ox, 26, 8 + ox, wy, 30 + ox, wy + 6); tri(g, s ? w.b : w.c, 20 + ox, 26, 30 + ox, wy + 6, 32 + ox, 24);
      line(g, b.d, 20 + ox, 26, 8 + ox, wy); line(g, b.d, 20 + ox, 26, 30 + ox, wy + 6); line(g, b.d, 20 + ox, 26, 19 + ox, wy + 4);
    }
    for (const [x, off] of [[13, ph], [18, -ph], [27, -ph], [31, ph]]) { p1(g, b.c, x + off, 35, 4, 6 - Math.max(0, off)); p1(g, '#f4f0e2', x + off, 41 - Math.max(0, off), 5, 1); }
    blob(g, b, 22, 31, 12, 7);
    blob(g, be, 24, 35, 8, 3);
    for (let x = 12; x <= 30; x += 4) tri(g, b.b, x, 25, x + 3, 25, x + 1, 21); // back spines
    line(g, b.a, 31, 28, 36, 19, 4); line(g, be.a, 34, 28, 38, 21, 2); // neck
    blob(g, b, 39, 17, 5, 4);
    p1(g, b.a, 42, 17, 5, 3); p1(g, b.b, 42, 19, 5, 1); p1(g, INK, 46, 17, 1, 1);
    tri(g, '#f4f0e2', 36, 14, 38, 14, 33, 8); tri(g, '#f4f0e2', 39, 13, 41, 13, 38, 7);
    p1(g, eye, 40, 15, 2, 2); p1(g, INK, 41, 15, 1, 2);
    if (f.open) { p1(g, '#7a2a2a', 42, 20, 5, 2); p1(g, '#f4f0e2', 43, 20); p1(g, '#f4f0e2', 45, 20); p1(g, '#ffb44a', 47, 20, 1, 2); }
  };
}
function treantDraw(barkC: string, leaf: string[], eye: string): Draw {
  return (g, f) => {
    const bark = ramp(barkC);
    const sway = Math.round(f.ph), lift = f.open ? -8 : 0;
    for (const [x, dx] of [[17, -4], [21, -1], [26, 1], [30, 4]]) { tri(g, bark.b, x, 38, x + 3, 38, x + dx + 1, 42); }
    for (const s of [-1, 1]) {
      const sx = CX + s * 6, ex = CX + s * 15 + sway, ey = 30 + lift;
      line(g, bark.d, sx, 26, ex, ey, 2); line(g, bark.a, sx, 25, ex, ey - 1, 2);
      line(g, bark.d, ex, ey, ex + s * 3, ey + 4); line(g, bark.d, ex, ey, ex + s * 4, ey - 2); line(g, bark.d, ex, ey, ex, ey + 5);
    }
    for (let y = 20; y <= 40; y++) {
      const w = 6 + (y > 34 ? Math.round((y - 34) / 2) : 0);
      p1(g, bark.a, CX - w, y, w * 2, 1); p1(g, bark.c, CX - w, y, 2, 1); p1(g, bark.b, CX + w - 3, y, 3, 1);
    }
    for (const x of [-3, 1, 4]) line(g, bark.d, CX + x, 22, CX + x + (x > 0 ? 1 : -1), 39);
    p1(g, INK, CX - 4, 27, 3, 3); p1(g, INK, CX + 2, 27, 3, 3); p1(g, eye, CX - 3, 28, 2, 2); p1(g, eye, CX + 2, 28, 2, 2);
    p1(g, INK, CX - 3, 33, 7, 1); p1(g, INK, CX - 2, 34, 1, 1); p1(g, INK, CX, 34, 1, 1); p1(g, INK, CX + 2, 34, 1, 1);
    const lobes: [number, number, number][] = [[CX + sway, 14, 9], [CX - 8 + sway, 17, 6], [CX + 8 + sway, 17, 6], [CX + sway, 8, 6]];
    for (const [x, y, r] of lobes) disc(g, leaf[0], x, y + 1, r + 1);
    for (const [x, y, r] of lobes) disc(g, leaf[1], x, y, r);
    for (const [x, y, r] of lobes) disc(g, leaf[2], x - 1, y - 1, r - 2);
    for (const [x, y, r] of lobes) disc(g, leaf[3], x - 2, y - 3, Math.max(1, r - 5));
    for (const [x, y] of [[-6, 10], [3, 6], [8, 14], [-10, 16], [0, 13]]) p1(g, leaf[4], CX + sway + x, y, 2, 1);
  };
}
type Spec = { draw: Draw; scale: number; h: number; hop?: number; flap?: boolean };
const EXTRA: Record<string, Spec> = {
  // Ashen Highlands
  ember_hound: { scale: 1, h: 24, draw: quadDraw('#5a3a34', '#2e1f1c', '#e2622a', '#ffb44a', { mane: '#e2622a', glow: '#ffb44a' }) },
  cinder_imp: { scale: 0.9, h: 34, flap: true, draw: wingDraw('#b8431c', '#6a2a1c', '#ffe08a', { tail: '#ffb44a', horn: true }) },
  slag_beetle: { scale: 1.1, h: 22, draw: beetleDraw('#4a4244', '#2a2426', '#ffb44a') },
  ash_wraith: { scale: 1.1, h: 34, hop: 2, draw: wispDraw('#8a7f7a', '#c9622a', { ghost: true }) },
  magma_brute: { scale: 1.6, h: 38, draw: humanoidDraw({ skin: '#5a4a48', armor: '#4a3c3a', trim: '#e2622a', eye: '#ffe08a', weapon: 'fist', bulky: true, helm: 'none', glow: '#ffb44a' }) },
  // Frostveil
  snow_stalker: { scale: 1, h: 24, draw: quadDraw('#e4edf4', '#9fb6cf', '#ffffff', '#5fb8ff') },
  ice_wisp: { scale: 1, h: 34, hop: 2, draw: wispDraw('#b7dcf2', '#7fd6ff', { face: true }) },
  rime_yeti: { scale: 1.25, h: 38, draw: humanoidDraw({ skin: '#8fb0c8', armor: '#eef4f8', trim: '#c3d8e8', eye: '#3f73ae', weapon: 'fist', bulky: true, helm: 'none', fur: '#ffffff' }) },
  glacier_beetle: { scale: 1.1, h: 22, draw: beetleDraw('#8fbfdc', '#3f6a8a', '#ffffff') },
  avalanche_elder: { scale: 1.7, h: 38, draw: humanoidDraw({ skin: '#6f93b4', armor: '#dfe9f2', trim: '#7fb8dc', eye: '#ff6a4a', weapon: 'fist', bulky: true, helm: 'horns', fur: '#ffffff' }) },
  // Dreadmoor
  bog_lurker: { scale: 1.1, h: 20, hop: 2, draw: slimeDraw('#5c7a4a', '#c9d08a') },
  grave_moth: { scale: 0.95, h: 34, flap: true, draw: wingDraw('#6a6258', '#a89a80', '#b9d08a', { spots: '#2f3a2b' }) },
  drowned_knight: { scale: 1.1, h: 38, draw: humanoidDraw({ skin: '#7a9a8a', armor: '#4a5a58', trim: '#8a7a50', eye: '#8fffe0', weapon: 'sword', helm: 'visor' }) },
  mire_serpent: { scale: 1.15, h: 30, draw: serpentDraw('#4a6a3c', '#b9c88a', '#ffd84a') },
  gallows_tree: { scale: 1.6, h: 40, draw: treantDraw('#3a3530', ['#14181a', '#232b26', '#35402f', '#4c5a39', '#8a7a50'], '#ff6a4a') },
  // Astral Ruins
  rune_sentinel: { scale: 1.2, h: 38, draw: humanoidDraw({ skin: '#8a86a6', armor: '#6a6584', trim: '#b9a2ff', eye: '#b9a2ff', weapon: 'fist', bulky: true, helm: 'visor', glow: '#b9a2ff' }) },
  void_ray: { scale: 1.1, h: 34, flap: true, draw: wingDraw('#2a1d55', '#4a3a9a', '#e8dcff', { tail: '#b9a2ff', spots: '#b9a2ff' }) },
  star_wisp: { scale: 1, h: 34, hop: 2, draw: wispDraw('#fff0b0', '#ffd24a') },
  astral_stalker: { scale: 1.1, h: 24, draw: quadDraw('#3b3663', '#1f1a40', '#7a66d8', '#e8dcff', { glow: '#b9a2ff', horn: true }) },
  echo_colossus: { scale: 1.8, h: 38, draw: humanoidDraw({ skin: '#9a95b2', armor: '#4c4868', trim: '#7fd6ff', eye: '#7fd6ff', weapon: 'fist', bulky: true, helm: 'crown', glow: '#7fd6ff' }) },
  // dungeon dwellers
  ruin_bat: { scale: 0.9, h: 34, flap: true, draw: wingDraw('#4a4f44', '#70766a', '#ff6a4a') },
  ruin_sentry: { scale: 1.1, h: 38, draw: humanoidDraw({ skin: '#8d9283', armor: '#636a5e', trim: '#7fbf6a', eye: '#9dff6a', weapon: 'fist', bulky: true, helm: 'none', glow: '#9dff6a' }) },
  ruin_warden: { scale: 1.5, h: 38, draw: humanoidDraw({ skin: '#9ea392', armor: '#555a4e', trim: '#c9a24a', eye: '#9dff6a', weapon: 'halberd', helm: 'visor', cape: '#3f5a45' }) },
  dragon_whelp: { scale: 0.75, h: 34, draw: dragonDraw('#b8431c', '#e8b06a', '#8a2a1c', '#ffe08a') },
  frost_knight: { scale: 1.15, h: 38, draw: humanoidDraw({ skin: '#a9c3d8', armor: '#5f8fb0', trim: '#e8f6ff', eye: '#ffffff', weapon: 'sword', helm: 'visor', cape: '#3f6a8a' }) },
  abyssal_cultist: { scale: 1.05, h: 38, draw: humanoidDraw({ skin: '#6f8a8a', armor: '#1f2e33', trim: '#2a8a7a', eye: '#8fffe0', weapon: 'staff', helm: 'hood', robe: true, glow: '#8fffe0' }) },
  // bosses
  rune_guardian: { scale: 2.1, h: 40, draw: humanoidDraw({ skin: '#a8ad9c', armor: '#5c6258', trim: '#c9a24a', eye: '#9dff6a', weapon: 'fist', bulky: true, helm: 'crown', glow: '#9dff6a', cape: '#3a4a3c' }) },
  ancient_dragon: { scale: 2.5, h: 40, draw: dragonDraw('#8a2a1c', '#e8b06a', '#5a1a14', '#ffe08a') },
  frost_queen: { scale: 1.7, h: 40, draw: humanoidDraw({ skin: '#dfeaf4', armor: '#7fb8dc', trim: '#ffffff', eye: '#3f73ae', weapon: 'staff', helm: 'crown', robe: true, cape: '#3f6a8a', glow: '#b7ecff' }) },
  abyssal_golem: { scale: 2.3, h: 40, draw: humanoidDraw({ skin: '#34494e', armor: '#1c2a2e', trim: '#2a8a7a', eye: '#8fffe0', weapon: 'fist', bulky: true, helm: 'horns', glow: '#8fffe0' }) },
  shadow_knight: { scale: 1.9, h: 40, draw: humanoidDraw({ skin: '#2a2438', armor: '#1a1626', trim: '#8a3a9a', eye: '#ff4a6a', weapon: 'sword', helm: 'visor', cape: '#4a1a3a' }) },
  demon_lord: { scale: 2.5, h: 40, draw: humanoidDraw({ skin: '#a8342a', armor: '#3a1418', trim: '#ffb44a', eye: '#ffe08a', weapon: 'sword', bulky: true, helm: 'horns', wings: '#5a1418', glow: '#ffb44a' }) },
};
Object.assign(DRAW, EXTRA);

/** Visual height above the feet in world pixels (for health bars and name plates). */
const specOf = (type: string) => DRAW[type] ?? (MONSTER_LOOK[type] ? DRAW[MONSTER_LOOK[type].from] : undefined);
export const monsterHeight = (type: string) => { const d = specOf(type); return d ? d.h * d.scale : 24; };
export const monsterScale = (type: string) => specOf(type)?.scale ?? 1;

const sheets = new Map<string, HTMLCanvasElement>();
export const HD_M_FRAME = 64;
/** Whether a sheet is already built (no work). */
export const hasMonsterSheet = (type: string, hd = false) => sheets.has(hd ? type + '@hd' : type);
export function getMonsterSheet(type: string, hd = false): HTMLCanvasElement {
  const key = hd ? type + '@hd' : type;
  let s = sheets.get(key);
  if (s) return s;
  const look = DRAW[type] ? undefined : MONSTER_LOOK[type];
  if (look) {
    // a monster of the later regions: the art of the monster it is made from, in its region's colours
    const base = getMonsterSheet(look.from, hd);
    s = mk(base.width, base.height);
    const g = s.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.filter = `hue-rotate(${look.hue}deg) saturate(1.25) contrast(1.08)`;
    g.drawImage(base, 0, 0);
    sheets.set(key, s);
    return s;
  }
  const spec = DRAW[type] ?? DRAW.mossling, sc = spec.scale, F = hd ? HD_M_FRAME : M_FRAME, out = Math.round(F * sc), KS = hd ? HD_M_FRAME / M_FRAME : 1;
  s = mk(M_COLS * out, 2 * out);
  const sg = s.getContext('2d')!;
  sg.imageSmoothingEnabled = false;
  const tmp = mk(F, F), tg = tmp.getContext('2d', { willReadFrequently: true })!;
  const frames: { f: Frame; dx: number; dy: number; flash?: boolean; squash?: number; alpha?: number }[] = [];
  const hop = spec.hop ?? 1;
  frames.push({ f: { ph: 0, open: 0 }, dx: 0, dy: 0 }, { f: { ph: 0, open: spec.flap ? 1 : 0 }, dx: 0, dy: 1 });
  for (let i = 0; i < 4; i++) { const ph = [1, 0, -1, 0][i]; frames.push({ f: { ph, open: i % 2 }, dx: 0, dy: ph ? -hop : 0 }); }
  frames.push({ f: { ph: -1, open: 0 }, dx: -3, dy: 0 }, { f: { ph: 1, open: 1 }, dx: 6, dy: -1 }, { f: { ph: 0, open: 1 }, dx: 2, dy: 0 });
  frames.push({ f: { ph: 0, open: 0 }, dx: -3, dy: 0, flash: true });
  frames.push({ f: { ph: 0, open: 0 }, dx: 0, dy: 0, squash: 0.72 }, { f: { ph: 0, open: 0 }, dx: 0, dy: 0, squash: 0.48 }, { f: { ph: 0, open: 0 }, dx: 0, dy: 0, squash: 0.3, alpha: 0.6 });
  frames.forEach((fr, col) => {
    tg.setTransform(1, 0, 0, 1, Math.round(fr.dx * KS), Math.round(fr.dy * KS));
    tg.clearRect(-12, -12, F + 24, F + 24);
    K = KS;
    try { spec.draw(tg, fr.f); } finally { K = 1; }
    tg.setTransform(1, 0, 0, 1, 0, 0);
    let d: Uint8ClampedArray = tg.getImageData(0, 0, F, F).data;
    if (fr.squash) { // flatten toward the ground, spreading sideways
      const o = new Uint8ClampedArray(d.length), sy = fr.squash, sx = 1 / Math.sqrt(sy);
      for (let y = 0; y < F; y++)
        for (let x = 0; x < F; x++) {
          const srcY = Math.round(BASE * KS - (BASE * KS - y) / sy), srcX = Math.round(CX * KS + (x - CX * KS) / sx);
          if (srcY < 0 || srcY >= F || srcX < 0 || srcX >= F) continue;
          const si = (srcY * F + srcX) * 4, di = (y * F + x) * 4;
          if (d[si + 3]) { o[di] = d[si]; o[di + 1] = d[si + 1]; o[di + 2] = d[si + 2]; o[di + 3] = 255; }
        }
      d = o;
    }
    const out2 = hd ? styleAFinish(d, F, F) : outlined(d, F, F); // HD: the style A edge light and coloured outline
    d = out2;
    if (fr.flash || fr.alpha)
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        if (fr.flash) { d[i] += (255 - d[i]) * 0.65; d[i + 1] += (255 - d[i + 1]) * 0.65; d[i + 2] += (255 - d[i + 2]) * 0.65; }
        if (fr.alpha) d[i + 3] = Math.round(255 * fr.alpha);
      }
    tg.putImageData(new ImageData(out2, F, F), 0, 0);
    sg.drawImage(tmp, 0, 0, F, F, col * out, 0, out, out); // facing right
    sg.save();
    sg.translate(col * out + out, out);
    sg.scale(-1, 1);
    sg.drawImage(tmp, 0, 0, F, F, 0, 0, out, out); // facing left
    sg.restore();
  });
  sheets.set(key, s);
  return s;
}
export const MONSTER_TYPES = [...Object.keys(DRAW), ...Object.keys(MONSTER_LOOK).filter((k) => !DRAW[k])];
/** Replaces a built-in sheet with imported art (same layout; the scale may differ). */
export function setMonsterSheet(type: string, sheet: HTMLCanvasElement, scale: number) {
  if (!DRAW[type]) return;
  DRAW[type] = { ...DRAW[type], scale };
  sheets.set(type, sheet);
}
