// Where a character's stats come from: the class at its level, then each source added in the
// order the server applies them (class passives and progression, skill ranks, sigil skill ranks,
// equipment item by item, armament slot by slot, sigil sets, pet and mount). The final numbers
// are the same the server computes (statuses and buffs in combat are not included).
import type { Build } from './abilities';
import { applyCompanions, type Companions } from './companions';
import { applySigilSets, armMultipliers, effectiveRanks, sigilSets, type Gear } from './gear';
import { applyJournal, type Journal } from './journal';
import { applyMastery, applyPath, type Ascension } from './ascension';
import { applyGear, SLOTS, type Equipment, type Slot } from './items';
import { computeStats, type Stats } from './jobs';
import { applyGuild, type GuildBuildings } from './economy';
import type { Job } from './protocol';

export type StatSource = 'class' | 'skills' | 'sigilSkills' | 'equip' | 'arm' | 'sigil' | 'pet' | 'journal' | 'ascension' | 'guild';
export const STAT_SOURCES: StatSource[] = ['class', 'skills', 'sigilSkills', 'equip', 'arm', 'sigil', 'pet', 'journal', 'ascension', 'guild'];
/** Stats that are shown with a breakdown. */
export const BREAKDOWN_STATS = ['maxHp', 'maxRes', 'atk', 'matk', 'def', 'mdef', 'crit', 'critDmg', 'healPower', 'lifesteal', 'dodge', 'atkIntervalMs', 'moveMul', 'range', 'runeCost'] as const;
export type BreakdownStat = (typeof BREAKDOWN_STATS)[number];
export interface StatBreakdown {
  /** The class's own value at this level (attributes only). */
  base: Record<BreakdownStat, number>;
  total: Record<BreakdownStat, number>;
  /** What each source adds (negative for attack time and rune cost, which fall). */
  by: Record<StatSource, Partial<Record<BreakdownStat, number>>>;
  /** Equipment and armament, item by item. */
  slots: { equip: Partial<Record<Slot, Partial<Record<BreakdownStat, number>>>>; arm: Partial<Record<Slot, Partial<Record<BreakdownStat, number>>>> };
  /** Sigil set effects active (for the label). */
  sets: { sym: string; tier: number }[];
}
const pick = (s: Stats) => Object.fromEntries(BREAKDOWN_STATS.map((k) => [k, s[k]])) as Record<BreakdownStat, number>;
const round = (k: BreakdownStat, v: number) => (k === 'critDmg' || k === 'healPower' || k === 'runeCost' || k === 'moveMul' ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10);
function diff(a: Stats, b: Stats): Partial<Record<BreakdownStat, number>> {
  const out: Partial<Record<BreakdownStat, number>> = {};
  for (const k of BREAKDOWN_STATS) {
    const d = round(k, b[k] - a[k]);
    if (d) out[k] = d;
  }
  return out;
}
const clone = (s: Stats): Stats => ({ ...s });

export function statBreakdown(job: Job, level: number, wslot: number, build: Build, eq: Equipment, gear: Gear, comp?: Companions | null, journal?: Journal | null, asc?: Ascension | null, guild?: GuildBuildings | null): StatBreakdown {
  const learned = build.skills, ranks = effectiveRanks(job, level, gear, learned);
  const s0 = computeStats(job, level, wslot, {}, { cls: false });
  const s1 = computeStats(job, level, wslot, {});
  const s2 = computeStats(job, level, wslot, learned);
  const s3 = computeStats(job, level, wslot, ranks);
  const s4 = clone(s3);
  applyGear(s4, eq);
  const boost = armMultipliers(gear, level), s5 = clone(s3);
  applyGear(s5, eq, boost);
  const s6 = clone(s5);
  applySigilSets(s6, gear, level);
  const s7 = clone(s6);
  if (comp) applyCompanions(s7, comp);
  const s8 = clone(s7);
  applyJournal(s8, journal);
  const s9 = clone(s8);
  if (asc) {
    applyPath(s9, asc.path, level);
    applyMastery(s9, asc.mastery);
  }
  const s10 = clone(s9);
  applyGuild(s10, guild);
  const slots: StatBreakdown['slots'] = { equip: {}, arm: {} };
  for (const sl of SLOTS) {
    const it = eq[sl];
    if (!it) continue;
    const one = clone(s3);
    applyGear(one, { [sl]: it });
    slots.equip[sl] = diff(s3, one);
    if (boost[sl]) {
      const up = clone(s3);
      applyGear(up, { [sl]: it }, { [sl]: boost[sl] });
      const d = diff(one, up);
      if (Object.keys(d).length) slots.arm[sl] = d;
    }
  }
  return {
    base: pick(s0), total: pick(s10),
    by: { class: diff(s0, s1), skills: diff(s1, s2), sigilSkills: diff(s2, s3), equip: diff(s3, s4), arm: diff(s4, s5), sigil: diff(s5, s6), pet: diff(s6, s7), journal: diff(s7, s8), ascension: diff(s8, s9), guild: diff(s9, s10) },
    slots, sets: sigilSets(gear, level).filter((x) => x.tier).map((x) => ({ sym: x.sym, tier: x.tier })),
  };
}
