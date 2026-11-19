// Skill, status, weapon-attack and rune icons (M12). Every icon is original and drawn in code
// from vector shapes on a 64x64 canvas, in one visual language: a framed tile tinted by element
// or class, a bold outlined symbol, a soft highlight. Each ability has its own symbol; none is
// an emoji, a letter or a shared placeholder. Icons can be replaced one by one through the
// asset pipeline (type "icon" in assets/game/manifest.json) without touching this file.
import { ABILITIES, ABILITY_LIST, ELEMENT_COLORS, ELEMENTS, type Element } from '../../../shared/src/abilities';
import { STATUS } from '../../../shared/src/combat';
import { JOB_DEFS, type WeaponKind } from '../../../shared/src/jobs';
import { JOBS, type Job } from '../../../shared/src/protocol';

export const ICON_SIZE = 64;
export type IconKind = 'skill' | 'passive' | 'status' | 'attack' | 'rune';
export interface IconEntry {
  /** Asset id, e.g. "skill/fireball". */
  id: string;
  kind: IconKind;
  /** The skill, status, weapon kind or element it belongs to. */
  ref: string;
  name: string;
  file: string;
  width: number;
  height: number;
}

// ---- shapes (SVG path data in a 64x64 box) ----
const S = {
  flame: 'M32 6C40 18 51 25 47 42C45 52 37 58 32 58C21 58 15 49 17 39C18 32 24 30 24 23C28 27 30 30 30 22C30 15 30 11 32 6Z',
  ember: 'M32 28C37 34 41 40 38 48C35 53 28 53 26 48C24 42 30 38 32 28Z',
  orb: 'M32 13A19 19 0 1 0 32.01 13Z',
  dot: 'M32 24A8 8 0 1 0 32.01 24Z',
  drop: 'M32 6C40 21 49 30 49 41A17 17 0 0 1 15 41C15 30 24 21 32 6Z',
  bolt: 'M37 4L17 35L30 35L23 60L47 26L34 26Z',
  shard: 'M32 3L41 30L35 61L29 61L23 30Z',
  rock: 'M16 41L23 23L39 18L50 30L47 47L29 52Z',
  crescent: 'M46 9A27 27 0 1 0 46 55A21 21 0 1 1 46 9Z',
  shield: 'M32 6L53 15L51 36C49 47 41 55 32 59C23 55 15 47 13 36L11 15Z',
  sword: 'M30 4L34 4L36 40L45 40L45 45L36 45L35 59L29 59L28 45L19 45L19 40L28 40Z',
  blade: 'M30 4L34 4L37 44L27 44Z',
  arrow: 'M32 3L43 18L35 18L35 49L41 59L32 54L23 59L29 49L29 18L21 18Z',
  plus: 'M25 11H39V25H53V39H39V53H25V39H11V25H25Z',
  star: 'M32 4L38 26L60 32L38 38L32 60L26 38L4 32L26 26Z',
  eye: 'M4 32C17 12 47 12 60 32C47 52 17 52 4 32Z',
  axe: 'M28 5H34V59H28ZM34 9C51 9 58 22 55 36C47 31 41 31 34 33Z',
  dagger: 'M32 4L39 34L45 36L45 41L35 41L34 59L30 59L29 41L19 41L19 36L25 34Z',
  jaws: 'M6 45L13 27L20 45L26 27L32 45L38 27L44 45L51 27L58 45L58 54L6 54Z',
  cloud: 'M17 35A11 11 0 0 1 27 21A13 13 0 0 1 49 25A10 10 0 0 1 49 44H17A9 9 0 0 1 17 35Z',
  horn: 'M8 27C25 23 45 18 58 6C56 28 45 46 24 46C15 46 8 38 8 27Z',
  chevron: 'M10 14L30 32L10 50L20 50L40 32L20 14Z',
  hex: 'M32 5L55 18.5L55 45.5L32 59L9 45.5L9 18.5Z',
  mace: 'M29 30H35V59H29ZM32 5L38 11L46 10L44 18L50 23L44 28L45 36L37 34L32 40L27 34L19 36L20 28L14 23L20 18L18 10L26 11Z',
  staff: 'M30 20H34V60H30ZM32 4L41 13L32 22L23 13Z',
  bow: 'M20 5C44 14 44 50 20 59L24 55C40 46 40 18 24 9Z',
  wing: 'M32 50C20 44 8 30 8 12C16 22 24 24 32 26C40 24 48 22 56 12C56 30 44 44 32 50Z',
  fang: 'M22 8L30 8L28 50L24 58L20 50ZM36 8L44 8L46 50L42 58L38 50Z',
  bomb: 'M30 22A17 17 0 1 0 30.01 22ZM28 22L28 14L36 14L36 22ZM36 14C40 6 46 6 50 10',
  fist: 'M18 24H46V30H50V44C50 52 44 58 36 58H26C20 58 16 54 16 48V36H18Z',
  figure: 'M32 10A7 7 0 1 0 32.01 10ZM22 28H42L46 46H38V60H26V46H18Z',
  wave: 'M6 38C14 26 22 26 30 38C38 50 46 50 58 34L58 46C46 60 38 60 30 48C22 38 14 38 6 50Z',
  ringA: 'M32 8A24 24 0 1 0 32.01 8Z',
  slash: 'M52 6L58 12L16 58L6 58L6 48Z',
  crack: 'M30 4L36 18L28 26L38 36L30 46L36 60L28 60L22 46L30 36L20 26L26 16Z',
  spiral: 'M32 32C32 24 44 24 44 34C44 46 26 48 22 36C18 22 36 12 48 20',
};
type Layer = [shape: keyof typeof S, fill: string, dx?: number, dy?: number, rot?: number, scale?: number, stroke?: number];
interface IconDef {
  bg: string;
  layers: Layer[];
}
const W = '#fff7e0', K = '#17121f';
const EL = ELEMENT_COLORS as Record<string, string>;
const JOBC: Record<Job, string> = { knight: '#7f9ccc', mage: '#9a7ee0', ranger: '#7fb86a', assassin: '#8a6ab0', cleric: '#e6c96a', berserker: '#d8604a' };

/** Hand-made icon for every active ability. */
const SKILL: Record<string, IconDef> = {
  // ---- fire ----
  fireball: { bg: EL.fire, layers: [['orb', '#ff8a3a', -6, 6, 0, 0.8], ['flame', '#ffd24a', 12, -12, 40, 0.55], ['dot', W, -6, 6, 0, 0.9]] },
  flame_burst: { bg: EL.fire, layers: [['flame', '#ff5a2a', 0, 0, 0, 0.95], ['flame', '#ff8a3a', -18, 8, -28, 0.55], ['flame', '#ff8a3a', 18, 8, 28, 0.55], ['ember', '#ffe08a']] },
  meteor_strike: { bg: EL.fire, layers: [['slash', '#ffd24a', 6, -8, 0, 0.9], ['rock', '#8a5a3a', -10, 12, 20, 0.85], ['ember', '#ff8a3a', -12, 6, 0, 0.6]] },
  // ---- water ----
  water_bolt: { bg: EL.water, layers: [['drop', '#4fa8f0', 4, -2, 45, 0.9], ['dot', W, 0, 8, 0, 0.6], ['chevron', '#bfe4ff', -22, 18, 135, 0.35]] },
  healing_rain: { bg: '#49b8c8', layers: [['cloud', '#e8fbff', 0, -12, 0, 0.9], ['drop', '#6fd6e8', -14, 18, 0, 0.3], ['drop', '#6fd6e8', 14, 18, 0, 0.3], ['plus', '#7be08a', 0, 16, 0, 0.36]] },
  ice_spear: { bg: '#7cc4e8', layers: [['shard', '#e8fbff', 0, 0, 45, 1], ['shard', '#9fd8ff', -14, 14, 45, 0.45], ['star', W, 16, -16, 0, 0.28]] },
  // ---- lightning ----
  thunder_strike: { bg: EL.lightning, layers: [['cloud', '#5a5470', 0, -16, 0, 0.8], ['bolt', '#fff06a', 0, 8, 0, 0.85]] },
  chain_lightning: { bg: EL.lightning, layers: [['bolt', '#fff06a', -14, -6, -30, 0.6], ['bolt', '#fff06a', 12, 8, 150, 0.6], ['dot', W, -20, 16, 0, 0.7], ['dot', W, 20, -16, 0, 0.7]] },
  // ---- earth ----
  stone_shield: { bg: EL.earth, layers: [['shield', '#b08a50'], ['rock', '#7a5f38', 0, 2, 0, 0.6], ['dot', '#e8d4a0', -12, -14, 0, 0.5]] },
  earthquake: { bg: EL.earth, layers: [['rock', '#7a5f38', -14, 8, -10, 0.7], ['rock', '#8f7046', 14, 8, 30, 0.7], ['crack', '#2a1e12', 0, 0, 0, 0.95]] },
  // ---- wind ----
  wind_slash: { bg: EL.wind, layers: [['crescent', '#e4fff0', 6, 0, 0, 0.9], ['crescent', '#8fe0b0', -10, 0, 0, 0.6]] },
  tornado: { bg: EL.wind, layers: [['wave', '#e4fff0', 0, -18, 0, 0.9], ['wave', '#b8f0d0', 0, 0, 0, 0.66], ['wave', '#8fe0b0', 0, 16, 0, 0.42]] },
  // ---- knight ----
  shield_bash: { bg: JOBC.knight, layers: [['shield', '#c8d0da', -6, 0, -14, 0.85], ['star', '#ffd24a', 18, -14, 0, 0.42]] },
  taunt: { bg: '#c0483a', layers: [['horn', '#f0d9a0', 0, 2, 0, 0.9], ['chevron', W, 20, -18, -45, 0.3], ['chevron', W, 24, 6, 0, 0.3]] },
  guard_stance: { bg: JOBC.knight, layers: [['shield', '#7fb4ff'], ['plus', W, 0, -2, 0, 0.42]] },
  cleave: { bg: JOBC.knight, layers: [['crescent', '#f4f8fb', 4, 0, 180, 0.95], ['sword', '#c8d0da', -6, 0, -40, 0.8]] },
  rallying_cry: { bg: '#c9a24a', layers: [['horn', '#fff0b0', -4, 4, 0, 0.8], ['star', W, 18, -18, 0, 0.3], ['star', W, 22, 8, 0, 0.22]] },
  last_stand: { bg: '#b8742a', layers: [['shield', '#ffb347'], ['sword', '#fff0d0', 0, 0, 0, 0.72], ['ringA', '#ffe08a', 0, 0, 0, 1.12, 3]] },
  // ---- mage ----
  arcane_bolt: { bg: JOBC.mage, layers: [['star', '#d8c8ff', 6, -6, 20, 0.8], ['dot', W, 6, -6, 0, 0.9], ['chevron', '#b9a2ff', -20, 20, 135, 0.4]] },
  blink: { bg: JOBC.mage, layers: [['figure', '#5a4a8a', -14, 0, 0, 0.6], ['figure', '#e8deff', 14, 0, 0, 0.6], ['chevron', W, 0, 0, 0, 0.3]] },
  elemental_surge: { bg: '#c8703a', layers: [['star', '#ff9a5a', 0, 0, 45, 1], ['star', '#fff0b0', 0, 0, 0, 0.6], ['dot', W]] },
  mana_shield: { bg: '#4a78c8', layers: [['ringA', '#bfe0ff', 0, 0, 0, 1, 4], ['orb', '#6fb4ff', 0, 0, 0, 0.9], ['shield', '#e8f4ff', 0, 0, 0, 0.5]] },
  cataclysm: { bg: '#7a3ad0', layers: [['ringA', '#ffd0ff', 0, 0, 0, 1.05, 4], ['star', '#d07aff', 0, 0, 22, 1], ['flame', '#fff0ff', 0, 2, 0, 0.5]] },
  // ---- ultimates (level 70 paths): a gold frame ring over the motif ----
  ult_divine_judgment: { bg: '#c9a24a', layers: [['ringA', '#fff0a8', 0, 0, 0, 1.08, 4], ['sword', W, 0, 0, 0, 0.9], ['star', '#fff6c8', 0, -14, 0, 0.45]] },
  ult_war_banner: { bg: '#b8862a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['staff', '#5a3a1a', -4, 4, 0, 0.95], ['wing', '#e2523f', 8, -8, 0, 0.6]] },
  ult_astral_storm: { bg: '#4a3a9a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['star', '#e8dcff', -10, -8, 0, 0.55], ['star', '#b9a2ff', 10, 6, 20, 0.45], ['star', '#fff0b0', -4, 14, 40, 0.35]] },
  ult_time_stop: { bg: '#2a5a8a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['spiral', '#9fe8ff', 0, 0, 0, 0.9, 4], ['dot', W, 0, 0, 0, 0.5]] },
  ult_stampede: { bg: '#7a5a2a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['horn', '#e8d0a0', -8, 0, -20, 0.8], ['horn', '#c8a46a', 10, 4, 20, 0.7]] },
  ult_deadeye: { bg: '#3a5a3a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['eye', '#ffe08a', 0, 0, 0, 0.85], ['arrow', W, 0, 0, 45, 0.7]] },
  ult_shadow_legion: { bg: '#2a1d55', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['figure', '#6a5aa8', -12, 4, 0, 0.6], ['figure', '#8a7ac8', 0, 0, 0, 0.7], ['figure', '#6a5aa8', 12, 4, 0, 0.6]] },
  ult_plague_burst: { bg: '#3a5a2a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['drop', '#9be06a', 0, 0, 0, 0.8], ['cloud', '#c8f08a', 0, 12, 0, 0.6]] },
  ult_prophecy: { bg: '#c8b46a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['eye', W, 0, -4, 0, 0.8], ['wing', '#fff6c8', 0, 12, 0, 0.6]] },
  ult_holy_fire: { bg: '#c87a2a', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['flame', '#ffd27a', 0, 0, 0, 0.9], ['plus', W, 0, 6, 0, 0.45]] },
  ult_warpath: { bg: '#8a1a14', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['axe', '#e8e0d0', -8, 0, -30, 0.75], ['axe', '#e8e0d0', 8, 0, 30, 0.75]] },
  ult_blood_moon: { bg: '#5a0a14', layers: [['ringA', '#ffd24a', 0, 0, 0, 1.08, 4], ['crescent', '#c8102e', 0, 0, 0, 0.9], ['drop', '#ff4a5a', 8, 10, 0, 0.4]] },
  // ---- rune fusions (level 90): two elements in one icon ----
  fu_steam: { bg: '#5a8aa8', layers: [['cloud', '#e8f0f0', 0, 0, 0, 0.9], ['flame', '#ff8a3a', -10, 12, 0, 0.45], ['drop', '#4fa8f0', 12, 12, 0, 0.4]] },
  fu_plasma: { bg: '#8a4ac8', layers: [['bolt', '#fff0ff', 0, 0, 0, 0.95], ['flame', '#ff8a3a', 10, 10, 30, 0.4]] },
  fu_magma: { bg: '#8a3a1a', layers: [['rock', '#5a3a2a', 0, 6, 0, 0.9], ['flame', '#ff6a2a', 0, -8, 0, 0.6], ['ember', '#ffd24a']] },
  fu_firestorm: { bg: '#c85a1a', layers: [['spiral', '#ffd24a', 0, 0, 0, 0.9, 4], ['flame', '#ff5a2a', 0, 0, 0, 0.5]] },
  fu_storm_surge: { bg: '#2a6a9a', layers: [['wave', '#7fd6ff', 0, 8, 0, 0.9], ['bolt', '#f4e04a', 0, -6, 0, 0.6]] },
  fu_mudslide: { bg: '#6a5a3a', layers: [['wave', '#8a6a3a', 0, 4, 0, 0.95], ['rock', '#b08a50', 10, -10, 0, 0.4]] },
  fu_blizzard: { bg: '#5a8ab8', layers: [['shard', '#e0f4ff', -8, -4, 0, 0.6], ['shard', '#c8e8ff', 8, 6, 40, 0.55], ['spiral', '#ffffff', 0, 0, 0, 0.7, 3]] },
  fu_magnetism: { bg: '#4a4a8a', layers: [['ringA', '#c8c0ff', 0, 0, 0, 0.9, 4], ['bolt', '#f4e04a', 0, 0, 0, 0.55], ['rock', '#b08a50', 0, 14, 0, 0.35]] },
  fu_tempest: { bg: '#4a8a7a', layers: [['spiral', '#b8f0d0', 0, 0, 0, 0.9, 3], ['bolt', '#f4f8a0', 0, 0, 20, 0.6]] },
  fu_sandstorm: { bg: '#a8884a', layers: [['spiral', '#e8d0a0', 0, 0, 0, 0.95, 4], ['dot', '#fff0c8', 10, -10, 0, 0.4], ['dot', '#fff0c8', -12, 8, 0, 0.3]] },
  // ---- ranger ----
  power_shot: { bg: JOBC.ranger, layers: [['arrow', '#f4f0e2', 0, 0, 45, 1.05], ['star', '#ffd24a', 15, -15, 0, 0.3]] },
  snare_trap: { bg: '#8a6a3c', layers: [['jaws', '#d5d9e0', 0, -4, 0, 0.9], ['ringA', '#a8743c', 0, 16, 0, 0.5, 4]] },
  poison_arrow: { bg: '#5f9a3a', layers: [['arrow', '#e9e3d0', -4, 4, 45, 0.95], ['drop', '#9be06a', 16, -14, 0, 0.36]] },
  explosive_trap: { bg: '#b0483a', layers: [['jaws', '#d5d9e0', 0, 8, 0, 0.8], ['flame', '#ffd24a', 0, -14, 0, 0.5]] },
  fleet_step: { bg: JOBC.ranger, layers: [['chevron', '#e8ffd8', -12, 0, 180, 0.7], ['chevron', '#9be06a', 8, 0, 180, 0.7], ['wing', W, 14, -18, 0, 0.3]] },
  volley: { bg: JOBC.ranger, layers: [['arrow', '#e9e3d0', -16, 2, 180, 0.6], ['arrow', '#f4f0e2', 0, -4, 180, 0.72], ['arrow', '#e9e3d0', 16, 2, 180, 0.6]] },
  hunters_mark: { bg: '#b03a3a', layers: [['ringA', '#ffd0c8', 0, 0, 0, 1, 4], ['ringA', '#ff5a4a', 0, 0, 0, 0.55, 4], ['plus', W, 0, 0, 0, 0.9]] },
  // ---- assassin ----
  backstab: { bg: JOBC.assassin, layers: [['figure', '#3a2f52', -8, 2, 0, 0.8], ['dagger', '#e8deff', 14, -4, 150, 0.7]] },
  stealth: { bg: '#4a4660', layers: [['eye', '#b8b2c4', 0, 0, 0, 0.9], ['dot', '#2a2438', 0, 0, 0, 1.1], ['slash', '#d0c0ff', 0, 0, 0, 1]] },
  shadow_step: { bg: '#4a3a8a', layers: [['figure', '#2a2048', 10, 0, 0, 0.7], ['chevron', '#b8a0ff', -18, 0, 0, 0.5], ['chevron', '#8a6ad8', -30, 0, 0, 0.4]] },
  twin_fangs: { bg: '#5f8a4a', layers: [['dagger', '#e8ffe0', -11, 0, -20, 0.85], ['dagger', '#e8ffe0', 11, 0, 20, 0.85], ['drop', '#9be06a', 0, 22, 0, 0.26]] },
  smoke_bomb: { bg: '#6a6478', layers: [['cloud', '#d8d4e4', 0, -10, 0, 0.9], ['bomb', '#2e2a3a', 0, 12, 0, 0.7]] },
  death_mark: { bg: '#7a2aa0', layers: [['eye', '#f0d0ff', 0, 0, 0, 0.95], ['shard', '#b03ad0', 0, 0, 0, 0.6], ['ringA', '#f0d0ff', 0, 0, 0, 1.1, 3]] },
  // ---- cleric ----
  mend: { bg: '#4aa862', layers: [['plus', '#e8ffe8', 0, 0, 0, 1], ['drop', '#7be08a', 0, 2, 0, 0.36]] },
  smite: { bg: JOBC.cleric, layers: [['bolt', '#fffbe0', 0, -2, 180, 0.9], ['star', '#fff3b8', 0, 22, 0, 0.42]] },
  blessing: { bg: JOBC.cleric, layers: [['wing', '#fffbe0', 0, 6, 0, 0.95], ['plus', '#fff3b8', 0, -16, 0, 0.36]] },
  purify: { bg: '#78c4d8', layers: [['drop', '#e8fbff'], ['star', W, 0, 6, 0, 0.42], ['wave', '#c8f0ff', 0, 24, 0, 0.5]] },
  sanctuary: { bg: '#c9a24a', layers: [['ringA', '#ffe89a', 0, 4, 0, 1, 4], ['figure', '#fff8d0', 0, 4, 0, 0.6], ['plus', W, 0, -22, 0, 0.26]] },
  resurrection: { bg: '#d8c070', layers: [['figure', '#fffbe0', 0, 6, 0, 0.75], ['wing', '#fff3b8', 0, -12, 0, 0.8], ['ringA', W, 0, -22, 0, 0.3, 3]] },
  divine_aegis: { bg: '#e8e0c0', layers: [['shield', '#ffffff'], ['star', '#ffe89a', 0, -2, 0, 0.6], ['ringA', '#ffe89a', 0, 0, 0, 1.12, 3]] },
  // ---- berserker ----
  rend: { bg: JOBC.berserker, layers: [['slash', '#f4f0e8', -8, 0, 0, 0.8], ['slash', '#f4f0e8', 8, 0, 0, 0.8], ['drop', '#e2523f', 14, 18, 0, 0.3]] },
  war_cry: { bg: '#c8483a', layers: [['fist', '#f0c8a0', 0, 2, 0, 0.9], ['chevron', '#ffd24a', -22, -20, -90, 0.3], ['chevron', '#ffd24a', 14, -20, -90, 0.3]] },
  whirlwind: { bg: JOBC.berserker, layers: [['spiral', '#f4f8fb', 0, 0, 0, 1.25, 6], ['axe', '#e8e0d8', 0, 0, 35, 0.62]] },
  charge: { bg: '#b8603a', layers: [['chevron', '#ffe0c0', -12, 0, 0, 0.75], ['chevron', '#ff8a5a', 6, 0, 0, 0.75], ['star', W, 22, 0, 0, 0.3]] },
  frenzy: { bg: '#a8281c', layers: [['eye', '#ffd0c8', 0, 0, 0, 0.95], ['flame', '#ff3a2a', 0, 0, 0, 0.55], ['dot', K, 0, 4, 0, 0.5]] },
  executioner: { bg: '#701c18', layers: [['axe', '#e8e0d8', 0, 0, 0, 1], ['drop', '#ff3a2a', 16, 20, 0, 0.3]] },
};

/** Status effects (buffs and debuffs shown as chips on the HUD). */
const STATUS_ICON: Record<string, IconDef> = {
  poison: { bg: '#4c7a2c', layers: [['drop', '#9be06a'], ['dot', K, -6, 8, 0, 0.5], ['dot', K, 7, 14, 0, 0.36]] },
  slow: { bg: '#4a7890', layers: [['chevron', '#c8f0ff', 0, -12, 90, 0.6], ['chevron', '#9fd8ff', 0, 10, 90, 0.6]] },
  stun: { bg: '#a88a2a', layers: [['star', '#fff06a', -12, -8, 0, 0.5], ['star', '#fff06a', 14, -2, 20, 0.4], ['star', '#fff06a', -2, 16, 40, 0.34]] },
  weaken: { bg: '#6a5a7a', layers: [['blade', '#c8d0da', -8, -8, -20, 0.7], ['blade', '#8a94a4', 10, 16, 160, 0.5], ['crack', K, 0, 0, 70, 0.5]] },
  bleed: { bg: '#8a2018', layers: [['drop', '#e2523f', -10, -6, 0, 0.6], ['drop', '#e2523f', 12, 10, 0, 0.45]] },
  enrage: { bg: '#b0281c', layers: [['flame', '#ff5a2a'], ['eye', '#ffd0c8', 0, 6, 0, 0.5], ['dot', K, 0, 6, 0, 0.4]] },
  ward: { bg: '#3a7a5a', layers: [['shield', '#cdf5d2'], ['wing', '#4f9a5a', 0, 2, 0, 0.5]] },
  burn: { bg: '#b8501c', layers: [['flame', '#ff8a3a', 0, 0, 0, 0.95], ['ember', '#ffe08a']] },
  root: { bg: '#5a4a2a', layers: [['jaws', '#a8743c', 0, 6, 0, 0.9], ['wave', '#7fb86a', 0, -14, 0, 0.6]] },
  mark: { bg: '#b03a3a', layers: [['ringA', '#ffd0c8', 0, 0, 0, 1, 4], ['plus', '#ff5a4a', 0, 0, 0, 0.8]] },
  guard: { bg: '#3a5a9a', layers: [['shield', '#7fb4ff'], ['shield', '#e8f4ff', 0, 0, 0, 0.55]] },
  rally: { bg: '#a8842a', layers: [['horn', '#fff0b0', 0, 2, 0, 0.9]] },
  blessing: { bg: '#b89a3a', layers: [['wing', '#fffbe0', 0, 4, 0, 1], ['dot', '#ffe89a', 0, -18, 0, 0.6]] },
  haste: { bg: '#b0483a', layers: [['chevron', '#ffe0c0', -14, 0, 0, 0.7], ['chevron', '#ff8a5a', 4, 0, 0, 0.7], ['chevron', '#ffe0c0', 22, 0, 0, 0.5]] },
  frenzy: { bg: '#8a1c14', layers: [['eye', '#ffd0c8'], ['flame', '#ff3a2a', 0, 0, 0, 0.5]] },
  surge: { bg: '#c8703a', layers: [['star', '#ff9a5a', 0, 0, 45, 0.9], ['star', '#fff0b0', 0, 0, 0, 0.55]] },
  last_stand: { bg: '#b8742a', layers: [['sword', '#fff0d0', 0, 0, 0, 0.95], ['ringA', '#ffe08a', 0, 0, 0, 1.1, 4]] },
  aegis: { bg: '#d8d0b0', layers: [['shield', '#ffffff'], ['star', '#ffe89a', 0, -2, 0, 0.55]] },
  stealth: { bg: '#3a3650', layers: [['eye', '#8a84a0'], ['slash', '#d0c0ff']] },
  mana_shield: { bg: '#3a68b8', layers: [['orb', '#6fb4ff'], ['ringA', '#e8f4ff', 0, 0, 0, 1.15, 3]] },
  barrier: { bg: '#7a5f38', layers: [['rock', '#b08a50', -12, -8, 0, 0.5], ['rock', '#b08a50', 12, -8, 60, 0.5], ['rock', '#b08a50', 0, 14, 120, 0.5]] },
  retribution: { bg: '#5a78b0', layers: [['sword', '#e8f4ff', -6, 0, -20, 0.85], ['bolt', '#fff06a', 14, -6, 0, 0.5]] },
  shock: { bg: '#a89a2a', layers: [['bolt', '#fff06a'], ['ringA', '#fffbd0', 0, 0, 0, 1.1, 3]] },
  death_mark: { bg: '#5a1c7a', layers: [['eye', '#f0d0ff'], ['shard', '#b03ad0', 0, 0, 0, 0.55]] },
  rested: { bg: '#3a6a8a', layers: [['crescent', '#fff0b0', 0, 0, 0, 0.8], ['star', '#ffffff', 12, -12, 0, 0.3]] },
  null_phase: { bg: '#2a1240', layers: [['eye', '#c84aff'], ['star', '#f0d0ff', 0, 0, 0, 0.4]] },
  swift: { bg: '#2a6a5a', layers: [['bolt', '#d0fff0', 0, 0, 0, 0.8]] },
};

/** Basic attack, one per weapon kind. */
const ATTACK: Record<WeaponKind, IconDef> = {
  sword_shield: { bg: '#6a7890', layers: [['shield', '#8fa4c4', 8, 4, 0, 0.75], ['sword', '#eef2fa', -10, -2, -30, 0.8]] },
  greatsword: { bg: '#6a7890', layers: [['sword', '#eef2fa', 0, 0, 45, 1.15]] },
  staff: { bg: '#7a5a3a', layers: [['staff', '#d9a868', 0, 0, 30, 1], ['dot', '#7fd6ff', 14, -24, 0, 0.5]] },
  orb: { bg: '#3a6aa8', layers: [['orb', '#7ab8f0'], ['dot', '#d8f0ff', -6, -6, 0, 0.6], ['ringA', '#c9a24a', 0, 0, 0, 1.15, 3]] },
  bow: { bg: '#6a5a3a', layers: [['bow', '#d9a868', 4, 0, 0, 1], ['arrow', '#f4f0e2', -6, 0, 90, 0.75]] },
  crossbow: { bg: '#5a4a3a', layers: [['bow', '#a9743a', 0, -8, 90, 0.9], ['blade', '#d9a868', 0, 8, 0, 0.7], ['arrow', '#f4f0e2', 0, -6, 0, 0.5]] },
  daggers: { bg: '#5a5270', layers: [['dagger', '#eef2fa', -10, 0, -25, 0.85], ['dagger', '#c8d0e0', 10, 0, 25, 0.85]] },
  holy_staff: { bg: '#a8862e', layers: [['staff', '#fff6c8', 0, 0, 0, 1], ['plus', '#fffbe0', 0, -20, 0, 0.3], ['wing', '#fff0a0', 0, -6, 0, 0.4]] },
  mace: { bg: '#6a7890', layers: [['mace', '#d0d8e4', 0, 0, 30, 1]] },
  axe: { bg: '#7a4a3a', layers: [['axe', '#e0d8d0', 0, 0, 25, 1.05]] },
  dual_axe: { bg: '#7a3a2a', layers: [['axe', '#e0d8d0', -10, 0, -25, 0.8], ['axe', '#c8c0b8', 10, 0, 205, 0.8]] },
};
const RUNE_SHAPE: Record<Element, keyof typeof S> = { fire: 'flame', water: 'drop', lightning: 'bolt', earth: 'rock', wind: 'crescent' };

// ---- drawing ----
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
function frame(g: CanvasRenderingContext2D, bg: string, border: string, hexagon = false) {
  const path = new Path2D(hexagon ? S.hex : 'M10 2H54A8 8 0 0 1 62 10V54A8 8 0 0 1 54 62H10A8 8 0 0 1 2 54V10A8 8 0 0 1 10 2Z');
  const grad = g.createRadialGradient(24, 20, 4, 32, 32, 44);
  grad.addColorStop(0, shade(bg, 0.95));
  grad.addColorStop(1, shade(bg, 0.32));
  g.fillStyle = grad;
  g.fill(path);
  g.lineWidth = 3;
  g.strokeStyle = border;
  g.stroke(path);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.save();
  g.translate(32, 32);
  g.scale(0.9, 0.9);
  g.translate(-32, -32);
  g.stroke(path);
  g.restore();
}
function drawLayers(g: CanvasRenderingContext2D, layers: Layer[]) {
  for (const [shape, fill, dx = 0, dy = 0, rot = 0, scale = 1, stroke = 0] of layers) {
    const p = new Path2D(S[shape]);
    g.save();
    g.translate(32 + dx, 32 + dy);
    g.rotate((rot * Math.PI) / 180);
    g.scale(scale * 0.78, scale * 0.78);
    g.translate(-32, -32);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (stroke) {
      // an open or ring shape drawn as a line: dark edge, then colour
      g.strokeStyle = K;
      g.lineWidth = stroke + 5;
      g.stroke(p);
      g.strokeStyle = fill;
      g.lineWidth = stroke;
      g.stroke(p);
    } else {
      g.strokeStyle = K;
      g.lineWidth = 5 / scale;
      g.stroke(p);
      g.fillStyle = fill;
      g.fill(p);
      // highlight: the upper-left of every shape catches the light
      g.save();
      g.clip(p);
      const hl = g.createLinearGradient(8, 4, 44, 52);
      hl.addColorStop(0, 'rgba(255,255,255,0.5)');
      hl.addColorStop(0.5, 'rgba(255,255,255,0)');
      hl.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = hl;
      g.fillRect(0, 0, 64, 64);
      g.restore();
    }
    g.restore();
  }
}
/** A sigil made from the id itself, for passive skills: every id gives a different one. */
function sigil(id: string): Layer[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const shapes: (keyof typeof S)[] = ['star', 'shield', 'plus', 'drop', 'flame', 'bolt', 'wing', 'eye', 'rock', 'crescent', 'sword', 'arrow', 'fist', 'orb', 'horn', 'chevron'];
  const a = shapes[h % 16], b = shapes[(h >>> 4) % 16], tint = ['#f0e6c8', '#c8e6f0', '#e6c8f0', '#c8f0d0'][(h >>> 8) % 4];
  return [['ringA', tint, 0, 0, 0, 1.1, 3], [a, tint, 0, 0, ((h >>> 10) % 8) * 45, 0.8], [b, W, 0, 0, ((h >>> 13) % 8) * 45, 0.36]];
}

const canvases = new Map<string, HTMLCanvasElement>(), urls = new Map<string, string>();
function render(key: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = ICON_SIZE;
  const g = c.getContext('2d')!, [kind, ref] = key.split('/') as [IconKind, string];
  if (kind === 'skill') {
    const def = SKILL[ref], a = ABILITIES[ref];
    frame(g, def?.bg ?? '#5a5a6a', a?.kind === 'rune' ? '#e8d9a8' : '#c9a24a');
    drawLayers(g, def?.layers ?? sigil(ref));
  } else if (kind === 'passive') {
    const job = JOBS.find((j) => JOB_DEFS[j].skills.some((s) => s.id === ref) || JOB_DEFS[j].passives.some((p) => p.id === ref));
    frame(g, shade(job ? JOBC[job] : '#6a6a7a', 0.7), '#8a8f98');
    drawLayers(g, sigil(ref));
  } else if (kind === 'status') {
    const st = STATUS.find((s) => s.id === ref), def = STATUS_ICON[ref];
    frame(g, def?.bg ?? '#5a5a6a', st?.debuff ? '#e2523f' : '#5fae5a'); // red rim: debuff; green rim: buff
    drawLayers(g, def?.layers ?? sigil(ref));
  } else if (kind === 'attack') {
    const def = ATTACK[ref as WeaponKind];
    frame(g, def?.bg ?? '#5a5a6a', '#8a8f98');
    drawLayers(g, def?.layers ?? sigil(ref));
  } else {
    const el = ref as Element;
    g.translate(0, 0);
    frame(g, EL[el] ?? '#5a5a6a', '#e8d9a8', true);
    drawLayers(g, [[RUNE_SHAPE[el] ?? 'star', '#fff7e0', 0, 0, 0, 0.8]]);
  }
  return c;
}
/** The icon canvas for a key such as "skill/fireball", "status/poison", "attack/bow", "rune/fire". */
export function iconCanvas(key: string): HTMLCanvasElement {
  let c = canvases.get(key);
  if (!c) canvases.set(key, (c = render(key)));
  return c;
}
/** Replaces an icon with imported art (asset pipeline). */
export function setIcon(key: string, canvas: HTMLCanvasElement) {
  canvases.set(key, canvas);
  for (const k of [...urls.keys()]) if (k.startsWith(key + '@')) urls.delete(k);
}
/** Data URL of an icon at a UI size: 64 (full), or a smaller size resampled once and cached. */
export function iconUrl(key: string, size = ICON_SIZE): string {
  const k = `${key}@${size}`;
  let url = urls.get(k);
  if (url) return url;
  const src = iconCanvas(key);
  if (size === src.width) url = src.toDataURL();
  else {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, size, size);
    url = c.toDataURL();
  }
  urls.set(k, url);
  return url;
}
export const skillIcon = (id: string, size?: number) => iconUrl(`${ABILITIES[id] ? 'skill' : 'passive'}/${id}`, size);
export const statusIcon = (id: string, size?: number) => iconUrl(`status/${id}`, size);
export const runeIcon = (el: string, size?: number) => iconUrl(`rune/${el}`, size);
export const attackIcon = (kind: string, size?: number) => iconUrl(`attack/${kind}`, size);

/** The skill icon manifest: every icon the game has, mapped to the skill (or status, weapon, rune) it belongs to. */
export function iconManifest(): IconEntry[] {
  const e = (kind: IconKind, ref: string, name: string): IconEntry => ({ id: `${kind}/${ref}`, kind, ref, name, file: `icons/${kind}/${ref}.png`, width: ICON_SIZE, height: ICON_SIZE });
  const out: IconEntry[] = ABILITY_LIST.map((a) => e('skill', a.id, a.name));
  for (const j of JOBS) {
    for (const s of JOB_DEFS[j].skills) if (s.type === 'passive') out.push(e('passive', s.id, s.name));
    for (const p of JOB_DEFS[j].passives) out.push(e('passive', p.id, p.name));
  }
  for (const s of STATUS) out.push(e('status', s.id, s.name));
  for (const k of Object.keys(ATTACK)) out.push(e('attack', k, `Attack (${k.replace('_', ' ')})`));
  for (const el of ELEMENTS) out.push(e('rune', el, `${el[0].toUpperCase()}${el.slice(1)} Rune`));
  return out;
}
/** Which abilities have a hand-made symbol (all of them: a test keeps it that way). */
export const handMadeSkillIcons = () => Object.keys(SKILL);
