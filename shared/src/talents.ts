// Talents (G2): six tiers that open at levels 30, 60, 90, 120, 160 and 200. In each tier a character picks
// exactly one of three talents, and each one changes how the character fights rather than adding a
// percentage: whom to hit, how to stay alive, what a skill does after it lands. Talents cost no
// skill points and can be changed outside combat; a respec clears them.
//
// They are stored in the build's skill map as `talent.<tier>` = choice (1 to 3), so they are saved
// and reset with the rest of the build.
export interface TalentDef {
  id: string;
  tier: number;
  name: string;
  desc: string;
}
export const TALENT_TIERS: { level: number; name: string; options: TalentDef[] }[] = [
  {
    level: 30, name: 'Way of Striking', options: [
      { id: 'momentum', tier: 1, name: 'Momentum', desc: 'Each hit on the same target deals 4% more damage, up to 5 times. Changing targets starts over.' },
      { id: 'opportunist', tier: 1, name: 'Opportunist', desc: 'Hits on targets above 90% health deal 40% more damage.' },
      { id: 'executioner_eye', tier: 1, name: "Executioner's Eye", desc: 'Hits on targets below 35% health deal 30% more damage.' },
    ],
  },
  {
    level: 60, name: 'Way of Enduring', options: [
      { id: 'bloodthirst', tier: 2, name: 'Bloodthirst', desc: 'Every kill restores 6% of your maximum health.' },
      { id: 'arcane_flow', tier: 2, name: 'Arcane Flow', desc: 'Every kill restores 8% of your mana or rage and takes 1 second off every skill cooldown.' },
      { id: 'bulwark', tier: 2, name: 'Bulwark', desc: 'Falling below half health raises a barrier worth 15% of your maximum health (once every 20 seconds).' },
    ],
  },
  {
    level: 90, name: 'Way of Mastery', options: [
      { id: 'echo', tier: 3, name: 'Echo', desc: 'Skill hits have a 20% chance to strike again for half damage.' },
      { id: 'overload', tier: 3, name: 'Overload', desc: 'Critical hits with skills take 0.5 seconds off every skill cooldown.' },
      { id: 'cleaving_blows', tier: 3, name: 'Cleaving Blows', desc: 'Basic attacks also strike up to two enemies beside the target for 40% damage.' },
    ],
  },
  {
    level: 120, name: 'Way of the Hunt', options: [
      { id: 'predator', tier: 4, name: 'Predator', desc: 'You deal 25% more damage to elites and bosses.' },
      { id: 'swiftness', tier: 4, name: 'Swiftness', desc: 'Every kill makes you 30% faster for 4 seconds.' },
      { id: 'second_wind', tier: 4, name: 'Second Wind', desc: 'A blow that would kill you leaves you at 1 health and unkillable for 5 seconds (once every 90 seconds).' },
    ],
  },
  {
    level: 160, name: 'Way of Power', options: [
      { id: 'glass_cannon', tier: 5, name: 'Glass Cannon', desc: 'You deal 20% more damage and take 15% more.' },
      { id: 'iron_skin', tier: 5, name: 'Iron Skin', desc: 'You take 15% less damage and deal 10% less.' },
      { id: 'precision', tier: 5, name: 'Precision', desc: '10% more critical chance, and critical hits deal 20% more.' },
    ],
  },
  {
    level: 200, name: 'Way of Legend', options: [
      { id: 'avatar', tier: 6, name: 'Avatar', desc: 'Every 15th hit releases a shockwave that strikes every enemy close to the target for 150% damage.' },
      { id: 'vampiric_mastery', tier: 6, name: 'Vampiric Mastery', desc: '5% of all the damage you deal heals you.' },
      { id: 'storm_caller', tier: 6, name: 'Storm Caller', desc: 'Skill hits have a 15% chance to call lightning on another enemy nearby for 100% magic damage.' },
    ],
  },
];
export const TALENTS: Record<string, TalentDef> = Object.fromEntries(TALENT_TIERS.flatMap((t) => t.options).map((o) => [o.id, o]));
export const talentKey = (tier: number) => `talent.${tier}`;
export const isTalentKey = (k: string) => k.startsWith('talent.');
/** The talent chosen in a tier, if any. */
export function talentIn(skills: Record<string, number>, tier: number): TalentDef | undefined {
  const c = skills[talentKey(tier)];
  return c ? TALENT_TIERS[tier - 1]?.options[c - 1] : undefined;
}
/** Every talent a build has chosen. */
export const talentsOf = (skills: Record<string, number>) => TALENT_TIERS.map((_, i) => talentIn(skills, i + 1)).filter((t): t is TalentDef => !!t);
/** Why a talent cannot be chosen now, or ''. Ids are `talent.<tier>.<choice>`. */
export function talentBlock(level: number, skills: Record<string, number>, id: string): string {
  const m = /^talent\.(\d)\.(\d)$/.exec(id);
  const tier = m ? Number(m[1]) : 0, choice = m ? Number(m[2]) : 0, t = TALENT_TIERS[tier - 1];
  if (!t || choice < 1 || choice > t.options.length) return 'Unknown talent';
  if (level < t.level) return `Requires level ${t.level}`;
  if (skills[talentKey(tier)] === choice) return 'Already chosen';
  return '';
}
