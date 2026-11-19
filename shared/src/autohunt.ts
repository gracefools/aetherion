// Auto hunting: configuration, validation and the decisions that do not need a browser.
//
// The hunter itself runs in the client (client/src/game/autohunt.ts) and plays the character
// through exactly the commands a person's keyboard sends: movement inputs, target, attack, use
// ability, use potion. The server validates each of them as it always does, so automation gains
// nothing a player could not do by hand. The server additionally keeps the session (kills, EXP,
// items), applies the loot filter, and ends the session on death, zone change or disconnect.
import { ABILITIES, jobActives, runeSpells, type AbilityDef, type Build } from './abilities';
import { ITEMS } from './items';
import { MONSTERS } from './monsters';
import { TILE, type Job } from './protocol';

/** How a skill is used automatically. */
export type AutoKind = 'enemy' | 'area' | 'heal' | 'buff';
export interface AutoSkill {
  id: string;
  on: boolean;
  /** Lower number = tried first. */
  pri: number;
  /** Only use while the resource is at least this percentage of its maximum. */
  minMp: number;
  /** Only use when at least this many enemies would be affected. */
  minEnemies: number;
  /** Healing and protective skills: only use when own HP is below this percentage. */
  hpBelow: number;
}
export const LOOT_MODES_AUTO = ['all', 'equip', 'rare'] as const;
export type AutoLootMode = (typeof LOOT_MODES_AUTO)[number];
export const LOOT_KINDS = ['equip', 'potion', 'material', 'scroll'] as const;
export interface AutoConfig {
  attack: boolean;
  skills: boolean;
  potions: boolean;
  /** Collect items while hunting. Off: only gold is taken. */
  loot: boolean;
  /** Pick targets automatically. Off: only the target the player selects is fought. */
  target: boolean;
  /** Also fight elite monsters. Bosses are never chosen automatically. */
  elites: boolean;
  /** Also fight bosses (dungeon bosses and world bosses). Off by default. */
  bosses: boolean;
  /** Use an HP potion below this percentage of maximum HP. */
  hpPct: number;
  mpPct: number;
  /** Hunting radius in tiles around the spot where hunting started. */
  radius: number;
  skillList: AutoSkill[];
  lootMode: AutoLootMode;
  /** Item kinds that are never collected. */
  ignore: string[];
  onFull: 'stop' | 'continue';
  /** Where to walk when hunting ends by itself (bag full, out of potions and hurt). */
  returnTo: 'none' | 'start' | 'town';
  /** Spend costly skills even on a weak monster that is nearly dead. */
  finishWithSkills: boolean;
}
export const AUTO_RADIUS = { min: 4, max: 30, def: 12 };
/** A costly skill (this much resource or more) is not spent on a weak monster below this HP fraction. */
export const COSTLY = 20, NEARLY_DEAD = 0.2;

export function autoKind(def: AbilityDef): AutoKind | null {
  // only raising a fallen ally needs someone the hunter cannot choose; everything else has a use
  if (def.special === 'revive' || def.target === 'deadAlly') return null;
  if (def.target === 'enemy') return 'enemy'; // strikes, and gap closers such as Charge and Shadow Step
  if (def.taunt || def.hit?.aoeSelf || def.field?.hit || (def.field?.kind as string | undefined) === 'trap' || def.status?.some((s) => s.on === 'enemy')) return 'area';
  if (def.heal || def.field?.heal) return 'heal';
  if (def.special === 'cleanse') return 'buff';
  if (def.move) return 'buff'; // a self move (Blink, Fleet Step): off by default, the player can turn it on
  if (def.status?.some((s) => s.id === 'stealth')) return 'buff'; // an opener: the next attack reveals and strikes first
  if (def.hit?.aoeSelf || def.field?.hit || def.field?.kind === 'trap') return 'area';
  if (def.status?.some((s) => s.on === 'self' || s.on === 'ally' || s.on === 'allies') || def.barrier) return 'buff';
  return null;
}
/** How far around the caster (or the target) the skill reaches, for counting enemies. */
export const autoRadius = (def: AbilityDef) => def.hit?.aoeSelf ?? def.field?.r ?? def.hit?.aoe ?? def.hit?.splash ?? 0;
/** Every ability of this character that auto hunting may use, in hotbar order. */
export function autoAbilities(job: Job, build: Build): AbilityDef[] {
  const out = jobActives(job).filter((d) => (build.skills[d.id] ?? 0) > 0);
  for (const el of build.runes.slots) if (el) out.push(...runeSpells(el));
  return out.filter((d) => autoKind(d));
}
export function defaultAutoSkill(def: AbilityDef, pri: number): AutoSkill {
  const kind = autoKind(def)!;
  return { id: def.id, on: (kind === 'enemy' || kind === 'area') && !def.move, pri, minMp: kind === 'heal' ? 0 : 20, minEnemies: kind === 'area' ? (def.field?.kind === 'trap' ? 1 : 3) : 1, hpBelow: kind === 'heal' ? 60 : kind === 'buff' ? 100 : 100 };
}
export const DEFAULT_AUTO: AutoConfig = {
  attack: true, skills: true, potions: true, loot: true, target: true, elites: false, bosses: false, hpPct: 60, mpPct: 30, radius: AUTO_RADIUS.def,
  skillList: [], lootMode: 'all', ignore: [], onFull: 'continue', returnTo: 'none', finishWithSkills: false,
};

const pct = (v: unknown, d: number, lo = 0, hi = 100) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
/** Sanitises a configuration from a client or from storage. Unknown skills and values out of range are dropped or clamped. */
export function cleanAutoConfig(raw: unknown): AutoConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>, d = DEFAULT_AUTO;
  const seen = new Set<string>(), skillList: AutoSkill[] = [];
  if (Array.isArray(r.skillList))
    for (const s of r.skillList.slice(0, 40)) {
      const def = s && typeof s.id === 'string' ? ABILITIES[s.id] : undefined;
      if (!def || !autoKind(def) || seen.has(def.id)) continue;
      seen.add(def.id);
      const base = defaultAutoSkill(def, skillList.length);
      skillList.push({ id: def.id, on: flag(s.on, base.on), pri: pct(s.pri, base.pri, 0, 99), minMp: pct(s.minMp, base.minMp), minEnemies: pct(s.minEnemies, base.minEnemies, 1, 9), hpBelow: pct(s.hpBelow, base.hpBelow, 1, 100) });
    }
  return {
    attack: flag(r.attack, d.attack), skills: flag(r.skills, d.skills), potions: flag(r.potions, d.potions), loot: flag(r.loot, d.loot), target: flag(r.target, d.target),
    elites: flag(r.elites, d.elites), bosses: flag(r.bosses, d.bosses), hpPct: pct(r.hpPct, d.hpPct, 5, 95), mpPct: pct(r.mpPct, d.mpPct, 5, 95), radius: pct(r.radius, d.radius, AUTO_RADIUS.min, AUTO_RADIUS.max),
    skillList, lootMode: LOOT_MODES_AUTO.includes(r.lootMode) ? r.lootMode : d.lootMode,
    ignore: Array.isArray(r.ignore) ? [...new Set(r.ignore.filter((k: unknown) => (LOOT_KINDS as readonly string[]).includes(k as string)))] as string[] : [],
    onFull: r.onFull === 'stop' ? 'stop' : 'continue', returnTo: r.returnTo === 'start' || r.returnTo === 'town' ? r.returnTo : 'none', finishWithSkills: flag(r.finishWithSkills, d.finishWithSkills),
  };
}
/** The configuration with an entry for every skill the character can currently use (new skills get defaults). */
export function withSkills(cfg: AutoConfig, job: Job, build: Build): AutoConfig {
  const usable = autoAbilities(job, build), list = usable.map((def, i) => cfg.skillList.find((s) => s.id === def.id) ?? defaultAutoSkill(def, i));
  return { ...cfg, skillList: list };
}

/** Whether auto hunting collects an item under the player's loot rules. Gold is always taken. */
export function lootAllowed(cfg: AutoConfig, base: string, rar: number): boolean {
  if (!cfg.loot) return false;
  const b = ITEMS[base];
  if (!b || cfg.ignore.includes(b.kind)) return false;
  if (cfg.lootMode === 'equip') return b.kind === 'equip';
  if (cfg.lootMode === 'rare') return b.kind === 'equip' && rar >= 2;
  return true;
}

/** Whether a monster type may be chosen as a target automatically. */
export function autoTargetable(cfg: AutoConfig, type: string): boolean {
  const d = MONSTERS[type];
  return !!d && (d.boss ? cfg.bosses : cfg.elites || !d.elite);
}

/** What the hunter knows when it decides which skill to use. */
export interface SkillView {
  hpPct: number; // 0..100
  resPct: number;
  res: number;
  /** A target is selected, alive and in line of sight. */
  hasTarget: boolean;
  /** Distance to the target minus its body radius. */
  targetDist: number;
  targetHpFrac: number;
  targetElite: boolean;
  /** Enemies within a radius of the player / of the target. */
  enemiesNearMe(r: number): number;
  enemiesNearTarget(r: number): number;
  ready(id: string): boolean; // off cooldown, learned and unlocked
  cost(id: string): number;
}
/**
 * The skill to use now, or null. Skills are tried in priority order; each must be enabled, ready,
 * affordable, above its resource threshold, in range of a valid target, worth using on that many
 * enemies, and (for heals) needed.
 */
export function chooseSkill(cfg: AutoConfig, v: SkillView): string | null {
  if (!cfg.skills) return null;
  for (const s of [...cfg.skillList].sort((a, b) => a.pri - b.pri)) {
    const def = ABILITIES[s.id], kind = def && autoKind(def);
    if (!s.on || !kind || !v.ready(s.id)) continue;
    const cost = v.cost(s.id);
    if (v.res < cost || v.resPct < s.minMp) continue;
    if (kind === 'heal' || kind === 'buff') {
      if (v.hpPct >= s.hpBelow && kind === 'heal') continue;
      if (kind === 'buff' && (!v.hasTarget || v.hpPct > s.hpBelow)) continue; // buffs are for fights
      return s.id;
    }
    if (kind === 'area') {
      if (v.enemiesNearMe(autoRadius(def)) < s.minEnemies) continue;
      return s.id;
    }
    if (!v.hasTarget || v.targetDist > def.range) continue;
    const r = autoRadius(def);
    if (s.minEnemies > 1 && (r ? v.enemiesNearTarget(r) : 1) < s.minEnemies) continue;
    // not worth a costly skill: a weak monster about to die anyway
    if (!cfg.finishWithSkills && cost >= COSTLY && !v.targetElite && v.targetHpFrac < NEARLY_DEAD) continue;
    return s.id;
  }
  return null;
}

/** A monster as the hunter sees it. */
export interface TargetView {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
}
/**
 * The next target: the nearest living monster that may be hunted, inside the hunting area and
 * reachable. The current target is kept while it stays valid, so the hunter does not flit
 * between monsters. `skip` lists targets recently given up on.
 */
export function chooseTarget(cfg: AutoConfig, me: { x: number; y: number }, anchor: { x: number; y: number }, radiusPx: number, mobs: TargetView[], currentId: number, cost: (m: TargetView) => number | boolean, skip: (id: number) => boolean): number {
  // `cost`: how far the hunter must walk before it can hit the monster (Infinity or false: it cannot);
  // true means reachable at its straight-line distance
  const costOf = (m: TargetView) => {
    const c = cost(m);
    return c === true ? Math.hypot(m.x - me.x, m.y - me.y) / TILE : c === false ? Infinity : c;
  };
  const inArea = (m: TargetView) => Math.hypot(m.x - anchor.x, m.y - anchor.y) <= radiusPx;
  const cur = mobs.find((m) => m.id === currentId);
  // a target the player picked by hand is honoured even if it is an elite (or a boss, when bosses are allowed)
  if (cur && cur.hp > 0 && (!MONSTERS[cur.type]?.boss || cfg.bosses) && inArea(cur) && !skip(cur.id) && costOf(cur) < Infinity) return cur.id;
  if (!cfg.target) return 0;
  let best = 0, bd = Infinity;
  for (const m of mobs) {
    if (m.hp <= 0 || !autoTargetable(cfg, m.type) || !inArea(m) || skip(m.id)) continue;
    // the nearest by the way the hunter must actually walk, not as the crow flies
    const d = costOf(m);
    if (d < bd) {
      bd = d;
      best = m.id;
    }
  }
  return best;
}

/** Session figures kept by the server while auto hunting. */
export interface AutoStats {
  kills: number;
  exp: number;
  gold: number;
  items: number;
  /** Items left behind by the loot rules or a full bag. */
  skipped: number;
  /** Seconds since the session started. */
  secs: number;
}
export const emptyAutoStats = (): AutoStats => ({ kills: 0, exp: 0, gold: 0, items: 0, skipped: 0, secs: 0 });
