// Art-direction showcase (not shipped with the game): three scenes rendered with a revamped
// environment, palette, lighting and HUD around the game's own character, monster, pet and mount
// sprites. Draws at 640x360 and scales 2x to 1280x720 so the pixel art stays crisp.
import { defaultAppearance, ANIM_COL, FRAME_W, FRAME_H, type Appearance } from '../shared/src/appearance';
import { getCharSheet } from '../client/src/game/chars';
import { getMonsterSheet, M_COLS } from '../client/src/game/monsters';
import { mountSprite, petSprite, MOUNT_W, MOUNT_H, PET_W } from '../client/src/game/companions';
import { iconCanvas } from '../client/src/game/skillicons';
import type { Job } from '../shared/src/protocol';
import { emberFox, griffin, warhorse } from './creatures';

const LW = 640, LH = 360, S = 2;
type G = CanvasRenderingContext2D;
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const px = (g: G, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------------------------------------
// Sprites, with one shared treatment: a soft ground shadow, a rim of the scene's key light
// ---------------------------------------------------------------------------------------------
const tinted = new Map<string, HTMLCanvasElement>();
function tint(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, color: string): HTMLCanvasElement {
  const key = `${src.width}x${src.height}:${sx},${sy}:${color}:${(src as any).__id ??= Math.random()}`;
  let c = tinted.get(key);
  if (c) return c;
  c = mk(sw, sh);
  const g = c.getContext('2d')!;
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, sw, sh);
  tinted.set(key, c);
  return c;
}
interface Rim { color: string; dx: number; dy: number; a: number }
function sprite(g: G, src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, x: number, y: number, rim?: Rim, scale = 1) {
  const w = sw * scale, h = sh * scale;
  g.imageSmoothingEnabled = false;
  if (rim) {
    const t = tint(src, sx, sy, sw, sh, rim.color);
    g.globalAlpha = rim.a;
    g.drawImage(t, 0, 0, sw, sh, Math.round(x + rim.dx), Math.round(y + rim.dy), w, h);
    g.globalAlpha = 1;
  }
  g.drawImage(src, sx, sy, sw, sh, Math.round(x), Math.round(y), w, h);
}
function groundShadow(g: G, x: number, y: number, rx: number, ry: number, a = 0.35) {
  g.fillStyle = `rgba(20,12,30,${a})`;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, 7);
  g.fill();
}
const DIR = { down: 0, left: 1, right: 2, up: 3 };
/** A character from the game's own sheet: anim column + frame, facing, feet at (x, y). */
function hero(g: G, ap: Appearance, job: Job, anim: keyof typeof ANIM_COL, f: number, dir: number, x: number, y: number, rim?: Rim) {
  const sh = getCharSheet(ap, job);
  groundShadow(g, x, y - 1, 9, 3);
  sprite(g, sh, (ANIM_COL[anim] + f) * FRAME_W, dir * FRAME_H, FRAME_W, FRAME_H, x - FRAME_W / 2, y - FRAME_H + 4, rim);
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------
function grass(g: G, x0: number, y0: number, w: number, h: number, tones: string[], flowers: string[]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + Math.sin(y * 0.13 + x * 0.03) + rnd() * 0.9;
    px(g, tones[Math.max(0, Math.min(tones.length - 1, Math.floor((n + 2) / 4.2 * tones.length)))], x, y);
  }
  for (let i = 0; i < (w * h) / 60; i++) { // blades
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    px(g, tones[tones.length - 1], x, y, 1, 2); px(g, tones[0], x + 1, y + 1, 1, 1);
  }
  for (let i = 0; i < (w * h) / 900; i++) { const x = x0 + rnd() * w, y = y0 + rnd() * h, c = flowers[Math.floor(rnd() * flowers.length)]; px(g, c, x, y); px(g, c, x + 1, y + 1); px(g, '#fff6c8', x + 1, y); }
}
function cobbles(g: G, x0: number, y0: number, w: number, h: number, base: string, inside: (x: number, y: number) => boolean) {
  const grout = mix(base, '#1a1420', 0.65);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) px(g, grout, x, y);
  for (let cy = y0; cy < y0 + h; cy += 7) for (let cx = x0 + ((cy / 7) % 2) * 4; cx < x0 + w; cx += 9) {
    const sw = 7 + Math.floor(rnd() * 3), shh = 5 + Math.floor(rnd() * 2), ox = cx + rnd() * 2, oy = cy + rnd() * 1.5;
    if (!inside(ox + sw / 2, oy + shh / 2)) continue;
    const c = mix(base, rnd() < 0.5 ? '#f0e0c0' : '#6a5a70', rnd() * 0.25);
    for (let y = 0; y < shh; y++) for (let x = 0; x < sw; x++) {
      if ((x === 0 || x === sw - 1) && (y === 0 || y === shh - 1)) continue;
      const edge = y === 0 || x === 0 ? mix(c, '#fff4dc', 0.35) : y === shh - 1 || x === sw - 1 ? mix(c, '#20182a', 0.4) : c;
      if (inside(ox + x, oy + y)) px(g, edge, ox + x, oy + y);
    }
    if (rnd() < 0.15) px(g, mix(c, '#3a5a2a', 0.6), ox + 1, oy + shh - 1, 2, 1); // moss
  }
}
function tree(g: G, x: number, y: number, s: number, leaf: string[], trunk: string, rimC: string) {
  px(g, mix(trunk, '#000000', 0.3), x - 2, y - 14 * s, 5, 15 * s); px(g, trunk, x - 2, y - 14 * s, 3, 15 * s);
  const blobs: [number, number, number][] = [[0, -26, 13], [-10, -20, 9], [10, -20, 9], [-4, -34, 9], [6, -33, 8]];
  for (const [li, sh] of [[0, 2], [1, 0], [2, -1], [3, -3]] as const)
    for (const [bx, by, r] of blobs) {
      const rr = r * s - li * 1.6;
      if (rr <= 0) continue;
      g.fillStyle = leaf[li];
      g.beginPath(); g.arc(x + bx * s - li * 1.2, y + by * s - li * 1.4 + sh * 0, rr, 0, 7); g.fill();
    }
  // leaf clusters and a warm rim on the sunny side
  for (let i = 0; i < 26 * s; i++) { const a = rnd() * 7, r = rnd() * 14 * s; px(g, leaf[3 + (i % 2)], x + Math.cos(a) * r - 3, y - 26 * s + Math.sin(a) * r * 0.8, 2, 1); }
  g.globalAlpha = 0.55;
  for (const [bx, by, r] of blobs) { g.strokeStyle = rimC; g.lineWidth = 1; g.beginPath(); g.arc(x + bx * s, y + by * s, r * s - 0.5, Math.PI * 0.95, Math.PI * 1.55); g.stroke(); }
  g.globalAlpha = 1;
}
function house(g: G, x: number, y: number, w: number, h: number, wall: string, roof: string, lit: boolean) {
  const rh = Math.round(h * 0.55);
  // walls: plaster with timber frame
  for (let yy = y + rh; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(g, mix(wall, '#c8b090', ((xx * 7 + yy * 13) % 11) / 40), xx, yy);
  const beam = '#5a3a24';
  px(g, beam, x, y + rh, w, 2); px(g, beam, x, y + h - 2, w, 2);
  for (let xx = x; xx < x + w; xx += 14) px(g, beam, xx, y + rh, 2, h - rh);
  for (let xx = x + 2; xx < x + w - 10; xx += 28) { g.strokeStyle = beam; g.lineWidth = 2; g.beginPath(); g.moveTo(xx, y + h - 2); g.lineTo(xx + 12, y + rh + 2); g.stroke(); }
  // windows (warm when lit), a door
  for (let xx = x + 8; xx < x + w - 14; xx += 26) {
    px(g, '#2a1c18', xx, y + rh + 7, 10, 10);
    px(g, lit ? '#ffcf6a' : '#3a4a6a', xx + 1, y + rh + 8, 8, 8);
    if (lit) px(g, '#fff0b8', xx + 2, y + rh + 9, 3, 3);
    px(g, '#2a1c18', xx + 4, y + rh + 8, 1, 8); px(g, '#2a1c18', xx + 1, y + rh + 12, 8, 1);
    px(g, '#6a4a2a', xx - 1, y + rh + 17, 12, 2); px(g, '#d0547a', xx, y + rh + 16, 2, 1); px(g, '#f4d060', xx + 4, y + rh + 16, 2, 1); px(g, '#d0547a', xx + 8, y + rh + 16, 2, 1);
  }
  const dx = x + Math.round(w / 2) - 6;
  px(g, '#2a1c18', dx - 1, y + h - 19, 14, 17); px(g, '#6a4226', dx, y + h - 18, 12, 16); px(g, '#7e5232', dx + 1, y + h - 17, 4, 14); px(g, '#e8c060', dx + 9, y + h - 10, 1, 2);
  // roof: tiles in rows, light on the left slope
  for (let r = 0; r < rh; r++) {
    const inset = Math.round((rh - r) * 0.55), yy = y + r;
    for (let xx = x - 6 + inset; xx < x + w + 6 - inset; xx++) {
      const row = Math.floor(r / 4), t = ((xx + row * 3) % 6 === 0) || r % 4 === 3;
      const light = xx < x + w / 2 ? 0.12 : -0.18;
      px(g, mix(roof, light > 0 ? '#ffb070' : '#1a0c18', Math.abs(light) + (t ? 0.25 : 0)), xx, yy);
    }
  }
  px(g, mix(roof, '#ffd0a0', 0.35), x - 6 + Math.round(rh * 0.55), y, w + 12 - 2 * Math.round(rh * 0.55), 1);
  px(g, '#4a3a3a', x + w - 22, y - 10, 7, 14); px(g, '#6a5a5a', x + w - 22, y - 10, 2, 14); // chimney
}

// ---------------------------------------------------------------------------------------------
// Light and atmosphere (at final resolution)
// ---------------------------------------------------------------------------------------------
export function light(g: G, x: number, y: number, r: number, color: string, a: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace('A', String(a)));
  gr.addColorStop(1, color.replace('A', '0'));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
export function grade(c: HTMLCanvasElement, ops: { multiply?: string; screen?: string; vignette?: number; bloom?: number; lights?: [number, number, number, string, number][] }) {
  const g = c.getContext('2d')!, W = c.width, H = c.height;
  if (ops.bloom) { // bloom: a blurred, brightened copy laid over with screen
    const b = mk(W, H), bg = b.getContext('2d')!;
    bg.filter = 'blur(9px) brightness(0.85) contrast(2.2) saturate(1.2)';
    bg.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'screen'; g.globalAlpha = ops.bloom; g.drawImage(b, 0, 0); g.globalAlpha = 1;
  }
  if (ops.multiply) { g.globalCompositeOperation = 'multiply'; g.fillStyle = ops.multiply; g.fillRect(0, 0, W, H); }
  if (ops.lights) { g.globalCompositeOperation = 'lighter'; for (const [x, y, r, col, a] of ops.lights) light(g, x, y, r, col, a); }
  if (ops.screen) { g.globalCompositeOperation = 'screen'; g.fillStyle = ops.screen; g.fillRect(0, 0, W, H); }
  g.globalCompositeOperation = 'source-over';
  if (ops.vignette) { const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(8,4,16,${ops.vignette})`); g.fillStyle = v; g.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------------------------------------
// The HUD: one framed style for every scene
// ---------------------------------------------------------------------------------------------
export const UI = { gold: '#d9b45a', goldHi: '#fbe6a4', goldLo: '#7a5a24', ink: '#f2ead8', plate: 'rgba(16,14,24,0.86)', plate2: 'rgba(30,24,40,0.92)' };
export function frame(g: G, x: number, y: number, w: number, h: number, r = 8) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  g.fillStyle = UI.plate; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.restore();
  const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, UI.goldHi); gr.addColorStop(0.5, UI.gold); gr.addColorStop(1, UI.goldLo);
  g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, r); g.stroke();
  g.strokeStyle = 'rgba(255,240,200,0.12)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x + 5, y + 5, w - 10, h - 10, r - 3); g.stroke();
  for (const [cx, cy] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) { g.fillStyle = UI.goldHi; g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore(); }
}
export function bar(g: G, x: number, y: number, w: number, h: number, frac: number, c1: string, c2: string, label: string) {
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
  const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.beginPath(); g.roundRect(x + 1, y + 1, Math.max(h, (w - 2) * frac), h - 2, (h - 2) / 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.roundRect(x + 3, y + 2, Math.max(4, (w - 6) * frac), (h - 4) / 2.6, 3); g.fill();
  g.strokeStyle = UI.goldLo; g.lineWidth = 1; g.beginPath(); g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, h / 2); g.stroke();
  text(g, label, x + w / 2, y + h / 2 + 4, 11, UI.ink, 'center', 600);
}
export function text(g: G, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 500, font = '"Trebuchet MS", sans-serif') {
  g.font = `${weight} ${size}px ${font}`; g.textAlign = align;
  g.lineWidth = 3; g.strokeStyle = 'rgba(8,6,14,0.85)'; g.lineJoin = 'round'; g.strokeText(s, x, y);
  g.fillStyle = color; g.fillText(s, x, y);
}
export const SERIF = 'Georgia, "DejaVu Serif", serif';
export function portrait(g: G, x: number, y: number, ap: Appearance, job: Job, name: string, sub: string, hp: number, mp: number, res: [string, string], face?: HTMLCanvasElement) {
  frame(g, x, y, 300, 92, 12);
  // a round portrait, gold ring, the character's own sprite
  g.save(); g.beginPath(); g.arc(x + 46, y + 46, 34, 0, 7); g.clip();
  const bgr = g.createRadialGradient(x + 46, y + 36, 4, x + 46, y + 46, 36); bgr.addColorStop(0, '#4a3a6a'); bgr.addColorStop(1, '#141020'); g.fillStyle = bgr; g.fillRect(x + 10, y + 10, 72, 72);
  if (face) g.drawImage(face, x + 10, y + 10, 72, 72);
  else { g.imageSmoothingEnabled = false; g.drawImage(getCharSheet(ap, job), ANIM_COL.idle * FRAME_W, 0, FRAME_W, 36, x + 46 - 48, y + 14, 96, 72); }
  g.restore();
  const rg = g.createLinearGradient(x, y + 10, x, y + 82); rg.addColorStop(0, UI.goldHi); rg.addColorStop(1, UI.goldLo);
  g.strokeStyle = rg; g.lineWidth = 3; g.beginPath(); g.arc(x + 46, y + 46, 35, 0, 7); g.stroke();
  g.fillStyle = UI.plate2; g.beginPath(); g.arc(x + 74, y + 76, 13, 0, 7); g.fill(); g.strokeStyle = UI.gold; g.lineWidth = 2; g.stroke();
  text(g, '200', x + 74, y + 80, 11, UI.goldHi, 'center', 700);
  text(g, name, x + 92, y + 28, 17, UI.ink, 'left', 700, SERIF);
  text(g, sub, x + 92, y + 44, 11, '#b8b0c8', 'left', 500);
  bar(g, x + 92, y + 52, 196, 14, hp, '#ff6a5a', '#9a1a24', `${Math.round(hp * 15070).toLocaleString()} / 15,070`);
  bar(g, x + 92, y + 70, 196, 12, mp, res[0], res[1], `${Math.round(mp * 896)} / 896`);
}
export function hotbar(g: G, ids: string[], cx: number, y: number, ult = 1) {
  const n = ids.length + 1, sz = 46, gap = 6, w = n * (sz + gap) + 22, x = cx - w / 2;
  frame(g, x, y, w, sz + 22, 14);
  ids.forEach((id, i) => {
    const sx = x + 12 + i * (sz + gap), sy = y + 11;
    g.fillStyle = '#0c0a14'; g.beginPath(); g.roundRect(sx, sy, sz, sz, 6); g.fill();
    try { g.imageSmoothingEnabled = true; g.drawImage(iconCanvas(`skill/${id}`), sx + 3, sy + 3, sz - 6, sz - 6); } catch { /* */ }
    g.strokeStyle = UI.goldLo; g.lineWidth = 2; g.beginPath(); g.roundRect(sx, sy, sz, sz, 6); g.stroke();
    if (i === 2) { g.fillStyle = 'rgba(10,8,20,0.65)'; g.beginPath(); g.moveTo(sx + sz / 2, sy + sz / 2); g.arc(sx + sz / 2, sy + sz / 2, sz * 0.7, -Math.PI / 2, Math.PI * 0.6); g.fill(); text(g, '4', sx + sz / 2, sy + sz / 2 + 6, 16, UI.ink, 'center', 700); }
    text(g, String(i + 1), sx + sz - 6, sy + sz - 4, 11, UI.goldHi, 'right', 700);
  });
  // the ultimate: a larger gem slot, glowing when charged
  const ux = x + 12 + ids.length * (sz + gap), uy = y + 11;
  g.save(); g.shadowColor = '#ffd24a'; g.shadowBlur = ult >= 1 ? 18 : 0;
  g.fillStyle = '#1a1020'; g.beginPath(); g.roundRect(ux, uy, sz, sz, 10); g.fill(); g.restore();
  try { g.drawImage(iconCanvas('skill/ult_divine_judgment'), ux + 3, uy + 3, sz - 6, sz - 6); } catch { /* */ }
  g.strokeStyle = UI.goldHi; g.lineWidth = 2.5; g.beginPath(); g.roundRect(ux, uy, sz, sz, 10); g.stroke();
  text(g, '8', ux + sz - 6, uy + sz - 4, 11, UI.goldHi, 'right', 700);
}
export function minimap(g: G, x: number, y: number, r: number, colors: string[], label: string) {
  g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
  for (let yy = -r; yy < r; yy += 4) for (let xx = -r; xx < r; xx += 4) { g.fillStyle = colors[Math.abs(Math.floor(Math.sin(xx * 0.05) * 2 + Math.cos(yy * 0.06) * 2 + (xx * yy) % 3)) % colors.length]; g.fillRect(x + xx, y + yy, 4, 4); }
  g.fillStyle = '#ffe08a'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y + 5); g.lineTo(x - 5, y + 5); g.fill();
  g.restore();
  const rg = g.createLinearGradient(x - r, y - r, x + r, y + r); rg.addColorStop(0, UI.goldHi); rg.addColorStop(1, UI.goldLo);
  g.strokeStyle = rg; g.lineWidth = 5; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r - 3, 0, 7); g.stroke();
  for (const [a, l] of [[-Math.PI / 2, 'N'], [0, 'E'], [Math.PI / 2, 'S'], [Math.PI, 'W']] as const) text(g, l, x + Math.cos(a) * (r + 1), y + Math.sin(a) * (r + 1) + 4, 10, UI.goldHi, 'center', 700);
  frame(g, x - 80, y + r + 10, 160, 26, 8);
  text(g, label, x, y + r + 28, 12, UI.ink, 'center', 600, SERIF);
}
export function nameplate(g: G, x: number, y: number, name: string, color: string, title?: string, hp?: number) {
  if (title) text(g, `« ${title} »`, x, y - 16, 11, '#e8c56a', 'center', 600, SERIF);
  text(g, name, x, y, 13, color, 'center', 700);
  if (hp !== undefined) { g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x - 25, y + 5, 50, 6); g.fillStyle = hp > 0.5 ? '#5fd35a' : '#e8c23a'; g.fillRect(x - 24, y + 6, 48 * hp, 4); }
}
export function chat(g: G, lines: [string, string][]) {
  const x = 16, y = 720 - 16 - lines.length * 19 - 18, w = 360, h = lines.length * 19 + 18;
  g.fillStyle = 'rgba(12,10,20,0.62)'; g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill();
  g.strokeStyle = 'rgba(217,180,90,0.35)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 10); g.stroke();
  lines.forEach(([s, c], i) => text(g, s, x + 12, y + 22 + i * 19, 12, c, 'left', 500));
}
export function dock(g: G) {
  const icons = ['👤', '✦', '⚜', '🎒', '🐾', '📜', '🌿', '🏆', '🗺', '⚔', '⚙'];
  const sz = 34, w = icons.length * (sz + 4) + 14, x = 1280 - w - 16, y = 720 - sz - 30;
  frame(g, x, y, w, sz + 14, 10);
  icons.forEach((ic, i) => {
    const bx = x + 7 + i * (sz + 4);
    g.fillStyle = i === 0 ? 'rgba(217,180,90,0.25)' : 'rgba(255,255,255,0.05)'; g.beginPath(); g.roundRect(bx, y + 7, sz, sz, 7); g.fill();
    g.font = '17px serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(ic, bx + sz / 2, y + 7 + sz / 2 + 6);
  });
}

// ---------------------------------------------------------------------------------------------
// Scene 1: Eldoria at golden hour — riding through the market with an evolved pet
// ---------------------------------------------------------------------------------------------
export const KNIGHT: Appearance = { ...defaultAppearance('knight'), armor: 3, armorColor: 6, helmet: 3, helmetColor: 6, cape: 2, capeColor: 1, aura: 0 };
export const MAGE: Appearance = { ...defaultAppearance('mage'), body: 1, clothing: 3, color1: 3, color2: 5, helmet: 2, helmetColor: 3, cape: 1, capeColor: 3, hair: 5, hairColor: 8 };
export const CLERIC: Appearance = { ...defaultAppearance('cleric'), clothing: 3, color1: 7, color2: 4, cape: 1, capeColor: 7, hair: 4, hairColor: 3 };
export const RANGER: Appearance = { ...defaultAppearance('ranger'), body: 1, clothing: 2, color1: 2, color2: 8, helmet: 1, helmetColor: 8, hair: 6, hairColor: 5 };

function townScene(L: G) {
  seed = 11;
  grass(L, 0, 0, LW, LH, ['#3e6a2e', '#4f7f34', '#62923c', '#79a748', '#93bd58'], ['#e8d860', '#f0a0c0', '#ffffff', '#c890f0']);
  const plaza = (x: number, y: number) => ((x - 330) / 250) ** 2 + ((y - 245) / 112) ** 2 < 1 || (x > 300 && x < 362 && y > 120);
  cobbles(L, 60, 110, 560, 250, '#b4a690', plaza);
  // plaza edge: a worn soil rim
  for (let a = 0; a < 6.283; a += 0.004) { const x = 330 + Math.cos(a) * 251, y = 245 + Math.sin(a) * 113; px(L, '#7a6448', x, y, 2, 2); }
  house(L, 40, 26, 118, 96, '#e4d4b4', '#9a3a3a', true);
  house(L, 380, 18, 132, 104, '#ead8b8', '#3a5a8a', true);
  house(L, 532, 40, 100, 86, '#e0ccaa', '#6a4a8a', true);
  // banners on the houses
  for (const [bx, c] of [[92, '#b8403c'], [440, '#3f66b4'], [480, '#3f66b4']] as const) { px(L, '#5a3a24', bx, 70, 1, 4); px(L, c, bx - 4, 74, 9, 16); px(L, mix(c, '#000', 0.3), bx + 2, 74, 3, 16); px(L, '#e8c060', bx - 1, 79, 3, 3); for (let i = 0; i < 4; i++) px(L, c, bx - 4 + i * 3, 90, 2, 2); }
  // the fountain
  const fx = 330, fy = 235;
  L.fillStyle = '#6e6478'; L.beginPath(); L.ellipse(fx, fy + 4, 46, 20, 0, 0, 7); L.fill();
  L.fillStyle = '#a49ab0'; L.beginPath(); L.ellipse(fx, fy, 46, 20, 0, 0, 7); L.fill();
  L.fillStyle = '#c8bed0'; L.beginPath(); L.ellipse(fx, fy - 1, 44, 18, 0, Math.PI, 7); L.fill();
  L.fillStyle = '#2e6a9a'; L.beginPath(); L.ellipse(fx, fy, 39, 15, 0, 0, 7); L.fill();
  L.fillStyle = '#4c9ac8'; L.beginPath(); L.ellipse(fx - 4, fy - 2, 30, 10, 0, 0, 7); L.fill();
  for (let i = 0; i < 40; i++) { const a = rnd() * 7, r = rnd() * 32; px(L, rnd() < 0.5 ? '#bfe8ff' : '#7fc8f0', fx + Math.cos(a) * r, fy + Math.sin(a) * r * 0.38, 2, 1); }
  px(L, '#8a8098', fx - 4, fy - 30, 8, 30); px(L, '#b8aec8', fx - 4, fy - 30, 3, 30); px(L, '#9a90a8', fx - 10, fy - 33, 20, 4); px(L, '#d0c8dc', fx - 10, fy - 33, 20, 1);
  for (let i = 0; i < 26; i++) { const t = i / 26, a = (i % 2 ? 1 : -1) * t * 18; px(L, '#d8f4ff', fx + a, fy - 34 - Math.sin(t * Math.PI) * 18 + t * 30, 1, 2); }
  // a market stall
  const sx = 456, sy = 170;
  px(L, '#5a3a24', sx, sy, 3, 40); px(L, '#5a3a24', sx + 56, sy, 3, 40);
  for (let i = 0; i < 8; i++) px(L, i % 2 ? '#f4ead8' : '#c8403c', sx - 4 + i * 8, sy - 6, 8, 12);
  for (let i = 0; i < 8; i++) px(L, mix(i % 2 ? '#f4ead8' : '#c8403c', '#000', 0.25), sx - 4 + i * 8, sy + 6, 8, 3);
  px(L, '#8a5a32', sx - 2, sy + 26, 64, 10); px(L, '#a87040', sx - 2, sy + 26, 64, 2);
  for (let i = 0; i < 9; i++) { const c = ['#e2523f', '#f4c040', '#7fc040', '#c890f0'][i % 4]; L.fillStyle = c; L.beginPath(); L.arc(sx + 4 + i * 6.5, sy + 24, 2.6, 0, 7); L.fill(); }
  px(L, '#6a4a2a', 120, 300, 14, 12); px(L, '#8a6238', 121, 301, 12, 3); px(L, '#6a4a2a', 136, 304, 10, 8); // crates
  // lantern posts
  for (const [lx, ly] of [[176, 190], [486, 268], [236, 312], [430, 150]] as const) { px(L, '#2a2430', lx, ly - 30, 2, 30); px(L, '#3a3440', lx - 3, ly - 36, 8, 7); px(L, '#ffe08a', lx - 2, ly - 35, 6, 5); px(L, '#fff6d0', lx, ly - 34, 2, 3); }
  // trees framing the scene
  tree(L, 18, 210, 1.2, ['#244a26', '#2f6230', '#3e7a36', '#5a9a40', '#7cb850'], '#5a3c26', '#ffd890');
  tree(L, 618, 250, 1.3, ['#244a26', '#2f6230', '#3e7a36', '#5a9a40', '#7cb850'], '#5a3c26', '#ffd890');
  tree(L, 600, 128, 1.0, ['#2a4a2a', '#346436', '#467e3c', '#62a046', '#88c058'], '#5a3c26', '#ffd890');
  // long shadows of the low sun (cast down and to the right)
  L.globalCompositeOperation = 'multiply';
  L.fillStyle = 'rgba(80,60,120,0.35)';
  for (const [x, y, w] of [[40, 122, 118], [380, 122, 132], [532, 126, 100]] as const) { L.beginPath(); L.moveTo(x, y); L.lineTo(x + w, y); L.lineTo(x + w + 40, y + 34); L.lineTo(x + 40, y + 34); L.fill(); }
  L.globalCompositeOperation = 'source-over';
  // NPCs
  const sun: Rim = { color: '#ffd9a0', dx: -1, dy: -1, a: 0.55 };
  hero(L, { ...defaultAppearance('ranger'), clothing: 2, color1: 4, color2: 8, helmet: 1, helmetColor: 4, hair: 2, hairColor: 2 }, 'ranger', 'idle', 0, DIR.down, 484, 214, sun);
  hero(L, { ...defaultAppearance('mage'), clothing: 3, color1: 5, color2: 10, helmet: 2, helmetColor: 5, cape: 2, capeColor: 5, hair: 6, hairColor: 8 }, 'mage', 'idle', 1, DIR.left, 400, 256, sun);
  hero(L, CLERIC, 'cleric', 'walk', 1, DIR.right, 150, 250, sun);
  hero(L, { ...RANGER }, 'ranger', 'walk', 2, DIR.left, 520, 320, sun);
  // the hero: riding the Plains Strider (at character scale), the Mythic Ember Kit beside
  const hx = 262, hy = 300, horse = warhorse(1);
  groundShadow(L, hx, hy, 32, 6, 0.4);
  const ksh = getCharSheet(KNIGHT, 'knight');
  sprite(L, horse, 0, 0, horse.width, horse.height, hx - 36, hy - 54, sun);
  sprite(L, ksh, ANIM_COL.idle * FRAME_W, DIR.right * FRAME_H, FRAME_W, FRAME_H, hx - FRAME_W / 2 - 3, hy - FRAME_H - 26, sun);
  sprite(L, horse, 0, 0, 72, 24, hx - 36, hy - 54, undefined); // the horse's head and neck in front of the rider's legs
  const fox = emberFox(0);
  groundShadow(L, 206, 312, 12, 3);
  sprite(L, fox, 0, 0, fox.width, fox.height, 206 - 20, 312 - 30, sun);
  return { hx, hy };
}
function townPost(F: G, c: HTMLCanvasElement, at: { hx: number; hy: number }) {
  // god rays and the low sun from the upper left
  F.save(); F.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i++) { const gr = F.createLinearGradient(0, 0, 900, 700); gr.addColorStop(0, 'rgba(255,214,150,0.08)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); F.fillStyle = gr; F.beginPath(); const o = i * 150 - 100; F.moveTo(o, 0); F.lineTo(o + 70, 0); F.lineTo(o + 520, 720); F.lineTo(o + 380, 720); F.fill(); }
  F.restore();
  grade(c, {
    bloom: 0.22, multiply: '#fff0e0', vignette: 0.5,
    lights: [[0, 0, 700, 'rgba(255,190,110,A)', 0.22], [352, 308, 70, 'rgba(255,200,110,A)', 0.55], [972, 470, 70, 'rgba(255,200,110,A)', 0.55], [472, 558, 70, 'rgba(255,200,110,A)', 0.5], [860, 230, 70, 'rgba(255,200,110,A)', 0.5],
      [406, 606, 40, 'rgba(255,170,80,A)', 0.45]],
  });
  // petals and golden dust in the air
  seed = 99;
  for (let i = 0; i < 70; i++) { const x = rnd() * 1280, y = rnd() * 720; F.fillStyle = rnd() < 0.5 ? 'rgba(255,190,210,0.9)' : 'rgba(255,236,170,0.8)'; F.save(); F.translate(x, y); F.rotate(rnd() * 3); F.fillRect(-2, -1, 4, 2); F.restore(); }
  nameplate(F, at.hx * 2, at.hy * 2 - 146, 'Seren  Lv.200', '#ffe08a', 'the Ascendant');
  nameplate(F, 968, 324, 'Quartermaster Bren', '#9fe0a0');
  nameplate(F, 800, 408, 'Waykeeper Ilse', '#9fe0a0');
  nameplate(F, 412, 556, 'Ember · Mythic', '#ffd27a');
  portrait(F, 16, 16, KNIGHT, 'knight', 'Seren', 'Aegis Lord · Paladin', 0.92, 0.8, ['#6fb4ff', '#1a3a8a']);
  minimap(F, 1190, 92, 70, ['#4f7f34', '#62923c', '#b4a690', '#9a3a3a', '#3e6a2e'], 'Eldoria · Market');
  hotbar(F, ['shield_bash', 'taunt', 'guard_stance', 'cleave', 'rallying_cry', 'last_stand'], 640, 632);
  chat(F, [['[Guild] Lyra: Raid at the Herald in 10!', '#a8f0b0'], ['Kael: anyone selling Armament Cores?', '#f2ead8'], ['A meteor shower strikes Frostveil!', '#7fe8ff']]);
  dock(F);
}

// ---------------------------------------------------------------------------------------------
// Scene 2: the Dragon's Lair — a party against Vharzul
// ---------------------------------------------------------------------------------------------
function bossScene(L: G) {
  seed = 23;
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) { const n = Math.sin(x * 0.09) * Math.cos(y * 0.11) + rnd() * 0.6; px(L, n > 0.5 ? '#3a2c34' : n > 0 ? '#2e2430' : '#251c28', x, y); }
  // basalt flagstones
  for (let y = 40; y < LH; y += 22) for (let x = (y / 22) % 2 ? -12 : 0; x < LW; x += 34) {
    const w = 32, h = 20;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { if (yy === 0 || xx === 0) px(L, '#4a3a44', x + xx, y + yy); else if (yy === h - 1 || xx === w - 1) px(L, '#16101a', x + xx, y + yy); }
    if (rnd() < 0.35) { // a glowing crack
      let cx = x + 6 + rnd() * 20, cy = y + 3;
      for (let i = 0; i < 14; i++) { px(L, i % 3 ? '#ff7a2a' : '#ffd060', cx, cy, 1, 1); cx += Math.round(rnd() * 2 - 1); cy += 1; }
    }
  }
  // the lava river along the top and a pool at the right
  for (let x = 0; x < LW; x++) { const t = 30 + Math.sin(x * 0.05) * 6 + Math.sin(x * 0.13) * 3; for (let y = 0; y < t; y++) px(L, y > t - 3 ? '#ffe08a' : (x + y * 3) % 17 < 3 ? '#ffb040' : y % 5 === 0 ? '#e2522a' : '#c83a1c', x, y); px(L, '#1a1014', x, t, 1, 3); }
  // rune pillars
  for (const [px0, h] of [[60, 120], [210, 100], [540, 130], [600, 90]] as const) {
    const y0 = 40;
    for (let y = 0; y < h; y++) { px(L, '#3a3040', px0, y0 + y, 18, 1); px(L, '#5a4a60', px0, y0 + y, 4, 1); px(L, '#1e1824', px0 + 14, y0 + y, 4, 1); }
    px(L, '#4a3e52', px0 - 3, y0 + h, 24, 6); px(L, '#6a5a72', px0 - 3, y0 + h, 24, 1);
    for (let i = 0; i < 4; i++) px(L, '#ff9a4a', px0 + 7, y0 + 18 + i * 22, 4, 6);
  }
  // crystals and bones
  for (const [cx, cy] of [[110, 320], [470, 330], [30, 260], [590, 300]] as const) { for (let i = 0; i < 4; i++) { const hh = 6 + i * 3; px(L, '#c86aff', cx + i * 4, cy - hh, 3, hh); px(L, '#f0c8ff', cx + i * 4, cy - hh, 1, hh); } }
  for (const [bx, by] of [[380, 330], [160, 120]] as const) { px(L, '#d8ccb8', bx, by, 12, 2); px(L, '#d8ccb8', bx + 2, by - 3, 2, 8); px(L, '#d8ccb8', bx + 9, by - 2, 2, 6); }
  // telegraphs: the breath cone and a meteor circle (runic rings)
  L.save(); L.globalAlpha = 0.14; L.fillStyle = '#ff5a2a'; L.beginPath(); L.moveTo(430, 250); L.arc(430, 250, 150, Math.PI * 0.9, Math.PI * 1.02); L.fill(); L.globalAlpha = 0.5; L.strokeStyle = '#ff7a4a'; L.lineWidth = 1; L.stroke(); L.restore();
  const ring = (x: number, y: number, r: number) => {
    L.save(); L.strokeStyle = '#ff5a3a'; L.lineWidth = 2; L.globalAlpha = 0.85; L.beginPath(); L.ellipse(x, y, r, r * 0.45, 0, 0, 7); L.stroke();
    L.globalAlpha = 0.5; L.beginPath(); L.ellipse(x, y, r - 5, (r - 5) * 0.45, 0, 0, 7); L.stroke();
    for (let i = 0; i < 12; i++) { const a = i * 0.5236; px(L, '#ffb080', x + Math.cos(a) * (r - 2.5), y + Math.sin(a) * (r - 2.5) * 0.45, 2, 2); }
    L.globalAlpha = 0.18; L.fillStyle = '#ff3a2a'; L.beginPath(); L.ellipse(x, y, r, r * 0.45, 0, 0, 7); L.fill(); L.restore();
  };
  ring(250, 300, 40);
  // the boss: the game's own Ancient Dragon sheet (facing left)
  const ds = getMonsterSheet('ancient_dragon'), out = ds.height / 2;
  groundShadow(L, 470, 300, 70, 14, 0.5);
  sprite(L, ds, 0, out, out, out, 470 - out / 2, 304 - out + 6, { color: '#ffd0a0', dx: -1, dy: -1, a: 0.7 });
  // the party
  const lava: Rim = { color: '#ffb070', dx: 1, dy: -1, a: 0.5 };
  hero(L, KNIGHT, 'knight', 'attack', 2, DIR.right, 352, 286, lava);
  hero(L, MAGE, 'mage', 'cast', 2, DIR.right, 214, 220, lava);
  hero(L, CLERIC, 'cleric', 'cast', 1, DIR.right, 196, 318, lava);
  hero(L, RANGER, 'ranger', 'attack', 1, DIR.right, 280, 186, lava);
  // healing circle under the cleric's target
  L.save(); L.strokeStyle = '#8affb0'; L.globalAlpha = 0.7; L.lineWidth = 1.5; L.beginPath(); L.ellipse(352, 286, 22, 8, 0, 0, 7); L.stroke(); L.restore();
  // a fireball in flight with its trail; arrows
  for (let i = 0; i < 18; i++) { const t = i / 18; L.fillStyle = `rgba(255,${150 + i * 5},60,${0.8 - t * 0.7})`; L.beginPath(); L.arc(330 - i * 6, 214 + i * 0.4, 6 - t * 4, 0, 7); L.fill(); }
  L.fillStyle = '#fff4c0'; L.beginPath(); L.arc(332, 214, 4, 0, 7); L.fill();
  for (const [ax, ay] of [[360, 196], [390, 200]] as const) { px(L, '#f4f0e2', ax, ay, 12, 1); px(L, '#c8a46a', ax - 2, ay - 1, 3, 3); }
  return {};
}
function bossPost(F: G, c: HTMLCanvasElement) {
  grade(c, {
    bloom: 0.3, multiply: '#a898b8', vignette: 0.65,
    lights: [[640, 20, 520, 'rgba(255,110,40,A)', 0.4], [664, 428, 50, 'rgba(255,190,90,A)', 0.7], [940, 470, 200, 'rgba(255,140,90,A)', 0.18], [500, 600, 70, 'rgba(255,60,40,A)', 0.3], [520, 460, 260, 'rgba(120,150,255,A)', 0.12],
      [704, 572, 60, 'rgba(120,255,170,A)', 0.4], [392, 636, 70, 'rgba(255,240,200,A)', 0.35], [120, 160, 60, 'rgba(255,150,60,A)', 0.5], [1080, 160, 60, 'rgba(255,150,60,A)', 0.5], [240, 640, 50, 'rgba(200,110,255,A)', 0.5], [940, 660, 50, 'rgba(200,110,255,A)', 0.5]],
  });
  seed = 5;
  for (let i = 0; i < 90; i++) { const x = rnd() * 1280, y = rnd() * 720, s = 1 + rnd() * 2.5; F.fillStyle = `rgba(255,${120 + rnd() * 120},60,${0.4 + rnd() * 0.6})`; F.fillRect(x, y, s, s * 2); }
  // the boss bar
  frame(F, 340, 14, 600, 74, 12);
  text(F, 'Vharzul, Ember of the First Dawn', 640, 42, 20, '#ffd9a0', 'center', 700, SERIF);
  text(F, 'Ancient Dragon · Lv.18 · Nightmare', 640, 58, 11, '#c8b8a8', 'center', 500);
  bar(F, 362, 64, 556, 16, 0.42, '#ff5a3a', '#7a0e14', '1,148,600 / 2,733,000');
  for (let i = 0; i < 3; i++) { F.fillStyle = i < 1 ? '#7a6a3a' : i === 1 ? '#ffd24a' : '#3a3324'; F.fillRect(560 + i * 56, 92, 46, 5); }
  text(F, 'Phase 2 · Skyfire', 640, 112, 12, '#ffe08a', 'center', 600);
  // party frames on the left
  const party: [string, string, Appearance, Job, number][] = [['Seren', 'Paladin', KNIGHT, 'knight', 0.71], ['Lyra', 'Archmage', MAGE, 'mage', 0.88], ['Ilse', 'Oracle', CLERIC, 'cleric', 0.95], ['Kael', 'Sniper', RANGER, 'ranger', 0.54]];
  party.forEach(([n, role, ap, job, hp], i) => {
    const y = 130 + i * 58;
    frame(F, 16, y, 220, 50, 10);
    F.save(); F.beginPath(); F.arc(42, y + 25, 18, 0, 7); F.clip(); F.fillStyle = '#241a30'; F.fillRect(20, y, 44, 50); F.imageSmoothingEnabled = false; F.drawImage(getCharSheet(ap, job), ANIM_COL.idle * FRAME_W, 0, FRAME_W, 30, 18, y + 4, 48, 30); F.restore();
    F.strokeStyle = UI.gold; F.lineWidth = 2; F.beginPath(); F.arc(42, y + 25, 18, 0, 7); F.stroke();
    text(F, `${n}`, 68, y + 20, 13, UI.ink, 'left', 700); text(F, role, 228, y + 20, 10, '#b8b0c8', 'right', 500);
    bar(F, 68, y + 27, 158, 11, hp, '#ff6a5a', '#9a1a24', '');
  });
  // combat text
  text(F, '48,210', 860, 300, 34, '#ffe08a', 'center', 800); text(F, 'CRITICAL', 860, 266, 14, '#ff9a4a', 'center', 800);
  text(F, '12,904', 780, 360, 22, '#ffffff', 'center', 800); text(F, '+3,820', 720, 520, 20, '#8affb0', 'center', 800);
  text(F, 'Combo: Shockwave Rally!', 704, 470, 15, '#7fe8ff', 'center', 700, SERIF);
  // a phase banner
  text(F, 'Vharzul takes wing — fire falls from above!', 640, 170, 22, '#ffe9c0', 'center', 700, SERIF);
  minimap(F, 1190, 92, 70, ['#2e2430', '#3a2c34', '#c83a1c', '#251c28'], "Dragon's Lair · Nightmare");
  hotbar(F, ['shield_bash', 'taunt', 'guard_stance', 'cleave', 'rallying_cry', 'last_stand'], 640, 632);
  dock(F);
}

// ---------------------------------------------------------------------------------------------
// Scene 3: dusk over the Dreadmoor lake — flying the Sky Griffin with a Star Mote
// ---------------------------------------------------------------------------------------------
function duskScene(L: G) {
  seed = 41;
  const horizon = 190;
  const sky = L.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#1a1840'); sky.addColorStop(0.45, '#4a2e6a'); sky.addColorStop(0.8, '#c8607a'); sky.addColorStop(1, '#ffb070');
  L.fillStyle = sky; L.fillRect(0, 0, LW, horizon);
  for (let i = 0; i < 90; i++) px(L, rnd() < 0.8 ? '#e8e0ff' : '#ffe8a0', rnd() * LW, rnd() * 110, 1, 1);
  L.fillStyle = '#fff4d8'; L.beginPath(); L.arc(520, 46, 13, 0, 7); L.fill(); L.fillStyle = '#4a2e6a'; L.beginPath(); L.arc(526, 42, 12, 0, 7); L.fill(); // a crescent moon
  // the setting sun
  const sg = L.createRadialGradient(170, horizon, 2, 170, horizon, 90); sg.addColorStop(0, '#fff2c0'); sg.addColorStop(0.2, '#ffc070'); sg.addColorStop(1, 'rgba(255,140,90,0)'); L.fillStyle = sg; L.fillRect(80, 100, 180, 90);
  // clouds lit from below
  for (const [cx, cy, w] of [[90, 80, 120], [330, 60, 160], [560, 100, 110], [250, 128, 90]] as const) for (let i = 0; i < 9; i++) { const x = cx + (i - 4) * w / 9, r = 6 + Math.sin(i * 1.3) * 3 + 4; L.fillStyle = '#7a4a7a'; L.beginPath(); L.arc(x, cy, r, 0, 7); L.fill(); L.fillStyle = '#e88a7a'; L.beginPath(); L.arc(x, cy + 3, r * 0.7, 0, Math.PI); L.fill(); }
  // mountain ridges, far to near
  const ridge = (base: number, amp: number, freq: number, color: string, ph: number) => { L.fillStyle = color; L.beginPath(); L.moveTo(0, horizon); for (let x = 0; x <= LW; x += 2) L.lineTo(x, base - Math.abs(Math.sin(x * freq + ph)) * amp - Math.sin(x * freq * 3.1) * amp * 0.25); L.lineTo(LW, horizon); L.fill(); };
  ridge(170, 50, 0.012, '#5a3a6a', 1); ridge(178, 34, 0.02, '#3e2a52', 2.4); ridge(186, 20, 0.035, '#2a1e3a', 0.7);
  // the treeline at the shore
  for (let x = 0; x < LW; x += 5) { const h = 8 + (Math.sin(x * 0.3) + 1) * 5 + rnd() * 4; L.fillStyle = '#160f22'; L.beginPath(); L.moveTo(x, horizon + 4); L.lineTo(x + 3, horizon - h); L.lineTo(x + 6, horizon + 4); L.fill(); }
  // the lake: the sky mirrored, broken into ripples
  const snap = L.getImageData(0, 0, LW, horizon + 4);
  const mirror = mk(LW, horizon + 4); mirror.getContext('2d')!.putImageData(snap, 0, 0);
  for (let y = 0; y < LH - horizon - 4; y++) {
    const sy = horizon + 2 - Math.floor(y * 1.15), off = Math.round(Math.sin(y * 0.6) * (1 + y * 0.03));
    if (sy < 0) break;
    L.globalAlpha = 0.78; L.drawImage(mirror, 0, sy, LW, 1, off, horizon + 4 + y, LW, 1);
  }
  L.globalAlpha = 1;
  L.fillStyle = 'rgba(20,16,50,0.35)'; L.fillRect(0, horizon + 4, LW, LH);
  for (let i = 0; i < 160; i++) { const x = rnd() * LW, y = horizon + 8 + rnd() * (LH - horizon); px(L, rnd() < 0.5 ? 'rgba(255,200,150,0.5)' : 'rgba(200,180,255,0.35)', x, y, 3 + rnd() * 6, 1); }
  // the near shore: reeds and a lantern dock
  for (let x = 0; x < 120; x += 3) { const h = 10 + rnd() * 18; px(L, '#1a2a1a', x, LH - h, 1, h); px(L, '#2a3a22', x + 1, LH - h - 2, 1, 3); }
  px(L, '#3a2a22', 520, 320, 120, 5); for (let i = 0; i < 5; i++) px(L, '#2a1c16', 524 + i * 26, 325, 3, 30);
  px(L, '#1a1418', 560, 292, 2, 28); px(L, '#ffd27a', 557, 286, 8, 7); px(L, '#fff4d0', 559, 288, 4, 3);
  // the hero on the Sky Griffin, the Star Mote beside, their reflection in the water
  const gx = 300, gy = 182, gr = griffin(1), ksh = getCharSheet(KNIGHT, 'knight');
  const dusk: Rim = { color: '#ffb47a', dx: -1, dy: 0, a: 0.45 };
  // reflection (flipped, faded)
  L.save(); L.globalAlpha = 0.28; L.translate(0, (horizon + 4) * 2 + 40); L.scale(1, -1);
  sprite(L, gr, 0, 0, gr.width, gr.height, gx - 52, gy - 70);
  sprite(L, ksh, ANIM_COL.idle * FRAME_W, DIR.right * FRAME_H, FRAME_W, FRAME_H, gx - FRAME_W / 2 - 8, gy - FRAME_H - 30);
  L.restore();
  sprite(L, ksh, ANIM_COL.idle * FRAME_W, DIR.right * FRAME_H, FRAME_W, FRAME_H, gx - FRAME_W / 2 - 8, gy - FRAME_H - 30, dusk);
  sprite(L, gr, 0, 0, gr.width, gr.height, gx - 52, gy - 70, dusk);
  sprite(L, ksh, ANIM_COL.idle * FRAME_W, DIR.right * FRAME_H, FRAME_W, 30, gx - FRAME_W / 2 - 8, gy - FRAME_H - 30, dusk); // the rider sits over the saddle, legs behind the wing
  const fox = emberFox(1);
  sprite(L, fox, 0, 0, fox.width, fox.height, 214, 166, dusk);
  // its shadow far below on the water
  L.fillStyle = 'rgba(10,6,24,0.35)'; L.beginPath(); L.ellipse(gx, 292, 30, 6, 0, 0, 7); L.fill();
  return { gx, gy };
}
function duskPost(F: G, c: HTMLCanvasElement, at: { gx: number; gy: number }) {
  grade(c, {
    bloom: 0.12, vignette: 0.6,
    lights: [[340, 380, 420, 'rgba(255,150,90,A)', 0.16], [1120, 578, 70, 'rgba(255,210,120,A)', 0.7], [470, 362, 40, 'rgba(255,190,90,A)', 0.4], [1040, 92, 60, 'rgba(255,240,210,A)', 0.35]],
  });
  seed = 77;
  for (let i = 0; i < 60; i++) { const x = rnd() * 1280, y = 400 + rnd() * 320; F.save(); F.shadowColor = '#e8ff8a'; F.shadowBlur = 8; F.fillStyle = '#f4ffb0'; F.beginPath(); F.arc(x, y, 1.6, 0, 7); F.fill(); F.restore(); }
  for (let i = 0; i < 30; i++) { const x = 220 + rnd() * 140, y = 180 + rnd() * 120; F.fillStyle = `rgba(255,240,180,${0.3 + rnd() * 0.6})`; F.fillRect(x, y, 2, 2); }
  nameplate(F, at.gx * 2, at.gy * 2 - 170, 'Seren  Lv.200', '#ffe08a', 'the Ascendant');
  nameplate(F, 466, 324, 'Ember · Mythic', '#ffd27a');
  portrait(F, 16, 16, KNIGHT, 'knight', 'Seren', 'Aegis Lord · Paladin', 1, 1, ['#6fb4ff', '#1a3a8a']);
  // a region banner and the flight readout
  text(F, 'DREADMOOR', 640, 92, 30, '#f4e4c8', 'center', 700, SERIF);
  text(F, '— Lanternfen Lake · Dusk —', 640, 116, 14, '#e8c8a8', 'center', 500, SERIF);
  frame(F, 470, 600, 340, 70, 14);
  text(F, 'Sky Griffin', 500, 630, 16, UI.ink, 'left', 700, SERIF);
  text(F, 'Flying · ×1.70 speed · over water and forest', 500, 652, 11, '#c8bcd8', 'left', 500);
  bar(F, 690, 620, 104, 12, 0.8, '#7fe8ff', '#1a6a8a', 'Stamina');
  minimap(F, 1190, 92, 70, ['#2a1e3a', '#3e2a52', '#4a6a9a', '#160f22'], 'Dreadmoor · Lanternfen');
  dock(F);
}

// ---------------------------------------------------------------------------------------------
export async function render(which: number) {
  const low = mk(LW, LH), L = low.getContext('2d')!;
  L.imageSmoothingEnabled = false;
  const out = document.getElementById('out') as HTMLCanvasElement, F = out.getContext('2d')!;
  F.imageSmoothingEnabled = false;
  if (which === 1) {
    const at = townScene(L);
    F.drawImage(low, 0, 0, LW * S, LH * S);
    townPost(F, out, at);
  } else if (which === 2) {
    bossScene(L);
    F.drawImage(low, 0, 0, LW * S, LH * S);
    bossPost(F, out);
  } else {
    const at = duskScene(L);
    F.drawImage(low, 0, 0, LW * S, LH * S);
    duskPost(F, out, at);
  }
  (window as any).__done = true;
}
void M_COLS;
(window as any).__render = render;
