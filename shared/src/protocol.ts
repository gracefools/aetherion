// Shared wire protocol + gameplay constants. Imported by both server and client.
import type { Build } from './abilities';
import type { Equipment, Item } from './items';
import type { DungeonState } from './dungeons';
import type { Appearance } from './appearance';
import type { Stats } from './jobs';
import type { AutoConfig, AutoStats } from './autohunt';
import type { QuestState, FactionDef } from './quests';
import type { Companions } from './companions';
import type { Gear } from './gear';
import type { AuctionRates, Bank, GuildView, Listing } from './economy';
import type { FinderState } from './social';
import type { LadderRow } from './seasons';
import type { MatchView } from './matches';
export type { Appearance };

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TILE = 32;
export const RUN_SPEED = 160; // world units / second at moveMul 1
export const WALK_SPEED = 96;
export const PLAYER_HALF = 10; // collision half-extent
// Area of interest half-extents (world units). Must exceed the client's max visible half-view (640x360).
export const AOI_HALF_W = 800;
export const AOI_HALF_H = 520;
export const MAX_CHAT_LEN = 200;
export const PARTY_MAX = 5;
export const PARTY_INVITE_MS = 30_000;
export const PARTY_SHARE_RANGE = 900; // members this close to a kill share its EXP
export const PARTY_EXP_BONUS = 0.1; // extra EXP per additional member sharing a kill
export const CAST_ANIM_COOLDOWN_MS = 600;
// Player-to-player trading
export const TRADE_RANGE = 240; // world units between the two players, from invitation to exchange
export const TRADE_INVITE_MS = 30_000;
export const TRADE_MAX_ITEMS = 12;
export const TRADE_GOLD_MAX = 100_000_000;
export const SORT_KEYS = ['kind', 'rarity', 'level', 'value', 'name'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const JOBS = ['knight', 'mage', 'ranger', 'assassin', 'cleric', 'berserker'] as const;
export type Job = (typeof JOBS)[number];

export const enum Dir {
  Down = 0,
  Left = 1,
  Right = 2,
  Up = 3,
}
/** Locomotion state replicated to other clients. */
export const enum Move {
  Idle = 0,
  Walk = 1,
  Run = 2,
}
/** Entity events (second element of an EntityEvent). */
export const enum Act {
  Attack = 0, // [id, 0, targetId?]
  Cast = 1, // [id, 1, abilityIndex, castMs]  castMs 0 = the cast was cancelled
  Telegraph = 2, // [id, 2, x, y, radius, ms, friendly?, innerRadius?]  ground warning before an area effect lands; innerRadius > 0 = ring with a safe centre
  LevelUp = 3, // [id, 3, level]
  Fx = 4, // [casterId, 4, abilityIndex, x, y, targetId, key, ...chainedIds]  an ability took effect
  FxEnd = 5, // [ownerId, 5, key, triggered]  a trap fired or expired
  PetSkill = 6, // [ownerId, 6, petIndex, targetId]  the owner's pet used its skill (G10)
  Dodge = 7, // [id, 7, fromX, fromY, toX, toY]  a dodge roll (G1); also sent by the client as { t: 'act', k: 7 }
  Finisher = 8, // [id, 8, targetId]  the third basic blow of a chain landed (G1)
}

// ---- client -> server ----
export type ClientMsg =
  | { t: 'join'; token: string; characterId: number }
  | { t: 'in'; s: number; x: number; y: number; r: number }
  | { t: 'act'; k: number }
  | { t: 'tgt'; id: number }
  | { t: 'use'; a: string; tid?: number; ax?: number; ay?: number }
  | { t: 'learn'; id: string }
  | { t: 'respec' }
  | { t: 'inv'; op: 'equip' | 'unequip' | 'use' | 'sell' | 'sellall' | 'sort' | 'buy' | 'upgrade' | 'destroy' | 'scroll' | 'buyrune' | 'arm' | 'sigil' | 'unsigil'; el?: string; uid?: string; uids?: string[]; by?: SortKey; slot?: string | number; base?: string; qty?: number }
  | { t: 'auto'; on: boolean; cfg?: AutoConfig }
  | { t: 'trade'; op: 'invite' | 'accept' | 'decline' | 'offer' | 'remove' | 'gold' | 'confirm' | 'unconfirm' | 'cancel'; id?: number; name?: string; uid?: string; qty?: number; gold?: number }
  | { t: 'rune'; slot: number; el: string | null }
  | { t: 'respawn' }
  | { t: 'chat'; text: string; ch?: ChatChannel; to?: string }
  | { t: 'party'; op: 'invite' | 'accept' | 'decline' | 'leave' | 'kick' | 'promote' | 'loot'; id?: number; name?: string; mode?: LootMode }
  | { t: 'dng'; op: 'enter' | 'leave' | 'ready'; id?: string; diff?: string; yes?: boolean }
  | { t: 'journal'; op: 'title' | 'claim' | 'login'; id?: string; kind?: 'daily' | 'weekly'; i?: number }
  | { t: 'rift'; op: 'enter' | 'leave' | 'top' }
  | { t: 'raid'; op: 'open' | 'join' | 'leave' | 'start' | 'list'; id?: number }
  | { t: 'life'; op: string; [k: string]: unknown }
  | { t: 'asc'; op: 'path' | 'mastery' | 'mreset' | 'save' | 'load' | 'awaken'; id?: string; stat?: string; slot?: number; name?: string }
  | { t: 'friends'; op: 'list' | 'add' | 'accept' | 'decline' | 'remove'; id?: number; name?: string }
  | { t: 'depth'; op: 'enter' }
  | { t: 'mail'; op: 'list' | 'send' | 'claim' | 'read' | 'delete'; id?: number; to?: string; subject?: string; body?: string; items?: string[]; gold?: number }
  | { t: 'obj'; op: 'gather' | 'open' | 'tp' | 'craft'; id?: string; to?: string; recipe?: string }
  | { t: 'dbg'; on: boolean }
  | { t: 'quest'; op: 'accept' | 'abandon' | 'turnin' | 'shop'; id?: string; faction?: string; base?: string }
  | { t: 'guild'; op: string; [k: string]: unknown }
  | { t: 'eco'; op: string; [k: string]: unknown }
  | { t: 'pvp'; op: 'duel' | 'accept' | 'decline' | 'forfeit' | 'arena' | 'leave' | 'rank' | 'buy' | 'queue' | 'unqueue' | 'maccept' | 'mdecline'; id?: number; by?: string; base?: string; mode?: string }
  | { t: 'finder'; op: 'join' | 'leave' | 'state'; dungeon?: string; diff?: string }
  | { t: 'season'; op: 'view'; ladder?: string }
  | { t: 'comp'; op: 'summon' | 'dismiss' | 'rename' | 'release' | 'mount' | 'dismount'; uid?: string; id?: string; name?: string }
  | { t: 'ping'; c: number };

export type ChatChannel = 'zone' | 'party' | 'whisper' | 'guild' | 'world' | 'lfg';
/** How a party shares drops from ordinary monsters. Boss rewards are always personal. */
export const LOOT_MODES = ['personal', 'roundrobin', 'contribution'] as const;
export type LootMode = (typeof LOOT_MODES)[number];
export const LOOT_MODE_NAMES: Record<LootMode, string> = { personal: 'Personal loot', roundrobin: 'Round robin', contribution: 'By contribution' };
export interface PartyMember {
  id: number;
  name: string;
  job: Job;
  level: number;
  hp: number;
  mhp: number;
  zone: string;
  ch: number;
  x: number;
  y: number;
  on: boolean; // false while the member's connection is down (reconnect grace)
}
export interface PartyState {
  id: number;
  leader: number;
  members: PartyMember[];
  loot: LootMode;
}

/** One side of a trade as shown to a player. */
export interface TradeOffer {
  items: Item[];
  gold: number;
  /** This side has confirmed the trade as it stands. */
  ok: boolean;
}
export interface TradeState {
  with: { id: number; name: string };
  mine: TradeOffer;
  theirs: TradeOffer;
}

// ---- server -> client ----
export interface EntityMeta {
  id: number; // players: character id (> 0); monsters: negative
  name: string;
  level: number;
  x: number;
  y: number;
  d: number;
  hp: number;
  mhp: number;
  st: number; // status bitmask (index into STATUS)
  job?: Job; // players
  ap?: Appearance; // players
  mt?: string; // monsters: key into MONSTERS
  pet?: [kind: string, name: string, level: number];
  /** Weapon glow from the weapon armament: 1 white (+6), 2 blue (+12), 3 ember (+18). */
  wa?: number;
  /** A monster of an open-PvP area (fiercer, richer). */
  fz?: 1; // players: the summoned pet
  mnt?: string; // players: the mount being ridden
  gt?: string; // players: guild tag
  ti?: string; // players: the title worn (an achievement id)
  nt?: 1; // monsters: a monster of the night
  ev?: 1; // monsters: part of a world event
  wk?: string; // players: the weapon glow colour worn (wardrobe)
}
export type PlayerMeta = EntityMeta & { job: Job; ap: Appearance };
/** [id, x, y, dir, Move] */
export type EntityMove = [number, number, number, number, number];
/** [id, Act, ...args] */
export type EntityEvent = number[];
/** [targetId, amount, Dmg flags, sourceId] */
export type DamageEvent = [number, number, number, number];
/** [id, hp, maxHp, status mask] */
export type VitalUpdate = [number, number, number, number];
/** Private state of the receiving player; sent only when it changes. */
export interface SelfState {
  hp: number;
  res: number;
  exp: number;
  st: [number, number][]; // [status index, ms left]
  tgt: number; // target entity id, 0 = none
  atk: number; // 1 while auto-attacking
  dead: number; // ms until automatic respawn, 0 = alive
  xp?: number; // EXP gained this tick (for the floating text)
}

export interface WelcomeMsg {
  /** The character's saved auto hunting configuration. */
  auto: AutoConfig;
  factions: FactionDef[];
  comp: Companions;
  bank: Bank;
  /** Armament levels and equipped sigils. */
  gear: Gear;
  /** Present while inside the arena. */
  arena?: boolean;
  /** Present when the server allows the developer overlay (DEBUG_OVERLAY=1). */
  dev?: boolean;
  t: 'welcome';
  id: number;
  zone: string;
  channel: number;
  tick: number;
  x: number;
  y: number;
  self: PlayerMeta;
  stats: Stats;
  hp: number;
  res: number;
  exp: number;
  next: number; // EXP needed for the next level
  build: Build;
  inv: Item[];
  eq: Equipment;
  gold: number;
  /** Waystones attuned and hidden caches opened. */
  disc: string[];
}
export interface SnapMsg {
  t: 'snap';
  k: number; // server tick
  a: number; // last processed input seq
  x: number;
  y: number;
  add?: EntityMeta[];
  rm?: number[];
  mv?: EntityMove[];
  ev?: EntityEvent[];
  dm?: DamageEvent[];
  hp?: VitalUpdate[];
  me?: SelfState;
}
/**
 * Sound cue on a server notice. The server names the event; each client chooses the sound for it,
 * so everyone hears the same thing for the same authoritative event (client/src/audio).
 */
export type Cue = 'boss' | 'worldboss' | 'bossdown' | 'phase' | 'stage' | 'clear' | 'loot' | 'upgrade_ok' | 'upgrade_fail' | 'cache' | 'attune' | 'quest' | 'questdone' | 'rep' | 'guild' | 'pvp';
export type ServerMsg =
  | WelcomeMsg
  | SnapMsg
  | { t: 'stats'; level: number; stats: Stats; exp: number; next: number }
  | { t: 'build'; build: Build }
  | { t: 'inv'; inv: Item[]; eq: Equipment; gold: number; ap: Appearance; pcd: number; gear?: Gear }
  | { t: 'loot'; gold: number; items: { base: string; rar: number; qty: number }[] }
  | { t: 'no'; a: string; why: string }
  | { t: 'chat'; from: string; text: string; ch: ChatChannel; to?: string }
  | { t: 'party'; party: PartyState | null }
  | { t: 'pinv'; from: string; id: number; ms: number }
  | { t: 'sys'; text: string; cue?: Cue }
  | { t: 'ann'; text: string; cue?: Cue }
  | { t: 'dng'; run: DungeonState | null }
  /** Dungeon ready check: the leader asks every party member to agree before the party enters. `id` '' ends it. */
  | { t: 'dready'; id: string; diff: string; from: string; ms: number; ok: string[]; wait: string[] }
  | { t: 'disc'; list: string[] }
  | { t: 'nodes'; cd: [id: string, ms: number][] }
  | { t: 'dbg'; mobs: (number | string)[][] }
  | { t: 'auto'; on: boolean; cfg: AutoConfig; stats: AutoStats; why?: string }
  | { t: 'trade'; trade: TradeState | null; done?: boolean }
  | { t: 'tinv'; from: string; id: number; ms: number }
  /** A rune was obtained (new) or strengthened (already owned) by a scroll or a purchase. */
  | { t: 'rune'; el: string; isNew: boolean; xp: number; levels: number }
  | { t: 'quests'; q: QuestState; prog: Record<string, number[]>; rep: Record<string, number> }
  /** The adventurer's journal (achievements, titles, codex, missions, login streak). */
  | { t: 'journal'; j: import('./journal').Journal }
  /** Mail: the unread count, and the mailbox when it was asked for. */
  | { t: 'mail'; unread: number; list?: import('./mail').MailEntry[] }
  | { t: 'friends'; list: import('./friends').FriendView[] }
  | { t: 'depths'; bosses: import('./depths').DepthBossState[] }
  | { t: 'depthask'; zone: string; level: number }
  | { t: 'bounty'; marks: import('./depths').BountyMark[] }
  /** The world event running now (null: none). */
  | { t: 'wevent'; ev: import('./events').WorldEventState | null }
  /** The Endless Rift: the climb (null outside it), and the weekly leaderboard. */
  | { t: 'rift'; run: { floor: number; left: number; time: number; state: 'break' | 'fight' | 'over'; best: number } | null }
  | { t: 'rifttop'; rows: import('./rift').RiftScore[]; week: number }
  /** Ascension state (path, mastery, loadouts) and the ultimate gauge. */
  | { t: 'asc'; asc: import('./ascension').Ascension; ult: number }
  | { t: 'ult'; v: number }
  /** Guild territories and faction control (world map), the siege running now, raids. */
  | { t: 'territory'; held: import('./conquest').TerritoryState[]; factions: Record<string, string> }
  | { t: 'siege'; siege: import('./conquest').SiegeState | null }
  | { t: 'raidlobby'; list: import('./conquest').RaidLobby[] }
  | { t: 'raid'; run: import('./conquest').RaidState | null }
  /** Life outside combat, and the home the player stands in (owner '' when not in one). */
  | { t: 'life'; life: import('./life').Life }
  | { t: 'home'; owner: string; mine: boolean; furn: { base: string; tx: number; ty: number }[]; garden: ({ seed: string; at: number } | null)[]; now: number }
  /** Combo chain progress (i = steps done; 3 = the finisher fired). */
  | { t: 'combo'; name: string; i: number }
  | { t: 'guild'; guild: GuildView | null; rank: number }
  | { t: 'ginv'; guild: string; tag: string; from: string; ms: number }
  | { t: 'ah'; list: Listing[]; total: number; page: number; claims: { gold: number; items: number }; rates: AuctionRates }
  | { t: 'ahhist'; rows: { id: number; base: string; rar: number; qty: number; price: number; status: string; sold: boolean; other: string; at: number }[] }
  | { t: 'bank'; bank: Bank; size: number }
  | { t: 'banklog'; rows: { at: number; op: string; detail: unknown }[] }
  | { t: 'dinv'; from: string; id: number; ms: number }
  | { t: 'duel'; with: string; id: number; starts: number; ends: number; result?: string }
  | { t: 'pvprank'; rows: any[]; me: any }
  /** G8: the matchmaking line you are in (null: none), and the match you are in (null: it is over for you). */
  | { t: 'mq'; mode: 'ranked' | 'ranked2' | 'bg' | null; n?: number; waited?: number }
  | { t: 'match'; v: MatchView | null }
  /** A match was found and waits for your answer (mode null: the question is gone); ok once you accepted. */
  | { t: 'mfound'; mode: 'ranked' | 'ranked2' | 'bg' | null; ms?: number; ok?: boolean }
  | { t: 'comp'; comp: Companions }
  | { t: 'pong'; c: number }
  /** G2 talents: time taken off every skill cooldown. */
  | { t: 'cdcut'; ms: number }
  /** G7: one seasonal ladder: its top and this player's place. */
  | { t: 'season'; season: string; ladder: string; ends: number; rows: LadderRow[]; me: { score: number; rank: number } | null }
  /** G9: the dungeon finder as this player sees it. */
  | ({ t: 'finder' } & FinderState)
  | { t: 'kick'; reason: string };
