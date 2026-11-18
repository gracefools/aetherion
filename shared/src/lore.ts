// The setting of Aetherion Online: original mythology, factions and regional history.
// Lorekeepers recite these in game; docs/lore.md is the long form.
import { EXPANSION } from './expansion';
export interface Faction {
  id: string;
  name: string;
  seat: string;
  creed: string;
  about: string;
}
export const FACTIONS: Faction[] = [
  { id: 'crown', name: 'The Starfall Crown', seat: 'Eldoria', creed: 'What fell on us, we will carry.', about: 'The kingdom founded on the crater of the fallen star. Its knights and clerics hold the roads and pay the old debt: guarding what the star brought with it.' },
  { id: 'wardens', name: 'The Mossbound Wardens', seat: 'Mosswatch, Verdant Reach', creed: 'The forest keeps count.', about: 'Rangers and hermits who bargain with the old forest instead of clearing it. They believe every tree felled without need is repaid somewhere else.' },
  { id: 'forge', name: 'The Cinder Compact', seat: 'Cinderhold, Ashen Highlands', creed: 'Fire is a tool until you forget it.', about: 'Smiths and berserkers who work the dragon-heated vents. They arm every other faction and trust none of them.' },
  { id: 'hearth', name: 'The Hearthsworn', seat: 'Hearthglen, Frostveil', creed: 'One fire, shared.', about: 'Survivors of the unending winter. Their law is simple: no door is barred against the cold, and no one eats alone.' },
  { id: 'lantern', name: 'The Lantern Vigil', seat: 'Lanternfen, Dreadmoor', creed: 'Name the dead, and they stay dead.', about: 'Gravewardens who keep the rolls of the drowned battlefield. They fight the risen not from hatred but as a courtesy owed.' },
  { id: 'runewrights', name: 'The Last Runewrights', seat: 'Starfall Camp, Astral Ruins', creed: 'The seal holds while someone remembers why.', about: 'A handful of scholars living in the wreck of their own city. They taught the world rune magic and paid for it first.' },
];
export const MYTH = [
  'Before the kingdoms there was Aetherion: not a god, but a star that could be asked. The Runewrights learned its five names (Fire, Frost, Storm, Earth and Void) and wrote them down as runes.',
  'They asked for too much. The star answered all at once, and fell. Where it struck is the crater Eldoria stands on. What it broke open, far to the east, is the rift the Runewrights have been sealing ever since.',
  'The fall woke old things: a dragon under the mountain, a queen who refused to die of winter, a drowned god and the knights who drowned for it. And beyond the rift, something that calls itself a lord.',
  'Every rune a mage casts is a borrowed word of the star. That is why runes grow stronger with use: the star is slowly remembering its own names.',
];
export const LORE: Record<string, { title: string; pages: string[] }> = {
  eldoria: { title: 'Eldoria and the Starfall Crown', pages: [MYTH[0], MYTH[1], 'Eldoria was a camp first: the people who came to look at the crater and could not leave it unguarded. The plaza you stand on is the rim. Everything east of here is what the star cost us.'] },
  verdant: { title: 'The Verdant Reach', pages: ['The Reach was old when the star fell. It did not burn; it leaned away. The Wardens say the forest decided to live, and has been deciding things ever since.', 'Under the roots lies a vault the Runewrights sealed in a hurry. Its guardian still follows its last instruction: let nothing out. It no longer knows what it is guarding.', 'The Rootwarden is not a monster. It is the forest keeping count. It has simply counted you.'] },
  ashen: { title: 'The Ashen Highlands', pages: ['Vharzul slept under the mountain for an age. The starfall cracked the roof of its lair, and it has been half awake since, which is worse than either.', 'The Cinder Compact forges on the dragon\'s heat. They call it a partnership. The dragon has not been asked.', 'Hounds of ember and beetles of slag are what the mountain makes when it dreams. Put them out and they come back; the Highlands do not stay dead.'] },
  frostveil: { title: 'Frostveil', pages: ['Queen Ysolde was dying when the star fell. She asked it, as the Runewrights had, for one thing: not to. The winter is the answer she got.', 'Her court still stands in the citadel, exactly as it was. They are not her prisoners. They are her proof that nothing has changed.', 'The Hearthsworn do not hate her. They only want the spring she is standing on.'] },
  dreadmoor: { title: 'Dreadmoor', pages: ['A whole army marched east to close the rift by force. The moor took them in one night. The Lantern Vigil has been reading their names back into the mud for three hundred years.', 'Ser Maldrec led that army and swore to bring it home. He is still trying. Whatever answered his oath was not the star.', 'Beneath the fen is a temple older than the kingdoms, to a god that drowned itself to hide. The golem at its heart is not a guardian. It is a lid.'] },
  astral: { title: 'The Astral Ruins', pages: ['This was Aurelis, city of the Runewrights. When the star fell, the city went with it, halfway. Part of it is still falling.', MYTH[3], 'The Demon Lord Azgareth is not from our world and wants nothing in it. He wants the star. If he takes its names, every rune ever cast goes with them.', 'The seal is not a wall. It is a sentence the Runewrights are still writing. Every adventurer who learns a rune adds a word to it.'] },
};
for (const e of EXPANSION) LORE[e.id] = { title: e.name, pages: [e.blurb, ...e.lore] };
