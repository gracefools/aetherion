// Redrawn creatures for the art-direction showcase: a barded warhorse, a sky griffin and a mythic
// ember fox, drawn as shaded shapes and then made pixel-crisp with a coloured outline, the same
// treatment the characters get.
type G = CanvasRenderingContext2D;
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Hard alpha edges and a one-pixel outline in a dark tone of the creature's own colour. */
function crisp(c: HTMLCanvasElement, outline: string) {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width, H = c.height;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
  const o = hex(outline), out = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < W && yy < H && d[(yy * W + xx) * 4 + 3]; });
    if (n) { out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2]; out[i + 3] = 255; }
  }
  g.putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}
const ell = (g: G, x: number, y: number, rx: number, ry: number, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 7); g.fill(); };
const poly = (g: G, pts: number[]) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
/** Shade inside what is already drawn: light from the upper left, shadow to the lower right. */
function shade(g: G, W: number, H: number, hi: string, lo: string, lx = -0.35, ly = -0.45) {
  g.save(); g.globalCompositeOperation = 'source-atop';
  g.fillStyle = lo; g.globalAlpha = 0.55; ell(g, W * (0.5 - lx), H * (0.5 - ly), W * 0.55, H * 0.42);
  g.fillStyle = hi; g.globalAlpha = 0.5; ell(g, W * (0.5 + lx * 0.9), H * (0.5 + ly * 0.9), W * 0.3, H * 0.22);
  g.restore();
}

/** A barded warhorse, facing right, two frames (legs mid-stride). 72 x 56. */
export function warhorse(frame: 0 | 1): HTMLCanvasElement {
  const c = mk(72, 56), g = c.getContext('2d')!;
  const coat = '#7a4a2c', coatHi = '#b07848', coatLo = '#4e2e1a', mane = '#241612';
  const leg = (x: number, y0: number, a: number, far: boolean) => {
    g.save(); g.translate(x, y0); g.rotate(a);
    g.fillStyle = far ? coatLo : coat; g.fillRect(-2.5, 0, 5, 9); g.fillRect(-2, 9, 4, 9);
    g.fillStyle = '#e8dcc8'; g.fillRect(-2.5, 15, 5, 3); // white socks
    g.fillStyle = '#2a1c14'; g.fillRect(-3, 18, 6, 3);
    g.restore();
  };
  const s = frame ? 1 : -1;
  leg(22, 30, 0.25 * s, true); leg(46, 30, -0.25 * s, true); // far legs
  // tail
  g.fillStyle = mane; g.beginPath(); g.moveTo(15, 22); g.quadraticCurveTo(4, 26, 7, 44); g.quadraticCurveTo(12, 34, 17, 26); g.fill();
  // body, chest, haunch
  g.fillStyle = coat; ell(g, 34, 26, 19, 10); ell(g, 49, 25, 8, 9); ell(g, 20, 25, 9, 9.5);
  // neck and head
  poly(g, [44, 24, 52, 20, 60, 6, 54, 3, 44, 15]);
  ell(g, 60, 9, 8, 4.5, 0.55);
  g.fillStyle = coatLo; ell(g, 65, 13, 3.5, 3, 0.4); // muzzle
  poly(g, [55, 4, 56, -1, 58, 4]); // ear
  shade(g, 72, 56, coatHi, coatLo);
  // mane flowing down the neck
  g.fillStyle = mane; poly(g, [54, 2, 46, 13, 43, 22, 45, 24, 49, 15, 57, 5]);
  g.fillStyle = '#4a3024'; poly(g, [53, 4, 48, 12, 47, 15, 52, 8]);
  // the barding: royal cloth with a gold hem, the saddle
  g.fillStyle = '#2f4f9a'; poly(g, [18, 18, 48, 18, 50, 33, 44, 36, 38, 33, 32, 36, 26, 33, 20, 36, 16, 31]);
  g.fillStyle = '#4a72c8'; poly(g, [20, 19, 46, 19, 46, 23, 20, 23]);
  g.fillStyle = '#e2b84a'; for (let x = 18; x < 50; x += 6) poly(g, [x, 33, x + 3, 37, x + 6, 33, x + 6, 34.5, x + 3, 38.5, x, 34.5]);
  g.fillStyle = '#f6dc7a'; ell(g, 33, 27, 3, 3); g.fillStyle = '#2f4f9a'; ell(g, 33, 27, 1.4, 1.4);
  g.fillStyle = '#5a3420'; poly(g, [26, 16, 40, 16, 42, 20, 24, 20]); g.fillStyle = '#7a4a2c'; poly(g, [28, 16, 38, 16, 38, 17.5, 28, 17.5]);
  // near legs
  leg(26, 30, -0.3 * s, false); leg(50, 30, 0.3 * s, false);
  // bridle and eye
  g.fillStyle = '#e2b84a'; g.fillRect(57, 7, 1, 7); g.fillRect(57, 12, 8, 1);
  g.fillStyle = '#100808'; g.fillRect(61, 7, 2, 2); g.fillStyle = '#fff'; g.fillRect(61, 7, 1, 1);
  return crisp(c, '#1e120c');
}

/** A sky griffin, facing right, two frames (wings up, wings down). 104 x 80. */
export function griffin(frame: 0 | 1): HTMLCanvasElement {
  const c = mk(104, 80), g = c.getContext('2d')!;
  const fur = '#c89a58', furHi = '#ecc888', furLo = '#8a6236', white = '#ddd4c8', whiteLo = '#a8a094', gold = '#e0a83a';
  const wing = (back: boolean) => {
    const up = frame === 0;
    g.save(); g.translate(46, 34); if (back) g.translate(-6, -3);
    const tips: [number, number][] = up ? [[-30, -34], [-18, -40], [-6, -42], [6, -38], [14, -30]] : [[-34, 10], [-26, 18], [-14, 22], [-2, 20], [8, 14]];
    g.fillStyle = back ? whiteLo : white;
    g.beginPath(); g.moveTo(-6, 0); for (const [x, y] of tips) g.lineTo(x, y); g.lineTo(12, -2); g.closePath(); g.fill();
    // primaries with gold tips
    for (const [x, y] of tips) { g.fillStyle = back ? '#b8964a' : gold; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (up ? 7 : 6), y + (up ? 9 : -6)); g.lineTo(x + (up ? -2 : 3), y + (up ? 8 : -9)); g.fill(); }
    g.fillStyle = back ? '#a8a098' : '#ddd6cc';
    for (let i = 0; i < 4; i++) { const t = (i + 1) / 5, x = -6 + (tips[2][0] + 6) * t * 0.7, y = (tips[2][1]) * t * 0.7; g.fillRect(x - 1, y - 1, 10, 2); }
    g.restore();
  };
  wing(true);
  // lion hindquarters, tail with a tuft
  g.fillStyle = fur; g.beginPath(); g.moveTo(22, 36); g.quadraticCurveTo(6, 30, 4, 46); g.lineTo(7, 46); g.quadraticCurveTo(10, 36, 22, 40); g.fill();
  g.fillStyle = '#6a4a28'; ell(g, 5, 47, 3.5, 4);
  g.fillStyle = fur; ell(g, 40, 40, 20, 10); ell(g, 26, 41, 10, 10);
  g.fillStyle = furLo; g.fillRect(20, 46, 6, 14); g.fillRect(30, 46, 6, 13); // hind legs
  g.fillStyle = fur; g.fillRect(22, 46, 5, 14); g.fillRect(32, 47, 5, 12);
  g.fillStyle = '#5a3e22'; g.fillRect(21, 59, 7, 3); g.fillRect(31, 58, 7, 3);
  // eagle chest and head
  g.fillStyle = white; ell(g, 56, 36, 11, 11); ell(g, 66, 22, 9, 8);
  g.fillStyle = whiteLo; ell(g, 58, 42, 8, 5);
  // talons (front legs)
  g.fillStyle = gold; g.fillRect(52, 45, 4, 12); g.fillRect(60, 45, 4, 11);
  g.fillStyle = '#3a2a18'; for (const x of [50, 54, 58, 62]) g.fillRect(x, 56, 3, 2);
  shade(g, 104, 80, furHi, furLo, -0.2, -0.3);
  // beak and eye, a crest
  g.fillStyle = gold; poly(g, [72, 20, 82, 22, 78, 25, 73, 26]); g.fillStyle = '#b8862a'; poly(g, [76, 24, 81, 22.5, 79, 25]);
  g.fillStyle = '#1a1010'; g.fillRect(68, 19, 2, 2); g.fillStyle = '#ffe08a'; g.fillRect(68, 19, 1, 1);
  g.fillStyle = '#e8e0d4'; poly(g, [60, 16, 54, 10, 62, 14, 58, 6, 65, 14]);
  // a saddle of blue and gold
  g.fillStyle = '#2f4f9a'; poly(g, [36, 30, 50, 30, 51, 37, 35, 37]); g.fillStyle = gold; g.fillRect(35, 36, 16, 2);
  wing(false);
  return crisp(c, '#2a1c14');
}

/** A mythic ember fox: tail tipped with living flame. 40 x 32, two frames. */
export function emberFox(frame: 0 | 1): HTMLCanvasElement {
  const c = mk(40, 32), g = c.getContext('2d')!, hop = frame ? -1 : 0;
  const o = '#e2662a', hi = '#ffa04a', lo = '#a8461a';
  // tail with a flame tip
  g.fillStyle = o; g.beginPath(); g.moveTo(10, 20 + hop); g.quadraticCurveTo(0, 18, 3, 8); g.quadraticCurveTo(8, 14, 14, 18 + hop); g.fill();
  g.fillStyle = '#fff2d8'; ell(g, 3.5, 9, 3, 3.5);
  g.fillStyle = '#ffd24a'; poly(g, [1, 9, 3, 1, 4, 6, 6, 0, 6.5, 8]);
  // body, head, ears
  g.fillStyle = o; ell(g, 18, 20 + hop, 9, 5.5); ell(g, 28, 14 + hop, 6, 5.5);
  poly(g, [24, 10 + hop, 25, 3 + hop, 28, 9 + hop]); poly(g, [29, 9 + hop, 32, 3 + hop, 33, 11 + hop]);
  poly(g, [32, 15 + hop, 38, 16 + hop, 33, 18 + hop]); // snout
  shade(g, 40, 32, hi, lo, -0.25, -0.35);
  g.fillStyle = '#fff2d8'; ell(g, 30, 17 + hop, 3.5, 2.5); ell(g, 22, 22 + hop, 4, 2.5); // chest and cheek
  g.fillStyle = '#2a1410'; poly(g, [24.5, 4 + hop, 25, 3 + hop, 26, 6 + hop]); poly(g, [31.5, 4 + hop, 32, 3 + hop, 32.5, 6 + hop]);
  g.fillStyle = '#1a0c08'; g.fillRect(37, 15 + hop, 2, 2); g.fillRect(29, 12 + hop, 2, 2); g.fillStyle = '#fff'; g.fillRect(29, 12 + hop, 1, 1);
  // legs
  g.fillStyle = '#3a1c10'; for (const [x, d] of [[12, 1], [16, -1], [22, 1], [25, -1]] as const) g.fillRect(x + (frame ? d : 0), 24 + hop, 2.5, 6);
  return crisp(c, '#3a160a');
}
