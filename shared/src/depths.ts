// The Depths: open maps reached from every third region (the fourth, then every three). They are
// built like a region, but the whole map is open PvP, its monsters are harder and pay a little
// more, and a boss as strong as a world boss waits at the far end. Players arrive in a sanctuary
// where nobody can be attacked. Pure data, read by world.ts (zones), monsters.ts (boss and camps)
// and pvp.ts (rules).
export interface DepthDef {
  id: string;
  /** The region whose portal leads here. */
  host: string;
  name: string;
  seed: number;
  /** Hue rotation (degrees) for the boss's borrowed art. */
  hue: number;
  blurb: string;
  /** The boss: attacks and art of an existing world boss (`from`), with stats from the level curves. */
  boss: { id: string; name: string; from: string; level: number; title: string; intro: string; minion?: string };
}
/** Monsters of the Depths (not the boss): tougher, and worth a little more of everything. */
export const DEPTH_MONSTER = { hp: 1.6, atk: 1.35, level: 3, exp: 1.1, gold: 1.1, drop: 1.1 };
/** Radius of the arrival sanctuary, in designed tiles (world.ts scales it with the map). */
export const DEPTH_SANCTUARY_R = 8;
/** Designed tile positions shared by every Depths map (120 x 80 before scaling). */
export const DEPTH_LAYOUT = {
  spawn: { tx: 9, ty: 40 }, exit: { tx: 3, ty: 40 }, boss: { tx: 104, ty: 40, r: 9 },
  /** Where the entrance stands in the host region, and where one arrives coming back. */
  door: { tx: 104, ty: 8 }, back: { tx: 104, ty: 12 },
  elites: [{ tx: 56, ty: 12 }, { tx: 56, ty: 68 }],
  camps: [
    { n: 0, count: 7, tx: 32, ty: 22, r: 10 }, { n: 1, count: 7, tx: 32, ty: 58, r: 10 }, { n: 2, count: 6, tx: 56, ty: 40, r: 9 },
    { n: 3, count: 6, tx: 76, ty: 20, r: 9 }, { n: 0, count: 6, tx: 76, ty: 60, r: 9 }, { n: 2, count: 5, tx: 90, ty: 26, r: 7 }, { n: 3, count: 5, tx: 90, ty: 56, r: 7 },
  ],
};
/** After striking another player: no sanctuary and no way out for this long. */
export const PVP_TAG_MS = 10_000;
/** Stepping out of the sanctuary: nobody may attack you for this long (ends when you attack). */
export const SANCTUARY_LEAVE_SHIELD_MS = 3000;
/** The leaving protection is given at most this often. */
export const SANCTUARY_SHIELD_EVERY_MS = 30_000;
/** A player with this many kills in a row in the Depths carries a bounty and is shown on the map. */
export const BOUNTY_STREAK = 5;
/** Extra honour for ending a bounty. */
export const BOUNTY_HONOR = 30;

export const DEPTHS: DepthDef[] = [
  {
    id: 'x_frostveil', host: 'frostveil', name: 'Frostveil Depths', seed: 0xdee901, hue: 190, blurb: 'Ice caves under the valley, where the long winter began. No law reaches here.',
    boss: { id: 'rime_tyrant', name: 'The Rime Tyrant', from: 'shadow_knight', level: 28, title: 'Warden of the First Frost', intro: 'The ice of the Frostveil Depths cracks. The Rime Tyrant walks.', minion: 'glacier_beetle' },
  },
  {
    id: 'x_emberwaste', host: 'emberwaste', name: 'Emberwaste Depths', seed: 0xdee902, hue: 330, blurb: 'A burnt hollow under the waste, lit by its own coals. No law reaches here.',
    boss: { id: 'kiln_devourer', name: 'The Kiln Devourer', from: 'demon_lord', level: 62, title: 'Eater of Embers', intro: 'The coals of the Emberwaste Depths flare white. The Kiln Devourer is hungry.' },
  },
  {
    id: 'x_hollowfen', host: 'hollowfen', name: 'Hollowfen Depths', seed: 0xdee903, hue: 90, blurb: 'The drowned roots of the fen, where the old dead were sunk. No law reaches here.',
    boss: { id: 'mire_colossus', name: 'The Mire Colossus', from: 'demon_lord', level: 107, title: 'What the Fen Kept', intro: 'The water of the Hollowfen Depths goes still. The Mire Colossus rises.' },
  },
  {
    id: 'x_cinderdeep', host: 'cinderdeep', name: 'Cinderdeep Abyss', seed: 0xdee904, hue: 30, blurb: 'The floor of the chasm, a breath above the molten heart. No law reaches here.',
    boss: { id: 'magma_sovereign', name: 'The Magma Sovereign', from: 'shadow_knight', level: 152, title: 'Crowned in Slag', intro: 'The Cinderdeep Abyss glows red. The Magma Sovereign takes the field.' },
  },
  {
    id: 'x_voidreach', host: 'voidreach', name: 'Voidreach Depths', seed: 0xdee905, hue: 280, blurb: 'The last ground before nothing at all. No law reaches here.',
    boss: { id: 'void_herald', name: 'Herald of the Unmaker', from: 'shadow_knight', level: 200, title: 'The Voice Before the End', intro: 'A silence falls over the Voidreach Depths. The Herald has come to speak.' },
  },
];
export const DEPTH_BY_ID: Record<string, DepthDef> = Object.fromEntries(DEPTHS.map((d) => [d.id, d]));
/** The Depths reached from a region, if it has an entrance. */
export const depthOf = (host: string): DepthDef | undefined => DEPTHS.find((d) => d.host === host);
/** State of the Depths' bosses, sent to every player: `at` is when the boss returns (epoch ms), 0 while it lives. */
export interface DepthBossState { zone: string; at: number }
/** A player carrying a bounty, shown on the map of the Depths they are in. */
export interface BountyMark { id: number; name: string; x: number; y: number; n: number }
