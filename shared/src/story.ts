// The main story (G3): "The First Sentence". A chapter in every region, three steps each, with
// spoken dialogue when a step is offered and when it is handed in.
//
// The thread: the Runewrights once asked the star Aetherion for everything at once, and it fell. The
// words of that request (the First Sentence) were broken up and hidden region by region. A cult, the
// Askers, is gathering the pieces to ask again. Sera Vale, a cartographer of the Starfall Crown, follows
// them along the Starpath and the player goes with her. In the Heart of Aetherion the sentence is
// finished differently: not "give us", but "remember yourself".
//
// Steps: 1 at the lorekeeper (speak to another townsperson, go to a landmark), 2 from that townsperson
// (recover pieces from the region's monsters), 3 back at the lorekeeper (the region's elite, or its
// dungeon). Step 1 needs the region's main quest; every step needs the one before.
import { MONSTERS, SPAWNS } from './monsters';
import { objById } from './places';
import { REGIONS, ZONES } from './world';

/** Who speaks a line: the region's lorekeeper (L), the helper townsperson (H), Sera (S), or a name. */
export type Speaker = 'L' | 'H' | 'S' | string;
export type Line = [Speaker, string];
type Helper = 'merchant' | 'waykeeper' | 'banker' | 'runesmith';

interface Chapter {
  title: string;
  steps: [string, string, string];
  helper: Helper;
  /** What step 2 recovers, and how many. */
  item: string;
  n: number;
  /** Step 3: clear the region's dungeon instead of defeating its elite. */
  dungeon?: boolean;
  lines: { i1: Line[]; o1: Line[]; i2: Line[]; o2: Line[]; i3: Line[]; o3: Line[] };
}

export const SERA = 'Sera Vale';

const CH: Record<string, Chapter> = {
  eldoria: {
    title: 'The Crater Rim', steps: ['A Map With a Hole in It', 'Pages on the Wind', 'The Watch Fire'], helper: 'waykeeper', item: 'Scorched Map Pages', n: 4,
    lines: {
      i1: [['L', 'There is a young woman from the Crown survey asking for you. Says you have the look of someone who walks far.'], ['S', 'Sera Vale, cartographer. Every map of Eldoria has the crater in the middle and nothing to the east. I mean to fix that.'], ['S', 'Ask the Waykeeper where the old survey road began, then meet me at the eastern road.']],
      o1: [['S', 'You came. Good. The Starpath starts here: the line the star drew when it fell. Someone has been walking it before us.']],
      i2: [['H', 'Sera\'s survey camp was raided two nights ago. Her pages are scattered over the fields and the Duskwings have been lining their nests with them.'], ['S', 'The pages show where the Starpath bends. Without them I am guessing.']],
      o2: [['S', 'Look at this margin. Not my hand. "The sentence is broken, not lost." Someone wrote that on my map.'], ['H', 'An odd thing for a thief to write.']],
      i3: [['L', 'The Old Tusk has trampled the watch fire on the rim every night this week. Beasts do not do that. Something is driving it.'], ['S', 'Light the watch fire again and whoever sent it will know we are coming. I like that.']],
      o3: [['L', 'There was a mark burned into its hide: an open hand under a star. The sign of the Askers.'], ['S', 'Then they are real. The Starpath goes east, into the Verdant Reach. So do we.']],
    },
  },
  verdant: {
    title: 'What the Forest Counts', steps: ['The Mossreader\'s Silence', 'Seed-Letters', 'Under the Roots'], helper: 'merchant', item: 'Seed-Letters', n: 5, dungeon: true,
    lines: {
      i1: [['S', 'Mosswatch. The Wardens do not like strangers and they like mapmakers less.'], ['L', 'The forest has stopped answering me. Ask Trader Fenna what she sold to the last strangers through here, then see the vault gate for yourself.']],
      o1: [['S', 'The vault seals are scratched. Not broken: read. Someone sat here and copied them.']],
      i2: [['H', 'They bought lamp oil and paper, and paid in old Runewright coin. The Glade Spiders took their camp after. The spiders keep whatever was written.'], ['H', 'Bring me their papers and I will tell you what I can.']],
      o2: [['H', 'Seed-letters: Runewright writing, grown into bark so it lasts. This one says "Fire, we ask you to stay".'], ['S', 'A piece of the First Sentence. The request that made the star fall. They are collecting it.']],
      i3: [['L', 'The Guardian beneath the roots still keeps its last order: let nothing out. The Askers mean to let something out. Get there first.']],
      o3: [['L', 'The Guardian is quiet. In its chamber you found an empty frame where a tablet stood.'], ['S', 'They took the first word. We are one step behind. Next is the Ashen Highlands, where Fire sleeps under a mountain.']],
    },
  },
  ashen: {
    title: 'The Borrowed Fire', steps: ['Cinderhold Does Not Talk', 'Slag-Sealed Ledgers', 'The Breathing Vent'], helper: 'banker', item: 'Slag-Sealed Ledgers', n: 4,
    lines: {
      i1: [['L', 'The Compact will not deal with strangers. Vault-warden Hesk keeps their ledgers. If the Askers paid for anything here, Hesk knows.'], ['S', 'And the Starpath runs straight under the dragon\'s lair. Of course it does.']],
      o1: [['S', 'The gate to the lair is warm to the touch. Something inside is awake enough to listen.']],
      i2: [['H', 'They bought a smith\'s silence, and the smith\'s ledgers went into the slag to hide it. The Slag Beetles swallow anything warm.'], ['H', 'Crack the beetles, bring me the ledgers, and I will forget I helped you.']],
      o2: [['H', 'Forty bars of starsteel. Shipped to Frostveil, to "the Queen\'s court". Nobody ships to the Queen\'s court.'], ['S', 'Unless the Queen is buying.']],
      i3: [['L', 'The Magma Brute keeps the vents open over Vharzul. While it breathes, the dragon dreams, and the Askers listen to the dream.'], ['S', 'They are asking the dragon for the word Fire. Put the Brute out.']],
      o3: [['L', 'The mountain is quieter. Vharzul turned over in its sleep and said one word. The Compact smiths all heard it.'], ['S', 'Fire. They have Fire and the Earth seal. The trail goes north, into the winter.']],
    },
  },
  frostveil: {
    title: 'The Winter That Stayed', steps: ['A Door That Is Never Barred', 'Frozen Petitions', 'The Avalanche Speaks'], helper: 'runesmith', item: 'Frozen Petitions', n: 5,
    lines: {
      i1: [['L', 'The Hearthsworn bar no door against the cold. So when strangers came wanting the Queen, we let them through. Ask Runesinger Yrsa what they carried.'], ['S', 'Starsteel, I would bet. Forty bars of it.']],
      o1: [['S', 'The citadel is still. The court inside has not moved in three hundred years. They are waiting for an answer, too.']],
      i2: [['H', 'They carried petitions. Written requests to the Queen, frozen into the ice by the Wisps so they cannot be unsaid.'], ['H', 'Melt them out of the Ice Wisps and read me what they ask.']],
      o2: [['H', '"Let it not end." The same words Ysolde used. The Askers are asking her to lend them her request.'], ['S', 'Frost. Her word is Frost. If she gives it, the winter goes with it, and so does she.']],
      i3: [['L', 'The Avalanche Elder speaks for the mountain. It has been told to bury the road behind the strangers so nobody follows.'], ['S', 'Then it is the road we need. Move it.']],
      o3: [['L', 'The road is open. And the Queen has sent word, for the first time in living memory: "Tell the cartographer I said no."'], ['S', 'She refused them. Then they will take the next word by force. The drowned army in Dreadmoor swore an oath, and oaths are words.']],
    },
  },
  dreadmoor: {
    title: 'Names in the Mud', steps: ['The Rolls of the Drowned', 'Waterlogged Oaths', 'The Gallows Tree'], helper: 'merchant', item: 'Waterlogged Oaths', n: 5,
    lines: {
      i1: [['L', 'The Vigil reads the names of the drowned so they stay dead. Lately some of the names have been read by someone else. Peddler Wick has been selling candles to them.'], ['S', 'Read a name and it answers. They are raising the army.']],
      o1: [['S', 'The temple gate. The water here is warm. Something under it is breathing slowly.']],
      i2: [['H', 'They paid me in drowned coin. The Drowned Knights carry their oaths sewn into their surcoats. The Askers have been cutting them loose.'], ['H', 'Bring the oaths back before someone reads them.']],
      o2: [['H', '"To bring them home." Ser Maldrec\'s oath. Whoever answered it was not the star. The Askers want whatever did answer.'], ['S', 'Storm. The night the moor swallowed the army there was a storm with no clouds.']],
      i3: [['L', 'The Gallows Tree hangs the oaths it catches. It is the Askers\' reading desk. Cut it down.']],
      o3: [['L', 'Under its roots: the Askers\' camp, abandoned in a hurry, and a list. Fire, Earth, Storm. Frost crossed out. Void at the bottom, circled.'], ['S', 'Void is in the ruins of Aurelis, where the Runewrights still hold the seal. They are going for the last word.']],
    },
  },
  astral: {
    title: 'The Falling City', steps: ['The Last Runewrights', 'Seal-Script Shards', 'The Echo'], helper: 'runesmith', item: 'Seal-Script Shards', n: 6,
    lines: {
      i1: [['L', 'You followed the Askers here. So did half the void. Rune Scholar Ilyan watches the seal; tell her what you carry, then stand on the edge of the fall with me.'], ['S', 'I have mapped every step of their road. I would like to see where it ends.']],
      o1: [['S', 'You can see the city still falling, very slowly. Every rune ever cast is holding it up.']],
      i2: [['H', 'The Rune Sentinels guard the seal-script, the sentence we are still writing to keep the rift shut. The Askers have been stealing lines of it.'], ['H', 'Recover what they dropped. A seal with holes is a door.']],
      o2: [['H', 'Some of these shards are in a newer hand. They are not breaking the seal. They are editing it.'], ['S', 'Rewriting the sentence. Turning "keep it shut" into "let it ask".']],
      i3: [['L', 'The Echo Colossus repeats whatever is said near it. The Askers have been saying the First Sentence to it, over and over, so the rift will hear.'], ['S', 'Silence it.']],
      o3: [['L', 'The rift is quieter. But four words have been spoken now. The Askers did not stop here; they went through, east, beyond the old maps.'], ['S', 'Beyond the old maps is the only place I have ever wanted to go. Come on.']],
    },
  },
  emberwaste: {
    title: 'The Forge That Was Fed', steps: ['Glass and Ash', 'Starsteel Cores', 'The Molten Tyrant'], helper: 'merchant', item: 'Starsteel Cores', n: 6,
    lines: {
      i1: [['S', 'Kilnspire. The Askers came through with forty bars of starsteel and left with none. Ask Glassmonger Rhea who melted them, and meet me at the crucible gate.']],
      o1: [['S', 'The crucible is the size of a valley, and it is still being fed. By whom?']],
      i2: [['H', 'The Cinderfangs carry hot cores in their throats. Starsteel, forged into something the Askers wanted. They feed the hounds to keep it moving.'], ['H', 'Pull the cores before they reach the forge.']],
      o2: [['H', 'Each core is stamped with a letter. Put together they spell a name: the star\'s, the true one. They are forging a key with its name on it.'], ['S', 'You do not ask with a key. You open.']],
      i3: [['L', 'The Molten Tyrant keeps the forge burning for them. Bank its fire.']],
      o3: [['L', 'The forge cools. The key was never finished, but its pattern is gone, carried north into the Thornwild.'], ['S', 'The forest that remembers. Of course.']],
    },
  },
  thornwild: {
    title: 'Briar and Memory', steps: ['The Thornreader', 'Grafted Pages', 'The Thornheart'], helper: 'runesmith', item: 'Grafted Pages', n: 6,
    lines: {
      i1: [['L', 'The Thornwild grows over anything worth forgetting. The Askers want it to forget them. Runegrafter Oak has seen their graft-work; go to them, then to the vault.']],
      o1: [['S', 'The briar vault. The thorns have grown into a shape, like handwriting.']],
      i2: [['H', 'They grafted pages into the Blight Spiders\' webs to hide them in the canopy. Cut them out.']],
      o2: [['H', 'Pages of the First Sentence, all five words, written as a promise. And a sixth word, new: "now".'], ['S', 'They are not asking. They are setting a date.']],
      i3: [['L', 'The Thornheart Ancient guards the canopy where the pages grew. It has been taught to keep them. Unteach it.']],
      o3: [['L', 'In its heart, a calendar carved in bark. The date is close, and the place is the Riftlands.'], ['S', 'Then the road goes through Glacierdeep and Hollowfen whether we like it or not. Faster.']],
    },
  },
  glacierdeep: {
    title: 'The First Winter', steps: ['Coldharbor', 'Rime-Bound Letters', 'The Winter Colossus'], helper: 'banker', item: 'Rime-Bound Letters', n: 6,
    lines: {
      i1: [['L', 'The first winter was crowned here, before Ysolde. The Askers came asking how. Strongbox Eyvind kept their letters; ask him, then see the vault for yourself.']],
      o1: [['S', 'A palace under the ice. Ysolde learned her request from someone. Here is who.']],
      i2: [['H', 'Their letters went to the Rime Hounds, frozen into the hunting trails. Each one is addressed "to the star, again".'], ['H', 'Bring them back unopened. Some letters are better unsent.']],
      o2: [['H', 'They are not to the star. They are to the Rime Empress, asking her to be a witness when they ask.'], ['S', 'A witness who once asked and was answered. They want the star to remember saying yes.']],
      i3: [['L', 'The Winter Colossus carries the Empress\'s answer. Stop it before it walks.']],
      o3: [['L', 'The Colossus fell with the answer unspoken. The Empress sent you her crown\'s cold: a gift, or a warning.'], ['S', 'A warning, I think. Hollowfen next. The drowned god\'s priest is buried there.']],
    },
  },
  hollowfen: {
    title: 'The Priest\'s Tomb', steps: ['Wickmire Lanterns', 'Drowned Prayers', 'The Drowned Colossus'], helper: 'merchant', item: 'Drowned Prayers', n: 6,
    lines: {
      i1: [['L', 'The drowned god\'s first priest knew how to ask without being heard. The Askers want that trick. Peddler Morrow sold them the lanterns; go ask him, then to the crypt.']],
      o1: [['S', 'The crypt water is still. No breath, no bubbles. Whatever was here hid itself on purpose.']],
      i2: [['H', 'The Hollow Knights hold the priest\'s prayers in their gauntlets. Prayers to be unheard. Take them.']],
      o2: [['H', 'Every prayer is the same: "do not let it see me". The Askers want to ask the star without the star seeing who asks.'], ['S', 'Cowards with a plan. The worst kind.']],
      i3: [['L', 'The Drowned Colossus keeps the priest\'s silence over the fen. Break the silence and they lose their hiding place.']],
      o3: [['L', 'The fen can see again. And it sees them: a procession, going east into the Riftlands, carrying something heavy.'], ['S', 'The key. They finished it after all.']],
    },
  },
  riftlands: {
    title: 'The Shattered Spire', steps: ['Shardwatch', 'Spire Fragments', 'The Rift Colossus'], helper: 'runesmith', item: 'Spire Fragments', n: 6, dungeon: true,
    lines: {
      i1: [['L', 'The Shattered Spire is where the Runewrights first called the star. The Askers are rebuilding it. Rune Scholar Tamar has watched their work; go to them, then to the spire gate.']],
      o1: [['S', 'They are putting the tower back together stone by stone. The first time it took a hundred years. They have done it in a season.']],
      i2: [['H', 'The Rift Sentinels carry the spire\'s fragments for them. Take the fragments and the tower cannot stand.']],
      o2: [['H', 'Every fragment is carved with the sentence. The tower is the sentence, in stone. Finished, it speaks itself.'], ['S', 'Then we stop it being finished.']],
      i3: [['L', 'At the top of the spire waits its Warden. Clear the spire before the sentence is said.']],
      o3: [['L', 'The spire fell. But the Askers were not in it. They had already gone on, to Crownfall, to find a throne.'], ['S', 'A throne for whoever asks. They want someone to ask in the name of everyone.']],
    },
  },
  crownfall: {
    title: 'The Last Emperor', steps: ['Last Bastion', 'Banners of the Oathless', 'The Oathless Champion'], helper: 'banker', item: 'Banners of the Oathless', n: 6,
    lines: {
      i1: [['L', 'The last emperor would not abdicate even to death. The Askers want him to ask, as emperor, for all of us. Treasurer Gaius knows who paid the crypt-keepers; ask him, then go to the throne gate.']],
      o1: [['S', 'This was the capital of the world, once. The crater was a province. Funny how maps change.']],
      i2: [['H', 'The Banner Wraiths carry the emperor\'s banners. Each banner is a claim: this land asks with one voice. Take them down.']],
      o2: [['H', 'Without the banners he speaks only for himself.'], ['S', 'Then let him. Nobody should ask for everyone.']],
      i3: [['L', 'The Oathless Champion guards the road to the throne. Defeat him and the emperor sits alone.']],
      o3: [['L', 'The emperor sent a message through the dead: he declines. "I asked once. It was enough."'], ['S', 'Another refusal. They are running out of voices. They will try to use the star\'s own fire next: Cinderdeep.']],
    },
  },
  cinderdeep: {
    title: 'The Mother Who Did Not Sleep', steps: ['Ashgate', 'Heartfire Embers', 'The Volcano Lord'], helper: 'merchant', item: 'Heartfire Embers', n: 6,
    lines: {
      i1: [['L', 'Vharzul\'s mother never slept. She has been listening to the star since it fell. Smith Varga sold the Askers heat-proof chains; ask her, then to the Core.']],
      o1: [['S', 'The heat here is a voice. I can almost hear words in it.']],
      i2: [['H', 'The Magma Hounds carry the mother\'s heartfire to the Askers in their mouths. Every ember is a word she remembers.'], ['H', 'Take the embers before they are spoken.']],
      o2: [['H', 'She remembers the First Sentence whole. She heard it the night it was said.'], ['S', 'Then she is the witness they need, and she is willing.']],
      i3: [['L', 'The Volcano Lord carries her answer to the surface. Stop it.']],
      o3: [['L', 'The mountain sank back. But Elderwood\'s oldest tree has started to burn from the inside.'], ['S', 'The forest keeps count. They want it to count to zero.']],
    },
  },
  elderwood: {
    title: 'The Count', steps: ['Rootsong', 'Count-Rings', 'The World Tree Shard'], helper: 'runesmith', item: 'Count-Rings', n: 6,
    lines: {
      i1: [['L', 'The oldest tree counts every year since the star fell. If it reaches the count of the Fall again, the Fall repeats. Runecarver Elm can read the rings; go to them, then to the Hollow.']],
      o1: [['S', 'The Hollow is warm and hums. It sounds like counting.']],
      i2: [['H', 'The Weaver Spiders spin the count-rings out of the tree and carry them away. Each ring is a year. Bring the years back.']],
      o2: [['H', 'They have been taking years out so the count runs short. Short enough to land on the night of the Fall.'], ['S', 'They are setting the clock. Stormspire next: the storm with no clouds was born there.']],
      i3: [['L', 'The World Tree Shard is the tree\'s own guard. It has been turned to count for them. Turn it back.']],
      o3: [['L', 'The tree counts true again. You gave it back three hundred years.'], ['S', 'That is a sentence I would like to write on a map.']],
    },
  },
  stormspire: {
    title: 'The Storm With No Clouds', steps: ['Galehold', 'Thunder-Sealed Words', 'The Tempest Elder'], helper: 'banker', item: 'Thunder-Sealed Words', n: 6,
    lines: {
      i1: [['L', 'The storm that drowned Maldrec\'s army was the star answering. It still blows here. Strongbox Torvald sold the Askers storm-glass; ask him, then go to the Eye.']],
      o1: [['S', 'In the Eye it is perfectly still. Someone keeps it that way, and listens.']],
      i2: [['H', 'The Thunder Wisps carry sealed words: the answers the star gave, kept in lightning. The Askers want the answers before they ask.'], ['H', 'Unseal them, and the answers go to whoever holds them. Be careful who that is.']],
      o2: [['H', 'Every answer is the same word: "yes".'], ['S', 'The star never said no. That was the problem. It is still the problem.']],
      i3: [['L', 'The Tempest Elder guards the storm so the Askers can stand in its eye. Bring it down.']],
      o3: [['L', 'The storm broke. The Askers are already at the Edge of Stars, where the star was before it fell.'], ['S', 'Then that is the last place on my map. Let\'s finish it.']],
    },
  },
  voidreach: {
    title: 'The First Sentence', steps: ['The Edge of Stars', 'The Askers\' Words', 'Remember Yourself'], helper: 'runesmith', item: 'The Askers\' Words', n: 8, dungeon: true,
    lines: {
      i1: [['L', 'You are the cartographer and her friend. The Askers are inside the Heart already, saying the sentence. Rune Scholar Nox will tell you how far they have got; then to the gate.'], ['S', 'All the way here, I kept thinking: what would I ask for, if I could? I still do not know.']],
      o1: [['S', 'Inside, the star is waiting where it used to be. It looks smaller than I thought. And tired.']],
      i2: [['H', 'The Askers speak through the Null Sentinels, word by word. Silence the Sentinels and you take the words out of their mouths.'], ['H', 'Gather them. You will need them.']],
      o2: [['H', 'Here is the First Sentence, whole, in your hands: "Give us everything, now." That is what they meant to say.'], ['S', 'Then we say something else. The star does not need more asking. It needs someone to ask it nothing, and remind it who it is.']],
      i3: [['L', 'In the Heart waits what the Askers woke: the Star Devourer. Clear the Heart, and finish the sentence your way.'], ['S', 'Together. I want to see the last line of the map.']],
      o3: [['S', 'You said it: "Remember yourself." And the star did. All five names at once, softly this time.'], ['L', 'Every rune in the world feels lighter tonight. The Askers have nothing left to ask with.'], ['S', 'My map has no empty space in the east any more. I think I will start a new one.']],
    },
  },
};

export interface StoryStep {
  id: string;
  zone: string;
  step: 1 | 2 | 3;
  chapter: string;
  name: string;
  giver: string;
  intro: Line[];
  outro: Line[];
}
/** Story steps by quest id (the quest definitions themselves are built in quests.ts). */
export const STORY: Record<string, StoryStep> = {};
export const storyChapter = (zone: string) => CH[zone];

/** The name to show for a speaker in a region. */
export function speakerName(s: Speaker, zone: string): string {
  if (s === 'S') return SERA;
  const c = CH[zone];
  if (s === 'L') return objById(`lorekeeper:${zone}`)?.name ?? 'Lorekeeper';
  if (s === 'H' && c) return objById(`${c.helper}:${zone}`)?.name ?? 'Townsperson';
  return s;
}

/** Where step 1 sends the player: the region's dungeon gate, else its far portal, else its town. */
export function landmark(zone: string): { x: number; y: number; name: string } {
  const z = ZONES[zone], T = 32, g = z.gates?.[0];
  if (g) return { x: g.tx * T + 16, y: g.ty * T + 16, name: 'the dungeon gate' };
  const p = [...(z.portals ?? [])].sort((a, b) => b.tx - a.tx)[0];
  if (p) return { x: p.tx * T + 16, y: p.ty * T + 16, name: 'the eastern road' };
  return { x: z.town!.tx * T, y: z.town!.ty * T, name: 'the town square' };
}

export interface StoryQuestParts {
  zone: string;
  steps: { id: string; name: string; giver: string; text: string; objectives: unknown[]; intro: Line[]; outro: Line[] }[];
}

/** The three steps of a region's chapter, ready to become quests. */
export function storyParts(zone: string): StoryQuestParts | null {
  const c = CH[zone];
  if (!c) return null;
  const groups = SPAWNS[zone] ?? [], ord = groups.filter((g) => !MONSTERS[g.type].elite && !MONSTERS[g.type].boss);
  const elite = groups.find((g) => MONSTERS[g.type].elite)?.type, src = (ord[1] ?? ord[0])?.type;
  const lm = landmark(zone), helperId = `${c.helper}:${zone}`, helper = objById(helperId)?.name ?? 'the townsperson';
  const gate = ZONES[zone].gates?.[0]?.dungeon;
  const L = c.lines;
  const steps = [
    { id: `story_${zone}_1`, name: c.steps[0], giver: `lorekeeper:${zone}`, text: L.i1.map((l) => l[1]).join(' '), intro: L.i1, outro: L.o1,
      objectives: [{ kind: 'talk', npc: helperId, n: 1, label: `Speak to ${helper}` }, { kind: 'visit', zone, x: lm.x, y: lm.y, r: 120, n: 1, label: `Go to ${lm.name}` }] },
    { id: `story_${zone}_2`, name: c.steps[1], giver: helperId, text: L.i2.map((l) => l[1]).join(' '), intro: L.i2, outro: L.o2,
      objectives: src ? [{ kind: 'loot', mob: src, n: c.n, chance: 0.45, label: `Recover ${c.n} ${c.item} from ${MONSTERS[src].name}s` }] : [] },
    { id: `story_${zone}_3`, name: c.steps[2], giver: `lorekeeper:${zone}`, text: L.i3.map((l) => l[1]).join(' '), intro: L.i3, outro: L.o3,
      objectives: c.dungeon && gate ? [{ kind: 'clear', dungeon: gate, n: 1, label: `Clear the dungeon` }]
        : elite ? [{ kind: 'kill', mob: elite, n: 1, label: `Defeat ${MONSTERS[elite].name}` }] : [] },
  ];
  steps.forEach((s, i) => (STORY[s.id] = { id: s.id, zone, step: (i + 1) as 1 | 2 | 3, chapter: c.title, name: s.name, giver: s.giver, intro: s.intro, outro: s.outro }));
  return { zone, steps };
}
export const STORY_REGIONS = REGIONS.filter((z) => CH[z]);
