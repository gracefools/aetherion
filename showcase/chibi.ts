// 3D chibi characters for the revamp: big heads, short bodies, toon shading in three bands and an
// ink outline (an inverted hull). Built from simple shapes so every class, colour and piece of gear
// can be combined, and they turn in any direction and take the scene's lights and shadows.
import * as THREE from 'three';

const ramp = (() => {
  const d = new Uint8Array([70, 150, 220, 255]);
  const t = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const mats = new Map<string, THREE.Material>();
export function toon(color: string, emissive = 0) {
  const k = color + emissive;
  if (!mats.has(k)) mats.set(k, new THREE.MeshToonMaterial({ color, gradientMap: ramp, emissive: emissive ? color : '#000000', emissiveIntensity: emissive }));
  return mats.get(k)!;
}
const INK = new THREE.MeshBasicMaterial({ color: '#1a1020', side: THREE.BackSide });

type V3 = [number, number, number];
/** Adds a shape with its outline to a group. */
export function put(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], ink = 0.045) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...pos); mesh.rotation.set(...rot); mesh.scale.set(...scale);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  if (ink) {
    const o = new THREE.Mesh(geo, INK);
    o.position.copy(mesh.position); o.rotation.copy(mesh.rotation);
    geo.computeBoundingSphere();
    const r = geo.boundingSphere!.radius;
    o.scale.set(...scale.map((s) => s * (1 + ink / Math.max(0.05, r * s))) as V3);
    g.add(o);
  }
  return mesh;
}
export const sph = (r: number, ws = 18, hs = 14, t0 = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, t0, tl);
export const cyl = (rt: number, rb: number, h: number, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
export const boxg = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export interface Look {
  skin?: string; hair: string; hairStyle?: 'short' | 'long' | 'spiky' | 'bun';
  eyes?: string; top: string; trim?: string; legs?: string; boots?: string;
  armor?: string; helmet?: string; plume?: string; hat?: string; cape?: string; scarf?: string;
  weapon?: 'sword' | 'staff' | 'bow' | 'axe' | 'daggers' | 'mace'; weaponGlow?: string; shield?: string;
  pose?: 'idle' | 'walk' | 'wave';
}

/** A chibi character about 2.4 units tall, facing +Z. */
export function chibi(l: Look) {
  const g = new THREE.Group();
  const skin = toon(l.skin ?? '#f4c8a0'), top = toon(l.top), trim = toon(l.trim ?? '#e8c060'), legs = toon(l.legs ?? '#3a3048'), boots = toon(l.boots ?? '#4a2e1e');
  const armor = l.armor ? toon(l.armor) : null, walk = l.pose === 'walk' ? 1 : 0;
  // legs and boots
  for (const s of [-1, 1]) {
    const sw = walk * s * 0.35;
    put(g, cyl(0.1, 0.09, 0.42), legs, [0.13 * s, 0.32, sw * 0.3], [sw, 0, 0]);
    put(g, boxg(0.2, 0.17, 0.3), boots, [0.13 * s, 0.09, 0.04 + sw * 0.45], [0, 0, 0]);
  }
  // tunic skirt, body, belt
  put(g, cyl(0.27, 0.36, 0.3), top, [0, 0.55, 0]);
  put(g, cyl(0.25, 0.28, 0.5), armor ?? top, [0, 0.9, 0]);
  put(g, cyl(0.29, 0.29, 0.07), trim, [0, 0.69, 0], [0, 0, 0], [1, 1, 1], 0.02);
  if (armor) put(g, boxg(0.16, 0.2, 0.04), trim, [0, 0.95, 0.26], [0, 0, 0], [1, 1, 1], 0.015); // emblem
  // arms, hands, pauldrons
  for (const s of [-1, 1]) {
    const lift = l.pose === 'wave' && s === -1 ? -2.4 : -walk * s * 0.4;
    const arm = new THREE.Group(); arm.position.set(0.33 * s, 1.08, 0); arm.rotation.set(lift, 0, 0.28 * s);
    put(arm, cyl(0.085, 0.075, 0.42), armor ?? top, [0, -0.2, 0]);
    put(arm, sph(0.09), skin, [0, -0.44, 0]);
    if (armor) put(arm, sph(0.15, 14, 10, 0, Math.PI / 2), armor, [0, 0.02, 0], [0, 0, 0], [1, 0.8, 1]);
    g.add(arm);
    if (s === 1 && l.weapon) arm.add(weapon(l.weapon, l.weaponGlow));
    if (s === -1 && l.shield) { const sh = new THREE.Group(); put(sh, cyl(0.26, 0.26, 0.06, 6), toon(l.shield), [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1.3]); put(sh, cyl(0.12, 0.12, 0.08, 6), trim, [0, 0, 0.02], [Math.PI / 2, 0, 0], [1, 1, 1.3], 0.01); sh.position.set(-0.08, -0.36, 0.18); sh.rotation.y = -0.3; arm.add(sh); }
  }
  // cape and scarf
  if (l.cape) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 0.95, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76), new THREE.MeshToonMaterial({ color: l.cape, gradientMap: ramp, side: THREE.DoubleSide }));
    c.position.set(0, 0.68, -0.04); c.rotation.x = 0.08; c.castShadow = true; g.add(c);
  }
  if (l.scarf) {
    put(g, new THREE.TorusGeometry(0.2, 0.07, 8, 20), toon(l.scarf), [0, 1.16, 0], [Math.PI / 2, 0, 0], [1, 1, 1], 0.025);
    put(g, boxg(0.12, 0.38, 0.05), toon(l.scarf), [0.12, 0.98, -0.22], [0.5, 0, 0.3], [1, 1, 1], 0.02);
  }
  // the head: a big sphere, eyes with a highlight, blush, a small mouth
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); g.add(head);
  put(head, sph(0.46, 24, 18), skin, [0, 0, 0], [0, 0, 0], [1, 0.95, 0.95], 0.05);
  for (const s of [-1, 1]) {
    put(head, boxg(0.085, 0.15, 0.03), toon(l.eyes ?? '#2a1a3a'), [0.15 * s, -0.04, 0.425], [0, 0.32 * s, 0], [1, 1, 1], 0);
    put(head, boxg(0.035, 0.05, 0.03), toon('#ffffff', 0.6), [0.15 * s + 0.02, 0.0, 0.44], [0, 0.32 * s, 0], [1, 1, 1], 0);
    put(head, boxg(0.08, 0.03, 0.02), toon('#ff9a9a'), [0.25 * s, -0.14, 0.37], [0, 0.55 * s, 0], [1, 1, 1], 0);
  }
  put(head, boxg(0.06, 0.02, 0.02), toon('#8a3a3a'), [0, -0.2, 0.41], [0, 0, 0], [1, 1, 1], 0);
  // hair, or a helmet, or a hat
  const hair = toon(l.hair);
  if (l.helmet) {
    put(head, sph(0.5, 22, 14, 0, Math.PI * 0.56), toon(l.helmet), [0, 0.02, -0.02], [-0.25, 0, 0]);
    put(head, boxg(0.1, 0.32, 0.06), toon(l.helmet), [0, 0.18, 0.44], [-0.2, 0, 0], [1, 1, 1], 0.02); // nasal guard
    for (const s of [-1, 1]) put(head, boxg(0.1, 0.36, 0.3), toon(l.helmet), [0.42 * s, -0.12, 0.05], [0, 0, 0], [1, 1, 1], 0.02); // cheek plates
    if (l.plume) for (let i = 0; i < 5; i++) put(head, sph(0.11), toon(l.plume), [0, 0.52 - i * 0.03, 0.2 - i * 0.14], [0, 0, 0], [0.7, 1, 1.2], 0.02);
  } else {
    put(head, sph(0.5, 22, 14, 0, Math.PI * 0.5), hair, [0, 0.04, -0.03], [-0.35, 0, 0]);
    put(head, sph(0.48, 20, 12), hair, [0, -0.06, -0.12], [0, 0, 0], [1, 1, 0.9]); // the back
    for (let i = -2; i <= 2; i++) put(head, new THREE.ConeGeometry(0.11, 0.3, 6), hair, [i * 0.13, 0.22, 0.38], [2.6, 0, i * 0.15], [1, 1, 0.7], 0.02); // bangs
    if (l.hairStyle === 'spiky') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; put(head, new THREE.ConeGeometry(0.13, 0.42, 6), hair, [Math.cos(a) * 0.32, 0.32, Math.sin(a) * 0.32 - 0.08], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], [1, 1, 1], 0.02); }
    if (l.hairStyle === 'long') put(head, cyl(0.38, 0.3, 0.8), hair, [0, -0.45, -0.2], [0.15, 0, 0]);
    if (l.hairStyle === 'bun') put(head, sph(0.18), hair, [0, 0.42, -0.3]);
  }
  if (l.hat) {
    put(head, cyl(0.62, 0.62, 0.05, 20), toon(l.hat), [0, 0.3, 0], [-0.15, 0, 0]);
    put(head, new THREE.ConeGeometry(0.36, 0.85, 16), toon(l.hat), [0, 0.7, -0.08], [-0.35, 0, 0.12]);
    put(head, cyl(0.37, 0.37, 0.08, 16), trim, [0, 0.36, -0.01], [-0.15, 0, 0], [1, 1, 1], 0.01);
  }
  return g;
}

function weapon(kind: NonNullable<Look['weapon']>, glow?: string) {
  const w = new THREE.Group(), steel = toon('#d8dcea'), wood = toon('#6a4426'), gold = toon('#e8c060');
  w.position.set(0, -0.44, 0.04);
  if (kind === 'sword') {
    put(w, boxg(0.07, 0.75, 0.025), glow ? toon(glow, 1.2) : steel, [0, 0.5, 0.06], [0.2, 0, 0], [1, 1, 1], 0.02);
    put(w, boxg(0.26, 0.05, 0.06), gold, [0, 0.12, 0.02], [0.2, 0, 0], [1, 1, 1], 0.015);
  } else if (kind === 'staff') {
    put(w, cyl(0.03, 0.035, 1.5, 8), wood, [0, 0.3, 0], [0, 0, 0], [1, 1, 1], 0.015);
    put(w, new THREE.OctahedronGeometry(0.13, 0), toon(glow ?? '#7ae0ff', 2), [0, 1.12, 0], [0, 0, 0], [1, 1.5, 1], 0.02);
  } else if (kind === 'bow') {
    put(w, new THREE.TorusGeometry(0.42, 0.03, 6, 20, Math.PI), wood, [0, 0, 0.08], [0, Math.PI / 2, Math.PI / 2], [1, 1, 1], 0.015);
  } else if (kind === 'axe') {
    put(w, cyl(0.03, 0.03, 0.9, 8), wood, [0, 0.25, 0.05], [0.2, 0, 0], [1, 1, 1], 0.015);
    put(w, cyl(0.24, 0.24, 0.05, 3, ), steel, [0, 0.62, 0.15], [Math.PI / 2, 0, 0.2], [1, 1, 1], 0.02);
  } else if (kind === 'mace') {
    put(w, cyl(0.03, 0.03, 0.6, 8), wood, [0, 0.2, 0.05], [0.2, 0, 0], [1, 1, 1], 0.015);
    put(w, new THREE.IcosahedronGeometry(0.13, 0), steel, [0, 0.52, 0.11], [0, 0, 0], [1, 1, 1], 0.02);
  } else {
    put(w, boxg(0.05, 0.38, 0.02), steel, [0, 0.25, 0.06], [0.3, 0, 0], [1, 1, 1], 0.015);
  }
  return w;
}

/** The mythic ember fox, facing +Z: orange coat, white chest, a big tail with a burning tip. */
export function fox() {
  const g = new THREE.Group(), fur = toon('#f07a30'), white = toon('#fff4e4'), black = toon('#2a1a1a');
  put(g, sph(0.3), fur, [0, 0.42, -0.05], [0, 0, 0], [0.85, 0.8, 1.3]);
  put(g, sph(0.2), white, [0, 0.42, 0.22], [0, 0, 0], [0.9, 1, 0.8]);
  for (const [x, z] of [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.28], [0.14, -0.28]]) put(g, cyl(0.06, 0.05, 0.3, 8), black, [x, 0.15, z]);
  const head = new THREE.Group(); head.position.set(0, 0.82, 0.3); g.add(head);
  put(head, sph(0.28), fur, [0, 0, 0], [0, 0, 0], [1.05, 0.95, 0.95]);
  put(head, new THREE.ConeGeometry(0.13, 0.26, 10), white, [0, -0.08, 0.28], [Math.PI / 2, 0, 0]);
  put(head, sph(0.045), black, [0, -0.06, 0.42], [0, 0, 0], [1, 1, 1], 0);
  for (const s of [-1, 1]) {
    put(head, new THREE.ConeGeometry(0.11, 0.3, 4), fur, [0.16 * s, 0.3, -0.02], [0, 0, -0.3 * s]);
    put(head, boxg(0.06, 0.1, 0.03), toon('#2a1a3a'), [0.11 * s, 0.03, 0.25], [0, 0.35 * s, 0], [1, 1, 1], 0);
    put(head, boxg(0.025, 0.035, 0.03), toon('#ffffff', 0.6), [0.11 * s + 0.015, 0.05, 0.265], [0, 0.35 * s, 0], [1, 1, 1], 0);
  }
  put(g, sph(0.24), fur, [0, 0.78, -0.55], [-0.7, 0, 0], [0.8, 1.5, 0.8]);
  put(g, sph(0.17), white, [0, 1.12, -0.78], [-0.7, 0, 0], [0.8, 1.2, 0.8]);
  put(g, new THREE.OctahedronGeometry(0.17, 0), toon('#ffb43a', 3), [0, 1.3, -0.86], [0, 0, 0], [1, 1.6, 1], 0);
  const l = new THREE.PointLight('#ff9a40', 1.2, 3, 1.8); l.position.set(0, 1.3, -0.86); g.add(l);
  return g;
}

/** A toon material with a texture, on the same light ramp as the characters. */
export function toonMap(map: THREE.Texture, side: THREE.Side = THREE.FrontSide) { return new THREE.MeshToonMaterial({ map, gradientMap: ramp, side }); }
