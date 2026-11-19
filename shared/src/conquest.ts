// Guild territory war, faction conquest and raids. Pure rules shared by server and client.
//
// Territories: every village outside Eldoria can be held by a guild. Sieges come round on the
// clock, one region at a time; during a siege, guild members standing at the village banner earn
// points for their guild, and the guild with the most points holds the village until the next
// siege there. The holder's members gain more experience in that region.
//
// Faction conquest: every monster defeated in a region scores a point for the faction the player
// is most respected by. The faction with the most points this week controls the region; its
// followers gain more experience there.
//
// Raids: ten to twenty adventurers gather at the Raid Herald in Eldoria and face Aetherion's Shadow.
import { REGIONS, ZONES } from './world';

// ---------------------------------------------------------------------------------------------
// Territories and sieges
// ---------------------------------------------------------------------------------------------
/** Regions whose village can be held (every region but the capital). */
export const TERRITORIES = REGIONS.filter((z) => z !== 'eldoria');
/** A siege opens every two hours, in the next territory in turn, and lasts fifteen minutes. */
export const SIEGE_EVERY_MS = 2 * 60 * 60_000;
export const SIEGE_MS = 15 * 60_000;
export const SIEGE_LEVEL = 30;
/** Members count toward a siege within this many tiles of the village banner. */
export const SIEGE_RADIUS = 8;
/** At most this many members of one guild count at once (big guilds do not simply win). */
export const SIEGE_CAP = 10;
/** The holder defends: its members count half as much again. */
export const SIEGE_DEFENDER = 1.5;
/** The holder's members, and a faction's followers, gain this much more experience in the region. */
export const TERRITORY_EXP = 0.05;
export const FACTION_EXP = 0.05;
/** The siege at a moment: which territory, when it ends, and whether it is open now. */
export function siegeAt(now: number): { zone: string; start: number; end: number; open: boolean } {
  const k = Math.floor(now / SIEGE_EVERY_MS), start = k * SIEGE_EVERY_MS;
  return { zone: TERRITORIES[k % TERRITORIES.length], start, end: start + SIEGE_MS, open: now - start < SIEGE_MS };
}
/** The next siege of a territory (start time). */
export function nextSiegeOf(zone: string, now: number): number {
  const i = TERRITORIES.indexOf(zone);
  if (i < 0) return 0;
  let k = Math.floor(now / SIEGE_EVERY_MS);
  if (k % TERRITORIES.length === i && now - k * SIEGE_EVERY_MS < SIEGE_MS) return k * SIEGE_EVERY_MS;
  k++;
  while (k % TERRITORIES.length !== i) k++;
  return k * SIEGE_EVERY_MS;
}
/** The banner of a village: a few tiles north of its centre. */
export const bannerOf = (zone: string) => {
  const t = ZONES[zone]?.town;
  return t ? { tx: t.tx, ty: t.ty - 6 } : null;
};
export interface TerritoryState {
  zone: string;
  guild: number;
  tag: string;
  name: string;
}
export interface SiegeState {
  zone: string;
  end: number;
  /** Points per guild so far, highest first. */
  scores: { guild: number; tag: string; points: number }[];
  holder: string;
}

// ---------------------------------------------------------------------------------------------
// Faction conquest
// ---------------------------------------------------------------------------------------------
export const conquestWeek = (ms: number) => Math.floor((Math.floor(ms / 86_400_000) + 3) / 7);
/** The faction a character follows: the one that respects them most (none below Friendly, 500). */
export function followed(rep: Record<string, number>): string {
  let best = '', v = 499;
  for (const [f, n] of Object.entries(rep)) if (n > v) [best, v] = [f, n];
  return best;
}

// ---------------------------------------------------------------------------------------------
// Raids
// ---------------------------------------------------------------------------------------------
export const RAID_LEVEL = 60;
export const RAID_MIN = 10;
export const RAID_MAX = 20;
export const RAID_ZONE = 'd_raid';
export const RAID_BOSS = 'raid_shadow';
/** G7: the raids, one a week in turn; the Raid Herald names the week's. */
export const RAIDS: { boss: string; place: string }[] = [
  { boss: 'raid_shadow', place: "the Shadow's Sanctum" },
  { boss: 'raid_briar', place: 'the Briar Throne' },
  { boss: 'raid_tyrant', place: "the Tyrant's Roost" },
  { boss: 'raid_unmaker', place: 'the Edge Unmade' },
];
export const raidOfWeek = (now: number) => RAIDS[Math.floor(now / (7 * 86_400_000)) % RAIDS.length];
/** Health of everything in the raid grows with the raiders: this much per player. */
export const raidHpScale = (players: number) => 0.4 + 0.12 * Math.max(1, players);
/** The raid's waves before the boss: elite guards, more with more raiders. */
export const raidWave = (wave: number, players: number) => 3 + wave * 2 + Math.floor(players / 3);
export interface RaidLobby {
  id: number;
  leader: string;
  members: string[];
  avg: number;
}
export interface RaidState {
  stage: number;
  stages: number;
  left: number;
  state: 'active' | 'won' | 'over';
  players: number;
}
