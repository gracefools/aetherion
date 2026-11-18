// Item icons: 16x16 pixel glyphs drawn from string masks, shaded and outlined in code.
// One glyph per item family; rarity only changes the frame colour in the UI.
import { ITEMS } from '../../../shared/src/items';

// '#' main colour, '+' highlight, '-' shadow, 'o' accent, '.' empty
const GLYPHS: Record<string, string[]> = {
  scroll: ['................', '...++++++++++...', '..+##########-..', '..-++++++++++-..', '...+########-...', '...+##oooo##-...', '...+#o#oo#o#-...', '...+##oooo##-...', '...+#o#oo#o#-...', '...+##oooo##-...', '...+########-...', '..+++++++++++-..', '..+##########-..', '..-----------...', '................', '................'],
  sword: ['.............++.', '............+##.', '...........+##-.', '..........+##-..', '.........+##-...', '........+##-....', '.......+##-.....', '..o...+##-......', '..oo.+##-.......', '...oo##-........', '....ooo.........', '...ooooo........', '..-o..ooo.......', '.-o.....o.......', '.o..............', '................'],
  staff: ['.....oooo.......', '....o+++oo......', '....o+o+oo......', '....oo+ooo......', '.....oooo.......', '......+#........', '......+#........', '......+#-.......', '.......+#.......', '.......+#-......', '........+#......', '........+#-.....', '.........+#.....', '.........+#-....', '..........+#....', '................'],
  orb: ['................', '.....++++.......', '....+####+......', '...+##oo##-.....', '..+##o++o##-....', '..+#o+..+o#-....', '..+#o+..+o#-....', '..+##o++o##-....', '...-##oo##-.....', '....-####-......', '.....----.......', '....o....o......', '...ooo..ooo.....', '....oooooo......', '.....oooo.......', '................'],
  bow: ['....+##.........', '......##-.....o.', '.......+#-...o..', '........+#..o...', '........+#-o....', '.........+o.....', '........o+#.....', '.......o.+#.....', '......o..+#.....', '.....o...+#.....', '....o...+#-.....', '...o....+#......', '..o....+#-......', '.o....##-.......', '....+##.........', '................'],
  crossbow: ['................', '..+##########-..', '.+#-...oo...-#-.', '.#-....oo....-#.', '.#.....oo.....#.', '.-.....oo.....-.', '.......oo.......', '.......oo.......', '......+##-......', '......+##-......', '......+##-......', '......+##-......', '......+##-......', '.......--.......', '................', '................'],
  dagger: ['................', '...........+#...', '..........+##...', '.........+##-...', '........+##-....', '.......+##-.....', '......+##-......', '....o+##-.......', '....oo#-........', '...oooo.........', '..ooo.o.........', '.-oo............', '.-o.............', '................', '................', '................'],
  axe: ['................', '....++##........', '...+#####-......', '..+######o-.....', '..+#####oo......', '..+####.oo......', '...-##..oo......', '....-...oo......', '........oo......', '........oo......', '........oo......', '........oo......', '........oo......', '........oo......', '........--......', '................'],
  mace: ['................', '.....+#+#+......', '....+######-....', '....#+####-#....', '....+######-....', '....#+####-#....', '.....-#-#-......', '.......oo.......', '.......oo.......', '.......oo.......', '.......oo.......', '.......oo.......', '.......oo.......', '......oooo......', '.......--.......', '................'],
  armor: ['................', '..++#......#++..', '.+####....####-.', '.+#####oo#####-.', '.+############-.', '..-##########-..', '...+########-...', '...+###oo###-...', '...+########-...', '...+###oo###-...', '...+########-...', '...+###oo###-...', '...+########-...', '....-######-....', '.....------.....', '................'],
  helmet: ['................', '......oooo......', '.....+####-.....', '....+######-....', '...+########-...', '...+########-...', '...+###--###-...', '...+##-..-##-...', '...+##....##-...', '...+#-....-#-...', '...+#......#-...', '...-#......#-...', '....-......-....', '................', '................', '................'],
  amulet: ['................', '....o......o....', '...o........o...', '...o........o...', '...o........o...', '....o......o....', '.....o....o.....', '......o..o......', '.......++.......', '......+##-......', '.....+####-.....', '.....+####-.....', '......-##-......', '.......--.......', '................', '................'],
  ring: ['................', '................', '.......++.......', '......+##-......', '......-##-......', '.....oooooo.....', '....oo....oo....', '...oo......oo...', '...o........o...', '...o........o...', '...oo......oo...', '....oo....oo....', '.....oooooo.....', '................', '................', '................'],
  potion: ['................', '......oooo......', '......o..o......', '.......oo.......', '.......oo.......', '......o..o......', '.....o....o.....', '....o.++...o....', '....o+####.o....', '....o######o....', '....o######o....', '....o#####-o....', '.....o###-o.....', '......oooo......', '................', '................'],
  stone: ['................', '................', '.......++.......', '......+##-......', '.....+####-.....', '....+##++##-....', '...+##+..+##-...', '...+#+....+#-...', '...-#+....+#-...', '...-##+..+##-...', '....-##++##-....', '.....-####-.....', '......-##-......', '.......--.......', '................', '................'],
  shard: ['................', '.......+........', '......+#-.......', '......+#-.......', '.....+##-.......', '.....+###-......', '....+####-......', '....+####-..o...', '...+#####-.o+o..', '...+######-.o...', '....-####-......', '.....-##-.......', '......--........', '................', '................', '................'],
};
// [main, highlight, shadow, accent]
const PAL: Record<string, [string, string, string, string]> = {
  steel: ['#b9c4d4', '#f2f6ff', '#6c7890', '#8a5a2c'],
  wood: ['#a9743a', '#d9a868', '#6a4420', '#7fd6ff'],
  holy: ['#e9d27a', '#fff6c8', '#a8862e', '#fff0a0'],
  venom: ['#8fc45a', '#d6f2a0', '#4c7a2c', '#5a3c2a'],
  crystal: ['#7ab8f0', '#d8f0ff', '#3a6aa8', '#c9a24a'],
  cloth: ['#7a5fb0', '#b49ae0', '#463470', '#c9a24a'],
  leather: ['#9a6a3c', '#c99a66', '#5c3c1e', '#3a2a1a'],
  plate: ['#a8b4c6', '#eef2fa', '#5f6b82', '#c9a24a'],
  gold: ['#e0b84a', '#fff0b0', '#96701e', '#c9a24a'],
  red: ['#d8483c', '#ff9a8a', '#8a2018', '#cfd6e0'],
  blue: ['#4a8ae0', '#a8d0ff', '#22488a', '#cfd6e0'],
  stone: ['#7fd0c0', '#d8fff4', '#3a8070', '#ffffff'],
  dark: ['#5a4a7a', '#a08ad0', '#2a2040', '#d0483c'],
  frost: ['#9ad8f0', '#f0fcff', '#4a88b0', '#ffffff'],
  ember: ['#e07a3a', '#ffd08a', '#8a3a12', '#3a2a2a'],
};
/** Icon recipe per item id; anything unlisted falls back on its slot. */
const RECIPE: Record<string, [string, string]> = {
  longsword: ['sword', 'steel'], greatsword: ['sword', 'steel'], oak_staff: ['staff', 'wood'], crystal_orb: ['orb', 'crystal'],
  hunting_bow: ['bow', 'wood'], crossbow: ['crossbow', 'wood'], twin_daggers: ['dagger', 'steel'], venom_daggers: ['dagger', 'venom'],
  holy_staff: ['staff', 'holy'], mace: ['mace', 'steel'], great_axe: ['axe', 'steel'], dual_axes: ['axe', 'steel'],
  cloth_robe: ['armor', 'cloth'], leather_jerkin: ['armor', 'leather'], plate_cuirass: ['armor', 'plate'],
  cloth_hood: ['helmet', 'cloth'], leather_cap: ['helmet', 'leather'], plate_helm: ['helmet', 'plate'],
  amulet: ['amulet', 'gold'], ring: ['ring', 'gold'], hp_potion: ['potion', 'red'], mana_potion: ['potion', 'blue'], upgrade_stone: ['stone', 'stone'],
};
Object.assign(RECIPE, {
  rb_circlet: ['helmet', 'crystal'], rb_amulet: ['amulet', 'crystal'], rb_ring: ['ring', 'crystal'],
  ds_helm: ['helmet', 'ember'], ds_amulet: ['amulet', 'ember'], ds_ring: ['ring', 'ember'],
  fb_crown: ['helmet', 'frost'], fb_amulet: ['amulet', 'frost'], fb_ring: ['ring', 'frost'],
  ab_hood: ['helmet', 'dark'], ab_amulet: ['amulet', 'dark'], ab_ring: ['ring', 'dark'],
  guardian_sigil: ['ring', 'stone'], wyrmfang: ['shard', 'ember'], queens_tear: ['ring', 'frost'], golem_core: ['orb', 'dark'],
  shadowmantle: ['helmet', 'dark'], demon_crown: ['helmet', 'red'], heart_of_aetherion: ['orb', 'holy'], stormstride: ['ring', 'blue'],
});
Object.assign(PAL, {
  s_fire: ['#f0e2c0', '#fff8e8', '#a89468', '#ff6a2a'], s_water: ['#f0e2c0', '#fff8e8', '#a89468', '#3a8ae0'], s_lightning: ['#f0e2c0', '#fff8e8', '#a89468', '#d8b400'],
  s_earth: ['#f0e2c0', '#fff8e8', '#a89468', '#8a6a38'], s_wind: ['#f0e2c0', '#fff8e8', '#a89468', '#3aa870'], s_random: ['#f0e2c0', '#fff8e8', '#a89468', '#8a6ad8'],
  s_advanced: ['#d8c8f8', '#f4eeff', '#8a78b8', '#5a3ab0'], s_rare: ['#ffe9a8', '#fff8dc', '#b8922e', '#c0283a'],
});
Object.assign(RECIPE, {
  scroll_fire: ['scroll', 's_fire'], scroll_water: ['scroll', 's_water'], scroll_lightning: ['scroll', 's_lightning'], scroll_earth: ['scroll', 's_earth'], scroll_wind: ['scroll', 's_wind'],
  scroll_random: ['scroll', 's_random'], scroll_advanced: ['scroll', 's_advanced'], scroll_rare: ['scroll', 's_rare'],
});
const SLOT_GLYPH: Record<string, string> = { weapon: 'sword', armor: 'armor', helmet: 'helmet', amulet: 'amulet', ring: 'ring' };
const cache = new Map<string, string>();

/** Replaces an item's icon with imported art (asset pipeline). */
export function setItemIcon(base: string, url: string) {
  cache.set(base, url);
}
/** Registers icon recipes for items added by later content (bosses, sets). */
export function registerIcons(r: Record<string, [string, string]>) {
  Object.assign(RECIPE, r);
}
export const iconGlyphs = () => Object.keys(GLYPHS);

/** Data URL of the 16x16 icon for an item base (drawn once, then cached). */
export function itemIcon(base: string): string {
  let url = cache.get(base);
  if (url) return url;
  const b = ITEMS[base];
  const [glyph, pal] = RECIPE[base] ?? [b?.kind === 'material' ? 'shard' : SLOT_GLYPH[b?.slot ?? ''] ?? 'stone', 'steel'];
  const rows = GLYPHS[glyph] ?? GLYPHS.stone, p = PAL[pal] ?? PAL.steel;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && rows[y][x] !== '.';
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ch = rows[y][x];
      if (ch === '.') {
        // 1px dark outline around the glyph
        if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) {
          g.fillStyle = '#14101c';
          g.fillRect(x, y, 1, 1);
        }
        continue;
      }
      g.fillStyle = ch === '#' ? p[0] : ch === '+' ? p[1] : ch === '-' ? p[2] : p[3];
      g.fillRect(x, y, 1, 1);
    }
  url = c.toDataURL();
  cache.set(base, url);
  return url;
}
