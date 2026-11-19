// HD characters: chibi pixel art at 64x64 per frame with more animation frames than the classic
// sheets. Built from the same Appearance as the classic sprites. Every part is a shaded shape lit
// from the upper left (ramps lean cool in shadow and warm in light); a dark outline is added last.
// Rows: down, left, right, up (left is the mirror of right).
import type { Appearance } from '../../../shared/src/appearance';
import { appearanceKey } from '../../../shared/src/appearance';
import { JOB_DEFS } from '../../../shared/src/jobs';
import type { Job } from '../../../shared/src/protocol';
import { COLORS, EYE, HAIR, SKIN } from './chars';
import { ramp } from './hdart';

export type RGB = [number, number, number];
export const HD = 64;
export const HD_ANIMS = {
  // idle breathes over eight frames and blinks once; walking and running take eight steps a cycle
  idle: { frames: 8, ms: 210, loop: true },
  walk: { frames: 8, ms: 80, loop: true },
  run: { frames: 8, ms: 60, loop: true },
  attack: { frames: 5, ms: 72, loop: false },
  cast: { frames: 5, ms: 100, loop: false },
  hit: { frames: 2, ms: 110, loop: false },
  death: { frames: 5, ms: 150, loop: false },
} as const;
export type HdAnim = keyof typeof HD_ANIMS;
const NAMES = Object.keys(HD_ANIMS) as HdAnim[];
export const HD_COL = (() => { const o = {} as Record<HdAnim, number>; let c = 0; for (const a of NAMES) { o[a] = c; c += HD_ANIMS[a].frames; } return o; })();
export const HD_COLS = NAMES.reduce((n, a) => n + HD_ANIMS[a].frames, 0);
export const hdDuration = (a: HdAnim) => HD_ANIMS[a].frames * HD_ANIMS[a].ms;
export function hdFrame(a: HdAnim, t: number) {
  const d = HD_ANIMS[a], f = Math.floor(t / d.ms);
  return HD_COL[a] + (d.loop ? f % d.frames : Math.min(d.frames - 1, f));
}
/** The foot point inside a frame. */
export const HD_OX = 32, HD_FEET = 60;

// ------------------------------------------------------------------ pixel buffer and shaded shapes
const INK: RGB = [34, 22, 30];
export class Buf {
  d: Uint8ClampedArray;
  constructor(public W = HD, public H = HD) { this.d = new Uint8ClampedArray(W * H * 4); }
  px(x: number, y: number, c: RGB) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = (y * this.W + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
  has(x: number, y: number) { return x >= 0 && y >= 0 && x < this.W && y < this.H && this.d[(y * this.W + x) * 4 + 3] > 0; }
  /** A ball lit from the upper left. `clip` keeps only pixels it accepts. */
  ball(cx: number, cy: number, rx: number, ry: number, rp: RGB[], clip?: (x: number, y: number) => boolean, bias = 0) {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, q = nx * nx + ny * ny;
      if (q > 1 || (clip && !clip(x, y))) continue;
      const l = -0.55 * nx - 0.62 * ny + 0.55 * Math.sqrt(1 - q) + bias;
      this.px(x, y, tone(rp, l, x, y));
    }
  }
  /** A limb: a thick segment with cylinder shading across it. */
  limb(x0: number, y0: number, x1: number, y1: number, r: number, rp: RGB[]) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let y = Math.floor(Math.min(y0, y1) - r - 1); y <= Math.max(y0, y1) + r + 1; y++) for (let x = Math.floor(Math.min(x0, x1) - r - 1); x <= Math.max(x0, x1) + r + 1; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0, t = Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len)));
      const ex = px - t * dx, ey = py - t * dy, dist = Math.hypot(ex, ey);
      if (dist > r) continue;
      const side = (ex * nx + ey * ny) / r, l = -0.6 * side * Math.sign(nx || 1) * -1 + 0.25 - 0.5 * Math.abs(side) - (t - 0.5) * 0.1;
      this.px(x, y, tone(rp, l, x, y));
    }
  }
  /** A tapered body: rows from y0 to y1, half-width growing from w0 to w1, cylinder shading. */
  body(cx: number, y0: number, y1: number, w0: number, w1: number, rp: RGB[], round = 2) {
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0), w = w0 + (w1 - w0) * t, cut = y - y0 < round ? round - (y - y0) : y1 - y < 1 ? 1 : 0;
      for (let x = Math.ceil(cx - w + cut); x <= Math.floor(cx + w - cut); x++) {
        const nx = (x + 0.5 - cx) / w, l = -0.65 * nx + 0.35 - 0.35 * nx * nx - t * 0.15;
        this.px(x, y, tone(rp, l, x, y));
      }
    }
  }
  canvas(outline = true, ink: RGB = INK) {
    const W = this.W, H = this.H;
    if (outline) {
      const out = new Uint8ClampedArray(this.d);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (this.has(x, y)) continue;
        if (this.has(x + 1, y) || this.has(x - 1, y) || this.has(x, y + 1) || this.has(x, y - 1)) { const i = (y * W + x) * 4; out[i] = ink[0]; out[i + 1] = ink[1]; out[i + 2] = ink[2]; out[i + 3] = 255; }
      }
      this.d = out;
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d')!.putImageData(new ImageData(this.d as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
    return c;
  }
}
/** Light value to a ramp tone, with a checker dither at tone borders. */
export function tone(rp: RGB[], l: number, x: number, y: number): RGB {
  const f = (l + 0.55) / 1.45 * (rp.length - 1), k = Math.floor(f), fr = f - k;
  return rp[Math.max(0, Math.min(rp.length - 1, k + (fr > (((x + y) & 1) ? 0.62 : 0.38) ? 1 : 0)))];
}
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const metal = (h: string) => { const r = ramp(h, 0.95); r[0] = r[0].map((v) => v * 0.8) as RGB; r[4] = r[4].map((v) => Math.min(255, v + 30)) as RGB; return r; };

// ------------------------------------------------------------------ poses
interface Pose { bob: number; legA: number; legB: number; armA: number; armB: number; wep: number; lift: number; lean: number; glow: number; hit: boolean; dead: number; lunge: number }
function poseFor(a: HdAnim, f: number): Pose {
  const p: Pose = { bob: 0, legA: 0, legB: 0, armA: 0, armB: 0, wep: 0, lift: 0, lean: 0, glow: 0, hit: false, dead: 0, lunge: 0 };
  const cyc = (n: number) => Math.sin((f / n) * Math.PI * 2);
  if (a === 'idle') { p.bob = f >= 2 ? 1 : 0; p.armA = p.armB = f >= 2 ? 0.08 : 0; }
  if (a === 'walk' || a === 'run') {
    const k = a === 'run' ? 1.4 : 1, s = cyc(6);
    p.legA = s * k; p.legB = -s * k; p.armA = -s * 0.8 * k; p.armB = s * 0.8 * k;
    p.bob = Math.abs(Math.cos((f / 6) * Math.PI * 2)) > 0.6 ? 0 : -1;
    if (a === 'run') { p.lean = 1; p.bob -= 1; }
  }
  if (a === 'attack') { p.wep = [-1.3, -0.4, 0.7, 1.35, 0.9][f]; p.lunge = [0, 1, 2, 2, 1][f]; p.armA = [-0.9, -0.3, 0.6, 1, 0.6][f]; }
  if (a === 'cast') { p.lift = [0.3, 0.7, 1, 1, 0.6][f]; p.glow = [0.2, 0.5, 1, 0.8, 0.3][f]; p.bob = f === 2 || f === 3 ? -1 : 0; }
  if (a === 'hit') { p.hit = true; p.lean = -2; p.armA = p.armB = -0.4; }
  if (a === 'death') { p.dead = f / 4; p.hit = f === 0; }
  return p;
}

// ------------------------------------------------------------------ the look, decoded from Appearance
interface Look {
  skin: RGB[]; hair: RGB[]; eye: RGB; c1: RGB[]; c2: RGB[]; armor: RGB[] | null; armorKind: number; helm: RGB[]; helmKind: number;
  cape: RGB[] | null; capeLong: boolean; acc: number; accC: RGB[]; hairKind: number; eyes: number; face: number; fem: boolean;
  build: number; height: number; clothing: number; weapon: string;
}
function look(ap: Appearance, job: Job): Look {
  const w = JOB_DEFS[job].weapons[ap.weapon] ?? JOB_DEFS[job].weapons[0];
  return {
    skin: ramp(SKIN[ap.skin], 0.55), hair: ramp(HAIR[ap.hairColor], 0.95), eye: hex(EYE[ap.eyeColor]),
    c1: ramp(COLORS[ap.color1], 0.9), c2: ramp(COLORS[ap.color2], 0.9),
    armor: ap.armor ? (ap.armor === 1 ? ramp(COLORS[ap.armorColor], 0.8) : metal(COLORS[ap.armorColor])) : null, armorKind: ap.armor,
    helm: ap.helmet === 3 ? metal(COLORS[ap.helmetColor]) : ramp(COLORS[ap.helmetColor], 0.9), helmKind: ap.helmet,
    cape: ap.cape ? ramp(COLORS[ap.capeColor], 0.9) : null, capeLong: ap.cape === 2,
    acc: ap.accessory, accC: ramp(COLORS[ap.accessoryColor], 0.9), hairKind: ap.hair, eyes: ap.eyes, face: ap.face, fem: ap.body === 1,
    build: ap.build, height: ap.height, clothing: ap.clothing, weapon: w.kind,
  };
}

// ------------------------------------------------------------------ one frame
type Dir = 0 | 2 | 3; // down, right, up
function frame(L: Look, dir: Dir, p: Pose): HTMLCanvasElement {
  const b = new Buf(), cx = 32 + (dir === 2 ? p.lean + p.lunge : 0), side = dir === 2, back = dir === 3;
  const legLen = 7 + L.height, feet = HD_FEET, hip = feet - legLen, top = hip - 12 + p.bob, bw = 6 + (L.build - 1) * 0.8 - (L.fem ? 0.5 : 0);
  const hy = top - 9 + (p.hit ? 1 : 0), hx = cx + (side ? 1 : 0) + (p.hit && side ? -1 : 0); // head centre
  const shoulderY = top + 2, handY = hip - 1;
  const handA = side ? { x: cx + 2 + p.armA * 4 + p.lunge, y: handY - Math.abs(p.armA) * 2 - p.lift * 7 } : { x: cx - bw - 2 - (back ? -0 : 0), y: handY - p.lift * 8 + p.armA * 1.5 };
  const handB = side ? { x: cx - 2 + p.armB * 4, y: handY - Math.abs(p.armB) * 2 - p.lift * 5 } : { x: cx + bw + 2, y: handY - p.lift * 8 + p.armB * 1.5 };
  const sleeve = L.armor && L.armorKind >= 2 ? L.armor : L.c1;

  // --- behind everything: cape, long hair, the far arm and the weapon when seen from behind
  if (L.cape && !back) {
    const cl = L.capeLong ? hip + 6 : hip - 2;
    if (side) b.body(cx - 5, shoulderY, cl, 3, 6 + p.lean, L.cape, 1);
    else { b.body(cx - bw - 1, shoulderY + 1, cl, 1.5, 3, L.cape, 0); b.body(cx + bw + 1, shoulderY + 1, cl, 1.5, 3, L.cape, 0); }
  }
  if (!back && (L.hairKind === 1 || L.hairKind === 5)) {
    if (side) { if (L.hairKind === 5) b.limb(hx - 9, hy - 2, hx - 13, hy + 9, 3.2, L.hair); else b.body(hx - 4, hy - 2, hy + 13, 8, 7, L.hair, 3); }
    else if (L.hairKind === 1) b.body(hx, hy - 2, hy + 13, 11, 10, L.hair, 3);
  }
  if (back) weaponDraw(b, L, p, dir, handA, handB);
  if (side) { b.limb(cx - 1, shoulderY + 1, handB.x, handB.y, 2.2, shade(sleeve, -1)); b.ball(handB.x, handB.y + 1, 2.2, 2.2, shade(L.skin, -1)); if (L.weapon === 'sword_shield') shield(b, handB.x - 1, handB.y - 2, L, true); }

  // --- legs and boots
  const legC = shade(L.c2, -1), boot = ramp('#5a3a26', 0.8);
  const legs: [number, number][] = side ? [[cx - 1 + p.legB * 3, p.legB], [cx + 1 + p.legA * 3, p.legA]] : [[cx - 3, p.legA], [cx + 3, p.legB]];
  for (const [lx, sw] of legs) {
    const lift = side ? Math.max(0, -sw) * 2 : Math.max(0, sw) * 1.5;
    b.limb(lx, hip, lx + (side ? sw * 1.5 : 0), feet - 3 - lift, 2.3, legC);
    const plated = L.armorKind === 3 && L.armor;
    b.ball(lx + (side ? 1 + sw * 1.5 : 0), feet - 2 - lift, side ? 3.4 : 2.8, 2.2, plated ? L.armor! : boot);
    if (plated) { b.limb(lx + (side ? sw * 0.8 : 0), hip + 3, lx + (side ? sw * 1.5 : 0), feet - 4 - lift, 2.5, L.armor!); b.px(lx + (side ? sw * 1.2 : 0) - 1, hip + 3, [236, 196, 96]); b.px(lx + (side ? sw * 1.2 : 0), hip + 3, [236, 196, 96]); b.px(lx + (side ? sw * 1.2 : 0) + 1, hip + 3, [236, 196, 96]); }
    else { b.px(lx + (side ? sw * 1.5 : 0) - 1, feet - 4 - lift, boot[4]); b.px(lx + (side ? sw * 1.5 : 0), feet - 4 - lift, boot[4]); b.px(lx + (side ? sw * 1.5 : 0) + 1, feet - 4 - lift, boot[4]); }
  }
  // --- torso: tunic, robe or coat, belt, armour
  const robe = L.clothing === 1 || L.clothing === 3, hem = robe ? feet - 3 : hip + 3;
  b.body(cx, top, hem, side ? bw - 1.5 : bw - 0.5, (side ? bw - 0.5 : bw + 1.5) + (robe ? 1.5 : 0), L.c1, 3);
  if (!back) { // trim at the hem, a collar, a belt with a buckle
    for (let x = -bw - 2; x <= bw + 2; x++) if (b.has(cx + x, hem)) b.px(cx + x, hem, L.c2[3]);
    if (!side) { b.px(cx, top + 1, L.skin[2]); b.px(cx - 1, top, L.skin[2]); b.px(cx + 1, top, L.skin[2]); b.px(cx, top + 2, L.c1[0]); }
  }
  const beltY = hip - 1;
  for (let x = -bw - 1; x <= bw + 1; x++) if (b.has(cx + x, beltY)) { b.px(cx + x, beltY, [74, 46, 30]); b.px(cx + x, beltY + 1, [52, 32, 22]); }
  if (!back) { b.px(cx + (side ? 2 : 0), beltY, [232, 192, 90]); b.px(cx + (side ? 3 : 1), beltY, [255, 230, 150]); }
  if (L.armor) {
    const ar = L.armor;
    const gold: RGB = [236, 196, 96], goldD: RGB = [168, 120, 44];
    if (L.armorKind === 3) {
      // a breastplate: a bright ridge, a gold collar and waist band, an emblem, and tassets over the hips
      b.body(cx, top, beltY - 1, side ? bw - 1.5 : bw - 0.2, side ? bw - 1 : bw + 0.4, ar, 3);
      for (let x = -bw - 1; x <= bw + 1; x++) { if (b.has(cx + x, top + 1)) b.px(cx + x, top + 1, gold); if (b.has(cx + x, beltY - 2)) b.px(cx + x, beltY - 2, goldD); }
      if (!back) {
        for (let y = top + 2; y < beltY - 2; y++) b.px(cx + (side ? 2 : -2), y, ar[4]);
        if (!side) { b.px(cx, top + 4, gold); b.px(cx - 1, top + 5, gold); b.px(cx + 1, top + 5, gold); b.px(cx, top + 5, [255, 240, 180]); b.px(cx, top + 6, gold); }
      }
      for (const s of side ? [0] : [-1, 1]) { // tassets
        const tx = cx + s * (bw - 2) + (side ? 1 : 0);
        b.body(tx, beltY + 2, beltY + 5, 2.4, 2, ar, 1);
        b.px(tx - 1, beltY + 5, goldD); b.px(tx, beltY + 5, gold); b.px(tx + 1, beltY + 5, goldD);
      }
    } else if (L.armorKind === 2) {
      // chain: links over the tunic, a leather harness and a ragged hem
      for (let y = top; y < beltY + 3; y++) for (let x = -bw - 1; x <= bw + 1; x++) if (b.has(cx + x, y) && ((x + y) & 1)) b.px(cx + x, y, ar[(x < 0 ? 4 : 1)]);
      if (!back && !side) for (let k = 0; k < 8; k++) { b.px(cx - bw + 1 + k * 1.6, top + 1 + k * 1.1, [92, 58, 36]); b.px(cx - bw + 2 + k * 1.6, top + 1 + k * 1.1, [128, 84, 50]); }
    } else {
      // leather: a stitched jerkin with two straps and bright studs
      b.body(cx, top + 1, beltY - 1, side ? bw - 2 : bw - 1.5, side ? bw - 1.5 : bw - 1, ar, 2);
      if (!back && !side) {
        for (let y = top + 2; y < beltY - 1; y += 2) b.px(cx, y, ar[0]);
        for (const s of [-1, 1]) for (let y = top + 2; y < beltY - 1; y += 3) b.px(cx + s * 3, y, gold);
      }
    }
    if (!side) for (const s of [-1, 1]) {
      // pauldrons: two plates with a rim of light (gold on plate), a stud on leather
      const big = L.armorKind >= 2, sx = cx + s * (bw + 0.8);
      b.ball(sx, shoulderY, big ? 3.8 : 3.2, big ? 2.8 : 2.4, big ? ar : L.c1);
      if (L.armorKind === 3) { b.ball(sx + s * 1.2, shoulderY + 2.2, 3, 2, ar); for (let x = -3; x <= 3; x++) if (b.has(sx + x, shoulderY + 2)) b.px(sx + x, shoulderY + 2, gold); b.px(sx - s, shoulderY - 2, [255, 255, 255]); }
      else b.px(sx, shoulderY, gold);
    }
    else if (L.armorKind >= 2) { b.ball(cx - 1, shoulderY, 3.6, 2.8, ar); if (L.armorKind === 3) for (let x = -3; x <= 3; x++) if (b.has(cx - 1 + x, shoulderY + 2)) b.px(cx - 1 + x, shoulderY + 2, gold); }
  }
  // --- near arms
  if (!side) {
    b.limb(cx - bw + 0.5, shoulderY + 1, handA.x, handA.y, 2.2, sleeve); b.ball(handA.x, handA.y + 1, 2.3, 2.3, L.skin);
    b.limb(cx + bw - 0.5, shoulderY + 1, handB.x, handB.y, 2.2, sleeve); b.ball(handB.x, handB.y + 1, 2.3, 2.3, L.skin);
  }
  // --- accessories on the body
  if (L.acc === 4 && !back) { b.px(cx - (side ? -2 : 0), top + 3, [232, 192, 90]); b.px(cx - (side ? -2 : 0), top + 4, L.accC[3]); }

  // --- the head
  b.ball(hx, hy, 11, 10, L.skin, undefined, 0.05);
  if (!back) face(b, L, hx, hy, side, p);
  hair(b, L, hx, hy, dir);
  helmet(b, L, hx, hy, dir);
  if (L.acc === 1) { // a scarf
    b.body(cx, top - 1, top + 1, bw + 0.5, bw + 0.5, L.accC, 0);
    if (!back) b.limb(cx + (side ? -4 : 3), top + 1, cx + (side ? -8 : 5), top + 6, 1.5, L.accC); else b.limb(cx + 3, top, cx + 5, top + 8, 1.6, L.accC);
  }
  if (back && L.cape) {
    const hemY = L.capeLong ? hip + 6 : hip - 2;
    b.body(cx, shoulderY, hemY, bw + 0.5, bw + 2.5, L.cape, 1);
    for (let x = -bw - 3; x <= bw + 3; x++) if (b.has(cx + x, hemY - 1)) b.px(cx + x, hemY - 1, [236, 196, 96]);
    for (const [x, y] of [[0, 3], [-1, 4], [1, 4], [0, 5], [0, 4]]) b.px(cx + x, shoulderY + y + 1, x === 0 && y === 4 ? [255, 240, 180] : [236, 196, 96]);
    for (let y = shoulderY + 2; y < hemY - 1; y += 1) { b.px(cx - 3, y, L.cape[1]); b.px(cx + 3, y, L.cape[1]); } // folds
  }
  if (back && L.hairKind === 1) b.body(hx, hy + 2, hy + 13, 9, 8, L.hair, 2);
  if (back && L.hairKind === 5) b.limb(hx, hy - 4, hx + 1, hy + 10, 3, L.hair);

  // --- the weapon (and shield) in front
  if (side) { b.limb(cx + 1, shoulderY + 1, handA.x, handA.y, 2.2, sleeve); b.ball(handA.x, handA.y + 1, 2.3, 2.3, L.skin); }
  if (!back) weaponDraw(b, L, p, dir, handA, handB);
  if (!side && !back && L.weapon === 'sword_shield') shield(b, handB.x + 1, handB.y - 2, L, false);

  // --- cast glow, hit flash
  const c = b.canvas();
  const g = c.getContext('2d')!;
  if (p.glow > 0) {
    const gx = side ? handA.x + 2 : cx, gy = (side ? handA.y : Math.min(handA.y, handB.y)) - 4;
    for (const [r, a] of [[9, 0.18], [6, 0.35], [3, 0.8]] as const) { g.fillStyle = `rgba(150,220,255,${a * p.glow})`; g.beginPath(); g.arc(gx, gy, r * (0.6 + p.glow * 0.4), 0, 7); g.fill(); }
    g.fillStyle = `rgba(255,255,255,${p.glow})`; g.fillRect(gx - 1, gy - 1, 2, 2);
  }
  if (p.hit) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,240,240,0.45)'; g.fillRect(0, 0, HD, HD); g.globalCompositeOperation = 'source-over'; }
  if (p.dead > 0) {
    const t = document.createElement('canvas'); t.width = t.height = HD; const tg = t.getContext('2d')!;
    tg.imageSmoothingEnabled = false;
    tg.translate(32, 42 + p.dead * 14); tg.rotate(p.dead * Math.PI / 2 * (dir === 2 ? -1 : 1)); tg.translate(-32, -42);
    tg.globalAlpha = 1 - Math.max(0, p.dead - 0.75); tg.drawImage(c, 0, 0);
    return t;
  }
  return c;
}
const shade = (rp: RGB[], k: number): RGB[] => rp.map((_, i) => rp[Math.max(0, Math.min(rp.length - 1, i + k))]);

function face(b: Buf, L: Look, hx: number, hy: number, side: boolean, p: Pose) {
  const iris = L.eye, irisL: RGB = [Math.min(255, iris[0] + 70), Math.min(255, iris[1] + 70), Math.min(255, iris[2] + 70)], lash: RGB = [40, 24, 34];
  const eh = L.eyes === 1 ? 3 : L.eyes === 2 ? 6 : 5, ey = hy + 1;
  const eye = (x: number, w: number) => {
    if (L.eyes === 3 || p.hit || p.dead > 0.9) { for (let i = 0; i < w + 1; i++) b.px(x + i, ey + 2 + (i === 0 || i === w ? -1 : 0), lash); return; } // closed or wincing
    for (let i = -1; i <= w; i++) b.px(x + i, ey - 1, lash); // the upper lash
    if (L.fem) b.px(x + w + (x < hx ? -w - 2 : 1), ey - 2, lash);
    for (let j = 0; j < eh - 1; j++) for (let i = 0; i < w; i++) b.px(x + i, ey + j, j >= eh - 3 ? irisL : iris);
    b.px(x, ey, [255, 255, 255]); if (w > 2) b.px(x, ey + 1, [255, 255, 255]);
    b.px(x + w - 1, ey + eh - 3, [255, 255, 255]);
  };
  if (side) {
    eye(hx + 4, 2);
    b.px(hx + 4, ey - 3, shade(L.hair, -1)[1]); b.px(hx + 5, ey - 3, shade(L.hair, -1)[1]);
    b.px(hx + 10, hy + 3, L.skin[1]); // the nose
    b.px(hx + 8, hy + 6, [150, 70, 70]);
    if (L.face === 4 || L.fem) b.px(hx + 6, hy + 5, [240, 140, 140]);
  } else {
    eye(hx - 6, 3); eye(hx + 4, 3);
    for (const s of [-1, 1]) { b.px(hx + s * 5 - 1, ey - 3, shade(L.hair, -1)[1]); b.px(hx + s * 5, ey - 3, shade(L.hair, -1)[1]); }
    b.px(hx, hy + 5, L.skin[1]);
    b.px(hx, hy + 7, [150, 70, 70]); b.px(hx + 1, hy + 7, [150, 70, 70]);
    if (L.face === 4 || L.fem) { b.px(hx - 8, hy + 5, [240, 140, 140]); b.px(hx - 7, hy + 5, [240, 140, 140]); b.px(hx + 7, hy + 5, [240, 140, 140]); b.px(hx + 8, hy + 5, [240, 140, 140]); }
    if (L.face === 1) for (const [x, y] of [[-7, 4], [-5, 5], [6, 4], [8, 5]]) b.px(hx + x, hy + y, L.skin[0]);
    if (L.face === 2) for (let k = 0; k < 4; k++) b.px(hx + 5 + k, hy - 2 + k, [190, 90, 90]);
    if (L.face === 3) b.ball(hx, hy + 8, 6, 3, L.hair, (_x, y) => y >= hy + 6);
    if (L.acc === 2) for (const s of [-1, 1]) { for (let i = -3; i <= 3; i++) { b.px(hx + s * 5 + i, ey - 1, [40, 40, 50]); b.px(hx + s * 5 + i, ey + 4, [40, 40, 50]); } b.px(hx + s * 5 - 3, ey + 1, [40, 40, 50]); b.px(hx + s * 5 + 3, ey + 1, [40, 40, 50]); }
    if (L.acc === 3) b.px(hx - 11, hy + 3, [255, 220, 90]);
  }
}

function hair(b: Buf, L: Look, hx: number, hy: number, dir: Dir) {
  const k = L.hairKind, H = L.hair, side = dir === 2, back = dir === 3;
  if (k === 4) { b.px(hx - 4, hy - 7, L.skin[4]); b.px(hx - 3, hy - 7, L.skin[4]); return; } // bald: a shine
  const capped = L.helmKind === 3 || L.helmKind === 2 || L.helmKind === 5;
  // the cap of hair: everything above a fringe line; sides fall lower
  const fringe = k === 2 ? hy + 1 : k === 7 ? hy - 1 : hy - 3;
  const sideLow = k === 7 ? hy + 6 : k === 1 || k === 5 ? hy + 4 : hy + 1;
  b.ball(hx, hy - 2, 12, 10.5, H, (x, y) => {
    if (back) return y < hy + 7;
    const dx = x - hx;
    if (side) return dx < 2 ? y < hy + (k === 7 ? 6 : 4) : y < fringe + ((x >> 1) & 1) * 2 - 1;
    if (Math.abs(dx) > 8) return y < sideLow;
    return y < fringe + (((x + 1) >> 1) & 1) * 2; // a zig-zag fringe
  }, 0.08);
  if (!back && !capped) { // strand highlights
    for (let i = -6; i <= 4; i += 2) b.px(hx + i, hy - 9 + Math.abs(i) / 3, H[4]);
    b.px(hx - 3, hy - 7, H[4]); b.px(hx - 2, hy - 8, H[4]);
  }
  if (k === 6 && !capped) for (const [x, y, a] of [[-10, -6, -2.5], [-6, -10, -2.0], [0, -12, -1.57], [6, -10, -1.1], [10, -6, -0.65]]) { // spikes: short triangles
    for (let t = 0; t < 6; t++) { const w = 3 - t * 0.5; for (let s2 = -w; s2 <= w; s2 += 0.5) b.px(hx + x + Math.cos(a) * t - Math.sin(a) * s2, hy + y + Math.sin(a) * t + Math.cos(a) * s2, H[s2 < 0 ? 3 : t > 3 ? 2 : 1]); }
  }
  if (k === 3 && !capped) b.ball(hx + (side ? -3 : 0), hy - 12, 4.5, 4, H);
  if (k === 5 && side) b.ball(hx - 9, hy - 4, 3.5, 3.5, H);
}

function helmet(b: Buf, L: Look, hx: number, hy: number, dir: Dir) {
  const k = L.helmKind, M = L.helm, side = dir === 2, back = dir === 3;
  if (k === 0) return;
  if (k === 1) { b.ball(hx, hy - 5, 11.5, 7, M, (_x, y) => y < hy - 3); if (!back) b.rect(hx - (side ? -2 : 11), hy - 4, side ? 10 : 22, 2, M[1]); }
  if (k === 2) b.ball(hx, hy - 1, 13, 12, M, (x, y) => back || (side ? x < hx + 2 || y < hy - 4 : y < hy - 4 || Math.abs(x - hx) > 9), 0.05);
  if (k === 3) {
    b.ball(hx, hy - 2, 12.5, 11, M, (x, y) => back ? y < hy + 6 : side ? (x < hx + 3 ? y < hy + 5 : y < hy - 2) : (y < hy - 2 || Math.abs(x - hx) > 8 && y < hy + 5), 0.1);
    if (!back && !side) { b.rect(hx - 1, hy - 3, 2, 6, M[2]); b.px(hx - 1, hy - 3, M[4]); }
    for (let i = 0; i < 6; i++) b.ball(hx - (side ? 2 + i * 1.5 : 0), hy - 13 + i * (side ? 0.6 : 0), 2.4, 2.4, ramp('#c83a3a', 0.9)); // a plume
  }
  if (k === 4 && !back) { for (let x = -10; x <= 10; x++) b.px(hx + x, hy - 5 + Math.abs(x) / 5, [232, 192, 90]); b.ball(hx + (side ? 6 : 0), hy - 5, 1.6, 1.6, M); }
  if (k === 5) { // a pointed hat with a wide brim
    b.ball(hx, hy - 4, 16, 4.5, M, undefined, 0.1);
    for (let y = 0; y < 15; y++) { const w = 9 - y * 0.6; for (let x = -w; x <= w; x++) b.px(hx + x + y * 0.35 * (side ? -1 : 1), hy - 6 - y, M[x < -w / 3 ? 3 : x > w / 3 ? 1 : 2]); }
    for (let x = -9; x <= 9; x++) b.px(hx + x, hy - 6, [232, 192, 90]);
  }
}

function blade(b: Buf, x: number, y: number, a: number, len: number, w: number, rp: RGB[], hilt: RGB[]) {
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  for (let t = 0; t < len; t += 0.5) for (let s = -w / 2; s <= w / 2; s += 0.5) {
    const tip = t > len - w ? (len - t) / w : 1;
    if (Math.abs(s) > w / 2 * tip + 0.2) continue;
    b.px(x + dx * t + nx * s, y + dy * t + ny * s, rp[s < -0.3 ? 4 : s > 0.3 ? 1 : 3]);
  }
  if (w >= 3) for (let t = 2; t < len - w - 1; t += 1) b.px(x + dx * t, y + dy * t, rp[1]); // the fuller
  const g = Math.max(3, Math.round(w * 1.2));
  for (let s = -g; s <= g; s++) { b.px(x + nx * s, y + ny * s, hilt[s < 0 ? 4 : 2]); b.px(x + nx * s - dx, y + ny * s - dy, hilt[s < 0 ? 3 : 1]); }
  b.px(x + nx * g + dx, y + ny * g + dy, hilt[3]); b.px(x - nx * g + dx, y - ny * g + dy, hilt[3]); // the guard's wings turn up
  b.px(x, y, [120, 220, 255]); b.px(x - dx * 0.5 - nx * 0.5, y - dy * 0.5 - ny * 0.5, [255, 255, 255]); // a gem in the guard
  for (let t = -5; t < -1; t++) b.px(x + dx * t, y + dy * t, ramp('#6a4426', 0.8)[t & 1 ? 2 : 3]);
  b.px(x - dx * 6, y - dy * 6, hilt[4]); b.px(x - dx * 6 + nx, y - dy * 6 + ny, hilt[2]); // pommel
  b.px(x + dx * (len - 2) + nx * 0.6, y + dy * (len - 2) + ny * 0.6, [255, 255, 255]); // a glint near the tip
}
function shield(b: Buf, x: number, y: number, L: Look, far: boolean) {
  const rp = far ? shade(L.c1, -1) : L.c1;
  // a kite shield: a gold rim, a quartered field, a boss with a gem
  b.ball(x, y + 2, 6.5, 7.5, metal('#e8c060'), undefined, 0.05);
  b.ball(x, y + 2, 5.3, 6.3, rp, undefined, 0.1);
  for (let j = -5; j <= 7; j++) b.px(x, y + 2 + j * 0.9, [232, 192, 90]);
  for (let i = -4; i <= 4; i++) b.px(x + i, y + 1, [232, 192, 90]);
  b.ball(x, y + 1, 2, 2, metal('#e8c060'));
  b.px(x, y + 1, [120, 220, 255]); b.px(x - 1, y, [255, 255, 255]);
}
function weaponDraw(b: Buf, L: Look, p: Pose, dir: Dir, A: { x: number; y: number }, B: { x: number; y: number }) {
  const side = dir === 2, steel = metal('#c8d0e0'), gold = metal('#e8c060'), wood = ramp('#7a5030', 0.8);
  const base = side ? -0.6 : dir === 3 ? -2.3 : -2.0, a = base + p.wep * (side ? 1.1 : 0.9);
  const k = L.weapon;
  if (k === 'sword_shield' || k === 'greatsword') blade(b, A.x, A.y, a, k === 'greatsword' ? 25 : 16, k === 'greatsword' ? 5 : 3, steel, gold);
  else if (k === 'daggers') { blade(b, A.x, A.y, a, 8, 2, steel, gold); if (!side) blade(b, B.x, B.y, -1.1 - p.wep * 0.6, 8, 2, steel, gold); }
  else if (k === 'axe' || k === 'dual_axe') {
    for (const [h, an] of (k === 'dual_axe' && !side ? [[A, a], [B, -1.1 - p.wep * 0.7]] : [[A, a]]) as [{ x: number; y: number }, number][]) {
      b.limb(h.x, h.y, h.x + Math.cos(an) * 14, h.y + Math.sin(an) * 14, 1.2, wood);
      b.ball(h.x + Math.cos(an) * 12 + Math.cos(an + 1.57) * 3, h.y + Math.sin(an) * 12 + Math.sin(an + 1.57) * 3, 4, 3.5, steel);
    }
  } else if (k === 'mace') { b.limb(A.x, A.y, A.x + Math.cos(a) * 12, A.y + Math.sin(a) * 12, 1.2, wood); b.ball(A.x + Math.cos(a) * 13, A.y + Math.sin(a) * 13, 3.6, 3.6, steel); }
  else if (k === 'staff' || k === 'holy_staff') {
    const sa = -1.75 + p.lift * 0.4 + p.wep * 0.3, tx = A.x + Math.cos(sa) * 20, ty = A.y + Math.sin(sa) * 20;
    b.limb(A.x - Math.cos(sa) * 8, A.y - Math.sin(sa) * 8, tx, ty, 1.3, wood);
    for (let t = 4; t < 18; t += 5) { b.px(A.x + Math.cos(sa) * t - 1, A.y + Math.sin(sa) * t, gold[3]); b.px(A.x + Math.cos(sa) * t + 1, A.y + Math.sin(sa) * t, gold[1]); } // bands
    if (k === 'holy_staff') {
      for (const s of [-1, 1]) { b.limb(tx, ty, tx + s * 5, ty - 4, 1.2, gold); b.limb(tx + s * 5, ty - 4, tx + s * 6, ty - 1, 1, gold); } // wings
      b.ball(tx, ty - 2, 3.2, 3.2, gold); b.ball(tx, ty - 2, 1.8, 1.8, ramp('#fff4c0', 0.4));
      for (let a2 = 0; a2 < 6.3; a2 += 0.5) b.px(tx + Math.cos(a2) * 4.5, ty - 8 + Math.sin(a2) * 1.6, [255, 240, 170]); // a halo
    } else {
      for (let a2 = 0.2; a2 < 2.95; a2 += 0.22) { b.px(tx + Math.cos(a2) * 5, ty - 1 + Math.sin(a2) * 3 - 2, gold[2]); b.px(tx + Math.cos(a2) * 5, ty + Math.sin(a2) * 3 - 2, gold[1]); } // a crescent cradle
      b.px(tx - 5, ty - 4, gold[4]); b.px(tx + 5, ty - 4, gold[4]);
      b.ball(tx, ty - 4, 3.2, 3.8, ramp('#5ac8ff', 0.9), undefined, 0.25);
      b.px(tx - 1, ty - 6, [255, 255, 255]); b.px(tx - 1, ty - 5, [220, 250, 255]);
    }
  } else if (k === 'orb') b.ball(A.x + (side ? 4 : 0), A.y - 6 - p.lift * 3, 4, 4, ramp('#b06aff', 0.9), undefined, 0.25);
  else if (k === 'bow' || k === 'crossbow') {
    const bx = side ? A.x + 3 : A.x - 1, by = A.y - 4;
    if (k === 'bow') { for (let t = -1.2; t <= 1.2; t += 0.08) b.px(bx + Math.cos(t) * (side ? 4 : 2) - (side ? 2 : 0), by + Math.sin(t) * 11, wood[t < 0 ? 3 : 1]); for (let j = -10; j <= 10; j++) b.px(bx - (side ? 3 + p.lunge : 1), by + j, [230, 230, 220]); }
    else { b.limb(bx - 4, by + 2, bx + 6, by + 2, 1.4, wood); b.limb(bx + 5, by - 4, bx + 5, by + 8, 1, steel); }
  }
}

// ------------------------------------------------------------------ sheets
export function renderHDSheet(ap: Appearance, job: Job): HTMLCanvasElement {
  const L = look(ap, job), sheet = document.createElement('canvas');
  sheet.width = HD_COLS * HD; sheet.height = 4 * HD;
  const g = sheet.getContext('2d')!;
  for (const [row, dir] of [[0, 0], [2, 2], [3, 3]] as const) for (const a of NAMES) for (let f = 0; f < HD_ANIMS[a].frames; f++) {
    const c = frame(L, dir, poseFor(a, f)), x = (HD_COL[a] + f) * HD;
    g.drawImage(c, x, row * HD);
    if (dir === 2) { g.save(); g.translate(x + HD, HD); g.scale(-1, 1); g.drawImage(c, 0, 0); g.restore(); }
  }
  return sheet;
}
const sheets = new Map<string, HTMLCanvasElement>();
/** What builds a sheet: this module's renderer, or style A once stylea.ts is loaded. */
let renderer: (ap: Appearance, job: Job) => HTMLCanvasElement = renderHDSheet;
export function setHDRenderer(f: (ap: Appearance, job: Job) => HTMLCanvasElement) {
  renderer = f;
  sheets.clear();
}
/** The sheet if it is already built (no work). */
export const peekHDSheet = (ap: Appearance, job: Job) => sheets.get(appearanceKey(ap, job));
export function getHDSheet(ap: Appearance, job: Job): HTMLCanvasElement {
  const key = appearanceKey(ap, job);
  let s = sheets.get(key);
  if (s) { sheets.delete(key); sheets.set(key, s); return s; }
  s = renderer(ap, job);
  if (sheets.size >= 120) sheets.delete(sheets.keys().next().value!);
  sheets.set(key, s);
  return s;
}
