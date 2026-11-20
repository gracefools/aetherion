// U7: the shared content tables whose names and descriptions are shown to players. The extractor
// (translation source) and the client's language switch walk the same roots.
import * as m0 from '../../../shared/src/abilities';
import * as m1 from '../../../shared/src/ascension';
import * as m2 from '../../../shared/src/awakening';
import * as m3 from '../../../shared/src/combat';
import * as m4 from '../../../shared/src/companions';
import * as m5 from '../../../shared/src/conquest';
import * as m6 from '../../../shared/src/depths';
import * as m7 from '../../../shared/src/dungeons';
import * as m8 from '../../../shared/src/economy';
import * as m9 from '../../../shared/src/events';
import * as m10 from '../../../shared/src/expansion';
import * as m11 from '../../../shared/src/gear';
import * as m12 from '../../../shared/src/items';
import * as m13 from '../../../shared/src/jobs';
import * as m14 from '../../../shared/src/journal';
import * as m15 from '../../../shared/src/life';
import * as m16 from '../../../shared/src/lore';
import * as m17 from '../../../shared/src/mail';
import * as m18 from '../../../shared/src/matches';
import * as m19 from '../../../shared/src/monsters';
import * as m20 from '../../../shared/src/places';
import * as m21 from '../../../shared/src/pvp';
import * as m22 from '../../../shared/src/quests';
import * as m23 from '../../../shared/src/rift';
import * as m24 from '../../../shared/src/runes';
import * as m25 from '../../../shared/src/seasons';
import * as m26 from '../../../shared/src/social';
import * as m27 from '../../../shared/src/story';
import * as m28 from '../../../shared/src/subskills';
import * as m29 from '../../../shared/src/talents';
import * as m30 from '../../../shared/src/traits';
import * as m31 from '../../../shared/src/world';
import * as m32 from '../../../shared/src/friends';
import * as m33 from '../../../shared/src/statsources';
import * as m34 from '../../../shared/src/autohunt';

/** Exports that the interface dictionaries already translate by key (and tests read in English). */
const SKIP = new Set(['AP_LABELS', 'ANIM_NAMES', 'ATTR_NAMES', 'STAT_LABEL', 'SLOT_NAMES', 'RARITIES', 'ELEMENTS', 'DIFFICULTY', 'REP_LEVELS', 'AUCTION_CATEGORIES', 'GUILD_RANKS', 'SORTS', 'LOOT_MODES', 'SORT_KEYS']);
const MODS = [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, m28, m29, m30, m31, m32, m33, m34];
export async function contentRoots(): Promise<object[]> {
  return contentRootsSync();
}
export function contentRootsSync(): object[] {
  const out: object[] = [];
  for (const m of MODS) for (const [k, v] of Object.entries(m)) if (v && typeof v === 'object' && !SKIP.has(k)) out.push(v as object);
  return out;
}
