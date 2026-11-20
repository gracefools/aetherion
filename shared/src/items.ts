// Items: bases, rarity, random affixes, upgrade math, loot tables and validation of stored data.
// Pure and deterministic given an rng; the server owns every roll and every inventory change.
import { computeStats, JOB_DEFS, type Stats } from './jobs';
import { SUBSKILL_LIST } from './subskills';
import { JOBS, type Job } from './protocol';

export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;
export const RARITY_COLOR = ['#d8d8d8', '#6fd36a', '#5aa8ff', '#c07aff', '#ffb347', '#ff5a6a'];
/** Base-stat multiplier and number of random affixes per rarity. */
export const RARITY_MULT = [1, 1.12, 1.28, 1.5, 1.8, 2.2];
/**
 * Equipment tiers (rarities). Each tier has stronger main stats (RARITY_MULT), one more sub-stat
 * slot (RARITY_AFFIXES) and a higher range for its sub-stat rolls (RARITY_SUB_RANGE: a share of the
 * stat's value for the item level; every sub-stat is rolled at random inside its tier's range).
 */
export const RARITY_AFFIXES = [1, 2, 3, 4, 5, 6];
export const RARITY_SUB_RANGE: [number, number][] = [[0.5, 0.9], [0.65, 1.05], [0.8, 1.2], [0.95, 1.4], [1.1, 1.6], [1.3, 1.9]];

export const SLOTS = ['weapon', 'armor', 'helmet', 'amulet', 'ring'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_NAMES: Record<Slot, string> = { weapon: 'Weapon', armor: 'Armor', helmet: 'Helmet', amulet: 'Amulet', ring: 'Ring' };

export const GEAR_STATS = ['maxHp', 'maxRes', 'atk', 'matk', 'def', 'mdef', 'crit', 'critDmg', 'lifesteal', 'dodge', 'healPower'] as const;
export type GearStat = (typeof GEAR_STATS)[number];
export const STAT_LABEL: Record<GearStat, string> = {
  maxHp: 'HP', maxRes: 'Mana', atk: 'Attack', matk: 'Magic', def: 'Defense', mdef: 'Resist', crit: 'Crit %', critDmg: 'Crit damage', lifesteal: 'Lifesteal %', dodge: 'Dodge %', healPower: 'Healing',
};
/** [flat, per item level] */
type Curve = [number, number];
export const AFFIX: Record<GearStat, Curve> = {
  maxHp: [6, 3], maxRes: [4, 2], atk: [1, 0.5], matk: [1, 0.5], def: [1, 0.5], mdef: [1, 0.5],
  crit: [1, 0.08], critDmg: [0.03, 0.002], lifesteal: [0.5, 0.03], dodge: [0.5, 0.04], healPower: [0.02, 0.001],
};
const FRACTIONAL: GearStat[] = ['critDmg', 'healPower'];
const roundStat = (k: GearStat, v: number) => (FRACTIONAL.includes(k) ? Math.round(v * 100) / 100 : k === 'crit' || k === 'lifesteal' || k === 'dodge' ? Math.round(v * 10) / 10 : Math.round(v));

export interface ItemBase {
  id: string;
  name: string;
  kind: 'equip' | 'potion' | 'material' | 'scroll' | 'pet' | 'mount' | 'sigil' | 'food';
  /** Sigils: the slot shape and the symbol (index into SIGIL_SHAPES / SIGIL_SYMBOLS in gear.ts). */
  sigil?: { shape: number; sym: number };
  /** Pet and mount whistles: which pet or mount the item adds to the collection. */
  ref?: string;
  slot?: Slot;
  /** Weapons: the job and which of its two weapon specialisations this is. */
  job?: Job;
  wslot?: number;
  /** Armor class restriction. */
  jobs?: Job[];
  /** Visible appearance when equipped (indices into the character creator options). */
  look?: { armor?: number; helmet?: number; color?: number };
  stats?: Partial<Record<GearStat, Curve>>;
  stack?: number;
  price: number; // shop buy price for stackables; base of the sell value otherwise
  desc: string;
  /** M7: fixed-identity drops (boss loot). */
  unique?: { rar: number; set?: string; passive?: string };
}

const wpn = (job: Job, wslot: number, id: string, name: string, mul: number, magic: boolean, extra: Partial<Record<GearStat, Curve>> = {}): ItemBase => ({
  id, name, kind: 'equip', slot: 'weapon', job, wslot, price: 14,
  stats: { [magic ? 'matk' : 'atk']: [4 * mul, 1.5 * mul], ...extra },
  desc: JOB_DEFS[job].weapons[wslot].note,
});
const CLOTH: Job[] = ['mage', 'cleric'], LEATHER: Job[] = ['ranger', 'assassin'], PLATE: Job[] = ['knight', 'berserker'];

export const ITEM_LIST: ItemBase[] = [
  wpn('knight', 0, 'longsword', 'Longsword and Kite Shield', 1, false, { def: [2, 0.6] }),
  wpn('knight', 1, 'greatsword', 'Greatsword', 1.25, false),
  wpn('mage', 0, 'oak_staff', 'Runed Staff', 1.1, true),
  wpn('mage', 1, 'crystal_orb', 'Crystal Orb', 0.95, true, { crit: [2, 0] }),
  wpn('ranger', 0, 'hunting_bow', 'Hunting Bow', 1, false),
  wpn('ranger', 1, 'crossbow', 'Heavy Crossbow', 1.2, false),
  wpn('assassin', 0, 'twin_daggers', 'Twin Daggers', 0.9, false, { crit: [2, 0] }),
  wpn('assassin', 1, 'venom_daggers', 'Venom Daggers', 0.85, false),
  wpn('cleric', 0, 'holy_staff', 'Sunlit Staff', 1, true, { healPower: [0.04, 0] }),
  wpn('cleric', 1, 'mace', 'Flanged Mace', 1.15, false),
  wpn('berserker', 0, 'great_axe', 'Great Axe', 1.25, false),
  wpn('berserker', 1, 'dual_axes', 'Paired Hand Axes', 1, false),

  { id: 'cloth_robe', name: 'Woven Robe', kind: 'equip', slot: 'armor', jobs: CLOTH, price: 12, stats: { def: [2, 0.8], mdef: [3, 1.2], maxRes: [6, 3] }, desc: 'Light cloth favoured by casters.' },
  { id: 'leather_jerkin', name: 'Leather Jerkin', kind: 'equip', slot: 'armor', jobs: LEATHER, look: { armor: 1, color: 8 }, price: 12, stats: { def: [4, 1.2], mdef: [2, 0.8], crit: [1, 0] }, desc: 'Supple leather that does not slow the hand.' },
  { id: 'plate_cuirass', name: 'Plate Cuirass', kind: 'equip', slot: 'armor', jobs: PLATE, look: { armor: 3, color: 6 }, price: 12, stats: { def: [6, 1.8], mdef: [2, 0.6], maxHp: [10, 6] }, desc: 'Heavy plate for those who stand in front.' },
  { id: 'cloth_hood', name: 'Scholar Hood', kind: 'equip', slot: 'helmet', jobs: CLOTH, look: { helmet: 2, color: 3 }, price: 9, stats: { mdef: [2, 0.6], maxRes: [4, 2] }, desc: 'A hood stitched with warding thread.' },
  { id: 'leather_cap', name: 'Scout Cap', kind: 'equip', slot: 'helmet', jobs: LEATHER, look: { helmet: 1, color: 8 }, price: 9, stats: { def: [2, 0.6], dodge: [1, 0] }, desc: 'A snug cap that stays on in a sprint.' },
  { id: 'plate_helm', name: 'Crested Helm', kind: 'equip', slot: 'helmet', jobs: PLATE, look: { helmet: 3, color: 6 }, price: 9, stats: { def: [3, 0.9], maxHp: [6, 3] }, desc: 'Steel helm with a guard for nose and cheek.' },
  { id: 'amulet', name: 'Amulet', kind: 'equip', slot: 'amulet', price: 10, stats: { maxHp: [8, 4] }, desc: 'A charm worn at the throat.' },
  { id: 'ring', name: 'Ring', kind: 'equip', slot: 'ring', price: 10, stats: { maxRes: [4, 2] }, desc: 'A band that hums faintly.' },

  { id: 'hp_potion', name: 'Health Potion', kind: 'potion', stack: 100, price: 20, desc: 'Restores 20% of maximum HP.' },
  { id: 'mana_potion', name: 'Mana Potion', kind: 'potion', stack: 100, price: 24, desc: 'Restores 30% of maximum mana (20 rage for Berserkers).' },
  { id: 'upgrade_stone', name: 'Upgrade Stone', kind: 'material', stack: 50, price: 150, desc: 'Used to strengthen equipment.' },
  // M15: pet and mount whistles (used once: the companion joins the collection)
  { id: 'pet_ember_kit', name: 'Ember Kit Whistle', kind: 'pet', ref: 'ember_kit', stack: 5, price: 1200, desc: 'Use it to add the Ember Kit to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'pet_moss_sprout', name: 'Moss Sprout Whistle', kind: 'pet', ref: 'moss_sprout', stack: 5, price: 1200, desc: 'Use it to add the Moss Sprout to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'pet_frost_owlet', name: 'Frost Owlet Whistle', kind: 'pet', ref: 'frost_owlet', stack: 5, price: 1200, desc: 'Use it to add the Frost Owlet to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'pet_bog_toad', name: 'Bog Toad Whistle', kind: 'pet', ref: 'bog_toad', stack: 5, price: 1200, desc: 'Use it to add the Bog Toad to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'pet_star_mote', name: 'Star Mote Whistle', kind: 'pet', ref: 'star_mote', stack: 5, price: 1200, desc: 'Use it to add the Star Mote to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'pet_iron_pup', name: 'Iron Pup Whistle', kind: 'pet', ref: 'iron_pup', stack: 5, price: 1200, desc: 'Use it to add the Iron Pup to your companions. A pet follows you and grants a passive bonus that grows as it levels.' },
  { id: 'mount_sky_griffin', name: 'Sky Griffin Reins', kind: 'mount', ref: 'sky_griffin', stack: 1, price: 250000, desc: 'A flying mount (level 120): it carries you over water and forests. Dropped rarely by world bosses of level 120 and higher, and by Aetherion\'s Shadow.' },
  { id: 'mount_star_drake', name: 'Star Drake Reins', kind: 'mount', ref: 'star_drake', stack: 1, price: 600000, desc: 'The fastest flying mount (level 160). Dropped very rarely by Aetherion\'s Shadow and world bosses of level 160 and higher.' },
  // gathering, fishing and the garden
  // gathering materials come in four tiers, by the level of the region they are gathered in (life.ts)
  { id: 'mithril_ore', name: 'Mithril Ore', kind: 'material', stack: 99, price: 60, desc: 'Mining, tier 2: mined in regions of level 30 to 59. Forges gear of level 60.' },
  { id: 'aether_ore', name: 'Aetherite', kind: 'material', stack: 99, price: 500, desc: 'Mining, tier 4: mined in regions of level 90 and up. Forges gear of level 120.' },
  { id: 'sunpetal', name: 'Sunpetal', kind: 'material', stack: 99, price: 60, desc: 'Herbalism, tier 2: gathered in regions of level 30 to 59, or grown in a home garden. Cooks tier 2 food.' },
  { id: 'frostbloom', name: 'Frostbloom', kind: 'material', stack: 99, price: 180, desc: 'Herbalism, tier 3: gathered in regions of level 60 to 89. Cooks tier 3 food.' },
  { id: 'starlily', name: 'Starlily', kind: 'material', stack: 99, price: 500, desc: 'Herbalism, tier 4: gathered in regions of level 90 and up. Cooks tier 4 food.' },
  { id: 'river_fish', name: 'River Fish', kind: 'material', stack: 99, price: 16, desc: 'Fishing, tier 1: caught in regions below level 30. Cooks tier 1 food.' },
  { id: 'moon_carp', name: 'Moon Carp', kind: 'material', stack: 99, price: 60, desc: 'Fishing, tier 2: caught in regions of level 30 to 59. Cooks tier 2 food.' },
  { id: 'star_koi', name: 'Star Koi', kind: 'material', stack: 99, price: 180, desc: 'Fishing, tier 3: caught in regions of level 60 to 89. Cooks tier 3 food.' },
  { id: 'void_eel', name: 'Void Eel', kind: 'material', stack: 99, price: 500, desc: 'Fishing, tier 4: caught in regions of level 90 and up. Cooks tier 4 food.' },
  { id: 'furn_bed', name: 'Feather Bed', kind: 'material', stack: 5, price: 3000, desc: 'Furniture for your home. Sleep in it once a day to wake up rested (+5% attack and defence for half an hour).' },
  { id: 'furn_table', name: 'Oak Table', kind: 'material', stack: 5, price: 800, desc: 'Furniture for your home.' },
  { id: 'furn_chair', name: 'Carved Chair', kind: 'material', stack: 5, price: 400, desc: 'Furniture for your home.' },
  { id: 'furn_lamp', name: 'Star Lamp', kind: 'material', stack: 5, price: 1200, desc: 'Furniture for your home.' },
  { id: 'furn_banner', name: 'House Banner', kind: 'material', stack: 5, price: 1500, desc: 'Furniture for your home.' },
  { id: 'furn_plant', name: 'Potted Fern', kind: 'material', stack: 5, price: 600, desc: 'Furniture for your home.' },
  { id: 'furn_trophy', name: 'Boss Trophy', kind: 'material', stack: 5, price: 25000, desc: 'Furniture for your home: proof of a boss defeated.' },
  { id: 'furn_chest', name: 'Treasure Chest', kind: 'material', stack: 5, price: 2000, desc: 'Furniture for your home.' },
  { id: 'moonleaf_seed', name: 'Moonleaf Seed', kind: 'material', stack: 20, price: 200, desc: 'Plant it in your home garden: six Moonleaf in two hours.' },
  { id: 'sunpetal_seed', name: 'Sunpetal Seed', kind: 'material', stack: 20, price: 1500, desc: 'Plant it in your home garden: two Sunpetal in two hours.' },
  { id: 'ore_spore', name: 'Ore Spore', kind: 'material', stack: 20, price: 300, desc: 'A strange spore that grows iron in a home garden: six Iron Ore in two hours.' },
  { id: 'mount_plains_strider', name: 'Plains Strider Reins', kind: 'mount', ref: 'plains_strider', stack: 1, price: 2500, desc: 'Use it to add the Plains Strider to your mounts. Riding is faster; it is not possible in dungeons, in the arena or in combat.' },
  { id: 'mount_ashen_charger', name: 'Ashen Charger Reins', kind: 'mount', ref: 'ashen_charger', stack: 1, price: 6000, desc: 'Use it to add the Ashen Charger to your mounts. Riding is faster; it is not possible in dungeons, in the arena or in combat.' },
  { id: 'mount_frost_elk', name: 'Frost Elk Reins', kind: 'mount', ref: 'frost_elk', stack: 1, price: 6000, desc: 'Use it to add the Frost Elk to your mounts. Riding is faster; it is not possible in dungeons, in the arena or in combat.' },
  { id: 'mount_void_skiff', name: 'Void Skiff Reins', kind: 'mount', ref: 'void_skiff', stack: 1, price: 12000, desc: 'Use it to add the Void Skiff to your mounts. Riding is faster; it is not possible in dungeons, in the arena or in combat.' },
  // M12: Rune Scrolls (reward tables in runes.ts)
  { id: 'scroll_fire', name: 'Fire Rune Scroll', kind: 'scroll', stack: 20, price: 260, desc: 'Read it to unlock the Fire Rune. If you already own it, the rune gains experience instead.' },
  { id: 'scroll_water', name: 'Water Rune Scroll', kind: 'scroll', stack: 20, price: 260, desc: 'Read it to unlock the Water Rune. If you already own it, the rune gains experience instead.' },
  { id: 'scroll_lightning', name: 'Lightning Rune Scroll', kind: 'scroll', stack: 20, price: 260, desc: 'Read it to unlock the Lightning Rune. If you already own it, the rune gains experience instead.' },
  { id: 'scroll_earth', name: 'Earth Rune Scroll', kind: 'scroll', stack: 20, price: 260, desc: 'Read it to unlock the Earth Rune. If you already own it, the rune gains experience instead.' },
  { id: 'scroll_wind', name: 'Wind Rune Scroll', kind: 'scroll', stack: 20, price: 260, desc: 'Read it to unlock the Wind Rune. If you already own it, the rune gains experience instead.' },
  { id: 'scroll_random', name: 'Random Rune Scroll', kind: 'scroll', stack: 20, price: 150, desc: 'Read it to unlock one of the five runes, chosen at random. A rune you already own gains experience instead.' },
  { id: 'scroll_advanced', name: 'Advanced Rune Scroll', kind: 'scroll', stack: 20, price: 600, desc: 'A random rune that arrives with experience; much more experience if you already own it. Dropped by bosses.' },
  { id: 'scroll_rare', name: 'Rare Rune Scroll', kind: 'scroll', stack: 20, price: 1500, desc: 'Always unlocks a rune you do not own yet, with experience. If you own all five, a large amount of experience. Dropped by the greatest bosses.' },
  // food (life.ts): cooked from herbs and fish of a tier; eaten for a half-hour bonus
  { id: 'food_steak_1', name: 'Steak', kind: 'food', stack: 99, price: 40, desc: '+30 attack for 30 minutes.' },
  { id: 'food_steak_2', name: 'Hearty Steak', kind: 'food', stack: 99, price: 160, desc: '+90 attack for 30 minutes.' },
  { id: 'food_steak_3', name: 'Royal Steak', kind: 'food', stack: 99, price: 480, desc: '+180 attack for 30 minutes.' },
  { id: 'food_steak_4', name: 'Celestial Steak', kind: 'food', stack: 99, price: 1400, desc: '+360 attack for 30 minutes.' },
  { id: 'food_soup_1', name: 'Herb Soup', kind: 'food', stack: 99, price: 40, desc: '+30 magic for 30 minutes.' },
  { id: 'food_soup_2', name: 'Hearty Soup', kind: 'food', stack: 99, price: 160, desc: '+90 magic for 30 minutes.' },
  { id: 'food_soup_3', name: 'Royal Soup', kind: 'food', stack: 99, price: 480, desc: '+180 magic for 30 minutes.' },
  { id: 'food_soup_4', name: 'Celestial Soup', kind: 'food', stack: 99, price: 1400, desc: '+360 magic for 30 minutes.' },
  { id: 'food_pie_1', name: 'Fish Pie', kind: 'food', stack: 99, price: 40, desc: '+300 maximum HP for 30 minutes.' },
  { id: 'food_pie_2', name: 'Hearty Pie', kind: 'food', stack: 99, price: 160, desc: '+900 maximum HP for 30 minutes.' },
  { id: 'food_pie_3', name: 'Royal Pie', kind: 'food', stack: 99, price: 480, desc: '+1800 maximum HP for 30 minutes.' },
  { id: 'food_pie_4', name: 'Celestial Pie', kind: 'food', stack: 99, price: 1400, desc: '+3600 maximum HP for 30 minutes.' },
  { id: 'food_juice_1', name: 'Berry Juice', kind: 'food', stack: 99, price: 40, desc: '+20 defence for 30 minutes.' },
  { id: 'food_juice_2', name: 'Hearty Juice', kind: 'food', stack: 99, price: 160, desc: '+60 defence for 30 minutes.' },
  { id: 'food_juice_3', name: 'Royal Juice', kind: 'food', stack: 99, price: 480, desc: '+120 defence for 30 minutes.' },
  { id: 'food_juice_4', name: 'Celestial Juice', kind: 'food', stack: 99, price: 1400, desc: '+240 defence for 30 minutes.' },
  { id: 'food_drink_1', name: 'Energy Drink', kind: 'food', stack: 99, price: 40, desc: '+5% movement speed for 30 minutes.' },
  { id: 'food_drink_2', name: 'Strong Energy Drink', kind: 'food', stack: 99, price: 160, desc: '+10% movement speed for 30 minutes.' },
  { id: 'food_drink_3', name: 'Royal Energy Drink', kind: 'food', stack: 99, price: 480, desc: '+15% movement speed for 30 minutes.' },
  { id: 'food_drink_4', name: 'Celestial Energy Drink', kind: 'food', stack: 99, price: 1400, desc: '+20% movement speed for 30 minutes.' },
  // M8: gathered from resource nodes; merchants turn them into stones and potions
  { id: 'iron_ore', name: 'Iron Ore', kind: 'material', stack: 99, price: 16, desc: 'Mining, tier 1: mined in regions below level 30. Forges gear of level 30; four make an Upgrade Stone at a merchant.' },
  { id: 'moonleaf', name: 'Moonleaf', kind: 'material', stack: 99, price: 16, desc: 'Herbalism, tier 1: gathered in regions below level 30. Cooks tier 1 food; merchants brew potions from it.' },
  { id: 'star_shard', name: 'Star Shard', kind: 'material', stack: 99, price: 180, desc: 'Mining, tier 3: mined in regions of level 60 to 89. Forges gear of level 90.' },
];
export const ITEMS: Record<string, ItemBase> = Object.fromEntries(ITEM_LIST.map((b) => [b.id, b]));
/** Late registration of fixed-identity items (M7 boss loot) so `ITEMS` stays the single lookup. */
export function registerItems(list: ItemBase[]) {
  for (const b of list) if (!ITEMS[b.id]) {
    ITEM_LIST.push(b);
    ITEMS[b.id] = b;
  }
}

/**
 * How grand a piece of gear looks on the character, 0 to 5: from its item level (in steps that follow
 * the regions and the level 100+ endgame) and one step more for legendary and mythic items.
 */
export function gearTier(it?: { ilvl: number; rar: number } | null): number {
  if (!it) return 0;
  const byLevel = it.ilvl < 20 ? 0 : it.ilvl < 45 ? 1 : it.ilvl < 70 ? 2 : it.ilvl < 100 ? 3 : it.ilvl < 140 ? 4 : 5;
  return Math.min(5, byLevel + (it.rar >= 4 ? 1 : 0));
}
export interface Item {
  uid: string; // unique instance id, assigned by the server
  base: string;
  rar: number;
  ilvl: number;
  aff: [GearStat, number][];
  up: number; // upgrade level 0..10
  qty: number;
  /** Sigils: the class skill they raise and by how many ranks (+1 to +3). */
  sk?: [skill: string, plus: number];
  /**
   * Bound to its character (equipment only): it has been worn, or it came as a quest reward. A bound item cannot be
   * traded, mailed or listed on the auction house; it can still be sold to a merchant or banked.
   */
  bd?: 1;
  /** Sigils: every skill it raises (from tier 3 on, more than one), and its tier (1-6). */
  sks?: [skill: string, plus: number][];
  st?: number;
}
export type Equipment = Partial<Record<Slot, Item>>;

export const INVENTORY_SIZE = 200;
export const MAX_UPGRADE = 10;
export const MAX_ILVL = 220;
export const UPGRADE_STEP = 0.06; // +6% base stats per upgrade level
export const UPGRADE_CHANCE = [100, 95, 90, 80, 70, 60, 50, 40, 30, 20]; // % to go from index to index + 1
export const POTION_CD_MS = 8000;
export const SHOP_RANGE = 280;
export const SHOP_STOCK = ['hp_potion', 'mana_potion'];
/** How much a potion restores, as a share of the maximum. */
export const HP_POTION = 0.2, MANA_POTION = 0.3, RAGE_POTION = 20;
/** The most of one item a single purchase can hold. */
export const SHOP_BUY_MAX = 999;
/**
 * Things a shop sells only once to each character, by purchase key: the starter pet, the first
 * mount, and one of each Rune Scroll.
 */
export const SHOP_ONCE: Record<string, string> = {
  pet_moss_sprout: 'pet',
  mount_plains_strider: 'mount',
  scroll_random: 'scroll_random', scroll_fire: 'scroll_fire', scroll_water: 'scroll_water', scroll_wind: 'scroll_wind', scroll_earth: 'scroll_earth', scroll_lightning: 'scroll_lightning',
};
/** Companions the merchant sells, once each: the starter pet (Eldoria's own) and the lowest mount. */
/** The first pet and mount: sold only by the shop in Eldoria (other shops sell none). */
export const SHOP_COMPANIONS = ['pet_moss_sprout', 'mount_plains_strider'];
/** The merchant's daily gift. */
export const DAILY_STONES = 3;
/** Ordinary monsters carry a tenth of the gold they once did. */
export const MONSTER_GOLD = 0.1;
/** Chance that a kill drops a Random Rune Scroll. */
export const SCROLL_DROP = { normal: 0.012, elite: 0.15 };
export const PET_DROP_ELITE = 0.03;
export const PET_WHISTLES = ['pet_ember_kit', 'pet_moss_sprout', 'pet_frost_owlet', 'pet_bog_toad', 'pet_iron_pup', 'pet_star_mote'];
/** Reins of the ground mounts: dropped by dungeon bosses, now that no shop sells them. */
export const GROUND_MOUNTS = ['mount_plains_strider', 'mount_ashen_charger', 'mount_frost_elk', 'mount_void_skiff'];
export const GROUND_MOUNT_DROP = 0.04;

export const reqLevel = (it: Item) => Math.max(1, it.ilvl - 2);
export const itemName = (it: Item) => `${it.up ? `+${it.up} ` : ''}${ITEMS[it.base]?.name ?? it.base}`;
export const upgradeCost = (it: Item) => ({ gold: 20 * (it.up + 1) * (1 + it.rar), stones: 1 + Math.floor(it.up / 3) });
export const sellValue = (it: Item) => {
  const b = ITEMS[it.base];
  if (!b) return 0;
  if (b.kind !== 'equip') return Math.max(1, Math.floor(b.price * 0.25));
  return Math.round((b.price + it.ilvl * 3) * RARITY_MULT[it.rar] ** 2 * (1 + 0.2 * it.up));
};
/** Why this character cannot equip the item, or ''. */
export function equipBlock(it: Item, job: Job, level: number): string {
  const b = ITEMS[it.base];
  if (!b || b.kind !== 'equip') return 'Not equipment';
  if (b.job && b.job !== job) return `Only for ${JOB_DEFS[b.job].name}s`;
  if (b.jobs && !b.jobs.includes(job)) return `Only for ${b.jobs.map((j) => JOB_DEFS[j].name).join(' and ')}s`;
  if (level < reqLevel(it)) return `Requires level ${reqLevel(it)}`;
  return '';
}

/** Main stats of an item: its base's stats for the item level, times its tier and its upgrade. `boost` multiplies them (armament). */
export function itemMainStats(it: Item, boost = 1): Partial<Record<GearStat, number>> {
  const b = ITEMS[it.base], out: Partial<Record<GearStat, number>> = {};
  if (!b || b.kind !== 'equip') return out;
  const mul = RARITY_MULT[it.rar] * (1 + UPGRADE_STEP * it.up) * boost;
  for (const k of GEAR_STATS) {
    const c = b.stats?.[k];
    if (c) out[k] = roundStat(k, (c[0] + c[1] * it.ilvl) * mul);
  }
  return out;
}
/** Sub-stats of an item: its rolled affixes (never boosted by armament). */
export function itemSubStats(it: Item): Partial<Record<GearStat, number>> {
  const out: Partial<Record<GearStat, number>> = {};
  for (const [k, v] of it.aff) out[k] = roundStat(k, (out[k] ?? 0) + v);
  return out;
}
/** The range a sub-stat of this tier and item level can roll in: [lowest, highest]. */
export function subRange(k: GearStat, ilvl: number, rar: number): [number, number] {
  const base = AFFIX[k][0] + AFFIX[k][1] * ilvl, [lo, hi] = RARITY_SUB_RANGE[Math.max(0, Math.min(5, rar))];
  return [roundStat(k, base * lo), roundStat(k, base * hi)];
}
/** Total stat contribution of one item (main stats boosted by `boost`, plus sub-stats). */
export function itemStats(it: Item, boost = 1): Partial<Record<GearStat, number>> {
  const out = itemMainStats(it, boost);
  for (const [k, v] of it.aff) out[k] = roundStat(k, (out[k] ?? 0) + v);
  return out;
}
export function gearStats(eq: Equipment, boost: Partial<Record<Slot, number>> = {}): Partial<Record<GearStat, number>> {
  const out: Partial<Record<GearStat, number>> = {};
  for (const s of SLOTS) {
    const it = eq[s];
    if (!it) continue;
    const st = itemStats(it, boost[s] ?? 1);
    for (const k of GEAR_STATS) if (st[k]) out[k] = roundStat(k, (out[k] ?? 0) + st[k]!);
  }
  return out;
}
export function addGear(s: Stats, g: Partial<Record<GearStat, number>>) {
  for (const k of GEAR_STATS) if (g[k]) (s as any)[k] = roundStat(k, s[k] + g[k]!);
}

export type ItemSpec = Omit<Item, 'uid'>;
/** Rolls an equipment instance: rarity decides the multiplier and how many distinct affixes it gets. */
export function rollItem(rng: () => number, base: string, ilvl: number, rar: number): ItemSpec {
  const b = ITEMS[base];
  ilvl = Math.max(1, Math.min(MAX_ILVL, Math.round(ilvl)));
  if (!b || b.kind !== 'equip') return { base, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 };
  if (b.unique) rar = b.unique.rar; // fixed-identity items always have their own rarity
  // sub-stats: one slot more per tier, each a different stat, rolled at random inside the tier's range
  const pool = [...GEAR_STATS], aff: [GearStat, number][] = [], [lo, hi] = RARITY_SUB_RANGE[rar];
  for (let i = 0; i < RARITY_AFFIXES[rar]; i++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    aff.push([k, roundStat(k, (AFFIX[k][0] + AFFIX[k][1] * ilvl) * (lo + rng() * (hi - lo)))]);
  }
  return { base, rar, ilvl, aff, up: 0, qty: 1 };
}

// ---------------- loot ----------------
export interface LootTier {
  equip: number; // chance of an equipment drop
  rar: number[]; // rarity weights, index = rarity
  potion: number;
  stone: number;
  gold: [number, number]; // per monster level
}
/** Drop tables for ordinary monsters. Boss pools are added in M7. Rates are multiplied by the server's DROP_RATE. */
export const LOOT: Record<'normal' | 'elite', LootTier> = {
  normal: { equip: 0.14, rar: [68, 26, 6, 0, 0, 0], potion: 0.2, stone: 0.04, gold: [2, 5] },
  elite: { equip: 1, rar: [0, 38, 46, 16, 0, 0], potion: 1, stone: 0.6, gold: [14, 26] },
};
const EQUIP_BASES = ITEM_LIST.filter((b) => b.kind === 'equip');
export const usableBy = (b: ItemBase, job: Job) => (!b.job || b.job === job) && (!b.jobs || b.jobs.includes(job));

export function pickRarity(rng: () => number, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return 0;
}
/** One player's personal loot from a kill. 65% of equipment drops are usable by the looter's own job. */
export function rollLoot(rng: () => number, level: number, elite: boolean, job: Job, rate = 1, goldRate = 1): { gold: number; items: ItemSpec[] } {
  const t = LOOT[elite ? 'elite' : 'normal'], items: ItemSpec[] = [];
  const raw = (t.gold[0] + rng() * (t.gold[1] - t.gold[0])) * level * goldRate * MONSTER_GOLD;
  const gold = Math.floor(raw) + (rng() < raw - Math.floor(raw) ? 1 : 0); // the fraction is a chance of one more coin
  if (rng() < t.equip * rate) {
    const mine = EQUIP_BASES.filter((b) => !b.unique && usableBy(b, job)), all = EQUIP_BASES.filter((b) => !b.unique);
    const pool = rng() < 0.65 ? mine : all;
    const base = pool[Math.floor(rng() * pool.length)];
    items.push(rollItem(rng, base.id, level + Math.floor(rng() * 3) - 1, pickRarity(rng, t.rar)));
  }
  if (rng() < t.potion * rate) items.push({ base: JOB_DEFS[job].resource === 'rage' || rng() < 0.6 ? 'hp_potion' : 'mana_potion', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  if (rng() < t.stone * rate) items.push({ base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  // M15: a rare pet whistle from elites
  if (elite && rng() < PET_DROP_ELITE * rate) items.push({ base: PET_WHISTLES[Math.floor(rng() * PET_WHISTLES.length)], rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  // Rune Scrolls: rare from ordinary monsters, common from elites
  if (rng() < SCROLL_DROP[elite ? 'elite' : 'normal'] * rate) items.push({ base: 'scroll_random', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
  return { gold, items };
}

// ---------------- stored-data validation ----------------
/** A reward: equipment in it comes bound to whoever receives it. */
export const bindSpec = <T extends { base: string; bd?: 1 }>(s: T): T => (ITEMS[s.base]?.kind === 'equip' ? { ...s, bd: 1 } : s);
/** Why an item cannot leave its owner ('' if it can). */
export const boundWhy = (it: { bd?: 1 }, what: 'trade' | 'market' | 'mail'): string =>
  !it.bd ? '' : what === 'trade' ? 'Bound items cannot be traded' : what === 'market' ? 'Bound items cannot be sold on the market' : 'Bound items cannot be sent by mail';
/** Items that no longer exist, and what a stored one becomes. */
export const LEGACY_ITEMS: Record<string, string> = { awakening_essence: 'arm_core' };
export function cleanItem(raw: any, seen: Set<string>): Item | null {
  if (!raw || typeof raw !== 'object' || typeof raw.uid !== 'string' || raw.uid.length > 40 || seen.has(raw.uid)) return null;
  const b = ITEMS[LEGACY_ITEMS[raw.base] ?? raw.base];
  if (!b) return null;
  const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v as number)) : d);
  const it: Item = { uid: raw.uid, base: b.id, rar: 0, ilvl: 1, aff: [], up: 0, qty: int(raw.qty, 1, b.stack ?? 1, 1) };
  if (b.kind === 'equip') {
    it.ilvl = int(raw.ilvl, 1, MAX_ILVL, 1);
    it.rar = b.unique ? b.unique.rar : int(raw.rar, 0, 5, 0);
    it.up = int(raw.up, 0, MAX_UPGRADE, 0);
    if (raw.bd) it.bd = 1;
    const used = new Set<string>();
    if (Array.isArray(raw.aff))
      for (const a of raw.aff.slice(0, RARITY_AFFIXES[it.rar])) {
        if (!Array.isArray(a) || !GEAR_STATS.includes(a[0]) || used.has(a[0]) || typeof a[1] !== 'number' || !(a[1] > 0)) continue;
        used.add(a[0]);
        const k = a[0] as GearStat;
        // a sub-stat can never exceed the best possible roll for its tier and item level
        it.aff.push([k, roundStat(k, Math.min(a[1], (AFFIX[k][0] + AFFIX[k][1] * it.ilvl) * RARITY_SUB_RANGE[it.rar][1]))]);
      }
  }
  if (b.kind === 'sigil' && Array.isArray(raw.sk) && typeof raw.sk[0] === 'string' && SIGIL_SKILL_IDS.has(raw.sk[0]) && Number.isInteger(raw.sk[1]))
    it.sk = [raw.sk[0], Math.max(1, Math.min(3, raw.sk[1]))];
  if (b.kind === 'sigil' && Number.isInteger(raw.st) && raw.st >= 1 && raw.st <= SIGIL_TIER_COUNT && Array.isArray(raw.sks)) {
    // a tiered sigil: as many different skills as its tier has slots, each within the tier's range
    const lim = SIGIL_TIER_LIMITS[raw.st - 1], seenSk = new Set<string>(), list: [string, number][] = [];
    for (const x of raw.sks.slice(0, lim.slots))
      if (Array.isArray(x) && typeof x[0] === 'string' && SIGIL_SKILL_IDS.has(x[0]) && !seenSk.has(x[0]) && Number.isInteger(x[1])) {
        seenSk.add(x[0]);
        list.push([x[0], Math.max(1, Math.min(lim.max, x[1]))]);
      }
    if (list.length) {
      it.st = raw.st;
      it.sks = list;
      delete it.sk;
    }
  }
  if (b.kind === 'sigil' && !it.sk && !it.sks) return null; // a sigil without its skill is not a sigil
  seen.add(it.uid);
  return it;
}
/** Sanitises inventory and equipment loaded from storage: unknown bases, duplicate ids and impossible values are dropped or clamped. */
export function cleanInventory(job: Job, level: number, rawInv: unknown, rawEq: unknown): { inv: Item[]; eq: Equipment; kit: boolean } {
  const seen = new Set<string>(), inv: Item[] = [], eq: Equipment = {};
  const e = (rawEq && typeof rawEq === 'object' ? rawEq : {}) as any;
  for (const s of SLOTS) {
    const it = cleanItem(e[s], seen);
    if (it && ITEMS[it.base].slot === s && !equipBlock(it, job, level)) eq[s] = { ...it, bd: 1 }; // worn gear is bound
    else if (it && inv.length < INVENTORY_SIZE) inv.push(it);
  }
  if (Array.isArray(rawInv))
    for (const r of rawInv) {
      if (inv.length >= INVENTORY_SIZE) break;
      const it = cleanItem(r, seen);
      if (it) inv.push(it);
    }
  return { inv, eq, kit: e.kit === true };
}
/** What a new character starts with. */
export function starterKit(job: Job, wslot: number): ItemSpec[] {
  const w = ITEM_LIST.find((b) => b.job === job && b.wslot === wslot && !b.unique)!;
  return [{ base: w.id, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 }, { base: 'hp_potion', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 }];
}
export { JOBS };
/** Every class skill a sigil may raise (all jobs, active and passive) and every sub-skill. */
export const SIGIL_SKILL_IDS = new Set<string>([...Object.values(JOB_DEFS).flatMap((d) => d.skills.map((n) => n.id)), ...SUBSKILL_LIST.map((s) => s.id)]);
/** Sigil tiers: skill slots and the highest bonus a slot can roll (see gear.ts, SIGIL_TIERS). */
export const SIGIL_TIER_LIMITS = [{ slots: 1, max: 1 }, { slots: 1, max: 2 }, { slots: 2, max: 2 }, { slots: 2, max: 3 }, { slots: 3, max: 3 }, { slots: 3, max: 4 }];
export const SIGIL_TIER_COUNT = SIGIL_TIER_LIMITS.length;

/** Stats of a character including its equipment (the same sum the server uses). */
export function fullStats(job: Job, level: number, wslot: number, eq: Equipment, ranks: Record<string, number> = {}): Stats {
  const s = computeStats(job, level, wslot, ranks);
  applyGear(s, eq);
  return s;
}

// =============================================================================================
// M7: boss loot. Set pieces (Epic), signature items (Legendary) and relics (Mythic).
// All are jewellery or open helmets so that every job can use every one of them.
// =============================================================================================
export interface SetDef {
  id: string;
  name: string;
  /** Bonus at 2 and at 3 pieces: flat stats and percentage multipliers on final stats. */
  bonus: [SetBonus, SetBonus];
}
export interface SetBonus {
  text: string;
  flat?: Partial<Record<GearStat, number>>;
  pct?: Partial<Record<'maxHp' | 'atk' | 'matk' | 'def' | 'mdef' | 'maxRes', number>>;
}
export const SETS: Record<string, SetDef> = {
  runebound: { id: 'runebound', name: 'Runebound Regalia', bonus: [{ text: '+12% maximum mana or rage pool, +10% magic defense', pct: { maxRes: 0.12, mdef: 0.1 } }, { text: '+10% magic attack and attack', pct: { matk: 0.1, atk: 0.1 } }] },
  dragonscale: { id: 'dragonscale', name: 'Dragonscale Panoply', bonus: [{ text: '+10% maximum HP', pct: { maxHp: 0.1 } }, { text: '+10% attack and magic attack, +5% critical chance', pct: { atk: 0.1, matk: 0.1 }, flat: { crit: 5 } }] },
  frostbound: { id: 'frostbound', name: 'Frostbound Vestige', bonus: [{ text: '+15% defense and magic defense', pct: { def: 0.15, mdef: 0.15 } }, { text: '+6% critical chance, +15% critical damage', flat: { crit: 6, critDmg: 0.15 } }] },
  abyssal: { id: 'abyssal', name: 'Abyssal Covenant', bonus: [{ text: '3% of damage dealt returns as health', flat: { lifesteal: 3 } }, { text: '+12% attack and magic attack', pct: { atk: 0.12, matk: 0.12 } }] },
  // G6: a set from every dungeon past level 45, in the spirit of its region
  forgeborn: { id: 'forgeborn', name: 'Forgeborn Plate', bonus: [{ text: '+12% defense, +8% maximum HP', pct: { def: 0.12, maxHp: 0.08 } }, { text: '+14% attack and magic attack', pct: { atk: 0.14, matk: 0.14 } }] },
  briarwoven: { id: 'briarwoven', name: 'Briarwoven Garb', bonus: [{ text: '+6% dodge', flat: { dodge: 6 } }, { text: '+12% attack, +6% critical chance', pct: { atk: 0.12 }, flat: { crit: 6 } }] },
  rimecrown: { id: 'rimecrown', name: 'Rime Empress Regalia', bonus: [{ text: '+18% magic defense', pct: { mdef: 0.18 } }, { text: '+15% magic attack, +15% critical damage', pct: { matk: 0.15 }, flat: { critDmg: 0.15 } }] },
  drowned: { id: 'drowned', name: 'Drowned Leviathan Mail', bonus: [{ text: '+15% maximum HP', pct: { maxHp: 0.15 } }, { text: '4% of damage dealt returns as health, +10% defense', flat: { lifesteal: 4 }, pct: { def: 0.1 } }] },
  spirewarden: { id: 'spirewarden', name: 'Spirewarden Vestments', bonus: [{ text: '+15% maximum mana or rage', pct: { maxRes: 0.15 } }, { text: '+15% magic attack and attack', pct: { matk: 0.15, atk: 0.15 } }] },
  hollowking: { id: 'hollowking', name: 'Hollow King Panoply', bonus: [{ text: '+15% defense and magic defense', pct: { def: 0.15, mdef: 0.15 } }, { text: '+16% attack, +5% critical chance', pct: { atk: 0.16 }, flat: { crit: 5 } }] },
  wyrmforged: { id: 'wyrmforged', name: 'Elder Wyrmforged', bonus: [{ text: '+12% attack and magic attack', pct: { atk: 0.12, matk: 0.12 } }, { text: '+8% critical chance, +20% critical damage', flat: { crit: 8, critDmg: 0.2 } }] },
  heartroot: { id: 'heartroot', name: 'Heartroot Raiment', bonus: [{ text: '+18% maximum HP', pct: { maxHp: 0.18 } }, { text: '5% of damage dealt returns as health, +12% magic attack', flat: { lifesteal: 5 }, pct: { matk: 0.12 } }] },
  sovereign: { id: 'sovereign', name: 'Storm Sovereign Regalia', bonus: [{ text: '+8% dodge, +6% critical chance', flat: { dodge: 8, crit: 6 } }, { text: '+18% attack and magic attack', pct: { atk: 0.18, matk: 0.18 } }] },
  gladiator: { id: 'gladiator', name: "Gladiator's Regalia", bonus: [{ text: '+10% defense and magic defense', pct: { def: 0.1, mdef: 0.1 } }, { text: '+10% attack and magic attack, +5% critical chance', pct: { atk: 0.1, matk: 0.1 }, flat: { crit: 5 } }] },
  starfallen: { id: 'starfallen', name: 'Starfallen Raiment', bonus: [{ text: '+15% to every defense and +12% maximum HP', pct: { def: 0.15, mdef: 0.15, maxHp: 0.12 } }, { text: '+20% attack and magic attack, +8% critical chance', pct: { atk: 0.2, matk: 0.2 }, flat: { crit: 8 } }] },
};
export interface PassiveDef {
  id: string;
  name: string;
  text: string;
}
/** Unique passives. The effects are implemented on the server; this table is what players read. */
export const PASSIVES: Record<string, PassiveDef> = {
  runesurge: { id: 'runesurge', name: 'Runesurge', text: 'Rune spells cost 20% less.' },
  executioner: { id: 'executioner', name: 'Executioner', text: 'Deal 25% more damage to enemies below 30% health.' },
  secondwind: { id: 'secondwind', name: 'Second Wind', text: 'Falling below 25% health restores 30% of maximum health. Once every 90 seconds.' },
  thorns: { id: 'thorns', name: 'Thorns', text: 'Enemies that strike you take 20% of the damage back.' },
  giantslayer: { id: 'giantslayer', name: 'Giantslayer', text: 'Deal 15% more damage to elites and bosses.' },
  swift: { id: 'swift', name: 'Windstride', text: 'Move 8% faster.' },
  // G6
  ignite: { id: 'ignite', name: 'Ignite', text: 'Your hits have a 12% chance to set the enemy burning.' },
  bramble: { id: 'bramble', name: 'Bramble Guard', text: 'Enemies that strike you have a 20% chance to be rooted.' },
  frostbite: { id: 'frostbite', name: 'Frostbite', text: 'Your hits have a 15% chance to slow the enemy.' },
  soulreap: { id: 'soulreap', name: 'Soulreap', text: 'Every kill restores 4% of your health and of your mana or rage.' },
  riftstep: { id: 'riftstep', name: 'Riftstep', text: 'Move 10% faster and dodge 5% more often.' },
  warbanner: { id: 'warbanner', name: 'War Banner', text: 'Take 15% less damage while three or more enemies are close to you.' },
  eruption: { id: 'eruption', name: 'Eruption', text: 'Critical hits burst, striking enemies around the target for 40% of the blow.' },
  wildgrowth: { id: 'wildgrowth', name: 'Wildgrowth', text: 'Your hits heal you for 1% of your maximum health (at most once a second).' },
  stormlash: { id: 'stormlash', name: 'Stormlash', text: 'Your hits have a 10% chance to arc lightning to another enemy for 60% magic damage.' },
  nullward: { id: 'nullward', name: 'Null Ward', text: 'Once every 30 seconds, a blow against you is turned aside completely.' },
};
export const SECOND_WIND_CD_MS = 90000;
const J = (id: string, name: string, slot: Slot, rar: number, stats: Partial<Record<GearStat, Curve>>, desc: string, u: { set?: string; passive?: string }, look?: ItemBase['look']): ItemBase =>
  ({ id, name, kind: 'equip', slot, price: 40 + rar * 40, stats, desc, unique: { rar, ...u }, ...(look ? { look } : {}) });
registerItems([
  // Runebound (Ancient Rune Guardian)
  J('rb_circlet', 'Runebound Circlet', 'helmet', 3, { mdef: [4, 1], maxRes: [10, 4] }, 'Etched with seals that still hold.', { set: 'runebound' }, { helmet: 4, color: 5 }),
  J('rb_amulet', 'Runebound Pendant', 'amulet', 3, { maxRes: [12, 5], matk: [2, 0.5], atk: [2, 0.5] }, 'A shard of the vault door.', { set: 'runebound' }),
  J('rb_ring', 'Runebound Band', 'ring', 3, { maxRes: [8, 3], crit: [2, 0] }, 'It turns on the finger by itself.', { set: 'runebound' }),
  // Dragonscale (Ancient Dragon)
  J('ds_helm', 'Dragonscale Helm', 'helmet', 3, { def: [4, 1.1], maxHp: [14, 6] }, 'Warm to the touch, always.', { set: 'dragonscale' }, { helmet: 3, color: 1 }),
  J('ds_amulet', 'Dragonscale Talisman', 'amulet', 3, { maxHp: [16, 7], atk: [2, 0.5], matk: [2, 0.5] }, 'A single scale on a chain.', { set: 'dragonscale' }),
  J('ds_ring', 'Dragonscale Loop', 'ring', 3, { maxHp: [10, 4], critDmg: [0.06, 0] }, 'Cut from a talon.', { set: 'dragonscale' }),
  // Frostbound (Frost Queen)
  J('fb_crown', 'Frostbound Diadem', 'helmet', 3, { def: [3, 0.9], mdef: [4, 1.1] }, 'It never melts.', { set: 'frostbound' }, { helmet: 4, color: 3 }),
  J('fb_amulet', 'Frostbound Locket', 'amulet', 3, { def: [3, 0.8], mdef: [3, 0.8], maxHp: [8, 4] }, 'Holds a breath of winter.', { set: 'frostbound' }),
  J('fb_ring', 'Frostbound Signet', 'ring', 3, { crit: [3, 0], mdef: [2, 0.6] }, "The Queen's seal, cracked.", { set: 'frostbound' }),
  // Abyssal (Abyssal Golem, Shadow Knight)
  J('ab_hood', 'Abyssal Cowl', 'helmet', 3, { def: [3, 0.9], atk: [2, 0.4], matk: [2, 0.4] }, 'The dark inside it is deeper than it should be.', { set: 'abyssal' }, { helmet: 2, color: 9 }),
  J('ab_amulet', 'Abyssal Idol', 'amulet', 3, { atk: [3, 0.6], matk: [3, 0.6] }, 'It is heavier when you are losing.', { set: 'abyssal' }),
  J('ab_ring', 'Abyssal Coil', 'ring', 3, { atk: [2, 0.4], matk: [2, 0.4], lifesteal: [1, 0] }, 'It tightens when it tastes blood.', { set: 'abyssal' }),
  // Legendary signatures
  J('guardian_sigil', "Guardian's Sigil", 'ring', 4, { maxRes: [12, 4], matk: [3, 0.7], atk: [3, 0.7] }, 'The key that was never meant to leave the vault.', { passive: 'runesurge' }),
  J('wyrmfang', 'Wyrmfang', 'amulet', 4, { atk: [4, 0.9], matk: [4, 0.9], crit: [3, 0] }, 'It bites deepest when the prey is failing.', { passive: 'executioner' }),
  J('queens_tear', "Queen's Tear", 'ring', 4, { maxHp: [18, 8], mdef: [3, 0.8] }, 'She wept once. This is what was left.', { passive: 'secondwind' }),
  J('golem_core', 'Golem Core', 'amulet', 4, { def: [5, 1.3], maxHp: [14, 6] }, 'Still beating.', { passive: 'thorns' }),
  // Mythic relics
  J('shadowmantle', 'Shadowmantle Helm', 'helmet', 5, { def: [5, 1.3], atk: [3, 0.7], matk: [3, 0.7], maxHp: [14, 6] }, "Ser Maldrec's helm. The oath went with it.", { passive: 'giantslayer' }, { helmet: 3, color: 9 }),
  J('demon_crown', 'Crown of the Throne-Breaker', 'helmet', 5, { atk: [4, 0.9], matk: [4, 0.9], crit: [4, 0], critDmg: [0.1, 0] }, 'No king has worn it and stayed a king.', { passive: 'executioner' }, { helmet: 4, color: 1 }),
  J('heart_of_aetherion', 'Heart of Aetherion', 'amulet', 5, { maxHp: [20, 9], maxRes: [14, 5], atk: [3, 0.7], matk: [3, 0.7] }, 'A sliver of the fallen star itself.', { passive: 'secondwind' }),
  J('stormstride', 'Stormstride Band', 'ring', 5, { atk: [3, 0.7], matk: [3, 0.7], dodge: [3, 0], crit: [3, 0] }, 'The wind remembers who wore it.', { passive: 'swift' }),
  // ---------- G6: sets and signatures past level 45 ----------
  J('fg_helm', 'Forgeborn Visor', 'helmet', 3, { def: [5, 1.2], maxHp: [16, 6] }, 'Still glowing from the crucible.', { set: 'forgeborn' }, { helmet: 3, color: 10 }),
  J('fg_amulet', 'Forgeborn Cinder', 'amulet', 3, { atk: [3, 0.7], matk: [3, 0.7], maxHp: [10, 4] }, 'A coal that will not go out.', { set: 'forgeborn' }),
  J('fg_ring', 'Forgeborn Rivet', 'ring', 3, { def: [3, 0.8], atk: [2, 0.5] }, 'Pulled from the Titan\'s knee.', { set: 'forgeborn' }),
  J('bw_hood', 'Briarwoven Hood', 'helmet', 3, { def: [3, 0.8], dodge: [2, 0], atk: [2, 0.5] }, 'Thorns that only point outward.', { set: 'briarwoven' }, { helmet: 2, color: 2 }),
  J('bw_amulet', 'Briarwoven Seed', 'amulet', 3, { atk: [3, 0.7], crit: [2, 0] }, 'It is trying to grow.', { set: 'briarwoven' }),
  J('bw_ring', 'Briarwoven Loop', 'ring', 3, { dodge: [2, 0], atk: [2, 0.5] }, 'A living vine, wound once.', { set: 'briarwoven' }),
  J('rc_crown', 'Rime Empress Crown', 'helmet', 3, { mdef: [5, 1.2], matk: [3, 0.6] }, 'The first winter wore it.', { set: 'rimecrown' }, { helmet: 4, color: 6 }),
  J('rc_amulet', 'Rime Empress Brooch', 'amulet', 3, { matk: [4, 0.8], maxRes: [10, 4] }, 'Frost forms on whoever holds it.', { set: 'rimecrown' }),
  J('rc_ring', 'Rime Empress Ring', 'ring', 3, { matk: [2, 0.5], critDmg: [0.06, 0] }, 'Cold enough to burn.', { set: 'rimecrown' }),
  J('dl_helm', 'Leviathan Helm', 'helmet', 3, { def: [4, 1], maxHp: [18, 7] }, 'It still smells of the deep.', { set: 'drowned' }, { helmet: 3, color: 5 }),
  J('dl_amulet', 'Leviathan Pearl', 'amulet', 3, { maxHp: [16, 7], mdef: [3, 0.7] }, 'It glows when the tide turns.', { set: 'drowned' }),
  J('dl_ring', 'Leviathan Scale Ring', 'ring', 3, { maxHp: [10, 4], lifesteal: [1, 0] }, 'A scale the size of a coin.', { set: 'drowned' }),
  J('sw_circlet', 'Spirewarden Circlet', 'helmet', 3, { mdef: [4, 1], maxRes: [12, 4] }, 'Inscribed with the first sentence, half erased.', { set: 'spirewarden' }, { helmet: 4, color: 3 }),
  J('sw_amulet', 'Spirewarden Lens', 'amulet', 3, { matk: [3, 0.8], atk: [3, 0.8] }, 'Through it, the rift looks closer.', { set: 'spirewarden' }),
  J('sw_ring', 'Spirewarden Seal', 'ring', 3, { maxRes: [8, 3], crit: [2, 0] }, 'A stone from the shattered spire.', { set: 'spirewarden' }),
  J('hk_crown', 'Hollow Crown', 'helmet', 3, { def: [4, 1.1], mdef: [4, 1.1] }, 'Nobody abdicates while wearing it.', { set: 'hollowking' }, { helmet: 4, color: 4 }),
  J('hk_amulet', 'Hollow King Medal', 'amulet', 3, { atk: [4, 0.9], def: [2, 0.5] }, 'For service to a kingdom that is gone.', { set: 'hollowking' }),
  J('hk_ring', 'Hollow King Signet', 'ring', 3, { atk: [2, 0.6], crit: [2, 0] }, 'It seals letters no one will read.', { set: 'hollowking' }),
  J('ew_helm', 'Wyrmforged Helm', 'helmet', 3, { def: [4, 1], atk: [3, 0.6], matk: [3, 0.6] }, 'Hammered on the wyrm mother\'s heat.', { set: 'wyrmforged' }, { helmet: 3, color: 0 }),
  J('ew_amulet', 'Wyrmforged Fang', 'amulet', 3, { atk: [3, 0.8], matk: [3, 0.8], critDmg: [0.06, 0] }, 'Older than the dragon it came from.', { set: 'wyrmforged' }),
  J('ew_ring', 'Wyrmforged Coil', 'ring', 3, { crit: [3, 0], atk: [2, 0.5] }, 'It tightens before you strike.', { set: 'wyrmforged' }),
  J('hr_circlet', 'Heartroot Circlet', 'helmet', 3, { maxHp: [16, 7], mdef: [3, 0.8] }, 'A ring of living wood.', { set: 'heartroot' }, { helmet: 4, color: 2 }),
  J('hr_amulet', 'Heartroot Acorn', 'amulet', 3, { maxHp: [14, 6], matk: [3, 0.7] }, 'It counts the years for you.', { set: 'heartroot' }),
  J('hr_ring', 'Heartroot Band', 'ring', 3, { maxHp: [10, 4], lifesteal: [1, 0] }, 'Sap still runs in it.', { set: 'heartroot' }),
  J('ss_helm', 'Sovereign Stormhelm', 'helmet', 3, { def: [3, 0.8], dodge: [2, 0], atk: [2, 0.5] }, 'Lightning comes to it like a dog to a whistle.', { set: 'sovereign' }, { helmet: 3, color: 1 }),
  J('ss_amulet', 'Sovereign Stormglass', 'amulet', 3, { atk: [3, 0.8], matk: [3, 0.8], crit: [2, 0] }, 'A storm in a bottle, still turning.', { set: 'sovereign' }),
  J('ss_ring', 'Sovereign Gale Ring', 'ring', 3, { dodge: [2, 0], crit: [2, 0] }, 'It hums in the wind.', { set: 'sovereign' }),
  J('sf_crown', 'Starfallen Crown', 'helmet', 3, { def: [4, 1.1], mdef: [4, 1.1], maxHp: [12, 5] }, 'Made from what the star left behind.', { set: 'starfallen' }, { helmet: 4, color: 7 }),
  J('sf_amulet', 'Starfallen Shard', 'amulet', 3, { atk: [4, 0.9], matk: [4, 0.9] }, 'Warm, and very old.', { set: 'starfallen' }),
  J('sf_ring', 'Starfallen Halo', 'ring', 3, { crit: [3, 0], maxHp: [10, 4] }, 'A ring of light that does not fade.', { set: 'starfallen' }),
  // signatures (legendary) and relics (mythic)
  J('titans_ember', "Titan's Ember", 'amulet', 4, { atk: [4, 0.9], matk: [4, 0.9], maxHp: [12, 5] }, 'The forge burned for a hundred years on this.', { passive: 'ignite' }),
  J('thorn_crown', 'Crown of Thorns', 'helmet', 5, { def: [5, 1.3], maxHp: [16, 7], atk: [3, 0.7] }, 'The Thorn King did not take it off. You will see why.', { passive: 'bramble' }, { helmet: 4, color: 2 }),
  J('rime_tear', 'Rime Tear', 'ring', 4, { matk: [4, 0.9], critDmg: [0.08, 0] }, 'The first winter wept once, too.', { passive: 'frostbite' }),
  J('lich_phylactery', "Lich's Phylactery", 'amulet', 5, { maxHp: [18, 8], matk: [4, 0.9], atk: [4, 0.9] }, 'It holds a life. Not yours.', { passive: 'soulreap' }),
  J('spire_shard', 'Spire Shard', 'ring', 4, { atk: [3, 0.8], matk: [3, 0.8], dodge: [3, 0] }, 'Where the Runewrights first called the star from.', { passive: 'riftstep' }),
  J('tyrant_banner', "Tyrant's Banner", 'amulet', 5, { def: [5, 1.3], atk: [4, 0.9], maxHp: [14, 6] }, 'The Dragon Tyrant flew it over every burned city.', { passive: 'warbanner' }),
  J('wyrm_heart', 'Wyrm Mother\'s Heart', 'amulet', 4, { atk: [4, 1], matk: [4, 1], crit: [3, 0] }, 'It never slept. It never will.', { passive: 'eruption' }),
  J('wild_god_antler', "Wild God's Antler", 'helmet', 5, { maxHp: [20, 9], matk: [4, 0.9], mdef: [4, 1] }, 'The forest kept count of everything. This was the tally.', { passive: 'wildgrowth' }, { helmet: 5, color: 2 }),
  J('sovereign_eye', "Sovereign's Eye", 'ring', 4, { atk: [3, 0.8], matk: [3, 0.8], crit: [3, 0] }, 'The calm at the centre of the storm.', { passive: 'stormlash' }),
  // G8: bought with honour from the Arena Master
  J('gl_helm', "Gladiator's Helm", 'helmet', 3, { def: [4, 1], atk: [2, 0.6], matk: [2, 0.6] }, 'Dented in a hundred bouts.', { set: 'gladiator' }, { helmet: 3, color: 4 }),
  J('gl_amulet', "Gladiator's Token", 'amulet', 3, { atk: [3, 0.7], matk: [3, 0.7], maxHp: [8, 4] }, 'Given to whoever is still standing.', { set: 'gladiator' }),
  J('gl_ring', "Gladiator's Band", 'ring', 3, { crit: [2, 0], dodge: [2, 0] }, 'The crowd remembers the name on it.', { set: 'gladiator' }),
  J('conquerors_medal', "Conqueror's Medal", 'amulet', 4, { atk: [4, 0.9], matk: [4, 0.9], def: [3, 0.8] }, 'Earned, never bought. Well, almost never.', { passive: 'warbanner' }),
  J('unmade_star', 'The Unmade Star', 'amulet', 5, { maxHp: [22, 10], atk: [5, 1.1], matk: [5, 1.1], def: [4, 1] }, 'What the Unmaker could not unmake.', { passive: 'nullward' }),
]);
/** What each boss can drop besides ordinary gear. */
export const BOSS_UNIQUES: Record<string, string[]> = {
  rune_guardian: ['rb_circlet', 'rb_amulet', 'rb_ring', 'guardian_sigil', 'heart_of_aetherion'],
  ancient_dragon: ['ds_helm', 'ds_amulet', 'ds_ring', 'wyrmfang', 'heart_of_aetherion'],
  frost_queen: ['fb_crown', 'fb_amulet', 'fb_ring', 'queens_tear', 'stormstride'],
  abyssal_golem: ['ab_hood', 'ab_amulet', 'ab_ring', 'golem_core', 'heart_of_aetherion'],
  shadow_knight: ['ab_hood', 'ab_amulet', 'ab_ring', 'queens_tear', 'golem_core', 'shadowmantle', 'stormstride'],
  demon_lord: ['ds_helm', 'ds_amulet', 'ds_ring', 'rb_circlet', 'rb_amulet', 'rb_ring', 'wyrmfang', 'guardian_sigil', 'demon_crown', 'heart_of_aetherion'],
  // G7: the raid bosses beside the Shadow
  raid_briar: ['bw_hood', 'bw_amulet', 'bw_ring', 'thorn_crown', 'wild_god_antler'],
  raid_tyrant: ['hk_crown', 'hk_amulet', 'hk_ring', 'tyrant_banner', 'wyrm_heart'],
  raid_unmaker: ['sf_crown', 'sf_amulet', 'sf_ring', 'unmade_star', 'lich_phylactery'],
  // G6: the dungeon bosses and world bosses past level 45
  forgeborn_titan: ['fg_helm', 'fg_amulet', 'fg_ring', 'titans_ember'],
  verdant_colossus: ['bw_hood', 'bw_amulet', 'bw_ring', 'titans_ember'],
  thorn_king: ['bw_hood', 'bw_amulet', 'bw_ring', 'thorn_crown'],
  rime_empress: ['rc_crown', 'rc_amulet', 'rc_ring', 'rime_tear'],
  bog_leviathan: ['dl_helm', 'dl_amulet', 'dl_ring', 'rime_tear'],
  lich_regent: ['dl_helm', 'dl_amulet', 'dl_ring', 'lich_phylactery'],
  spire_warden: ['sw_circlet', 'sw_amulet', 'sw_ring', 'spire_shard'],
  hollow_king: ['hk_crown', 'hk_amulet', 'hk_ring', 'spire_shard'],
  dragon_tyrant: ['hk_crown', 'hk_amulet', 'hk_ring', 'tyrant_banner'],
  elder_wyrm: ['ew_helm', 'ew_amulet', 'ew_ring', 'wyrm_heart'],
  heartroot_guardian: ['hr_circlet', 'hr_amulet', 'hr_ring', 'wyrm_heart'],
  wild_god: ['hr_circlet', 'hr_amulet', 'hr_ring', 'wild_god_antler'],
  storm_sovereign: ['ss_helm', 'ss_amulet', 'ss_ring', 'sovereign_eye'],
  star_devourer: ['sf_crown', 'sf_amulet', 'sf_ring', 'sovereign_eye', 'unmade_star'],
  the_unmaker: ['sf_crown', 'sf_amulet', 'sf_ring', 'unmade_star'],
};
/** Rarity weights [Epic, Legendary, Mythic] of a boss drop. Mythic is always possible and never certain. */
export const BOSS_RARITY: Record<'normal' | 'hard' | 'nightmare' | 'armageddon' | 'world' | 'raid', [number, number, number]> = {
  normal: [80, 18.5, 1.5], hard: [68, 28.5, 3.5], nightmare: [55, 38.5, 6.5], armageddon: [30, 48, 22], world: [66, 30, 4], raid: [15, 50, 35],
};
/** One guaranteed boss drop for one player: a unique of the rolled rarity half of the time, else top-rarity gear for their job. */
export function rollBossItem(rng: () => number, boss: string, level: number, job: Job, tier: keyof typeof BOSS_RARITY): ItemSpec {
  const w = BOSS_RARITY[tier], rar = 3 + pickRarity(rng, w);
  const uniques = (BOSS_UNIQUES[boss] ?? []).filter((id) => ITEMS[id].unique!.rar === rar);
  if (uniques.length && rng() < 0.5) return rollItem(rng, uniques[Math.floor(rng() * uniques.length)], level, rar);
  const pool = ITEM_LIST.filter((b) => b.kind === 'equip' && !b.unique && usableBy(b, job));
  return rollItem(rng, pool[Math.floor(rng() * pool.length)].id, level + 1, rar);
}

export interface GearSummary {
  sets: { id: string; n: number }[];
  passives: string[];
}
/** Applies everything equipment does to a stat block: item stats (main stats boosted per slot by `boost`), set bonuses, then stat-changing passives. */
export function applyGear(s: Stats, eq: Equipment, boost: Partial<Record<Slot, number>> = {}): GearSummary {
  addGear(s, gearStats(eq, boost));
  const count: Record<string, number> = {}, passives: string[] = [];
  for (const sl of SLOTS) {
    const u = eq[sl] && ITEMS[eq[sl]!.base]?.unique;
    if (!u) continue;
    if (u.set) count[u.set] = (count[u.set] ?? 0) + 1;
    if (u.passive && !passives.includes(u.passive)) passives.push(u.passive);
  }
  const sets = Object.entries(count).map(([id, n]) => ({ id, n }));
  for (const { id, n } of sets)
    for (let i = 0; i < 2; i++) {
      if (n < i + 2) continue;
      const b = SETS[id].bonus[i];
      if (b.flat) addGear(s, b.flat);
      for (const [k, v] of Object.entries(b.pct ?? {})) (s as any)[k] = Math.round((s as any)[k] * (1 + v!));
    }
  if (passives.includes('runesurge')) s.runeCost = Math.round(s.runeCost * 0.8 * 100) / 100;
  if (passives.includes('swift')) s.moveMul = Math.round(s.moveMul * 1.08 * 1000) / 1000;
  if (passives.includes('riftstep')) { s.moveMul = Math.round(s.moveMul * 1.1 * 1000) / 1000; s.dodge += 5; }
  return { sets, passives };
}
