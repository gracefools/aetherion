// Style A characters: the chibi pixel art of the revamp samples, built for every Appearance and job.
//
// The pixel kit works on indexed grids: each shape is filled with a palette entry (a three-tone
// ramp), then `bake` shades it automatically (light on the top-left edges of every shape, dark on the
// bottom-right ones) and draws a coloured outline (a deep, saturated version of the colour it wraps)
// instead of a black line. Big heads, small bodies, two-pixel eyes with a highlight, rosy cheeks.
//
// Sheets use the HD layout of hdchars.ts (64 px frames, the animations of HD_ANIMS, rows down, left,
// right, up; feet at HD_OX, HD_FEET), so they drop in wherever HD sheets are used.
import type { Appearance } from '../../../shared/src/appearance';
import { JOB_DEFS } from '../../../shared/src/jobs';
import type { Job } from '../../../shared/src/protocol';
import { COLORS, EYE, HAIR, SKIN } from './chars';
import { ramp as ramp5 } from './hdart';
import { HD, HD_ANIMS, HD_COL, HD_COLS, setHDRenderer, type HdAnim } from './hdchars';

type RGB = [number, number, number];
interface Ink { l: RGB; b: RGB; d: RGB; o: RGB; detail: boolean }

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const outlineOf = (d: RGB): RGB => [d[0] * 0.42 + 12, d[1] * 0.36 + 6, d[2] * 0.45 + 22];

/** A palette for one character: entry 0 is empty. */
class Pal {
  list: (Ink | null)[] = [null];
  add(l: RGB, b: RGB, d: RGB, detail = false) { this.list.push({ l, b, d, o: outlineOf(d), detail }); return this.list.length - 1; }
  /** A ramp from one colour (hue-shifted light and dark tones). */
  tri(h: string, spread = 1) { const r = ramp5(h, spread); return this.add(r[3], r[2], r[1]); }
  flat(h: string | RGB) { const c = typeof h === 'string' ? hex(h) : h; return this.add(c, c, c, true); }
}

class Grid {
  g: Uint8Array;
  constructor(public w: number, public h: number) { this.g = new Uint8Array(w * h); }
  p(x: number, y: number, i: number) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y * this.w + x] = i; }
  r(x: number, y: number, w: number, h: number, i: number) { x = Math.round(x); y = Math.round(y); for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) this.p(x + a, y + b, i); }
  e(cx: number, cy: number, rx: number, ry: number, i: number) {
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) { const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) this.p(x, y, i); }
  }
  l(x1: number, y1: number, x2: number, y2: number, t: number, i: number) {
    const n = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1));
    for (let k = 0; k <= n; k++) this.r(Math.round(x1 + ((x2 - x1) * k) / n) - (t >> 1), Math.round(y1 + ((y2 - y1) * k) / n) - (t >> 1), t, t, i);
  }
}

function bake(G: Grid, P: Pal): HTMLCanvasElement {
  const { w, h, g } = G, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!, im = c.createImageData(w, h), d = im.data;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : g[y * w + x]);
  const df = (a: number, i: number) => (a !== i && !(a && P.list[a]!.detail) ? 1 : 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = g[y * w + x];
    let col: RGB | null = null;
    if (i) {
      const e = P.list[i]!;
      if (e.detail) col = e.b;
      else { const s = df(at(x - 1, y), i) + df(at(x, y - 1), i) - df(at(x + 1, y), i) - df(at(x, y + 1), i); col = s > 0 ? e.l : s < 0 ? e.d : e.b; }
    } else {
      const n = at(x, y + 1) || at(x + 1, y) || at(x - 1, y) || at(x, y - 1);
      if (n) col = P.list[n]!.o;
    }
    if (col) { const k = (y * w + x) * 4; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; }
  }
  c.putImageData(im, 0, 0);
  return cv;
}

// ------------------------------------------------------------------ the look
interface Look {
  P: Pal; skin: number; hair: number; hairHi: number; hairD: number; eye: number; white: number; mouth: number; blush: number;
  c1: number; c1D: number; c2: number; boot: number; steel: number; gold: number; goldF: number; wood: number; blade: number;
  armor: number; armorKind: number; helm: number; helmF: number; helmKind: number; cape: number; capeD: number; capeKind: number;
  acc: number; accKind: number; hairKind: number; eyes: number; face: number; fem: boolean; clothing: number; weapon: string;
  glow: number; glowHi: number; magic: number; skinD: number;
}
function makeLook(ap: Appearance, job: Job): Look {
  const P = new Pal(), w = JOB_DEFS[job].weapons[ap.weapon] ?? JOB_DEFS[job].weapons[0];
  const hairR = ramp5(HAIR[ap.hairColor], 0.95), skinR = ramp5(SKIN[ap.skin], 0.6);
  const metal = (h: string) => { const r = ramp5(h, 0.7); return P.add([Math.min(255, r[4][0] + 30), Math.min(255, r[4][1] + 30), Math.min(255, r[4][2] + 34)], r[3], r[1]); };
  return {
    P, skin: P.add(skinR[4], skinR[3], skinR[1]), skinD: P.flat(skinR[1]), hair: P.add(hairR[3], hairR[2], hairR[1]), hairHi: P.flat(hairR[4]), hairD: P.flat(hairR[1]),
    eye: P.flat(ramp5(EYE[ap.eyeColor], 1)[1]), white: P.flat('#ffffff'), mouth: P.flat('#cf8674'), blush: P.flat('#ffb8cc'),
    c1: P.tri(COLORS[ap.color1], 0.9), c1D: P.flat(ramp5(COLORS[ap.color1], 0.9)[1]), c2: P.tri(COLORS[ap.color2], 0.9),
    boot: P.add([164, 116, 84], [119, 83, 64], [74, 46, 42]), steel: P.add([255, 255, 255], [200, 210, 232], [128, 138, 178]),
    gold: P.add([255, 232, 144], [240, 192, 96], [176, 120, 48]), goldF: P.flat('#f0c060'), wood: P.add([184, 132, 88], [138, 92, 64], [90, 58, 48]),
    blade: P.add([255, 255, 255], [223, 232, 248], [152, 166, 204]),
    armor: ap.armor >= 2 ? metal(COLORS[ap.armorColor]) : P.tri(COLORS[ap.armorColor], 0.8), armorKind: ap.armor,
    helm: ap.helmet === 3 ? metal(COLORS[ap.helmetColor]) : P.tri(COLORS[ap.helmetColor], 0.9), helmF: P.flat(ramp5(COLORS[ap.helmetColor], 0.9)[1]), helmKind: ap.helmet,
    cape: P.tri(COLORS[ap.capeColor], 0.9), capeD: P.flat(ramp5(COLORS[ap.capeColor], 0.9)[1]), capeKind: ap.cape,
    acc: P.tri(COLORS[ap.accessoryColor], 0.9), accKind: ap.accessory, hairKind: ap.hair, eyes: ap.eyes, face: ap.face, fem: ap.body === 1,
    clothing: ap.clothing, weapon: w.kind, glow: P.flat('#ffe08a'), glowHi: P.flat('#fff6c8'),
    magic: w.kind === 'holy_staff' ? P.add([255, 246, 200], [255, 214, 106], [200, 140, 60]) : P.add([228, 196, 255], [176, 106, 255], [110, 60, 190]),
  };
}

// ------------------------------------------------------------------ poses
interface Pose {
  bob: number; liftL: number; liftR: number; armL: number; armR: number; // front and back
  A: number; l1: number; l2: number; arm: number; bend: number; armFar: number; sway: number; // side
  atk: number | null; cast: number; hit: boolean;
  /** Attacks: where the swing came from (its trail is drawn between) and how far the body lunges. */
  atkPrev: number | null; lunge: number;
}
const TAU = Math.PI * 2, ease = (t: number) => t * t * (3 - 2 * t);
function poseFor(a: HdAnim, f: number): Pose {
  const p: Pose = { bob: 0, liftL: 0, liftR: 0, armL: 0, armR: 0, A: 0, l1: 0, l2: 0, arm: 0.1, bend: 0.3, armFar: -0.05, sway: 0, atk: null, cast: 0, hit: false, atkPrev: null, lunge: 0 };
  if (a === 'idle') { p.bob = f >= 2 ? 1 : 0; p.sway = p.bob; }
  else if (a === 'walk' || a === 'run') {
    const k = a === 'run' ? 1.4 : 1, ph = (f / 6) * TAU, s = Math.sin(ph), c = Math.cos(ph);
    p.bob = Math.abs(s) > 0.6 ? -1 : 0;
    p.liftL = Math.round(Math.max(0, s) * 2 * k); p.liftR = Math.round(Math.max(0, -s) * 2 * k);
    p.armL = Math.round(-s * k); p.armR = Math.round(s * k);
    p.A = s * k; p.l1 = Math.round(Math.max(0, c) * 2 * k); p.l2 = Math.round(Math.max(0, -c) * 2 * k);
    p.arm = -s * 0.6 * k; p.armFar = s * 0.6 * k; p.sway = 1;
  } else if (a === 'attack') {
    const at = (k: number) => 3.6 + (0.7 - 3.6) * ease(Math.max(0, k) / 4), ang = at(f);
    p.atk = ang; p.A = 0.6; p.arm = ang; p.bend = 0.25; p.armFar = -0.4; p.sway = 2;
    // the wind-up, the strike with a bright trail behind the blade, the follow-through
    p.atkPrev = f >= 1 && f <= 3 ? at(f - 1.4) : null;
    p.lunge = [0, 1, 3, 2, 1][f];
    p.bob = f === 2 ? 1 : 0;
  } else if (a === 'cast') {
    p.cast = [0.3, 0.7, 1, 1, 0.6][f]; p.bob = f === 2 || f === 3 ? -1 : 0; p.arm = 2.2 + p.cast * 0.6; p.armFar = 2 + p.cast * 0.5;
  } else if (a === 'hit') { p.hit = true; p.bob = 1; p.armL = p.armR = -1; p.arm = 0.6; p.armFar = 0.4; }
  else if (a === 'death') { p.hit = f === 0; p.bob = 1; }
  return p;
}

// ------------------------------------------------------------------ one frame (64 x 64, feet at 32, 60)
const PX = 16, PY = 6;
type View = 'f' | 's' | 'b';

function frame(L: Look, view: View, pose: Pose): HTMLCanvasElement {
  const G = new Grid(HD, HD), b = pose.bob;
  const LX = view === 's' ? pose.lunge : 0, LY = view === 'f' ? Math.round(pose.lunge / 2) : view === 'b' ? -Math.round(pose.lunge / 2) : 0;
  const OX = PX + LX, OY = PY + LY;
  const r = (x: number, y: number, w: number, h: number, i: number) => G.r(x + OX, y + OY, w, h, i);
  const p = (x: number, y: number, i: number) => G.p(x + OX, y + OY, i);
  const e = (x: number, y: number, rx: number, ry: number, i: number) => G.e(x + OX, y + OY, rx, ry, i);
  const l = (x1: number, y1: number, x2: number, y2: number, t: number, i: number) => G.l(x1 + OX, y1 + OY, x2 + OX, y2 + OY, t, i);
  /** A swing's trail: a bright arc around the shoulder from where the blade was to where it is. */
  const trail = (sx: number, sy: number, a0: number, a1: number, sg: number) => {
    const melee = !['bow', 'crossbow', 'orb', 'staff', 'holy_staff'].includes(L.weapon);
    if (!melee) return;
    const R0 = L.weapon === 'greatsword' || L.weapon === 'axe' ? 15 : L.weapon === 'daggers' ? 9 : 12, steps = 14;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps, fade = k / steps;
      for (let rr = R0 - 3 * fade; rr <= R0 + 3; rr += 1) p(sx + sg * Math.sin(a) * rr, sy + Math.cos(a) * rr, fade > 0.55 ? L.glowHi : L.glow);
    }
  };
  const plate = L.armorKind >= 2, top = L.armorKind ? L.armor : L.c1, sleeve = plate ? L.armor : L.c1;
  const robe = L.clothing === 1, coat = L.clothing === 3;

  /** A weapon in a hand at (hx, hy) pointing along angle rr (pi = straight up), mirrored by sg. */
  const weapon = (hx: number, hy: number, rr: number, sg: number, second = false) => {
    const ux = sg * Math.sin(rr), uy = Math.cos(rr), at = (k: number): [number, number] => [hx + ux * k, hy + uy * k];
    const k = L.weapon;
    if (k === 'sword_shield' || k === 'greatsword') {
      const len = k === 'greatsword' ? 21 : 15, [x0, y0] = at(1.5), [x1, y1] = at(len);
      l(x0, y0, x1, y1, k === 'greatsword' ? 3 : 2, L.blade);
      const qx = uy * 2.8, qy = -ux * 2.8;
      l(x0 - qx, y0 - qy, x0 + qx, y0 + qy, 1, L.goldF);
    } else if (k === 'axe' || k === 'dual_axe') {
      const len = k === 'axe' ? 17 : 12, [x1, y1] = at(len), [xm, ym] = at(len - 3.5);
      l(hx - ux * 2, hy - uy * 2, x1, y1, 2, L.wood);
      e(xm + uy * 3 * sg, ym - ux * 3 * sg, k === 'axe' ? 4 : 3, k === 'axe' ? 4.6 : 3.4, L.steel);
    } else if (k === 'mace') {
      const [x1, y1] = at(13);
      l(hx - ux, hy - uy, x1, y1, 2, L.wood);
      e(x1, y1, 3.4, 3.4, L.steel);
      p(x1, y1 - 4.5, L.steel); p(x1 + 4.5, y1, L.steel); p(x1 - 4.5, y1, L.steel); p(x1, y1 + 4.5, L.steel);
    } else if (k === 'daggers') {
      const [x0, y0] = at(1), [x1, y1] = at(9);
      l(x0, y0, x1, y1, 2, L.blade);
      p(x0, y0, L.goldF);
    } else if (k === 'staff' || k === 'holy_staff') {
      if (second) return;
      const [x0, y0] = at(-8), [x1, y1] = at(21);
      l(x0, y0, x1, y1, 2, L.wood);
      e(x1, y1 - 1, 3.4, 3.4, L.magic);
      if (k === 'holy_staff') { l(x1, y1 - 6, x1, y1 + 3, 1, L.goldF); l(x1 - 3, y1 - 2, x1 + 3, y1 - 2, 1, L.goldF); }
      else p(x1 - 1, y1 - 2, L.glowHi);
    } else if (k === 'orb') {
      if (second) return;
      e(hx, hy - 6 - pose.cast * 3, 4, 4, L.magic);
      p(hx - 1, hy - 6 - pose.cast * 3, L.glowHi);
    } else if (k === 'bow') {
      if (second) return;
      const px = uy, py = -ux; // across the aim
      for (let t = -1; t <= 1; t += 0.05) { const bx = hx + px * t * 12 + ux * (1 - t * t) * 4.5, by = hy + py * t * 12 + uy * (1 - t * t) * 4.5; p(bx, by, L.wood); p(bx + ux * 0.8, by + uy * 0.8, L.wood); }
      l(hx + px * 12, hy + py * 12, hx - px * 12, hy - py * 12, 1, L.white);
    } else if (k === 'crossbow') {
      if (second) return;
      const [x1, y1] = at(11);
      l(hx, hy, x1, y1, 2, L.wood);
      l(x1 + uy * 6, y1 - ux * 6, x1 - uy * 6, y1 + ux * 6, 2, L.steel);
    }
  };
  const twoHanded = L.weapon === 'daggers' || L.weapon === 'dual_axe';

  if (view === 's') {
    // ---------------- side view, facing right ----------------
    const A = pose.A, sway = pose.sway;
    const limb = (sx: number, sy: number, a: number, bd: number) => {
      const ex = sx + Math.sin(a) * 3.5, ey = sy + Math.cos(a) * 3.5, hx = ex + Math.sin(a + bd) * 3.5, hy = ey + Math.cos(a + bd) * 3.5;
      l(sx, sy, ex, ey, 3, sleeve); l(ex, ey, hx, hy, 3, plate ? L.steel : sleeve);
      r(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2, L.skin);
      return [hx, hy];
    };
    if (L.capeKind) for (let y = 41; y <= (L.capeKind === 2 ? 52 : 47); y++) { const x0 = Math.round(10 - (y - 41) * 0.45 - (sway * (y - 41)) / 9); r(x0, y + b, 14 - x0, 1, L.cape); }
    if (L.weapon === 'bow' || L.weapon === 'crossbow' || L.weapon === 'sword_shield') {} // drawn on the near hand below
    const far = limb(15, 42 + b, pose.armFar, 0.3);
    if (twoHanded) weapon(far[0], far[1], pose.atk != null ? pose.arm + 0.6 : 2.5, 1, true);
    if (!robe) { r(15 - Math.round(A * 3), 50 - pose.l2, 4, 4, L.boot); r(15 + Math.round(A * 3), 50 - pose.l1, 4, 4, L.boot); }
    else { for (let y = 46; y <= 53; y++) { const hw = Math.round(4 + (y - 46) * 0.5); r(15 - hw + 1, y, hw * 2, 1, y === 53 ? L.c2 : L.c1); } r(17, 52, 3, 2, L.boot); }
    for (let y = 40; y <= 46; y++) r(12, y + b, 8, 1, top);
    if (!robe) for (let y = 47; y <= 49; y++) r(11, y + b, 10, 1, y === 49 ? L.c2 : L.c1);
    if (coat) for (let y = 47; y <= 52; y++) r(10 - Math.round(A), y + b, 3, 1, L.c1);
    if (plate) { r(16, 41 + b, 4, 4, L.steel); }
    r(12, 46 + b, 8, 1, L.boot); p(19, 46 + b, L.goldF);
    // head
    if (L.hairKind === 4) e(15.5, 33 + b, 8.5, 8, L.skin);
    else e(15, 33 + b, 9, 8.5, L.hair);
    e(17.5, 34.5 + b, 6.5, 6.3, L.skin);
    eyeAt(20, 34 + b);
    p(22, 38 + b, L.mouth);
    if (L.face !== 0 || L.fem) r(17, 37 + b, 2, 1, L.blush);
    if (L.face === 3) r(17, 38 + b, 5, 2, L.hair);
    if (L.hairKind !== 4) {
      // fringe and the hair at the back of the head
      r(12, 24 + b, 9, 1, L.hair); r(10, 25 + b, 13, 1, L.hair); r(8, 26 + b, 17, 4, L.hair); r(11, 27 + b, 5, 1, L.hairHi);
      [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 23, 24].forEach((x) => p(x, 30 + b, L.hair));
      const back = L.hairKind === 1 ? 16 : L.hairKind === 7 ? 10 : 7;
      r(6, 30 + b, 8, back, L.hair);
      if (L.hairKind === 5) l(7, 30 + b, 3, 42 + b, 3, L.hair);
      if (L.hairKind === 3) e(12, 23 + b, 3, 2.5, L.hair);
      if (L.hairKind === 6) for (const [x, y] of [[9, 23], [13, 22], [17, 22], [21, 24]]) l(x, y + 3 + b, x - 1, y + b, 2, L.hair);
    }
    helmet(15, b, true);
    accessory(true);
    if (pose.atkPrev != null) trail(15, 42 + b, pose.atkPrev + 0.25, pose.arm + 0.25, 1);
    const near = limb(15, 42 + b, pose.atk != null ? pose.arm : pose.cast ? pose.arm : pose.arm, pose.bend);
    weapon(near[0], near[1], pose.atk != null ? pose.arm + 0.25 : 2.2, 1); // held forward and up, ahead of the face
    if (pose.cast) castGlow(near[0] + 1, near[1] - 2);
    if (plate) e(15, 41 + b, 2.6, 2.2, L.steel);
    if (L.weapon === 'sword_shield') { e(19, 44 + b, 2, 4, L.steel); p(19, 44 + b, L.goldF); }
    return finish();
  }

  // ---------------- front and back views ----------------
  const back = view === 'b', S = back ? 0 : 1; // the weapon hand: screen right from the front, screen left from behind
  const lf = [pose.liftL, pose.liftR], ad = [pose.armL, pose.armR];
  if (L.hairKind === 1 && !back) r(6, 30 + b, 20, 16, L.hair);
  if (L.capeKind && !back) for (let y = 41; y <= (L.capeKind === 2 ? 52 : 47); y++) { const hw = Math.round(6 + (y - 41) * 0.25); r(15 - hw, y + b, hw * 2 + 2, 1, L.cape); }
  if (!robe) { r(12, 50 - lf[0], 4, 4, L.boot); r(17, 50 - lf[1], 4, 4, L.boot); }
  for (let y = 40; y <= 46; y++) { const hw = L.fem ? 4 : 5; r(16 - hw, y + b, hw * 2, 1, top); }
  if (robe) for (let y = 46; y <= 53; y++) { const hw = Math.round(5 + (y - 46) * 0.45); r(16 - hw, y, hw * 2, 1, y === 53 ? L.c2 : L.c1); }
  else {
    for (let y = 47; y <= 49; y++) r(10, y + b, 12, 1, y === 49 ? L.c2 : L.c1);
    if (coat) for (let y = 47; y <= 52; y++) { r(9, y + b, 3, 1, L.c1); r(20, y + b, 3, 1, L.c1); }
  }
  if (!back) {
    if (L.clothing === 2) { r(14, 40 + b, 4, 6, L.c2); } // the shirt under an open vest
    if (L.armorKind === 1) r(12, 41 + b, 8, 4, L.armor);
    if (L.armorKind === 2) { r(12, 41 + b, 8, 5, L.armor); for (let y = 42; y <= 45; y += 2) for (let x = 13; x <= 18; x += 2) p(x, y + b, L.c1D); }
    if (plate) { r(13, 41 + b, 6, 4, L.steel); }
    r(11, 46 + b, 10, 1, L.boot); r(15, 46 + b, 2, 1, L.goldF);
  }
  const armAt = (s: number) => {
    const ax = s ? 21 : 8, d = ad[s] - Math.round(pose.cast * 5);
    r(ax, 41 + b, 3, 4, sleeve);
    r(ax, 45 + b + d, 3, 2, plate ? L.steel : sleeve);
    r(ax, 47 + b + d, 3, 2, L.skin);
    if (plate) e(ax + 1, 41 + b, 2.4, 2, L.steel);
    const hx = s ? 22 : 9, hy = 47 + b + d;
    if (pose.cast) castGlow(hx, hy - 1);
    if (s === S && pose.atk == null) weapon(hx + (s ? 1 : -1), hy, Math.PI + 0.25, s ? 1 : -1);
    else if (s !== S && twoHanded && pose.atk == null) weapon(hx + (s ? 1 : -1), hy, Math.PI + 0.25, s ? 1 : -1, true);
    if (s !== S && L.weapon === 'sword_shield' && !back) { e(hx - 1, hy - 2, 3, 4, L.steel); e(hx - 1, hy - 2, 1.5, 2.5, L.c2); }
  };
  const atk = pose.atk != null;
  if (!(atk && S === 0)) armAt(0);
  if (!(atk && S === 1)) armAt(1);
  if (L.capeKind && back) {
    for (let y = 41; y <= (L.capeKind === 2 ? 52 : 48); y++) { const hw = Math.round(5 + (y - 41) * 0.25); r(16 - hw, y + b, hw * 2, 1, L.cape); }
    for (let y = 43; y <= (L.capeKind === 2 ? 51 : 47); y++) { if (y % 3) p(14, y + b, L.capeD); if ((y + 1) % 3) p(18, y + b, L.capeD); }
  }
  // head
  if (L.hairKind === 4) e(16, 33 + b, 8.5, 8, L.skin);
  else e(16, 33 + b, 9, 8.5, L.hair);
  if (back) {
    if (L.hairKind !== 4) {
      if (L.hairKind === 1) r(6, 30 + b, 20, 16, L.hair);
      if (L.hairKind === 7) r(7, 30 + b, 18, 9, L.hair);
      if (L.hairKind === 5) l(16, 36 + b, 16, 46 + b, 3, L.hair);
      for (let y = 28; y <= 38; y += 3) { p(12, y + b, L.hairD); p(19, y + 1 + b, L.hairD); }
      r(11, 27 + b, 5, 1, L.hairHi);
    }
  } else {
    e(16, 34.5 + b, 7.5, 6.5, L.skin);
    eyeAt(12, 34 + b); eyeAt(19, 34 + b);
    p(15, 38 + b, L.mouth); p(16, 38 + b, L.mouth);
    if (L.face === 4 || L.fem || L.face === 0) { r(10, 37 + b, 2, 1, L.blush); r(21, 37 + b, 2, 1, L.blush); }
    if (L.face === 1) { p(10, 37 + b, L.skinD); p(12, 38 + b, L.skinD); p(21, 37 + b, L.skinD); p(19, 38 + b, L.skinD); }
    if (L.face === 2) l(19, 32 + b, 21, 37 + b, 1, L.skinD);
    if (L.face === 3) { r(11, 38 + b, 10, 2, L.hair); r(13, 40 + b, 6, 1, L.hair); p(15, 38 + b, L.mouth); p(16, 38 + b, L.mouth); }
    if (L.hairKind !== 4) {
      const fr = L.hairKind === 2 ? 2 : 0;
      r(12, 24 + b, 9, 1, L.hair); r(10, 25 + b, 13, 1, L.hair); r(8, 26 + b, 17, 4 + fr, L.hair); r(11, 27 + b, 5, 1, L.hairHi); p(10, 28 + b, L.hairHi);
      [8, 9, 10, 12, 13, 16, 17, 21, 22, 23, 24].forEach((x) => p(x, 30 + b + fr, L.hair));
      [8, 9, 16, 23, 24].forEach((x) => p(x, 31 + b + fr, L.hair));
      if (L.hairKind === 1) { r(6, 30 + b, 3, 16, L.hair); r(24, 30 + b, 3, 16, L.hair); }
      else if (L.hairKind === 7) { r(6, 30 + b, 3, 9, L.hair); r(24, 30 + b, 3, 9, L.hair); }
      else { r(7, 30 + b, 2, 6, L.hair); r(24, 30 + b, 2, 6, L.hair); }
      if (L.hairKind === 5) l(25, 30 + b, 27, 40 + b, 3, L.hair);
      if (L.hairKind === 3) e(16, 23 + b, 3, 2.5, L.hair);
      if (L.hairKind === 6) for (const x of [10, 14, 18, 22]) l(x, 26 + b, x + (x < 16 ? -1 : 1), 22 + b, 2, L.hair);
      if (L.hairKind === 0) { p(16, 23 + b, L.hair); p(17, 22 + b, L.hair); p(18, 22 + b, L.hair); } // a cowlick
    }
  }
  helmet(16, b, false);
  if (!back) accessory(false);
  if (atk) {
    const s = S, ax = (s ? 21 : 8) + 1, sg = s ? -1 : 1, a = pose.atk!;
    if (pose.atkPrev != null) trail(ax, 42 + b, pose.atkPrev + 0.2, a + 0.2, sg);
    const ex = ax + sg * Math.sin(a) * 3.5, ey = 42 + b + Math.cos(a) * 3.5, hx = ex + sg * Math.sin(a + 0.2) * 3.5, hy = ey + Math.cos(a + 0.2) * 3.5;
    l(ax, 42 + b, ex, ey, 3, sleeve); l(ex, ey, hx, hy, 3, plate ? L.steel : sleeve); r(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2, L.skin);
    weapon(hx, hy, a + 0.2, sg);
    if (plate) e(ax, 41 + b, 2.4, 2, L.steel);
  }
  return finish();

  function eyeAt(x: number, y: number) {
    if (L.eyes === 3) { r(x, y + 2, 2, 1, L.eye); return; } // calm: closed
    const w = L.eyes === 2 ? 3 : 2, h = L.eyes === 1 ? 2 : 3;
    r(x, y + (L.eyes === 1 ? 1 : 0), w, h, L.eye);
    p(x, y + (L.eyes === 1 ? 1 : 0), L.white);
    if (L.fem && L.eyes !== 1) p(x + (x < 16 ? -1 : w), y, L.eye); // a lash
    if (L.accKind === 2 && view !== 'b') { r(x - 1, y - 1, w + 2, 1, L.acc); r(x - 1, y + h, w + 2, 1, L.acc); }
  }
  function helmet(cx: number, bb: number, side: boolean) {
    const k = L.helmKind, dx = cx - 16;
    if (k === 1) { r(8 + dx, 25 + bb, 17, 4, L.helm); r(side ? 20 + dx : 7 + dx, 28 + bb, side ? 6 : 19, 1, L.helmF); }
    else if (k === 2) { e(cx, 31 + bb, 10.5, 9, L.helm); if (!(view === 'b')) e(cx + (side ? 2 : 0), 34.5 + bb, 6.5, 5.8, L.skin); if (view !== 'b') { eyeAt(side ? 20 : 12, 34 + bb); if (!side) eyeAt(19, 34 + bb); } }
    else if (k === 3) { e(cx, 29 + bb, 9.5, 6.5, L.helm); r(7 + dx, 29 + bb, 19, 2, L.helm); if (!side && view !== 'b') r(15, 29 + bb, 2, 5, L.helm); if (side) r(21 + dx, 29 + bb, 2, 5, L.helm); }
    else if (k === 4) { r(8 + dx, 28 + bb, 17, 1, L.goldF); if (view !== 'b') p(cx, 28 + bb, L.acc); }
    else if (k === 5) { for (let y = 12; y <= 26; y++) { const hw = Math.round((y - 12) * 0.42); r(cx - hw + (y < 16 ? 2 : 0), y + bb, hw * 2 + 1, 1, L.helm); } r(cx - 11, 26 + bb, 23, 2, L.helm); r(cx - 6, 24 + bb, 13, 1, L.helmF); }
  }
  function accessory(side: boolean) {
    const k = L.accKind;
    if (k === 1) { r(side ? 12 : 11, 39 + b, side ? 8 : 10, 2, L.acc); if (!side) r(18, 41 + b, 2, 4, L.acc); else r(10, 40 + b, 2, 4, L.acc); }
    else if (k === 3 && !side) p(7, 37 + b, L.goldF);
    else if (k === 3 && side) p(12, 37 + b, L.goldF);
    else if (k === 4) { p(side ? 18 : 16, 42 + b, L.goldF); p(side ? 18 : 15, 41 + b, L.gold); }
  }
  function castGlow(x: number, y: number) {
    if (pose.cast < 0.5) return;
    e(x, y, 2 + pose.cast * 1.5, 2 + pose.cast * 1.5, L.glow);
    p(x, y, L.glowHi);
  }
  function finish() {
    const c = bake(G, L.P);
    if (pose.hit) { // a white flash on the first frame of being hit
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(0, 0, HD, HD);
    }
    return c;
  }
}

/** A death frame: the hit pose, falling over to the side and fading at the end. */
function deathFrame(L: Look, view: View, f: number): HTMLCanvasElement {
  const base = frame(L, view, poseFor('death', f)), c = document.createElement('canvas');
  c.width = c.height = HD;
  const g = c.getContext('2d')!, k = ease(Math.min(1, f / 3));
  // the pivot slides so the fallen body (about 34 px long) lies inside the frame
  const dir = view === 'b' ? -1 : 1, px = 32 - dir * 14 * k, py = 60 - 3 * k;
  g.translate(px, py);
  g.rotate(dir * k * Math.PI * 0.5);
  g.translate(-32, -60);
  g.globalAlpha = f === 4 ? 0.7 : 1;
  g.drawImage(base, 0, 0);
  return c;
}

const NAMES = Object.keys(HD_ANIMS) as HdAnim[];
/** A full style A sheet in the HD layout. */
export function renderStyleASheet(ap: Appearance, job: Job): HTMLCanvasElement {
  const L = makeLook(ap, job), sheet = document.createElement('canvas');
  sheet.width = HD_COLS * HD;
  sheet.height = 4 * HD;
  const g = sheet.getContext('2d')!;
  for (const [row, view] of [[0, 'f'], [2, 's'], [3, 'b']] as const) for (const a of NAMES) for (let f = 0; f < HD_ANIMS[a].frames; f++) {
    const c = a === 'death' ? deathFrame(L, view, f) : frame(L, view, poseFor(a, f)), x = (HD_COL[a] + f) * HD;
    g.drawImage(c, x, row * HD);
    if (view === 's') { g.save(); g.translate(x + HD, HD); g.scale(-1, 1); g.drawImage(c, 0, 0); g.restore(); }
  }
  return sheet;
}

// style A is the character art of the HD look
setHDRenderer(renderStyleASheet);

/**
 * Style A finish for art painted as plain pixels (monsters, pets, mounts): light on the top-left
 * edge of the silhouette, shade on the bottom-right edge, and a coloured outline (a deep version of
 * the colour beside it) instead of a black one. Takes and returns RGBA data of a W x H image.
 */
export function styleAFinish(src: Uint8ClampedArray, W: number, H: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(src.length) as Uint8ClampedArray<ArrayBuffer>;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src[(y * W + x) * 4 + 3]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (src[i + 3]) {
      const s = (a(x - 1, y) ? 0 : 1) + (a(x, y - 1) ? 0 : 1) - (a(x + 1, y) ? 0 : 1) - (a(x, y + 1) ? 0 : 1);
      const k = s > 0 ? 1.18 : s < 0 ? 0.8 : 1, lift = s > 0 ? 14 : 0;
      out[i] = Math.min(255, src[i] * k + lift); out[i + 1] = Math.min(255, src[i + 1] * k + lift); out[i + 2] = Math.min(255, src[i + 2] * k + lift * 0.6);
      out[i + 3] = src[i + 3];
      continue;
    }
    // outline: the colour of the nearest opaque neighbour (below first, as the samples do), deepened
    let n = -1;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (a(x + dx, y + dy)) { n = ((y + dy) * W + x + dx) * 4; break; }
    if (n < 0) continue;
    const r = src[n] * 0.7, g = src[n + 1] * 0.7, b = src[n + 2] * 0.7;
    out[i] = r * 0.42 + 12; out[i + 1] = g * 0.36 + 6; out[i + 2] = b * 0.45 + 22; out[i + 3] = 255;
  }
  return out;
}
