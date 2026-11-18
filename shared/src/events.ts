// Dynamic world events, the day and night cycle, and the weather. Pure rules shared by server and
// client. The time of day and the weather follow the clock, so every client computes the same
// sky without being told; events are started and resolved by the server.
import type { Theme } from './world';

// ---------------------------------------------------------------------------------------------
// Day and night
// ---------------------------------------------------------------------------------------------
/** One full day lasts an hour of real time. */
export const DAY_CYCLE_MS = 60 * 60_000;
/** Time of day from 0 (midnight) to 1; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
export const timeOfDay = (now: number) => (((now % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS) / DAY_CYCLE_MS;
/** Night is from 0.8 to 0.2 (a fifth of the cycle on either side of midnight). */
export const isNight = (now: number) => {
  const t = timeOfDay(now);
  return t >= 0.8 || t < 0.2;
};
/** How dark the world is (0 bright day to 1 deepest night), smooth through dawn and dusk. */
export function darkness(now: number): number {
  const t = timeOfDay(now), d = Math.abs(t - 0.5) * 2; // 0 at noon, 1 at midnight
  return Math.max(0, Math.min(1, (d - 0.45) / 0.45));
}
/** Monsters of the night: extra, stronger monsters in every region while it is dark. */
export const NIGHT_MONSTER = { hp: 1.8, atk: 1.35, level: 2, exp: 1.8, gold: 1.8, drop: 1.6 };
/** Night camps per region (each of its first ordinary monster types). */
export const NIGHT_CAMPS = 2;
export const NIGHT_CAMP_COUNT = 4;

// ---------------------------------------------------------------------------------------------
// Weather: chosen for each region and each 12-minute window from the clock
// ---------------------------------------------------------------------------------------------
export type Weather = 'clear' | 'rain' | 'storm' | 'snow' | 'ash' | 'fog' | 'stars';
export const WEATHER_WINDOW_MS = 12 * 60_000;
/** Which weathers each landscape has, with weights. */
const CLIMATE: Record<Theme, [Weather, number][]> = {
  kingdom: [['clear', 6], ['rain', 3], ['storm', 1]], forest: [['clear', 5], ['rain', 4], ['fog', 2], ['storm', 1]],
  ashen: [['clear', 4], ['ash', 5], ['storm', 1]], frost: [['clear', 4], ['snow', 6]], moor: [['fog', 6], ['rain', 4], ['clear', 2]],
  astral: [['clear', 4], ['stars', 5], ['storm', 1]], ruins: [['clear', 1]], lair: [['clear', 1]], citadel: [['clear', 1]], temple: [['clear', 1]],
};
const hash = (a: number) => {
  a = (a ^ 61) ^ (a >>> 16);
  a = Math.imul(a, 9);
  a ^= a >>> 4;
  a = Math.imul(a, 0x27d4eb2d);
  return ((a ^ (a >>> 15)) >>> 0) / 4294967296;
};
export function weatherAt(zone: string, theme: Theme, now: number): Weather {
  const w = Math.floor(now / WEATHER_WINDOW_MS);
  let seed = w * 131;
  for (let i = 0; i < zone.length; i++) seed = (seed * 31 + zone.charCodeAt(i)) | 0;
  const list = CLIMATE[theme] ?? [['clear', 1]], total = list.reduce((n, [, x]) => n + x, 0);
  let r = hash(seed) * total;
  for (const [k, x] of list) if ((r -= x) < 0) return k;
  return 'clear';
}

// ---------------------------------------------------------------------------------------------
// World events
// ---------------------------------------------------------------------------------------------
export type EventKind = 'invasion' | 'meteor' | 'goblin';
export interface EventDef {
  kind: EventKind;
  name: string;
  /** How long it lasts. */
  ms: number;
  blurb: string;
}
export const EVENTS: Record<EventKind, EventDef> = {
  invasion: { kind: 'invasion', name: 'Invasion', ms: 6 * 60_000, blurb: 'Monsters march on the village. Hold the line: defeat the invaders before they break through.' },
  meteor: { kind: 'meteor', name: 'Meteor Shower', ms: 5 * 60_000, blurb: 'Fragments of the fallen star have struck the region. Break them open for star shards and gold.' },
  goblin: { kind: 'goblin', name: 'Treasure Goblin', ms: 3 * 60_000, blurb: 'A treasure goblin is loose with a sack of loot. Catch it before it escapes!' },
};
export const EVENT_KINDS = Object.keys(EVENTS) as EventKind[];
/** Time between the end of one event and the start of the next, anywhere in the world. */
export const EVENT_GAP_MS = { min: 8 * 60_000, max: 16 * 60_000 };
/** Monsters to defeat in an invasion: more for busier regions. */
export const invasionGoal = (players: number) => 18 + 6 * Math.max(0, Math.min(10, players - 1));
export const METEOR_COUNT = 6;
/** A player is rewarded for an event when they contributed at least this share of the work. */
export const EVENT_MIN_SHARE = 0.03;
/** The reward of a successful event for one contributor, by region level and share (0-1). */
export function eventReward(kind: EventKind, level: number, share: number): { gold: number; exp: number; shards: number; stones: number } {
  const k = kind === 'invasion' ? 1 : kind === 'goblin' ? 1.4 : 0.8, s = 0.5 + 0.5 * Math.min(1, share * 3);
  return { gold: Math.round(150 * level * k * s), exp: Math.round(60 * level ** 1.5 * k * s), shards: level >= 30 ? Math.round(2 * k) : 0, stones: Math.round(3 * k) };
}
/** What the client shows about a running event. */
export interface WorldEventState {
  id: number;
  kind: EventKind;
  zone: string;
  /** Tile the event centres on (village, crash site, the goblin's start). */
  tx: number;
  ty: number;
  endsAt: number;
  progress: number;
  goal: number;
  state: 'active' | 'won' | 'lost';
}
