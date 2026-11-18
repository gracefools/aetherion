// 2.5D prototype of Eldoria (step 1): a real 3D world (geometry, sun shadows, point lights, fog,
// bloom, particles) rendered at 640x360 and scaled 2x with crisp pixels, with the characters,
// mount and pet standing in it as camera-facing sprites. The HUD is drawn at full resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ANIM_COL, defaultAppearance, FRAME_H, FRAME_W, type Appearance } from '../shared/src/appearance';
import { getCharSheet } from '../client/src/game/chars';
import type { Job } from '../shared/src/protocol';
// step 2: 3D models rendered in Blender in 8 directions (showcase/blender/models.py)
import horseFrame from '../.run/blender/out/horse_1.png';
import foxFrame from '../.run/blender/out/fox_1.png';
import knightFrame from '../.run/blender/out/knight_7.png';
import { CLERIC, chat, dock, hotbar, KNIGHT, minimap, nameplate, portrait, RANGER } from './scenes';

const W = 640, H = 360;
let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const px = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function tex(c: HTMLCanvasElement, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Pixel textures (the same hand-shaded look as the 2D showcase)
// ---------------------------------------------------------------------------------------------
function grassTex() {
  const c = mk(64, 64), g = c.getContext('2d')!, tones = ['#3e6a2e', '#4f7f34', '#5f8f3a', '#73a344', '#8ab854'];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) px(g, tones[Math.min(4, Math.floor((Math.sin(x * 0.4) + Math.cos(y * 0.33) + rnd() * 2.2 + 2) / 6.2 * 5))], x, y);
  for (let i = 0; i < 70; i++) { const x = rnd() * 64, y = rnd() * 64; px(g, '#93c25a', x, y, 1, 2); px(g, '#3a6228', x + 1, y + 1); }
  for (let i = 0; i < 6; i++) { const x = rnd() * 62, y = rnd() * 62, c2 = ['#f0d860', '#f4a0c4', '#ffffff'][i % 3]; px(g, c2, x, y); px(g, c2, x + 1, y + 1); }
  return c;
}
function cobbleTex() {
  const c = mk(64, 64), g = c.getContext('2d')!;
  px(g, '#5a4e58', 0, 0, 64, 64);
  for (let cy = 0; cy < 64; cy += 8) for (let cx = (cy / 8) % 2 ? -5 : 0; cx < 64; cx += 10) {
    const w = 8 + (rnd() < 0.3 ? 1 : 0), h = 6, base = ['#b8aa94', '#a89a86', '#c4b6a0', '#9a8e80'][Math.floor(rnd() * 4)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue;
      const col = y === 0 || x === 0 ? '#e0d4bc' : y === h - 1 || x === w - 1 ? '#6e6070' : base;
      px(g, col, (cx + x + 64) % 64, cy + y);
    }
    if (rnd() < 0.15) px(g, '#5a7a3a', (cx + 2 + 64) % 64, cy + h - 1, 3, 1);
  }
  return c;
}
function wallTex(plaster: string) {
  const c = mk(64, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) px(g, rnd() < 0.15 ? '#d8c8a8' : plaster, x, y);
  const beam = '#5a3a24', dark = '#3e2616';
  px(g, beam, 0, 0, 64, 3); px(g, beam, 0, 61, 64, 3); px(g, dark, 0, 3, 64, 1);
  for (const x of [0, 31, 62]) { px(g, beam, x, 0, 3, 64); px(g, dark, x + 2, 0, 1, 64); }
  g.strokeStyle = beam; g.lineWidth = 3;
  g.beginPath(); g.moveTo(3, 60); g.lineTo(30, 4); g.moveTo(34, 4); g.lineTo(61, 60); g.stroke();
  return c;
}
function roofTex(base: string) {
  const c = mk(32, 32), g = c.getContext('2d')!, dark = '#2a1418';
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const row = Math.floor(y / 4), edge = y % 4 === 3 || (x + row * 4) % 8 === 0;
    px(g, edge ? dark : y % 4 === 0 ? '#ffffff' : base, x, y);
  }
  g.globalCompositeOperation = 'multiply'; g.fillStyle = base; g.fillRect(0, 0, 32, 32);
  return c;
}
function stoneTex() {
  const c = mk(32, 32), g = c.getContext('2d')!;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px(g, ['#9a90a8', '#a89eb6', '#8a8098', '#b8aec4'][Math.floor(rnd() * 4)], x, y);
  for (let y = 0; y < 32; y += 8) { px(g, '#5a5068', 0, y, 32, 1); for (let x = (y / 8) % 2 ? 4 : 0; x < 32; x += 10) px(g, '#5a5068', x, y, 1, 8); }
  return c;
}
function stripeTex() {
  const c = mk(16, 16), g = c.getContext('2d')!;
  for (let x = 0; x < 16; x++) px(g, Math.floor(x / 4) % 2 ? '#f4ead8' : '#c8403c', x, 0, 1, 16);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------
const scene = new THREE.Scene();
const FOG = new THREE.Color('#e9b98c');
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 30, 70);
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
const add = (m: THREE.Object3D, x: number, y: number, z: number, shadow = true) => { m.position.set(x, y, z); m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = shadow; o.receiveShadow = true; } }); scene.add(m); return m; };

// ground: grass, the round plaza, the road north
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), std({ map: tex(grassTex(), 40, 40) }));
ground.rotation.x = -Math.PI / 2;
add(ground, 0, 0, 0, false);
const plaza = new THREE.Mesh(new THREE.CircleGeometry(11, 64), std({ map: tex(cobbleTex(), 11, 11) }));
plaza.rotation.x = -Math.PI / 2;
add(plaza, 0, 0.02, 0, false);
const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 30), std({ map: tex(cobbleTex(), 2.5, 19) }));
road.rotation.x = -Math.PI / 2;
add(road, 0, 0.015, -22, false);
const rim = new THREE.Mesh(new THREE.RingGeometry(10.9, 11.4, 64), std({ color: '#7a6448' }));
rim.rotation.x = -Math.PI / 2;
add(rim, 0, 0.03, 0, false);

// houses: timber walls, gable roofs of tiles, lit windows, a door and a chimney
const windowMat = std({ color: '#ffcf6a', emissive: '#ffb54a', emissiveIntensity: 2.4 });
function house(x: number, z: number, w: number, d: number, h: number, roof: string, plaster: string, rotY = 0) {
  const grp = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std({ map: tex(wallTex(plaster), w / 2.5, h / 2.5) }));
  walls.position.y = h / 2;
  grp.add(walls);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0); shape.lineTo(0, h * 0.75); shape.lineTo(w / 2 + 0.5, 0); shape.lineTo(-w / 2 - 0.5, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false });
  rg.translate(0, 0, -(d + 0.8) / 2);
  const rmat = std({ map: tex(roofTex(roof), 3, 3) }), gable = std({ map: tex(wallTex(plaster), 2, 1) });
  const r = new THREE.Mesh(rg, [gable, rmat]);
  r.position.y = h;
  grp.add(r);
  for (let i = 0; i < Math.floor(w / 2.2); i++) { // windows on the front, with flower boxes
    const wx = -w / 2 + 1.4 + i * 2.2;
    if (Math.abs(wx) < 1) continue;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
    win.position.set(wx, h * 0.55, d / 2 + 0.02);
    grp.add(win);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.25), std({ color: '#6a4a2a' }));
    box.position.set(wx, h * 0.55 - 0.6, d / 2 + 0.12);
    grp.add(box);
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), std({ color: ['#e2527a', '#f4d060', '#c890f0'][k], emissive: '#401020', emissiveIntensity: 0.2 })); f.position.set(wx - 0.35 + k * 0.35, h * 0.55 - 0.45, d / 2 + 0.15); grp.add(f); }
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8), std({ color: '#6a4226' }));
  door.position.set(0, 0.9, d / 2 + 0.02);
  grp.add(door);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2, 0.7), std({ map: tex(stoneTex(), 1, 2) }));
  ch.position.set(w / 2 - 1.2, h + 1.2, 0);
  grp.add(ch);
  grp.rotation.y = rotY;
  return add(grp, x, 0, z);
}
house(-12, -15, 8, 5, 4, '#a83a3a', '#e6d6b6');
house(0, -17, 9, 5.5, 4.6, '#3a5a9a', '#ecdaba');
house(12, -15, 7.5, 5, 3.8, '#6a4a9a', '#e2cead');
house(-17, -3, 6, 5, 3.6, '#a8603a', '#e6d6b6', Math.PI / 2);
house(17.5, -2, 6, 5, 3.8, '#3a7a5a', '#ecdaba', -Math.PI / 2);

// banners on poles at the plaza's edge
for (const [x, z, col] of [[-6, -9.5, '#b8403c'], [6, -9.5, '#3f66b4']] as const) {
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 6), std({ color: '#4a3a2a' })), x, 2.25, z);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), std({ color: col, side: THREE.DoubleSide, emissive: col, emissiveIntensity: 0.15 }));
  add(b, x + 0.55, 3.3, z);
}

// the fountain
const stone = std({ map: tex(stoneTex(), 4, 1) });
add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 40), stone), 0, 0.35, 0);
const water = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 40), std({ color: '#3a8ac8', emissive: '#1a4a7a', emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 }));
add(water, 0, 0.66, 0, false);
add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 12), stone), 0, 1.4, 0);
add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 0.35, 24), stone), 0, 2.5, 0);
const spray = new THREE.BufferGeometry(), sp: number[] = [];
for (let i = 0; i < 260; i++) { const a = rnd() * 6.283, t = rnd(), r = 0.3 + t * 2.4; sp.push(Math.cos(a) * r, 2.7 + Math.sin(t * Math.PI) * 0.9 - t * 1.8, Math.sin(a) * r); }
spray.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
scene.add(new THREE.Points(spray, new THREE.PointsMaterial({ color: '#d8f4ff', size: 0.09, transparent: true, opacity: 0.85 })));

// a market stall with a striped awning, fruit and crates
const stall = new THREE.Group();
for (const [sx, sz] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), std({ color: '#5a3a24' })); p.position.set(sx, 1.2, sz); stall.add(p); }
const aw = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.2), std({ map: tex(stripeTex(), 4, 1), side: THREE.DoubleSide }));
aw.position.set(0, 2.5, 0); aw.rotation.x = -Math.PI / 2 + 0.25;
stall.add(aw);
const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 1.2), std({ color: '#8a5a32' }));
counter.position.set(0, 0.45, 0.4);
stall.add(counter);
for (let i = 0; i < 12; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), std({ color: ['#e2523f', '#f4c040', '#7fc040', '#c890f0'][i % 4] })); f.position.set(-1.4 + (i % 6) * 0.55, 1.0, 0.2 + Math.floor(i / 6) * 0.35); stall.add(f); }
add(stall, 8, 0, 2.5);
stall.rotation.y = -0.5;
for (const [x, z, s] of [[-8.2, 3.4, 0.9], [-7.4, 4.1, 0.7], [10.5, 6, 0.8]] as const) add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), std({ color: '#7a5230' })), x, s / 2, z);
add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 10), std({ color: '#6a4426' })), 9.3, 0.5, 6.8);

// lantern posts with warm point lights
const lanternMat = std({ color: '#ffe08a', emissive: '#ffb84a', emissiveIntensity: 3 });
for (const [x, z] of [[-8.5, -4], [8.5, -4.5], [-9.5, 5.5], [9.5, 8.6]] as const) {
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 6), std({ color: '#2a2430' })), x, 1.5, z);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), lanternMat), x, 3.2, z, false);
  const l = new THREE.PointLight('#ffb86a', 6, 9, 1.6);
  l.position.set(x, 3.1, z);
  scene.add(l);
}

// stylised trees: a trunk and faceted canopies
function tree(x: number, z: number, s: number) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2.4 * s, 7), std({ color: '#5a3c26', flatShading: true }));
  t.position.y = 1.2 * s;
  g.add(t);
  for (const [dx, dy, dz, r, c] of [[0, 3.2, 0, 1.6, '#3e7a36'], [-0.9, 2.6, 0.3, 1.1, '#2f6230'], [0.9, 2.7, -0.2, 1.2, '#4a8a3c'], [0.2, 4.0, 0.1, 1.0, '#5a9a40']] as const) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 0), std({ color: c, flatShading: true }));
    m.position.set(dx * s, dy * s, dz * s);
    g.add(m);
  }
  return add(g, x, 0, z);
}
for (const [x, z, s] of [[-15, 8, 1.2], [15, 9, 1.3], [-19, -11, 1.1], [19, -12, 1], [-13, 14, 1], [14, 15, 1.1], [-22, 4, 1.3], [22, 3, 1.2]] as const) tree(x, z, s);
// bushes along the plaza
for (let i = 0; i < 14; i++) { const a = -0.3 + (i / 14) * 3.6 + Math.PI * 0.05, r = 12.2; const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rnd() * 0.3, 0), std({ color: i % 2 ? '#3a7034' : '#4a8a3c', flatShading: true })); add(b, Math.cos(a + 1.6) * r, 0.4, Math.sin(a + 1.6) * r); }

// ---------------------------------------------------------------------------------------------
// Characters, mount and pet: camera-facing sprites that cast real shadows
// ---------------------------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(32, W / H, 0.5, 200);
const target = new THREE.Vector3(0, 0, -1.5);
camera.position.set(target.x, 21, target.z + 25);
camera.lookAt(target);
const sprites: { mesh: THREE.Mesh; label?: [string, string, string?] }[] = [];
const PX = 1 / 14; // one sprite pixel = 1/16 of a tile
function billboard(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, x: number, z: number, lift = 0, label?: [string, string, string?], front = 0, ppx = PX) {
  const c = mk(sw, sh);
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  const t = tex(c);
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sw * ppx, sh * ppx), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide }));
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
  m.quaternion.copy(camera.quaternion);
  // stand on the ground: the plane's bottom edge at y = 0 (tilted toward the camera)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), toCam = new THREE.Vector3().subVectors(camera.position, target).normalize();
  const half = (sh * ppx) / 2;
  m.position.set(x, 0, z).addScaledVector(up, half + lift).addScaledVector(toCam, front);
  m.castShadow = true;
  scene.add(m);
  sprites.push({ mesh: m, label });
  return m;
}
const ch = (ap: Appearance, job: Job, anim: keyof typeof ANIM_COL, f: number, dir: number) => [getCharSheet(ap, job), (ANIM_COL[anim] + f) * FRAME_W, dir * FRAME_H, FRAME_W, FRAME_H] as const;
// the hero on the warhorse, the ember fox beside
// Blender frames: load, harden the alpha with a dark outline, crop to the model
const MS = 2.1; // model units to scene units
async function blenderSprite(url: string, outline: string) {
  const im = new Image(); im.src = url; await im.decode();
  const c = mk(im.width + 2, im.height + 2), g = c.getContext('2d')!;
  g.drawImage(im, 1, 1);
  const d = g.getImageData(0, 0, c.width, c.height), o = [parseInt(outline.slice(1, 3), 16), parseInt(outline.slice(3, 5), 16), parseInt(outline.slice(5, 7), 16)];
  const a = (x: number, y: number) => x >= 0 && y >= 0 && x < c.width && y < c.height && d.data[(y * c.width + x) * 4 + 3] >= 110;
  const out = new Uint8ClampedArray(d.data);
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (a(x, y)) { out[i + 3] = 255; } else if (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1)) { out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2]; out[i + 3] = 255; } else { out[i + 3] = 0; continue; }
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  g.putImageData(new ImageData(out, c.width, c.height), 0, 0);
  return [c, x0, y0, x1 - x0 + 1, y1 - y0 + 1] as const;
}
async function placeModels() {
  const [h, hx, hy, hw, hh] = await blenderSprite(horseFrame, '#1e1220');
  billboard(h, hx, hy, hw, hh, -2.4, 6.2, 0, ['Seren  Lv.200', '#ffe08a', 'the Ascendant'], 0, (3.3 / 112) * MS);
  const [f, fx, fy, fw, fh] = await blenderSprite(foxFrame, '#2a1010');
  billboard(f, fx, fy, fw, fh, -6, 7.4, 0, ['Ember · Mythic', '#ffd27a'], 0, (1.5 / 48) * MS);
  const [k, kx, ky, kw, kh] = await blenderSprite(knightFrame, '#141420');
  billboard(k, kx, ky, kw, kh, -4.6, 2.4, 0, ['Aldric  Lv.142', '#cfe0ff', 'Knight-Captain'], 0, (1.9 / 64) * MS);
}
// townsfolk
billboard(...ch({ ...defaultAppearance('ranger'), clothing: 2, color1: 4, color2: 8, helmet: 1, helmetColor: 4, hair: 2, hairColor: 2 }, 'ranger', 'idle', 0, 0), 7.2, 5.6, 0, ['Bren · Quartermaster', '#9fe0a0']);
billboard(...ch({ ...defaultAppearance('mage'), clothing: 3, color1: 5, color2: 10, helmet: 2, helmetColor: 5, cape: 2, capeColor: 5, hair: 6, hairColor: 8 }, 'mage', 'idle', 1, 1), 4.2, 3.4, 0, ['Waykeeper Ilse', '#9fe0a0']);
billboard(...ch(CLERIC, 'cleric', 'walk', 1, 2), -7.5, 1.5, 0);
billboard(...ch(RANGER, 'ranger', 'walk', 2, 1), 3.6, 6.4, 0);
billboard(...ch({ ...defaultAppearance('berserker'), hair: 3, hairColor: 5, cape: 1, capeColor: 0 }, 'berserker', 'idle', 0, 0), -3, -4.5, 0);
billboard(...ch({ ...defaultAppearance('assassin'), body: 1, hair: 6, hairColor: 7 }, 'assassin', 'idle', 1, 2), -1.6, -4.7, 0);

// petals and golden dust in the air
const dust = new THREE.BufferGeometry(), dp: number[] = [];
for (let i = 0; i < 500; i++) dp.push((rnd() - 0.5) * 40, rnd() * 8, (rnd() - 0.5) * 30);
dust.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
scene.add(new THREE.Points(dust, new THREE.PointsMaterial({ color: '#ffe0a0', size: 0.08, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })));

// ---------------------------------------------------------------------------------------------
// Light: a low golden sun with long shadows, a sky and ground fill
// ---------------------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight('#ffe2bc', '#4a4a6a', 0.9));
const sun = new THREE.DirectionalLight('#ffc888', 3.2);
sun.position.set(-22, 16, -8);
sun.target.position.set(0, 0, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 80 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------------------------------------------------------------------------------------------
// Render: low resolution, bloom, then the HUD at full resolution
// ---------------------------------------------------------------------------------------------
export async function render() {
  await placeModels();
  const view = document.getElementById('view') as HTMLCanvasElement, hud = document.getElementById('hud') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.5, 0.82));
  composer.addPass(new OutputPass());
  composer.render();
  // the HUD: vignette, name plates projected from the world, the frames of the interface
  const g = hud.getContext('2d')!;
  const v = g.createRadialGradient(640, 360, 250, 640, 360, 760); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(20,8,24,0.55)');
  g.fillStyle = v; g.fillRect(0, 0, 1280, 720);
  for (const s of sprites) {
    if (!s.label) continue;
    const top = new THREE.Vector3(0, (s.mesh.geometry as THREE.PlaneGeometry).parameters.height / 2, 0).applyMatrix4(s.mesh.matrixWorld).project(camera);
    nameplate(g, (top.x + 1) * 640, (1 - top.y) * 360 - 6, s.label[0], s.label[1], s.label[2]);
  }
  portrait(g, 16, 16, KNIGHT, 'knight', 'Seren', 'Aegis Lord · Paladin', 0.92, 0.8, ['#6fb4ff', '#1a3a8a']);
  minimap(g, 1190, 92, 70, ['#4f7f34', '#62923c', '#b4a690', '#9a3a3a', '#3e6a2e'], 'Eldoria · Market');
  hotbar(g, ['shield_bash', 'taunt', 'guard_stance', 'cleave', 'rallying_cry', 'last_stand'], 640, 632);
  chat(g, [['[Guild] Lyra: Raid at the Herald in 10!', '#a8f0b0'], ['Kael: anyone selling Armament Cores?', '#f2ead8'], ['A meteor shower strikes Frostveil!', '#7fe8ff']]);
  dock(g);
  (window as any).__done = true;
}
(window as any).__render = render;
