// Eldoria at night, in the style of the reference (dense isometric pixel art, deep blue night,
// warm lamps, a glowing crystal). The town is 3D (an isometric orthographic camera, moonlight
// shadows, many point lights, bloom) rendered at 640x360, finished by a pixel pass (saturation,
// colour steps) and scaled 2x with crisp pixels. Characters are the game's own pixel sprites.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { chibi, fox, type Look } from './chibi';
import { chat, dock, frame, hotbar, KNIGHT, minimap, nameplate, portrait, SERIF, text, UI } from './scenes';

const W = 1280, H = 720, VIEW_W = 33, VIEW_H = VIEW_W * H / W;
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const px = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function tex(c: HTMLCanvasElement, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

// ------------------------------------------------------------------ pixel textures
function grassTex() {
  const c = mk(32, 32), g = c.getContext('2d')!, tones = ['#2e5a3a', '#3a6a40', '#467a44', '#2a4a36'];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px(g, tones[Math.floor(rnd() * 4)], x, y);
  for (let i = 0; i < 30; i++) px(g, '#5a9050', rnd() * 32, rnd() * 32, 1, 2);
  return c;
}
function cobbleTex() {
  const c = mk(32, 32), g = c.getContext('2d')!;
  px(g, '#4a3e4a', 0, 0, 32, 32);
  for (let cy = 0; cy < 32; cy += 8) for (let cx = (cy / 8) % 2 ? -4 : 0; cx < 32; cx += 8) {
    const base = ['#b49a80', '#a88c74', '#c0a88c', '#9a8270'][Math.floor(rnd() * 4)];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      if ((x === 0 || x === 6) && (y === 0 || y === 6)) continue;
      px(g, y === 0 || x === 0 ? '#dcc8a8' : y === 6 || x === 6 ? '#6a5660' : base, (cx + x + 32) % 32, cy + y);
    }
  }
  return c;
}
function stoneTex(a = '#8a86a8', b = '#6e6a90', line = '#3e3a5a') {
  const c = mk(16, 16), g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, rnd() < 0.5 ? a : b, x, y);
  for (let y = 0; y < 16; y += 4) { px(g, line, 0, y, 16, 1); for (let x = (y / 4) % 2 ? 3 : 0; x < 16; x += 7) px(g, line, x, y, 1, 4); }
  return c;
}
function wallTex(plaster: string) {
  const c = mk(32, 32), g = c.getContext('2d')!;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px(g, rnd() < 0.12 ? '#c8b494' : plaster, x, y);
  const beam = '#4a2e1e';
  px(g, beam, 0, 0, 32, 2); px(g, beam, 0, 30, 32, 2); px(g, beam, 0, 15, 32, 2);
  for (const x of [0, 15, 30]) px(g, beam, x, 0, 2, 32);
  return c;
}
function roofTex(base: string, dark: string) {
  const c = mk(16, 16), g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / 4);
    px(g, y % 4 === 3 || (x + row * 4) % 8 === 0 ? dark : y % 4 === 0 ? '#ffffff' : base, x, y);
  }
  g.globalCompositeOperation = 'multiply'; g.fillStyle = base; g.fillRect(0, 0, 16, 16);
  return c;
}
function stripeTex(a: string, b: string) {
  const c = mk(8, 8), g = c.getContext('2d')!;
  for (let x = 0; x < 8; x++) px(g, x < 4 ? a : b, x, 0, 1, 8);
  return c;
}
function bannerTex(field: string) {
  const c = mk(12, 24), g = c.getContext('2d')!;
  px(g, field, 0, 0, 12, 24); px(g, '#e8c060', 0, 0, 12, 2); px(g, '#e8c060', 0, 0, 1, 20); px(g, '#e8c060', 11, 0, 1, 20);
  px(g, '#e8c060', 5, 6, 2, 9); px(g, '#e8c060', 3, 8, 6, 2); px(g, '#ffe8a0', 4, 12, 4, 2); // a sword-and-crown emblem
  for (let x = 0; x < 12; x++) if (x % 4 === 0) px(g, 'rgba(0,0,0,0)', x, 20, 2, 4); else px(g, field, x, 20, 1, 3 - (x % 2));
  g.clearRect(0, 22, 12, 2);
  return c;
}

// ------------------------------------------------------------------ the world
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c0e24');
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
const glow = (c: string, k = 3) => std({ color: c, emissive: c, emissiveIntensity: k });
function add<T extends THREE.Object3D>(m: T, x: number, y: number, z: number, shadow = true) {
  m.position.set(x, y, z);
  m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = shadow; o.receiveShadow = true; } });
  scene.add(m);
  return m;
}
const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const lights: THREE.PointLight[] = [];
function lamp(x: number, y: number, z: number, color: string, power: number, dist: number) {
  const l = new THREE.PointLight(color, power, dist, 1.7); l.position.set(x, y, z); scene.add(l); lights.push(l);
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), std({ map: tex(grassTex(), 70, 70) }));
ground.rotation.x = -Math.PI / 2; add(ground, 0, 0, 0, false);
const plaza = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), std({ map: tex(cobbleTex(), 15, 15) }));
plaza.rotation.x = -Math.PI / 2; add(plaza, 0, 0.01, 0, false);
const road = new THREE.Mesh(new THREE.PlaneGeometry(30, 5), std({ map: tex(cobbleTex(), 15, 2.5) }));
road.rotation.x = -Math.PI / 2; add(road, 26, 0.01, 4, false);

// the crystal monument: a raised octagon, steps, a glowing basin and a great floating crystal
const stoneM = std({ map: tex(stoneTex(), 6, 1) });
add(new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.9, 0.5, 8), stoneM), 0, 0.25, 0);
add(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.5, 8), stoneM), 0, 0.75, 0);
add(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.7, 8), std({ map: tex(stoneTex('#a8a4c8', '#8884aa', '#4a4670'), 6, 1) })), 0, 1.35, 0);
add(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.1, 8), std({ color: '#2a8ae8', emissive: '#1a7ae0', emissiveIntensity: 0.8, roughness: 0.1 })), 0, 1.66, 0, false);
add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 1.6, 8), stoneM), 0, 2.4, 0);
const crystal = add(new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), glow('#7ae0ff', 1.3)), 0, 5.4, 0);
crystal.scale.set(1.1, 2.6, 1.1);
crystal.rotation.y = 0.4;
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2, s = 0.25 + (i % 2) * 0.1;
  const c = add(new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), glow('#a8f0ff', 1.2)), Math.cos(a) * 2.2, 4 + (i % 3) * 0.7, Math.sin(a) * 2.2, false);
  c.scale.y = 2;
}
// crystal clusters on the monument's rim
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + 0.2;
  const c = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), glow(i % 2 ? '#5ab8ff' : '#9a7aff', 1.0)), Math.cos(a) * 3.9, 1.3, Math.sin(a) * 3.9, false);
  c.scale.y = 2.2; c.rotation.z = 0.3;
}
lamp(0, 5, 0, '#5ac8ff', 22, 16);
lamp(0, 2.2, 0, '#3a9aff', 6, 8);

// houses: timber walls, tiled gable roofs, lit windows, a door, a chimney
const windowM = glow('#ffc860', 1.3);
function house(x: number, z: number, w: number, d: number, h: number, roof: [string, string], plaster: string, rotY = 0) {
  const g = new THREE.Group();
  const walls = box(w, h, d, std({ map: tex(wallTex(plaster), w / 2, h / 2) }));
  walls.position.y = h / 2; g.add(walls);
  const base = box(w + 0.2, 0.8, d + 0.2, std({ map: tex(stoneTex('#7a7090', '#625a7a', '#3a3450'), w / 2, 0.4) }));
  base.position.y = 0.4; g.add(base);
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2 - 0.6, 0); sh.lineTo(0, h * 0.8); sh.lineTo(w / 2 + 0.6, 0); sh.lineTo(-w / 2 - 0.6, 0);
  const rg = new THREE.ExtrudeGeometry(sh, { depth: d + 1, bevelEnabled: false }); rg.translate(0, 0, -(d + 1) / 2);
  const r = new THREE.Mesh(rg, [std({ map: tex(wallTex(plaster), 2, 1) }), std({ map: tex(roofTex(roof[0], roof[1]), 4, 4) })]);
  r.position.y = h; g.add(r);
  for (let i = 0; i < Math.floor(w / 2); i++) {
    const wx = -w / 2 + 1.2 + i * 2;
    if (Math.abs(wx) < 0.9) continue;
    for (const wy of [h * 0.35, h * 0.75]) {
      const win = box(0.8, 0.9, 0.05, windowM); win.position.set(wx, wy, d / 2 + 0.03); g.add(win);
      const sill = box(1, 0.12, 0.25, std({ color: '#4a2e1e' })); sill.position.set(wx, wy - 0.55, d / 2 + 0.1); g.add(sill);
    }
  }
  const door = box(1.1, 1.9, 0.05, std({ color: '#5a3420' })); door.position.set(0, 1.0, d / 2 + 0.03); g.add(door);
  const ch = box(0.7, 2.2, 0.7, std({ map: tex(stoneTex('#7a7090', '#625a7a', '#3a3450'), 1, 2) })); ch.position.set(w / 2 - 1, h + 1.4, -0.4); g.add(ch);
  g.rotation.y = rotY;
  add(g, x, 0, z);
  // light spills from the windows onto the street
  const out = new THREE.Vector3(0, 0, d / 2 + 1.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  lamp(x + out.x, 1.6, z + out.z, '#ffaa50', 3, 6);
  return g;
}
house(-9, -17, 9, 5, 5, ['#3a5aa8', '#141a3a'], '#d8c4a0');             // the guild hall (blue roof)
house(2, -17, 7, 5, 4.4, ['#a83a4a', '#3a0e1a'], '#dcc8a4');
house(10.5, -17, 7, 5, 4.6, ['#6a4aa8', '#1e1438'], '#d4bea0');
house(-17, -6, 8, 5, 4.6, ['#a85a3a', '#3a160e'], '#d8c4a0', Math.PI / 2); // the blacksmith
house(-17, 4.5, 6, 5, 4.2, ['#3a7a6a', '#0e2a24'], '#dcc8a4', Math.PI / 2);

// the forge: an anvil, a glowing hearth, sparks
add(box(1.6, 1.0, 1.4, std({ map: tex(stoneTex('#5a5268', '#4a4258', '#2a2438'), 1, 1) })), -12.6, 0.5, -8.6);
add(box(1.2, 0.3, 1.0, glow('#ff7a2a', 2)), -12.6, 1.05, -8.6, false);
add(box(0.9, 0.5, 0.4, std({ color: '#3a3a4a', metalness: 0.8, roughness: 0.4 })), -11.6, 0.55, -6.2);
lamp(-12.4, 1.8, -8, '#ff7a30', 8, 7);

// banners of the guild: blue with a gold emblem, on poles
const bannerM = std({ map: tex(bannerTex('#2a4aa8')), side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, emissive: '#1a2a6a', emissiveIntensity: 0.3 });
for (const [x, z] of [[-13, -13.5], [-5, -13.5], [6.5, -9], [13, -2]] as const) {
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5, 6), std({ color: '#3a2a20' })), x, 2.5, z);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), std({ color: '#e8c060', metalness: 0.8, roughness: 0.3 })), x, 5.1, z);
  add(box(1.4, 0.08, 0.08, std({ color: '#3a2a20' })), x + 0.0, 4.7, z + 0.2);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), bannerM);
  b.rotation.y = Math.PI / 4;
  add(b, x, 3.45, z + 0.25);
}

// market stalls with striped awnings, goods, crates and barrels
function stall(x: number, z: number, a: string, b: string, goods: string[], rotY = 0) {
  const g = new THREE.Group();
  for (const [sx, sz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), std({ color: '#4a2e1e' })); p.position.set(sx, 1.3, sz); g.add(p); }
  const aw = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.2), std({ map: tex(stripeTex(a, b), 6, 1), side: THREE.DoubleSide }));
  aw.position.set(0, 2.6, 0.1); aw.rotation.x = -Math.PI / 2 + 0.3; g.add(aw);
  const counter = box(3.2, 0.9, 1.2, std({ color: '#7a4a2a' })); counter.position.set(0, 0.45, 0.3); g.add(counter);
  for (let i = 0; i < 10; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), std({ color: goods[i % goods.length], emissive: goods[i % goods.length], emissiveIntensity: 0.15 })); f.position.set(-1.3 + (i % 5) * 0.65, 1.02, 0.05 + Math.floor(i / 5) * 0.45); g.add(f); }
  g.rotation.y = rotY;
  add(g, x, 0, z);
  lamp(x, 2.2, z + 0.6, '#ffb860', 2.5, 5);
}
stall(-10, 9, '#c8303a', '#f0e4d0', ['#e2523f', '#f4c040', '#7fc040', '#c890f0']);
stall(-11, 2, '#2a4a9a', '#e8d8b8', ['#8ad0ff', '#c890f0', '#f4c040'], Math.PI / 2);
stall(10, 10, '#6a3a9a', '#f0e4d0', ['#f4c040', '#e2523f', '#5ad0a0'], -Math.PI / 6);
for (const [x, z, s] of [[-7.4, 11.2, 0.9], [-6.5, 11.6, 0.7], [12.5, 7.6, 0.8], [-13.3, -1.2, 0.8], [8.6, -13.5, 0.9]] as const) add(box(s, s, s, std({ map: tex(wallTex('#8a5a32'), 0.5, 0.5) })), x, s / 2, z);
for (const [x, z] of [[-13.4, 0.2], [13.2, 8.4], [9.6, -13.6], [-6.4, -13.4]] as const) add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10), std({ color: '#6a4426' })), x, 0.52, z);

// a stone balustrade along the front edge, and stairs down to the road
const railM = std({ map: tex(stoneTex('#a8a0c0', '#8a82a8', '#4a4468'), 1, 1) });
for (let x = -14; x <= 15; x += 1) {
  if (x >= 8 && x <= 12) continue; // the stair gap
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.9, 6), railM), x, 0.45, 15);
}
add(box(22, 0.25, 0.45, railM), -3, 1.0, 15);
add(box(3, 0.25, 0.45, railM), 14.5, 1.0, 15);
for (let i = 0; i < 4; i++) add(box(4, 0.25, 0.9, railM), 10, -0.12 - i * 0.25, 15.4 + i * 0.9, false);

// lamp posts: dark iron, a glowing lantern, a warm light
const lanternM = glow('#ffd070', 1.8);
for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [7, 4], [-14, -12], [14, -12], [-14, 12], [14, 13], [20, 1.4], [20, 6.6]] as const) {
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.4, 6), std({ color: '#1e1a2a', metalness: 0.6, roughness: 0.5 })), x, 1.7, z);
  add(box(0.45, 0.6, 0.45, lanternM), x, 3.6, z, false);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.35, 4), std({ color: '#1e1a2a' })), x, 4.08, z);
  lamp(x, 3.4, z, '#ffb45a', 6, 8);
}

// trees: faceted canopies, violet blossoms and deep greens; flowering bushes along the plaza
function tree(x: number, z: number, s: number, colors: string[]) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2.4 * s, 6), std({ color: '#3a2618', flatShading: true }));
  t.position.y = 1.2 * s; g.add(t);
  for (const [dx, dy, dz, r, k] of [[0, 3.1, 0, 1.6, 0], [-0.9, 2.5, 0.4, 1.1, 1], [0.9, 2.6, -0.3, 1.2, 2], [0.1, 3.9, 0.1, 1.0, 1]] as const) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 0), std({ color: colors[k], flatShading: true }));
    m.position.set(dx * s, dy * s, dz * s); g.add(m);
  }
  return add(g, x, 0, z);
}
const VIOLET = ['#7a4ab8', '#5a2e98', '#9a6ad8'], GREEN = ['#2e6a3e', '#1e4a30', '#3e7a46'];
for (const [x, z, s, c] of [[-20, -12, 1.3, VIOLET], [-21, 10, 1.2, GREEN], [-15, 16, 1.0, VIOLET], [17, -15, 1.2, GREEN], [17.5, 14, 1.1, VIOLET], [-2, -23, 1.3, GREEN], [17, -6, 1.0, VIOLET], [-22, 0, 1.1, VIOLET]] as const) tree(x, z, s, c as string[]);
const FLOWERS = ['#ff6aa8', '#ffd84a', '#c87aff', '#ffffff', '#ff8a4a'];
function bush(x: number, z: number) {
  const b = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rnd() * 0.25, 0), std({ color: rnd() < 0.5 ? '#2e6a3e' : '#3a7a44', flatShading: true })), x, 0.42, z);
  for (let k = 0; k < 4; k++) { const c = FLOWERS[Math.floor(rnd() * FLOWERS.length)]; add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), glow(c, 0.5)), x + (rnd() - 0.5) * 0.8, 0.7 + rnd() * 0.3, z + (rnd() - 0.5) * 0.8, false); }
  return b;
}
for (let i = -13; i <= 13; i += 2.2) { if (Math.abs(i - 10) > 2.5) bush(i, 13.8); }
for (let i = -12; i <= 12; i += 2.4) bush(-14, i);
for (const [x, z] of [[-4.5, 4.5], [4.5, 4.5], [-4.8, -4.6], [4.6, -4.8]] as const) bush(x, z);

// magic motes around the crystal and fireflies over the town
function motes(n: number, color: string, size: number, f: () => [number, number, number]) {
  const g = new THREE.BufferGeometry(), p: number[] = [];
  for (let i = 0; i < n; i++) p.push(...f());
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
}
motes(140, '#9ae8ff', 2, () => { const a = rnd() * 6.283, r = 1 + rnd() * 3.5; return [Math.cos(a) * r, 1.8 + rnd() * 6, Math.sin(a) * r]; });
motes(90, '#ffe08a', 2, () => [(rnd() - 0.5) * 40, 0.5 + rnd() * 5, (rnd() - 0.5) * 36]);
motes(40, '#ff9a40', 2, () => [-12.6 + (rnd() - 0.5) * 1.5, 1.2 + rnd() * 2.5, -8.6 + (rnd() - 0.5) * 1.5]); // forge sparks

// ------------------------------------------------------------------ the camera: isometric, orthographic
const camera = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 400);
const target = new THREE.Vector3(-3, 0, -1);
camera.position.copy(target).add(new THREE.Vector3(40, 34, 40));
camera.lookAt(target);
camera.updateMatrixWorld();

// characters: 3D chibi models with toon shading and an ink outline (showcase/chibi.ts)
const labels: { obj: THREE.Object3D; h: number; text: string; color: string; title?: string }[] = [];
const FACE = Math.PI / 4; // toward the camera
function person(look: Look, x: number, z: number, rotY = FACE, label?: [string, string, string?], scale = 1.3) {
  const m = chibi(look); m.position.set(x, 0, z); m.rotation.y = rotY; m.scale.setScalar(scale);
  scene.add(m);
  if (label) labels.push({ obj: m, h: 2.6, text: label[0], color: label[1], title: label[2] });
  return m;
}
// the hero: brown hair, a red scarf and cape, a sword
const HERO: Look = { hair: '#5a3a24', top: '#c8402e', trim: '#e8c060', legs: '#3a2a3a', scarf: '#e0302a', cape: '#b02a2a', weapon: 'sword', pose: 'walk' };
person({ hair: '#5a3a24', top: '#c8402e', trim: '#e8c060', legs: '#3a2a3a', scarf: '#e0302a', cape: '#b02a2a', weapon: 'sword', pose: 'walk' }, 0.6, 7.2, FACE + 0.5, ['[NKG] Seren', '#ffffff']);
const pet = fox(); pet.position.set(2.8, 0, 8.4); pet.rotation.y = FACE + 0.6; pet.scale.setScalar(1.3); scene.add(pet);
labels.push({ obj: pet, h: 1.6, text: 'Ember', color: '#ffd27a' });
// the blacksmith at the forge, the shopkeepers, the guild guards and townsfolk
person({ hair: '#2a1a14', hairStyle: 'spiky', skin: '#d8a078', top: '#5a4a3a', trim: '#8a6a4a', legs: '#2a2430', weapon: 'mace' }, -11.4, -5.4, Math.PI / 2 + 0.3, ['Borin', '#9fe0a0', 'Blacksmith']);
person({ hair: '#c8d0e8', hairStyle: 'long', top: '#5a3a9a', trim: '#e8c060', hat: '#4a2a8a', weapon: 'staff', weaponGlow: '#c890ff' }, -10, 10.9, FACE, ['Ilse', '#9fe0a0', 'Merchant']);
person({ hair: '#e8b84a', hairStyle: 'bun', top: '#f0e4d0', trim: '#5ab0e0', legs: '#5a6aa8', pose: 'wave' }, -9.3, 2.0, Math.PI / 2, ['Mira', '#9fe0a0', 'Potions']);
for (const x of [-10.8, -7.2]) person({ hair: '#3a2a20', top: '#2a4aa8', armor: '#b8c0d8', helmet: '#b8c0d8', plume: '#2a4aa8', trim: '#e8c060', weapon: 'sword', shield: '#2a4aa8' }, x, -12.4, 0.1);
person({ hair: '#2a3a2a', top: '#3a7a4a', trim: '#a8d070', weapon: 'bow', hairStyle: 'short', pose: 'walk' }, -1.2, 9.6, -0.6);
person({ hair: '#ff8ab8', hairStyle: 'long', top: '#ffd0e0', trim: '#ff6aa8', pose: 'walk' }, -2.8, 6.8, 2.6);
person({ hair: '#1a1a2a', hairStyle: 'spiky', top: '#2a2438', trim: '#9a5ad0', weapon: 'daggers', scarf: '#6a3ab8' }, 9.6, 12.4, FACE - 0.4);
person({ hair: '#b8b0d8', top: '#e8e0f0', trim: '#e8c060', armor: '#e8e4f4', weapon: 'mace', shield: '#e8c060' }, 7.6, -3.2, -0.4);
person({ hair: '#6a3a1a', top: '#a86a2a', trim: '#e8c060', weapon: 'axe', hairStyle: 'spiky' }, -3.6, -8.2, 0.9);

// ------------------------------------------------------------------ light: moonlight, a blue sky fill
scene.add(new THREE.HemisphereLight('#5a6ac8', '#1a1430', 0.9));
const moon = new THREE.DirectionalLight('#9ab0ff', 1.3);
moon.position.set(-18, 30, 10); moon.target.position.set(0, 0, 0);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
moon.shadow.bias = -0.0008;
scene.add(moon, moon.target);

// the pixel finish: richer saturation and stepped colours, as in hand-made pixel art
const PixelShader = {
  uniforms: { tDiffuse: { value: null }, steps: { value: 64 }, sat: { value: 1.25 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float steps; uniform float sat; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, sat); c = mix(c, c * vec3(0.86, 0.9, 1.12), 1.0 - smoothstep(0.0, 0.5, l));
      c = floor(c * steps + 0.5) / steps; gl_FragColor = vec4(c, 1.0); }`,
};

// ------------------------------------------------------------------ the HUD (in the reference's layout)
function sign(g: CanvasRenderingContext2D, x: number, y: number, s: string) {
  g.font = `600 15px ${SERIF}`;
  const w = g.measureText(s).width + 20;
  g.fillStyle = 'rgba(14,12,26,0.88)'; g.fillRect(x - w / 2, y - 13, w, 26);
  g.strokeStyle = UI.gold; g.lineWidth = 1.5; g.strokeRect(x - w / 2 + 0.5, y - 12.5, w - 1, 25);
  text(g, s, x, y + 5, 15, UI.ink, 'center', 600, SERIF);
}
function quest(g: CanvasRenderingContext2D, x: number, y: number) {
  frame(g, x, y, 200, 56, 6);
  text(g, 'Main Quest', x + 14, y + 22, 15, '#ffd86a', 'left', 700, SERIF);
  g.fillStyle = '#ffd86a'; g.save(); g.translate(x + 19, y + 39); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
  text(g, 'Reach the Crystal Sanctum', x + 30, y + 44, 13, UI.ink);
}
const at = (m: THREE.Object3D, dy: number) => { m.updateMatrixWorld(); const v = new THREE.Vector3(0, dy * m.scale.y, 0).add(m.position).project(camera); return [(v.x + 1) * 640, (1 - v.y) * 360] as const; };
const atWorld = (x: number, y: number, z: number) => { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) * 640, (1 - v.y) * 360] as const; };

export async function render() {
  const view = document.getElementById('view') as HTMLCanvasElement, hud = document.getElementById('hud') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.5, 0.45, 0.8));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(PixelShader));
  composer.render();
  // the portrait: the hero's head, rendered close up with a key light
  const ps = new THREE.Scene(), pc = new THREE.PerspectiveCamera(30, 1, 0.1, 20), ph = chibi({ ...HERO, pose: 'idle' });
  ph.rotation.y = 0.35; ps.add(ph, new THREE.HemisphereLight('#ffe8d0', '#3a3060', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2); key.position.set(2, 3, 4); ps.add(key);
  pc.position.set(0.3, 1.75, 2.6); pc.lookAt(0, 1.5, 0);
  const rt = new THREE.WebGLRenderTarget(144, 144);
  renderer.toneMapping = THREE.NoToneMapping; renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(ps, pc); renderer.setRenderTarget(null);
  const buf = new Uint8Array(144 * 144 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 144, 144, buf);
  const face = mk(144, 144), fd = new ImageData(144, 144);
  for (let y = 0; y < 144; y++) fd.data.set(buf.subarray((143 - y) * 576, (144 - y) * 576), y * 576);
  face.getContext('2d')!.putImageData(fd, 0, 0);

  const g = hud.getContext('2d')!;
  const v = g.createRadialGradient(640, 360, 300, 640, 360, 780); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(6,4,20,0.6)');
  g.fillStyle = v; g.fillRect(0, 0, 1280, 720);
  for (const l of labels) { const [x, y] = at(l.obj, l.h); nameplate(g, x, y - 4, l.text, l.color, l.title); }
  { const [x, y] = atWorld(-17, 9.4, -6); sign(g, x, y, 'Blacksmith'); }
  { const [x, y] = atWorld(-9, 10.2, -17); sign(g, x, y, 'Guild'); }
  { const [x, y] = atWorld(-10, 3.6, 9); sign(g, x, y, 'Shop'); }
  { const [x, y] = atWorld(0, 8.6, 0); sign(g, x, y, 'Crystal of Eldoria'); }
  portrait(g, 16, 16, KNIGHT, 'knight', 'Seren', 'Lv.150 · Paladin', 1, 1, ['#6fb4ff', '#1a3a8a'], face);
  minimap(g, 1190, 92, 70, ['#2e5a3a', '#3a6a40', '#b49a80', '#3a5aa8', '#5ac8ff'], 'Eldoria · Night Market');
  quest(g, 1064, 200);
  hotbar(g, ['shield_bash', 'taunt', 'guard_stance', 'cleave', 'rallying_cry', 'last_stand'], 640, 632);
  chat(g, [['You received 170 gold.', '#ffd86a'], ['EXP +32K (Fever +5%)', '#7fe8ff'], ['[Guild] Lyra: Crystal raid at 9!', '#a8f0b0']]);
  dock(g);
  (window as any).__done = true;
}
(window as any).__render = render;
