// Ability visual effects (original, drawn in code as animated pixel shapes in world space).
// One effect instance per `Act.Fx` event; each of the twelve rune spells has its own look.
import type { AbilityDef } from '../../../shared/src/abilities';

type G = CanvasRenderingContext2D;
export interface Fx {
  def: AbilityDef;
  t0: number;
  ms: number;
  sx: number; // caster position when the effect started
  sy: number;
  tx: number; // aimed point
  ty: number;
  src: number;
  tid: number;
  key: number;
  chain: number[];
  /** Traps: set when the server says it fired, to play the burst. */
  firedAt?: number;
  /** One-time reactions already triggered (screen shake, flash), as a bit mask. */
  fired?: number;
}
type PosOf = (id: number) => { x: number; y: number } | null;

const TRAVEL = 170;
export function fxDuration(def: AbilityDef): number {
  switch (def.fx.t) {
    case 'proj': return TRAVEL + 420;
    case 'ring': return def.fx.v === 'cataclysm' ? 1000 : 620;
    case 'bolt': return 460;
    case 'chain': return 420;
    case 'meteor': return 1150;
    case 'zone': return def.field!.ms;
    case 'trap': return def.field!.ms;
    case 'aura': return 900;
    case 'slash': return def.fx.v === 'wind' ? 340 : 300;
    case 'shield': return 900;
    case 'dash': return 320;
    case 'smoke': return 700;
  }
}

const px = (g: G, c: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};
/** Deterministic 0..1 noise so an effect looks the same every frame it is alive. */
const rnd = (seed: number, i: number) => {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
function ring(g: G, c: string, x: number, y: number, r: number, size = 2, squash = 0.8, gap = 1) {
  const n = Math.max(8, Math.round((r * 6.28) / (size + gap)));
  g.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283;
    g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * squash), size, size);
  }
}
function zigzag(g: G, c: string, x0: number, y0: number, x1: number, y1: number, seed: number, amp = 6) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / 9));
  let px0 = x0, py0 = y0;
  g.fillStyle = c;
  for (let i = 1; i <= n; i++) {
    const t = i / n, off = i === n ? 0 : (rnd(seed, i) - 0.5) * 2 * amp;
    const nx = x0 + (x1 - x0) * t + ((y1 - y0) / len) * off, ny = y0 + (y1 - y0) * t - ((x1 - x0) / len) * off;
    const steps = Math.max(1, Math.round(Math.hypot(nx - px0, ny - py0)));
    for (let s = 0; s <= steps; s++) g.fillRect(Math.round(px0 + ((nx - px0) * s) / steps), Math.round(py0 + ((ny - py0) * s) / steps), 2, 2);
    px0 = nx;
    py0 = ny;
  }
}
function burst(g: G, c: string, x: number, y: number, k: number, r: number, seed: number, n = 9) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd(seed, i), d = r * k * (0.6 + rnd(seed, i + 20) * 0.5);
    px(g, c, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 - 6, 2, 2);
  }
}

/** The pixel shapes of one effect. Returns false once it has finished and can be dropped. */
function drawCore(g: G, f: Fx, now: number, posOf: PosOf): boolean {
  const t = now - f.t0;
  if (t < 0) return true;
  if (t >= f.ms && !f.firedAt) return false;
  const { c, v } = f.def.fx, k = t / f.ms, seed = f.t0 % 1000;
  const tp = f.tid ? posOf(f.tid) : null;
  const tx = tp ? tp.x : f.tx, ty = tp ? tp.y : f.ty;
  const sp = posOf(f.src) ?? { x: f.sx, y: f.sy };
  g.globalAlpha = 1;
  switch (f.def.fx.t) {
    case 'proj': {
      if (t < TRAVEL) {
        const q = t / TRAVEL, x = f.sx + (tx - f.sx) * q, y = f.sy - 12 + (ty - 10 - (f.sy - 12)) * q;
        const ang = Math.atan2(ty - f.sy, tx - f.sx), bx = Math.cos(ang), by = Math.sin(ang);
        if (v === 'arrow') {
          for (let i = 0; i < 8; i++) px(g, i > 5 ? c : '#e9e3d0', x - bx * i, y - by * i, 2, 1);
        } else if (v === 'ice') {
          for (let i = 0; i < 9; i++) px(g, i < 3 ? '#ffffff' : c, x - bx * i, y - by * i, i < 5 ? 3 : 2, i < 5 ? 3 : 2);
        } else {
          for (let i = 1; i < 6; i++) px(g, v === 'fire' ? (i % 2 ? '#ffd24a' : '#ff5a2a') : c, x - bx * i * 3 + (rnd(seed, i) - 0.5) * 4, y - by * i * 3 + (rnd(seed, i + 9) - 0.5) * 4, 2, 2);
          px(g, c, x - 2, y - 2, 5, 5);
          px(g, c, x - 3, y - 1, 7, 3);
          px(g, '#ffffff', x - 1, y - 1, 2, 2);
        }
      } else {
        const q = (t - TRAVEL) / (f.ms - TRAVEL);
        g.globalAlpha = 1 - q;
        if (v === 'fire') { burst(g, '#ffd24a', tx, ty, q, 26, seed, 10); burst(g, '#ff5a2a', tx, ty, q, 18, seed + 3, 8); ring(g, c, tx, ty, 6 + q * 20); }
        else if (v === 'water') { ring(g, c, tx, ty, 4 + q * 16); ring(g, '#d4f0ff', tx, ty, 2 + q * 10, 1); burst(g, '#d4f0ff', tx, ty, q, 14, seed, 6); }
        else if (v === 'ice') { for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3, d = 4 + q * 20; px(g, i % 2 ? '#ffffff' : c, tx + Math.cos(a) * d, ty - 8 + Math.sin(a) * d, 3, 3); } }
        else burst(g, c, tx, ty, q, 16, seed, 7);
      }
      break;
    }
    case 'ring': {
      const R = f.def.hit?.aoeSelf ?? f.def.radius ?? 60;
      g.globalAlpha = 1 - k * 0.8;
      if (v === 'fire') {
        ring(g, '#ff5a2a', f.sx, f.sy, R * k, 3); ring(g, '#ffd24a', f.sx, f.sy, R * k * 0.82, 2);
        burst(g, '#ffd24a', f.sx, f.sy + 6, k, R, seed, 16);
      } else if (v === 'spin') {
        for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 14; i++) { const a = k * 9 + arm * 2.094 - i * 0.09; px(g, i < 4 ? '#ffffff' : c, sp.x + Math.cos(a) * (R - 8), sp.y - 4 + Math.sin(a) * (R - 8) * 0.7, 3, 2); }
      } else if (v === 'cataclysm') {
        ring(g, c, f.sx, f.sy, R * k, 4); ring(g, '#ffffff', f.sx, f.sy, R * k * 0.9, 2); ring(g, '#7a3ad0', f.sx, f.sy, R * k * 0.6, 3);
        burst(g, '#ffd0ff', f.sx, f.sy + 6, k, R, seed, 24);
      } else { ring(g, c, sp.x, sp.y, R * k, 2); ring(g, c, sp.x, sp.y, R * k * 0.7, 1); }
      break;
    }
    case 'bolt': {
      const flick = Math.floor(t / 60);
      if (v === 'holy') {
        g.globalAlpha = 1 - k;
        px(g, c, tx - 3, ty - 130, 6, 124); px(g, '#ffffff', tx - 1, ty - 130, 2, 124); ring(g, c, tx, ty, 6 + k * 14);
      } else {
        if (flick % 2 === 0) { zigzag(g, c, tx + (rnd(seed, 1) - 0.5) * 30, ty - 140, tx, ty - 6, seed + flick, 9); zigzag(g, '#ffffff', tx + (rnd(seed, 1) - 0.5) * 30, ty - 140, tx, ty - 6, seed + flick, 9); }
        g.globalAlpha = 1 - k;
        ring(g, c, tx, ty, 5 + k * 18); burst(g, '#ffffff', tx, ty, k, 16, seed, 6);
      }
      break;
    }
    case 'chain': {
      if (Math.floor(t / 50) % 2 === 0 || t < 120) {
        let from = { x: sp.x, y: sp.y - 12 };
        for (const id of [f.tid, ...f.chain]) {
          const p = posOf(id);
          if (!p) continue;
          zigzag(g, c, from.x, from.y, p.x, p.y - 10, seed + id + Math.floor(t / 50), 7);
          px(g, '#ffffff', p.x - 2, p.y - 12, 4, 4);
          from = { x: p.x, y: p.y - 10 };
        }
      }
      break;
    }
    case 'meteor': {
      const fall = 280;
      if (t < fall) {
        const q = t / fall, x = f.tx + 70 * (1 - q), y = f.ty - 170 * (1 - q);
        for (let i = 1; i < 9; i++) px(g, i % 2 ? '#ffd24a' : '#ff5a2a', x + i * 4 + (rnd(seed, i) - 0.5) * 5, y - i * 9, 3, 3);
        px(g, '#5a3a2a', x - 5, y - 5, 11, 11); px(g, '#8a5a3a', x - 4, y - 6, 8, 5); px(g, '#ff8a3a', x - 6, y + 2, 13, 4);
      } else {
        const q = (t - fall) / (f.ms - fall);
        g.globalAlpha = 1 - q;
        ring(g, '#ff5a2a', f.tx, f.ty, 80 * q, 4); ring(g, '#ffd24a', f.tx, f.ty, 62 * q, 3); ring(g, '#ffffff', f.tx, f.ty, 30 * q, 2);
        burst(g, '#ffd24a', f.tx, f.ty + 6, q, 80, seed, 22); burst(g, '#5a3a2a', f.tx, f.ty + 6, q, 60, seed + 5, 10);
      }
      break;
    }
    case 'zone': {
      const R = f.def.field!.r, x = f.tx, y = f.ty;
      g.globalAlpha = Math.min(1, (1 - k) * 4, t / 200) * 0.9;
      if (v !== 'tornado') ring(g, c, x, y, R, 2, 0.8, 4);
      if (v === 'rain') {
        for (let i = 0; i < 26; i++) { const ph = (t / 420 + rnd(seed, i)) % 1, a = rnd(seed, i + 40) * 6.283, d = Math.sqrt(rnd(seed, i + 80)) * R; px(g, i % 3 ? c : '#d4f8ff', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 - 60 * (1 - ph), 1, 5); }
      } else if (v === 'tornado') {
        for (let arm = 0; arm < 4; arm++) for (let i = 0; i < 22; i++) { const h = i / 22, a = t / 90 + arm * 1.571 + h * 5; px(g, i % 4 ? c : '#ffffff', x + Math.cos(a) * (6 + h * R * 0.75), y + 6 - h * 70 + Math.sin(a) * 4, 2, 2); }
      } else if (v === 'sanctuary') {
        ring(g, '#ffffff', x, y, R * 0.6, 1, 0.8, 5);
        for (let i = 0; i < 4; i++) { const a = t / 900 + i * 1.571; px(g, c, x + Math.cos(a) * R * 0.6 - 1, y + Math.sin(a) * R * 0.48 - 1, 3, 3); }
        for (let i = 0; i < 12; i++) { const ph = (t / 900 + rnd(seed, i)) % 1, a = rnd(seed, i + 30) * 6.283, d = rnd(seed, i + 60) * R; px(g, '#fff8d0', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 - ph * 34, 2, 2); }
      } else if (v === 'quake') {
        const pulse = (t % 600) / 600;
        for (let i = 0; i < 7; i++) { const a = i * 0.897 + rnd(seed, i); zigzag(g, '#4a3420', x, y, x + Math.cos(a) * R * 0.95, y + Math.sin(a) * R * 0.76, seed + i, 5); }
        ring(g, '#d8c090', x, y, R * pulse, 2); burst(g, '#b89a68', x, y + 6, pulse, R, seed + Math.floor(t / 600), 12);
      } else if (v === 'volley') {
        for (let i = 0; i < 14; i++) { const ph = (t / 300 + rnd(seed, i)) % 1, a = rnd(seed, i + 40) * 6.283, d = Math.sqrt(rnd(seed, i + 80)) * R; const ax = x + Math.cos(a) * d, ay = y + Math.sin(a) * d * 0.8 - 70 * (1 - ph); px(g, c, ax, ay, 1, 8); px(g, '#8a8f98', ax - 1, ay + 7, 3, 2); }
      }
      break;
    }
    case 'trap': {
      if (f.firedAt) {
        const q = (now - f.firedAt) / 380;
        if (q >= 1) return false;
        g.globalAlpha = 1 - q;
        ring(g, c, f.tx, f.ty, 8 + q * (f.def.field!.hit?.aoe ?? 40), 3); burst(g, '#ffd24a', f.tx, f.ty + 6, q, f.def.field!.hit?.aoe ?? 36, seed, 12);
        break;
      }
      const x = Math.round(f.tx), y = Math.round(f.ty) + 6;
      px(g, '#3a2a1c', x - 6, y - 1, 12, 3); px(g, c, x - 5, y - 2, 10, 2);
      for (let i = -5; i < 5; i += 2) px(g, '#d5d9e0', x + i, y - 4, 1, 2);
      if (Math.floor(t / 500) % 2) px(g, '#ffffff', x - 1, y - 2, 2, 1);
      break;
    }
    case 'aura': {
      const p = tp ?? sp;
      g.globalAlpha = 1 - k;
      ring(g, c, p.x, p.y + 8, 10 + k * 6, 2, 0.45);
      for (let i = 0; i < 10; i++) {
        const a = rnd(seed, i) * 6.283, x = p.x + Math.cos(a) * 11, y = p.y + 8 - k * (26 + rnd(seed, i + 9) * 16);
        if (v === 'heal') { px(g, c, x - 2, y, 5, 1); px(g, c, x, y - 2, 1, 5); }
        else px(g, i % 3 ? c : '#ffffff', x, y, 2, 3);
      }
      break;
    }
    case 'slash': {
      const ang = Math.atan2(ty - f.sy, tx - f.sx);
      g.globalAlpha = 1 - k * 0.7;
      const arc = (cx: number, cy: number, r: number, spread: number, col: string) => {
        for (let i = 0; i <= 14; i++) { const a = ang - spread + (i / 14) * spread * 2 * Math.min(1, k * 2.4); px(g, i > 3 && i < 11 ? '#ffffff' : col, cx + Math.cos(a) * r, cy - 6 + Math.sin(a) * r, 3, 2); }
      };
      if (v === 'wind') for (let w = 0; w < 3; w++) arc(f.sx + Math.cos(ang) * (20 + k * 120 - w * 22), f.sy + Math.sin(ang) * (20 + k * 120 - w * 22), 14, 0.9, c);
      else if (v === 'wide') { arc(sp.x, sp.y, 30, 1.2, c); arc(sp.x, sp.y, 24, 1.2, c); }
      else if (v === 'double') { arc(sp.x, sp.y - 4, 22, 0.7, c); arc(sp.x, sp.y + 5, 22, 0.7, '#ffffff'); }
      else arc(sp.x, sp.y, 22, 0.8, c);
      break;
    }
    case 'shield': {
      const p = tp ?? sp;
      g.globalAlpha = Math.min(1, (1 - k) * 3);
      for (let i = 0; i < 5; i++) {
        const a = t / 160 + i * 1.257, x = p.x + Math.cos(a) * 15, y = p.y - 8 + Math.sin(a) * 6;
        px(g, c, x - 2, y - 2, 5, 5); px(g, '#ffffff', x - 2, y - 2, 2, 1); px(g, 'rgba(0,0,0,0.35)', x - 2, y + 2, 5, 1);
      }
      break;
    }
    case 'dash': {
      g.globalAlpha = (1 - k) * 0.8;
      for (let i = 0; i < 10; i++) { const q = i / 10, x = f.sx + (sp.x - f.sx) * q, y = f.sy + (sp.y - f.sy) * q; px(g, i % 2 ? c : '#ffffff', x - 3, y - 14, 6, 2); px(g, c, x - 2, y - 4, 4, 2); }
      break;
    }
    case 'smoke': {
      const R = v === 'big' ? 80 : 26;
      for (let i = 0; i < (v === 'big' ? 16 : 8); i++) {
        const a = rnd(seed, i) * 6.283, d = R * k * (0.3 + rnd(seed, i + 7) * 0.7), r = 5 + rnd(seed, i + 3) * 6 * (1 - k * 0.4);
        g.globalAlpha = (1 - k) * 0.7;
        g.fillStyle = i % 2 ? c : '#b8b2c4';
        const cx = Math.round(sp.x + Math.cos(a) * d), cy = Math.round(sp.y - 6 + Math.sin(a) * d * 0.7 - k * 10);
        for (let dy = -r; dy <= r; dy += 2) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(cx - w, cy + Math.round(dy), w * 2, 2); }
      }
      break;
    }
  }
  g.globalAlpha = 1;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Light, sparks and impact: a second layer drawn additively over the pixel shapes above.
// Everything is a pure function of the effect's age, so nothing has to be simulated or stored.
// ---------------------------------------------------------------------------------------------
/** Whole-screen reactions to heavy effects; the renderer applies and decays them every frame. */
export const screenFx = {
  shake: 0, flash: 0, flashColor: '#ffffff', /** camera centre in world units, set by the renderer */ cx: 0, cy: 0, reduced: false,
  /** Graphics settings (M16): share of particles drawn, soft glows on or off, screen shake on or off. */
  density: 1, glow: true, noShake: false,
};
const glows = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = glows.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!, grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grad;
  x.globalAlpha = 0.9;
  x.fillRect(0, 0, 64, 64);
  glows.set(color, c);
  return c;
}
/** A soft additive light. `sy` squashes it for light lying on the ground. */
function glow(g: G, color: string, x: number, y: number, r: number, alpha = 1, sy = 1) {
  if (!screenFx.glow) return;
  if (r <= 0 || alpha <= 0.01) return;
  g.globalAlpha = Math.min(1, alpha);
  g.drawImage(glowSprite(color), x - r, y - r * sy, r * 2, r * 2 * sy);
}
/** An expanding ring of light on the ground. */
function shock(g: G, color: string, x: number, y: number, r: number, alpha: number, width = 3) {
  if (r <= 0 || alpha <= 0.01) return;
  g.globalAlpha = Math.min(1, alpha);
  g.strokeStyle = color;
  g.lineWidth = Math.max(0.5, width);
  g.beginPath();
  g.ellipse(x, y, r, r * 0.78, 0, 0, 6.2832);
  g.stroke();
}
/** Sparks thrown outward from a point that arc and fall: `age` in ms since they were thrown. */
function sparks(g: G, colors: string[], x: number, y: number, age: number, life: number, n: number, speed: number, seed: number, gravity = 160, up = 0.5) {
  if (age < 0 || age >= life) return;
  const tt = age / 1000, fade = 1 - age / life;
  n = Math.max(1, Math.round(n * screenFx.density));
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * 6.2832, v = speed * (0.35 + rnd(seed, i + 31) * 0.65);
    const px0 = x + Math.cos(a) * v * tt, py0 = y + Math.sin(a) * v * tt * 0.7 - up * v * tt + gravity * tt * tt;
    const col = colors[i % colors.length], s = 1 + Math.round(rnd(seed, i + 77) * 2 * fade);
    g.globalAlpha = fade;
    g.fillStyle = col;
    g.fillRect(px0 - s / 2, py0 - s / 2, s, s);
    if (i % 3 === 0) glow(g, col, px0, py0, 5 * fade + 2, fade * 0.5);
  }
}
/** Motes that rise and drift: embers, healing light, frost. */
function motes(g: G, colors: string[], x: number, y: number, t: number, n: number, radius: number, height: number, seed: number, period = 900) {
  n = Math.max(1, Math.round(n * screenFx.density));
  for (let i = 0; i < n; i++) {
    const ph = (t / period + rnd(seed, i + 5)) % 1, a = rnd(seed, i + 50) * 6.2832, d = Math.sqrt(rnd(seed, i + 90)) * radius;
    const mx = x + Math.cos(a) * d + Math.sin(ph * 6.28 + i) * 3, my = y + Math.sin(a) * d * 0.7 - ph * height;
    const col = colors[i % colors.length];
    g.globalAlpha = Math.sin(ph * Math.PI);
    g.fillStyle = col;
    g.fillRect(mx - 1, my - 1, 2, 2);
    if (i % 2 === 0) glow(g, col, mx, my, 5, Math.sin(ph * Math.PI) * 0.45);
  }
}
/** A column of light rising from the ground. */
function pillar(g: G, color: string, x: number, y: number, w: number, h: number, alpha: number) {
  if (alpha <= 0.01) return;
  const grad = g.createLinearGradient(0, y - h, 0, y);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, '#ffffff');
  g.globalAlpha = Math.min(1, alpha) * 0.55;
  g.fillStyle = grad;
  g.fillRect(x - w / 2, y - h, w, h);
  glow(g, color, x, y, w * 1.3, alpha * 0.8, 0.45);
}
/** A glowing line (lightning cores, blade trails). */
function beam(g: G, color: string, x0: number, y0: number, x1: number, y1: number, width: number, alpha: number) {
  if (alpha <= 0.01) return;
  g.globalAlpha = Math.min(1, alpha) * 0.5;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineWidth = width * 2.4;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.globalAlpha = Math.min(1, alpha);
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1, width * 0.5);
  g.stroke();
}
/** Screen shake and flash, once per effect, scaled by how close the effect is to the camera. */
function impact(f: Fx, bit: number, x: number, y: number, shake: number, flash = 0, color = '#ffffff') {
  if ((f.fired ?? 0) & bit) return;
  f.fired = (f.fired ?? 0) | bit;
  if (screenFx.reduced) return;
  const near = Math.max(0, 1 - Math.hypot(x - screenFx.cx, y - screenFx.cy) / 620);
  if (!screenFx.noShake) screenFx.shake = Math.max(screenFx.shake, shake * near);
  if (flash * near > screenFx.flash) {
    screenFx.flash = flash * near;
    screenFx.flashColor = color;
  }
}
const FIRE = ['#ffd24a', '#ff8a3a', '#ff5a2a', '#ffffff'], ICE = ['#ffffff', '#c8f0ff', '#8fd0ff'], WATER = ['#d4f0ff', '#4fa8f0', '#9fd8ff'];
const palette = (c: string, v?: string) => (v === 'fire' ? FIRE : v === 'ice' ? ICE : v === 'water' || v === 'rain' ? WATER : [c, '#ffffff', c]);

/** Draws one effect: the pixel shapes, then light and particles over them. Returns false once it has finished. */
export function drawFx(g: G, f: Fx, now: number, posOf: PosOf): boolean {
  const alive = drawCore(g, f, now, posOf);
  const t = now - f.t0;
  if (!alive || t < 0) return alive;
  const { c, v } = f.def.fx, k = Math.min(1, t / f.ms), seed = f.t0 % 1000;
  const tp = f.tid ? posOf(f.tid) : null, tx = tp ? tp.x : f.tx, ty = tp ? tp.y : f.ty, sp = posOf(f.src) ?? { x: f.sx, y: f.sy };
  const cols = palette(c, v);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.imageSmoothingEnabled = true;
  switch (f.def.fx.t) {
    case 'proj': {
      if (t < TRAVEL) {
        const q = t / TRAVEL, x = f.sx + (tx - f.sx) * q, y = f.sy - 12 + (ty - 10 - (f.sy - 12)) * q, big = v === 'arrow' ? 7 : 16;
        glow(g, cols[0] === '#ffffff' ? c : cols[0], x, y, big, 0.9);
        for (let i = 1; i <= 5; i++) { // a fading trail back along the flight path
          const qq = Math.max(0, q - i * 0.07);
          glow(g, c, f.sx + (tx - f.sx) * qq, f.sy - 12 + (ty - 10 - (f.sy - 12)) * qq, big * (1 - i * 0.15), 0.45 - i * 0.07);
        }
        if (t < 90) glow(g, c, f.sx, f.sy - 12, 18 * (1 - t / 90), 0.7); // muzzle flash at the caster
      } else {
        const age = t - TRAVEL, q = Math.min(1, age / (f.ms - TRAVEL)), small = v === 'arrow';
        if (!small) impact(f, 1, tx, ty, v === 'fire' ? 3 : 1.5);
        glow(g, '#ffffff', tx, ty - 6, (small ? 12 : 34) * (1 - q), 1 - q);
        glow(g, c, tx, ty - 4, (small ? 16 : 46) * (0.5 + q * 0.5), (1 - q) * 0.8);
        if (!small) {
          shock(g, c, tx, ty, 8 + q * (v === 'fire' ? 48 : 34), (1 - q) * 0.9, 3 - q * 2);
          sparks(g, cols, tx, ty - 6, age, f.ms - TRAVEL, v === 'fire' ? 22 : 14, v === 'fire' ? 150 : 110, seed, v === 'water' ? 320 : 180, v === 'water' ? 0.9 : 0.5);
          if (v === 'fire') motes(g, FIRE, tx, ty, age, 8, 16, 34, seed, 500);
        }
      }
      break;
    }
    case 'ring': {
      const R = f.def.hit?.aoeSelf ?? f.def.radius ?? 60, fixed = v === 'fire' || v === 'cataclysm', x = fixed ? f.sx : sp.x, y = fixed ? f.sy : sp.y;
      impact(f, 1, x, y, v === 'cataclysm' ? 9 : v === 'fire' ? 4 : 1.5, v === 'cataclysm' ? 0.5 : 0, c);
      glow(g, c, x, y, R * (0.5 + k * 0.7), (1 - k) * 0.8, 0.8);
      glow(g, '#ffffff', x, y - 4, R * 0.5 * (1 - k), 1 - k);
      shock(g, c, x, y, R * k, (1 - k) * 0.95, 4);
      shock(g, '#ffffff', x, y, R * k * 0.86, (1 - k) * 0.6, 2);
      if (k > 0.25) shock(g, c, x, y, R * (k - 0.25) * 1.05, (1 - k) * 0.6, 2);
      if (fixed) {
        sparks(g, v === 'fire' ? FIRE : ['#ffd0ff', '#d07aff', '#ffffff'], x, y, t, f.ms, v === 'fire' ? 30 : 46, R * 2.2, seed, 120, 0.7);
        motes(g, v === 'fire' ? FIRE : ['#d07aff', '#ffffff'], x, y, t, 14, R * 0.8, 50, seed, 600);
        if (v === 'cataclysm') for (let i = 0; i < 6; i++) { const a = i * 1.047 + seed; pillar(g, c, x + Math.cos(a) * R * 0.6 * k, y + Math.sin(a) * R * 0.45 * k, 14, 120, 1 - k); }
      } else if (v === 'shout') {
        for (let i = 0; i < 12; i++) { const a = i * 0.5236, r0 = R * k * 0.4, r1 = R * k; beam(g, c, x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.78, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.78, 1.5, (1 - k) * 0.6); }
      } else if (v === 'spin') {
        for (let arm = 0; arm < 3; arm++) { const a = k * 9 + arm * 2.094; glow(g, c, sp.x + Math.cos(a) * (R - 8), sp.y - 4 + Math.sin(a) * (R - 8) * 0.7, 16, 0.8 * (1 - k * 0.5)); }
      }
      break;
    }
    case 'bolt': {
      const holy = v === 'holy';
      impact(f, 1, tx, ty, holy ? 1.5 : 5, holy ? 0.18 : 0.42, holy ? '#fff3b8' : '#e8f0ff');
      if (holy) {
        pillar(g, c, tx, ty, 22, 150, 1 - k);
        motes(g, ['#fff3b8', '#ffffff'], tx, ty, t, 10, 16, 60, seed, 500);
      } else {
        const top = { x: tx + (rnd(seed, 1) - 0.5) * 30, y: ty - 140 };
        if (t < 200) {
          beam(g, c, top.x, top.y, tx, ty - 6, 5, 1 - t / 200);
          for (let i = 0; i < 3; i++) { // side branches
            const m = 0.3 + rnd(seed, i + 4) * 0.5, bx = top.x + (tx - top.x) * m, by = top.y + (ty - top.y) * m;
            beam(g, c, bx, by, bx + (rnd(seed, i + 8) - 0.5) * 70, by + 20 + rnd(seed, i + 12) * 30, 2, 0.8 - t / 250);
          }
        }
        sparks(g, ['#ffffff', c, '#9fd0ff'], tx, ty - 6, t, f.ms, 18, 170, seed, 260, 0.6);
      }
      glow(g, '#ffffff', tx, ty - 4, 40 * (1 - k), 1 - k);
      glow(g, c, tx, ty, 60 * (0.4 + k * 0.6), (1 - k) * 0.8, 0.7);
      shock(g, c, tx, ty, 6 + k * 40, (1 - k) * 0.9, 3);
      break;
    }
    case 'chain': {
      impact(f, 1, tx, ty, 2.5, 0.2, '#fff6b0');
      let from = { x: sp.x, y: sp.y - 12 };
      for (const id of [f.tid, ...f.chain]) {
        const p = posOf(id);
        if (!p) continue;
        beam(g, c, from.x, from.y, p.x, p.y - 10, 3, (1 - k) * (Math.floor(t / 40) % 2 ? 0.7 : 1));
        glow(g, c, p.x, p.y - 10, 26 * (1 - k * 0.5), 1 - k);
        sparks(g, ['#ffffff', c], p.x, p.y - 10, t, f.ms, 8, 120, seed + id, 220, 0.4);
        from = { x: p.x, y: p.y - 10 };
      }
      break;
    }
    case 'meteor': {
      const fall = 280;
      if (t < fall) {
        const q = t / fall, x = f.tx + 70 * (1 - q), y = f.ty - 170 * (1 - q);
        // the shadow on the ground closes in as the rock falls
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.25 + q * 0.3;
        g.fillStyle = '#000000';
        g.beginPath();
        g.ellipse(f.tx, f.ty + 4, 60 - q * 30, (60 - q * 30) * 0.5, 0, 0, 6.2832);
        g.fill();
        g.globalCompositeOperation = 'lighter';
        glow(g, '#ff8a3a', x, y, 34, 1);
        glow(g, '#ffffff', x, y, 14, 1);
        for (let i = 1; i <= 7; i++) glow(g, i % 2 ? '#ff5a2a' : '#ffd24a', x + i * 6, y - i * 14, 22 - i * 2, 0.7 - i * 0.08);
      } else {
        const age = t - fall, q = Math.min(1, age / (f.ms - fall));
        impact(f, 1, f.tx, f.ty, 12, 0.6, '#ffd9a0');
        glow(g, '#ffffff', f.tx, f.ty - 8, 110 * Math.max(0, 1 - q * 2.5), Math.max(0, 1 - q * 2.5));
        glow(g, '#ff8a3a', f.tx, f.ty, 130 * (0.5 + q * 0.5), (1 - q) * 0.9, 0.8);
        shock(g, '#ffd24a', f.tx, f.ty, 10 + q * 105, (1 - q) * 0.95, 6 - q * 4);
        if (q > 0.15) shock(g, '#ff5a2a', f.tx, f.ty, (q - 0.15) * 120, (1 - q) * 0.7, 3);
        sparks(g, FIRE, f.tx, f.ty - 8, age, f.ms - fall, 44, 260, seed, 300, 1);
        sparks(g, ['#5a3a2a', '#8a5a3a'], f.tx, f.ty - 4, age, f.ms - fall, 14, 150, seed + 9, 420, 1.2); // rock
        for (let i = 0; i < 5; i++) pillar(g, '#ff8a3a', f.tx + (rnd(seed, i + 3) - 0.5) * 90, f.ty + (rnd(seed, i + 6) - 0.5) * 50, 10, 70 + rnd(seed, i) * 60, (1 - q) * 0.8);
        motes(g, FIRE, f.tx, f.ty, age, 18, 70, 70, seed, 700);
      }
      break;
    }
    case 'zone': {
      const R = f.def.field!.r, x = f.tx, y = f.ty, a = Math.min(1, (1 - k) * 4, t / 200), pulse = 0.75 + 0.25 * Math.sin(t / 140);
      const every = f.def.field!.everyMs ?? 1000, beat = (t % every) / every;
      glow(g, c, x, y, R * 1.15, a * 0.42 * pulse, 0.8);
      shock(g, c, x, y, R * beat, a * (1 - beat) * 0.7, 2); // each pulse of the zone is visible
      if (v === 'rain') {
        motes(g, WATER, x, y, t, 12, R * 0.9, 30, seed, 800);
        for (let i = 0; i < 8; i++) { const ph = (t / 300 + rnd(seed, i + 3)) % 1, an = rnd(seed, i + 60) * 6.28, d = Math.sqrt(rnd(seed, i + 70)) * R; shock(g, '#d4f8ff', x + Math.cos(an) * d, y + Math.sin(an) * d * 0.8, 1 + ph * 7, a * (1 - ph) * 0.8, 1); }
        pillar(g, '#6fd6e8', x, y, R * 0.9, 110, a * 0.35);
      } else if (v === 'tornado') {
        impact(f, 1, x, y, 2);
        for (let i = 0; i < 9; i++) { const h = i / 9, an = t / 90 + h * 5; glow(g, c, x + Math.cos(an) * (6 + h * R * 0.75), y + 6 - h * 76, 10 + h * 12, a * 0.5); }
        sparks(g, ['#ffffff', c, '#d8c090'], x, y, t % 700, 700, 14, R * 1.6, seed + Math.floor(t / 700), 40, 1.1);
      } else if (v === 'sanctuary') {
        pillar(g, c, x, y, R * 0.9, 130, a * 0.22);
        motes(g, ['#fff8d0', '#ffe89a', '#ffffff'], x, y, t, 16, R * 0.9, 60, seed, 1100);
      } else if (v === 'quake') {
        if (beat < 0.2) impact(f, 2 << Math.min(20, Math.floor(t / every)), x, y, 6);
        sparks(g, ['#d8c090', '#8a6a48', '#4a3420'], x, y, t % every, every, 22, R * 1.5, seed + Math.floor(t / every), 520, 1.4);
        glow(g, '#ffb347', x, y, R * 0.7 * (1 - beat), a * (1 - beat) * 0.6, 0.6);
      } else if (v === 'volley') {
        for (let i = 0; i < 8; i++) { const ph = (t / 300 + rnd(seed, i)) % 1, an = rnd(seed, i + 40) * 6.283, d = Math.sqrt(rnd(seed, i + 80)) * R; if (ph > 0.85) glow(g, '#ffffff', x + Math.cos(an) * d, y + Math.sin(an) * d * 0.8, 8, a); }
      }
      break;
    }
    case 'trap': {
      if (f.firedAt) {
        const age = now - f.firedAt, q = Math.min(1, age / 380), R = f.def.field!.hit?.aoe ?? 40;
        impact(f, 1, f.tx, f.ty, f.def.field!.hit ? 5 : 1.5);
        glow(g, '#ffffff', f.tx, f.ty, R * (1 - q), 1 - q);
        glow(g, c, f.tx, f.ty, R * 1.4, (1 - q) * 0.8, 0.8);
        shock(g, c, f.tx, f.ty, 6 + q * R, 1 - q, 3);
        sparks(g, [c, '#ffd24a', '#ffffff'], f.tx, f.ty - 4, age, 380, 20, 170, seed, 260, 0.8);
      } else glow(g, c, f.tx, f.ty + 5, 9, 0.25 + 0.2 * Math.sin(t / 250));
      break;
    }
    case 'aura': {
      const p = tp ?? sp, heal = v === 'heal';
      pillar(g, c, p.x, p.y + 8, heal ? 26 : 20, heal ? 90 : 70, (1 - k) * (heal ? 1 : 0.8));
      shock(g, c, p.x, p.y + 8, 8 + k * 22, (1 - k) * 0.9, 2);
      glow(g, c, p.x, p.y - 8, 30, (1 - k) * 0.6);
      motes(g, heal ? ['#7be08a', '#d8ffd8', '#ffffff'] : [c, '#ffffff'], p.x, p.y + 6, t, heal ? 14 : 10, 14, 54, seed, 600);
      for (let i = 0; i < 6; i++) { const a = t / 110 + i * 1.047, h = (k + i / 6) % 1; glow(g, i % 2 ? '#ffffff' : c, p.x + Math.cos(a) * 13, p.y + 8 - h * 44, 4, (1 - k) * 0.9); } // a rising spiral
      break;
    }
    case 'slash': {
      const ang = Math.atan2(ty - f.sy, tx - f.sx), sweep = Math.min(1, k * 2.4), fade = 1 - k;
      const crescent = (cx: number, cy: number, r: number, spread: number, col: string, w: number) => {
        g.lineCap = 'round';
        g.globalAlpha = fade * 0.55;
        g.strokeStyle = col;
        g.lineWidth = w * 2.2;
        g.beginPath();
        g.arc(cx, cy - 6, r, ang - spread, ang - spread + spread * 2 * sweep);
        g.stroke();
        g.globalAlpha = fade;
        g.strokeStyle = '#ffffff';
        g.lineWidth = w * 0.6;
        g.stroke();
        const tip = ang - spread + spread * 2 * sweep;
        glow(g, col, cx + Math.cos(tip) * r, cy - 6 + Math.sin(tip) * r, w * 3, fade); // the bright leading edge
      };
      if (v === 'wind') {
        for (let w = 0; w < 3; w++) { const d = 20 + k * 120 - w * 22; crescent(f.sx + Math.cos(ang) * d, f.sy + Math.sin(ang) * d, 15, 0.9, c, 3); }
        sparks(g, ['#ffffff', c], f.sx + Math.cos(ang) * (20 + k * 120), f.sy + Math.sin(ang) * (20 + k * 120) - 6, t, f.ms, 8, 60, seed, 0, 0);
      } else {
        const wide = v === 'wide', r = wide ? 32 : 24;
        crescent(sp.x, sp.y, r, wide ? 1.25 : 0.85, c, wide ? 5 : 4);
        if (v === 'double') crescent(sp.x, sp.y + 8, r - 2, 0.75, '#ffffff', 3);
        if (k > 0.3) sparks(g, ['#ffffff', c, '#ffd24a'], sp.x + Math.cos(ang) * r, sp.y - 6 + Math.sin(ang) * r, t - f.ms * 0.3, f.ms * 0.7, wide ? 12 : 7, 120, seed, 200, 0.4);
        if (wide) impact(f, 1, sp.x, sp.y, 2);
      }
      break;
    }
    case 'shield': {
      const p = tp ?? sp, a = Math.min(1, (1 - k) * 3), grow = Math.min(1, t / 160);
      g.globalAlpha = a * 0.22;
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(p.x, p.y - 8, 20 * grow, 24 * grow, 0, 0, 6.2832);
      g.fill();
      g.globalAlpha = a * 0.9;
      g.strokeStyle = c;
      g.lineWidth = 1.5;
      g.stroke();
      glow(g, c, p.x, p.y - 8, 34 * grow, a * 0.5);
      glow(g, '#ffffff', p.x - 7, p.y - 20, 7, a * (0.5 + 0.5 * Math.sin(t / 120))); // a glint moving over the dome
      if (t < 200) shock(g, '#ffffff', p.x, p.y + 6, 6 + (t / 200) * 26, 1 - t / 200, 2);
      break;
    }
    case 'dash': {
      const n = 7;
      for (let i = 0; i < n; i++) { const q = i / n, x = f.sx + (sp.x - f.sx) * q, y = f.sy + (sp.y - f.sy) * q; glow(g, c, x, y - 10, 7 + i, (1 - k) * (0.25 + q * 0.5)); }
      beam(g, c, f.sx, f.sy - 10, sp.x, sp.y - 10, 4, (1 - k) * 0.7);
      if (f.def.move === 'blink' || f.def.move === 'behind') { glow(g, '#ffffff', f.sx, f.sy - 10, 24 * (1 - k), 1 - k); shock(g, c, sp.x, sp.y + 4, 4 + k * 24, 1 - k, 2); }
      else if (f.def.move === 'toTarget') { impact(f, 1, sp.x, sp.y, 3); shock(g, c, sp.x, sp.y + 4, 4 + k * 34, 1 - k, 3); }
      break;
    }
    case 'smoke': {
      glow(g, '#ffffff', sp.x, sp.y - 8, 26 * Math.max(0, 1 - k * 4), Math.max(0, 1 - k * 4) * 0.7);
      break;
    }
  }
  g.restore();
  g.globalAlpha = 1;
  return true;
}

/** The spark of a blow landing: drawn where damage is dealt. Returns false when it has faded. */
export function drawHit(g: G, x: number, y: number, age: number, crit: boolean, color: string, seed: number): boolean {
  const life = crit ? 420 : 260;
  if (age >= life) return false;
  if (age < 0) return true;
  const q = age / life;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.imageSmoothingEnabled = true;
  glow(g, '#ffffff', x, y, (crit ? 26 : 13) * (1 - q), 1 - q);
  glow(g, color, x, y, (crit ? 34 : 18) * (0.5 + q * 0.5), (1 - q) * 0.7);
  if (crit) {
    shock(g, color, x, y + 6, 4 + q * 30, 1 - q, 2);
    for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.785, r = 6 + q * 24; beam(g, color, x + Math.cos(a) * 4, y + Math.sin(a) * 4, x + Math.cos(a) * r, y + Math.sin(a) * r, 2, 1 - q); } // a four-point star
  }
  sparks(g, ['#ffffff', color], x, y, age, life, crit ? 12 : 6, crit ? 150 : 100, seed, 240, 0.5);
  g.restore();
  g.globalAlpha = 1;
  return true;
}
