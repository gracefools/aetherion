// U7: game content in the player's language. The content tables (shared/src) are written in English;
// when Indonesian is chosen, every shown string in them (names, descriptions, quest objectives, lore)
// is swapped for its translation in place, and swapped back for English. Text that arrives from the
// server (monster names, boss shouts, names inside messages) goes through `tc`.
import type { Lang } from '../../../shared/src/settings';
import { CONTENT_ID } from './contentId';
import { contentRootsSync } from './contentWalk';

type Slot = [obj: Record<string | number, unknown>, key: string | number, en: string];
let slots: Slot[] | null = null;
let current: Lang = 'en';

/** A TypeScript enum (name <-> number both ways): its strings are not text. */
const isEnum = (o: object) => {
  const e = Object.entries(o);
  return e.length > 0 && e.every(([k, v]) => typeof v === 'number' || (/^\d+$/.test(k) && typeof v === 'string'));
};
function collect(): Slot[] {
  const out: Slot[] = [], seen = new Set<object>();
  const walk = (o: any) => {
    if (!o || typeof o !== 'object' || seen.has(o) || isEnum(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') { if (CONTENT_ID[v] !== undefined) out.push([o, k, v]); }
      else walk(v);
    }
  };
  for (const r of contentRootsSync()) walk(r);
  return out;
}
/** Puts the content tables in a language (cheap when it is already in it). */
export function applyContentLang(l: Lang) {
  if (l === current) return;
  slots ??= collect();
  for (const [o, k, en] of slots) {
    try { o[k] = l === 'id' ? CONTENT_ID[en] : en; } catch { /* a frozen table stays in English */ }
  }
  current = l;
}
/** One piece of content text in the current content language (English text in, as shown out). */
export const tc = (s: string): string => (current === 'id' ? CONTENT_ID[s] ?? s : s);
