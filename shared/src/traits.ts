// Region traits (G4): past level 45 every region has a signature mechanic that all its monsters
// share, so the late game plays differently region by region instead of repeating the early
// regions in new colours. The server applies them (server/src/game/Traits.ts); the client shows the
// trait when you arrive, in the HUD and on the world map.
export type TraitId = 'embers' | 'thorns' | 'chill' | 'restless' | 'phase' | 'formation' | 'volatile' | 'regrowth' | 'static' | 'null';

export interface RegionTrait {
  id: TraitId;
  name: string;
  /** What it does, in one line, for the player. */
  desc: string;
  /** How to play against it. */
  tip: string;
  color: string;
}

export const TRAITS: Record<string, RegionTrait> = {
  emberwaste: { id: 'embers', name: 'Ember Trail', color: '#ff8a3a',
    desc: 'Monsters leave burning ground where they fall.', tip: 'Step out of the fire after each kill.' },
  thornwild: { id: 'thorns', name: 'Thornbound', color: '#7fd06a',
    desc: 'Monster blows can root you in place for a moment.', tip: 'Do not fight in the open: a root in a crowd is dangerous.' },
  glacierdeep: { id: 'chill', name: 'Deep Chill', color: '#9fd8ff',
    desc: 'Monster blows chill you, slowing your steps.', tip: 'Keep your distance and keep moving.' },
  hollowfen: { id: 'restless', name: 'Restless Dead', color: '#b8a2ff',
    desc: 'A fallen monster may rise once more, weakened.', tip: 'Watch the corpses: finish what gets back up.' },
  riftlands: { id: 'phase', name: 'Phase Step', color: '#7ae0ff',
    desc: 'Monsters blink to you when you keep your distance.', tip: 'Range does not keep you safe here.' },
  crownfall: { id: 'formation', name: 'Banner Line', color: '#ffd24a',
    desc: 'Monsters fighting side by side rally and grow tougher.', tip: 'Pull them apart before you fight.' },
  cinderdeep: { id: 'volatile', name: 'Volatile', color: '#ff5a3a',
    desc: 'Monsters burst when they die. The ground warns you first.', tip: 'Back off from a dying monster.' },
  elderwood: { id: 'regrowth', name: 'Regrowth', color: '#5fd38a',
    desc: 'Monsters heal the others near them while they fight.', tip: 'Focus one down at a time.' },
  stormspire: { id: 'static', name: 'Static', color: '#b0c8ff',
    desc: 'Lightning strikes near you in a fight, and arcs between players who stand close.', tip: 'Spread out, and dodge the marked ground.' },
  voidreach: { id: 'null', name: 'Null Field', color: '#c84aff',
    desc: 'Monsters phase out for a moment and cannot be hurt.', tip: 'Switch targets while one is out of reach.' },
};
export const traitOf = (zone: string): RegionTrait | undefined => TRAITS[zone];
