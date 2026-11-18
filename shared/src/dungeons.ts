// Instanced party dungeons: five combat chambers (waves, then an elite guard) and a boss hall.
// Pure data shared by server and client. There is no entry cost of any kind: no energy, keys,
// daily limits or lockouts. A party may run any dungeon as often as it likes.
import { EXPANSION } from './expansion';
import { MONSTERS } from './monsters';
import { BOSS_ROOM, ZONES } from './world';

export interface DungeonStage {
  name: string;
  /** Chamber index 0..5 (see CHAMBERS in world.ts); the last is the boss hall. */
  room: number;
  spawns: [type: string, count: number][];
}
export interface DungeonDef {
  id: string;
  name: string;
  /** Interior map (a zone of kind 'dungeon'). */
  zone: string;
  level: number;
  minLevel: number;
  boss: string;
  stages: DungeonStage[];
  blurb: string;
  /** Armageddon is offered only where the boss is level 50 or higher. */
  armageddon: boolean;
}
export const DIFFICULTIES = ['normal', 'hard', 'nightmare', 'armageddon'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** Multipliers per difficulty. Loot quality comes from BOSS_RARITY in items.ts. */
export const DIFFICULTY: Record<Difficulty, { name: string; hp: number; atk: number; exp: number; gold: number; level: number }> = {
  normal: { name: 'Normal', hp: 1, atk: 1, exp: 1, gold: 1, level: 0 },
  hard: { name: 'Hard', hp: 1.7, atk: 1.35, exp: 1.5, gold: 1.6, level: 2 },
  nightmare: { name: 'Nightmare', hp: 2.6, atk: 1.75, exp: 2.2, gold: 2.5, level: 4 },
  // characters of level 50 or more only; its bosses drop sigils and the most armament material
  armageddon: { name: 'Armageddon', hp: 5.5, atk: 2.6, exp: 3.4, gold: 4, level: 20 },
};
/** Armageddon is opened only by characters of this level or higher (every one who enters). */
export const ARMAGEDDON_LEVEL = 50;
/** Armageddon exists only in dungeons whose boss is at least this level. */
export const ARMAGEDDON_BOSS_LEVEL = 50;
/** The difficulties a dungeon offers. */
export const difficultiesOf = (def: DungeonDef): Difficulty[] => DIFFICULTIES.filter((x) => x !== 'armageddon' || def.armageddon);
/** Monster HP scales with the number of players who entered, so a dungeon suits one to five. */
export const partyHpScale = (players: number) => 0.5 + 0.25 * Math.max(1, Math.min(5, players));
export const DUNGEON_MAX_PLAYERS = 5;
/** After the boss falls the instance stays open this long, then everyone is returned outside. */
export const DUNGEON_CLOSE_MS = 45000;
/** An instance with nobody inside is discarded after this long (a full reset). */
export const DUNGEON_EMPTY_MS = 20000;
export const DUNGEON_GATHER_RANGE = 400;
/** How long party members have to agree to enter a dungeon. */
export const DUNGEON_READY_MS = 30000;

/** More monsters in every wave than first designed. */
export const DUNGEON_WAVE = 1.5;
const more = (sp: [string, number][]): [string, number][] => sp.map(([t, n]) => [t, MONSTERS[t]?.elite ? n : Math.ceil(n * DUNGEON_WAVE)]);
/**
 * A dungeon from its three designed stages (two waves and an elite guard): the waves grow, two
 * deeper halls mixing their monsters are added, and the boss waits in the last chamber.
 */
const d = (id: string, zone: string, level: number, boss: string, stages: DungeonStage[]): DungeonDef => {
  const [a, b, guard] = stages;
  const halls: DungeonStage[] = [
    { name: a.name, room: 0, spawns: more(a.spawns) },
    { name: b.name, room: 1, spawns: more(b.spawns) },
    { name: guard.name, room: 2, spawns: more(guard.spawns) },
  ];
  return { id, name: ZONES[zone].name, zone, level, minLevel: Math.max(1, level - 3), boss, stages: [...halls, { name: 'Boss', room: BOSS_ROOM, spawns: [[boss, 1]] }], blurb: ZONES[zone].blurb, armageddon: (MONSTERS[boss]?.level ?? 0) >= ARMAGEDDON_BOSS_LEVEL };
};

export const DUNGEONS: Record<string, DungeonDef> = {
  ruins: d('ruins', 'd_ruins', 8, 'rune_guardian', [
    { name: 'The Outer Vault', room: 0, spawns: [['ruin_bat', 4], ['ruin_sentry', 2]] },
    { name: 'Hall of Seals', room: 1, spawns: [['ruin_sentry', 4], ['ruin_bat', 3]] },
    { name: 'The Warden', room: 2, spawns: [['ruin_warden', 1], ['ruin_sentry', 2]] },
  ]),
  lair: d('lair', 'd_lair', 16, 'ancient_dragon', [
    { name: 'Scorched Tunnels', room: 0, spawns: [['ember_hound', 4], ['cinder_imp', 3]] },
    { name: 'The Hatchery', room: 1, spawns: [['dragon_whelp', 4], ['slag_beetle', 2]] },
    { name: 'Keeper of the Brood', room: 2, spawns: [['magma_brute', 1], ['dragon_whelp', 2]] },
  ]),
  citadel: d('citadel', 'd_citadel', 24, 'frost_queen', [
    { name: 'The Frozen Gate', room: 0, spawns: [['snow_stalker', 4], ['ice_wisp', 3]] },
    { name: 'Hall of Statues', room: 1, spawns: [['frost_knight', 4], ['ice_wisp', 2]] },
    { name: "The Queen's Champion", room: 2, spawns: [['avalanche_elder', 1], ['frost_knight', 2]] },
  ]),
  temple: d('temple', 'd_temple', 32, 'abyssal_golem', [
    { name: 'The Drowned Steps', room: 0, spawns: [['bog_lurker', 3], ['abyssal_cultist', 3]] },
    { name: 'Choir of the Deep', room: 1, spawns: [['abyssal_cultist', 4], ['drowned_knight', 3]] },
    { name: 'The High Priest', room: 2, spawns: [['gallows_tree', 1], ['abyssal_cultist', 2]] },
  ]),
};
for (const e of EXPANSION) {
  const [a, b, c, dd, el] = e.mobs.map((x) => x.id), x = e.dungeon;
  DUNGEONS[x.id] = d(x.id, `d_${x.id}`, x.bossLevel - 2, x.boss.id, [
    { name: 'The Threshold', room: 0, spawns: [[a, 4], [b, 3]] },
    { name: 'The Inner Court', room: 1, spawns: [[c, 4], [dd, 3]] },
    { name: 'The Guardian', room: 2, spawns: [[el, 1], [c, 2]] },
  ]);
}

/** What the client shows while inside a dungeon. */
export interface DungeonState {
  id: string;
  diff: Difficulty;
  stage: number;
  stages: number;
  stageName: string;
  left: number; // monsters still alive in the current stage
  state: 'active' | 'cleared';
  /** Seconds since the run started (frozen once cleared). */
  elapsed: number;
  /** Seconds until the instance closes; 0 while active. */
  closeIn: number;
}
