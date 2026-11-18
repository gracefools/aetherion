// 2.5D layer for skill effects: everything here has depth. Rune circles lie on the ground in
// perspective, light columns and rising rings stand up from it, projectiles fly in an arc above
// their shadow, debris is thrown up, falls back and bounces with its shadow under it, and a caster
// channelling a spell stands in a turning circle of runes. Drawn under the characters (ground) or
// over them (air); the classic effects in fx.ts still play on top.
import type { Fx } from './fx';
import { screenFx } from './fx';

type G = CanvasRenderingContext2D;
type PosOf = (id: number) => { x: number; y: number } | null;
/** Ground perspective: how much a circle on the ground is squashed. */
export const FLAT = 0.48;
const TAU = Math.PI * 2;
const rnd = (seed: number, i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
const ease = (q: number) => 1 - (1 - q) * (1 - q);

/** A magic circle lying on the ground: two rings, turning runes, an inner star and ticks. */
export function runeCircle(g: G, color: string, x: number, y: number, r: number, rot: number, alpha: number, kind = 0) {
  if (alpha <= 0.01 || r < 2) return;
  g.save();
  g.translate(x, y);
  g.scale(1, FLAT);
  g.globalAlpha = Math.min(1, alpha);
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = screenFx.glow ? 8 : 0;
  g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  g.lineWidth = 1;
  g.beginPath(); g.arc(0, 0, r * 0.84, 0, TAU); g.stroke();
  // runes between the rings, turning
  const n = Math.max(8, Math.round(r / 5));
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU, rx = Math.cos(a) * r * 0.92, ry = Math.sin(a) * r * 0.92;
    g.save(); g.translate(rx, ry); g.rotate(a + Math.PI / 2);
    const s = (i * 7 + kind) % 4;
    if (s === 0) g.fillRect(-2, -1, 4, 2); else if (s === 1) { g.fillRect(-1, -2, 2, 4); g.fillRect(-2, -1, 4, 1); } else if (s === 2) g.fillRect(-1, -1, 2, 2); else { g.fillRect(-2, -2, 1, 4); g.fillRect(1, -2, 1, 4); }
    g.restore();
  }
  // the inner figure, turning the other way: a star of 5, 6 or 8 points
  const pts = [6, 5, 8][kind % 3], ir = r * 0.72;
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = -rot * 1.4 + (i * (pts === 5 ? 2 : 1) / pts) * TAU, px = Math.cos(a) * ir, py = Math.sin(a) * ir;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  if (pts !== 5) { // a second polygon offset by half a step makes a star
    for (let i = 0; i <= pts; i++) { const a = -rot * 1.4 + ((i + 0.5) / pts) * TAU; const px = Math.cos(a) * ir, py = Math.sin(a) * ir; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
  }
  g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.3, 0, TAU); g.stroke();
  // a soft fill of light on the ground
  g.shadowBlur = 0;
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0, color + '55'); grd.addColorStop(0.7, color + '22'); grd.addColorStop(1, color + '00');
  g.globalAlpha = Math.min(1, alpha) * 0.9;
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.restore();
}

/** Rings that rise from the ground around a point: a cylinder of light. */
export function risingRings(g: G, color: string, x: number, y: number, r: number, h: number, t: number, alpha: number, n = 3, period = 700) {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    const ph = ((t / period) + i / n) % 1, rr = r * (1 - ph * 0.35);
    g.globalAlpha = alpha * Math.sin(ph * Math.PI);
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y - ph * h, rr, rr * FLAT, 0, 0, TAU); g.stroke();
  }
  // the column itself, brighter at its base
  const grd = g.createLinearGradient(0, y - h, 0, y);
  grd.addColorStop(0, color + '00'); grd.addColorStop(1, color + '44');
  g.globalAlpha = alpha * 0.35;
  g.fillStyle = grd;
  g.fillRect(x - r, y - h, r * 2, h);
  g.restore();
}

/** A shaft of light falling from the sky onto a point. */
export function skyShaft(g: G, color: string, x: number, y: number, w: number, alpha: number) {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const top = y - 360, grd = g.createLinearGradient(0, top, 0, y);
  grd.addColorStop(0, color + '00'); grd.addColorStop(0.75, color + '88'); grd.addColorStop(1, '#ffffffcc');
  g.globalAlpha = Math.min(1, alpha);
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(x - w * 0.35, top); g.lineTo(x + w * 0.35, top); g.lineTo(x + w / 2, y); g.lineTo(x - w / 2, y); g.closePath(); g.fill();
  g.globalAlpha = Math.min(1, alpha) * 0.9;
  g.fillStyle = '#ffffff';
  g.fillRect(x - w * 0.08, top + 40, w * 0.16, y - top - 40);
  g.restore();
}

/** Debris thrown up from an impact, falling and bouncing, each piece with its shadow. */
export function debris(g: G, colors: string[], x: number, y: number, age: number, life: number, n: number, speed: number, seed: number, size = 3) {
  if (age < 0 || age > life) return;
  n = Math.max(1, Math.round(n * screenFx.density));
  const tt = age / 1000, fade = Math.min(1, (life - age) / 200);
  g.save();
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * TAU, v = speed * (0.4 + rnd(seed, i + 9) * 0.6), up = 120 + rnd(seed, i + 19) * 160;
    const gx = x + Math.cos(a) * v * tt, gy = y + Math.sin(a) * v * tt * FLAT;
    let z = up * tt - 520 * tt * tt;
    if (z < 0) { // one bounce
      const t1 = up / 260, tb = tt - t1;
      z = Math.max(0, up * 0.35 * tb - 520 * tb * tb);
    }
    const s = Math.max(1, Math.round(size * (0.6 + rnd(seed, i + 29) * 0.8)));
    g.globalAlpha = 0.3 * fade; g.fillStyle = '#000000';
    g.beginPath(); g.ellipse(gx, gy, s, s * 0.5, 0, 0, TAU); g.fill();
    g.globalAlpha = fade; g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.round(gx - s / 2), Math.round(gy - z - s), s, s);
  }
  g.restore();
}

/** A tapered ribbon of light through a list of points (projectile trails, blade arcs). */
function ribbon(g: G, color: string, pts: [number, number][], width: number, alpha: number) {
  if (pts.length < 2 || alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const q = i / (pts.length - 1);
    g.globalAlpha = alpha * q;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, width * q);
    g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
  }
  g.globalAlpha = alpha;
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1, width * 0.3);
  g.beginPath(); g.moveTo(pts[pts.length - 2][0], pts[pts.length - 2][1]); g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); g.stroke();
  g.restore();
}
function shadow(g: G, x: number, y: number, r: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha; g.fillStyle = '#000000';
  g.beginPath(); g.ellipse(x, y, r, r * FLAT, 0, 0, TAU); g.fill();
  g.restore();
}

const TRAVEL = 170;
/** Ground layer: drawn under the characters for every live effect. */
export function drawFxGround(g: G, f: Fx, now: number, posOf: PosOf) {
  const t = now - f.t0;
  if (t < 0 || t > f.ms) return;
  const { c, v } = f.def.fx, k = Math.min(1, t / f.ms), seed = f.t0 % 1000, rot = now / 900;
  const tp = f.tid ? posOf(f.tid) : null, tx = tp ? tp.x : f.tx, ty = tp ? tp.y : f.ty, sp = posOf(f.src) ?? { x: f.sx, y: f.sy };
  const fadeIn = Math.min(1, t / 120), fadeOut = Math.min(1, (f.ms - t) / 220);
  switch (f.def.fx.t) {
    case 'proj': { // a circle at the caster's feet as it fires, and a burst circle where it lands
      if (t < 260) runeCircle(g, c, f.sx, f.sy + 8, 14 + t / 20, rot * 3, 1 - t / 260, 1);
      if (t > TRAVEL && v !== 'arrow') { const q = (t - TRAVEL) / (f.ms - TRAVEL); runeCircle(g, c, tx, ty + 6, 18 + ease(q) * 26, -rot * 2, (1 - q) * 0.9, 2); }
      break;
    }
    case 'ring': {
      const R = f.def.hit?.aoeSelf ?? f.def.radius ?? 60, fixed = v === 'fire' || v === 'cataclysm', x = fixed ? f.sx : sp.x, y = fixed ? f.sy : sp.y;
      runeCircle(g, c, x, y + 6, R * (0.55 + ease(k) * 0.5), rot * 2, (1 - k) * 1.1, v === 'cataclysm' ? 2 : 0);
      if (fixed) runeCircle(g, '#ffffff', x, y + 6, R * 0.35 * (1 - k * 0.3), -rot * 4, (1 - k) * 0.6, 1);
      break;
    }
    case 'bolt': // the strike is foretold by a circle that closes in
      runeCircle(g, c, tx, ty + 6, 34 - k * 14, rot * 5, (1 - k) * 1.1, v === 'holy' ? 1 : 2);
      break;
    case 'chain':
      for (const id of [f.tid, ...f.chain]) { const p = posOf(id); if (p) runeCircle(g, c, p.x, p.y + 6, 12 + k * 8, rot * 4, (1 - k), 2); }
      break;
    case 'meteor': { // a red warning circle while the rock falls, then a glowing crater
      const fall = 280;
      if (t < fall) runeCircle(g, '#ff5a2a', f.tx, f.ty + 4, 66 - (t / fall) * 18, rot * 6, 0.6 + (t / fall) * 0.5, 2);
      else { const q = (t - fall) / (f.ms - fall); runeCircle(g, '#ffb44a', f.tx, f.ty + 4, 48 + q * 30, -rot, (1 - q) * 0.9, 1); crater(g, f.tx, f.ty + 4, 40, 1 - q); }
      break;
    }
    case 'zone': {
      const R = f.def.field!.r;
      runeCircle(g, c, f.tx, f.ty, R * Math.min(1, t / 250), rot, fadeIn * fadeOut * 0.85, v === 'sanctuary' ? 1 : v === 'quake' ? 2 : 0);
      break;
    }
    case 'trap':
      if (!f.firedAt) runeCircle(g, c, f.tx, f.ty + 4, 13, rot * 2, 0.55 + 0.2 * Math.sin(t / 250), 1);
      break;
    case 'aura': case 'shield': {
      const p = tp ?? sp;
      runeCircle(g, c, p.x, p.y + 8, 22 + Math.min(1, t / 200) * 6, rot * 3, fadeIn * fadeOut, v === 'heal' ? 1 : 0);
      break;
    }
    case 'slash': { // a scorched arc on the ground for wide swings
      if (v === 'wide') { const ang = Math.atan2(ty - f.sy, tx - f.sx); g.save(); g.translate(sp.x, sp.y + 6); g.scale(1, FLAT); g.globalAlpha = (1 - k) * 0.5; g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 34, ang - 1.2, ang + 1.2); g.stroke(); g.restore(); }
      break;
    }
    case 'dash': { // a streak burned into the ground along the path
      g.save(); g.globalAlpha = (1 - k) * 0.5; g.strokeStyle = c; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(f.sx, f.sy + 8); g.lineTo(sp.x, sp.y + 8); g.stroke(); g.restore();
      break;
    }
    case 'smoke': break;
  }
  void seed;
}
function crater(g: G, x: number, y: number, r: number, a: number) {
  if (a <= 0.01) return;
  g.save();
  g.globalAlpha = a * 0.55; g.fillStyle = '#1a0e0a';
  g.beginPath(); g.ellipse(x, y, r, r * FLAT, 0, 0, TAU); g.fill();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { // glowing cracks
    const an = (i / 7) * TAU + 0.3, len = r * (0.7 + (i % 3) * 0.25);
    g.globalAlpha = a * 0.9; g.strokeStyle = i % 2 ? '#ff8a3a' : '#ffd24a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * len, y + Math.sin(an) * len * FLAT); g.stroke();
  }
  g.restore();
}

/** Air layer: drawn over the characters, under the classic glows. */
export function drawFxAir(g: G, f: Fx, now: number, posOf: PosOf) {
  const t = now - f.t0;
  if (t < 0 || t > f.ms) return;
  const { c, v } = f.def.fx, k = Math.min(1, t / f.ms), seed = f.t0 % 1000;
  const tp = f.tid ? posOf(f.tid) : null, tx = tp ? tp.x : f.tx, ty = tp ? tp.y : f.ty, sp = posOf(f.src) ?? { x: f.sx, y: f.sy };
  switch (f.def.fx.t) {
    case 'proj': {
      if (t < TRAVEL) { // an arc: height peaks mid-flight; a shadow runs below; a ribbon trails behind
        const H = v === 'arrow' ? 16 : 34, pos = (q: number) => [f.sx + (tx - f.sx) * q, f.sy + (ty - f.sy) * q - 12 - Math.sin(q * Math.PI) * H] as [number, number];
        const q = t / TRAVEL, gx = f.sx + (tx - f.sx) * q, gy = f.sy + (ty - f.sy) * q + 6;
        shadow(g, gx, gy, v === 'arrow' ? 3 : 6, 0.3);
        const pts: [number, number][] = [];
        for (let i = 8; i >= 0; i--) pts.push(pos(Math.max(0, q - i * 0.04)));
        ribbon(g, c, pts, v === 'arrow' ? 2 : 7, 0.9);
      } else if (v !== 'arrow') debris(g, v === 'fire' ? ['#ffd24a', '#ff8a3a', '#5a3a2a'] : [c, '#ffffff'], tx, ty + 4, t - TRAVEL, f.ms - TRAVEL, 10, 110, seed);
      break;
    }
    case 'ring': {
      const R = f.def.hit?.aoeSelf ?? f.def.radius ?? 60, fixed = v === 'fire' || v === 'cataclysm', x = fixed ? f.sx : sp.x, y = fixed ? f.sy : sp.y;
      risingRings(g, c, x, y + 6, R * 0.5, fixed ? 110 : 60, t, (1 - k) * 0.8, 3, 500);
      if (fixed) debris(g, v === 'fire' ? ['#ffd24a', '#ff8a3a', '#4a2a1a'] : ['#d07aff', '#ffffff', '#3a2a4a'], x, y + 4, t, f.ms, 18, R * 1.6, seed, 3);
      break;
    }
    case 'bolt':
      if (v === 'holy') skyShaft(g, '#fff3b8', tx, ty + 6, 30, (1 - k) * 1.1);
      else debris(g, ['#cfe8ff', '#ffffff', '#4a5a6a'], tx, ty + 4, t, f.ms, 10, 120, seed, 2);
      break;
    case 'meteor': {
      const fall = 280;
      if (t >= fall) debris(g, ['#5a3a2a', '#8a5a3a', '#ffb44a'], f.tx, f.ty + 4, t - fall, f.ms - fall, 26, 220, seed, 4);
      break;
    }
    case 'zone':
      if (v === 'sanctuary') risingRings(g, c, f.tx, f.ty, f.def.field!.r * 0.6, 120, t, Math.min(1, t / 250, (f.ms - t) / 250) * 0.6, 4, 1200);
      break;
    case 'aura': {
      const p = tp ?? sp;
      risingRings(g, c, p.x, p.y + 8, 16, 70, t, (1 - k) * 0.9, 3, 450);
      break;
    }
    case 'shield': { // a hex lattice over the dome
      const p = tp ?? sp, a = Math.min(1, (1 - k) * 3) * Math.min(1, t / 160);
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * 0.5; g.strokeStyle = c; g.lineWidth = 1;
      for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++) {
        const hx = p.x + col * 8 + (row & 1) * 4, hy = p.y - 8 + row * 7;
        if ((hx - p.x) ** 2 / 400 + (hy - p.y + 8) ** 2 / 576 > 0.9) continue;
        g.beginPath(); for (let i = 0; i <= 6; i++) { const an = (i / 6) * TAU; const px = hx + Math.cos(an) * 4, py = hy + Math.sin(an) * 3.5; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke();
      }
      g.restore();
      break;
    }
    case 'slash': { // the blade's arc tilted onto the ground plane, with afterimages
      const ang = Math.atan2(ty - f.sy, tx - f.sx), r = v === 'wide' ? 34 : 26, sweep = Math.min(1, k * 2.4);
      if (v === 'wind') break;
      const pts: [number, number][] = [];
      const spread = v === 'wide' ? 1.25 : 0.85;
      for (let i = 0; i <= 12; i++) { const a = ang - spread + spread * 2 * sweep * (i / 12); pts.push([sp.x + Math.cos(a) * r, sp.y - 10 + Math.sin(a) * r * FLAT * 1.4]); }
      ribbon(g, c, pts, 9, 1 - k);
      break;
    }
  }
}

/** A turning circle of runes under someone channelling a spell, with motes rising from it. */
export function drawCastCircle(g: G, x: number, y: number, color: string, now: number, seed: number) {
  const rot = now / 500;
  runeCircle(g, color, x, y + 8, 20, rot, 0.85, seed % 3);
  runeCircle(g, '#ffffff', x, y + 8, 11, -rot * 1.6, 0.5, (seed + 1) % 3);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const ph = (now / 900 + rnd(seed, i)) % 1, a = rnd(seed, i + 7) * TAU, d = 6 + rnd(seed, i + 3) * 14;
    g.globalAlpha = Math.sin(ph * Math.PI);
    g.fillStyle = i % 2 ? '#ffffff' : color;
    g.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + 8 + Math.sin(a) * d * FLAT - ph * 40), 2, 2);
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Monster attacks. `tier`: 0 ordinary, 1 elite, 2 dungeon boss, 3 world boss.
// ---------------------------------------------------------------------------------------------
export interface Blast { x: number; y: number; r: number; t0: number; tier: number; color: string; inner: number; kind: 'area' | 'claw' }
const TIER_RUNES = [0, 2, 1, 2];
/** The warning on the ground before a monster's area attack lands: a rune circle that fills and tightens. */
export function drawMonsterWarning(g: G, x: number, y: number, r: number, k: number, tier: number, color: string, inner: number, now: number) {
  const kk = Math.min(1, k), rot = now / (tier >= 2 ? 500 : 800), flash = k > 0.8 ? 0.5 + 0.5 * Math.sin(now / 40) : 1;
  g.save();
  g.translate(x, y); g.scale(1, 0.8);
  // the danger area fills from the centre (or the band, for ring attacks)
  g.fillStyle = color; g.globalAlpha = 0.12;
  g.beginPath(); g.arc(0, 0, r, 0, TAU); if (inner) g.arc(0, 0, inner, 0, TAU, true); g.fill();
  g.globalAlpha = 0.22 + 0.12 * kk;
  g.beginPath(); g.arc(0, 0, inner + (r - inner) * kk, 0, TAU); if (inner) g.arc(0, 0, inner, 0, TAU, true); g.fill();
  g.restore();
  // the circle of runes: bosses turn a second and third ring, and light converges as the attack nears
  const sy = 0.8 / FLAT;
  g.save(); g.scale(1, sy);
  runeCircle(g, color, x, y / sy, r, rot, (0.55 + 0.45 * kk) * flash, TIER_RUNES[tier]);
  if (tier >= 2) runeCircle(g, '#ffffff', x, y / sy, r * 0.62, -rot * 1.7, 0.35 + 0.3 * kk, 1);
  if (tier >= 3) runeCircle(g, color, x, y / sy, r * 1.12, rot * 0.6, 0.4 * kk, 0);
  g.restore();
  if (inner) { g.save(); g.strokeStyle = 'rgba(120,230,140,0.95)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, inner, inner * 0.8, 0, 0, TAU); g.stroke(); g.restore(); }
  if (tier >= 2 && screenFx.glow) { // light gathering toward the centre
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = color; g.lineWidth = 1.5;
    const n = tier >= 3 ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rot, ph = (now / 500 + i * 0.37) % 1, r0 = r * (1.25 - ph * 0.9), r1 = r0 - r * 0.16;
      g.globalAlpha = kk * Math.sin(ph * Math.PI) * 0.8;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.8 - ph * 16); g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.8 - ph * 22); g.stroke();
    }
    g.restore();
  }
}
/** How long a blast is drawn, by tier. */
export const blastMs = (b: Blast) => (b.kind === 'claw' ? 260 : [520, 700, 1000, 1400][b.tier]);
/** Shake and flash when a blast starts (once). */
export function blastImpact(b: Blast) {
  if (b.kind === 'claw' || screenFx.reduced) return;
  const near = Math.max(0, 1 - Math.hypot(b.x - screenFx.cx, b.y - screenFx.cy) / 700);
  if (!screenFx.noShake) screenFx.shake = Math.max(screenFx.shake, [1.5, 3, 8, 13][b.tier] * near);
  const fl = [0, 0, 0.3, 0.55][b.tier] * near;
  if (fl > screenFx.flash) { screenFx.flash = fl; screenFx.flashColor = b.color; }
}
/** Ground part of a blast: scorch, cracks and the shockwave rings. Returns false once it has faded. */
export function drawBlastGround(g: G, b: Blast, now: number): boolean {
  const ms = blastMs(b), t = now - b.t0;
  if (t > ms) return false;
  if (t < 0 || b.kind === 'claw') return true;
  const q = t / ms, rings = [1, 2, 3, 4][b.tier];
  g.save();
  g.globalAlpha = (1 - q) * 0.5; g.fillStyle = '#140a10'; // scorch
  g.beginPath(); g.ellipse(b.x, b.y, b.r * 0.9, b.r * 0.72, 0, 0, TAU); if (b.inner) g.ellipse(b.x, b.y, b.inner, b.inner * 0.8, 0, 0, TAU, true); g.fill();
  g.globalCompositeOperation = 'lighter';
  if (b.tier >= 1 && !b.inner) { // glowing cracks
    const n = 6 + b.tier * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(b.t0 % 997, i), len = b.r * (0.6 + rnd(b.t0 % 997, i + 20) * 0.5) * Math.min(1, q * 4);
      g.globalAlpha = (1 - q) * 0.9; g.strokeStyle = i % 2 ? b.color : '#ffffff'; g.lineWidth = 1 + b.tier * 0.4;
      g.beginPath(); g.moveTo(b.x, b.y);
      g.lineTo(b.x + Math.cos(a + 0.2) * len * 0.5, b.y + Math.sin(a + 0.2) * len * 0.4);
      g.lineTo(b.x + Math.cos(a) * len, b.y + Math.sin(a) * len * 0.8); g.stroke();
    }
  }
  for (let i = 0; i < rings; i++) { // shockwaves, one after another
    const qq = q * 1.6 - i * 0.22;
    if (qq <= 0 || qq >= 1) continue;
    const rr = b.r * (0.3 + qq * (1 + b.tier * 0.18));
    g.globalAlpha = (1 - qq) * 0.95; g.strokeStyle = i % 2 ? '#ffffff' : b.color; g.lineWidth = (4 + b.tier * 2) * (1 - qq) + 1;
    g.beginPath(); g.ellipse(b.x, b.y, rr, rr * 0.8, 0, 0, TAU); g.stroke();
  }
  g.restore();
  return true;
}
/** Air part of a blast: the flash, pillars of light, a rising column and debris. */
export function drawBlastAir(g: G, b: Blast, now: number) {
  const ms = blastMs(b), t = now - b.t0;
  if (t < 0 || t > ms) return;
  const q = t / ms, seed = b.t0 % 997;
  g.save();
  g.globalCompositeOperation = 'lighter';
  if (b.kind === 'claw') { // three slashes across the target
    for (let i = -1; i <= 1; i++) {
      const sw = Math.min(1, q * 2.5), x0 = b.x - 12 + i * 6, y0 = b.y - 26;
      g.globalAlpha = (1 - q) * 0.9; g.strokeStyle = b.color; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 22 * sw, y0 + 26 * sw); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke();
    }
    g.restore();
    return;
  }
  const R = b.r;
  const fq = Math.max(0, 1 - q * 3); // the first flash: a dome of light
  if (fq > 0 && !b.inner) {
    const grd = g.createRadialGradient(b.x, b.y - R * 0.15, 0, b.x, b.y - R * 0.15, R);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.35, b.color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = fq; g.fillStyle = grd;
    g.beginPath(); g.ellipse(b.x, b.y - R * 0.15, R, R * 0.85, 0, 0, TAU); g.fill();
  }
  const n = [0, 4, 8, 14][b.tier]; // pillars of light standing in the area
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * TAU, d = b.inner ? b.inner + (R - b.inner) * rnd(seed, i + 40) : Math.sqrt(rnd(seed, i + 40)) * R * 0.85;
    const px = b.x + Math.cos(a) * d, py = b.y + Math.sin(a) * d * 0.8, delay = rnd(seed, i + 80) * 0.35, qq = (q - delay) / (1 - delay);
    if (qq <= 0 || qq >= 1) continue;
    const h = (60 + b.tier * 34) * Math.sin((Math.min(1, qq * 2.2) * Math.PI) / 2), w = 5 + b.tier * 2.5;
    const grd = g.createLinearGradient(0, py - h, 0, py);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.6, b.color); grd.addColorStop(1, '#ffffff');
    g.globalAlpha = (1 - qq) * 0.85; g.fillStyle = grd;
    g.fillRect(px - w / 2, py - h, w, h);
  }
  if (b.tier >= 2 && !b.inner) { // the column over a boss's blow, with rings climbing it
    const h = b.tier === 3 ? 300 : 190, grd = g.createLinearGradient(0, b.y - h, 0, b.y);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.7, b.color); grd.addColorStop(1, '#ffffff');
    g.globalAlpha = Math.max(0, 1 - q * 1.6) * 0.75; g.fillStyle = grd;
    const w = R * (0.5 - q * 0.3);
    g.beginPath(); g.moveTo(b.x - w * 0.6, b.y - h); g.lineTo(b.x + w * 0.6, b.y - h); g.lineTo(b.x + w, b.y); g.lineTo(b.x - w, b.y); g.closePath(); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ph = (q * 2 + i / 4) % 1, rr = R * 0.45 * (1 - ph * 0.5);
      g.globalAlpha = (1 - q) * Math.sin(ph * Math.PI) * 0.8;
      g.beginPath(); g.ellipse(b.x, b.y - ph * h * 0.8, rr, rr * FLAT, 0, 0, TAU); g.stroke();
    }
  }
  if (b.tier === 3) { // a world boss: bolts strike the rim
    for (let i = 0; i < 6; i++) {
      const start = i * 0.12;
      if (q < start || q > start + 0.22) continue;
      const a = rnd(seed, i + 200) * TAU, bx = b.x + Math.cos(a) * R * 0.9, by = b.y + Math.sin(a) * R * 0.72;
      g.globalAlpha = 1 - (q - start) / 0.22; g.strokeStyle = '#ffffff'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(bx + (rnd(seed, i + 300) - 0.5) * 40, by - 260);
      for (let s = 1; s <= 6; s++) g.lineTo(bx + (rnd(seed, i * 7 + s) - 0.5) * 26 * (1 - s / 6), by - 260 + (260 * s) / 6);
      g.stroke(); g.strokeStyle = b.color; g.lineWidth = 6; g.globalAlpha *= 0.4; g.stroke();
    }
  }
  g.restore();
  debris(g, [b.color, '#3a2a2a', '#ffffff', '#6a5a4a'], b.x, b.y, t, ms, [6, 12, 24, 40][b.tier], R * (1.2 + b.tier * 0.25), seed, 2 + b.tier);
}
