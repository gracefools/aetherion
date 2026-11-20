// Scenery sprites for the capital: the statue of peace, the fountain's spout, towers, market stalls,
// racks and tables, the rift and its campfire, banners, lamps. Each is drawn here pixel by pixel in
// the palette and with the outline of the rest of the art, anchored at the bottom centre. Animated
// ones lay their frames side by side.
import { mk } from './art';
import { disc, outlined, p1 } from './chars';

type G = CanvasRenderingContext2D;
export interface DecorSprite { img: HTMLCanvasElement; w: number; h: number; frames: number; /** Milliseconds a frame. */ ms: number; /** Casts a light at night: colour and height. */ light?: [number, number] }
interface Def { w: number; h: number; frames?: number; ms?: number; light?: [number, number]; draw: (g: G, f: number) => void }

const STONE = ['#6a5f56', '#978c7c', '#b9ae98', '#d6ccb6', '#f1ead8'], WOOD = ['#3e2a18', '#5a3c1e', '#7a5430', '#9a6e42', '#b98a58'], GOLD = ['#7a5f24', '#c9a24a', '#ffe08a'];
/** A stone block with a lit top-left and a shaded right. */
function block(g: G, x: number, y: number, w: number, h: number, pal = STONE) {
  p1(g, pal[1], x, y, w, h); p1(g, pal[3], x, y, w, 1); p1(g, pal[2], x, y + 1, 1, h - 1); p1(g, pal[0], x + w - 1, y + 1, 1, h - 1); p1(g, pal[0], x, y + h - 1, w, 1);
}
function plank(g: G, x: number, y: number, w: number, h: number) {
  p1(g, WOOD[2], x, y, w, h); p1(g, WOOD[3], x, y, w, 1); p1(g, WOOD[0], x, y + h - 1, w, 1);
  for (let k = x + 3; k < x + w; k += 5) p1(g, WOOD[1], k, y + 1, 1, h - 2);
}
/** A pennant on a pole, waving by frame. */
function flag(g: G, x: number, y: number, col: string, dark: string, f = 0) {
  p1(g, WOOD[1], x, y, 1, 14);
  for (let i = 0; i < 8; i++) { const dy = Math.round(Math.sin((i + f * 2) / 2) * 1); p1(g, i < 6 ? col : dark, x + 1 + i, y + 1 + dy, 1, 5 - Math.floor(i / 3)); }
}
const awning = (g: G, x: number, y: number, w: number, a: string, b: string) => {
  for (let i = 0; i < w; i++) { const c = Math.floor(i / 4) % 2 ? a : b; p1(g, c, x + i, y, 1, 7); p1(g, 'rgba(0,0,0,0.25)', x + i, y + 6, 1, 1); }
  for (let i = 0; i < w; i += 4) p1(g, Math.floor(i / 4) % 2 ? a : b, x + i, y + 7, 4, 2);
  p1(g, 'rgba(255,255,255,0.3)', x, y, w, 1);
};

const DEFS: Record<string, Def> = {
  // The statue of peace: a robed figure holding up a star, a dove at her shoulder, on a carved plinth.
  statue: { w: 48, h: 104, draw: (g) => {
    block(g, 8, 84, 32, 16); block(g, 5, 96, 38, 6); block(g, 11, 78, 26, 7);
    p1(g, GOLD[1], 14, 88, 20, 6); p1(g, GOLD[2], 15, 89, 18, 1); p1(g, GOLD[0], 15, 93, 18, 1);
    for (const x of [17, 21, 25, 29]) p1(g, GOLD[0], x, 90, 2, 2); // an inscription
    // robe
    for (let y = 40; y < 78; y++) { const half = 5 + Math.floor((y - 40) / 5); p1(g, STONE[2], 24 - half, y, half * 2, 1); p1(g, STONE[3], 24 - half, y, 2, 1); p1(g, STONE[1], 24 + half - 3, y, 3, 1); }
    for (const x of [20, 24, 28]) for (let y = 50; y < 77; y += 1) p1(g, STONE[1], x + Math.round(Math.sin(y / 6 + x) * 1), y, 1, 1); // folds
    // shoulders, head, hair
    p1(g, STONE[2], 17, 34, 14, 8); p1(g, STONE[3], 17, 34, 14, 1); disc(g, STONE[3], 24, 28, 5); disc(g, STONE[4], 23, 27, 3);
    p1(g, STONE[1], 19, 24, 10, 3); p1(g, STONE[1], 19, 26, 2, 8); p1(g, STONE[1], 27, 26, 2, 8);
    // the raised arm and the star
    p1(g, STONE[2], 29, 22, 4, 14); p1(g, STONE[3], 29, 22, 1, 14); p1(g, STONE[2], 30, 14, 3, 9);
    disc(g, 'rgba(255,236,160,0.35)', 31, 9, 8); disc(g, GOLD[1], 31, 9, 3); disc(g, GOLD[2], 31, 9, 2);
    p1(g, GOLD[2], 31, 2, 1, 15); p1(g, GOLD[2], 24, 9, 15, 1); p1(g, '#fff', 31, 8, 1, 3); p1(g, '#fff', 30, 9, 3, 1);
    // the other hand, open, and the dove
    p1(g, STONE[2], 13, 38, 5, 3); p1(g, STONE[2], 11, 40, 4, 8); p1(g, STONE[3], 11, 40, 1, 8);
    disc(g, '#f4f6ff', 11, 36, 2); p1(g, '#f4f6ff', 8, 35, 3, 2); p1(g, '#dfe3f0', 12, 34, 4, 1); p1(g, '#e8a04a', 7, 36, 1, 1);
  } },
  // The fountain's column: two bowls, water falling from the upper into the lower and into the basin.
  fountain: { w: 40, h: 64, frames: 3, ms: 160, draw: (g, f) => {
    block(g, 14, 50, 12, 10); block(g, 16, 30, 8, 22); block(g, 6, 44, 28, 5); block(g, 10, 26, 20, 4); block(g, 18, 12, 4, 15);
    disc(g, GOLD[1], 20, 10, 3); disc(g, GOLD[2], 19, 9, 1);
    p1(g, '#6cc4f0', 7, 43, 26, 2); p1(g, '#c8f0ff', 9, 43, 8, 1); p1(g, '#6cc4f0', 11, 25, 18, 2); p1(g, '#c8f0ff', 12, 25, 6, 1);
    const fall = (x: number, y0: number, y1: number, k: number) => { for (let y = y0; y < y1; y++) p1(g, (y + f + k) % 3 === 0 ? '#eaffff' : '#8ad4f8', x, y, 1, 1); };
    for (const [x, k] of [[10, 0], [29, 1], [15, 2], [24, 0]] as const) fall(x, 28, 43, k);
    for (const [x, k] of [[6, 1], [33, 2], [12, 0], [27, 1], [20, 2]] as const) fall(x, 47, 62, k);
    for (const [x, k] of [[19, 0], [21, 1]] as const) fall(x, 4 - 0, 12, k);
    p1(g, '#eaffff', 18 + f, 3, 1, 1); p1(g, '#eaffff', 22 - f, 5, 1, 1);
  } },
  // A gate or corner tower: round stone, a crenellated top, a pennant.
  tower: { w: 44, h: 100, frames: 2, ms: 420, draw: (g, f) => {
    for (let y = 30; y < 96; y++) { p1(g, STONE[1], 9, y, 26, 1); p1(g, STONE[2], 9, y, 5, 1); p1(g, STONE[3], 10, y, 1, 1); p1(g, STONE[0], 31, y, 4, 1); }
    for (let y = 36; y < 94; y += 8) for (let x = 11 + ((y / 8) % 2) * 5; x < 32; x += 10) p1(g, STONE[0], x, y, 6, 1); // courses
    block(g, 6, 22, 32, 9); for (const x of [6, 14, 22, 30]) block(g, x, 14, 7, 9);
    p1(g, '#1c1a2a', 20, 46, 4, 9); p1(g, STONE[0], 19, 45, 6, 1); p1(g, '#ffd98a', 21, 49, 2, 4); // a lit arrow slit
    block(g, 7, 94, 30, 5);
    flag(g, 21, 0, '#c0392b', '#7d2018', f);
  } },
  stall_red: { w: 64, h: 60, draw: (g) => stall(g, '#c0392b', '#f4ead0', ['#e2523f', '#ffd24a', '#5fd35a', '#e2523f', '#ff8a3a']) },
  stall_blue: { w: 64, h: 60, draw: (g) => stall(g, '#2f6aa8', '#f4ead0', ['#a070ff', '#7fe8ff', '#ffd24a', '#c8d0da', '#a070ff']) },
  crate: { w: 24, h: 26, draw: (g) => { plank(g, 3, 8, 18, 15); p1(g, WOOD[0], 3, 8, 18, 1); p1(g, WOOD[4], 4, 9, 16, 1); for (const x of [3, 19]) p1(g, WOOD[1], x, 8, 2, 15); p1(g, WOOD[1], 5, 14, 14, 2); p1(g, '#c8d0da', 6, 11, 2, 2); } },
  barrel: { w: 22, h: 30, draw: (g) => {
    for (let y = 6; y < 27; y++) { const half = 7 + (y > 9 && y < 23 ? 1 : 0); p1(g, WOOD[2], 11 - half, y, half * 2, 1); p1(g, WOOD[3], 11 - half, y, 3, 1); p1(g, WOOD[1], 11 + half - 3, y, 3, 1); }
    for (const y of [9, 22]) { p1(g, '#6c7084', 3, y, 16, 2); p1(g, '#b4b9cc', 4, y, 4, 1); }
    p1(g, WOOD[0], 4, 5, 14, 2); p1(g, WOOD[4], 5, 5, 8, 1);
  } },
  // Swords and an axe on a rack.
  weapon_rack: { w: 44, h: 44, draw: (g) => {
    plank(g, 4, 14, 36, 3); plank(g, 4, 30, 36, 3); for (const x of [5, 37]) { p1(g, WOOD[1], x, 10, 3, 30); p1(g, WOOD[3], x, 10, 1, 30); }
    for (const [x, c] of [[11, '#dfe3f0'], [18, '#b4b9cc'], [25, '#dfe3f0']] as const) { p1(g, c, x, 6, 2, 24); p1(g, '#fff', x, 6, 1, 10); p1(g, GOLD[1], x - 2, 29, 6, 2); p1(g, WOOD[1], x, 31, 2, 6); p1(g, GOLD[2], x, 37, 2, 2); }
    p1(g, WOOD[2], 32, 6, 2, 32); p1(g, '#b4b9cc', 29, 6, 8, 7); p1(g, '#dfe3f0', 29, 6, 8, 2); p1(g, '#6c7084', 34, 8, 3, 5);
  } },
  // A breastplate and helm on a stand.
  armor_stand: { w: 26, h: 46, draw: (g) => {
    p1(g, WOOD[1], 12, 14, 2, 28); p1(g, WOOD[2], 6, 40, 14, 3); p1(g, WOOD[3], 6, 40, 14, 1);
    p1(g, '#8e93a8', 6, 16, 14, 14); p1(g, '#dfe3f0', 7, 17, 4, 11); p1(g, '#4a4c5c', 16, 17, 3, 12); p1(g, GOLD[1], 6, 22, 14, 1); p1(g, GOLD[1], 12, 16, 2, 14);
    p1(g, '#8e93a8', 3, 16, 4, 6); p1(g, '#8e93a8', 19, 16, 4, 6);
    disc(g, '#8e93a8', 13, 9, 5); disc(g, '#dfe3f0', 11, 7, 2); p1(g, '#1c1a2a', 10, 10, 7, 2); p1(g, '#c0392b', 12, 1, 2, 5);
  } },
  // A table of potions: red, blue and green bottles, a mortar.
  potion_table: { w: 44, h: 36, draw: (g) => {
    plank(g, 3, 16, 38, 4); for (const x of [5, 36]) { p1(g, WOOD[1], x, 20, 3, 13); p1(g, WOOD[3], x, 20, 1, 13); } p1(g, '#f4ead0', 8, 15, 14, 1);
    for (const [x, c, l] of [[8, '#e2523f', '#ff9a8a'], [14, '#4a8ae0', '#9ac8ff'], [20, '#5fd35a', '#b4f0a8'], [27, '#a070ff', '#d0b8ff']] as const) {
      p1(g, c, x, 9, 5, 7); p1(g, l, x, 9, 2, 5); p1(g, '#dfe3f0', x + 1, 5, 3, 4); p1(g, WOOD[2], x + 1, 4, 3, 1);
    }
    p1(g, STONE[2], 33, 11, 6, 5); p1(g, STONE[4], 33, 11, 6, 1); p1(g, WOOD[3], 37, 6, 1, 6);
  } },
  sword_ground: { w: 18, h: 34, draw: (g) => {
    p1(g, '#b4b9cc', 8, 10, 2, 20); p1(g, '#fff', 8, 10, 1, 14); p1(g, '#6c7084', 9, 22, 1, 8); p1(g, GOLD[1], 4, 8, 10, 2); p1(g, GOLD[2], 4, 8, 10, 1);
    p1(g, WOOD[1], 8, 2, 2, 6); disc(g, GOLD[1], 9, 1, 1); p1(g, '#5a4a3a', 5, 30, 8, 2); p1(g, '#7a6a52', 6, 29, 5, 1);
  } },
  shield_ground: { w: 24, h: 30, draw: (g) => {
    for (let y = 4; y < 26; y++) { const half = y < 16 ? 9 : Math.max(1, 9 - Math.floor((y - 16) * 0.9)); p1(g, '#8a2a22', 12 - half, y, half * 2, 1); p1(g, '#c0392b', 12 - half + 1, y, Math.max(0, half - 1), 1); }
    p1(g, GOLD[1], 11, 5, 2, 20); p1(g, GOLD[1], 4, 12, 16, 2); disc(g, GOLD[2], 12, 13, 2); p1(g, '#5a4a3a', 6, 26, 12, 2);
  } },
  // A straw training dummy on a post.
  dummy: { w: 28, h: 46, draw: (g) => {
    p1(g, WOOD[1], 13, 18, 3, 26); p1(g, WOOD[2], 7, 42, 14, 3); p1(g, WOOD[2], 3, 18, 22, 3); p1(g, WOOD[4], 3, 18, 22, 1);
    for (let y = 14; y < 34; y++) { p1(g, '#c9a24a', 8, y, 12, 1); p1(g, '#e8cc7a', 8, y, 3, 1); p1(g, '#8f6f1c', 17, y, 3, 1); }
    for (const y of [19, 26]) p1(g, WOOD[1], 8, y, 12, 1);
    disc(g, '#c9a24a', 14, 8, 6); disc(g, '#e8cc7a', 12, 6, 2); p1(g, '#3e2a18', 11, 8, 2, 1); p1(g, '#3e2a18', 16, 8, 2, 1); p1(g, '#c0392b', 12, 22, 4, 4); p1(g, '#fff', 13, 23, 2, 2);
  } },
  // The rift: a tall dark tear in the air, violet at its edges, sparks drifting out of it.
  rift: { w: 60, h: 84, frames: 4, ms: 150, light: [0xa070ff, 30], draw: (g, f) => {
    disc(g, 'rgba(60,20,110,0.28)', 30, 44, 26);
    for (let y = 8; y < 78; y++) {
      const t = (y - 8) / 70, half = Math.round(Math.sin(t * Math.PI) * 13 + Math.sin(y / 5 + f * 1.4) * 2), x0 = 30 - half + Math.round(Math.sin(y / 9 + f) * 2);
      if (half < 1) continue;
      p1(g, '#a070ff', x0 - 1, y, half * 2 + 2, 1); p1(g, '#d8c0ff', x0 - 1, y, 1, 1); p1(g, '#5a2aa8', x0 + half * 2, y, 1, 1);
      p1(g, '#0a0614', x0, y, half * 2, 1); if ((y + f * 3) % 11 === 0) p1(g, '#3a1a6a', x0 + 2, y, Math.max(1, half - 2), 1);
    }
    for (let k = 0; k < 9; k++) { const a = k * 2.4 + f * 0.9, r = 16 + ((k * 7 + f * 3) % 12); p1(g, k % 3 ? '#d8c0ff' : '#ffffff', Math.round(30 + Math.cos(a) * r), Math.round(42 + Math.sin(a) * r * 1.4), 1, 1); }
    block(g, 8, 76, 10, 6); block(g, 42, 76, 10, 6); p1(g, '#a070ff', 11, 78, 4, 1); p1(g, '#a070ff', 45, 78, 4, 1); // rune-cut anchor stones
  } },
  campfire: { w: 32, h: 38, frames: 4, ms: 120, light: [0xffa040, 14], draw: (g, f) => {
    for (const [x, y] of [[6, 30], [10, 33], [17, 34], [23, 31], [25, 27], [5, 26]]) disc(g, STONE[1 + ((x + y) % 2)], x, y, 3);
    p1(g, WOOD[1], 8, 28, 16, 3); p1(g, WOOD[3], 8, 28, 16, 1); p1(g, WOOD[0], 12, 25, 3, 7); p1(g, WOOD[2], 18, 26, 3, 6);
    const tip = [0, -2, 1, -1][f], lean = [0, 1, 0, -1][f];
    for (let y = 0; y < 18; y++) { const half = Math.round((1 - y / 18) * 7); p1(g, '#e2523f', 16 - half + (y > 10 ? lean : 0), 27 - y + (y > 14 ? tip : 0), half * 2, 1); }
    for (let y = 0; y < 13; y++) { const half = Math.round((1 - y / 13) * 5); p1(g, '#ff9a3a', 16 - half + (y > 8 ? lean : 0), 27 - y, half * 2, 1); }
    for (let y = 0; y < 8; y++) { const half = Math.round((1 - y / 8) * 3); p1(g, '#ffe08a', 16 - half, 27 - y, half * 2, 1); }
    p1(g, '#ffd24a', 10 + f * 3, 6 + (f % 2) * 3, 1, 1); p1(g, '#ff9a3a', 22 - f * 2, 3 + f, 1, 1);
  } },
  war_banner: { w: 26, h: 64, frames: 2, ms: 480, draw: (g, f) => {
    p1(g, WOOD[1], 12, 4, 2, 58); p1(g, WOOD[3], 12, 4, 1, 58); p1(g, GOLD[1], 6, 6, 14, 2); disc(g, GOLD[2], 13, 3, 2); p1(g, STONE[1], 8, 60, 10, 3);
    for (let y = 8; y < 40; y++) { const sway = y > 20 ? Math.round(Math.sin(y / 5 + f * 1.6)) : 0, cut = y > 34 ? Math.abs(13 - 0) - (40 - y) : 0; void cut; p1(g, '#8a1a14', 7 + sway, y, 12, 1); p1(g, '#c0392b', 8 + sway, y, 4, 1); p1(g, GOLD[1], 7 + sway, y, 1, 1); p1(g, GOLD[1], 18 + sway, y, 1, 1); }
    p1(g, GOLD[2], 12, 17, 2, 10); p1(g, GOLD[2], 9, 21, 8, 2); p1(g, '#8a1a14', 12, 38, 2, 3);
  } },
  rune_stone: { w: 26, h: 40, frames: 2, ms: 600, light: [0x7fe8ff, 12], draw: (g, f) => {
    for (let y = 6; y < 36; y++) { const half = y < 12 ? 4 + (y - 6) : 9 - (y > 30 ? 1 : 0); p1(g, STONE[1], 13 - half, y, half * 2, 1); p1(g, STONE[3], 13 - half, y, 2, 1); p1(g, STONE[0], 13 + half - 2, y, 2, 1); }
    const c = f ? '#c8f8ff' : '#7fe8ff'; p1(g, c, 12, 12, 2, 16); p1(g, c, 9, 16, 8, 2); p1(g, c, 10, 24, 6, 2); p1(g, '#fff', 12, 16, 2, 2); block(g, 4, 34, 18, 4);
  } },
  bookstand: { w: 26, h: 36, draw: (g) => {
    p1(g, WOOD[1], 12, 14, 3, 18); p1(g, WOOD[2], 6, 30, 15, 3); p1(g, WOOD[3], 6, 30, 15, 1); plank(g, 4, 11, 19, 3);
    p1(g, '#f4ead0', 5, 5, 8, 7); p1(g, '#f4ead0', 14, 5, 8, 7); p1(g, '#8a2a22', 4, 4, 19, 1); p1(g, '#8a2a22', 13, 4, 1, 9);
    for (const y of [7, 9]) { p1(g, '#8a7a5a', 6, y, 6, 1); p1(g, '#8a7a5a', 15, y, 6, 1); }
  } },
  // The waygate: a tall rune pillar ringed with light.
  waygate: { w: 36, h: 66, frames: 2, ms: 520, light: [0xb9a2ff, 20], draw: (g, f) => {
    block(g, 6, 56, 24, 7, ['#3a3654', '#5f5a7c', '#7d7896', '#a6a2c4', '#d8d4f0']);
    for (let y = 6; y < 56; y++) { const half = y < 14 ? 2 + Math.floor((y - 6) / 2) : 6; p1(g, '#5f5a7c', 18 - half, y, half * 2, 1); p1(g, '#8a86a6', 18 - half, y, 2, 1); p1(g, '#3a3654', 18 + half - 2, y, 2, 1); }
    const c = f ? '#ffffff' : '#b9a2ff'; for (const y of [18, 28, 38, 48]) { p1(g, '#b9a2ff', 15, y, 6, 3); p1(g, c, 17, y + 1, 2, 1); }
    disc(g, 'rgba(185,162,255,0.4)', 18, 5, 4 + f); disc(g, '#e8dcff', 18, 5, 2);
  } },
  signpost: { w: 28, h: 40, draw: (g) => {
    p1(g, WOOD[1], 13, 8, 3, 30); p1(g, WOOD[3], 13, 8, 1, 30); plank(g, 3, 9, 22, 8); p1(g, WOOD[0], 5, 12, 8, 1); p1(g, WOOD[0], 15, 12, 7, 1); p1(g, WOOD[0], 6, 14, 12, 1);
    plank(g, 8, 20, 16, 6); p1(g, GOLD[1], 10, 22, 3, 2); p1(g, '#5a4a3a', 9, 37, 11, 2);
  } },
  lamp: { w: 18, h: 52, frames: 2, ms: 700, light: [0xffd98a, 40], draw: (g, f) => {
    p1(g, '#2a2c3a', 8, 14, 2, 34); p1(g, '#4a4c5c', 8, 14, 1, 34); p1(g, '#2a2c3a', 5, 47, 8, 3); p1(g, '#2a2c3a', 4, 12, 10, 2);
    p1(g, '#2a2c3a', 5, 3, 8, 2); p1(g, f ? '#fff2c0' : '#ffd98a', 6, 5, 6, 7); p1(g, '#fff', 8, 6, 2, 3); p1(g, '#2a2c3a', 5, 5, 1, 7); p1(g, '#2a2c3a', 12, 5, 1, 7); p1(g, '#2a2c3a', 8, 1, 2, 2);
  } },
  planter: { w: 26, h: 26, draw: (g) => {
    block(g, 3, 14, 20, 9); for (const [x, y, c] of [[7, 9, '#e2523f'], [12, 6, '#ffd24a'], [17, 9, '#ff8ad0'], [10, 11, '#a070ff'], [15, 12, '#fff']] as const) { p1(g, '#3f7a52', x, y + 2, 1, 4); disc(g, c, x, y, 2); p1(g, '#ffe680', x, y, 1, 1); }
    p1(g, '#4f9a68', 5, 12, 16, 2);
  } },
};
function stall(g: G, a: string, b: string, goods: string[]) {
  for (const x of [6, 55]) { p1(g, WOOD[1], x, 14, 3, 42); p1(g, WOOD[3], x, 14, 1, 42); }
  awning(g, 2, 8, 60, a, b);
  plank(g, 4, 34, 56, 5); p1(g, WOOD[1], 4, 39, 56, 14); for (let x = 8; x < 58; x += 8) p1(g, WOOD[0], x, 39, 1, 14); p1(g, WOOD[0], 4, 52, 56, 1);
  goods.forEach((c, i) => { const x = 9 + i * 10; if (i % 2) { p1(g, c, x, 28, 6, 6); p1(g, 'rgba(255,255,255,0.4)', x, 28, 2, 4); } else { disc(g, c, x + 3, 31, 3); disc(g, 'rgba(255,255,255,0.45)', x + 2, 30, 1); } });
  p1(g, WOOD[2], 26, 20, 12, 7); p1(g, GOLD[1], 28, 22, 8, 3); // a hanging sign
}

const cache = new Map<string, DecorSprite>();
export const DECOR_KINDS = Object.keys(DEFS);
export function decorSprite(kind: string): DecorSprite {
  let s = cache.get(kind);
  if (!s) {
    const d = DEFS[kind] ?? DEFS.crate, n = d.frames ?? 1, c = mk(d.w * n, d.h), g = c.getContext('2d', { willReadFrequently: true })!;
    for (let f = 0; f < n; f++) {
      const one = mk(d.w, d.h), og = one.getContext('2d', { willReadFrequently: true })!;
      d.draw(og, f);
      const img = og.getImageData(0, 0, d.w, d.h);
      og.putImageData(new ImageData(outlined(img.data, d.w, d.h), d.w, d.h), 0, 0);
      g.drawImage(one, f * d.w, 0);
    }
    cache.set(kind, (s = { img: c, w: d.w, h: d.h, frames: n, ms: d.ms ?? 400, light: d.light }));
  }
  return s;
}
