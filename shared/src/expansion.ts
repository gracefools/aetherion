// Levels 45 to 200: ten more regions east of the Astral Ruins, each with a village, a dungeon and
// five monster types; five of them also hold a world boss. Pure data, read by world.ts (zones),
// monsters.ts (monsters and camps), dungeons.ts (instances) and the per-region tables (NPC names,
// music, factions). Monsters reuse the attack patterns and art of an existing monster (`from`),
// recoloured (`hue`), with stats from the level curves.
import type { Theme } from './world';
import { DEPTHS } from './depths';

export interface ExpansionMob {
  id: string;
  name: string;
  /** The existing monster whose attacks, movement and art this one borrows. */
  from: string;
}
export interface ExpansionRegion {
  id: string;
  name: string;
  theme: Theme;
  level: [number, number];
  town: string;
  seed: number;
  /** Hue rotation (degrees) applied to the borrowed monster art. */
  hue: number;
  blurb: string;
  /** Four ordinary monsters and one elite. */
  mobs: [ExpansionMob, ExpansionMob, ExpansionMob, ExpansionMob, ExpansionMob];
  dungeon: { id: string; name: string; theme: Theme; boss: ExpansionMob & { title: string; intro: string }; bossLevel: number; blurb: string };
  world?: ExpansionMob & { title: string; intro: string; level: number };
  npcs: [merchant: string, waykeeper: string, lorekeeper: string, banker: string, runesmith: string];
  /** Existing faction the region's village answers to. */
  faction: string;
  lore: string[];
}
const m = (id: string, name: string, from: string): ExpansionMob => ({ id, name, from });

export const EXPANSION: ExpansionRegion[] = [
  {
    id: 'emberwaste', name: 'Emberwaste', theme: 'ashen', level: [45, 60], town: 'Kilnspire', seed: 0xe4b001, hue: 340,
    blurb: 'A plain of glass and cinders where the starfall burned longest.',
    mobs: [m('cinderfang', 'Cinderfang', 'ember_hound'), m('slagwing', 'Slagwing Imp', 'cinder_imp'), m('obsidian_crawler', 'Obsidian Crawler', 'slag_beetle'), m('pyre_wraith', 'Pyre Wraith', 'ash_wraith'), m('molten_tyrant', 'Molten Tyrant', 'magma_brute')],
    dungeon: { id: 'crucible', name: 'The Molten Crucible', theme: 'lair', bossLevel: 50, blurb: 'A forge the size of a valley, still fed by the fallen star.',
      boss: { ...m('forgeborn_titan', 'Forgeborn Titan', 'abyssal_golem'), title: 'Hammer of the First Forge', intro: 'The crucible roars. The Forgeborn Titan rises from the slag.' } },
    npcs: ['Glassmonger Rhea', 'Waykeeper Cinder', 'Kiln-sage Obren', 'Coinwarden Tamsin', 'Runesmelter Iva'], faction: 'forge',
    lore: ['The Emberwaste was farmland once. The starfall rained here for a week, and every field turned to glass.', 'Kilnspire was built by smiths who followed the heat east. They learned to forge with starfire, and the starfire learned their names.'],
  },
  {
    id: 'thornwild', name: 'Thornwild', theme: 'forest', level: [60, 75], town: 'Briarhold', seed: 0x7a0b02, hue: 300,
    blurb: 'A forest that grew teeth when the Reach stopped counting.',
    mobs: [m('thorn_stalker', 'Thorn Stalker', 'wolf'), m('blight_spider', 'Blight Spider', 'spider'), m('rotcap', 'Rotcap', 'sporecap'), m('briar_hornet', 'Briar Hornet', 'grave_moth'), m('thornheart_ancient', 'Thornheart Ancient', 'gallows_tree')],
    dungeon: { id: 'briar_vault', name: 'The Briar Vault', theme: 'ruins', bossLevel: 65, blurb: 'A Runewright vault swallowed by roots and thorns.',
      boss: { ...m('verdant_colossus', 'Verdant Colossus', 'rune_guardian'), title: 'Root of the Sealed Vault', intro: 'Roots tear through the floor. The Verdant Colossus wakes.' } },
    world: { ...m('thorn_king', 'The Thorn King', 'shadow_knight'), level: 72, title: 'Crowned in Briars', intro: 'The Thornwild bends its branches. The Thorn King walks.' },
    npcs: ['Herbalist Wren', 'Waykeeper Bramble', 'Thornreader Isolde', 'Seedbanker Pell', 'Runegrafter Oak'], faction: 'wardens',
    lore: ['When the Wardens cut the first road east, the Thornwild closed it behind them. It has not forgiven the axe.', 'Briarhold stands where the thorns agreed to stop. Nobody remembers what was offered in exchange.'],
  },
  {
    id: 'glacierdeep', name: 'Glacierdeep', theme: 'frost', level: [75, 90], town: 'Coldharbor', seed: 0x91ac03, hue: 40,
    blurb: 'A frozen sea, older than Ysolde\'s winter and far deeper.',
    mobs: [m('rime_hound', 'Rime Hound', 'snow_stalker'), m('frost_specter', 'Frost Specter', 'ice_wisp'), m('glacial_behemoth', 'Glacial Behemoth', 'rime_yeti'), m('shardback_beetle', 'Shardback Beetle', 'glacier_beetle'), m('winter_colossus', 'Winter Colossus', 'avalanche_elder')],
    dungeon: { id: 'icebound_vault', name: 'The Icebound Vault', theme: 'citadel', bossLevel: 80, blurb: 'A palace beneath the ice where the first winter was crowned.',
      boss: { ...m('rime_empress', 'Rime Empress', 'frost_queen'), title: 'The Winter Before Winter', intro: 'The ice sings. The Rime Empress opens her eyes.' } },
    npcs: ['Icefisher Brann', 'Waykeeper Floe', 'Skald Hjordis', 'Strongbox Eyvind', 'Runecarver Sigrun'], faction: 'hearth',
    lore: ['Ysolde\'s winter was a wish. The Glacierdeep was here before her, and it does not wish for anything.', 'Coldharbor\'s ships are frozen into the sea. Its people live aboard them and wait for a thaw that was promised to their grandparents.'],
  },
  {
    id: 'hollowfen', name: 'Hollowfen', theme: 'moor', level: [90, 105], town: 'Wickmire', seed: 0x40f304, hue: 260,
    blurb: 'A fen where the drowned army\'s last legion still marches.',
    mobs: [m('mire_horror', 'Mire Horror', 'bog_lurker'), m('dusk_moth', 'Dusk Moth', 'grave_moth'), m('hollow_knight', 'Hollow Knight', 'drowned_knight'), m('fen_wyrm', 'Fen Wyrm', 'mire_serpent'), m('drowned_colossus', 'Drowned Colossus', 'gallows_tree')],
    dungeon: { id: 'sunken_crypt', name: 'The Sunken Crypt', theme: 'temple', bossLevel: 95, blurb: 'The tomb of the drowned god\'s first priest.',
      boss: { ...m('bog_leviathan', 'Bog Leviathan', 'abyssal_golem'), title: 'Tide of the Drowned God', intro: 'The crypt floods. The Bog Leviathan surfaces.' } },
    world: { ...m('lich_regent', 'The Lich Regent', 'shadow_knight'), level: 102, title: 'Steward of the Drowned Throne', intro: 'Every lantern in Hollowfen gutters. The Lich Regent holds court.' },
    npcs: ['Peddler Morrow', 'Waykeeper Wisp', 'Gravewarden Tull', 'Pawnbroker Vesna', 'Runebinder Hask'], faction: 'lantern',
    lore: ['The Lantern Vigil has read every name on Dreadmoor. In Hollowfen there are names no one living has heard.', 'Wickmire burns its lanterns day and night. The dead walk where it is dark, and it is always dark somewhere.'],
  },
  {
    id: 'riftlands', name: 'The Riftlands', theme: 'astral', level: [105, 120], town: 'Shardwatch', seed: 0x2f1f05, hue: 160,
    blurb: 'The edge of the rift, where the sky has started to come apart.',
    mobs: [m('rift_sentinel', 'Rift Sentinel', 'rune_sentinel'), m('void_manta', 'Void Manta', 'void_ray'), m('nova_wisp', 'Nova Wisp', 'star_wisp'), m('rift_stalker', 'Rift Stalker', 'astral_stalker'), m('rift_colossus', 'Rift Colossus', 'echo_colossus')],
    dungeon: { id: 'shattered_spire', name: 'The Shattered Spire', theme: 'ruins', bossLevel: 110, blurb: 'The tower from which the Runewrights first called the star.',
      boss: { ...m('spire_warden', 'Spire Warden', 'rune_guardian'), title: 'Keeper of the First Question', intro: 'The spire\'s runes ignite. The Spire Warden asks who goes there.' } },
    npcs: ['Salvager Nym', 'Waykeeper Halo', 'Rift-scholar Evander', 'Ledger-keeper Ostra', 'Rune Scholar Tamar'], faction: 'runewrights',
    lore: ['Here the seal is thinnest. The Runewrights of Shardwatch write in shifts, so the sentence is never left unfinished.', 'The spire is where the first question was asked. The Runewrights say the star is still answering it.'],
  },
  {
    id: 'crownfall', name: 'Crownfall', theme: 'kingdom', level: [120, 135], town: 'Last Bastion', seed: 0xc40f06, hue: 200,
    blurb: 'The ruins of the old empire that ruled before Eldoria.',
    mobs: [m('fallen_squire', 'Fallen Squire', 'drowned_knight'), m('grave_hound', 'Grave Hound', 'wolf'), m('crypt_spider', 'Crypt Spider', 'spider'), m('banner_wraith', 'Banner Wraith', 'ash_wraith'), m('oathless_champion', 'Oathless Champion', 'magma_brute')],
    dungeon: { id: 'throne_of_ash', name: 'The Throne of Ash', theme: 'citadel', bossLevel: 125, blurb: 'The throne room of the last emperor, who would not abdicate even to death.',
      boss: { ...m('hollow_king', 'The Hollow King', 'frost_queen'), title: 'Last Emperor of the Old Crown', intro: '"You stand before the throne. Kneel."' } },
    world: { ...m('dragon_tyrant', 'Dragon Tyrant', 'demon_lord'), level: 132, title: 'Bane of the Old Empire', intro: 'Wings blot out the sun over Crownfall. The Dragon Tyrant has returned.' },
    npcs: ['Quartermaster Hale', 'Waykeeper Aurel', 'Archivist Mira', 'Treasurer Gaius', 'Runewright Celes'], faction: 'crown',
    lore: ['Before Eldoria there was an empire. It asked the star for a crown that would never fall. It got one, and nothing else.', 'Last Bastion is the empire\'s final fortress. The Starfall Crown holds it now, and keeps the old crown locked where no one can try it on.'],
  },
  {
    id: 'cinderdeep', name: 'Cinderdeep', theme: 'ashen', level: [135, 150], town: 'Ashgate', seed: 0xc1d007, hue: 20,
    blurb: 'A chasm that runs down to the molten heart of the world.',
    mobs: [m('magma_hound', 'Magma Hound', 'ember_hound'), m('hellfire_imp', 'Hellfire Imp', 'cinder_imp'), m('lava_beetle', 'Lava Beetle', 'slag_beetle'), m('cinder_wraith', 'Cinder Wraith', 'ash_wraith'), m('volcano_lord', 'Volcano Lord', 'magma_brute')],
    dungeon: { id: 'core_of_ruin', name: 'The Core of Ruin', theme: 'lair', bossLevel: 140, blurb: 'The lair of Vharzul\'s mother, who did not sleep.',
      boss: { ...m('elder_wyrm', 'Elder Wyrm', 'ancient_dragon'), title: 'Mother of Dragons', intro: 'The core blazes white. The Elder Wyrm uncoils.' } },
    npcs: ['Smith Varga', 'Waykeeper Ash', 'Ashwife Morna', 'Vault-warden Drel', 'Runeforger Kael'], faction: 'forge',
    lore: ['The Cinder Compact found Cinderdeep by following the heat down. Some of them are still following it.', 'Ashgate is a door. The Compact built it to keep the deep shut, and they argue every night about who holds the key.'],
  },
  {
    id: 'elderwood', name: 'Elderwood', theme: 'forest', level: [150, 165], town: 'Rootsong', seed: 0xe1d008, hue: 100,
    blurb: 'The first forest, where every tree is a god that forgot itself.',
    mobs: [m('elder_wolf', 'Elder Wolf', 'wolf'), m('weaver_spider', 'Weaver Spider', 'spider'), m('spore_titan', 'Spore Titan', 'sporecap'), m('sylvan_wisp', 'Sylvan Wisp', 'ice_wisp'), m('world_tree_shard', 'World-Tree Shard', 'gallows_tree')],
    dungeon: { id: 'heartroot_hollow', name: 'Heartroot Hollow', theme: 'ruins', bossLevel: 155, blurb: 'A hollow beneath the oldest tree, where the forest keeps its count.',
      boss: { ...m('heartroot_guardian', 'Heartroot Guardian', 'rune_guardian'), title: 'Keeper of the Count', intro: 'The Hollow hums. The Heartroot Guardian has counted you.' } },
    world: { ...m('wild_god', 'The Wild God', 'demon_lord'), level: 162, title: 'The Forest That Remembers', intro: 'The Elderwood falls silent. The Wild God is awake.' },
    npcs: ['Trader Linden', 'Waykeeper Moss', 'Rootreader Ashby', 'Keeper of Seeds Yara', 'Runecarver Elm'], faction: 'wardens',
    lore: ['The Wardens say the Reach decided to live. The Elderwood is the part of it that decided to remember.', 'Rootsong sings to its trees every night. If it ever stops, the Wardens are not sure the trees will.'],
  },
  {
    id: 'stormspire', name: 'Stormspire', theme: 'frost', level: [165, 180], town: 'Galehold', seed: 0x570009, hue: 220,
    blurb: 'Mountains where the storm never ends and the lightning never misses.',
    mobs: [m('storm_stalker', 'Storm Stalker', 'snow_stalker'), m('thunder_wisp', 'Thunder Wisp', 'ice_wisp'), m('storm_giant', 'Storm Giant', 'rime_yeti'), m('gale_beetle', 'Gale Beetle', 'glacier_beetle'), m('tempest_elder', 'Tempest Elder', 'avalanche_elder')],
    dungeon: { id: 'eye_of_storm', name: 'Eye of the Storm', theme: 'citadel', bossLevel: 170, blurb: 'The calm at the centre of the storm, and the one who keeps it.',
      boss: { ...m('storm_sovereign', 'Storm Sovereign', 'frost_queen'), title: 'She Who Holds the Sky', intro: 'The wind stops. The Storm Sovereign descends.' } },
    npcs: ['Furrier Bjorn', 'Waykeeper Gale', 'Skald Runa', 'Strongbox Torvald', 'Runesinger Alva'], faction: 'hearth',
    lore: ['Storm is one of the star\'s five names. On Stormspire it is spoken all the time, and very loudly.', 'Galehold is built into the mountain, below the storm. The Hearthsworn keep their fire lit with lightning.'],
  },
  {
    id: 'voidreach', name: 'Voidreach', theme: 'astral', level: [180, 200], town: 'Edge of Stars', seed: 0x70d00a, hue: 120,
    blurb: 'Beyond the rift: the place the star fell from.',
    mobs: [m('null_sentinel', 'Null Sentinel', 'rune_sentinel'), m('abyss_ray', 'Abyss Ray', 'void_ray'), m('dying_star', 'Dying Star', 'star_wisp'), m('void_reaver', 'Void Reaver', 'astral_stalker'), m('null_colossus', 'Null Colossus', 'echo_colossus')],
    dungeon: { id: 'heart_of_aetherion', name: 'Heart of Aetherion', theme: 'temple', bossLevel: 200, blurb: 'Where the star was before it fell, and what was waiting there for it.',
      boss: { ...m('star_devourer', 'Star Devourer', 'ancient_dragon'), title: 'That Which Ate the Light', intro: 'The heart of Aetherion goes dark. The Star Devourer has come to feed.' } },
    world: { ...m('the_unmaker', 'The Unmaker', 'demon_lord'), level: 198, title: 'End of All Names', intro: 'The stars over Voidreach go out one by one. The Unmaker has come.' },
    npcs: ['Salvager Orin', 'Waykeeper Last Light', 'Last Runewright Selene', 'Ledger-scholar Vix', 'Rune Scholar Nox'], faction: 'runewrights',
    lore: ['This is where the star was, before it fell. Something else lives here now, and it is hungry.', 'Edge of Stars is the furthest camp anyone has made. Every adventurer who reaches it adds a word to the seal, and a name to the list of the missing.'],
  },
];
export const EXPANSION_BY_ID: Record<string, ExpansionRegion> = Object.fromEntries(EXPANSION.map((e) => [e.id, e]));
/** Hue rotation for monsters made from another monster's art. */
export const MONSTER_LOOK: Record<string, { from: string; hue: number }> = {};
MONSTER_LOOK.star_fragment = { from: 'star_wisp', hue: 200 };
MONSTER_LOOK.raid_shadow = { from: 'demon_lord', hue: 250 };
MONSTER_LOOK.treasure_goblin = { from: 'cinder_imp', hue: 60 };
for (const e of EXPANSION) {
  for (const x of e.mobs) MONSTER_LOOK[x.id] = { from: x.from, hue: e.hue };
  MONSTER_LOOK[e.dungeon.boss.id] = { from: e.dungeon.boss.from, hue: e.hue };
  if (e.world) MONSTER_LOOK[e.world.id] = { from: e.world.from, hue: e.hue };
}
for (const d of DEPTHS) MONSTER_LOOK[d.boss.id] = { from: d.boss.from, hue: d.hue };
