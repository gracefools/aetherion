// Audio rules shared by the client (playback), the build scripts (catalogue, manifest) and the tests.
// Pure data and pure functions: nothing here touches the Web Audio API or the file system.
//
// The catalogue lists every sound the game knows by id. The files themselves, their measured
// duration, provenance and licence notes live in assets/audio/manifest.json.
import type { AbilityDef } from './abilities';
import { COMBAT_TIMEOUT_MS } from './combat';
import type { WeaponKind } from './jobs';
import { EXPANSION } from './expansion';
import { T } from './world';
import type { Theme } from './world';

// ---------------------------------------------------------------------------------------------
// Settings (persisted per account, see server/src/app.ts and db/migrations/006_settings.sql)
// ---------------------------------------------------------------------------------------------
export interface AudioSettings {
  master: number; // 0..1
  music: number;
  sfx: number;
  ambient: number;
  muteAll: boolean;
  musicOn: boolean;
  sfxOn: boolean;
}
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, music: 0.6, sfx: 0.8, ambient: 0.5, muteAll: false, musicOn: true, sfxOn: true };
const VOLUME_KEYS = ['master', 'music', 'sfx', 'ambient'] as const;
const FLAG_KEYS = ['muteAll', 'musicOn', 'sfxOn'] as const;

/** Sanitises anything (a request body, a database row, localStorage) into valid settings. */
export function cleanAudioSettings(raw: unknown): AudioSettings {
  const out: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of VOLUME_KEYS) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  }
  for (const k of FLAG_KEYS) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  return out;
}
/** Linear slider position -> gain. Squared, so the lower half of the slider is usable. */
export const volumeToGain = (v: number) => v * v;
/** The gain of each bus for the given settings (what the mixer actually applies). */
export function busGains(s: AudioSettings): { master: number; music: number; sfx: number; ambient: number } {
  return {
    master: s.muteAll ? 0 : volumeToGain(s.master),
    music: s.musicOn ? volumeToGain(s.music) : 0,
    sfx: s.sfxOn ? volumeToGain(s.sfx) : 0,
    // ambience is environmental sound: it follows the sound-effects switch
    ambient: s.sfxOn ? volumeToGain(s.ambient) : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------
export type AudioCategory = 'music' | 'sfx' | 'ambience';
export interface AudioDef {
  id: string;
  /** Path below assets/audio, without extension. */
  path: string;
  category: AudioCategory;
  loop: boolean;
  title: string;
  /** What makes the game play it. */
  trigger: string;
  /** Associated map, monster, class or skill (free text key:value pairs). */
  assoc: Record<string, string>;
  /** Music only. */
  location?: string;
  mood?: string;
  /** True when no game system triggers it yet (the asset is ready for a later milestone). */
  reserved?: string;
}

export const BGM = {
  MENU: 'BGM-001', CITY: 'BGM-002', VILLAGE: 'BGM-003', FOREST: 'BGM-004', ASHEN: 'BGM-005', FROST: 'BGM-006', MOOR: 'BGM-007', ASTRAL: 'BGM-008',
  COMBAT: 'BGM-009', ELITE: 'BGM-010', DUNGEON: 'BGM-011', DUNGEON_BOSS: 'BGM-012', WORLD_BOSS: 'BGM-013', VICTORY: 'BGM-014', DEFEAT: 'BGM-015', EVENT: 'BGM-016',
} as const;
export const AMB = { CITY: 'AMB-CITY', FOREST: 'AMB-FOREST', DUNGEON: 'AMB-DUNGEON', WIND: 'AMB-WIND', WATER: 'AMB-WATER' } as const;

const music = (id: string, dir: string, slug: string, title: string, location: string, mood: string, trigger: string, assoc: Record<string, string>, loop = true, reserved?: string): AudioDef =>
  ({ id, path: `music/${dir}/${id.toLowerCase()}-${slug}`, category: 'music', loop, title, location, mood, trigger, assoc, ...(reserved ? { reserved } : {}) });
const sfx = (id: string, dir: string, title: string, trigger: string, assoc: Record<string, string> = {}, reserved?: string): AudioDef =>
  ({ id, path: `sfx/${dir}/${id.replace(/^[a-z]+\./, '')}`, category: 'sfx', loop: false, title, trigger, assoc, ...(reserved ? { reserved } : {}) });
const amb = (id: string, dir: string, title: string, trigger: string, assoc: Record<string, string>): AudioDef =>
  ({ id, path: `ambience/${dir}/${id.toLowerCase()}`, category: 'ambience', loop: true, title, trigger, assoc });

export const AUDIO_DEFS: AudioDef[] = [
  // ------------------------------ music (M10 section 10.2) ------------------------------
  music(BGM.MENU, 'menu', 'main-menu', 'The Fallen Star', 'Main Menu', 'Grand orchestral fantasy, mysterious opening', 'screen:menu (sign-in, character select, character creator)', { screen: 'menu' }),
  music(BGM.CITY, 'city', 'eldoria-main-city', 'Hearth of Eldoria', 'Eldoria Main City', 'Warm medieval fantasy, peaceful, memorable melody', 'zone:eldoria', { map: 'eldoria' }),
  music(BGM.VILLAGE, 'village', 'small-village', 'Lanterns at the Gate', 'Small Village', 'Gentle acoustic fantasy, welcoming atmosphere', 'inside a village (Mosswatch, Cinderhold, Hearthglen, Lanternfen, Starfall Camp)', { map: 'verdant,ashen,frostveil,dreadmoor,astral' }),
  music(BGM.FOREST, 'forest', 'verdant-reach', 'Where the Old Trees Listen', 'Verdant Reach Forest', 'Magical woodland, flute, strings, natural ambience', 'zone:verdant', { map: 'verdant' }),
  music(BGM.ASHEN, 'volcano', 'ashen-highlands', 'The Mountain Breathes', 'Ashen Highlands', 'Dark volcanic fantasy, percussion and dramatic strings', 'zone:ashen', { map: 'ashen' }),
  music(BGM.FROST, 'snow', 'frostveil', 'Three Hundred Winters', 'Frostveil', 'Cold atmospheric fantasy, piano and orchestral textures', 'zone:frostveil', { map: 'frostveil' }),
  music(BGM.MOOR, 'swamp', 'dreadmoor', 'The Dead Keep Watch', 'Dreadmoor', 'Dark ambient fantasy, unsettling atmosphere', 'zone:dreadmoor', { map: 'dreadmoor' }),
  music(BGM.ASTRAL, 'ruins', 'astral-ruins', 'City of the Runewrights', 'Astral Ruins', 'Ancient civilization, mysterious choir and ambient textures', 'zone:astral', { map: 'astral' }),
  music(BGM.COMBAT, 'combat', 'normal-combat', 'Steel and Spark', 'Normal Combat', 'Energetic JRPG action combat', 'in combat with ordinary monsters', { situation: 'combat' }),
  music(BGM.ELITE, 'combat', 'elite-combat', 'Marked Prey', 'Elite Monster Combat', 'More intense and threatening combat', 'in combat with an elite monster', { situation: 'combat', monster: 'elite' }),
  music(BGM.DUNGEON, 'dungeon', 'dungeon-exploration', 'Beneath the Seal', 'Dungeon Exploration', 'Suspenseful, mysterious dungeon atmosphere', 'inside any dungeon instance', { map: 'd_ruins,d_lair,d_citadel,d_temple' }),
  music(BGM.DUNGEON_BOSS, 'boss', 'dungeon-boss', 'The Warden Wakes', 'Dungeon Boss', 'Epic orchestral boss encounter', 'a living dungeon boss is in the room', { monster: 'rune_guardian,ancient_dragon,frost_queen,abyssal_golem' }),
  music(BGM.WORLD_BOSS, 'boss', 'world-boss', 'Throne-Breaker', 'World Boss', 'Large-scale cinematic fantasy battle', 'a living world boss is near', { monster: 'shadow_knight,demon_lord' }),
  music(BGM.VICTORY, 'events', 'victory', 'The Field is Ours', 'Victory', 'Short triumphant orchestral theme', 'a boss falls', { situation: 'victory' }, false),
  music(BGM.DEFEAT, 'events', 'defeat', 'Until the Next Dawn', 'Defeat / Death', 'Emotional but restrained fantasy theme', 'the player dies', { situation: 'defeat' }, false),
  music(BGM.EVENT, 'events', 'special-event', 'Festival of the Star', 'Special Event', 'Festive fantasy event theme', 'a special event is active', { situation: 'event' }, true, 'no special-event system exists yet; the engine accepts the event flag'),

  // ------------------------------ movement ------------------------------
  sfx('move.step_grass', 'movement', 'Footstep on grass', 'walking or running on grass or flowers', { surface: 'grass' }),
  sfx('move.step_stone', 'movement', 'Footstep on stone', 'walking or running on cobble, paths, ash, and dungeon floors', { surface: 'stone' }),
  sfx('move.step_wood', 'movement', 'Footstep on wood', 'walking or running on wooden floors', { surface: 'wood' }, 'no map uses a wooden floor tile yet'),
  sfx('move.step_snow', 'movement', 'Footstep on snow', 'walking or running on snow (Frostveil, Frozen Citadel)', { surface: 'snow', map: 'frostveil,d_citadel' }),
  sfx('move.step_water', 'movement', 'Footstep in water', 'walking or running on flooded ground (Dreadmoor, Abyssal Temple)', { surface: 'water', map: 'dreadmoor,d_temple' }),
  sfx('move.run', 'movement', 'Running (gear and cloth)', 'layered over footsteps while running', { move: 'run' }),

  // ------------------------------ combat ------------------------------
  sfx('combat.sword_swing', 'combat', 'Sword swing', 'basic attack or slash skill with a bladed or heavy weapon', { weapon: 'sword_shield,greatsword,mace,axe,dual_axe' }),
  sfx('combat.sword_impact', 'combat', 'Sword impact', 'a sword or mace hit lands', { weapon: 'sword_shield,mace' }),
  sfx('combat.shield_block', 'combat', 'Shield block', 'a hit is blocked', { weapon: 'sword_shield' }),
  sfx('combat.greatsword_impact', 'combat', 'Greatsword impact', 'a greatsword or axe hit lands', { weapon: 'greatsword,axe,dual_axe' }),
  sfx('combat.dagger_attack', 'combat', 'Dagger attack', 'basic attack or slash skill with daggers', { weapon: 'daggers', class: 'assassin' }),
  sfx('combat.bow_release', 'combat', 'Bow release', 'basic attack or arrow skill with a bow or crossbow', { weapon: 'bow,crossbow', class: 'ranger' }),
  sfx('combat.arrow_impact', 'combat', 'Arrow impact', 'an arrow hit lands', { weapon: 'bow,crossbow', class: 'ranger' }),
  sfx('combat.staff_attack', 'combat', 'Staff attack', 'basic attack with a staff, orb or holy staff', { weapon: 'staff,orb,holy_staff', class: 'mage,cleric' }),
  sfx('combat.physical_hit', 'combat', 'Physical hit', 'a hit lands on a player other than you, or a magic weapon hit lands', {}),
  sfx('combat.critical_hit', 'combat', 'Critical hit', 'any critical hit', {}),
  sfx('combat.monster_hit', 'monsters', 'Monster hit', 'a monster takes damage', { monster: '*' }),
  sfx('combat.monster_death', 'monsters', 'Monster death', 'a monster dies', { monster: '*' }),
  sfx('combat.player_damage', 'combat', 'Player damage', 'you take damage', {}),
  sfx('combat.player_death', 'combat', 'Player death', 'you or a nearby player dies', {}),
  sfx('game.battle_start', 'combat', 'Battle start', 'a fight begins (the music switches to combat)', { situation: 'combat' }),

  // ------------------------------ rune magic (one identity per spell) ------------------------------
  sfx('rune.fireball_cast', 'rune', 'Fireball cast', 'Fireball is launched', { skill: 'fireball', element: 'fire' }),
  sfx('rune.fireball_impact', 'rune', 'Fireball impact', 'Fireball lands', { skill: 'fireball', element: 'fire' }),
  sfx('rune.flame_burst', 'rune', 'Flame Burst', 'Flame Burst erupts', { skill: 'flame_burst', element: 'fire' }),
  sfx('rune.meteor_cast', 'rune', 'Meteor Strike (falling)', 'Meteor Strike cast begins', { skill: 'meteor_strike', element: 'fire' }),
  sfx('rune.meteor_impact', 'rune', 'Meteor Strike (impact)', 'Meteor Strike lands', { skill: 'meteor_strike', element: 'fire' }),
  sfx('rune.water_bolt', 'rune', 'Water Bolt', 'Water Bolt is launched', { skill: 'water_bolt', element: 'water' }),
  sfx('rune.healing_rain', 'rune', 'Healing Rain', 'Healing Rain begins to fall', { skill: 'healing_rain', element: 'water' }),
  sfx('rune.ice_spear', 'rune', 'Ice Spear', 'Ice Spear is launched', { skill: 'ice_spear', element: 'water' }),
  sfx('rune.thunder_strike', 'rune', 'Thunder Strike', 'Thunder Strike hits', { skill: 'thunder_strike', element: 'lightning' }),
  sfx('rune.chain_lightning', 'rune', 'Chain Lightning', 'Chain Lightning arcs', { skill: 'chain_lightning', element: 'lightning' }),
  sfx('rune.stone_shield', 'rune', 'Stone Shield', 'Stone Shield forms', { skill: 'stone_shield', element: 'earth' }),
  sfx('rune.earthquake', 'rune', 'Earthquake', 'Earthquake begins', { skill: 'earthquake', element: 'earth' }),
  sfx('rune.wind_slash', 'rune', 'Wind Slash', 'Wind Slash cuts', { skill: 'wind_slash', element: 'wind' }),
  sfx('rune.tornado', 'rune', 'Tornado', 'Tornado forms', { skill: 'tornado', element: 'wind' }),

  // ------------------------------ job skills (by effect type) ------------------------------
  sfx('skill.shout', 'combat', 'Battle shout', 'shout skills (Taunt, Rallying Cry, War Cry, Blessing, Divine Aegis)', { class: 'knight,berserker,cleric' }),
  sfx('skill.buff', 'combat', 'Empowering aura', 'self-buff skills (Guard Stance, Last Stand, Elemental Surge, Frenzy, marks)', {}),
  sfx('skill.heal', 'combat', 'Healing magic', 'healing skills (Mend, Purify, Sanctuary, Resurrection) and heals you receive', { class: 'cleric' }),
  sfx('skill.shield', 'combat', 'Magic barrier', 'Mana Shield, and hits absorbed by a barrier', { class: 'mage' }),
  sfx('skill.dash', 'combat', 'Dash', 'movement skills (Blink, Fleet Step, Shadow Step, Charge)', {}),
  sfx('skill.smoke', 'combat', 'Smoke', 'Stealth and Smoke Bomb', { class: 'assassin' }),
  sfx('skill.trap_set', 'combat', 'Trap set', 'a trap is placed', { class: 'ranger' }),
  sfx('skill.trap_fire', 'combat', 'Trap sprung', 'a trap fires', { class: 'ranger' }),
  sfx('skill.arcane', 'combat', 'Arcane bolt', 'Arcane Bolt and Cataclysm', { class: 'mage' }),
  sfx('skill.holy', 'combat', 'Holy light', 'Smite', { class: 'cleric' }),
  sfx('skill.volley', 'combat', 'Arrow volley', 'Volley', { class: 'ranger' }),

  // ------------------------------ items ------------------------------
  sfx('item.potion', 'items', 'Potion use', 'a potion is drunk (confirmed by the server)', { item: 'hp_potion,mana_potion' }),
  sfx('item.pickup', 'items', 'Item pickup', 'loot is received', {}),
  sfx('item.gold', 'items', 'Gold', 'gold is received, or something is bought or sold', {}),
  sfx('item.equip', 'items', 'Equip', 'equipment is put on or taken off', {}),
  sfx('item.upgrade_ok', 'items', 'Equipment upgrade (success)', 'an upgrade succeeds', {}),
  sfx('item.upgrade_fail', 'items', 'Equipment upgrade (failure)', 'an upgrade fails', {}),
  sfx('item.drop_rare', 'items', 'Rare item drop', 'a Rare or Epic item is received', { rarity: 'Rare,Epic' }),
  sfx('item.drop_legendary', 'items', 'Legendary item drop', 'a Legendary item is received', { rarity: 'Legendary' }),
  sfx('item.drop_mythic', 'items', 'Mythic item drop', 'a Mythic item is received', { rarity: 'Mythic' }),

  // ------------------------------ gameplay ------------------------------
  sfx('game.level_up', 'ui', 'Level up', 'you gain a level', {}),
  sfx('game.quest_accept', 'ui', 'Quest accepted', 'a quest is accepted (server cue "quest")', {}),
  sfx('game.quest_complete', 'ui', 'Quest completed', 'a quest is turned in (server cue "questdone")', {}),
  sfx('game.dungeon_enter', 'environment', 'Dungeon entrance', 'you enter a dungeon instance', { map: 'd_ruins,d_lair,d_citadel,d_temple' }),
  sfx('game.boss_spawn', 'monsters', 'Boss appears', 'a living boss comes into view', { monster: 'boss' }),
  sfx('game.boss_defeat', 'monsters', 'Boss defeated', 'a boss dies', { monster: 'boss' }),
  sfx('game.world_boss_announce', 'ui', 'World Boss announcement', 'the server announces a world boss', { monster: 'shadow_knight,demon_lord' }),

  // ------------------------------ UI and environment ------------------------------
  sfx('ui.click', 'ui', 'UI click', 'any button, tab or slot is clicked', {}),
  sfx('ui.notify', 'ui', 'Notification', 'announcements, party invitations, system notices', {}),
  sfx('ui.error', 'ui', 'Refusal', 'the server or a local check refuses an action', {}),
  sfx('env.portal', 'environment', 'Portal / waystone', 'you arrive in another region', {}),
  sfx('env.gather', 'environment', 'Gathering', 'a resource node is gathered', {}),
  sfx('env.cache_open', 'environment', 'Hidden cache opened', 'a hidden cache is opened', {}),

  // ------------------------------ ambience ------------------------------
  amb(AMB.CITY, 'city', 'City ambience', 'zone:eldoria', { map: 'eldoria' }),
  amb(AMB.FOREST, 'forest', 'Forest ambience', 'zone:verdant', { map: 'verdant' }),
  amb(AMB.DUNGEON, 'dungeon', 'Dungeon ambience', 'inside any dungeon', { map: 'd_ruins,d_lair,d_citadel,d_temple' }),
  amb(AMB.WIND, 'weather', 'Wind', 'zone:ashen, zone:frostveil, zone:astral', { map: 'ashen,frostveil,astral' }),
  amb(AMB.WATER, 'water', 'Marsh water', 'zone:dreadmoor', { map: 'dreadmoor' }),
];
export const AUDIO_BY_ID: Record<string, AudioDef> = Object.fromEntries(AUDIO_DEFS.map((d) => [d.id, d]));
export const MUSIC_IDS = AUDIO_DEFS.filter((d) => d.category === 'music').map((d) => d.id);

// ---------------------------------------------------------------------------------------------
// Where each track belongs
// ---------------------------------------------------------------------------------------------
/** The exploration theme of each open-world zone. Dungeon interiors share one theme. */
export const ZONE_MUSIC: Record<string, string> = {
  eldoria: BGM.CITY, verdant: BGM.FOREST, ashen: BGM.ASHEN, frostveil: BGM.FROST, dreadmoor: BGM.MOOR, astral: BGM.ASTRAL,
};
export const ZONE_AMBIENCE: Record<string, string> = {
  eldoria: AMB.CITY, verdant: AMB.FOREST, ashen: AMB.WIND, frostveil: AMB.WIND, dreadmoor: AMB.WATER, astral: AMB.WIND,
};
// the expansion regions take the music and ambience of the original region of their theme
{
  const byTheme: Record<string, string> = { kingdom: 'eldoria', forest: 'verdant', ashen: 'ashen', frost: 'frostveil', moor: 'dreadmoor', astral: 'astral' };
  for (const e of EXPANSION) {
    const like = byTheme[e.theme] ?? 'verdant';
    ZONE_MUSIC[e.id] = like === 'eldoria' ? BGM.FOREST : ZONE_MUSIC[like];
    ZONE_AMBIENCE[e.id] = like === 'eldoria' ? AMB.FOREST : ZONE_AMBIENCE[like];
  }
}
/** A village's music takes over inside this distance (tiles) of its centre, and lets go only beyond the outer one. */
export const VILLAGE_ENTER_TILES = 10;
export const VILLAGE_LEAVE_TILES = 14;
/** Combat music stays this long after the fight is over, so a string of fights is one piece of music. */
export const COMBAT_LINGER_MS = 3000;
/** A boss within this distance (world units) takes over the music even before the first blow. */
export const BOSS_MUSIC_RANGE = 520;

export interface MusicInput {
  screen: 'menu' | 'world';
  /** Zone id from the server's welcome message. */
  zone: string;
  dungeon: boolean;
  /** Distance to the zone's village centre in tiles; Infinity when the zone has none or it is the capital. */
  villageDist: number;
  dead: boolean;
  /** Milliseconds since the last damage dealt or taken (from the server's damage events); Infinity if none. */
  sinceCombat: number;
  /** The server reports the player is auto-attacking. */
  attacking: boolean;
  /** The current fight involves an elite monster. */
  elite: boolean;
  /** A living boss is engaged or within BOSS_MUSIC_RANGE. */
  boss: '' | 'dungeon' | 'world';
  /** A special event is active (no game system sets this yet). */
  event: boolean;
}
export const MENU_INPUT: MusicInput = { screen: 'menu', zone: '', dungeon: false, villageDist: Infinity, dead: false, sinceCombat: Infinity, attacking: false, elite: false, boss: '', event: false };

/**
 * Decides which track should be playing. It is fed the authoritative state every frame and
 * holds just enough memory to keep the music from flapping:
 *  - village music has an inner and an outer boundary (hysteresis);
 *  - combat music lingers after a fight, and an elite fight stays "elite" until it is over;
 *  - a one-shot stinger (victory) runs to its end before the region theme returns.
 */
export class MusicDirector {
  private inVillage = false;
  private zone = '';
  private combatUntil = -Infinity;
  private eliteFight = false;
  private stinger = '';
  private stingerUntil = -Infinity;

  /** Starts a one-shot track that takes priority over everything but the menu and a new boss. */
  playStinger(id: string, now: number, ms: number) {
    this.stinger = id;
    this.stingerUntil = now + ms;
  }
  reset() {
    this.inVillage = false;
    this.zone = '';
    this.combatUntil = -Infinity;
    this.eliteFight = false;
    this.stinger = '';
  }
  get village() {
    return this.inVillage;
  }

  update(now: number, s: MusicInput): string {
    if (s.screen === 'menu') {
      this.reset();
      return BGM.MENU;
    }
    if (s.zone !== this.zone) {
      // arriving somewhere new: the old place's village state and fight are gone
      this.zone = s.zone;
      this.inVillage = s.villageDist <= VILLAGE_LEAVE_TILES;
      this.combatUntil = -Infinity;
      this.eliteFight = false;
    } else if (this.inVillage ? s.villageDist > VILLAGE_LEAVE_TILES : s.villageDist <= VILLAGE_ENTER_TILES) this.inVillage = !this.inVillage;

    const fighting = s.attacking || s.sinceCombat < COMBAT_TIMEOUT_MS;
    if (fighting) this.combatUntil = now + COMBAT_LINGER_MS;
    const combat = now < this.combatUntil;
    if (!combat) this.eliteFight = false;
    else if (s.elite) this.eliteFight = true;

    if (s.dead) {
      this.combatUntil = -Infinity;
      this.eliteFight = false;
      return BGM.DEFEAT;
    }
    if (s.boss) {
      this.stinger = ''; // a new boss ends any fanfare
      return s.boss === 'world' ? BGM.WORLD_BOSS : BGM.DUNGEON_BOSS;
    }
    if (this.stinger) {
      if (now < this.stingerUntil) return this.stinger;
      this.stinger = '';
    }
    if (combat) return this.eliteFight ? BGM.ELITE : BGM.COMBAT;
    if (s.event) return BGM.EVENT;
    if (s.dungeon) return BGM.DUNGEON;
    if (this.inVillage) return BGM.VILLAGE;
    return ZONE_MUSIC[s.zone] ?? BGM.CITY;
  }
}

/** Ambience bed for a place; '' = none. */
export const ambienceFor = (zone: string, dungeon: boolean, screen: 'menu' | 'world') => (screen === 'menu' ? '' : dungeon ? AMB.DUNGEON : ZONE_AMBIENCE[zone] ?? '');

/** Crossfade length (ms) for a change of music: quick into a fight, slow back out of one. */
export function fadeMs(from: string, to: string): number {
  if (!from) return 900;
  if (to === BGM.VICTORY || to === BGM.DEFEAT) return 350;
  if (to === BGM.DUNGEON_BOSS || to === BGM.WORLD_BOSS) return 900;
  if (to === BGM.COMBAT || to === BGM.ELITE) return from === BGM.COMBAT || from === BGM.ELITE ? 900 : 600;
  if (from === BGM.COMBAT || from === BGM.ELITE || from === BGM.DUNGEON_BOSS || from === BGM.WORLD_BOSS) return 2500;
  return 1800;
}
/** Exploration themes resume where they stopped when the player comes back to them. */
export const resumes = (id: string) => id !== BGM.VICTORY && id !== BGM.DEFEAT && id !== BGM.COMBAT && id !== BGM.ELITE && id !== BGM.DUNGEON_BOSS && id !== BGM.WORLD_BOSS;

// ---------------------------------------------------------------------------------------------
// Which sound belongs to which game event
// ---------------------------------------------------------------------------------------------
export type Surface = 'grass' | 'stone' | 'wood' | 'snow' | 'water';
export const STEP_SOUND: Record<Surface, string> = {
  grass: 'move.step_grass', stone: 'move.step_stone', wood: 'move.step_wood', snow: 'move.step_snow', water: 'move.step_water',
};
/** What the ground sounds like: paved tiles are stone everywhere; open ground depends on the region. */
export function surfaceOf(tile: T, theme: Theme): Surface {
  if (tile === T.Path || tile === T.Plaza || tile === T.Portal || tile === T.Gate || tile === T.Block) return theme === 'frost' && tile === T.Path ? 'snow' : 'stone';
  switch (theme) {
    case 'frost': case 'citadel': return 'snow';
    case 'moor': case 'temple': return 'water';
    case 'ashen': case 'astral': case 'ruins': case 'lair': return 'stone';
    default: return 'grass';
  }
}
/** Milliseconds between footsteps. */
export const STEP_MS = { walk: 430, run: 290 } as const;

export interface WeaponSound {
  swing: string;
  /** Playback-rate multiplier for the swing (heavier weapons sound lower). */
  swingRate: number;
  impact: string;
}
export const WEAPON_SOUND: Record<WeaponKind, WeaponSound> = {
  sword_shield: { swing: 'combat.sword_swing', swingRate: 1, impact: 'combat.sword_impact' },
  greatsword: { swing: 'combat.sword_swing', swingRate: 0.72, impact: 'combat.greatsword_impact' },
  mace: { swing: 'combat.sword_swing', swingRate: 0.85, impact: 'combat.sword_impact' },
  axe: { swing: 'combat.sword_swing', swingRate: 0.78, impact: 'combat.greatsword_impact' },
  dual_axe: { swing: 'combat.sword_swing', swingRate: 0.9, impact: 'combat.greatsword_impact' },
  daggers: { swing: 'combat.dagger_attack', swingRate: 1, impact: 'combat.physical_hit' },
  bow: { swing: 'combat.bow_release', swingRate: 1, impact: 'combat.arrow_impact' },
  crossbow: { swing: 'combat.bow_release', swingRate: 0.85, impact: 'combat.arrow_impact' },
  staff: { swing: 'combat.staff_attack', swingRate: 1, impact: 'combat.physical_hit' },
  orb: { swing: 'combat.staff_attack', swingRate: 1.18, impact: 'combat.physical_hit' },
  holy_staff: { swing: 'combat.staff_attack', swingRate: 0.9, impact: 'combat.physical_hit' },
};

export interface AbilitySound {
  /** Played when a cast with a cast time begins. */
  cast?: string;
  /** Played when the ability takes effect. */
  fx?: string;
  /** Played `impactMs` after the effect starts (projectiles, falling meteors). */
  impact?: string;
  impactMs?: number;
  /** Use the caster's weapon swing instead of a fixed sound. */
  weapon?: boolean;
}
/** Projectile flight time used by the client's visual effects (client/src/game/fx.ts TRAVEL). */
export const PROJECTILE_MS = 170;
const RUNE_SOUND: Record<string, AbilitySound> = {
  fireball: { fx: 'rune.fireball_cast', impact: 'rune.fireball_impact', impactMs: PROJECTILE_MS },
  flame_burst: { fx: 'rune.flame_burst' },
  meteor_strike: { cast: 'rune.meteor_cast', fx: 'rune.meteor_impact' },
  water_bolt: { fx: 'rune.water_bolt' },
  healing_rain: { fx: 'rune.healing_rain' },
  ice_spear: { fx: 'rune.ice_spear' },
  thunder_strike: { fx: 'rune.thunder_strike' },
  chain_lightning: { fx: 'rune.chain_lightning' },
  stone_shield: { fx: 'rune.stone_shield' },
  earthquake: { fx: 'rune.earthquake' },
  wind_slash: { fx: 'rune.wind_slash' },
  tornado: { fx: 'rune.tornado' },
};
/** The sound identity of an ability. Rune spells each have their own; job skills go by effect type. */
export function abilitySound(def: AbilityDef): AbilitySound {
  if (def.kind === 'rune') return RUNE_SOUND[def.id] ?? {};
  const v = def.fx.v;
  switch (def.fx.t) {
    case 'slash': return { weapon: true };
    case 'proj': return v === 'arrow' ? { fx: 'combat.bow_release', impact: 'combat.arrow_impact', impactMs: PROJECTILE_MS } : { fx: 'skill.arcane' };
    case 'bolt': return { fx: v === 'holy' ? 'skill.holy' : 'skill.arcane' };
    case 'ring': return { fx: v === 'shout' ? 'skill.shout' : v === 'spin' ? 'combat.sword_swing' : v === 'cataclysm' ? 'skill.arcane' : 'skill.buff' };
    case 'aura': return { fx: v === 'heal' ? 'skill.heal' : 'skill.buff' };
    case 'shield': return { fx: 'skill.shield' };
    case 'dash': return { fx: 'skill.dash' };
    case 'smoke': return { fx: 'skill.smoke' };
    case 'meteor': return { fx: 'skill.arcane' };
    case 'chain': return { fx: 'skill.arcane' };
    case 'trap': return { fx: 'skill.trap_set' };
    case 'zone': return { fx: v === 'volley' ? 'skill.volley' : v === 'sanctuary' ? 'skill.heal' : 'skill.buff' };
    default: return {};
  }
}

/** The fanfare for a piece of loot by rarity index (items.ts RARITIES); '' for ordinary loot. */
export const dropSound = (rar: number) => (rar >= 5 ? 'item.drop_mythic' : rar === 4 ? 'item.drop_legendary' : rar >= 2 ? 'item.drop_rare' : '');

// ---------------------------------------------------------------------------------------------
// Playback limits (performance guard rails, enforced by the client engine)
// ---------------------------------------------------------------------------------------------
/** Sounds further than this from the listener are not played at all (world units). */
export const HEARING_RANGE = 560;
/** At most this many sound effects at once; further requests are dropped. */
export const MAX_VOICES = 24;
/** The same sound is not started again within this many ms (area attacks hit many targets in one tick). */
export const SAME_SOUND_GAP_MS = 55;
/** Decoded music kept in memory at once (bytes of PCM). Older tracks are released. */
export const MUSIC_CACHE_BYTES = 64 * 1024 * 1024;
/** Volume (0..1) and stereo position (-1..1) of a sound at an offset from the listener. */
export function spatial(dx: number, dy: number): { vol: number; pan: number } {
  const d = Math.hypot(dx, dy);
  if (d >= HEARING_RANGE) return { vol: 0, pan: 0 };
  const k = 1 - d / HEARING_RANGE;
  return { vol: k * k, pan: Math.max(-1, Math.min(1, dx / 420)) };
}
