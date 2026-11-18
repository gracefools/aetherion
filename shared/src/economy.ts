// Guilds, auction house and bank (M14): shared constants and rules.
import { ITEMS, RARITIES, type Item } from './items';

// ---------------------------------------------------------------------------------------------
// Guild
// ---------------------------------------------------------------------------------------------
export const GUILD_RANKS = ['Leader', 'Officer', 'Member', 'Recruit'] as const;
export type GuildPerm = 'invite' | 'kick' | 'ranks' | 'motd' | 'bank' | 'disband';
/** Highest rank index (0 = leader) allowed to do each thing. */
export const GUILD_PERMS: Record<GuildPerm, number> = { invite: 1, kick: 1, ranks: 0, motd: 1, bank: 1, disband: 0 };
export const can = (rank: number, perm: GuildPerm) => rank <= GUILD_PERMS[perm];
export const GUILD_CREATE_COST = 1000;
export const GUILD_CREATE_LEVEL = 5;
export const GUILD_NAME = /^[A-Za-z][A-Za-z ']{2,23}$/;
export const GUILD_TAG = /^[A-Z0-9]{2,4}$/;
export const GUILD_MOTD_MAX = 200;
export const GUILD_INVITE_MS = 60_000;
export const GUILD_EMBLEM_SHAPES = ['shield', 'star', 'flame', 'drop', 'bolt', 'wing', 'crown', 'tree'] as const;
export const GUILD_EMBLEM_COLORS = ['#c9a24a', '#c0483a', '#4a8ae0', '#5fae5a', '#9a7ee0', '#e0e0e0', '#e07a3a', '#3a3a4a'];
export interface Emblem {
  shape: number;
  color: number;
  bg: number;
}
export const cleanEmblem = (e: any): Emblem | null =>
  e && [e.shape, e.color, e.bg].every(Number.isInteger) && e.shape >= 0 && e.shape < GUILD_EMBLEM_SHAPES.length && e.color >= 0 && e.color < GUILD_EMBLEM_COLORS.length && e.bg >= 0 && e.bg < GUILD_EMBLEM_COLORS.length && e.color !== e.bg
    ? { shape: e.shape, color: e.color, bg: e.bg } : null;
/**
 * Guild experience comes from members' kills (GUILD_KILL_POINTS), not from their own experience,
 * so a guild of high-level members is not faster than any other. Each level asks for far more
 * than the last: with fifty active members, about two days for level 2 and several weeks for level 10.
 */
export const guildExpToNext = (level: number) => Math.round(120_000 * Math.pow(level, 1.5));
export const GUILD_KILL_POINTS = { normal: 1, elite: 5, boss: 50, world: 200 };
export const guildCapacity = (level: number) => 20 + 5 * (level - 1);
export const GUILD_MAX_LEVEL = 10;

/** Guild buildings: each level helps every member, the leader included. Bought with guild points. */
export const GUILD_BUILDINGS = ['barracks', 'treasury', 'weaponry', 'kitchen', 'fortress'] as const;
export type GuildBuilding = (typeof GUILD_BUILDINGS)[number];
export const GUILD_BUILDING_MAX = 10;
/** `pct`: percent gained per building level. */
export const GUILD_BUILDING_INFO: Record<GuildBuilding, { name: string; what: string; pct: number }> = {
  barracks: { name: 'Barracks', what: 'experience from monsters', pct: 1 },
  treasury: { name: 'Treasury', what: 'gold earned', pct: 1 },
  weaponry: { name: 'Weaponry', what: 'attack and magic attack', pct: 0.2 },
  kitchen: { name: 'Kitchen', what: 'maximum health', pct: 0.2 },
  fortress: { name: 'Fortress', what: 'defence and magic defence', pct: 0.2 },
};
export type GuildBuildings = Record<GuildBuilding, number>;
export const emptyBuildings = (): GuildBuildings => ({ barracks: 0, treasury: 0, weaponry: 0, kitchen: 0, fortress: 0 });
export function cleanBuildings(raw: unknown): GuildBuildings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, b = emptyBuildings();
  for (const k of GUILD_BUILDINGS) if (Number.isInteger(r[k]) && r[k] > 0) b[k] = Math.min(GUILD_BUILDING_MAX, r[k]);
  return b;
}
/** A guild has five points for each of its levels (so a level-10 guild can finish every building). */
export const GUILD_POINTS_PER_LEVEL = 5;
export const guildPointsLeft = (level: number, b: GuildBuildings) => Math.max(0, GUILD_POINTS_PER_LEVEL * level - GUILD_BUILDINGS.reduce((n, k) => n + b[k], 0));
/** The multiplier a building gives at its level (1 when there is no guild). */
export const guildBonus = (b: GuildBuildings | null | undefined, k: GuildBuilding) => (b ? 1 + (b[k] * GUILD_BUILDING_INFO[k].pct) / 100 : 1);
/** Weaponry, kitchen and fortress change a member's stats. */
export function applyGuild(s: { atk: number; matk: number; maxHp: number; def: number; mdef: number }, b: GuildBuildings | null | undefined) {
  if (!b) return;
  const w = guildBonus(b, 'weaponry'), k = guildBonus(b, 'kitchen'), f = guildBonus(b, 'fortress');
  s.atk = Math.round(s.atk * w); s.matk = Math.round(s.matk * w);
  s.maxHp = Math.round(s.maxHp * k);
  s.def = Math.round(s.def * f); s.mdef = Math.round(s.mdef * f);
}

export interface GuildMemberView {
  id: number;
  name: string;
  job: string;
  level: number;
  rank: number;
  online: boolean;
}
export interface GuildView {
  id: number;
  name: string;
  tag: string;
  emblem: Emblem;
  level: number;
  exp: number;
  next: number;
  motd: string;
  bank: number;
  members: GuildMemberView[];
  capacity: number;
  buildings: GuildBuildings;
  /** Guild points not yet spent on buildings. */
  points: number;
  log: { at: number; text: string }[];
}

// ---------------------------------------------------------------------------------------------
// Auction house
// ---------------------------------------------------------------------------------------------
export const AUCTION_CATEGORIES = ['weapon', 'armor', 'helmet', 'amulet', 'ring', 'potion', 'material', 'scroll', 'pet', 'mount', 'sigil'] as const;
export type AuctionCategory = (typeof AUCTION_CATEGORIES)[number];
export const categoryOf = (base: string): AuctionCategory | null => {
  const b = ITEMS[base];
  if (!b) return null;
  return b.kind === 'equip' ? (b.slot as AuctionCategory) : (b.kind as AuctionCategory);
};
export const AUCTION_HOURS = [12, 24, 48];
export const AUCTION_MAX_LISTINGS = 20;
export const AUCTION_PRICE_MAX = 100_000_000;
export const AUCTION_PAGE = 30;
/** Listing fee (paid when listing, never refunded) and sales tax (taken from the seller's proceeds), in percent. */
export interface AuctionRates {
  feePct: number;
  taxPct: number;
}
export const DEFAULT_AUCTION_RATES: AuctionRates = { feePct: 5, taxPct: 10 };
export const listingFee = (price: number, hours: number, r: AuctionRates) => Math.max(1, Math.floor((price * r.feePct * (hours / 24)) / 100));
export const saleTax = (price: number, r: AuctionRates) => Math.floor((price * r.taxPct) / 100);
export const SORTS = ['price_asc', 'price_desc', 'newest', 'ending'] as const;
export interface AuctionQuery {
  text?: string;
  cat?: AuctionCategory | '';
  minRar?: number;
  sort?: (typeof SORTS)[number];
  page?: number;
  mine?: boolean;
}
export interface Listing {
  id: number;
  seller: string;
  item: Item;
  price: number;
  expires: number;
  mine: boolean;
}
export const rarityName = (r: number) => RARITIES[r] ?? '';

// ---------------------------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------------------------
export const BANK_SIZE = 60;
export const BANK_GOLD_MAX = 1_000_000_000;
export interface Bank {
  items: Item[];
  gold: number;
}
export const emptyBank = (): Bank => ({ items: [], gold: 0 });
