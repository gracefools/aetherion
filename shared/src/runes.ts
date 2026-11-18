// Rune acquisition (M12). Runes are collectible: a character has to obtain a rune before it can
// be attuned. Three separate ideas, kept separate in the data:
//   owning    - the rune has a level entry (build.runes.lv[element] >= 1);
//   equipping - the rune sits in one of the character's rune slots (attunement);
//   upgrading - the rune's level grows with experience, from casting and from spare scrolls.
// Runes come from the Rune Merchant, from Rune Scrolls (bought, dropped by monsters, elites,
// dungeon bosses and world bosses), and nowhere else. Prices and reward tables are data here.
import { ELEMENTS, RUNE_MAX_LEVEL, runeExpToNext, type Build, type Element } from './abilities';

export const ownsRune = (b: Build, el: Element) => (b.runes.lv[el] ?? 0) >= 1;
export const ownedRunes = (b: Build) => ELEMENTS.filter((el) => ownsRune(b, el));

/** Rune Merchant: price in gold and the character level required to buy each rune. */
export const RUNE_SHOP: Record<Element, { price: number; level: number; blurb: string }> = {
  fire: { price: 400, level: 1, blurb: 'Raw damage and burning. The simplest rune to wield.' },
  water: { price: 400, level: 1, blurb: 'Steady bolts, healing rain and slowing ice.' },
  wind: { price: 450, level: 3, blurb: 'Fast, cheap blades of air and a slowing whirlwind.' },
  earth: { price: 500, level: 5, blurb: 'Stone shields and ground that shakes enemies off their feet.' },
  lightning: { price: 600, level: 8, blurb: 'Stuns, and lightning that leaps from enemy to enemy.' },
};
/** A character's first rune is a gift from the merchant, so nobody starts without magic for long. */
export const runePrice = (b: Build, el: Element) => (ownedRunes(b).length === 0 ? 0 : RUNE_SHOP[el].price);

export interface ScrollDef {
  /** Relative chance of each element. */
  weights: Partial<Record<Element, number>>;
  /** Rune experience granted when the rolled rune is already owned (the rune is never overwritten). */
  xpDup: number;
  /** Experience a newly unlocked rune starts with. */
  bonusXp: number;
  /** Roll only among runes the character does not own yet, while there are any. */
  preferNew: boolean;
}
const ALL: Record<Element, number> = { fire: 1, water: 1, lightning: 1, earth: 1, wind: 1 };
const one = (el: Element): ScrollDef => ({ weights: { [el]: 1 }, xpDup: 60, bonusXp: 0, preferNew: false });
/** Reward table of every Rune Scroll item. */
export const SCROLLS: Record<string, ScrollDef> = {
  scroll_fire: one('fire'), scroll_water: one('water'), scroll_lightning: one('lightning'), scroll_earth: one('earth'), scroll_wind: one('wind'),
  scroll_random: { weights: ALL, xpDup: 60, bonusXp: 0, preferNew: false },
  scroll_advanced: { weights: ALL, xpDup: 150, bonusXp: 60, preferNew: false },
  scroll_rare: { weights: ALL, xpDup: 300, bonusXp: 120, preferNew: true },
};
/** What the Rune Merchant sells besides the runes themselves. */
export const RUNE_STOCK = ['scroll_random', 'scroll_fire', 'scroll_water', 'scroll_wind', 'scroll_earth', 'scroll_lightning'];
/** Scroll handed out by a boss kill, by difficulty. */
export const BOSS_SCROLL: Record<'normal' | 'hard' | 'nightmare' | 'armageddon' | 'world', string> = { normal: 'scroll_advanced', hard: 'scroll_advanced', nightmare: 'scroll_rare', armageddon: 'scroll_rare', world: 'scroll_rare' };

export interface ScrollResult {
  el: Element;
  /** True when the scroll unlocked a rune the character did not own. */
  isNew: boolean;
  /** Rune experience added. */
  xp: number;
}
/** Which rune a scroll yields for this character. Pure: the caller applies it. */
export function rollScroll(rng: () => number, id: string, b: Build): ScrollResult | null {
  const def = SCROLLS[id];
  if (!def) return null;
  let pool = ELEMENTS.filter((el) => (def.weights[el] ?? 0) > 0);
  if (def.preferNew && pool.some((el) => !ownsRune(b, el))) pool = pool.filter((el) => !ownsRune(b, el));
  const total = pool.reduce((n, el) => n + def.weights[el]!, 0);
  let r = rng() * total, el = pool[pool.length - 1];
  for (const e of pool) {
    r -= def.weights[e]!;
    if (r < 0) {
      el = e;
      break;
    }
  }
  const isNew = !ownsRune(b, el);
  return { el, isNew, xp: isNew ? def.bonusXp : def.xpDup };
}
/** Adds rune experience, levelling the rune up as far as it goes. Returns the levels gained. */
export function addRuneXp(b: Build, el: Element, xp: number): number {
  const r = b.runes;
  let lv = r.lv[el] ?? 1, have = (r.xp[el] ?? 0) + xp, gained = 0;
  while (lv < RUNE_MAX_LEVEL && have >= runeExpToNext(lv)) {
    have -= runeExpToNext(lv);
    lv++;
    gained++;
  }
  r.lv[el] = lv;
  r.xp[el] = lv >= RUNE_MAX_LEVEL ? 0 : have;
  return gained;
}
/** Applies a scroll's result to a build: a new rune becomes owned at level 1; an owned one gains experience. */
export function applyScroll(b: Build, res: ScrollResult): number {
  if (res.isNew) b.runes.lv[res.el] = 1;
  return res.xp ? addRuneXp(b, res.el, res.xp) : 0;
}
