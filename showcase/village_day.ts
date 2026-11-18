// The training grounds outside Eldoria on a sunny day: high-detail pixel art made from 3D.
// The ground is painted at one texel per screen pixel; cliffs, buildings, props and characters are
// 3D with cel shading and an ink outline; everything renders at 640x360 and is scaled 2x crisp.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { boxg, chibi, cyl, fox, put, sph, toon, toonMap, type Look } from './chibi';
import { dock, frame, hotbar, KNIGHT, minimap, nameplate, portrait, text, UI } from './scenes';

const W = 640, H = 360, VIEW_W = 30, VIEW_H = VIEW_W * H / W;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function tex(c: HTMLCanvasElement, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Smooth value noise for painterly patches. */
function noise(x: number, y: number) {
  return (Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + Math.sin(y * 0.13 + Math.sin(x * 0.05) * 2.4) + Math.sin((x + y) * 0.031) * 1.4) / 3.4;
}

// ------------------------------------------------------------------ the painted ground
const G = 40, TPU = 26; // the ground is 40x40 units at 26 texels per unit
const PATH: [number, number][] = [[-20, 4], [-12, 3.2], [-6, 1.6], [0, 1.2], [5, 2.6], [9, 5], [12, 9], [14, 14], [15, 20]];
const BRANCH: [number, number][] = [[2, 1.6], [3, -3], [3.6, -7.6]];
const STONES: [number, number, number][] = [[7.2, -1.6, 0], [9.2, -0.6, 0.3], [11.2, 0.2, 0.1], [13.2, 0.6, -0.2], [-2.6, 7.4, 0.2], [-1.2, 9.6, -0.1]];
const WATER = (x: number, z: number) => x + z * 0.6 > 22.5;
function segDist(px: number, pz: number, pts: [number, number][]) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return best;
}
function groundTex() {
  const N = G * TPU, c = mk(N, N), g = c.getContext('2d')!, img = g.createImageData(N, N), d = img.data;
  const GRASS = ['#6a9a38', '#7eaa40', '#92bc4a', '#a6cb56', '#bad866'].map(hex);
  const DIRT = ['#b8945a', '#c8a66a', '#d6b87c', '#e2c88e'].map(hex);
  const WATER_C = ['#2a6aa8', '#3a82c0', '#4a96d0'].map(hex);
  const set = (i: number, c: number[]) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = x / TPU - G / 2, wz = y / TPU - G / 2, i = (y * N + x) * 4;
    const n = noise(x, y), jit = rnd();
    if (WATER(wx, wz)) {
      const k = Math.floor((noise(x * 2, y * 0.6) + 1) * 1.5 + jit * 0.4);
      set(i, WATER_C[Math.min(2, k)]);
      if ((y % 9 === 0) && Math.sin(x * 0.2 + y) > 0.6) set(i, hex('#a8dcf4'));
      continue;
    }
    const pw = 1.25 + noise(x * 0.5, y * 0.5) * 0.25, dist = Math.min(segDist(wx, wz, PATH), segDist(wx, wz, BRANCH) + 0.35);
    if (dist < pw) {
      const k = Math.floor((n + 1) * 1.6 + jit * 0.8);
      set(i, DIRT[Math.max(0, Math.min(3, k))]);
      if (dist > pw - 0.08) set(i, hex('#9a7a48')); // the worn edge of the path
      continue;
    }
    const k = Math.floor((n + 1) * 2.1 + jit * 0.9);
    set(i, GRASS[Math.max(0, Math.min(4, k))]);
    if (dist < pw + 0.06) set(i, hex('#c8e070')); // the lit grass lip over the path
  }
  g.putImageData(img, 0, 0);
  // shoreline foam and a dark wet band
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const wx = x / TPU - G / 2, wz = y / TPU - G / 2;
    const e = wx + wz * 0.6 - 22.5;
    if (e > 0 && e < 0.12) { g.fillStyle = '#e8f4f0'; g.fillRect(x, y, 1, 1); } else if (e <= 0 && e > -0.12) { g.fillStyle = '#8a7a4a'; g.fillRect(x, y, 1, 1); }
  }
  // grass tufts, flowers, pebbles
  for (let i = 0; i < 5200; i++) {
    const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N), wx = x / TPU - G / 2, wz = y / TPU - G / 2;
    if (WATER(wx, wz)) continue;
    const onPath = Math.min(segDist(wx, wz, PATH), segDist(wx, wz, BRANCH) + 0.35) < 1.3;
    if (onPath) { if (rnd() < 0.5) { g.fillStyle = '#a08458'; g.fillRect(x, y, 2, 1); g.fillStyle = '#f0dca8'; g.fillRect(x, y - 1, 2, 1); } continue; }
    const r = rnd();
    if (r < 0.75) { g.fillStyle = '#5a8a30'; g.fillRect(x, y, 1, 3); g.fillRect(x + 2, y + 1, 1, 2); g.fillStyle = '#cbe27a'; g.fillRect(x + 1, y - 1, 1, 3); }
    else if (r < 0.9) { g.fillStyle = ['#ffffff', '#ffe46a', '#ff9ac0', '#a8c8ff'][Math.floor(rnd() * 4)]; g.fillRect(x, y, 2, 2); g.fillStyle = '#5a8a30'; g.fillRect(x, y + 2, 1, 2); }
    else { g.fillStyle = '#4a7a2a'; g.fillRect(x, y, 3, 1); }
  }
  // flat stepping stones
  for (const [sx, sz, rot] of STONES) {
    g.save(); g.translate((sx + G / 2) * TPU, (sz + G / 2) * TPU); g.rotate(rot);
    const el = (c: string, x: number, y: number, rx: number, ry: number) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
    el('#6a7262', 1, 3, 17, 11); el('#b8bca8', 0, 0, 16, 10); el('#d8dccb', -2, -3, 12, 6); el('#eef0e2', -5, -5, 5, 2);
    g.fillStyle = '#9a9e8a'; g.fillRect(2, 2, 7, 1); g.fillRect(-9, 4, 4, 1);
    g.restore();
  }
  return c;
}
function grassTileTex() {
  const c = mk(64, 64), g = c.getContext('2d')!, img = g.createImageData(64, 64), d = img.data;
  const GRASS = ['#6a9a38', '#7eaa40', '#92bc4a', '#a6cb56', '#bad866'].map(hex);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const k = Math.floor((Math.sin(x * 0.2) * Math.cos(y * 0.18) + 1) * 2.1 + rnd() * 0.9), i = (y * 64 + x) * 4, c2 = GRASS[Math.max(0, Math.min(4, k))];
    d[i] = c2[0]; d[i + 1] = c2[1]; d[i + 2] = c2[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) { const x = rnd() * 64, y = rnd() * 64; g.fillStyle = '#5a8a30'; g.fillRect(x, y, 1, 3); g.fillStyle = '#cbe27a'; g.fillRect(x + 1, y - 1, 1, 3); }
  return c;
}
function cliffTex() {
  const c = mk(64, 48), g = c.getContext('2d')!;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
    const band = Math.floor((y + Math.sin(x * 0.3) * 2) / 7);
    g.fillStyle = ['#a8804c', '#9a7242', '#b48c56', '#8e683c', '#a07848', '#7a5832', '#6a4a2a'][Math.min(6, band)];
    if (rnd() < 0.1) g.fillStyle = '#c49c64';
    g.fillRect(x, y, 1, 1);
  }
  for (let x = 0; x < 64; x++) { // the grass overhang with drips
    const h = 4 + Math.floor((Math.sin(x * 0.7) + Math.sin(x * 1.9)) * 1.4 + rnd() * 2);
    g.fillStyle = '#7eaa40'; g.fillRect(x, 0, 1, h);
    g.fillStyle = '#4e7a2a'; g.fillRect(x, h, 1, 1);
    g.fillStyle = '#bad866'; g.fillRect(x, 0, 1, 1);
  }
  for (let i = 0; i < 6; i++) { const x = rnd() * 60, y = 12 + rnd() * 26; g.fillStyle = '#5a3e22'; g.fillRect(x, y, 4, 1); g.fillStyle = '#c49c64'; g.fillRect(x, y - 1, 3, 1); }
  return c;
}
function plankTex(a: string, b: string, line: string, vertical = false) {
  const c = mk(32, 32), g = c.getContext('2d')!;
  for (let k = 0; k < 4; k++) {
    for (let j = 0; j < 8; j++) for (let i = 0; i < 32; i++) {
      g.fillStyle = rnd() < 0.15 ? b : a;
      if (vertical) g.fillRect(k * 8 + j, i, 1, 1); else g.fillRect(i, k * 8 + j, 1, 1);
    }
    g.fillStyle = line;
    if (vertical) g.fillRect(k * 8 + 7, 0, 1, 32); else g.fillRect(0, k * 8 + 7, 32, 1);
    g.fillStyle = '#ffffff22';
    if (vertical) g.fillRect(k * 8, 0, 1, 32); else g.fillRect(0, k * 8, 32, 1);
  }
  return c;
}
function targetTex() {
  const c = mk(32, 32), g = c.getContext('2d')!;
  for (const [r, col] of [[16, '#d8b070'], [13, '#f4ecd8'], [10, '#d0403a'], [7, '#f4ecd8'], [4, '#d0403a']] as const) { g.fillStyle = col; g.beginPath(); g.arc(16, 16, r, 0, 7); g.fill(); }
  return c;
}
function ringTex() {
  const c = mk(32, 32), g = c.getContext('2d')!;
  g.fillStyle = '#d8b880'; g.fillRect(0, 0, 32, 32);
  g.strokeStyle = '#a88450'; for (let r = 3; r < 16; r += 3) { g.beginPath(); g.arc(16, 16, r, 0, 7); g.stroke(); }
  return c;
}

// ------------------------------------------------------------------ the world
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9ccf6a');
const ground = new THREE.Mesh(new THREE.PlaneGeometry(G, G), toonMap(tex(groundTex())));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// the upper meadow: stepped cliffs with grass tops
const grassTile = grassTileTex(), cliff = cliffTex();
function ledge(x0: number, x1: number, z0: number, z1: number, h: number) {
  const w = x1 - x0, d = z1 - z0;
  const side = toonMap(tex(cliff, w / 2.4, 1)), sideZ = toonMap(tex(cliff, d / 2.4, 1)), top = toonMap(tex(grassTile, w / 2.4, d / 2.4));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideZ, sideZ, top, top, side, side]);
  m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
ledge(-20, -4, -20, -7.6, 1.8);
ledge(-4, 1.8, -20, -9.2, 1.8);
ledge(5.4, 20, -20, -8.4, 1.8);
ledge(9, 20, -20, -11, 3.6);
const WOOD = toon('#9a6a3a'), WOOD_D = toon('#6a4426'), WOOD_L = toon('#c09060');
function obj(x: number, z: number, rotY = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g); return g; }

// a timber hut with a plank roof, a lantern, firewood
{
  const h = obj(-12.5, -3.6, 0.15), walls = toonMap(tex(plankTex('#a0723e', '#8a5e32', '#5a3a1e'), 2, 1)), roof = toonMap(tex(plankTex('#d4a458', '#c08e48', '#8a6230', true), 3, 2));
  put(h, boxg(6, 3, 4.4), walls, [0, 1.5, 0], [0, 0, 0], [1, 1, 1], 0.05);
  const sh = new THREE.Shape(); sh.moveTo(-2.9, 0); sh.lineTo(0, 2.1); sh.lineTo(2.9, 0); sh.lineTo(-2.9, 0);
  const rg = new THREE.ExtrudeGeometry(sh, { depth: 6.8, bevelEnabled: false }); rg.translate(0, 0, -3.4);
  put(h, rg, [walls, roof] as any, [0, 3, 0], [0, Math.PI / 2, 0], [1, 1, 1], 0.06);
  put(h, boxg(1.2, 2, 0.1), WOOD_D, [1.2, 1, 2.22], [0, 0, 0], [1, 1, 1], 0.03);
  put(h, boxg(1, 0.8, 0.1), toon('#ffe0a0', 0.4), [-1.4, 1.9, 2.22], [0, 0, 0], [1, 1, 1], 0.03);
  for (const x of [-3, 3]) put(h, cyl(0.12, 0.12, 3.2, 8), WOOD_D, [x, 1.6, 2.2], [0, 0, 0], [1, 1, 1], 0.03);
  for (let i = 0; i < 6; i++) put(h, cyl(0.14, 0.14, 1.2, 8), WOOD_L, [3.6 + (i % 3) * 0.3, 0.15 + Math.floor(i / 3) * 0.26, 1 + (i % 2) * 0.1], [Math.PI / 2, 0, 0], [1, 1, 1], 0.02);
  put(h, boxg(0.8, 0.8, 0.8), WOOD, [-3.4, 0.4, 2.6], [0, 0.3, 0], [1, 1, 1], 0.03);
  put(h, boxg(0.6, 0.6, 0.6), WOOD_L, [-3.3, 1.1, 2.6], [0, -0.2, 0], [1, 1, 1], 0.03);
}
// a chopping stump with an axe
{
  const s = obj(-8.6, 3.4); const ring = toonMap(tex(ringTex()));
  put(s, cyl(0.5, 0.58, 0.8, 14), [toon('#8a5a32'), ring, ring] as any, [0, 0.4, 0], [0, 0, 0], [1, 1, 1], 0.04);
  put(s, boxg(0.06, 0.8, 0.06), WOOD_L, [0.1, 1.1, 0], [0, 0, 0.4], [1, 1, 1], 0.02);
  put(s, boxg(0.3, 0.2, 0.05), toon('#c8ccd8'), [-0.05, 1.45, 0], [0, 0, 0.4], [1, 1, 1], 0.02);
}
// rough fence stakes along the path
for (const [x, z, hgt, rot] of [[-5, -2.4, 1.1, 0.1], [-3.8, -2.8, 1.4, -0.1], [-2.4, -2.6, 0.9, 0.2], [-1, -3, 1.3, 0], [6.4, -4.2, 1.2, 0.1], [7.8, -4.4, 1.0, -0.2], [-6.2, 7.4, 1.3, 0], [-7.6, 7, 1.0, 0.2]] as const) {
  const f = obj(x, z, rot);
  put(f, cyl(0.2, 0.24, hgt, 7), WOOD, [0, hgt / 2, 0], [0, 0, 0.05], [1, 1, 1], 0.035);
  put(f, cyl(0.2, 0.2, 0.04, 7), WOOD_L, [0, hgt + 0.02, 0], [0, 0, 0], [1, 1, 1], 0);
}
// archery targets on the meadow edge, and arrows in them
for (const [x, z, r] of [[10.5, -6.6, -0.25], [13.8, -6.0, -0.4]] as const) {
  const t = obj(x, z, r), face = toonMap(tex(targetTex()));
  put(t, cyl(0.95, 0.95, 0.25, 20), [WOOD, face, WOOD] as any, [0, 1.2, 0], [Math.PI / 2 - 0.2, 0, 0], [1, 1, 1], 0.05);
  for (const s of [-1, 1]) put(t, cyl(0.08, 0.08, 1.6, 6), WOOD_D, [0.55 * s, 0.7, -0.35], [-0.3, 0, 0], [1, 1, 1], 0.025);
  for (const [ax, ay] of [[0.1, 1.3], [-0.3, 1.0]]) put(t, boxg(0.03, 0.03, 0.6), WOOD_L, [ax, ay, 0.35], [0.25, 0.2, 0], [1, 1, 1], 0.015);
}
// a training dummy and the guild's green banner
{
  const d = obj(5.6, 5.8, -0.3);
  put(d, cyl(0.12, 0.12, 2, 8), WOOD_D, [0, 1, 0], [0, 0, 0], [1, 1, 1], 0.03);
  put(d, boxg(1.4, 0.14, 0.14), WOOD_D, [0, 1.45, 0], [0, 0, 0], [1, 1, 1], 0.03);
  put(d, sph(0.36, 12, 10), toon('#d8c08a'), [0, 2.2, 0], [0, 0, 0], [1, 1.1, 1], 0.04);
  put(d, cyl(0.38, 0.32, 0.8, 10), toon('#c8a870'), [0, 1.2, 0], [0, 0, 0], [1, 1, 1], 0.04);
  const b = obj(9.6, 2.4, -0.4);
  put(b, cyl(0.12, 0.14, 3.2, 8), WOOD_D, [0, 1.6, 0], [0, 0, 0], [1, 1, 1], 0.03);
  put(b, boxg(1.3, 0.1, 0.1), WOOD_D, [0, 3.0, 0], [0, 0, 0], [1, 1, 1], 0.02);
  put(b, boxg(1.1, 1.6, 0.05), toon('#3a9a7a'), [0, 2.1, 0.1], [0.05, 0, 0], [1, 1, 1], 0.03);
  put(b, boxg(0.3, 0.3, 0.06), toon('#e8c060'), [0, 2.3, 0.13], [0, 0, Math.PI / 4], [1, 1, 1], 0);
  put(b, cyl(0.7, 0.8, 0.2, 8), toon('#a8a898'), [0, 0.1, 0], [0, 0, 0], [1, 1, 1], 0.03); // stone base
  for (const s of [-1, 1]) put(b, boxg(0.04, 0.04, 1.2), toon('#5a5a5a'), [0.5 * s, 0.6, 0.6], [0.8, 0, 0], [1, 1, 1], 0);
}
// a cooking pot on a tripod, a log bench
{
  const p = obj(-1.4, 8.6);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; put(p, cyl(0.05, 0.05, 1.9, 6), WOOD_D, [Math.cos(a) * 0.45, 0.9, Math.sin(a) * 0.45], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], [1, 1, 1], 0.02); }
  put(p, sph(0.36, 14, 10, 0.3, Math.PI - 0.3), toon('#3a3a44'), [0, 0.75, 0], [0, 0, 0], [1, 0.9, 1], 0.03);
  put(p, cyl(0.26, 0.26, 0.04, 12), toon('#c87a3a', 0.3), [0, 1.05, 0], [0, 0, 0], [1, 1, 1], 0);
  for (let i = 0; i < 5; i++) put(p, cyl(0.07, 0.07, 0.6, 6), WOOD_L, [Math.cos(i) * 0.2, 0.05, Math.sin(i) * 0.2], [Math.PI / 2, i, 0], [1, 1, 1], 0.015);
  const ember = new THREE.PointLight('#ff9a40', 1.5, 3, 1.8); ember.position.set(-1.4, 0.4, 8.6); scene.add(ember);
  const bench = obj(-3.6, 9.6, 0.4); put(bench, cyl(0.28, 0.28, 2.2, 10), toon('#8a5a32'), [0, 0.3, 0], [0, 0, Math.PI / 2], [1, 1, 1], 0.03);
}
// a wooden dock over the water
{
  const k = obj(15.6, 11.2, -0.55), pl = toonMap(tex(plankTex('#c89a5a', '#b4864a', '#7a5428', true), 1, 2));
  put(k, boxg(2.4, 0.18, 6), pl, [0, 0.35, 1.8], [0, 0, 0], [1, 1, 1], 0.04);
  for (const [x, z] of [[-1.15, -0.6], [1.15, -0.6], [-1.15, 2.4], [1.15, 2.4], [-1.15, 4.6], [1.15, 4.6]]) put(k, cyl(0.12, 0.12, 1.2, 8), WOOD_D, [x, 0.4, z], [0, 0, 0], [1, 1, 1], 0.03);
}

// trees: cel-shaded canopies built from clustered balls, lighter on top
function tree(x: number, z: number, s: number, hue: 'green' | 'olive' | 'autumn' = 'green') {
  const t = obj(x, z, rnd() * 6);
  const leaves = { green: ['#4e8a34', '#62a03c', '#7ab64a'], olive: ['#6a8a2a', '#82a034', '#9ab844'], autumn: ['#b8862a', '#cc9a34', '#dcb048'] }[hue];
  put(t, cyl(0.24 * s, 0.36 * s, 2.4 * s, 8), toon('#7a5230'), [0, 1.2 * s, 0], [0, 0, 0], [1, 1, 1], 0.04);
  const balls: [number, number, number, number][] = [[0, 2.9, 0, 1.3], [-0.9, 2.5, 0.3, 0.95], [0.9, 2.6, -0.2, 1.0], [0.3, 2.4, 0.9, 0.9], [-0.3, 3.6, -0.2, 0.95], [0.5, 3.4, 0.4, 0.8]];
  balls.forEach(([dx, dy, dz, r], i) => put(t, new THREE.IcosahedronGeometry(r * s, 2), toon(leaves[Math.min(2, Math.floor(dy / 1.3))]), [dx * s, dy * s, dz * s], [0, 0, 0], [1, 0.9, 1], 0.05));
  void balls.length;
}
tree(-17, 9, 1.2); tree(-15, -10.6, 1.0, 'olive'); tree(13.6, -13.6, 1.3); tree(17.5, -9.6, 1.0, 'olive'); tree(-18.6, 0, 1.1); tree(-6, -12, 1.1);
tree(3.4, 14.4, 0.95); tree(-3, 15.4, 0.9, 'autumn'); tree(9, 15.6, 0.85, 'olive'); tree(-10, 14, 0.9);
// bushes
for (const [x, z, s] of [[-10.6, 6, 0.8], [7.2, 9.4, 0.9], [11, 6.4, 0.7], [-14.4, 3.4, 0.8], [4.6, 11.4, 0.8], [-4.2, -6.2, 0.7], [0.2, 12.4, 1.0], [-5.2, 13.2, 0.9]] as const) {
  const b = obj(x, z);
  for (let i = 0; i < 4; i++) put(b, new THREE.IcosahedronGeometry((0.5 + rnd() * 0.25) * s, 1), toon(i === 3 ? '#86bc4e' : rnd() < 0.5 ? '#5a9638' : '#4e8a34'), [(rnd() - 0.5) * s, (0.35 + (i === 3 ? 0.3 : 0)) * s, (rnd() - 0.5) * s], [0, 0, 0], [1, 0.85, 1], 0.04);
}
// rocks
for (const [x, z, s] of [[-7, -5.6, 0.5], [6.8, 3.4, 0.35], [12.6, 4.4, 0.45], [-12, 8.6, 0.4]] as const) { const r = obj(x, z); put(r, new THREE.DodecahedronGeometry(s, 0), toon('#a8aca0'), [0, s * 0.5, 0], [0, rnd() * 3, 0], [1.2, 0.8, 1], 0.03); }

// ------------------------------------------------------------------ the camera and the light
const camera = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 400);
const target = new THREE.Vector3(-0.5, 0, -1.2);
camera.position.copy(target).add(new THREE.Vector3(14, 30, 32));
camera.lookAt(target);
camera.updateMatrixWorld();
const FACE = Math.atan2(14, 32);

scene.add(new THREE.HemisphereLight('#fff4dc', '#7a9a50', 1.5));
const sun = new THREE.DirectionalLight('#fff0d0', 2.2);
sun.position.set(-14, 24, 10); sun.target.position.set(0, 0, 0);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 80 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ------------------------------------------------------------------ characters
const labels: { obj: THREE.Object3D; h: number; text: string; color: string; title?: string }[] = [];
function person(look: Look, x: number, z: number, rotY = FACE, label?: [string, string, string?], scale = 1.05) {
  const m = chibi(look); m.position.set(x, 0, z); m.rotation.y = rotY; m.scale.setScalar(scale); scene.add(m);
  if (label) labels.push({ obj: m, h: 2.55, text: label[0], color: label[1], title: label[2] });
  return m;
}
const HERO: Look = { hair: '#2a4a3a', hairStyle: 'spiky', top: '#3a6ab8', trim: '#c8d8f0', legs: '#6a4a32', boots: '#4a3022', armor: '#5a7ac8', weapon: 'sword', weaponGlow: '#7ad0ff' };
person(HERO, 1.2, 1.4, FACE - 0.25, ['Kael  Lv.86', '#ffffff']);
person({ hair: '#6a3a24', hairStyle: 'long', top: '#8a4a2a', trim: '#e8c060', legs: '#3a4a7a', boots: '#6a3a22', cape: '#7a4ab8', scarf: '#c8a0ff', weapon: 'sword', weaponGlow: '#c890ff' }, -0.9, 1.0, FACE + 0.3, ['Seren  Lv.88', '#ffe08a']);
const pet = fox(); pet.position.set(2.8, 0, 2.4); pet.rotation.y = FACE - 0.4; pet.scale.setScalar(0.85); scene.add(pet);
person({ hair: '#8a5a3a', hairStyle: 'long', top: '#4a2a5a', trim: '#e8c060', cape: '#6a3a8a', legs: '#2a2030' }, -10.4, -0.4, FACE + 0.4, ['Wren', '#9fe0a0', 'Quartermaster']);
person({ hair: '#2a2420', hairStyle: 'short', top: '#ece4d4', trim: '#a88a5a', legs: '#6a5a4a', pose: 'walk' }, -5.4, 5.8, Math.PI + 0.3);
person({ hair: '#c8a050', hairStyle: 'bun', top: '#5a8a4a', trim: '#e8c060', weapon: 'bow' }, 12.2, -3.4, -0.9, ['Archer Lyra', '#9fe0a0']);

// ------------------------------------------------------------------ post: a gentle saturation lift
const Finish = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.18); c = mix(c * vec3(0.92, 0.95, 1.08), c * vec3(1.04, 1.0, 0.94), smoothstep(0.2, 0.8, l));
      gl_FragColor = vec4(c, 1.0); }`,
};

// ------------------------------------------------------------------ HUD
const at = (m: THREE.Object3D, dy: number) => { const v = new THREE.Vector3(0, dy * m.scale.y, 0).add(m.position).project(camera); return [(v.x + 1) * 640, (1 - v.y) * 360] as const; };
function coins(g: CanvasRenderingContext2D) {
  frame(g, 1040, 196, 224, 36, 18);
  g.fillStyle = '#f4c84a'; g.beginPath(); g.arc(1062, 214, 10, 0, 7); g.fill(); g.strokeStyle = '#8a6a1a'; g.lineWidth = 2; g.stroke();
  text(g, '149,880', 1248, 220, 16, UI.ink, 'right', 700);
}
function quest(g: CanvasRenderingContext2D) {
  frame(g, 1040, 244, 224, 58, 6);
  text(g, 'Training Grounds', 1054, 266, 14, '#ffd86a', 'left', 700);
  text(g, 'Hit the targets  3 / 5', 1054, 288, 13, UI.ink);
}
function heroFace(renderer: THREE.WebGLRenderer) {
  const ps = new THREE.Scene(), pc = new THREE.PerspectiveCamera(30, 1, 0.1, 20), ph = chibi(HERO);
  ph.rotation.y = 0.35; ps.add(ph, new THREE.HemisphereLight('#fff4e0', '#4a5a40', 1.8));
  const key = new THREE.DirectionalLight('#ffffff', 1.8); key.position.set(2, 3, 4); ps.add(key);
  pc.position.set(0.3, 1.75, 2.6); pc.lookAt(0, 1.5, 0);
  const rt = new THREE.WebGLRenderTarget(72, 72);
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(ps, pc); renderer.setRenderTarget(null);
  const buf = new Uint8Array(72 * 72 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 72, 72, buf);
  const c = mk(72, 72), d = new ImageData(72, 72);
  for (let y = 0; y < 72; y++) d.data.set(buf.subarray((71 - y) * 288, (72 - y) * 288), y * 288);
  c.getContext('2d')!.putImageData(d, 0, 0);
  const big = mk(144, 144), bg = big.getContext('2d')!; bg.imageSmoothingEnabled = false; bg.drawImage(c, 0, 0, 144, 144); // pixel portrait
  return big;
}

export async function render() {
  const view = document.getElementById('view') as HTMLCanvasElement, hud = document.getElementById('hud') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.25, 0.3, 0.92));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(Finish));
  composer.render();
  const face = heroFace(renderer);
  const g = hud.getContext('2d')!;
  for (const l of labels) { const [x, y] = at(l.obj, l.h); nameplate(g, x, y - 2, l.text, l.color, l.title); }
  portrait(g, 16, 16, KNIGHT, 'knight', 'Kael', 'Lv.86 · Blade Knight', 0.86, 0.7, ['#6fb4ff', '#1a3a8a'], face);
  minimap(g, 1190, 92, 70, ['#7eaa40', '#92bc4a', '#d6b87c', '#3a82c0', '#6a9a38'], 'Eldoria · Training Grounds');
  coins(g); quest(g);
  hotbar(g, ['shield_bash', 'taunt', 'guard_stance', 'cleave', 'rallying_cry', 'last_stand'], 640, 632);
  dock(g);
  (window as any).__done = true;
}
(window as any).__render = render;
