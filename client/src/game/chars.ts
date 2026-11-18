// Modular character sprites (original art generated in code with pixel-art technique:
// chibi proportions, three-tone hue-shifted ramps lit from the top-left, hand-shaped masks for
// heads/hair/weapons, nearest-neighbour rotation and an automatic dark outline).
//
// A frame is composed part-by-part (z order depends on facing) and, inside each part, layer-by-layer:
//   body -> clothing -> armor -> face -> hair -> helmet -> accessory, plus the cape and weapon parts.
// renderSheet(ap, job, layer) renders one layer in isolation using the same rig. That is the
// contract imported art must follow in M8 (see docs/asset-pipeline.md).
import {
  ANIM_COL, ANIM_NAMES, ANIMS, appearanceKey, FRAME_H, FRAME_W, SHEET_COLS, type Anim, type Appearance,
} from '../../../shared/src/appearance';
import { JOB_DEFS, type WeaponKind } from '../../../shared/src/jobs';
import type { Job } from '../../../shared/src/protocol';
import { mk } from './art';

export const SKIN = ['#f6d7b8', '#eabf95', '#d39c6b', '#b07a4e', '#8a5a38', '#5e3b24', '#fbe8d8', '#3f2616'];
export const HAIR = ['#3a2c22', '#6a4426', '#b0702f', '#e3c268', '#c9c9d2', '#b8402f', '#3f66b4', '#8452ac', '#f4f1ea', '#35865f'];
export const EYE = ['#5a3c26', '#3a74b8', '#3f9a58', '#8a909c', '#b8822c', '#8452ac', '#b8403c', '#2a2430'];
export const COLORS = ['#b8403c', '#3f66b4', '#3f9a58', '#8452ac', '#d0a83c', '#3aa6a6', '#939cac', '#ebe5d6', '#84582f', '#3a3444', '#de7a30', '#dc84ac'];

export const LAYERS = ['body', 'clothing', 'armor', 'face', 'hair', 'helmet', 'accessory', 'cape', 'weapon'] as const;
export type Layer = (typeof LAYERS)[number];
type Part = 'cape' | 'backArm' | 'legs' | 'torso' | 'arms' | 'frontArm' | 'head' | 'weapon';
type G = CanvasRenderingContext2D;

const CX = FRAME_W / 2;
const FEET = FRAME_H - 4;
const OUTLINE = [35, 26, 43];
const INK = '#231a2b';
const LEATHER = '#5a3a22';

// ---------------- colour ramps ----------------
export interface Ramp {
  a: string; // base
  b: string; // shadow
  c: string; // highlight
  d: string; // deep shadow
}
const ramps = new Map<string, Ramp>();
export function ramp(hex: string): Ramp {
  let r = ramps.get(hex);
  if (r) return r;
  const n = parseInt(hex.slice(1), 16);
  const R = (n >> 16) / 255, Gc = ((n >> 8) & 255) / 255, B = (n & 255) / 255;
  const mx = Math.max(R, Gc, B), mn = Math.min(R, Gc, B), l = (mx + mn) / 2, d = mx - mn;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = mx === R ? ((Gc - B) / d + 6) % 6 : mx === Gc ? (B - R) / d + 2 : (R - Gc) / d + 4;
  h *= 60;
  // shadows drift toward violet, highlights toward warm yellow
  const toward = (from: number, to: number, k: number) => from + ((((to - from) % 360) + 540) % 360 - 180) * k;
  const css = (hh: number, ss: number, ll: number) => `hsl(${Math.round((hh + 360) % 360)},${Math.round(Math.min(1, ss) * 100)}%,${Math.round(Math.max(0, Math.min(1, ll)) * 100)}%)`;
  r = {
    a: hex,
    b: css(toward(h, 265, 0.14), s * 1.05, l * 0.76),
    c: css(toward(h, 52, 0.16), s * 0.95, l + (1 - l) * 0.34),
    d: css(toward(h, 265, 0.24), s * 1.1, l * 0.55),
  };
  ramps.set(hex, r);
  return r;
}

export const p1 = (g: G, c: string, x: number, y: number, w = 1, h = 1) => {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
/** Shaded box lit from the top-left; optional rounded corners. */
export function sbox(g: G, r: Ramp, x: number, y: number, w: number, h: number, round = false) {
  if (w <= 0 || h <= 0) return;
  p1(g, r.a, x, y, w, h);
  if (h > 1) p1(g, r.b, x, y + h - 1, w, 1);
  if (w > 2) p1(g, r.b, x + w - 1, y, 1, h);
  if (w > 3 && h > 2) p1(g, r.c, x + 1, y, Math.max(1, w - 3), 1);
  else if (w > 1) p1(g, r.c, x, y, 1, 1);
  if (round && w > 2 && h > 2) {
    g.clearRect(x, y, 1, 1); g.clearRect(x + w - 1, y, 1, 1); g.clearRect(x, y + h - 1, 1, 1); g.clearRect(x + w - 1, y + h - 1, 1, 1);
  }
}
/** Stamp a character mask: a/b/c/d pick ramp tones, anything in `extra` picks a literal colour. */
function stamp(g: G, rows: string[], x: number, y: number, r: Ramp | null, extra?: Record<string, string>, flip = false) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[flip ? row.length - 1 - i : i];
      if (ch === '.') continue;
      const c = extra?.[ch] ?? (r as any)?.[ch];
      if (c) p1(g, c, x + i, y + j);
    }
  }
}
export function disc(g: G, c: string, cx: number, cy: number, rad: number) {
  g.fillStyle = c;
  for (let dy = -rad; dy <= rad; dy++) {
    const w = Math.floor(Math.sqrt(rad * rad - dy * dy) + 0.35);
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

// ---------------- masks ----------------
const HEAD_FRONT = [
  '...aaaaaaaa...', '..acaaaaaaaa..', '.accaaaaaaaaa.', 'aacaaaaaaaaaab', 'aaaaaaaaaaaaab', 'aaaaaaaaaaaaab',
  'aaaaaaaaaaaaab', 'aaaaaaaaaaaaab', 'baaaaaaaaaaaab', '.baaaaaaaaaab.', '..bbaaaaaabb..', '....bbbbbb....',
];
const HEAD_SIDE = [
  '...aaaaaaa...', '..acaaaaaaa..', '.accaaaaaaaa.', 'aacaaaaaaaaa.', 'aaaaaaaaaaaaa', 'aaaaaaaaaaaaa',
  'aaaaaaaaaaaaa', 'baabaaaaaaaaa', 'baabaaaaaaaa.', '.baaaaaaaaaa.', '..bbaaaaaab..', '....bbbbbb...',
];
const CAP_FRONT = ['....aaaaaaaa....', '..aacccccaaaab..', '.aacccaaaaaaabb.', 'aaccaaaaaaaaaabb', 'aacaaaaaaaaaaabb', 'aaaaaaaaaaaaabbb'];
const CAP_SIDE = ['....aaaaaaaa...', '..aaccccaaaaa..', '.aaccaaaaaaaab.', 'aaacaaaaaaaaaab', 'baaaaaaaaaaaaab', 'bbaaaaaaaaaaaab'];
// fringe rows (cap coordinates, 16 wide) per hair style; '.' lets the forehead show through
const FRINGE: Record<number, string[]> = {
  0: ['aaabaaa.aaab.abb', 'aa..ba...a....bb'],
  1: ['aaaab.......aabb', 'aaa..........abb'],
  2: ['aaaaaaaaaaaaaabb', 'aab.ab.ab.ab.abb'],
  3: ['ab............bb', 'a..............b'],
  5: ['aaaaab.....aaabb', 'aaab.........abb'],
  6: ['aaba.aab.aab.abb', 'a..b..a...b...bb'],
  7: ['aaaaaaaaaaaaaabb', 'aaabababababaabb'],
};
const SIDE_LEN = [2, 12, 3, 1, 0, 2, 2, 6];
const BACK_LEN = [6, 16, 6, 5, 0, 5, 6, 9];

const WCOL: Record<string, string> = {
  s: '#c8d0da', S: '#f6fafc', d: '#8690a0', D: '#565f70', g: '#d8b04a', G: '#f8e596', h: '#9a7424',
  w: '#8a5e34', W: '#5e3d20', x: '#b88248', c: '#58c6f2', C: '#d4f4ff', k: '#2a7fb8',
  p: '#7a56d6', P: '#cdbcff', q: '#4a2f9a', y: '#fff3b8', v: '#7fd07a', V: '#d2f7c8', r: '#b8433a', l: '#e9e3d0',
};
const rep = (row: string, n: number) => Array.from({ length: n }, () => row);
interface WeaponArt {
  rows: string[];
  px: number; // pivot (hand) inside the mask
  py: number;
}
const WEAPONS: Record<WeaponKind, WeaponArt> = {
  sword_shield: { rows: ['..S..', ...rep('.sSd.', 11), 'hgGgh', '..w..', '..W..', '..g..'], px: 2, py: 13 },
  greatsword: { rows: ['...S...', '..sSd..', ...rep('.sSsdD.', 17), 'hgGGGgh', '..hgh..', '...w...', '...W...', '...w...', '...W...', '..ggg..'], px: 3, py: 22 },
  staff: { rows: ['...C...', '..cCc..', '.gcCkg.', '.gckkg.', '..gkg..', '...g...', ...rep('...w...', 4), '..ggg..', ...rep('...w...', 7), '...x...', ...rep('...w...', 8), '...W...'], px: 3, py: 20 },
  holy_staff: { rows: ['..ggg..', '.gyyyg.', 'gyy.yyg', 'gy.G.yg', 'gyy.yyg', '.gyyyg.', '..ggg..', '...g...', ...rep('...g...', 5), '..hGh..', ...rep('...g...', 9), '...h...', ...rep('...g...', 5), '...h...'], px: 3, py: 21 },
  orb: { rows: ['..ppp..', '.pPPpq.', 'pPCPpqq', 'pPPppqq', 'pppppqq', '.pqqqq.', '..qqq..'], px: 3, py: 3 },
  bow: {
    rows: Array.from({ length: 25 }, (_, i) => {
      const t = (i - 12) / 12, x = Math.round(6 - 5 * t * t), row = '.'.repeat(9).split('');
      if (i > 0 && i < 24) row[1] = 'l';
      row[x] = i === 0 || i === 24 ? 'g' : 'w';
      if (x + 1 < 9 && i > 1 && i < 23) row[x + 1] = i > 9 && i < 15 ? 'g' : 'W';
      return row.join('');
    }),
    px: 6, py: 12,
  },
  crossbow: { rows: ['......S......', '......s......', '.dssssWssssd.', 'd.....w.....d', 'l.....w.....l', '.ll...w...ll.', '...lllwlll...', '......W......', '......w......', '......W......', '.....WwW.....', '.....W.W.....'], px: 6, py: 9 },
  daggers: { rows: ['.S.', ...rep('sSd', 5), 'hGh', '.w.', '.W.'], px: 1, py: 7 },
  mace: { rows: ['..dSd..', '.dsSsd.', 'dsSSsdD', 'dssssdD', '.dsssD.', '..dDD..', '..ggg..', ...rep('...w...', 4), '...x...', ...rep('...w...', 4), '...g...'], px: 3, py: 13 },
  axe: { rows: ['.S.........S.', 'sSs...w...sSd', 'sSss.gwg.ssSd', 'sSsssdwdsssSd', 'sSsssdwdsssSd', 'sSss.gwg.ssSd', 'sSs...w...sSd', '.s....w....d.', ...rep('......w......', 6), '......x......', ...rep('......w......', 8), '......W......', '......g......'], px: 6, py: 20 },
  dual_axe: { rows: ['..wsS..', '..wssSd', '..wssSd', '..wssSd', '..wsSd.', '..w....', ...rep('..w....', 3), '..x....', ...rep('..w....', 3), '..W....'], px: 2, py: 10 },
};
const SHIELD = ['.ddddddd.', 'dsSSssssD', 'dsSsgsssD', 'dsssgsssD', 'dsgggggsD', 'dsssgsssD', 'dsssgsssD', '.dssgssD.', '.dsssssD.', '..dsssD..', '...dDD...'];

const RS = 80, RP = 40; // rotation canvas size / pivot
const rotCache = new Map<string, HTMLCanvasElement>();
/** Weapon rotated around its grip with nearest-neighbour sampling (no blur). */
function rotatedWeapon(kind: WeaponKind, variant: number, angle: number): HTMLCanvasElement {
  const deg = Math.round((angle * 180) / Math.PI / 5) * 5;
  const key = `${kind}:${variant}:${deg}`;
  let out = rotCache.get(key);
  if (out) return out;
  const art = WEAPONS[kind];
  const src = mk(RS, RS), sg = src.getContext('2d')!;
  const extra = kind === 'daggers' && variant ? { ...WCOL, s: WCOL.v, S: WCOL.V, d: '#4f9a52' } : WCOL;
  stamp(sg, art.rows, RP - art.px, RP - art.py, null, extra);
  out = mk(RS, RS);
  if (deg === 0) out.getContext('2d')!.drawImage(src, 0, 0);
  else {
    const a = sg.getImageData(0, 0, RS, RS), b = sg.createImageData(RS, RS);
    const rad = (deg * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    for (let y = 0; y < RS; y++)
      for (let x = 0; x < RS; x++) {
        const dx = x - RP, dy = y - RP;
        const sx = Math.round(cs * dx + sn * dy) + RP, sy = Math.round(-sn * dx + cs * dy) + RP;
        if (sx < 0 || sy < 0 || sx >= RS || sy >= RS) continue;
        const si = (sy * RS + sx) * 4, di = (y * RS + x) * 4;
        if (!a.data[si + 3]) continue;
        b.data[di] = a.data[si]; b.data[di + 1] = a.data[si + 1]; b.data[di + 2] = a.data[si + 2]; b.data[di + 3] = 255;
      }
    out.getContext('2d')!.putImageData(b, 0, 0);
  }
  rotCache.set(key, out);
  return out;
}

// ---------------- pose + rig ----------------
interface Pose {
  bob: number;
  lean: number;
  legA: number;
  legB: number;
  armA: number;
  armB: number;
  raise: number; // 0..2 both arms lifted (casting)
  wAngle: number;
  wAngle2: number;
  wOut: number; // forward reach of the weapon hand
  wLift: number;
  glow: number;
  arrow: boolean;
  flash: boolean;
  rot: number;
  alpha: number;
}
interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Arm {
  r: R;
  hand: R;
  horiz: boolean;
  up: boolean;
  back: boolean;
}
interface Rig {
  dir: number; // 0 down, 2 right, 3 up (left is a mirrored right)
  side: boolean;
  pose: Pose;
  hw: number;
  legLen: number;
  legTop: number;
  torsoTop: number;
  lean: number;
  head: { x: number; y: number };
  legs: R[];
  torso: R;
  arms: Arm[];
  wi: number; // index of the weapon arm
  fx: { x: number; y: number; r: number; col: string }[];
}

const MELEE: WeaponKind[] = ['sword_shield', 'greatsword', 'daggers', 'mace', 'axe', 'dual_axe'];
const REST: Record<WeaponKind, number> = {
  sword_shield: 0.35, greatsword: 0.5, staff: 0.1, orb: 0, bow: 0, crossbow: 1.57,
  daggers: 0.6, holy_staff: 0.1, mace: 0.35, axe: 0.4, dual_axe: 0.5,
};

function poseFor(anim: Anim, f: number, kind: WeaponKind): Pose {
  const p: Pose = { bob: 0, lean: 0, legA: 0, legB: 0, armA: 0, armB: 0, raise: 0, wAngle: REST[kind], wAngle2: REST[kind], wOut: 0, wLift: 0, glow: 0, arrow: false, flash: false, rot: 0, alpha: 1 };
  const ph = [1, 0, -1, 0][f];
  switch (anim) {
    case 'idle':
      p.bob = f;
      break;
    case 'walk':
      p.legA = ph * 2; p.legB = -ph * 2; p.armA = -ph; p.armB = ph; p.bob = ph ? 0 : 1;
      break;
    case 'run':
      p.legA = ph * 3; p.legB = -ph * 3; p.armA = -ph * 2; p.armB = ph * 2; p.bob = ph ? 0 : 1; p.lean = 1;
      break;
    case 'attack':
      if (MELEE.includes(kind)) {
        p.wAngle = [-1.05, 0.25, 1.75, 1.05][f];
        p.wAngle2 = [0.5, -0.8, 0.4, 1.6][f];
        p.wOut = [0, 2, 3, 1][f];
        p.wLift = [3, 1, -1, 0][f];
        p.lean = [-1, 0, 2, 1][f];
        p.legA = [0, 1, 2, 1][f];
      } else if (kind === 'bow' || kind === 'crossbow') {
        p.wOut = [2, 3, 3, 2][f];
        p.wLift = [2, 3, 2, 1][f]; // raise the bow arm (visible in front/back views)
        p.arrow = f < 2;
        p.lean = [-1, -1, 0, 0][f];
        p.armB = f < 2 ? -2 : 0;
      } else {
        p.wAngle = [0, 0.45, 0.8, 0.3][f];
        p.wOut = [1, 2, 3, 1][f];
        p.wLift = [1, 2, 2, 1][f];
        p.glow = [0, 2, 3, 1][f];
        p.lean = [0, 1, 1, 0][f];
      }
      break;
    case 'cast':
      p.raise = [1, 2, 2, 1][f];
      p.glow = [1, 3, 4, 2][f];
      p.bob = [0, -1, -1, 0][f];
      p.wAngle = 0;
      break;
    case 'hit':
      p.lean = f ? -1 : -2;
      p.flash = f === 0;
      p.armA = -1; p.armB = -1; p.bob = f ? 0 : 1;
      break;
    case 'death':
      p.rot = [0.35, 0.95, 1.5708, 1.5708][f];
      p.alpha = f === 3 ? 0.72 : 1;
      p.armA = 1; p.armB = -1;
      break;
  }
  return p;
}

function buildRig(ap: Appearance, dir: number, pose: Pose): Rig {
  const side = dir === 2;
  const legLen = [5, 6, 7][ap.height], hw = [4, 5, 6][ap.build];
  const legTop = FEET - legLen, torsoTop = legTop - 8 + pose.bob;
  const lean = side ? pose.lean : 0;
  const legs: R[] = [], arms: Arm[] = [];
  const wi = dir === 3 ? 0 : 1;
  let torso: R;
  if (!side) {
    for (let i = 0; i < 2; i++) {
      const lift = Math.min(2, Math.max(0, Math.round(i ? pose.legB : pose.legA)));
      legs.push({ x: i ? CX + 1 : CX - 4, y: legTop, w: 3, h: legLen - lift });
    }
    torso = { x: CX - hw, y: torsoTop, w: hw * 2, h: 8 };
    for (let i = 0; i < 2; i++) {
      const x = i ? CX + hw : CX - hw - 3;
      const up = pose.raise > 0;
      const y = up ? torsoTop + 1 - pose.raise * 3 : torsoTop + 1 + Math.round(i ? pose.armB : pose.armA) - (i === wi ? pose.wLift : 0);
      arms.push({ r: { x, y, w: 3, h: 7 }, hand: { x, y: up ? y : y + 5, w: 3, h: 2 }, horiz: false, up, back: false });
    }
  } else {
    const fwd = Math.round(pose.legA), bck = Math.round(pose.legB);
    legs.push({ x: CX - 2 + bck, y: legTop, w: 3, h: legLen - (bck > 2 ? 1 : 0) }, { x: CX - 1 + fwd, y: legTop, w: 3, h: legLen - (fwd > 2 ? 1 : 0) });
    const d = 6 + (ap.build === 2 ? 1 : 0);
    torso = { x: CX - 3 + lean, y: torsoTop, w: d, h: 8 };
    const reach = pose.raise > 0 || pose.wOut >= 2;
    const mkArm = (back: boolean): Arm => {
      if (reach && (!back || pose.raise > 0)) {
        const w = 6 + Math.min(2, pose.wOut >> 1) - (back ? 1 : 0);
        const y = torsoTop + 2 - (pose.raise === 2 ? 4 : pose.raise === 1 ? 2 : 0) + (back ? 1 : 0);
        const x = CX + lean;
        return { r: { x, y, w, h: 3 }, hand: { x: x + w - 2, y, w: 2, h: 3 }, horiz: true, up: false, back };
      }
      const x = CX - 1 + lean + Math.round(back ? pose.armB : pose.armA) + (back ? 1 : 0);
      const y = torsoTop + 1;
      return { r: { x, y, w: 3, h: 7 }, hand: { x, y: y + 5, w: 3, h: 2 }, horiz: false, up: false, back };
    };
    arms.push(mkArm(true), mkArm(false));
  }
  const head = { x: (side ? CX - 6 : CX - 7) + lean, y: torsoTop - 11 };
  return { dir, side, pose, hw, legLen, legTop, torsoTop, lean, head, legs, torso, arms, wi, fx: [] };
}

/** Portion of an arm nearest the shoulder, `n` pixels long. */
function sleeve(a: Arm, n: number): R {
  const r = a.r;
  if (a.horiz) return { x: r.x, y: r.y, w: Math.min(n, r.w - 2), h: r.h };
  const h = Math.min(n, r.h - 2);
  return a.up ? { x: r.x, y: r.y + r.h - h, w: r.w, h } : { x: r.x, y: r.y, w: r.w, h };
}
const partArms = (rig: Rig, part: Part): Arm[] =>
  part === 'arms' ? rig.arms : part === 'backArm' ? [rig.arms[0]] : part === 'frontArm' ? [rig.arms[1]] : [];
const dim = (r: Ramp): Ramp => ({ a: r.b, b: r.d, c: r.a, d: r.d });

// ---------------- layers ----------------
type LayerFn = (g: G, part: Part, rig: Rig, ap: Appearance, job: Job) => void;

const body: LayerFn = (g, part, rig, ap) => {
  const sk = ramp(SKIN[ap.skin]);
  if (part === 'legs') rig.legs.forEach((l, i) => sbox(g, rig.side && i === 0 ? dim(sk) : sk, l.x, l.y, l.w, l.h));
  else if (part === 'torso') {
    sbox(g, sk, rig.torso.x, rig.torso.y, rig.torso.w, rig.torso.h);
  } else if (part === 'head') {
    stamp(g, rig.side ? HEAD_SIDE : HEAD_FRONT, rig.head.x, rig.head.y, sk);
  } else for (const a of partArms(rig, part)) {
    sbox(g, a.back ? dim(sk) : sk, a.r.x, a.r.y, a.r.w, a.r.h, true);
  }
};

const clothing: LayerFn = (g, part, rig, ap) => {
  const c1 = ramp(COLORS[ap.color1]), c2 = ramp(COLORS[ap.color2]), kind = ap.clothing, t = rig.torso;
  const front = rig.dir === 0, mid = t.x + (t.w >> 1);
  if (part === 'legs') {
    const pants = ramp(COLORS[ap.color2]);
    rig.legs.forEach((l, i) => {
      const back = rig.side && i === 0;
      sbox(g, back ? { a: pants.d, b: pants.d, c: pants.b, d: pants.d } : dim(pants), l.x, l.y, l.w, l.h - 2);
      // boots: one pixel proud of the leg, lit toe
      const bx = rig.side ? l.x : i ? l.x : l.x - 1, bw = l.w + 1;
      p1(g, back ? '#3a2416' : LEATHER, bx, l.y + l.h - 3, bw, 3);
      p1(g, back ? LEATHER : '#7d5430', bx, l.y + l.h - 3, bw - 1, 1);
      p1(g, '#2e1c10', bx, l.y + l.h - 1, bw, 1);
    });
    if (kind === 1) { // robe: flares toward the hem
      const top = rig.legTop - 1, n = rig.legLen;
      for (let y = 0; y < n; y++) {
        const grow = Math.round((y / Math.max(1, n - 1)) * (rig.side ? 1 : 2));
        const x = t.x - grow, w = t.w + grow * 2;
        p1(g, c1.a, x, top + y, w, 1);
        p1(g, c1.b, x + w - 2, top + y, 2, 1);
        p1(g, c1.c, x, top + y, 1, 1);
        if (!rig.side) { p1(g, c1.b, x + Math.round(w * 0.3), top + y, 1, 1); p1(g, c1.b, x + Math.round(w * 0.62), top + y, 1, 1); }
        if (y === n - 1) p1(g, c2.a, x, top + y, w, 1);
        else if (y === n - 2) p1(g, c2.b, x, top + y, w, 1);
        if (front && y < n - 2) p1(g, c2.a, mid - 1, top + y, 2, 1);
      }
    } else if (kind === 3) { // coat tails, split in the middle
      const n = Math.max(2, rig.legLen - 2);
      for (let y = 0; y < n; y++) {
        p1(g, c1.a, t.x - 1, rig.legTop - 1 + y, t.w + 2, 1);
        p1(g, c1.b, t.x + t.w - 1, rig.legTop - 1 + y, 2, 1);
        if (!rig.side && y > 0) p1(g, c1.d, mid - 1, rig.legTop - 1 + y, 2, 1);
      }
      p1(g, c1.b, t.x - 1, rig.legTop - 2 + n, t.w + 2, 1);
    } else if (kind === 0) { // tunic skirt
      p1(g, c1.a, t.x, rig.legTop, t.w, 2);
      p1(g, c1.b, t.x, rig.legTop + 1, t.w, 1);
      if (!rig.side) p1(g, c1.d, mid - 1, rig.legTop + 1, 2, 1);
    }
  } else if (part === 'torso') {
    const base = kind === 2 ? c2 : c1;
    sbox(g, base, t.x, t.y, t.w, t.h);
    if (ap.body === 1 && !rig.side) { // waist taper
      g.clearRect(t.x, t.y + 3, 1, 3); g.clearRect(t.x + t.w - 1, t.y + 3, 1, 3);
      p1(g, base.b, t.x + t.w - 2, t.y + 3, 1, 3);
    }
    p1(g, base.b, t.x + 1, t.y + t.h - 2, t.w - 1, 1);
    if (kind === 2) { // vest panels over the shirt
      const pw = rig.side ? t.w - 2 : Math.max(2, (t.w >> 1) - 1);
      sbox(g, c1, t.x, t.y, pw, t.h - 1);
      if (!rig.side && rig.dir !== 3) sbox(g, c1, t.x + t.w - pw, t.y, pw, t.h - 1);
      if (rig.dir === 3) sbox(g, c1, t.x, t.y, t.w, t.h - 1);
    }
    if (kind !== 1) { // belt + buckle
      p1(g, LEATHER, t.x, t.y + 5, t.w, 1);
      p1(g, '#2e1c10', t.x, t.y + 6, t.w, 1);
      if (front) p1(g, '#f0d070', mid - 1, t.y + 5, 2, 1);
    } else { // sash
      p1(g, c2.a, t.x, t.y + 5, t.w, 1);
      p1(g, c2.b, t.x, t.y + 6, t.w, 1);
    }
    if (front) {
      if (kind === 0) { p1(g, c2.a, mid - 2, t.y, 4, 1); p1(g, c2.a, mid - 1, t.y + 1, 2, 1); }
      else if (kind === 1) { p1(g, c2.a, mid - 1, t.y, 2, 5); p1(g, c2.c, mid - 1, t.y, 1, 5); p1(g, c2.a, mid - 3, t.y, 6, 1); }
      else if (kind === 3) {
        p1(g, c2.a, mid - 3, t.y, 2, 1); p1(g, c2.a, mid + 1, t.y, 2, 1); p1(g, c2.a, mid - 2, t.y + 1, 1, 2); p1(g, c2.a, mid + 1, t.y + 1, 1, 2);
        p1(g, '#f0d070', mid, t.y + 2, 1, 1); p1(g, '#f0d070', mid, t.y + 4, 1, 1);
      }
    }
  } else {
    for (const a of partArms(rig, part)) {
      const col = kind === 2 ? c2 : c1;
      const s = sleeve(a, kind === 2 ? 2 : kind === 0 ? 3 : 5);
      sbox(g, a.back ? dim(col) : col, s.x, s.y, s.w, s.h, false);
      if (kind === 1 || kind === 3) { // cuff
        const cuff = kind === 1 ? c2 : c1;
        if (a.horiz) p1(g, cuff.c, s.x + s.w - 1, s.y, 1, s.h);
        else p1(g, kind === 1 ? cuff.a : cuff.d, s.x, a.up ? s.y : s.y + s.h - 1, s.w, 1);
      }
    }
  }
};

const armor: LayerFn = (g, part, rig, ap) => {
  if (!ap.armor) return;
  const c = ramp(COLORS[ap.armorColor]), t = rig.torso, front = rig.dir === 0, mid = t.x + (t.w >> 1);
  if (part === 'legs') {
    if (ap.armor === 3) rig.legs.forEach((l, i) => {
      const r = rig.side && i === 0 ? dim(c) : c;
      sbox(g, r, l.x - (rig.side ? 0 : i ? 0 : 1), l.y + l.h - 5, l.w + 1, 5);
      p1(g, r.c, l.x, l.y + l.h - 5, l.w - 1, 1);
    });
    else if (ap.armor === 1) rig.legs.forEach((l) => p1(g, c.b, l.x, l.y + l.h - 4, l.w, 1));
    if (ap.armor === 3 && !rig.side) { // tassets
      sbox(g, c, t.x, rig.legTop - 1, (t.w >> 1) - 1, 3);
      sbox(g, c, mid + 1, rig.legTop - 1, (t.w >> 1) - 1, 3);
    }
  } else if (part === 'torso') {
    if (ap.armor === 1) {
      p1(g, c.a, t.x, t.y, t.w, 2); p1(g, c.c, t.x + 1, t.y, t.w - 3, 1); p1(g, c.b, t.x, t.y + 2, t.w, 1);
      if (front) for (let i = 0; i < 5; i++) p1(g, c.b, t.x + 1 + i, t.y + 1 + i, 2, 1); // baldric
      p1(g, c.a, t.x + t.w - 3, t.y + 5, 3, 2); p1(g, c.c, t.x + t.w - 3, t.y + 5, 2, 1); // pouch
    } else if (ap.armor === 2) {
      p1(g, c.a, t.x, t.y, t.w, 7);
      for (let y = 0; y < 7; y++) for (let x = (y & 1); x < t.w; x += 2) p1(g, y < 2 ? c.c : c.b, t.x + x, t.y + y);
      p1(g, c.d, t.x + t.w - 1, t.y, 1, 7);
      p1(g, c.d, t.x, t.y + 6, t.w, 1);
    } else {
      sbox(g, c, t.x, t.y, t.w, 6);
      p1(g, c.c, t.x + 1, t.y + 1, 2, 2);
      if (front) { p1(g, c.b, mid - 1, t.y + 1, 1, 4); p1(g, c.c, mid, t.y + 1, 1, 4); p1(g, '#f0d070', mid - 1, t.y, 2, 1); }
      p1(g, c.d, t.x, t.y + 5, t.w, 1);
      p1(g, c.b, t.x, t.y + 6, t.w, 1); p1(g, c.d, t.x, t.y + 7, t.w, 1);
    }
  } else {
    for (const a of partArms(rig, part)) {
      const r = a.back ? dim(c) : c, s = sleeve(a, 3);
      if (ap.armor === 3) { // pauldron + gauntlet
        if (a.horiz) sbox(g, r, s.x - 1, s.y - 1, 4, 5, true);
        else sbox(g, r, s.x - 1, a.up ? s.y + s.h - 3 : s.y - 1, 5, 4, true);
        sbox(g, r, a.hand.x, a.hand.y, a.hand.w, a.hand.h);
      } else if (ap.armor === 1) {
        if (a.horiz) sbox(g, r, s.x, s.y - 1, 3, 4, true);
        else sbox(g, r, s.x, a.up ? s.y + s.h - 2 : s.y - 1, 3, 3, true);
      } else sbox(g, r, s.x, s.y, s.w, s.h);
      if (ap.armor !== 2) { // bracer
        const h = a.hand;
        if (a.horiz) p1(g, r.b, h.x - 2, h.y, 2, h.h);
        else p1(g, r.b, h.x, a.up ? h.y + 2 : h.y - 2, h.w, 2);
      }
    }
  }
};

const face: LayerFn = (g, part, rig, ap) => {
  if (part !== 'head' || rig.dir === 3) return;
  const { x, y } = rig.head, sk = ramp(SKIN[ap.skin]), ec = ramp(EYE[ap.eyeColor]), ey = y + 6;
  const eye = (ex: number, first: boolean) => {
    switch (ap.eyes) {
      case 0: p1(g, INK, ex, ey, 2, 1); p1(g, ec.a, ex, ey + 1, 2, 2); p1(g, '#ffffff', ex + (first ? 0 : 1), ey + 1); p1(g, ec.d, ex, ey + 2, 2, 1); break;
      case 1: p1(g, INK, ex - (first ? 1 : 0), ey + 1, 3, 1); p1(g, ec.a, ex, ey + 2, 2, 1); break;
      case 2: p1(g, INK, ex - (first ? 1 : 0), ey - 1, 3, 1); p1(g, '#ffffff', ex - (first ? 1 : 0), ey, 3, 3); p1(g, ec.a, ex, ey, 2, 3); p1(g, INK, ex + (first ? 1 : 0), ey + 1); p1(g, '#ffffff', ex + (first ? 0 : 1), ey); break;
      default: p1(g, INK, ex - (first ? 1 : 0), ey + 2, 3, 1); p1(g, INK, ex - (first ? 1 : 0) + (first ? 0 : 2), ey + 1); break;
    }
  };
  const hair = ramp(HAIR[ap.hairColor]);
  if (rig.side) {
    eye(x + 9, false);
    p1(g, sk.d, x + 10, y + 10, 2, 1);
    if (ap.face === 1) { p1(g, sk.b, x + 7, y + 9); p1(g, sk.b, x + 8, y + 10); }
    if (ap.face === 2) p1(g, '#b05048', x + 11, y + 4, 1, 5);
    if (ap.face === 3) { p1(g, hair.a, x + 6, y + 9, 6, 2); p1(g, hair.b, x + 6, y + 11, 5, 1); }
    if (ap.face === 4) p1(g, '#ee9090', x + 7, y + 9, 2, 1);
  } else {
    eye(x + 3, true);
    eye(x + 9, false);
    p1(g, sk.d, x + 6, y + 10, 2, 1);
    if (ap.face === 1) { p1(g, sk.b, x + 2, y + 9); p1(g, sk.b, x + 4, y + 10); p1(g, sk.b, x + 11, y + 9); p1(g, sk.b, x + 9, y + 10); }
    if (ap.face === 2) { p1(g, '#b05048', x + 10, y + 3, 1, 3); p1(g, '#b05048', x + 11, y + 6, 1, 4); }
    if (ap.face === 3) { p1(g, hair.a, x + 1, y + 9, 12, 2); p1(g, hair.b, x + 2, y + 11, 10, 1); p1(g, sk.d, x + 6, y + 9, 2, 1); p1(g, hair.c, x + 2, y + 9, 3, 1); }
    if (ap.face === 4) { p1(g, '#ee9090', x + 1, y + 9, 2, 1); p1(g, '#ee9090', x + 11, y + 9, 2, 1); }
  }
};

const hairLayer: LayerFn = (g, part, rig, ap) => {
  if (part !== 'head' || ap.hair === 4) return;
  const { x, y } = rig.head, h = ramp(HAIR[ap.hairColor]), s = ap.hair;
  const covered = ap.helmet === 1 || ap.helmet === 2 || ap.helmet === 3; // headgear hides the crown
  const sl = SIDE_LEN[s], bl = BACK_LEN[s];
  if (rig.dir === 3) {
    if (!covered) stamp(g, CAP_FRONT, x - 1, y - 2, h);
    const top = covered ? y + 6 : y + 4, n = y + 4 + bl - top;
    for (let i = 0; i < n; i++) {
      const yy = top + i, inset = i >= n - 2 && s !== 1 ? n - i === 1 ? 2 : 1 : 0;
      p1(g, h.a, x - 1 + inset, yy, 16 - inset * 2, 1);
      p1(g, h.b, x + 12 - inset, yy, 3, 1);
      p1(g, h.c, x + 2, yy, 2, 1);
      if (i === n - 1) p1(g, h.b, x - 1 + inset, yy, 16 - inset * 2, 1);
    }
    if (s === 5) { sbox(g, h, CX - 2, y + 6, 4, 12, true); p1(g, '#d8b04a', CX - 2, y + 7, 4, 1); }
  } else if (rig.side) {
    if (!covered) {
      stamp(g, CAP_SIDE, x - 1, y - 2, h);
      const fr = FRINGE[s];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) { const ch = fr[j][9 + i]; if (ch !== '.') p1(g, (h as any)[ch], x + 8 + i, y + 4 + j); }
    }
    const top = covered ? y + 6 : y + 4, n = y + 4 + Math.max(sl + 3, bl - 1) - top;
    for (let i = 0; i < n; i++) {
      const w = s === 1 ? 6 : i > n - 3 ? 3 : 5;
      p1(g, h.a, x - 1, top + i, w, 1);
      p1(g, h.b, x - 1, top + i, 1, 1);
      p1(g, h.c, x + 1, top + i, 1, 1);
      if (i === n - 1) p1(g, h.b, x - 1, top + i, w, 1);
    }
    if (s === 5) { sbox(g, h, x - 4, y + 4, 4, 11, true); p1(g, '#d8b04a', x - 1, y + 5, 1, 2); }
  } else {
    if (!covered) {
      stamp(g, CAP_FRONT, x - 1, y - 2, h);
      stamp(g, FRINGE[s], x - 1, y + 4, h);
    }
    const w = s === 1 || s === 7 ? 3 : 2, top = covered ? y + 7 : y + 6;
    for (let i = 0; i < sl - (covered ? 1 : 0); i++) {
      const last = i === sl - 1 && s !== 1;
      p1(g, h.a, x - 1 + (last ? 1 : 0), top + i, w - (last ? 1 : 0), 1);
      p1(g, h.b, x + 15 - w, top + i, w - (last ? 1 : 0), 1);
      p1(g, h.a, x + 15 - w, top + i, 1, 1);
    }
  }
  if (covered) return;
  if (s === 3) { sbox(g, h, CX + rig.lean - 3, y - 6, 6, 5, true); p1(g, '#b8433a', CX + rig.lean - 2, y - 2, 4, 1); }
  if (s === 6) for (const dx of [1, 5, 9, 12]) { p1(g, h.a, x + dx, y - 4, 2, 2); p1(g, h.c, x + dx, y - 5, 1, 1); p1(g, h.a, x + dx + 1, y - 5, 1, 1); }
};

const helmet: LayerFn = (g, part, rig, ap) => {
  if (part !== 'head' || !ap.helmet) return;
  const { x, y } = rig.head, c = ramp(COLORS[ap.helmetColor]), back = rig.dir === 3, side = rig.side;
  const cap = side ? CAP_SIDE : CAP_FRONT;
  switch (ap.helmet) {
    case 1: // leather cap with brim and feather
      stamp(g, cap, x - 1, y - 2, c);
      if (!back) { p1(g, c.d, side ? x + 5 : x, y + 4, side ? 10 : 14, 1); p1(g, c.b, side ? x + 7 : x + 1, y + 5, side ? 8 : 12, 1); }
      else p1(g, c.b, x - 1, y + 4, 16, 2);
      p1(g, '#e9e3d0', x + (side ? 2 : 12), y - 5, 1, 4); p1(g, '#b8433a', x + (side ? 3 : 13), y - 4, 1, 3);
      break;
    case 2: // hood
      stamp(g, cap, x - 1, y - 2, c);
      p1(g, c.a, x + 5, y - 3, 4, 1);
      if (back) { for (let i = 0; i < 9; i++) { p1(g, c.a, x - 1, y + 4 + i, 16, 1); p1(g, c.b, x + 12, y + 4 + i, 3, 1); } p1(g, c.b, x, y + 13, 14, 1); p1(g, c.d, x + 7, y + 2, 1, 10); }
      else if (side) { for (let i = 0; i < 9; i++) { p1(g, c.a, x - 1, y + 4 + i, 6, 1); p1(g, c.b, x - 1, y + 4 + i, 1, 1); } p1(g, c.d, x + 5, y + 4, 8, 1); p1(g, c.a, x - 3, y + 5, 2, 4); }
      else {
        for (let i = 0; i < 8; i++) { p1(g, c.a, x - 1, y + 4 + i, 2, 1); p1(g, c.b, x + 13, y + 4 + i, 2, 1); }
        p1(g, c.d, x + 1, y + 4, 12, 1); p1(g, c.a, x, y + 12, 2, 1); p1(g, c.b, x + 12, y + 12, 2, 1);
      }
      break;
    case 3: // helm with cheek guards and plume
      stamp(g, cap, x - 1, y - 2, c);
      if (back) { for (let i = 0; i < 7; i++) { p1(g, c.a, x - 1, y + 4 + i, 16, 1); p1(g, c.b, x + 12, y + 4 + i, 3, 1); } p1(g, c.d, x - 1, y + 10, 16, 1); }
      else if (side) { p1(g, c.d, x + 4, y + 4, 10, 1); for (let i = 0; i < 6; i++) { p1(g, c.a, x - 1, y + 4 + i, 6, 1); p1(g, c.b, x - 1, y + 4 + i, 1, 1); } p1(g, c.a, x + 11, y + 4, 2, 4); }
      else {
        p1(g, c.d, x, y + 4, 14, 1);
        for (let i = 0; i < 6; i++) { p1(g, c.a, x - 1, y + 4 + i, 3, 1); p1(g, c.c, x - 1, y + 4 + i, 1, 1); p1(g, c.b, x + 12, y + 4 + i, 3, 1); }
        p1(g, c.a, x + 6, y + 4, 2, 4); p1(g, c.c, x + 6, y + 4, 1, 4);
      }
      p1(g, '#b8433a', CX + rig.lean - 1, y - 7, 3, 5); p1(g, '#e06a5c', CX + rig.lean - 1, y - 7, 1, 4); p1(g, '#7d2a26', CX + rig.lean + 1, y - 5, 1, 3);
      break;
    case 4: // circlet
      p1(g, c.a, x, y + 3, side ? 13 : 14, 1); p1(g, c.c, x + 1, y + 3, 4, 1); p1(g, c.d, x, y + 4, side ? 13 : 14, 1);
      if (!back) { p1(g, '#58c6f2', side ? x + 10 : x + 6, y + 2, 2, 2); p1(g, '#d4f4ff', side ? x + 10 : x + 6, y + 2, 1, 1); }
      break;
    case 5: { // pointed hat
      const bx = x - 4, bw = side ? 21 : 22;
      p1(g, c.a, bx + 1, y, bw - 2, 2); p1(g, c.b, bx, y + 1, bw, 2); p1(g, c.c, bx + 2, y, 8, 1); p1(g, c.d, bx + 1, y + 3, bw - 2, 1);
      const steps: [number, number, number][] = [[1, 12, -3], [2, 10, -5], [3, 8, -7], [5, 5, -9], [7, 3, -11]];
      for (const [ox, w, oy] of steps) { p1(g, c.a, x + ox, y + oy, w, 3); p1(g, c.b, x + ox + w - 2, y + oy, 2, 3); p1(g, c.c, x + ox, y + oy, 1, 2); }
      p1(g, c.a, x + 9, y - 12, 3, 2); p1(g, c.b, x + 11, y - 11, 2, 2);
      p1(g, '#d8b04a', x + 1, y - 1, 12, 1); p1(g, '#f8e596', x + 6, y - 1, 2, 1);
      break;
    }
  }
};

const accessory: LayerFn = (g, part, rig, ap) => {
  if (!ap.accessory) return;
  const c = ramp(COLORS[ap.accessoryColor]), { x, y } = rig.head, t = rig.torso;
  if (part === 'torso') {
    if (ap.accessory === 1) {
      p1(g, c.a, t.x - 1, t.y - 1, t.w + 2, 2); p1(g, c.c, t.x, t.y - 1, t.w - 2, 1); p1(g, c.b, t.x - 1, t.y + 1, t.w + 2, 1);
      if (rig.dir !== 3) { p1(g, c.a, t.x, t.y + 2, 2, 4); p1(g, c.b, t.x + 1, t.y + 2, 1, 4); p1(g, c.c, t.x, t.y + 6, 1, 1); }
    } else if (ap.accessory === 4 && rig.dir !== 3) {
      const ax = rig.side ? t.x + t.w - 3 : t.x + (t.w >> 1) - 1;
      p1(g, '#f0d070', ax - 1, t.y, 1, 1); p1(g, '#f0d070', ax + 2, t.y, 1, 1); p1(g, '#f0d070', ax, t.y + 1, 2, 1);
      p1(g, c.a, ax, t.y + 2, 2, 2); p1(g, c.c, ax, t.y + 2, 1, 1);
    }
  } else if (part === 'head' && rig.dir !== 3) {
    if (ap.accessory === 2) {
      if (rig.side) { p1(g, c.d, x + 8, y + 5, 4, 1); p1(g, c.d, x + 8, y + 9, 4, 1); p1(g, c.d, x + 8, y + 6, 1, 3); p1(g, c.d, x + 4, y + 6, 4, 1); }
      else {
        for (const ex of [2, 8]) { p1(g, c.d, x + ex, y + 5, 4, 1); p1(g, c.d, x + ex, y + 9, 4, 1); p1(g, c.d, x + ex - 0, y + 6, 1, 3); p1(g, c.d, x + ex + 3, y + 6, 1, 3); }
        p1(g, c.d, x + 6, y + 6, 2, 1);
      }
    } else if (ap.accessory === 3) { p1(g, '#f0d070', rig.side ? x + 3 : x, y + 9, 1, 1); p1(g, c.a, rig.side ? x + 3 : x, y + 10, 1, 2); }
  }
};

const cape: LayerFn = (g, part, rig, ap) => {
  if (part !== 'cape' || !ap.cape) return;
  const c = ramp(COLORS[ap.capeColor]), t = rig.torso, len = ap.cape === 1 ? 9 : 7 + rig.legLen;
  const sway = Math.round(rig.pose.legA / 2);
  if (rig.side) {
    for (let i = 0; i < len; i++) {
      const out = Math.round((i / len) * 3) + (i > len - 4 ? Math.abs(sway) : 0);
      p1(g, c.a, t.x - 2 - out, t.y + 1 + i, 3 + out, 1);
      p1(g, c.b, t.x - 2 - out, t.y + 1 + i, 1, 1);
      if (i === len - 1) p1(g, c.d, t.x - 2 - out, t.y + 1 + i, 3 + out, 1);
    }
  } else {
    const backView = rig.dir === 3;
    for (let i = 0; i < len; i++) {
      const grow = Math.round((i / len) * 2), x = t.x - 1 - grow + sway, w = t.w + 2 + grow * 2;
      p1(g, backView ? c.a : c.b, x, t.y + 1 + i, w, 1);
      if (backView) {
        p1(g, c.c, x + 1, t.y + 1 + i, 1, 1);
        p1(g, c.b, x + Math.round(w * 0.35), t.y + 1 + i, 1, 1); p1(g, c.b, x + Math.round(w * 0.68), t.y + 1 + i, 1, 1); // folds
        p1(g, c.b, x + w - 2, t.y + 1 + i, 2, 1);
      } else p1(g, c.d, x + w - 1, t.y + 1 + i, 1, 1);
      if (i === len - 1) for (let k = 0; k < w; k++) p1(g, (k % 4) < 2 ? c.d : c.b, x + k, t.y + 1 + i + ((k % 4) < 2 ? 0 : -0), 1, 1);
    }
    if (backView) { p1(g, c.c, t.x, t.y, t.w, 1); p1(g, c.a, t.x - 1, t.y + 1, t.w + 2, 1); }
    else { p1(g, '#f0d070', t.x, t.y, 1, 1); p1(g, '#f0d070', t.x + t.w - 1, t.y, 1, 1); }
  }
};

const weapon: LayerFn = (g, part, rig, ap, job) => {
  if (part !== 'weapon') return;
  const kind = (JOB_DEFS[job].weapons[ap.weapon] ?? JOB_DEFS[job].weapons[0]).kind, p = rig.pose;
  const main = rig.arms[rig.wi], off = rig.arms[1 - rig.wi];
  const sign = rig.dir === 3 ? -1 : 1;
  const hx = main.hand.x + (main.horiz ? 1 : 1), hy = main.hand.y + (main.horiz ? 1 : 0);
  const ox = off.hand.x + 1, oy = off.hand.y;
  if (kind === 'sword_shield') {
    if (rig.side) { p1(g, WCOL.d, CX + 2 + rig.lean, rig.torsoTop + 1, 3, 9); p1(g, WCOL.s, CX + 3 + rig.lean, rig.torsoTop + 2, 1, 7); p1(g, WCOL.g, CX + 3 + rig.lean, rig.torsoTop + 5, 1, 1); }
    else stamp(g, SHIELD, ox - 5, oy - 6, null, WCOL);
  }
  const draw = (x: number, y: number, angle: number) => {
    const img = rotatedWeapon(kind, ap.weapon, angle);
    if (sign > 0) g.drawImage(img, x - RP, y - RP);
    else {
      g.save();
      g.translate(x + 1, y);
      g.scale(-1, 1);
      g.drawImage(img, -RP, -RP);
      g.restore();
    }
  };
  if (kind === 'orb') stamp(g, WEAPONS.orb.rows, hx + 3 * sign - 3, hy - 9 - (p.glow > 0 ? 2 : 0), null, WCOL);
  else {
    if (kind === 'daggers' || kind === 'dual_axe') draw(ox, oy, -p.wAngle2);
    // carried weapons tip forward in profile so they do not cross the face
    const tilt = rig.side && !p.wOut && !p.raise && kind !== 'bow' && kind !== 'crossbow' ? 0.6 : 0;
    // bows are held out to the side when seen from the front or back
    const bx = (kind === 'bow' || kind === 'crossbow') && !rig.side ? 4 * sign : 0;
    draw(hx + bx, hy, p.wAngle + tilt);
    if (p.arrow && rig.side && kind === 'bow') { p1(g, WCOL.l, hx - 7, hy, 13, 1); p1(g, WCOL.S, hx + 6, hy - 1, 2, 3); p1(g, WCOL.r, hx - 8, hy - 1, 2, 3); }
  }
  if (p.glow > 0) {
    const col = job === 'cleric' ? '255,232,150' : job === 'mage' ? '120,212,255' : job === 'berserker' ? '255,120,84' : job === 'ranger' ? '160,240,150' : job === 'assassin' ? '190,150,255' : '210,225,255';
    const gx = p.raise ? CX + rig.lean + (rig.side ? 8 : 0) : hx + (rig.side ? 7 : 4 * sign);
    const gy = p.raise ? Math.max(5, rig.head.y - (rig.side ? -1 : 5)) : hy - 9;
    rig.fx.push({ x: gx, y: gy, r: p.glow, col });
  }
};

const LAYER_FN: Record<Layer, LayerFn> = { body, clothing, armor, face, hair: hairLayer, helmet, accessory, cape, weapon };
const PART_LAYERS: Layer[] = ['body', 'clothing', 'armor', 'face', 'hair', 'helmet', 'accessory'];
const PARTS: Record<number, Part[]> = {
  0: ['cape', 'legs', 'torso', 'arms', 'head', 'weapon'],
  2: ['cape', 'backArm', 'legs', 'torso', 'head', 'weapon', 'frontArm'],
  3: ['weapon', 'legs', 'torso', 'arms', 'cape', 'head'],
};

function composeFrame(g: G, ap: Appearance, job: Job, dir: number, pose: Pose, only?: Layer): Rig {
  const rig = buildRig(ap, dir, pose);
  for (const part of PARTS[dir]) {
    if (part === 'cape' || part === 'weapon') {
      if (!only || only === part) LAYER_FN[part](g, part, rig, ap, job);
    } else for (const l of PART_LAYERS) if (!only || only === l) LAYER_FN[l](g, part, rig, ap, job);
  }
  return rig;
}

/** Returns a copy of the pixels with a 1px dark outline around every opaque region. */
export function outlined(d: Uint8ClampedArray, W: number, H: number): Uint8ClampedArray<ArrayBuffer> {
  const res = new Uint8ClampedArray(d.length);
  res.set(d);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3]) continue;
      if ((x > 0 && d[i - 1]) || (x < W - 1 && d[i + 7]) || (y > 0 && d[i - W * 4 + 3]) || (y < H - 1 && d[i + W * 4 + 3])) {
        res[i] = OUTLINE[0]; res[i + 1] = OUTLINE[1]; res[i + 2] = OUTLINE[2]; res[i + 3] = 255;
      }
    }
  return res;
}

/** Post-process one frame: optional nearest-neighbour fall rotation, 1px outline, hit flash, fade. */
function finish(img: ImageData, pose: Pose): ImageData {
  const W = img.width, H = img.height;
  let d = img.data;
  if (pose.rot) {
    const out = new Uint8ClampedArray(d.length), k = pose.rot / 1.5708;
    const cs = Math.cos(-pose.rot), sn = Math.sin(-pose.rot);
    const px0 = CX + Math.round(13 * k), py0 = FEET - Math.round(4 * k); // where the feet end up
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x - px0, dy = y - py0;
        const sx = Math.round(cs * dx + sn * dy) + CX, sy = Math.round(-sn * dx + cs * dy) + FEET;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
        if (d[si + 3]) { out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = 255; }
      }
    d = out;
  }
  const res = outlined(d, W, H);
  if (pose.flash || pose.alpha < 1)
    for (let i = 0; i < res.length; i += 4) {
      if (!res[i + 3]) continue;
      if (pose.flash) { res[i] += (255 - res[i]) * 0.62; res[i + 1] += (255 - res[i + 1]) * 0.62; res[i + 2] += (255 - res[i + 2]) * 0.62; }
      res[i + 3] = Math.round(255 * pose.alpha);
    }
  return new ImageData(res, W, H);
}

/** Full sheet (or a single isolated layer). Rows: down, left, right, up. */
export function renderSheet(ap: Appearance, job: Job, only?: Layer): HTMLCanvasElement {
  const sheet = mk(SHEET_COLS * FRAME_W, 4 * FRAME_H);
  const sg = sheet.getContext('2d')!;
  const tmp = mk(FRAME_W, FRAME_H);
  const tg = tmp.getContext('2d', { willReadFrequently: true })!;
  const kind = (JOB_DEFS[job].weapons[ap.weapon] ?? JOB_DEFS[job].weapons[0]).kind;
  for (let dir = 0; dir < 4; dir++) {
    for (const anim of ANIM_NAMES) {
      for (let f = 0; f < ANIMS[anim].frames; f++) {
        const pose = poseFor(anim, f, kind);
        tg.clearRect(0, 0, FRAME_W, FRAME_H);
        const rig = composeFrame(tg, ap, job, dir === 1 ? 2 : dir, pose, only);
        tg.putImageData(finish(tg.getImageData(0, 0, FRAME_W, FRAME_H), pose), 0, 0);
        for (const fx of rig.fx) { // spell glow sits on top of the outline
          disc(tg, `rgba(${fx.col},0.28)`, fx.x, fx.y, fx.r + 3);
          disc(tg, `rgba(${fx.col},0.6)`, fx.x, fx.y, fx.r + 1);
          disc(tg, `rgb(${fx.col})`, fx.x, fx.y, Math.max(1, fx.r - 1));
          p1(tg, '#ffffff', fx.x - 1, fx.y - 1, 2, 2);
        }
        const dx = (ANIM_COL[anim] + f) * FRAME_W, dy = dir * FRAME_H;
        if (dir === 1) {
          sg.save();
          sg.translate(dx + FRAME_W, dy);
          sg.scale(-1, 1);
          sg.drawImage(tmp, 0, 0);
          sg.restore();
        } else sg.drawImage(tmp, dx, dy);
      }
    }
  }
  return sheet;
}

const sheets = new Map<string, HTMLCanvasElement>();
/** Cached composite sheet (LRU). */
export function getCharSheet(ap: Appearance, job: Job): HTMLCanvasElement {
  const key = appearanceKey(ap, job);
  let s = sheets.get(key);
  if (s) {
    sheets.delete(key);
    sheets.set(key, s);
    return s;
  }
  s = renderSheet(ap, job);
  if (sheets.size >= 160) sheets.delete(sheets.keys().next().value!);
  sheets.set(key, s);
  return s;
}

/** Sprite anchor: entity position is the collision centre; feet sit 9px below it. */
export const SPRITE_OX = FRAME_W / 2;
export const SPRITE_OY = FEET - 9;
/** Name plates sit this far above the collision centre. */
export const NAME_OY = 27;

const AURA = ['', '#ffe9a0', '#ff8a3a', '#bfe9ff', '#8a5fd0'];
/** Special-effects layer, drawn at render time (animated, not baked into the sheet). */
export function drawAura(g: G, kind: number, x: number, y: number, now: number, seed: number) {
  if (!kind) return;
  for (let i = 0; i < 6; i++) {
    const a = now / 520 + i * 1.047 + seed;
    let px = x + Math.cos(a) * 12, py = y - 10 + Math.sin(a * 1.3) * 12;
    if (kind === 2 || kind === 4) {
      const t = (now / 26 + i * 37 + seed * 9) % 34;
      px = x + Math.sin(i * 2.4 + seed) * 10;
      py = kind === 2 ? y + 8 - t : y - 26 + t;
    }
    const tw = Math.sin(a * 2.2);
    g.globalAlpha = 0.5 + 0.5 * tw;
    g.fillStyle = AURA[kind];
    const X = Math.round(px), Y = Math.round(py);
    if (kind === 1 || kind === 3) { g.fillRect(X, Y - 1, 1, 3); g.fillRect(X - 1, Y, 3, 1); } // twinkle cross
    else g.fillRect(X, Y, 2, 2);
  }
  g.globalAlpha = 1;
}
