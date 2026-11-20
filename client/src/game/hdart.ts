// HD world art: a detailed 2D tile renderer in high-detail pixel art. Same interface as art.ts
// (buildChunk -> ground + overlay canvases), so the game can switch between the two.
//  - ground is painted per pixel in world space: grass in soft patches, worn dirt paths, cobbles laid
//    stone by stone, water with depth, foam and shimmer; borders between them are organic, not tiled;
//  - layered on top: path edges and grass lips, tufts, flowers, pebbles and small decorations;
//  - cliffs (rock) with a lit top lip, strata and a contact shadow; timber houses with shingled roofs,
//    windows, doors and chimneys; big trees of clustered, light-shaded leaf balls with a dark outline.
import { TILE } from '../../../shared/src/protocol';
import { isRampart, T, tileAt, type ZoneMap } from '../../../shared/src/world';

type G = CanvasRenderingContext2D;
type RGB = [number, number, number];
const TS = TILE;
export const CHUNK = 16;
export const CHUNK_PX = CHUNK * TS;
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ------------------------------------------------------------------ colour: hue-shifted ramps
const toRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
function hsl(c: RGB): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
/** Five tones, dark to light. Shadows lean toward blue-violet, highlights toward warm yellow. */
export function ramp(hex: string, spread = 1): RGB[] {
  const [h, s, l] = hsl(toRgb(hex));
  const toward = (target: number, k: number) => h + ((((target - h) % 360) + 540) % 360 - 180) * k;
  return [
    fromHsl(toward(250, 0.12 * spread), s * 0.85, l - 0.19 * spread),
    fromHsl(toward(250, 0.05 * spread), s * 0.95, l - 0.09 * spread),
    toRgb(hex),
    fromHsl(toward(55, 0.1 * spread), s * 0.98, l + 0.08 * spread),
    fromHsl(toward(55, 0.2 * spread), s * 0.9, l + 0.16 * spread),
  ];
}

// ------------------------------------------------------------------ noise
const hash = (x: number, y: number, s = 0) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
const h01 = (x: number, y: number, s = 0) => hash(x, y, s) / 4294967296;
function vnoise(x: number, y: number, scale: number, s: number) {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = h01(ix, iy, s), b = h01(ix + 1, iy, s), c = h01(ix, iy + 1, s), d = h01(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, s = 0) => vnoise(x, y, 26, s) * 0.6 + vnoise(x, y, 9, s + 1) * 0.4;
/** Tileable noise tables (256x256), computed once: fbm, fine detail, jitter and two warp channels. */
let tables: { a: Float32Array; f: Float32Array; j: Float32Array; wx: Float32Array; wy: Float32Array } | null = null;
function noiseTables() {
  if (tables) return tables;
  const S = 256, pv = (x: number, y: number, scale: number, s: number) => { // periodic value noise
    const P = S / scale, fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), w = (v: number) => ((v % P) + P) % P;
    const a = h01(w(ix), w(iy), s), b = h01(w(ix + 1), w(iy), s), c = h01(w(ix), w(iy + 1), s), d = h01(w(ix + 1), w(iy + 1), s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const t = { a: new Float32Array(S * S), f: new Float32Array(S * S), j: new Float32Array(S * S), wx: new Float32Array(S * S), wy: new Float32Array(S * S) };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = y * S + x;
    t.a[k] = pv(x, y, 32, 1) * 0.6 + pv(x, y, 8, 2) * 0.4;
    t.f[k] = pv(x, y * 2, 16, 3);
    t.j[k] = h01(x, y, 4);
    t.wx[k] = pv(x, y, 32, 5) * 0.7 + pv(x, y, 8, 6) * 0.3;
    t.wy[k] = pv(x, y, 32, 7) * 0.7 + pv(x, y, 8, 8) * 0.3;
  }
  return (tables = t);
}
function rng(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------------ palettes per theme
type TreeKind = 'broad' | 'pine' | 'dead' | 'crystal' | 'pillar' | 'boulder';
interface Pal {
  grass: string; dirt: string; stone: string; mortar: string; water: string; deep: string; foam: string; bank: string;
  leaf: string; leaf2: string; trunk: string; rock: string; cliffTop: string; blades: boolean;
  /** Dungeon interiors: the open ground is a floor of stone slabs. */
  floor?: boolean;
  trees: TreeKind[]; flora: string[]; roofs: string[]; plaster: string; timber: string;
}
const KINGDOM: Pal = {
  grass: '#7fb04a', dirt: '#d2b077', stone: '#c3b8a2', mortar: '#7a6e64', water: '#3f86c8', deep: '#2a5c9c', foam: '#e8f6f4', bank: '#8a7448',
  leaf: '#4f9a3e', leaf2: '#7ab84c', trunk: '#7a5232', rock: '#8a8478', cliffTop: '#7fb04a', blades: true,
  trees: ['broad', 'broad', 'broad'], flora: ['#ffffff', '#ffe46a', '#ff9ac0', '#a8c8ff', '#ff7a5a'],
  roofs: ['#c8503a', '#3e6ab0', '#7a54a8', '#3a8a74', '#b07a3a'], plaster: '#eadcc0', timber: '#5e3e26',
};
const PALS: Record<string, Pal> = {
  kingdom: KINGDOM,
  forest: { ...KINGDOM, grass: '#5f9a44', leaf: '#2f7a3a', leaf2: '#5a9a44', trees: ['broad', 'pine', 'broad'] },
  ashen: { ...KINGDOM, grass: '#7a6c62', dirt: '#5a5052', stone: '#6a6062', mortar: '#2c2628', water: '#e2622a', deep: '#a83a18', foam: '#ffd27a', bank: '#2a2224', leaf: '#4a352a', leaf2: '#c9622a', trunk: '#2e221d', rock: '#5a4e4a', cliffTop: '#7a6c62', blades: false, trees: ['dead', 'boulder'], flora: ['#ffb44a', '#e2622a'] },
  frost: { ...KINGDOM, grass: '#e4eef6', dirt: '#b8c8d8', stone: '#c4d0de', mortar: '#7a8aa0', water: '#7fb8dc', deep: '#4a88b8', foam: '#ffffff', bank: '#9fb6cf', leaf: '#2e5c66', leaf2: '#e8f2f8', trunk: '#4a3a30', rock: '#8a9ab0', cliffTop: '#eef4fa', blades: false, trees: ['pine', 'pine', 'boulder'], flora: ['#b7dcf2', '#ffffff'] },
  moor: { ...KINGDOM, grass: '#5a6a48', dirt: '#6a5a45', stone: '#70705f', mortar: '#3a3a30', water: '#3d5a48', deep: '#24382c', foam: '#8fa878', bank: '#2c3326', leaf: '#35432f', leaf2: '#6f7a45', trunk: '#3a3024', rock: '#5a5a4e', cliffTop: '#5a6a48', trees: ['dead', 'broad', 'dead'], flora: ['#c9d08a', '#b08ad0'] },
  astral: { ...KINGDOM, grass: '#46407a', dirt: '#8a84a8', stone: '#9692b2', mortar: '#4c4868', water: '#1e1838', deep: '#100c22', foam: '#b9a2ff', bank: '#6a5fb0', leaf: '#6a56d0', leaf2: '#b9a2ff', trunk: '#3a2a6a', rock: '#5a5488', cliffTop: '#46407a', blades: false, trees: ['crystal', 'pillar', 'crystal'], flora: ['#e8dcff', '#7fd6ff'] },
  ruins: { ...KINGDOM, floor: true, grass: '#7a8070', dirt: '#8a8f80', stone: '#9a9e8e', mortar: '#55594e', water: '#2f6f66', deep: '#1e4a44', foam: '#9fd8cc', bank: '#4a4f44', leaf: '#575b50', leaf2: '#9ea392', trunk: '#4a4a40', rock: '#5a5e52', cliffTop: '#6a7060', blades: false, trees: ['pillar'], flora: ['#7fbf6a', '#9ad6c8'] },
  lair: { ...KINGDOM, floor: true, grass: '#5e4840', dirt: '#6c5248', stone: '#7e6458', mortar: '#3e2e28', water: '#e2622a', deep: '#a83a18', foam: '#ffd27a', bank: '#2a1c18', leaf: '#5c4034', leaf2: '#c98a5a', trunk: '#3a2a24', rock: '#4a3731', cliffTop: '#5e4840', blades: false, trees: ['boulder'], flora: ['#ffb44a'] },
  citadel: { ...KINGDOM, floor: true, grass: '#b0c8dc', dirt: '#8eabc4', stone: '#aac3d7', mortar: '#5f7f9c', water: '#5a9fd0', deep: '#3a7ab0', foam: '#ffffff', bank: '#6f93b4', leaf: '#5f8fb0', leaf2: '#c3e3f5', trunk: '#3a5068', rock: '#5f7f9c', cliffTop: '#b0c8dc', blades: false, trees: ['crystal', 'pillar'], flora: ['#c3e3f5'] },
  temple: { ...KINGDOM, floor: true, grass: '#46585d', dirt: '#566b70', stone: '#647a7f', mortar: '#2a3a3f', water: '#12202a', deep: '#0a141a', foam: '#2a8a7a', bank: '#1f2e33', leaf: '#4a6f74', leaf2: '#8fd0c4', trunk: '#2a3a3e', rock: '#34494e', cliffTop: '#46585d', blades: false, trees: ['pillar', 'boulder'], flora: ['#8fffe0'] },
};
interface Ramps { grass: RGB[]; dirt: RGB[]; stone: RGB[]; mortar: RGB; water: RGB[]; deep: RGB; foam: RGB; bank: RGB }
const rampCache = new Map<string, Ramps>();
function ramps(theme: string): Ramps {
  let r = rampCache.get(theme);
  if (!r) {
    const p = PALS[theme] ?? KINGDOM;
    r = { grass: ramp(p.grass, 0.8), dirt: ramp(p.dirt, 0.7), stone: ramp(p.stone, 0.8), mortar: toRgb(p.mortar), water: ramp(p.water, 0.7), deep: toRgb(p.deep), foam: toRgb(p.foam), bank: toRgb(p.bank) };
    rampCache.set(theme, r);
  }
  return r;
}

// ------------------------------------------------------------------ shaded shapes and outlines (for sprites)
const LX = -0.55, LY = -0.65, LZ = 0.52;
/** A ball lit from the upper left, in a ramp of tones; `dither` blends neighbouring tones in a checker. */
function ball(d: Uint8ClampedArray, W: number, cx: number, cy: number, rx: number, ry: number, rp: RGB[], bias = 0) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, q = nx * nx + ny * ny;
    if (q > 1 || x < 0 || y < 0 || x >= W) continue;
    const nz = Math.sqrt(1 - q), l = nx * LX + ny * LY + nz * LZ + bias;
    const f = (l + 0.6) / 1.5 * (rp.length - 1), k = Math.floor(f), fr = f - k;
    const idx = Math.max(0, Math.min(rp.length - 1, k + (fr > 0.5 + (((x + y) & 1) ? 0.18 : -0.18) ? 1 : 0)));
    const i = (y * W + x) * 4, c = rp[idx];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
}
/** Dark outline around every opaque shape, in a deep shade of the neighbouring colour. */
function outline(c: HTMLCanvasElement, ink: RGB = [36, 24, 30]) {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width, H = c.height, out = new Uint8ClampedArray(d);
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (op(x, y)) continue;
    const n = op(x + 1, y) ? x + 1 : op(x - 1, y) ? x - 1 : -1, m = op(x, y + 1) ? y + 1 : op(x, y - 1) ? y - 1 : -1;
    if (n < 0 && m < 0) continue;
    const j = n >= 0 ? (y * W + n) * 4 : (m * W + x) * 4;
    out[i] = Math.round(d[j] * 0.25 + ink[0] * 0.75); out[i + 1] = Math.round(d[j + 1] * 0.25 + ink[1] * 0.75); out[i + 2] = Math.round(d[j + 2] * 0.25 + ink[2] * 0.75); out[i + 3] = 255;
  }
  g.putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}

// ------------------------------------------------------------------ trees and big decorations
interface Spr { img: HTMLCanvasElement; fx: number; fy: number } // fx, fy: the foot point
const treeCache = new Map<string, Spr[]>();
function treeSprites(theme: string): Spr[] {
  let list = treeCache.get(theme);
  if (list) return list;
  const p = PALS[theme] ?? KINGDOM;
  list = [];
  for (let v = 0; v < 6; v++) {
    const kind = p.trees[v % p.trees.length], r = rng(hash(v, theme.length, 77));
    const W = 72, H = 88, c = mk(W, H), g = c.getContext('2d', { willReadFrequently: true })!, img = g.createImageData(W, H), d = img.data;
    const leaf = ramp(v % 2 ? p.leaf : mix(p.leaf, p.leaf2, 0.35), 1.1), bark = ramp(p.trunk, 0.9), fx = 36, fy = 84;
    if (kind === 'broad') {
      for (let y = 52; y < fy; y++) { const w = 4 + (y > fy - 6 ? (y - fy + 6) : 0); for (let x = fx - w; x <= fx + w; x++) { const i = (y * W + x) * 4, k = x < fx - w / 2 ? 3 : x > fx + w / 3 ? 0 : 1, cc = bark[k]; d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255; } }
      const blobs: [number, number, number][] = [];
      for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, rr = r() * 14; blobs.push([fx + Math.cos(a) * rr * 1.3, 34 + Math.sin(a) * rr * 0.8 + (i < 3 ? 6 : 0), 11 + r() * 6]); }
      blobs.push([fx, 22, 14]); blobs.push([fx - 12, 38, 12]); blobs.push([fx + 13, 37, 12]);
      blobs.sort((a, b) => a[1] - b[1]);
      for (const [x, y, rad] of blobs) ball(d, W, x, y, rad, rad * 0.86, leaf, (y - 34) * -0.012);
      leafClusters(d, W, H, leaf, r);
    } else if (kind === 'pine') {
      for (let y = 66; y < fy; y++) for (let x = fx - 3; x <= fx + 3; x++) { const i = (y * W + x) * 4, cc = bark[x < fx ? 3 : 1]; d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255; }
      for (let t = 0; t < 5; t++) {
        const top = 6 + t * 12, hgt = 22, half = 10 + t * 5;
        for (let y = top; y < top + hgt; y++) {
          const w = Math.round(half * (y - top) / hgt);
          for (let x = fx - w; x <= fx + w; x++) {
            const nx = (x - fx) / Math.max(1, w), l = -nx * 0.6 + (1 - (y - top) / hgt) * 0.5 + ((x + y) & 1 ? 0.06 : -0.06);
            const k = Math.max(0, Math.min(4, Math.floor((l + 0.6) * 2.6))), i = (y * W + x) * 4, cc = leaf[k];
            d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255;
          }
        }
      }
      if (theme === 'frost') leafClusters(d, W, H, ramp('#f4f8fc', 0.4), r, 0.5);
    } else if (kind === 'dead') {
      g.putImageData(img, 0, 0);
      g.strokeStyle = css(bark[1]); g.lineCap = 'square';
      const branch = (x: number, y: number, a: number, len: number, w: number) => {
        if (len < 4) return;
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        g.lineWidth = w; g.strokeStyle = css(bark[w > 3 ? 1 : 2]); g.beginPath(); g.moveTo(Math.round(x), Math.round(y)); g.lineTo(Math.round(x2), Math.round(y2)); g.stroke();
        branch(x2, y2, a - 0.4 - r() * 0.3, len * 0.7, Math.max(1, w - 1.5));
        branch(x2, y2, a + 0.4 + r() * 0.3, len * 0.68, Math.max(1, w - 1.5));
      };
      branch(fx, fy, -Math.PI / 2, 26, 6);
      if (p.leaf2.startsWith('#c9')) { for (let i = 0; i < 8; i++) { g.fillStyle = r() < 0.5 ? '#ffb44a' : '#c9622a'; g.fillRect(fx - 20 + r() * 40, 18 + r() * 30, 2, 2); } }
      outline(c); list.push({ img: c, fx, fy }); continue;
    } else if (kind === 'crystal') {
      const cr = ramp(v % 2 ? p.leaf : p.leaf2, 1);
      for (const [ox, hgt, w] of [[0, 60, 9], [-12, 38, 6], [12, 44, 7], [-5, 26, 5]] as const) {
        for (let y = fy - hgt; y < fy - 2; y++) {
          const t = (y - (fy - hgt)) / hgt, half = Math.round(w * Math.min(1, t * 3));
          for (let x = fx + ox - half; x <= fx + ox + half; x++) { const k = x < fx + ox ? 4 : x === fx + ox ? 3 : 1, i = (y * W + x) * 4, cc = cr[k - (t > 0.85 ? 1 : 0)]; d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255; }
        }
      }
    } else if (kind === 'pillar') {
      const st = ramp(p.stone, 0.9);
      for (let y = 20; y < fy; y++) for (let x = fx - 9; x <= fx + 9; x++) {
        const cap = y < 26 || y > fy - 6, w = cap ? 11 : 8;
        if (Math.abs(x - fx) > w) continue;
        const flute = !cap && ((x - fx + 9) % 4 === 0), k = cap ? (y < 22 || y > fy - 3 ? 4 : 2) : x < fx - 4 ? 3 : x > fx + 4 ? 1 : flute ? 1 : 2;
        const i = (y * W + x) * 4, cc = st[k]; d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255;
      }
      leafClusters(d, W, H, ramp('#5a8a44', 0.6), r, 0.15);
    } else {
      ball(d, W, fx, fy - 12, 16, 12, ramp(p.rock, 0.9));
      ball(d, W, fx + 10, fy - 7, 9, 7, ramp(p.rock, 0.9));
    }
    g.putImageData(img, 0, 0);
    outline(c);
    list.push({ img: c, fx, fy });
  }
  treeCache.set(theme, list);
  return list;
}
function mix(a: string, b: string, k: number) {
  const x = toRgb(a), y = toRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
/** Leaf texture: small lit clumps on top, a dark notch beneath, only on already-painted pixels. */
function leafClusters(d: Uint8ClampedArray, W: number, H: number, rp: RGB[], r: () => number, density = 1) {
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
  const set = (x: number, y: number, c: RGB) => { if (!op(x, y)) return; const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; };
  for (let n = 0; n < 160 * density; n++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (!op(x, y) || !op(x, y - 3)) continue;
    const lit = r() < 0.55 - y / H * 0.4;
    const c = lit ? rp[Math.min(4, 3 + (r() < 0.3 ? 1 : 0))] : rp[1];
    set(x, y, c); set(x + 1, y, c); set(x - 1, y + 1, c); set(x + 2, y + 1, c);
    set(x, y + 1, rp[lit ? 2 : 0]); set(x + 1, y + 1, rp[lit ? 2 : 0]); set(x, y + 2, rp[0]);
  }
}

// ------------------------------------------------------------------ small decorations
const decoCache = new Map<string, HTMLCanvasElement[]>();
function decos(theme: string): HTMLCanvasElement[] {
  let list = decoCache.get(theme);
  if (list) return list;
  const p = PALS[theme] ?? KINGDOM;
  list = [];
  const make = (w: number, h: number, f: (d: Uint8ClampedArray, g: G) => void) => {
    const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true })!, img = g.createImageData(w, h); f(img.data, g); g.putImageData(img, 0, 0); outline(c); list!.push(c);
  };
  make(18, 14, (d) => { ball(d, 18, 8, 8, 6, 4.5, ramp(p.rock, 0.8)); ball(d, 18, 12, 9, 4, 3, ramp(p.rock, 0.8)); }); // stones
  make(24, 18, (d) => { const lr = ramp(p.leaf, 1); ball(d, 24, 8, 10, 7, 6, lr); ball(d, 24, 15, 9, 7, 6.5, lr); ball(d, 24, 12, 6, 6, 5, lr); leafClusters(d, 24, 18, lr, rng(5), 0.3); }); // a bush
  make(14, 14, (d) => { // mushrooms
    ball(d, 14, 5, 6, 4, 3, ramp('#d24a3a', 0.8)); ball(d, 14, 10, 8, 3, 2.4, ramp('#d8a040', 0.8));
    for (const [x, y] of [[4, 5], [6, 4]]) { const i = (y * 14 + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
    for (let y = 8; y < 12; y++) { const i = (y * 14 + 5) * 4; d[i] = 238; d[i + 1] = 226; d[i + 2] = 200; d[i + 3] = 255; const j = (y * 14 + 10) * 4; if (y > 9) { d[j] = 238; d[j + 1] = 226; d[j + 2] = 200; d[j + 3] = 255; } }
  });
  make(22, 12, (d) => { const b = ramp(p.trunk, 0.9); for (let y = 3; y < 9; y++) for (let x = 2; x < 20; x++) { const i = (y * 22 + x) * 4, c = b[y < 5 ? 3 : y > 7 ? 0 : 2]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } ball(d, 22, 19, 6, 2.5, 3, ramp(mix(p.trunk, '#e8d0a0', 0.5), 0.6)); }); // a log
  decoCache.set(theme, list);
  return list;
}

// ------------------------------------------------------------------ the chunk
export interface Chunk {
  ground: HTMLCanvasElement;
  over: HTMLCanvasElement | null;
  /** Style B: trees to stand up as billboards (map pixels; x, y the top-left, footY the row they stand on). */
  trees?: { img: HTMLCanvasElement; x: number; y: number; footY: number }[];
}
const isW = (t: T) => t === T.Water, isPl = (t: T) => t === T.Plaza || t === T.Portal || t === T.Gate || t === T.Block, isPa = (t: T) => t === T.Path;

/**
 * `stage`: the chunk is for the 3D stage (style B). Buildings are left out (the stage raises them as
 * blocks), wall shadows are not painted (the sun casts real ones) and trees are listed, not painted.
 */
export function buildChunk(map: ZoneMap, cx: number, cy: number, stage = false): Chunk {
  const theme = map.def.theme, p = PALS[theme] ?? KINGDOM, R = ramps(theme);
  const ground = mk(CHUNK_PX, CHUNK_PX), g = ground.getContext('2d', { willReadFrequently: true })!;
  const x0 = cx * CHUNK, y0 = cy * CHUNK, M = CHUNK + 4;
  // tile grid with a 2-tile margin
  const grid = new Uint8Array(M * M);
  for (let ty = 0; ty < M; ty++) for (let tx = 0; tx < M; tx++) grid[ty * M + tx] = tileAt(map, x0 + tx - 2, y0 + ty - 2);
  const at = (tx: number, ty: number) => grid[(ty + 2) * M + tx + 2] as T; // chunk-local tile coords
  // tile classes: 0 grass, 1 path, 2 plaza, 3 water, 4 solid (drawn later)
  const cls = new Uint8Array(M * M);
  for (let k = 0; k < M * M; k++) { const t = grid[k] as T; cls[k] = isW(t) ? 3 : isPl(t) ? 2 : isPa(t) ? 1 : t === T.Rock ? 4 : 0; }
  const clsAt = (tx: number, ty: number) => cls[(Math.max(-2, Math.min(CHUNK + 1, ty)) + 2) * M + Math.max(-2, Math.min(CHUNK + 1, tx)) + 2];
  const uni = new Uint8Array(CHUNK * CHUNK); // 1 when the tile and its 8 neighbours share a class
  for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
    const c0 = clsAt(tx, ty); let u = 1;
    for (let dy = -1; dy <= 1 && u; dy++) for (let dx = -1; dx <= 1; dx++) if (clsAt(tx + dx, ty + dy) !== c0) { u = 0; break; }
    uni[ty * CHUNK + tx] = u;
  }
  // a smooth field (bilinear blend of tile-centre indicators) for one class, at a warped position
  const field = (sx: number, sy: number, c: number) => {
    const fx = sx / TS - 0.5, fy = sy / TS - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const a = +(clsAt(ix, iy) === c), b = +(clsAt(ix + 1, iy) === c), cc = +(clsAt(ix, iy + 1) === c), d = +(clsAt(ix + 1, iy + 1) === c);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + cc * (1 - tx) * ty + d * tx * ty;
  };
  const N = noiseTables();
  const img = g.createImageData(CHUNK_PX, CHUNK_PX), d = img.data;
  const set = (i: number, c: RGB) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  const pick5 = [0, 1, 1, 2, 2, 2, 3, 3, 4], moss = ramp(p.leaf2, 0.6)[1];
  for (let ly = 0; ly < CHUNK_PX; ly++) for (let lx = 0; lx < CHUNK_PX; lx++) {
    const X = x0 * TS + lx, Y = y0 * TS + ly, i = (ly * CHUNK_PX + lx) * 4, tx = lx >> 5, ty = ly >> 5;
    if (clsAt(tx, ty) === 4) continue;
    const q = ((Y & 255) << 8) | (X & 255), n = N.a[q], jit = N.j[q];
    let c = clsAt(tx, ty), edge = 1; // edge: 0 at a border, 1 deep inside
    if (!uni[ty * CHUNK + tx]) {
      const sx = lx + (N.wx[q] - 0.5) * 18, sy = ly + (N.wy[q] - 0.5) * 18;
      const fw = field(sx, sy, 3), fpl = field(sx, sy, 2), fpa = field(sx, sy, 1);
      if (fw > 0.5) { c = 3; edge = (fw - 0.5) * 2; }
      else if (fw > 0.42) { set(i, R.bank); continue; }
      else if (fpl > 0.5) { c = 2; edge = (fpl - 0.5) * 2; }
      else if (fpa > 0.5) { c = 1; edge = (fpa - 0.5) * 2; }
      else { c = 0; edge = Math.min(1, (0.5 - Math.max(fpa, fpl)) * 2); }
    }
    if (c === 3) { // water: foam, shallows, depth, shimmer
      if (edge < 0.07) set(i, R.foam);
      else if (edge < 0.2) set(i, R.water[3]);
      else {
        set(i, edge > 0.75 && n < 0.55 ? R.deep : R.water[Math.min(2, Math.floor(N.f[q] * 3))]);
        if (Y % 5 === 0 && N.f[(q + 31 * (Y % 3)) & 65535] > 0.8) set(i, R.water[4]);
      }
    } else if (c === 2) { // cobbles of varied sizes, laid row by row
      // irregular rounded cobbles: jittered cells; joints where the two nearest stones meet
      const C = 12, gx = Math.floor(X / C), gy = Math.floor(Y / C);
      let d1 = 1e9, d2 = 1e9, ox = 0, oy = 0, id = 0;
      for (let cy2 = gy - 1; cy2 <= gy + 1; cy2++) for (let cx2 = gx - 1; cx2 <= gx + 1; cx2++) {
        const hh = hash(cx2, cy2, 17), px2 = cx2 * C + 2 + (hh & 7), py2 = cy2 * C + 2 + ((hh >> 3) & 7);
        const dd = (X - px2) * (X - px2) + (Y - py2) * (Y - py2) * 1.25;
        if (dd < d1) { d2 = d1; d1 = dd; ox = X - px2; oy = Y - py2; id = hh; } else if (dd < d2) d2 = dd;
      }
      const gap = Math.sqrt(d2) - Math.sqrt(d1);
      if (gap < 1.6 || edge < 0.06) { set(i, n < 0.3 && jit < 0.3 ? R.grass[1] : R.mortar); continue; }
      const r1 = Math.sqrt(d1) + 0.01, lit = -(ox + oy * 1.2) / r1; // light from the upper left
      let k = 2 + ((id >> 7) % 4 === 0 ? -1 : (id >> 7) % 4 === 1 ? 1 : 0);
      if (gap < 3) k += lit > 0.3 ? 1 : lit < -0.3 ? -1 : 0;
      if (jit < 0.05) k -= 1;
      set(i, R.stone[Math.max(0, Math.min(4, k))]);
    } else if (c === 1) { // dirt path with a worn rim
      set(i, R.dirt[edge < 0.05 ? 0 : edge < 0.12 ? 1 : pick5[Math.max(0, Math.min(8, Math.floor((n * 0.8 + jit * 0.45) * 9 - 1)))]]);
    } else if (p.floor) { // stone floors: big slabs with faint seams, cracks and moss
      const sr = Math.floor(Y / 32), so = (sr & 1) * 16, sc = Math.floor((X + so) / 32), sx = (X + so) % 32, sy = Y % 32, tv = hash(sc, sr, 3) % 3;
      let k = pick5[Math.max(0, Math.min(8, Math.floor((n * 0.6 + jit * 0.3) * 9)))] + (tv === 0 ? -1 : tv === 1 ? 0 : 1) * 0;
      if (sx === 0 || sy === 0) k = 0; else if (sx === 1 || sy === 1) k = 3;
      if (hash(sc, sr, 7) % 5 === 0 && Math.abs((sx - 16) - (sy - 16) * 0.6 + (sy >> 3)) < 0.8) k = 0;
      set(i, R.grass[Math.max(0, Math.min(4, k + (tv - 1) * (k > 0 && k < 4 ? 1 : 0)))]);
      if (n < 0.22 && jit < 0.12) set(i, moss);
    } else { // grass
      const macro = (vnoise(X, Y, 110, 17) - 0.5) * 2.6 + (vnoise(X, Y, 41, 23) - 0.5) * 1.2; // meadow patches
      set(i, R.grass[pick5[Math.max(0, Math.min(8, Math.floor((n * 0.85 + jit * 0.35) * 9 - 0.6 + macro)))]]);
      if (edge < 0.07) set(i, R.grass[4]); // a lit lip where grass meets path or stone
    }
  }
  g.putImageData(img, 0, 0);

  // decals: tufts and flowers on grass, pebbles on paths
  const rr = rng(hash(cx, cy, 99));
  for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
    const t = at(tx, ty), ox = tx * TS, oy = ty * TS;
    if (t === T.Grass || t === T.Flower || t === T.Tree) {
      if (p.blades) for (let k = 0; k < 4; k++) tuft(g, ox + 3 + Math.floor(rr() * 26), oy + 4 + Math.floor(rr() * 26), R.grass, rr);
      const flowers = t === T.Flower ? 7 : rr() < 0.12 ? 2 : 0;
      for (let k = 0; k < flowers; k++) flower(g, ox + 3 + Math.floor(rr() * 26), oy + 4 + Math.floor(rr() * 25), p.flora[Math.floor(rr() * p.flora.length)], R.grass);
      if (t === T.Grass && rr() < 0.05) { const dl = decos(theme), s = dl[Math.floor(rr() * dl.length)]; g.drawImage(s, ox + Math.floor(rr() * (TS - s.width)), oy + Math.floor(rr() * (TS - s.height))); }
      if (t === T.Grass) {
        if (rr() < 0.22) { // a clover patch: a few dark leaves with a pale heart
          const x = ox + 5 + Math.floor(rr() * 22), y = oy + 6 + Math.floor(rr() * 20);
          g.fillStyle = css(R.grass[0]);
          for (const [dx, dy] of [[0, 0], [2, 1], [-2, 1], [1, 3], [-1, -2], [3, -1]]) g.fillRect(x + dx, y + dy, 2, 2);
          g.fillStyle = css(R.grass[4]); g.fillRect(x, y, 1, 1); g.fillRect(x + 2, y + 1, 1, 1);
        }
        if (rr() < 0.16) { // a pebble or two, lit from the upper left
          for (let k = 0; k < 1 + Math.floor(rr() * 2); k++) {
            const x = ox + 4 + Math.floor(rr() * 24), y = oy + 6 + Math.floor(rr() * 22);
            g.fillStyle = 'rgba(20,24,30,0.3)'; g.fillRect(x, y + 2, 4, 1);
            g.fillStyle = css(R.stone[2]); g.fillRect(x, y, 3, 2);
            g.fillStyle = css(R.stone[4]); g.fillRect(x, y, 2, 1);
            g.fillStyle = css(R.stone[0]); g.fillRect(x + 2, y + 1, 1, 1);
          }
        }
        if (rr() < 0.14) { // fallen leaves
          for (let k = 0; k < 2 + Math.floor(rr() * 3); k++) {
            const x = ox + 3 + Math.floor(rr() * 26), y = oy + 4 + Math.floor(rr() * 24);
            g.fillStyle = p.flora[Math.floor(rr() * p.flora.length)]; g.globalAlpha = 0.75; g.fillRect(x, y, 2, 1); g.fillRect(x + 1, y + 1, 1, 1); g.globalAlpha = 1;
          }
        }
      }
    } else if (t === T.Path) {
      if (rr() < 0.07) { // a shallow puddle that catches the sky
        const x = ox + 9 + Math.floor(rr() * 12), y = oy + 10 + Math.floor(rr() * 12), w = 6 + Math.floor(rr() * 6);
        g.fillStyle = css(R.dirt[0]); g.beginPath(); g.ellipse(x, y, w, w * 0.45, 0, 0, 7); g.fill();
        g.fillStyle = css(R.water[2]); g.globalAlpha = 0.75; g.beginPath(); g.ellipse(x, y, w - 1.5, w * 0.45 - 1, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        g.fillStyle = css(R.foam); g.fillRect(x - Math.floor(w / 2), y - 1, Math.max(2, Math.floor(w / 2)), 1);
      }
      if (rr() < 0.3) { // a rut worn by carts
        const x = ox + Math.floor(rr() * 20), y = oy + 6 + Math.floor(rr() * 20);
        g.fillStyle = css(R.dirt[1]); g.fillRect(x, y, 9 + Math.floor(rr() * 8), 1);
      }
      for (let k = 0; k < 3; k++) { const x = ox + Math.floor(rr() * 30), y = oy + Math.floor(rr() * 30); g.fillStyle = css(R.dirt[0]); g.fillRect(x, y + 1, 3, 1); g.fillStyle = css(R.dirt[4]); g.fillRect(x, y, 2, 1); }
    } else if (t === T.Portal || t === T.Gate) runeCircle(g, ox + 16, oy + 16, t === T.Portal ? '#7ae0ff' : '#ffb04a');
  }
  // cliffs, buildings
  for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
    const t = at(tx, ty), ox = tx * TS, oy = ty * TS, wx = x0 + tx, wy = y0 + ty;
    if (t === T.Rock) cliff(g, map, wx, wy, ox, oy, p);
    else if (t === T.Wall || t === T.Roof) { if (!stage) building(g, map, wx, wy, ox, oy, t, p); }
    else if (!stage) {
      // soft shadows cast by walls and cliffs (light from the upper left)
      const above = at(tx, ty - 1), left = at(tx - 1, ty);
      if (above === T.Wall || above === T.Rock) shadeRect(g, ox, oy, TS, 7, 'down');
      if (left === T.Wall || left === T.Rock) shadeRect(g, ox, oy, 6, TS, 'right');
    }
  }
  // trees: a ground part (shadow and lower body) and an overlay part (everything above the tile's top)
  const trees = treeSprites(theme);
  let over: HTMLCanvasElement | null = null, og: G | null = null;
  const list: NonNullable<Chunk['trees']> = [];
  for (let ty = -2; ty <= CHUNK + 1; ty++) for (let tx = -2; tx <= CHUNK + 1; tx++) {
    if (at(tx, ty) !== T.Tree) continue;
    const wx = x0 + tx, wy = y0 + ty, h = hash(wx, wy, 5), s = trees[h % trees.length];
    const footX = tx * TS + 16 + ((h >> 4) % 7) - 3, footY = ty * TS + 28 + ((h >> 8) % 3);
    const dx = footX - s.fx, dy = footY - s.fy, cut = ty * TS - dy; // sprite row at the tile's top edge
    if (stage) { // each tree once, by the chunk that holds its tile
      if (tx >= 0 && ty >= 0 && tx < CHUNK && ty < CHUNK) list.push({ img: s.img, x: x0 * TS + dx, y: y0 * TS + dy, footY: y0 * TS + footY });
      continue;
    }
    g.fillStyle = 'rgba(30,40,40,0.28)';
    g.beginPath(); g.ellipse(footX + 6, footY - 2, 20, 7, 0, 0, 7); g.fill();
    if (cut < s.img.height) g.drawImage(s.img, 0, Math.max(0, cut), s.img.width, s.img.height - Math.max(0, cut), dx, dy + Math.max(0, cut), s.img.width, s.img.height - Math.max(0, cut));
    if (cut > 0) {
      if (!over) { over = mk(CHUNK_PX, CHUNK_PX); og = over.getContext('2d')!; }
      og!.drawImage(s.img, 0, 0, s.img.width, Math.min(cut, s.img.height), dx, dy, s.img.width, Math.min(cut, s.img.height));
    }
  }
  return stage ? { ground, over: null, trees: list } : { ground, over };
}

/**
 * Style B: the painted faces of one building, for the stage's 3D blocks. The canvas covers the tile
 * rectangle (tx0, ty0) to (tx1, ty1) inclusive, each Roof and Wall tile painted as on the flat map.
 */
export function paintBuilding(map: ZoneMap, tx0: number, ty0: number, tx1: number, ty1: number): HTMLCanvasElement {
  const p = PALS[map.def.theme] ?? KINGDOM, c = mk((tx1 - tx0 + 1) * TS, (ty1 - ty0 + 1) * TS), g = c.getContext('2d', { willReadFrequently: true })!;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = tileAt(map, tx, ty);
    if (t === T.Wall || t === T.Roof) building(g, map, tx, ty, (tx - tx0) * TS, (ty - ty0) * TS, t, p);
  }
  return c;
}

function tuft(g: G, x: number, y: number, rp: RGB[], r: () => number) {
  const n = 2 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const bx = x + k * 2 - n, h = 2 + Math.floor(r() * 3);
    g.fillStyle = css(rp[0]); g.fillRect(bx, y - h + 2, 1, h);
    g.fillStyle = css(rp[4]); g.fillRect(bx + (k < n / 2 ? -1 : 1) * (h > 3 ? 1 : 0), y - h + 1, 1, 1);
  }
  g.fillStyle = css(rp[1]); g.fillRect(x - n, y + 2, n * 2, 1);
}
function flower(g: G, x: number, y: number, col: string, rp: RGB[]) {
  g.fillStyle = css(rp[0]); g.fillRect(x, y + 2, 1, 3);
  g.fillStyle = css(rp[1]); g.fillRect(x + 1, y + 3, 2, 1);
  const c = toRgb(col), dark = css([c[0] * 0.7, c[1] * 0.7, c[2] * 0.75] as RGB);
  g.fillStyle = col; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
  g.fillStyle = dark; g.fillRect(x + 1, y + 1, 1, 1);
  g.fillStyle = '#ffe680'; g.fillRect(x, y, 1, 1);
}
function shadeRect(g: G, x: number, y: number, w: number, h: number, dir: 'down' | 'right') {
  const gr = dir === 'down' ? g.createLinearGradient(0, y, 0, y + h) : g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(24,20,40,0.34)'); gr.addColorStop(1, 'rgba(24,20,40,0)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}
function runeCircle(g: G, cx: number, cy: number, col: string) {
  g.save();
  g.strokeStyle = col; g.globalAlpha = 0.9; g.lineWidth = 1;
  for (const r of [13, 9]) { g.beginPath(); g.ellipse(cx + 0.5, cy + 0.5, r, r * 0.6, 0, 0, 7); g.stroke(); }
  g.fillStyle = col;
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(a) * 11), Math.round(cy + Math.sin(a) * 6.6), 2, 2); }
  g.globalAlpha = 0.25; g.beginPath(); g.ellipse(cx, cy, 8, 5, 0, 0, 7); g.fill();
  g.restore();
}

/** A rock tile: a textured top, and where open ground lies below, a cliff face with strata. */
function cliff(g: G, map: ZoneMap, wx: number, wy: number, ox: number, oy: number, p: Pal) {
  const top = ramp(p.cliffTop, 0.7), face = ramp(p.rock, 0.9), below = tileAt(map, wx, wy + 1), isFace = below !== T.Rock && wy + 1 < map.h;
  const img = g.getImageData(ox, oy, TS, TS), d = img.data;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const X = wx * TS + x, Y = wy * TS + y, i = (y * TS + x) * 4, n = fbm(X, Y, 40), j = h01(X, Y, 41);
    let c: RGB;
    if (isFace && y >= 10) {
      const band = Math.floor((Y + Math.sin(X * 0.35) * 2) / 5) % 3, crack = (X + (Y >> 3) * 5) % 13 === 0;
      c = face[crack ? 0 : y > 27 ? 0 : y < 13 ? 3 : [2, 1, 2][band] + (j < 0.1 ? -1 : 0)];
      if (y > 24) c = face[Math.max(0, (y > 28 ? 0 : 1))];
    } else if (isFace && y >= 7) c = top[y === 7 ? 4 : y === 9 ? 0 : 3]; // the lit rim
    else c = top[Math.max(0, Math.min(4, Math.floor((n * 0.8 + j * 0.4) * 5 - 0.6)))];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  g.putImageData(img, ox, oy);
  if (isFace && p.blades) for (let x = 0; x < TS; x += 2) { const h = 1 + (hash(wx * TS + x, wy, 42) % 4); g.fillStyle = css(top[2]); g.fillRect(ox + x, oy + 9, 2, h); g.fillStyle = css(top[0]); g.fillRect(ox + x, oy + 9 + h, 2, 1); }
}

/** Houses: timber-framed plaster walls with windows and a door; shingled roofs with a ridge and an eave. */
/** A city wall: a walkway of flagstones behind battlements on top, coursed stone on the face. */
function rampart(g: G, map: ZoneMap, wx: number, wy: number, ox: number, oy: number, t: T, p: Pal) {
  const st = ramp(p.stone, 0.85), img = g.getImageData(ox, oy, TS, TS), d = img.data;
  const set = (x: number, y: number, c: RGB) => { const i = (y * TS + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  const isWall = (dx: number, dy: number) => { const q = tileAt(map, wx + dx, wy + dy); return q === T.Roof || q === T.Wall; };
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const X = wx * TS + x, Y = wy * TS + y, j = h01(X >> 1, Y >> 1, 77);
    let c: RGB;
    if (t === T.Roof) {
      // the walkway: flagstones; merlons along every outer edge
      const edgeN = !isWall(0, -1) && y < 7, edgeS = tileAt(map, wx, wy + 1) !== T.Roof && tileAt(map, wx, wy + 1) !== T.Wall && y > 24, edgeW = !isWall(-1, 0) && x < 6, edgeE = !isWall(1, 0) && x > 25;
      const merlon = ((edgeN || edgeS) && (X >> 3) % 2 === 0) || ((edgeW || edgeE) && (Y >> 3) % 2 === 0);
      const fx = (X + ((Y >> 4) & 1) * 8) % 16, fy = Y % 16;
      c = st[fx === 0 || fy === 0 ? 1 : j < 0.12 ? 2 : 3];
      if (edgeN || edgeS || edgeW || edgeE) c = merlon ? st[4] : st[1];
      if (merlon && ((edgeN && y === 6) || (edgeW && x === 5))) c = st[0];
    } else {
      // the face: courses of dressed stone, darker toward the ground, a lit lip under the parapet
      const row = Math.floor(Y / 8), bx2 = (X + (row & 1) * 8) % 16, by2 = Y % 8;
      c = st[by2 === 7 || bx2 === 0 ? 0 : by2 === 0 ? 3 : j < 0.1 ? 1 : 2];
      if (tileAt(map, wx, wy - 1) === T.Roof && y < 3) c = st[y === 0 ? 4 : 0];
      if (tileAt(map, wx, wy + 1) !== T.Wall && y > 26) c = st[0];
    }
    set(x, y, c);
  }
  g.putImageData(img, ox, oy);
}

function building(g: G, map: ZoneMap, wx: number, wy: number, ox: number, oy: number, t: T, p: Pal) {
  if (isRampart(map.def.id, wx, wy, map.w)) return rampart(g, map, wx, wy, ox, oy, t, p);
  const at = (dx: number, dy: number) => tileAt(map, wx + dx, wy + dy);
  // identify the building by the top-left of its roof, to colour it
  let bx = wx, by = wy;
  while (tileAt(map, bx, by - 1) === T.Roof || tileAt(map, bx, by - 1) === T.Wall) by--;
  while (tileAt(map, bx - 1, by) === T.Roof) bx--;
  const rf = ramp(p.roofs[hash(bx, by, 7) % p.roofs.length], 1), img = g.getImageData(ox, oy, TS, TS), d = img.data;
  const set = (x: number, y: number, c: RGB) => { const i = (y * TS + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  const mossC = ramp(p.leaf2, 0.6)[1], ivy = ramp(p.leaf, 0.9);
  if (t === T.Roof) {
    const ridge = at(0, -1) !== T.Roof, eave = at(0, 1) !== T.Roof, L = at(-1, 0) !== T.Roof, Rt = at(1, 0) !== T.Roof;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const X = wx * TS + x, Y = wy * TS + y, row = Math.floor(Y / 6), sx = (X + (row & 1) * 4) % 8, sy = Y % 6;
      let k = sy === 5 ? 0 : sy === 0 ? 3 : sx === 0 ? 1 : 2;
      if (sy === 4 && (sx === 1 || sx === 7)) k = 1; // rounded shingle ends
      if (k === 2 && Y % 6 < 3) k = 3 - (((X >> 3) + row) % 4 === 0 ? 1 : 0); // light upper half of each shingle
      const shingle = hash((X + (row & 1) * 4) >> 3, row, 41) % 100;
      if (shingle < 9 && k > 0) k--; // a weathered shingle here and there
      else if (shingle > 93 && k < 4 && k > 0) k++; // and a newer, paler one
      let c = rf[k];
      if (hash(bx, by, 43) % 3 === 0 && h01(X >> 2, Y >> 2, 44) < 0.07 && k > 0) c = mossC; // moss on the older roofs
      if (ridge && y < 6) c = y < 2 ? rf[4] : y === 5 ? rf[0] : rf[3];
      if (eave && y > 25) c = y > 29 ? [40, 28, 34] : y === 26 ? rf[4] : rf[1];
      if (L && x < 2) c = x === 0 ? rf[0] : rf[4];
      if (Rt && x > 29) c = x === 31 ? [40, 28, 34] : rf[0];
      set(x, y, c);
    }
    g.putImageData(img, ox, oy);
    if (ridge && hash(bx, by, 9) % 2 === 0 && wx === bx + 1) { // a chimney
      const st = ramp(p.rock, 0.8);
      g.fillStyle = css(st[2]); g.fillRect(ox + 10, oy - 10, 10, 16); g.fillStyle = css(st[3]); g.fillRect(ox + 10, oy - 10, 3, 16);
      g.fillStyle = css(st[0]); g.fillRect(ox + 18, oy - 10, 2, 16); g.fillStyle = css(st[4]); g.fillRect(ox + 9, oy - 12, 12, 3);
      g.fillStyle = '#24181e'; g.fillRect(ox + 9, oy - 13, 12, 1);
    }
    return;
  }
  let l = wx, r = wx;
  while (tileAt(map, l - 1, wy) === T.Wall) l--;
  while (tileAt(map, r + 1, wy) === T.Wall) r++;
  const topRow = at(0, -1) !== T.Wall, mid = (l + r) >> 1, pl = ramp(p.plaster, 0.5), tb = ramp(p.timber, 0.8);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const X = wx * TS + x, Y = wy * TS + y;
    let c = pl[h01(X, Y, 12) < 0.12 ? 1 : h01(X >> 2, Y >> 2, 13) < 0.2 ? 3 : 2];
    if (topRow && y < 4) c = y === 0 ? [36, 24, 30] : y === 3 ? tb[0] : tb[2]; // the eave beam
    if (!topRow && y > 25) c = ramp(p.rock, 0.7)[y === 26 ? 4 : (X + (y > 28 ? 3 : 0)) % 7 === 0 ? 0 : y > 29 ? 1 : 2]; // stone footing
    if ((wx === l && x < 3) || (wx === r && x > 28)) c = tb[x === 0 || x === 31 ? 0 : 2];
    if ((wx - l) % 3 === 0 && wx !== l && x < 3 && !(y > 25 && !topRow)) c = tb[x === 2 ? 0 : 2]; // posts
    // a diagonal brace in the upper storey's timber frame
    if (topRow && (wx - l) % 3 === 1 && wx !== r && y > 4 && x > 2 && Math.abs(x - 3 - (y - 4) * 1.05) < 1.3) c = tb[Math.abs(x - 3 - (y - 4) * 1.05) < 0.6 ? 2 : 0];
    // the eave throws a soft shadow on the wall beneath it
    if (topRow && y >= 4 && y < 10) { const sh = 1 - 0.2 * ((10 - y) / 6); c = [c[0] * sh, c[1] * sh, c[2] * sh]; }
    // ivy climbs the corner of some houses, thinning as it spreads
    if (hash(l, wy - (topRow ? 0 : 1), 21) % 3 === 0 && wx - l < 2) {
      const reach = (wx - l) * TS + x, dense = 0.62 - reach / 46 - (topRow ? y / 90 : 0);
      if (h01(X >> 2, Y >> 2, 31) < dense + 0.12 && h01(X, Y, 33) < 0.86) c = ivy[1 + (hash(X >> 1, Y >> 1, 32) % 3)]; // leaves in clumps, with a few gaps
    }
    set(x, y, c);
  }
  g.putImageData(img, ox, oy);
  if (topRow && wx !== l && wx !== r && (wx - l) % 2 === 1) window_(g, ox + 8, oy + 8, p);
  if (!topRow && wx === mid) door(g, ox + 7, oy + 2, tb);
  else if (!topRow && wx !== l && wx !== r && (wx - l) % 3 === 2) window_(g, ox + 9, oy + 4, p);
}
function window_(g: G, x: number, y: number, p: Pal) {
  const tb = ramp(p.timber, 0.8), sh = ramp(p.roofs[0], 0.8);
  // shutters folded back on either side, in the colour of the roof
  for (const sx of [x - 5, x + 15]) {
    g.fillStyle = css(sh[0]); g.fillRect(sx, y - 1, 4, 14);
    g.fillStyle = css(sh[2]); g.fillRect(sx + 1, y, 2, 12);
    g.fillStyle = css(sh[4]); g.fillRect(sx + 1, y, 1, 12);
    g.fillStyle = css(sh[0]); for (let k = 2; k < 12; k += 3) g.fillRect(sx + 1, y + k, 2, 1);
  }
  g.fillStyle = css(tb[0]); g.fillRect(x - 1, y - 1, 16, 14);
  g.fillStyle = '#3a5a8a'; g.fillRect(x, y, 14, 12);
  g.fillStyle = '#ffd88a'; g.fillRect(x + 1, y + 1, 5, 4); g.fillRect(x + 8, y + 1, 5, 4); // a warm lit room
  g.fillStyle = '#e0a860'; g.fillRect(x + 1, y + 7, 5, 4); g.fillRect(x + 8, y + 7, 5, 4);
  g.fillStyle = '#fff4d0'; g.fillRect(x + 1, y + 1, 2, 1); g.fillRect(x + 8, y + 1, 2, 1);
  g.fillStyle = css(tb[1]); g.fillRect(x + 6, y, 2, 12); g.fillRect(x, y + 5, 14, 2);
  g.fillStyle = css(tb[2]); g.fillRect(x - 2, y + 12, 18, 3); // a flower box
  for (let k = 0; k < 6; k++) { g.fillStyle = ['#e2527a', '#ffe46a', '#ffffff'][k % 3]; g.fillRect(x - 1 + k * 3, y + 10 + (k & 1), 2, 2); }
}
function door(g: G, x: number, y: number, tb: RGB[]) {
  g.fillStyle = '#24181e'; g.fillRect(x - 1, y + 3, 20, 28); g.fillRect(x + 2, y, 14, 4);
  g.fillStyle = css(tb[2]); g.fillRect(x, y + 4, 18, 27); g.fillRect(x + 3, y + 1, 12, 4);
  g.fillStyle = css(tb[1]); for (let k = 1; k < 4; k++) g.fillRect(x + k * 4 + 1, y + 2, 1, 29);
  g.fillStyle = css(tb[3]); g.fillRect(x + 1, y + 4, 1, 26);
  g.fillStyle = '#d8b048'; g.fillRect(x + 13, y + 16, 2, 2);
  g.fillStyle = '#9a9488'; g.fillRect(x - 2, y + 28, 22, 3); g.fillStyle = '#c8c0b0'; g.fillRect(x - 2, y + 28, 22, 1);
  // iron bands and a ring handle
  g.fillStyle = '#3a3440'; g.fillRect(x, y + 9, 18, 1); g.fillRect(x, y + 23, 18, 1);
  g.fillStyle = '#f0d070'; g.fillRect(x + 13, y + 15, 2, 1);
  // a lantern on a bracket beside the door
  g.fillStyle = '#3a3440'; g.fillRect(x + 20, y + 5, 4, 1); g.fillRect(x + 23, y + 5, 1, 3);
  g.fillStyle = '#2a2430'; g.fillRect(x + 21, y + 8, 5, 7);
  g.fillStyle = '#ffd88a'; g.fillRect(x + 22, y + 9, 3, 5);
  g.fillStyle = '#fff6d8'; g.fillRect(x + 23, y + 10, 1, 2);
  g.fillStyle = '#3a3440'; g.fillRect(x + 21, y + 7, 5, 1); g.fillRect(x + 22, y + 15, 3, 1);
}

/** Minimap colour per tile type for a theme (index = tile id). */
export function miniColors(theme: string): string[] {
  const p = PALS[theme] ?? KINGDOM;
  return [p.grass, p.dirt, p.water, p.leaf, '#e2d6bd', p.roofs[0], '#a070ff', p.grass, p.stone, p.rock, '#d0b8ff', p.stone];
}
