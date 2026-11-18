// HD pets and mounts: drawn with the same shaded shapes and outline as the HD characters.
// Pets: 24x24, two frames (a hop). Mounts: 64x48, two frames (a stride or a wing beat), facing right,
// drawn at one sprite pixel per world pixel (the classic mounts were 32x24 drawn twice as large).
import { MOUNTS, PETS } from '../../../shared/src/companions';
import { ramp } from './hdart';
import { Buf, type RGB } from './hdchars';

export const HD_PET = 24, HD_MOUNT_W = 64, HD_MOUNT_H = 48;
const cache = new Map<string, HTMLCanvasElement>();
function sheet(key: string, w: number, h: number, draw: (b: Buf, f: number) => void, after?: (g: CanvasRenderingContext2D, f: number) => void) {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = w * 2; c.height = h;
  const g = c.getContext('2d')!;
  for (let f = 0; f < 2; f++) {
    const b = new Buf(w, h);
    draw(b, f);
    const fc = b.canvas();
    if (after) after(fc.getContext('2d')!, f);
    g.drawImage(fc, f * w, 0);
  }
  cache.set(key, c);
  return c;
}
const R = (h: string, s = 0.9) => ramp(h, s);
const dark = (h: string): RGB[] => R(h, 0.6).map((c) => c.map((v) => v * 0.8) as RGB);
const WHITE: RGB = [255, 255, 255], INK: RGB = [36, 24, 30];
/** A small triangle (ears, beaks, tufts), filled flat. */
function tri(b: Buf, c: RGB, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3)), minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
  const s = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = [x + 0.5, y + 0.5] as const, d1 = s(x1, y1, x2, y2, p[0], p[1]), d2 = s(x2, y2, x3, y3, p[0], p[1]), d3 = s(x3, y3, x1, y1, p[0], p[1]);
    if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) b.px(x, y, c);
  }
}
function eye(b: Buf, x: number, y: number, big = false) {
  b.rect(x, y, big ? 2 : 1, big ? 3 : 2, INK); b.px(x, y, WHITE);
}

// ------------------------------------------------------------------ pets
export function hdPetSprite(kind: string): HTMLCanvasElement | null {
  const d = PETS[kind];
  if (!d) return null;
  const [a, bb, o] = d.colors, A = R(a), B = R(bb, 0.7), O = dark(o);
  return sheet('pet:' + kind, HD_PET, HD_PET, (b, f) => {
    const y = f ? -2 : 0;
    switch (d.shape) {
      case 'fox': case 'pup': {
        b.limb(6, 16 + y, d.shape === 'fox' ? 2 : 4, d.shape === 'fox' ? 9 + y : 13 + y, d.shape === 'fox' ? 2.6 : 1.8, A); // tail
        if (d.shape === 'fox') b.ball(2.5, 8.5 + y, 2.2, 2.2, B);
        for (const lx of [8, 14]) b.limb(lx, 18 + y, lx + (f ? 1 : 0), 22, 1.3, O);
        b.ball(11, 16 + y, 6.5, 4.5, A);
        b.ball(13, 18 + y, 3.5, 2.3, B);
        b.ball(17, 11 + y, 4.8, 4.2, A, undefined, 0.05);
        if (d.shape === 'fox') { tri(b, A[2], 14, 8 + y, 15.5, 2 + y, 18, 7 + y); tri(b, A[2], 18, 7 + y, 21, 3 + y, 21, 9 + y); tri(b, O[1], 15, 7 + y, 15.6, 4 + y, 17, 7 + y); }
        else { b.ball(14.5, 8 + y, 2, 2.5, O); b.ball(20, 8 + y, 2, 2.5, O); }
        b.ball(21, 13 + y, 2.5, 1.8, B); b.px(23, 12 + y, INK);
        eye(b, 18, 10 + y);
        break;
      }
      case 'sprout':
        for (const lx of [8, 15]) b.rect(lx, 21, 3, 2, O[1]);
        b.ball(12, 16 + y, 7, 5.8, A, undefined, 0.05);
        b.ball(12, 19 + y, 4, 2.2, B);
        b.limb(12, 10 + y, 12, 5 + y, 1, R('#4a8a3a'));
        b.ball(8, 5 + y, 4, 2.2, A); b.ball(16, 4 + y, 4, 2.2, B);
        eye(b, 9, 15 + y); eye(b, 14, 15 + y); b.px(11, 18 + y, [150, 70, 70]); b.px(12, 18 + y, [150, 70, 70]);
        break;
      case 'owl':
        b.ball(12, 14 + y, 7, 8, A, undefined, 0.05);
        b.ball(12, 17 + y, 4.5, 4.5, B);
        for (const s of [-1, 1]) { tri(b, A[1], 12 + s * 5, 7 + y, 12 + s * 7, 2 + y, 12 + s * 3, 6 + y); b.ball(12 + s * 3, 11 + y, 2.6, 2.6, R('#ffffff', 0.3)); b.rect(12 + s * 3 - (s < 0 ? 1 : 0), 10 + y, 2, 2, INK); b.px(12 + s * 3 - (s < 0 ? 1 : 0), 10 + y, WHITE); }
        tri(b, [232, 176, 74], 11, 13 + y, 13, 13 + y, 12, 15 + y);
        b.rect(9, 22, 2, 1, [232, 176, 74]); b.rect(13, 22, 2, 1, [232, 176, 74]);
        break;
      case 'toad':
        b.ball(12, 17 + y, 9.5, 5.5, A, undefined, 0.05);
        b.ball(12, 19 + y, 6, 2.6, B);
        for (const s of [-1, 1]) { b.ball(12 + s * 5, 12 + y, 2.8, 2.8, A); b.rect(12 + s * 5 - 1, 11 + y, 2, 2, INK); b.px(12 + s * 5 - 1, 11 + y, WHITE); }
        for (let x = 7; x <= 17; x++) b.px(x, 16 + y + (x === 7 || x === 17 ? -1 : 0), O[1]);
        b.rect(3, 21, 4, 2, O[2]); b.rect(17, 21, 4, 2, O[2]);
        break;
      case 'mote':
        b.ball(12, 12 + y, 5.5, 5.5, B, undefined, 0.3);
        b.ball(11, 11 + y, 2.5, 2.5, A, undefined, 0.4);
        for (const [x, yy] of [[12, 3], [12, 21], [3, 12], [21, 12]]) b.rect(x - 1, yy - 1 + y, 2, 2, A[4]);
        break;
    }
  }, d.shape === 'mote' ? (g, f) => { // a soft glow around the star
    g.globalCompositeOperation = 'destination-over';
    const gr = g.createRadialGradient(12, 12 - (f ? 2 : 0), 1, 12, 12 - (f ? 2 : 0), 12);
    gr.addColorStop(0, d.colors[1] + 'cc'); gr.addColorStop(1, d.colors[1] + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 24, 24);
  } : undefined);
}

// ------------------------------------------------------------------ mounts
export function hdMountSprite(id: string): HTMLCanvasElement | null {
  const d = MOUNTS[id];
  if (!d) return null;
  const [a, bb, o] = d.colors, A = R(a), B = R(bb, 0.7), O = dark(o);
  return sheet('mount:' + id, HD_MOUNT_W, HD_MOUNT_H, (b, f) => {
    const s = f ? 1 : -1;
    if (d.shape === 'griffin') {
      const up = f === 0;
      // far wing
      wing(b, 30, 19, up, R(bb, 0.6).map((c) => c.map((v) => v * 0.82) as RGB));
      for (const [lx, sw] of [[20, s], [40, -s]] as const) b.limb(lx, 30, lx + sw * 3, 40, 2.4, A);
      b.limb(14, 25, 5, 33, 2, A); b.ball(4.5, 34, 2.6, 2.6, O); // tail and tuft
      b.ball(27, 26, 13, 7.5, A);
      b.ball(40, 23, 7.5, 7.5, B);
      for (const [lx, sw] of [[24, -s], [43, s]] as const) { b.limb(lx, 30, lx + sw * 3, 42, 2.6, lx > 30 ? B : A); b.rect(lx + sw * 3 - 2, 42, 5, 2, [232, 176, 74]); }
      b.ball(47, 14, 6, 5.5, B, undefined, 0.05);
      tri(b, [232, 176, 74], 51, 13, 59, 16, 51, 18); tri(b, [180, 120, 50], 52, 16, 58, 16.5, 52, 18);
      tri(b, B[1], 43, 10, 44, 4, 47, 9);
      eye(b, 49, 12, true);
      wing(b, 28, 18, up, B); // near wing
      b.rect(22, 18, 14, 3, R('#7a3a2a')[2]); b.rect(22, 18, 14, 1, R('#e8c060')[3]); // a saddle
      return;
    }
    if (d.shape === 'skiff') {
      const h = f ? 1 : 0;
      b.ball(32, 31 + h, 27, 7, O, (_x, y) => y > 27 + h);
      b.body(32, 26 + h, 32 + h, 26, 22, A, 1);
      for (let x = 8; x <= 56; x++) b.px(x, 26 + h, A[4]);
      b.limb(58, 26 + h, 62, 18 + h, 1.8, A); b.ball(62, 17 + h, 2, 2, B, undefined, 0.3);
      b.limb(6, 26 + h, 3, 20 + h, 1.6, A);
      for (const x of [16, 26, 36, 46]) { b.rect(x, 30 + h, 3, 2, B[3]); b.px(x + 1, 30 + h, WHITE); }
      return;
    }
    // a four-legged beast: strider (light), charger (armoured, glowing), elk (antlers)
    const legs = [[19, s], [24, -s], [41, -s], [46, s]] as const;
    for (const [lx, sw] of legs.filter((_, i) => i % 2 === 0)) leg(b, lx, sw, O, A); // far legs, darker
    b.limb(15, 22, 8, 33 + (f ? 1 : 0), 2.4, d.shape === 'elk' ? A : O); // tail
    b.ball(31, 24, 16, 8.5, A);
    b.ball(44, 23, 7.5, 7.5, A);
    b.ball(30, 29, 11, 3, B, (_x, y) => y > 28); // a lighter belly
    b.limb(46, 20, 51, 9, 4.6, A); // neck
    b.ball(53, 8, 5.5, 4.5, A, undefined, 0.05);
    b.limb(55, 9, 61, 13, 3, A); b.px(61, 12, INK); // muzzle and nostril
    tri(b, A[1], 50, 5, 51, -1, 53, 4);
    eye(b, 54, 7);
    for (let i = 0; i < 6; i++) b.limb(47 - i * 0.3 + i, 18 - i * 2, 45 + i, 19 - i * 2, 1.2, d.shape === 'charger' ? B : O); // mane
    for (const [lx, sw] of legs.filter((_, i) => i % 2 === 1)) leg(b, lx, sw, A, A);
    // a saddle blanket with a trim
    b.body(31, 15, 25, 7, 9, d.shape === 'charger' ? R('#3a2a2a') : R('#3a5ab0'), 1);
    for (let x = 22; x <= 40; x++) b.px(x, 25, d.shape === 'charger' ? B[3] : [232, 192, 90]);
    b.rect(26, 13, 10, 3, R('#7a4a2a')[2]); b.rect(26, 13, 10, 1, R('#7a4a2a')[4]);
    if (d.shape === 'charger') { b.ball(53, 6, 4, 2.5, R('#3a3434')); b.rect(55, 6, 2, 1, B[4]); for (const x of [30, 36, 42]) b.rect(x, 17, 2, 2, B[3]); }
    if (d.shape === 'elk') for (const s2 of [-2, 2]) { b.limb(52 + s2, 5, 49 + s2, 1, 1, B); b.limb(50 + s2, 2, 46 + s2, 1, 0.8, B); b.limb(51 + s2, 2, 55 + s2, 0.5, 0.8, B); }
    if (d.shape === 'strider') for (const [x, y] of [[24, 22], [32, 27], [38, 21]]) b.ball(x, y, 1.6, 1.2, B);
  });
}
function leg(b: Buf, x: number, sw: number, c: RGB[], hoofOf: RGB[]) {
  const kx = x + sw * 2, fx = x + sw * 4;
  b.limb(x, 28, kx, 36, 2.6, c);
  b.limb(kx, 36, fx, 43, 2, c);
  b.rect(fx - 2, 43, 5, 3, hoofOf === c ? [60, 44, 34] : [44, 32, 26]);
}
function wing(b: Buf, x: number, y: number, up: boolean, c: RGB[]) {
  const tip = up ? [x - 16, y - 18] : [x - 18, y + 8], mid = up ? [x - 6, y - 14] : [x - 8, y + 6];
  for (let k = 0; k < 5; k++) b.limb(x, y, tip[0] + k * 3, tip[1] + (up ? k * 2.5 : -k * 1.5), 2.2 - k * 0.2, c);
  b.limb(x, y, mid[0], mid[1], 3.6, c);
  for (let k = 0; k < 4; k++) b.px(tip[0] + k * 3 + 1, tip[1] + (up ? k * 2.5 : -k * 1.5) + 1, c[4]);
}
