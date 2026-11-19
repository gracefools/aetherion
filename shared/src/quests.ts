// Quests and faction reputation (M13). Pure data and rules, shared by server and client.
// The server keeps each character's quest state and reputation, counts progress from events it
// resolved itself (kills, dungeon clears, discoveries, inventory), and hands out every reward.
import { expToNext } from './combat';
import { DUNGEONS } from './dungeons';
import { FACTIONS, type Faction } from './lore';
import { MONSTERS, SPAWNS, WORLD_BOSSES } from './monsters';
import { REGION_RES, zoneObjects } from './places';
import { EXPANSION } from './expansion';
import { REGIONS, ZONES } from './world';
import { STORY_REGIONS, storyParts, type Line } from './story';

// ---------------------------------------------------------------------------------------------
// Factions and reputation
// ---------------------------------------------------------------------------------------------
/** A faction as the game uses it. Defaults come from lore.ts; the server may load more from the database. */
export interface FactionDef extends Faction {
  /** The region whose town is the faction's seat (its lorekeeper runs the faction shop). */
  region: string;
  /** Faction shop: item, gold price, reputation level required (index into REP_LEVELS). */
  shop: [base: string, price: number, level: number][];
}
export const REP_LEVELS = [
  { name: 'Neutral', at: 0 },
  { name: 'Friendly', at: 500 },
  { name: 'Honored', at: 1500 },
  { name: 'Revered', at: 4000 },
  { name: 'Exalted', at: 9000 },
] as const;
export const REP_MAX = 12000;
export const repLevel = (points: number) => {
  let i = 0;
  while (i + 1 < REP_LEVELS.length && points >= REP_LEVELS[i + 1].at) i++;
  return i;
};
/** Reached for the first time at each level: a one-time gift from the faction. */
export const REP_GIFT: Record<number, [string, number][]> = { 1: [['hp_potion', 5]], 2: [['scroll_random', 1]], 3: [['scroll_advanced', 1]], 4: [['scroll_rare', 1]] };
const SEAT: Record<string, string> = { crown: 'eldoria', wardens: 'verdant', forge: 'ashen', hearth: 'frostveil', lantern: 'dreadmoor', runewrights: 'astral' };
const SHOP: Record<string, [string, number, number][]> = {
  crown: [['hp_potion', 16, 0], ['scroll_fire', 220, 1], ['pet_iron_pup', 1800, 2], ['mount_plains_strider', 3000, 3]],
  wardens: [['mana_potion', 20, 0], ['scroll_wind', 220, 1], ['pet_moss_sprout', 1800, 2], ['mount_plains_strider', 2800, 3]],
  forge: [['upgrade_stone', 130, 0], ['scroll_earth', 220, 1], ['pet_ember_kit', 1800, 2], ['mount_ashen_charger', 6000, 3]],
  hearth: [['hp_potion', 16, 0], ['scroll_water', 220, 1], ['pet_frost_owlet', 1800, 2], ['mount_frost_elk', 6000, 3]],
  lantern: [['mana_potion', 20, 0], ['scroll_lightning', 220, 1], ['pet_bog_toad', 1800, 2], ['mount_frost_elk', 6000, 3]],
  runewrights: [['scroll_random', 120, 0], ['scroll_advanced', 500, 2], ['pet_star_mote', 2400, 3], ['mount_void_skiff', 12000, 4]],
};
export const DEFAULT_FACTIONS: FactionDef[] = FACTIONS.map((f) => ({ ...f, region: SEAT[f.id], shop: SHOP[f.id] ?? [] }));
/** The faction whose seat is in a region. */
export const factionOfRegion = (factions: FactionDef[], zone: string) => factions.find((f) => f.region === zone);

// ---------------------------------------------------------------------------------------------
// Quest definitions
// ---------------------------------------------------------------------------------------------
export const QUEST_TYPES = ['main', 'side', 'daily', 'repeatable', 'dungeon', 'boss', 'collect', 'faction', 'explore'] as const;
export type QuestType = (typeof QUEST_TYPES)[number];
export type Objective =
  | { kind: 'kill'; mob?: string; zone?: string; n: number; label: string }
  | { kind: 'collect'; item: string; n: number; label: string }
  | { kind: 'discover'; zone: string; n: number; label: string }
  | { kind: 'clear'; dungeon: string; n: number; label: string }
  | { kind: 'boss'; mob: string; n: number; label: string }
  /** Speak to a townsperson (counted when the player opens a conversation with them). */
  | { kind: 'talk'; npc: string; n: number; label: string }
  /** Reach a place: within r map pixels of (x, y) in a zone. */
  | { kind: 'visit'; zone: string; x: number; y: number; r: number; n: number; label: string }
  /** Recover story items: each kill of the monster has this chance to yield one. */
  | { kind: 'loot'; mob: string; n: number; chance: number; label: string };
export interface QuestDef {
  id: string;
  name: string;
  type: QuestType;
  /** The region whose town gives the quest. Accept and turn in with the giver there. */
  zone: string;
  /** The townsperson who gives it (an object id); the region's lorekeeper when absent. */
  giver?: string;
  /** Story quests: what is said when it is offered and when it is handed in. */
  intro?: Line[];
  outro?: Line[];
  level: number;
  prereq: string[];
  /** Faction quests: the reputation level needed to be offered the quest. */
  rep?: [faction: string, level: number];
  text: string;
  objectives: Objective[];
  reward: { exp: number; gold: number; items: [string, number][]; rep: [string, number][] };
  /** once, once per (UTC) day, or as often as the player likes. */
  repeat: 'once' | 'day' | 'always';
}
export const giverId = (q: QuestDef) => q.giver ?? `lorekeeper:${q.zone}`;
export const MAX_ACTIVE_QUESTS = 15;
export const HISTORY_SIZE = 50;

const name = (mob: string) => MONSTERS[mob].name;
const plural = (mob: string, n: number) => (n === 1 ? name(mob) : `${name(mob)}${/s$/.test(name(mob)) ? '' : 's'}`);
const exp = (level: number, f: number) => Math.round(expToNext(level) * f);

function regionQuests(zone: string, i: number): QuestDef[] {
  const z = ZONES[zone], lv = z.level[0], hi = z.level[1], f = SEAT_OF[zone], groups = SPAWNS[zone];
  const ordinary = groups.filter((g) => !MONSTERS[g.type].elite && !MONSTERS[g.type].boss), elite = groups.find((g) => MONSTERS[g.type].elite)!;
  const [a, b, c] = [ordinary[0], ordinary[1] ?? ordinary[0], ordinary[2] ?? ordinary[0]];
  const res = REGION_RES[zone][1], prev = i ? `main_${REGIONS[i - 1]}` : null;
  const q = (o: Omit<QuestDef, 'zone' | 'prereq' | 'reward'> & { prereq?: string[]; reward: Partial<QuestDef['reward']> }): QuestDef =>
    ({ zone, prereq: [], ...o, reward: { exp: 0, gold: 0, items: [], rep: [], ...o.reward } });
  return [
    q({ id: `main_${zone}`, name: MAIN_NAMES[zone], type: 'main', level: lv, prereq: prev ? [prev] : [], repeat: 'once',
      text: MAIN_TEXT[zone], intro: [['L', MAIN_TEXT[zone]]], objectives: [{ kind: 'kill', mob: elite.type, n: 1, label: `Defeat ${name(elite.type)}` }, { kind: 'kill', mob: a.type, n: 6, label: `Defeat 6 ${plural(a.type, 6)}` }],
      reward: { exp: exp(lv + 1, 0.8), gold: 60 * lv, items: [['scroll_random', 1]], rep: [[f, 250]] } }),
    q({ id: `side_${zone}`, name: `Trouble on the Roads of ${z.name}`, type: 'side', level: lv, repeat: 'once',
      text: `Travellers keep turning back. Thin out the ${plural(b.type, 2)} and ${plural(c.type, 2)} that hunt the roads of ${z.name}.`,
      objectives: [{ kind: 'kill', mob: b.type, n: 6, label: `Defeat 6 ${plural(b.type, 6)}` }, { kind: 'kill', mob: c.type, n: 4, label: `Defeat 4 ${plural(c.type, 4)}` }],
      reward: { exp: exp(lv, 0.4), gold: 30 * lv, items: [['hp_potion', 3]], rep: [[f, 120]] } }),
    q({ id: `hunt_${zone}`, name: `Bounty: ${plural(a.type, 2)}`, type: 'repeatable', level: lv, repeat: 'always',
      text: `A standing bounty, paid every time: ten ${plural(a.type, 10)}.`,
      objectives: [{ kind: 'kill', mob: a.type, n: 10, label: `Defeat 10 ${plural(a.type, 10)}` }],
      reward: { exp: exp(lv, 0.2), gold: 15 * lv, rep: [[f, 30]] } }),
    q({ id: `daily_${zone}`, name: `${z.name} Patrol`, type: 'daily', level: lv, repeat: 'day',
      text: `The day's patrol: clear twenty creatures anywhere in ${z.name}. The board resets at midnight (UTC).`,
      objectives: [{ kind: 'kill', zone, n: 20, label: `Defeat 20 monsters in ${z.name}` }],
      reward: { exp: exp(lv, 0.45), gold: 40 * lv, items: [['scroll_random', 1]], rep: [[f, 90]] } }),
    q({ id: `collect_${zone}`, name: `Supplies for ${z.town!.name}`, type: 'collect', level: lv, repeat: 'always',
      text: `Bring five units of the region's ${RES_NAME[res]}. They are handed over when you turn the quest in.`,
      objectives: [{ kind: 'collect', item: res, n: 5, label: `Gather 5 ${RES_NAME[res]}` }],
      reward: { exp: exp(lv, 0.15), gold: 25 * lv, rep: [[f, 40]] } }),
    q({ id: `explore_${zone}`, name: `Secrets of ${z.name}`, type: 'explore', level: lv, repeat: 'once',
      text: `Two hidden caches lie somewhere in ${z.name}, far from any road. Find them both.`,
      objectives: [{ kind: 'discover', zone, n: zoneObjects(zone).filter((o) => o.kind === 'cache').length, label: 'Find the hidden caches of the region' }],
      reward: { exp: exp(hi, 0.5), gold: 50 * lv, items: [['scroll_random', 1]], rep: [[f, 150]] } }),
    q({ id: `faction_${zone}`, name: `In Service of ${FACTION_NAME[f]}`, type: 'faction', level: lv, rep: [f, 1], repeat: 'always',
      text: `${FACTION_NAME[f]} trusts you now. Defeat fifteen creatures in ${z.name}, including two of the region's ${plural(c.type, 2)}.`,
      objectives: [{ kind: 'kill', zone, n: 15, label: `Defeat 15 monsters in ${z.name}` }, { kind: 'kill', mob: c.type, n: 2, label: `Defeat 2 ${plural(c.type, 2)}` }],
      reward: { exp: exp(lv, 0.3), gold: 35 * lv, rep: [[f, 200]] } }),
  ];
}
const SEAT_OF: Record<string, string> = Object.fromEntries(Object.entries(SEAT).map(([fid, z]) => [z, fid]));
for (const e of EXPANSION) SEAT_OF[e.id] = e.faction;
const FACTION_NAME: Record<string, string> = Object.fromEntries(FACTIONS.map((x) => [x.id, x.name]));
const RES_NAME: Record<string, string> = { iron_ore: 'Iron Ore', moonleaf: 'Moonleaf', star_shard: 'Star Shards' };
const MAIN_NAMES: Record<string, string> = {
  eldoria: 'The Crater Watch', verdant: 'What the Forest Counts', ashen: 'Under the Breathing Mountain', frostveil: 'The Winter That Stayed', dreadmoor: 'Names in the Mud', astral: 'The Falling City',
};
const MAIN_TEXT: Record<string, string> = {
  eldoria: 'The Starfall Crown asks every newcomer to stand one watch on the crater rim. Prove yourself against what prowls the fields of Eldoria.',
  verdant: 'The Wardens say the forest is restless: something old has woken near the vault. Find it and quiet it.',
  ashen: 'The Cinder Compact will not deal with strangers. Earn their respect where the vents burn hottest.',
  frostveil: 'Hearthglen shares its fire with anyone who keeps the cold out. Hold back what the winter sends.',
  dreadmoor: 'The Lantern Vigil reads the names of the drowned. Help them put the risen back where they belong.',
  astral: 'The Last Runewrights need the ruins quiet for one more seal. Clear the way.',
};
for (const e of EXPANSION) {
  MAIN_NAMES[e.id] = `The Road to ${e.town}`;
  MAIN_TEXT[e.id] = `${e.blurb} ${e.town} needs someone who can hold the road. Prove yourself against what hunts in ${e.name}.`;
}

function dungeonQuests(): QuestDef[] {
  return Object.values(DUNGEONS).map((d) => {
    const zone = REGIONS.find((r) => ZONES[r].gates?.some((g) => g.dungeon === d.id))!, f = SEAT_OF[zone];
    return {
      id: `dungeon_${d.id}`, name: `Into ${d.name}`, type: 'dungeon', zone, level: d.minLevel, prereq: [], repeat: 'always',
      text: `${d.blurb} Fight through to ${MONSTERS[d.boss].name} and clear the dungeon, on any difficulty.`,
      objectives: [{ kind: 'clear', dungeon: d.id, n: 1, label: `Clear ${d.name}` }],
      reward: { exp: exp(d.level, 0.6), gold: 80 * d.level, items: [['upgrade_stone', 2]], rep: [[f, 150]] },
    } satisfies QuestDef;
  });
}
function bossQuests(): QuestDef[] {
  return WORLD_BOSSES.map((b) => ({
    id: `boss_${b.type}`, name: `The ${MONSTERS[b.type].name}`, type: 'boss', zone: b.zone, level: MONSTERS[b.type].level - 4, prereq: [], repeat: 'always',
    text: `${MONSTERS[b.type].boss!.intro} Take part in bringing it down.`,
    objectives: [{ kind: 'boss', mob: b.type, n: 1, label: `Help defeat ${MONSTERS[b.type].name}` }],
    reward: { exp: exp(MONSTERS[b.type].level, 1), gold: 200 * MONSTERS[b.type].level, items: [['scroll_advanced', 1]], rep: [[SEAT_OF[b.zone], 300]] },
  } satisfies QuestDef));
}
/** The main story's chapter in each region (shared/src/story.ts): three steps after the region's main quest. */
function storyQuests(): QuestDef[] {
  return STORY_REGIONS.flatMap((zone) => {
    const parts = storyParts(zone)!, z = ZONES[zone], lv = z.level[0], hi = z.level[1], f = SEAT_OF[zone];
    return parts.steps.map((st, i): QuestDef => ({
      id: st.id, name: st.name, type: 'main', zone, giver: st.giver, level: Math.min(hi, lv + i), repeat: 'once',
      prereq: [i ? parts.steps[i - 1].id : `main_${zone}`], text: st.text, intro: st.intro, outro: st.outro,
      objectives: st.objectives as Objective[],
      reward: { exp: exp(lv + i, [0.6, 0.7, 1.1][i]), gold: [40, 60, 120][i] * lv, items: i === 2 ? [['scroll_advanced', 1], ['upgrade_stone', 2]] : [['hp_potion', 3]], rep: [[f, [150, 200, 400][i]]] },
    }));
  });
}
export const QUEST_LIST: QuestDef[] = [...REGIONS.flatMap((z, i) => regionQuests(z, i)), ...storyQuests(), ...dungeonQuests(), ...bossQuests()];
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(QUEST_LIST.map((q) => [q.id, q]));

// ---------------------------------------------------------------------------------------------
// Per-character state
// ---------------------------------------------------------------------------------------------
export interface QuestState {
  /** Accepted quests: progress per objective (kills, clears; collect and discover are read live). */
  active: Record<string, { p: number[]; at: number }>;
  /** Completed quests: how many times, and the UTC day of the last completion. */
  done: Record<string, { n: number; day: number }>;
  /** Most recent completions, newest first. */
  hist: { id: string; at: number }[];
}
export const emptyQuests = (): QuestState => ({ active: {}, done: {}, hist: [] });
export const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

/** Sanitises stored quest state: unknown quests are dropped, numbers clamped. */
export function cleanQuests(raw: unknown): QuestState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any, out = emptyQuests();
  const int = (v: unknown, hi = 1e9) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(hi, v as number) : 0);
  for (const [id, a] of Object.entries(r.active ?? {})) {
    const q = QUESTS[id];
    if (!q || !a || typeof a !== 'object' || Object.keys(out.active).length >= MAX_ACTIVE_QUESTS) continue;
    out.active[id] = { p: q.objectives.map((o, i) => int((a as any).p?.[i], o.n)), at: int((a as any).at, 1e15) };
  }
  for (const [id, d] of Object.entries(r.done ?? {})) if (QUESTS[id] && d && typeof d === 'object') out.done[id] = { n: int((d as any).n) , day: int((d as any).day) };
  if (Array.isArray(r.hist)) out.hist = r.hist.filter((h: any) => h && QUESTS[h.id] && Number.isFinite(h.at)).slice(0, HISTORY_SIZE).map((h: any) => ({ id: h.id, at: h.at }));
  return out;
}
export function cleanRep(raw: unknown, factions: FactionDef[] = DEFAULT_FACTIONS): Record<string, number> {
  const out: Record<string, number> = {}, r = (raw && typeof raw === 'object' ? raw : {}) as any;
  for (const f of factions) if (Number.isInteger(r[f.id]) && r[f.id] > 0) out[f.id] = Math.min(REP_MAX, r[f.id]);
  return out;
}

/** What the player knows about their own state, for progress that is read live. */
export interface QuestCtx {
  count(base: string): number;
  /** Hidden caches found in a zone. */
  found(zone: string): number;
}
export function progressOf(q: QuestDef, a: { p: number[] }, ctx: QuestCtx): number[] {
  return q.objectives.map((o, i) => Math.min(o.n, o.kind === 'collect' ? ctx.count(o.item) : o.kind === 'discover' ? ctx.found(o.zone) : a.p[i] ?? 0));
}
export const isComplete = (q: QuestDef, a: { p: number[] }, ctx: QuestCtx) => progressOf(q, a, ctx).every((v, i) => v >= q.objectives[i].n);

/** Why a quest cannot be accepted ('' if it can). */
export function acceptBlock(q: QuestDef, s: QuestState, level: number, rep: Record<string, number>, now: number): string {
  if (s.active[q.id]) return 'You already have this quest';
  if (Object.keys(s.active).length >= MAX_ACTIVE_QUESTS) return `You can have at most ${MAX_ACTIVE_QUESTS} quests at once`;
  if (level < q.level) return `Requires level ${q.level}`;
  for (const id of q.prereq) if (!s.done[id]) return `First complete "${QUESTS[id]?.name ?? id}"`;
  if (q.rep && repLevel(rep[q.rep[0]] ?? 0) < q.rep[1]) return `Requires ${REP_LEVELS[q.rep[1]].name} reputation with ${FACTION_NAME[q.rep[0]] ?? q.rep[0]}`;
  const d = s.done[q.id];
  if (d && q.repeat === 'once') return 'Already completed';
  if (d && q.repeat === 'day' && d.day >= utcDay(now)) return 'Completed today: available again after midnight (UTC)';
  return '';
}
/** Quests a giver offers to this character right now. */
export const offeredAt = (zone: string, s: QuestState, level: number, rep: Record<string, number>, now: number) =>
  QUEST_LIST.filter((q) => q.zone === zone && !acceptBlock(q, s, level, rep, now));
