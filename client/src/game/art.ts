// World art (original, generated in code with pixel-art technique: limited ramps, top-left light,
// hand-shaped silhouettes, organic terrain edges, two-layer trees). Replaced by imported atlases
// in M8; the renderer only depends on buildChunk().
import { TILE } from '../../../shared/src/protocol';
import { T, tileAt, type ZoneMap } from '../../../shared/src/world';

type G = CanvasRenderingContext2D;
const TS = TILE;
export const CHUNK = 16;
export const CHUNK_PX = CHUNK * TS;

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
export const mk = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const px = (g: G, c: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x: number, y: number, s = 0) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
/** Filled pixel disc (no anti-aliasing). */
function disc(g: G, c: string, cx: number, cy: number, r: number) {
  g.fillStyle = c;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

type TreeKind = 'broad' | 'pine' | 'dead' | 'crystal' | 'pillar' | 'rock';
interface Pal {
  g: string; gd: string; gl: string; gt: string; // ground base / dark / light / tuft
  leaf: string[]; // canopy (or crystal / stone) ramp dark -> light
  trees: TreeKind[]; // obstacle sprite per variant
  dirt: [string, string, string, string]; // path base / dark / light / pebble shadow
  liquid: [string, string, string, string]; // base / dark / light / sparkle
  bank: string; foam: string;
  cobble: [string, string[]]; // mortar, stone tones
  rock: [string, string, string]; // dungeon wall top / face / mortar
  flora: [string, string][]; // petal / core pairs for the small ground decoration
  blades: boolean; // grass-like blades and tufts (off for stone floors)
}
const GREEN_FLORA: [string, string][] = [['#f4e27a', '#d99a2b'], ['#f0a3c0', '#c85a86'], ['#f6f2ea', '#e2c34a'], ['#a9cdf5', '#5f8fd6'], ['#e8694f', '#f2d36b']];
const BASE = {
  dirt: ['#c3a474', '#ae8d5f', '#d9c193', '#8f7550'] as Pal['dirt'], liquid: ['#3f7cc6', '#3368b0', '#86b8ea', '#ffffff'] as Pal['liquid'], bank: '#6a583d', foam: '#cfe6fa',
  cobble: ['#8c8779', ['#bdb8a9', '#c9c4b5', '#b3ad9d', '#c2bba6']] as Pal['cobble'], rock: ['#3a3844', '#5a5766', '#2a2832'] as Pal['rock'], flora: GREEN_FLORA, blades: true,
};
const PALS: Record<string, Pal> = {
  kingdom: { ...BASE, g: '#5d9e4e', gd: '#4c8a45', gl: '#78b65c', gt: '#3d7541', leaf: ['#1f4d33', '#2c6b3a', '#3f8a44', '#63ab52', '#8fca62'], trees: ['broad'] },
  forest: { ...BASE, g: '#4b8748', gd: '#3d7341', gl: '#629d53', gt: '#2e5c39', leaf: ['#15382c', '#1f5134', '#2d6b3c', '#44894a', '#69a657'], trees: ['broad', 'pine'] },
  // Ashen Highlands: ash-grey ground, charred trees, basalt paths, lava
  ashen: {
    ...BASE, g: '#6f625a', gd: '#5c514a', gl: '#85776d', gt: '#3f3632', leaf: ['#1c1513', '#2e221d', '#4a352a', '#c9622a', '#ffb44a'], trees: ['dead', 'rock'],
    dirt: ['#4d4547', '#3e3739', '#625a5c', '#2c2729'], liquid: ['#e2622a', '#b8431c', '#ffb44a', '#ffe9a0'], bank: '#2a2224', foam: '#ffd27a',
    cobble: ['#3a3436', ['#5d5557', '#69605f', '#554d4f', '#62595a']], flora: [['#ffb44a', '#e2622a'], ['#8a7a70', '#5c514a']],
  },
  // Frostveil: snow, snow-laden pines, packed-snow paths, ice water
  frost: {
    ...BASE, g: '#dde8f1', gd: '#c8d7e6', gl: '#f5fafe', gt: '#a3bad2', leaf: ['#1d3b46', '#2a5560', '#3b7078', '#d7e6ee', '#ffffff'], trees: ['pine', 'pine', 'rock'],
    dirt: ['#b5c4d4', '#a2b3c6', '#cfdbe7', '#8a9cb2'], liquid: ['#7fb8dc', '#6aa3cc', '#b7dcf2', '#ffffff'], bank: '#9fb6cf', foam: '#ffffff',
    cobble: ['#8794a6', ['#b9c6d6', '#c7d3e0', '#adbbcd', '#bfcbdb']], flora: [['#b7dcf2', '#ffffff'], ['#9fd0ee', '#e8f6ff']],
  },
  // Dreadmoor: murky ground, bare trees, mud paths, swamp water
  moor: {
    ...BASE, g: '#4f5b45', gd: '#434f3c', gl: '#63704f', gt: '#2f3a2b', leaf: ['#1a221b', '#263226', '#35432f', '#4c5a39', '#6f7a45'], trees: ['dead', 'broad', 'dead'],
    dirt: ['#6a5a45', '#59493a', '#7f6d55', '#40352a'], liquid: ['#3d5a48', '#324c3d', '#6b8a62', '#b9d08a'], bank: '#2c3326', foam: '#8fa878',
    cobble: ['#474b40', ['#6c7061', '#77796a', '#62665a', '#70705f']], flora: [['#c9d08a', '#7a8a3a'], ['#b08ad0', '#6a4a8a'], ['#e0d8c0', '#9a8a60']],
  },
  // Astral Ruins: violet ground, crystals, ancient paving, void
  astral: {
    ...BASE, g: '#3b3663', gd: '#302c54', gl: '#4f497d', gt: '#8f7fe0', leaf: ['#2a1d55', '#4a3a9a', '#7a66d8', '#b9a2ff', '#e8dcff'], trees: ['crystal', 'pillar', 'crystal'],
    dirt: ['#7d7896', '#6a6584', '#9a95b2', '#4f4b66'], liquid: ['#18122f', '#100c22', '#5a47b0', '#d8c8ff'], bank: '#6a5fb0', foam: '#b9a2ff',
    cobble: ['#4c4868', ['#8a86a6', '#9692b2', '#7e7a9a', '#908cab']], flora: [['#e8dcff', '#b9a2ff'], ['#7fd6ff', '#ffffff']],
  },
  // Dungeon interiors: stone floors, no blades of grass
  ruins: {
    ...BASE, blades: false, g: '#70766a', gd: '#636a5e', gl: '#828877', gt: '#4f6a45', leaf: ['#3a3d36', '#575b50', '#7a7f70', '#9ea392', '#c3c8b6'], trees: ['pillar'],
    dirt: ['#8a8f80', '#7a7f70', '#9ea392', '#5c6055'], liquid: ['#2f6f66', '#255c54', '#62a89c', '#c8fff2'], bank: '#4a4f44', foam: '#9fd8cc',
    cobble: ['#55594e', ['#8d9283', '#989d8d', '#82877a', '#929786']], rock: ['#33372f', '#555a4e', '#23261f'], flora: [['#7fbf6a', '#4f8a45'], ['#9ad6c8', '#4f9a8a']],
  },
  lair: {
    ...BASE, blades: false, g: '#5a433c', gd: '#4c3832', gl: '#6e554c', gt: '#2e211d', leaf: ['#1c1513', '#3a2a24', '#5c4034', '#8a5a40', '#c98a5a'], trees: ['rock'],
    dirt: ['#6c5248', '#5c453d', '#826558', '#3e2e28'], liquid: ['#e2622a', '#b8431c', '#ffb44a', '#ffe9a0'], bank: '#2a1c18', foam: '#ffd27a',
    cobble: ['#3e2e28', ['#7a5f54', '#866a5e', '#70564c', '#806457']], rock: ['#2a1f1c', '#4a3731', '#1a1311'], flora: [['#ffb44a', '#e2622a']],
  },
  citadel: {
    ...BASE, blades: false, g: '#a9c3d8', gd: '#98b4cb', gl: '#c3d8e8', gt: '#6f93b4', leaf: ['#3f6a8a', '#5f8fb0', '#8fbfdc', '#c3e3f5', '#ffffff'], trees: ['crystal', 'pillar'],
    dirt: ['#8eabc4', '#7d9cb7', '#a9c3d8', '#5f7f9c'], liquid: ['#5a9fd0', '#4a8cc0', '#9fd0ee', '#ffffff'], bank: '#6f93b4', foam: '#ffffff',
    cobble: ['#5f7f9c', ['#a3bdd3', '#b1c9dc', '#96b2ca', '#aac3d7']], rock: ['#3a5068', '#5f7f9c', '#28384a'], flora: [['#c3e3f5', '#ffffff']],
  },
  temple: {
    ...BASE, blades: false, g: '#3f5257', gd: '#34464b', gl: '#506469', gt: '#2a8a7a', leaf: ['#1a2a2e', '#2f4a4f', '#4a6f74', '#6fa3a0', '#a8dcd0'], trees: ['pillar', 'rock'],
    dirt: ['#566b70', '#485c61', '#6a8085', '#33454a'], liquid: ['#12202a', '#0c1820', '#2a8a7a', '#8fffe0'], bank: '#1f2e33', foam: '#2a8a7a',
    cobble: ['#2a3a3f', ['#5f757a', '#6a8085', '#556a6f', '#647a7f']], rock: ['#1c2a2e', '#34494e', '#111b1e'], flora: [['#8fffe0', '#2a8a7a']],
  },
};

type Tex = Record<string, HTMLCanvasElement[]>;
const texCache = new Map<string, Tex>();

function grass(g: G, r: () => number, p: Pal) {
  px(g, p.g, 0, 0, TS, TS);
  if (!p.blades) return void floor(g, r, p);
  for (let i = 0; i < 7; i++) { // soft darker clumps
    const x = Math.floor(r() * 28), y = Math.floor(r() * 28), w = 3 + Math.floor(r() * 4);
    px(g, p.gd, x + 1, y, w - 1, 1);
    px(g, p.gd, x, y + 1, w + 1, 1);
    if (r() < 0.5) px(g, p.gd, x + 1, y + 2, w - 2, 1);
  }
  for (let i = 0; i < 9; i++) { // blades
    const x = Math.floor(r() * 31), y = 1 + Math.floor(r() * 29);
    px(g, p.gl, x, y, 1, 2);
    if (r() < 0.5) px(g, p.gl, x + 1, y - 1, 1, 2);
  }
  for (let i = 0; i < 4; i++) { // tufts
    const x = 1 + Math.floor(r() * 27), y = 2 + Math.floor(r() * 26);
    px(g, p.gt, x, y, 1, 2); px(g, p.gt, x + 2, y - 1, 1, 3); px(g, p.gt, x + 4, y, 1, 2);
    px(g, p.gl, x + 1, y - 1, 1, 1); px(g, p.gl, x + 3, y - 2, 1, 1);
  }
}
/** Worn flagstones for dungeon floors: large slabs with cracks, lit from the top-left. */
function floor(g: G, r: () => number, p: Pal) {
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      const x = col * 16, y = row * 16, tone = r();
      px(g, tone < 0.3 ? p.gd : tone > 0.75 ? p.gl : p.g, x, y, 16, 16);
      px(g, p.gl, x, y, 15, 1); px(g, p.gl, x, y, 1, 15);
      px(g, p.gd, x, y + 15, 16, 1); px(g, p.gd, x + 15, y, 1, 16);
    }
  for (let i = 0; i < 3; i++) { // cracks
    let x = 2 + Math.floor(r() * 26), y = 2 + Math.floor(r() * 26);
    for (let k = 0; k < 5; k++) { px(g, p.gt, x, y); x += r() < 0.5 ? 1 : 0; y += r() < 0.6 ? 1 : 0; }
  }
  for (let i = 0; i < 5; i++) px(g, p.gd, Math.floor(r() * 30), Math.floor(r() * 30), 2, 1);
}
function flowers(g: G, r: () => number, p: Pal) {
  const cols = p.flora, stem = p.blades ? p.gt : p.gd;
  for (let i = 0; i < 4; i++) {
    const x = 3 + Math.floor(r() * 24), y = 4 + Math.floor(r() * 22), [petal, core] = cols[Math.floor(r() * cols.length)];
    px(g, stem, x + 1, y + 2, 1, 3);
    px(g, stem, x + 2, y + 3, 1, 1);
    px(g, petal, x + 1, y - 1); px(g, petal, x, y); px(g, petal, x + 2, y); px(g, petal, x + 1, y + 1);
    px(g, core, x + 1, y);
  }
}
function dirt(g: G, r: () => number, p: Pal) {
  const [DIRT, DIRT_D, DIRT_L, DIRT_S] = p.dirt;
  px(g, DIRT, 0, 0, TS, TS);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(r() * 27), y = Math.floor(r() * 29), w = 3 + Math.floor(r() * 5);
    px(g, DIRT_D, x, y, w, 1);
    px(g, DIRT_D, x + 1, y + 1, w, 1);
  }
  for (let i = 0; i < 6; i++) { // pebbles with a shadow
    const x = 1 + Math.floor(r() * 28), y = 1 + Math.floor(r() * 28);
    px(g, DIRT_L, x, y, 2, 1);
    px(g, DIRT_S, x + 1, y + 1, 2, 1);
  }
  for (let i = 0; i < 2; i++) {
    const x = 2 + Math.floor(r() * 25), y = 2 + Math.floor(r() * 25);
    px(g, shade(DIRT_L, 0.82), x, y, 3, 2); px(g, shade(DIRT_L, 1.12), x, y, 2, 1); px(g, DIRT_S, x + 1, y + 2, 3, 1);
  }
}
function water(g: G, r: () => number, p: Pal) {
  const [WATER, WATER_D, WATER_L, SPARK] = p.liquid;
  px(g, WATER, 0, 0, TS, TS);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * 22), y = Math.floor(r() * 30), w = 6 + Math.floor(r() * 8);
    px(g, WATER_D, x, y, w, 2);
    px(g, WATER_D, x + 2, y + 2, w - 3, 1);
  }
  for (let i = 0; i < 5; i++) { // ripples
    const x = 1 + Math.floor(r() * 22), y = 2 + Math.floor(r() * 27), w = 3 + Math.floor(r() * 4);
    px(g, WATER_L, x, y, w, 1);
    px(g, WATER_L, x + w + 1, y + 1, 2, 1);
    if (r() < 0.3) px(g, SPARK, x + 1, y, 1, 1);
  }
}
function cobble(g: G, r: () => number, p: Pal) {
  const [mortar, tones] = p.cobble;
  px(g, mortar, 0, 0, TS, TS);
  for (let row = 0; row < 4; row++) {
    let x = row % 2 ? -4 : 0;
    while (x < TS) {
      const w = 6 + Math.floor(r() * 4), y = row * 8, c = tones[Math.floor(r() * tones.length)];
      px(g, c, x + 1, y + 1, w - 1, 6);
      px(g, c, x + 2, y, w - 3, 1);
      px(g, c, x + 2, y + 7, w - 3, 1);
      px(g, shade(c, 1.1), x + 2, y + 1, w - 4, 1); // top highlight
      px(g, shade(c, 0.86), x + 2, y + 6, w - 3, 1); // bottom shadow
      px(g, shade(c, 0.86), x + w - 1, y + 2, 1, 4);
      x += w;
    }
  }
}
function roof(g: G, r: () => number, kind: number) {
  const base = '#b4543c', dark = '#8c3a2b', light = '#cf7352', deep = '#6d2a20';
  px(g, base, 0, 0, TS, TS);
  for (let row = 0; row < 4; row++) {
    const y = row * 8, off = row % 2 ? 4 : 0;
    for (let c = -1; c < 5; c++) {
      const x = c * 8 + off, tone = r();
      if (tone < 0.25) px(g, light, x + 1, y, 6, 6);
      else if (tone > 0.8) px(g, dark, x + 1, y, 6, 6);
      px(g, light, x + 1, y, 6, 1);
      px(g, deep, x, y, 1, 7); // gap between shingles
      px(g, dark, x + 1, y + 6, 6, 1);
      px(g, deep, x + 1, y + 7, 6, 1); // scalloped lower lip
      px(g, deep, x, y + 6, 1, 2);
    }
  }
  if (kind === 1) { // ridge cap
    px(g, '#d98a62', 0, 0, TS, 4); px(g, '#f0aa7c', 0, 0, TS, 1); px(g, deep, 0, 4, TS, 1);
    for (let x = 6; x < TS; x += 8) px(g, dark, x, 0, 1, 4);
  } else if (kind === 2) { // eave
    px(g, dark, 0, TS - 5, TS, 2); px(g, deep, 0, TS - 3, TS, 3);
  }
}
/** kind: 0 plain, 1 window, 2 door. top: tile directly under the eave. */
function wall(g: G, r: () => number, kind: number, top: boolean) {
  const plaster = '#e8dec8', beam = '#6f4a2c', beamL = '#8d6238';
  px(g, plaster, 0, 0, TS, TS);
  for (let i = 0; i < 10; i++) px(g, r() < 0.5 ? '#dccfb4' : '#f1e9d6', Math.floor(r() * 30), Math.floor(r() * 30), 2 + Math.floor(r() * 3), 1);
  if (top) { // eave shadow + lintel beam
    px(g, 'rgba(60,40,30,0.38)', 0, 0, TS, 4);
    px(g, beam, 0, 4, TS, 3); px(g, beamL, 0, 4, TS, 1);
  } else { // stone foundation
    px(g, '#8f897c', 0, TS - 6, TS, 6);
    for (let x = 0; x < TS; x += 8) { px(g, '#aaa497', x + 1, TS - 5, 6, 3); px(g, '#c3beb1', x + 1, TS - 5, 5, 1); }
    px(g, '#6b665b', 0, TS - 1, TS, 1);
    px(g, beam, 0, 0, TS, 2);
  }
  if (kind === 1) {
    const y = top ? 11 : 6;
    px(g, beam, 8, y - 1, 16, 15);
    px(g, '#274a78', 10, y + 1, 12, 11);
    px(g, '#3f73ae', 10, y + 1, 12, 5);
    px(g, '#8cc0ea', 11, y + 2, 3, 2); px(g, '#8cc0ea', 17, y + 2, 2, 1);
    px(g, beamL, 15, y + 1, 2, 11); px(g, beamL, 10, y + 6, 12, 1);
    px(g, beamL, 7, y + 13, 18, 2); px(g, '#4e3320', 7, y + 15, 18, 1);
    px(g, '#3f8a44', 9, y + 12, 4, 2); px(g, '#e8694f', 10, y + 11, 1, 1); px(g, '#f4e27a', 20, y + 11, 1, 1); px(g, '#3f8a44', 19, y + 12, 4, 2);
  } else if (kind === 2) {
    px(g, beam, 7, 3, 18, 23);
    px(g, '#8a5a33', 9, 5, 14, 21);
    px(g, beam, 10, 3, 12, 1);
    px(g, '#a26c3e', 9, 5, 14, 1);
    for (let x = 12; x < 23; x += 4) px(g, '#6f4a2c', x, 6, 1, 20);
    px(g, '#4e3320', 9, 12, 14, 1); px(g, '#4e3320', 9, 20, 14, 1);
    px(g, '#e2c04a', 20, 16, 2, 2); px(g, '#8f6f1c', 20, 18, 2, 1);
    px(g, '#b6b0a2', 5, TS - 6, 22, 6); px(g, '#d2cdc0', 5, TS - 6, 22, 2); px(g, '#6b665b', 5, TS - 1, 22, 1);
  }
}
/** 46x52 tree; the trunk base sits at (23, 46). */
/** Bare, twisted tree (charred in the highlands, drowned in the moor). */
function deadTree(g: G, r: () => number, p: Pal) {
  const L = p.leaf, bark = L[1], lit = L[2], dark = L[0];
  px(g, dark, 20, 30, 7, 17); px(g, bark, 21, 30, 4, 17); px(g, lit, 22, 31, 1, 15);
  px(g, dark, 17, 46, 4, 1); px(g, dark, 26, 46, 4, 1);
  const limb = (x0: number, y0: number, dx: number, len: number, w: number) => {
    let x = x0, y = y0;
    for (let i = 0; i < len; i++) {
      px(g, dark, Math.round(x), Math.round(y), w + 1, 1); px(g, i % 3 ? bark : lit, Math.round(x), Math.round(y) - 1, w, 1);
      x += dx * (0.5 + r() * 0.6); y -= 0.75 + r() * 0.3;
      if (i === Math.floor(len * 0.55)) for (let k = 0; k < 5; k++) px(g, bark, Math.round(x - dx * k), Math.round(y - k * 0.8), 1, 1); // twig
    }
    return [Math.round(x), Math.round(y)];
  };
  const tips = [limb(22, 31, -1, 18, 2), limb(23, 30, 1, 20, 2), limb(22, 24, -0.3, 16, 1), limb(24, 26, 0.5, 12, 1)];
  for (const [x, y] of tips) if (r() < 0.75) { px(g, L[3], x, y - 1, 2, 2); px(g, L[4], x, y - 1, 1, 1); } // embers or last leaves
}
/** A cluster of crystals. */
function crystalTree(g: G, r: () => number, p: Pal) {
  const L = p.leaf;
  const shard = (cx: number, base: number, h: number, w: number) => {
    for (let y = 0; y < h; y++) {
      const t = y / h, half = Math.max(0, Math.round(w * (t < 0.25 ? t / 0.25 : 1)));
      const yy = base - h + y;
      px(g, L[0], cx - half - 1, yy, half * 2 + 3, 1);
      px(g, L[2], cx - half, yy, half * 2 + 1, 1);
      px(g, L[3], cx - half, yy, Math.max(1, half), 1);
      px(g, L[1], cx + Math.ceil(half / 2), yy, Math.max(1, Math.floor(half / 2) + 1), 1);
      if (y > 2 && y % 5 === 0) px(g, L[4], cx - half + 1, yy, 1, 2);
    }
    px(g, L[4], cx, base - h, 1, 2);
  };
  px(g, 'rgba(20,16,40,0.35)', 10, 44, 28, 3);
  shard(14, 46, 20 + Math.floor(r() * 5), 3); shard(32, 46, 17 + Math.floor(r() * 6), 3); shard(23, 47, 36 + Math.floor(r() * 6), 5); shard(19, 47, 12, 2); shard(28, 47, 14, 2);
}
/** A broken column. */
function pillar(g: G, r: () => number, p: Pal) {
  const L = p.leaf, top = 12 + Math.floor(r() * 8);
  px(g, L[0], 13, 42, 21, 6); px(g, L[2], 14, 42, 19, 4); px(g, L[3], 14, 42, 19, 1); px(g, L[1], 14, 46, 19, 1); // plinth
  for (let y = top; y < 42; y++) {
    px(g, L[0], 15, y, 17, 1); px(g, L[2], 16, y, 15, 1); px(g, L[3], 16, y, 4, 1); px(g, L[1], 27, y, 4, 1);
    for (const fx of [20, 23, 26]) px(g, L[1], fx, y, 1, 1); // fluting
  }
  for (let x = 15; x < 32; x++) { const h = Math.floor(r() * 4); px(g, L[0], x, top - h - 1, 1, 1); px(g, x < 20 ? L[4] : L[2], x, top - h, 1, h + 1); } // jagged break
  px(g, L[1], 16, 30, 15, 1); px(g, L[4], 16, 31, 15, 1);
  for (let i = 0; i < 3; i++) px(g, L[1], 12 + Math.floor(r() * 22), 47 + Math.floor(r() * 3), 3, 2); // rubble
  if (p.gt !== p.gd) for (let i = 0; i < 4; i++) px(g, p.gt, 16 + Math.floor(r() * 14), 34 + Math.floor(r() * 8), 2, 1); // moss or glow
}
/** A boulder or stalagmite. */
function boulder(g: G, r: () => number, p: Pal) {
  const L = p.leaf, lobes: [number, number, number][] = [[23, 36, 11], [15, 40, 7], [31, 40, 7], [22, 27, 7 + Math.floor(r() * 3)]];
  px(g, 'rgba(20,16,30,0.3)', 8, 45, 30, 3);
  for (const [x, y, rad] of lobes) disc(g, L[0], x, y + 1, rad + 1);
  for (const [x, y, rad] of lobes) disc(g, L[1], x, y, rad);
  for (const [x, y, rad] of lobes) disc(g, L[2], x - 1, y - 2, Math.max(1, rad - 3));
  for (const [x, y, rad] of lobes) disc(g, L[3] === '#c9622a' ? L[2] : L[3], x - 3, y - 4, Math.max(1, rad - 6));
  for (let i = 0; i < 4; i++) { const x = 12 + Math.floor(r() * 20), y = 30 + Math.floor(r() * 12); px(g, L[0], x, y, 3, 1); px(g, L[0], x + 2, y + 1, 2, 1); } // cracks
  if (L[4] === '#ffb44a') for (let i = 0; i < 3; i++) px(g, L[4], 14 + Math.floor(r() * 18), 34 + Math.floor(r() * 9), 2, 1); // lava seams
}
function tree(g: G, r: () => number, p: Pal, kind: TreeKind) {
  if (kind === 'dead') return deadTree(g, r, p);
  if (kind === 'crystal') return crystalTree(g, r, p);
  if (kind === 'pillar') return pillar(g, r, p);
  if (kind === 'rock') return boulder(g, r, p);
  const L = p.leaf, pine = kind === 'pine';
  // trunk
  px(g, '#4a3120', 20, 36, 7, 11); px(g, '#6e4a2c', 21, 36, 4, 11); px(g, '#8a6238', 22, 37, 1, 9);
  px(g, '#4a3120', 18, 46, 3, 1); px(g, '#4a3120', 26, 46, 3, 1);
  if (pine) {
    for (let tier = 0; tier < 4; tier++) {
      const top = 2 + tier * 9, half = 7 + tier * 3;
      for (let y = 0; y < 13; y++) {
        const w = Math.round((half * (y + 1)) / 13);
        px(g, L[0], 23 - w - 1, top + y, w * 2 + 3, 1);
        px(g, L[2], 23 - w, top + y, w * 2 + 1, 1);
        px(g, L[1], 23 + Math.round(w * 0.2), top + y, w - Math.round(w * 0.2) + 1, 1);
        if (y > 2 && y < 11) px(g, L[3], 23 - w + 1, top + y, Math.max(1, Math.round(w * 0.5)), 1);
      }
      px(g, L[0], 23 - half - 1, top + 13, half * 2 + 3, 1);
      for (let i = 0; i < 4; i++) px(g, L[4], 23 - half + 3 + Math.floor(r() * half), top + 5 + Math.floor(r() * 6), 1, 1);
    }
    return;
  }
  const lobes: [number, number, number][] = [[23, 26, 13], [13, 23, 10], [33, 23, 10], [19, 14, 10], [28, 15, 10], [23, 9, 7]];
  for (const [x, y, rad] of lobes) disc(g, L[0], x, y + 1, rad + 1); // outline
  for (const [x, y, rad] of lobes) disc(g, L[1], x, y, rad);
  for (const [x, y, rad] of lobes) disc(g, L[2], x - 1, y - 2, rad - 2);
  for (const [x, y, rad] of lobes) disc(g, L[3], x - 3, y - 4, Math.max(2, rad - 6));
  for (let i = 0; i < 26; i++) { // leaf clusters: highlights up-left, shadows down-right
    const [x, y, rad] = lobes[Math.floor(r() * lobes.length)];
    const a = r() * 6.28, d = r() * (rad - 3), lx = Math.round(x + Math.cos(a) * d), ly = Math.round(y + Math.sin(a) * d);
    const lit = Math.cos(a) + Math.sin(a) < 0.2;
    px(g, lit ? L[4] : L[0], lx, ly, 2, 1);
    px(g, lit ? L[3] : L[1], lx + 1, ly + 1, 2, 1);
  }
}

function build(theme: string): Tex {
  const p = PALS[theme], t: Tex = {};
  const make = (name: string, n: number, w: number, h: number, fn: (g: G, r: () => number, v: number) => void) => {
    t[name] = Array.from({ length: n }, (_, v) => {
      const c = mk(w, h);
      fn(c.getContext('2d')!, rng(hash(v, name.length * 31 + name.charCodeAt(0), theme.length)), v);
      return c;
    });
  };
  make('grass', 4, TS, TS, (g, r) => grass(g, r, p));
  make('flower', 4, TS, TS, (g, r) => { grass(g, r, p); flowers(g, r, p); });
  make('dirt', 4, TS, TS, (g, r) => dirt(g, r, p));
  make('water', 4, TS, TS, (g, r) => water(g, r, p));
  make('cobble', 4, TS, TS, (g, r) => cobble(g, r, p));
  make('roof', 3, TS, TS, roof);
  make('wallTop', 3, TS, TS, (g, r, v) => wall(g, r, v, true));
  make('wallBase', 3, TS, TS, (g, r, v) => wall(g, r, v, false));
  make('tree', 6, 46, 52, (g, r, v) => tree(g, r, p, p.trees[v % p.trees.length]));
  // Dungeon rock: a dark top seen from above, and a lit face where the rock meets open floor below it.
  make('rock', 4, TS, TS, (g, r) => {
    const [top, , mortar] = p.rock;
    px(g, top, 0, 0, TS, TS);
    for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 26), y = Math.floor(r() * 28); px(g, mortar, x, y, 4 + Math.floor(r() * 4), 1); px(g, shade(top, 1.25), x + 1, y + 1, 3, 1); }
  });
  make('rockFace', 4, TS, TS, (g, r) => {
    const [top, face, mortar] = p.rock;
    px(g, top, 0, 0, TS, 8); px(g, shade(top, 1.3), 0, 7, TS, 1);
    px(g, mortar, 0, 8, TS, 24);
    for (let row = 0; row < 3; row++) {
      let x = row % 2 ? -5 : 0;
      while (x < TS) {
        const w = 9 + Math.floor(r() * 5), y = 8 + row * 8, c = shade(face, 0.9 + r() * 0.25);
        px(g, c, x + 1, y + 1, w - 1, 6); px(g, shade(face, 1.3), x + 1, y + 1, w - 1, 1); px(g, shade(face, 0.7), x + 1, y + 6, w - 1, 1);
        x += w;
      }
    }
    px(g, 'rgba(0,0,0,0.35)', 0, 29, TS, 3);
  });
  // Dungeon entrance: a stone arch around a dark stair, with a rune glow.
  make('gate', 1, TS, TS, (g, r) => {
    cobble(g, r, p);
    px(g, '#3a3642', 3, 2, 26, 28); px(g, '#5f5a6c', 4, 3, 24, 26); px(g, '#7d788c', 4, 3, 24, 2); px(g, '#7d788c', 4, 3, 2, 26);
    px(g, '#0e0c16', 8, 8, 16, 21); px(g, '#0e0c16', 10, 6, 12, 2);
    for (let i = 0; i < 4; i++) px(g, shade('#3a3360', 1 + i * 0.25), 9, 25 - i * 4, 14, 2); // steps going down
    for (const [x, y] of [[5, 6], [26, 6], [5, 16], [26, 16], [15, 4]]) { px(g, '#b9a2ff', x, y, 2, 2); px(g, '#ffffff', x, y, 1, 1); }
  });
  make('portal', 1, TS, TS, (g, r) => {
    dirt(g, r, p);
    disc(g, '#6d6a78', 16, 16, 13); disc(g, '#8e8b99', 16, 15, 12); disc(g, '#55525f', 16, 16, 10);
    disc(g, '#2a1d55', 16, 16, 9); disc(g, '#3d2c7a', 15, 15, 6);
    for (let i = 0; i < 8; i++) px(g, '#b9a2ff', Math.round(16 + Math.cos(i * 0.785) * 11), Math.round(16 + Math.sin(i * 0.785) * 11), 2, 2);
  });
  return t;
}

const grassy = (t: T) => t === T.Grass || t === T.Flower || t === T.Tree;
const GROUND: Partial<Record<T, string>> = { [T.Grass]: 'grass', [T.Tree]: 'grass', [T.Flower]: 'flower', [T.Path]: 'dirt', [T.Water]: 'water', [T.Plaza]: 'cobble', [T.Portal]: 'portal', [T.Gate]: 'gate', [T.Rock]: 'rock' };

/** Organic borders: grass creeps over paths and plazas, water gets a bank and foam line. */
function edges(g: G, map: ZoneMap, wx: number, wy: number, ox: number, oy: number, t: T, p: Pal) {
  const isWater = t === T.Water;
  const open = (dx: number, dy: number) => {
    const n = tileAt(map, wx + dx, wy + dy);
    return isWater ? n !== T.Water : grassy(n);
  };
  const N = open(0, -1), S = open(0, 1), W = open(-1, 0), E = open(1, 0);
  const put = (x: number, y: number, depth: number) => {
    // depth 0 = touching the neighbour tile
    let c: string;
    if (isWater) c = depth < 2 ? p.g : depth < 4 ? p.bank : p.foam;
    else c = depth === 0 ? p.g : (hash(wx * 32 + x, wy * 32 + y, 9) & 3) ? p.g : p.gd;
    px(g, c, ox + x, oy + y);
  };
  const reach = (i: number, side: number) => (isWater ? 5 : 1 + (hash(wx * 32 + (i >> 1), wy, side) % 3)) + (isWater ? hash(wx * 32 + (i >> 2), wy, side + 20) % 2 : 0);
  for (let i = 0; i < TS; i++) {
    if (N) for (let d = 0, n = reach(i, 1); d < n; d++) put(i, d, d);
    if (S) for (let d = 0, n = reach(i, 2); d < n; d++) put(i, TS - 1 - d, d);
    if (W) for (let d = 0, n = reach(i + wy * 7, 3); d < n; d++) put(d, i, d);
    if (E) for (let d = 0, n = reach(i + wy * 7, 4); d < n; d++) put(TS - 1 - d, i, d);
  }
  const R = isWater ? 10 : 8;
  const corner = (cx: number, cy: number, sx: number, sy: number, rad: number) => {
    // fill everything outside a quarter circle centred `rad` px in from the corner
    for (let y = 0; y < rad; y++)
      for (let x = 0; x < rad; x++) {
        const d = Math.hypot(rad - x - 0.5, rad - y - 0.5) - rad;
        if (d > (isWater ? -5 : 0)) put(cx + sx * x, cy + sy * y, d > 0 ? 0 : isWater ? Math.min(5, Math.round(-d)) : 1);
      }
  };
  if (N && W) corner(0, 0, 1, 1, R);
  if (N && E) corner(TS - 1, 0, -1, 1, R);
  if (S && W) corner(0, TS - 1, 1, -1, R);
  if (S && E) corner(TS - 1, TS - 1, -1, -1, R);
  // inner corners: only the diagonal neighbour differs
  const inner = (dx: number, dy: number, a: boolean, b: boolean) => {
    if (a || b || !open(dx, dy)) return;
    const n = isWater ? 6 : 3;
    for (let y = 0; y < n; y++) for (let x = 0; x < n - y; x++) put(dx < 0 ? x : TS - 1 - x, dy < 0 ? y : TS - 1 - y, isWater ? Math.min(5, x + y) : 0);
  };
  inner(-1, -1, N, W); inner(1, -1, N, E); inner(-1, 1, S, W); inner(1, 1, S, E);
}

function building(g: G, tex: Tex, map: ZoneMap, wx: number, wy: number, ox: number, oy: number, t: T) {
  const at = (dx: number, dy: number) => tileAt(map, wx + dx, wy + dy);
  if (t === T.Roof) {
    const kind = at(0, -1) !== T.Roof ? 1 : at(0, 1) !== T.Roof ? 2 : 0;
    g.drawImage(tex.roof[kind], ox, oy);
    if (at(-1, 0) !== T.Roof) { px(g, '#6d2a20', ox, oy, 2, TS); px(g, '#d98a62', ox + 2, oy, 1, TS); }
    if (at(1, 0) !== T.Roof) { px(g, '#6d2a20', ox + TS - 2, oy, 2, TS); }
    return;
  }
  let l = wx, r = wx;
  while (tileAt(map, l - 1, wy) === T.Wall) l--;
  while (tileAt(map, r + 1, wy) === T.Wall) r++;
  const top = at(0, -1) !== T.Wall;
  const mid = (l + r) >> 1;
  const kind = !top && wx === mid ? 2 : top && wx !== l && wx !== r && (wx - l) % 2 === 1 ? 1 : !top && wx !== mid && (wx - l) % 3 === 1 && wx !== r ? 1 : 0;
  g.drawImage((top ? tex.wallTop : tex.wallBase)[kind], ox, oy);
  if (wx === l) { px(g, '#6f4a2c', ox, oy, 3, TS); px(g, '#8d6238', ox, oy, 1, TS); }
  if (wx === r) { px(g, '#6f4a2c', ox + TS - 3, oy, 3, TS); px(g, '#4e3320', ox + TS - 1, oy, 1, TS); }
}

/** Minimap colour per tile type for a theme (index = tile id). */
export function miniColors(theme: string): string[] {
  const p = PALS[theme];
  return [p.g, p.dirt[0], p.liquid[0], p.leaf[1], '#e2d6bd', '#a84a36', '#a070ff', p.gl, p.cobble[1][0], p.rock[0], '#d0b8ff'];
}

export interface Chunk {
  ground: HTMLCanvasElement;
  /** Tree canopies drawn after characters so players walk behind them. Null when the chunk has none. */
  over: HTMLCanvasElement | null;
}

export function buildChunk(map: ZoneMap, cx: number, cy: number): Chunk {
  const theme = map.def.theme;
  let tex = texCache.get(theme);
  if (!tex) texCache.set(theme, (tex = build(theme)));
  const p = PALS[theme];
  const ground = mk(CHUNK_PX, CHUNK_PX), g = ground.getContext('2d')!;
  let over: HTMLCanvasElement | null = null, og: G | null = null;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  for (let ty = 0; ty < CHUNK; ty++)
    for (let tx = 0; tx < CHUNK; tx++) {
      const wx = x0 + tx, wy = y0 + ty, t = tileAt(map, wx, wy), ox = tx * TS, oy = ty * TS;
      if (t === T.Roof || t === T.Wall) building(g, tex, map, wx, wy, ox, oy, t);
      else {
        const name = t === T.Rock && tileAt(map, wx, wy + 1) !== T.Rock && wy + 1 < map.h ? 'rockFace' : GROUND[t]!;
        g.drawImage(tex[name][hash(wx, wy) % tex[name].length], ox, oy);
        if (t === T.Path || t === T.Plaza || t === T.Water || t === T.Portal) edges(g, map, wx, wy, ox, oy, t, p);
      }
      // soft contact shadow under buildings and trees falling onto open ground
      if (t !== T.Roof && t !== T.Wall && tileAt(map, wx, wy - 1) === T.Wall) px(g, 'rgba(30,25,40,0.22)', ox, oy, TS, 5);
    }
  // Trees: one extra tile on every side so sprites overlapping from neighbours are included.
  for (let ty = -1; ty <= CHUNK + 1; ty++)
    for (let tx = -1; tx <= CHUNK; tx++) {
      const wx = x0 + tx, wy = y0 + ty;
      if (wx < 0 || wy < 0 || wx >= map.w || wy >= map.h || map.tiles[wx + wy * map.w] !== T.Tree) continue;
      const h = hash(wx, wy, 5), spr = tex.tree[h % tex.tree.length];
      const jx = (h >> 4) % 5 - 2, top = ty * TS;
      const dx = tx * TS - 7 + jx, dy = top - 18;
      // ground layer: shadow + the part of the sprite inside its own tile
      g.fillStyle = 'rgba(20,40,30,0.28)';
      for (let i = 0; i < 5; i++) g.fillRect(dx + 8 + Math.abs(i - 2) * 3, top + 24 + i, 30 - Math.abs(i - 2) * 6, 1);
      g.drawImage(spr, 0, 18, 46, 34, dx, top, 46, 34);
      // overlay layer: everything above the tile's top edge
      if (!over) {
        over = mk(CHUNK_PX, CHUNK_PX);
        og = over.getContext('2d')!;
      }
      og!.drawImage(spr, 0, 0, 46, 18, dx, dy, 46, 18);
    }
  return { ground, over };
}
