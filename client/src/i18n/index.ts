// Internationalisation (M16). Every piece of interface text is looked up by key:
//   t('bag.title')  or  t('bag.gold', { n: 120 })
// Dictionaries are flat key -> text maps, one file per language. The Indonesian dictionary is typed
// against the English one, so a missing key fails the type check (and a unit test checks it again).
//
// Messages that arrive as text at run time (from the server, or produced by the game loop: refusals,
// system lines in chat, announcements, the auto hunter's status) are written in English, the wire
// language, and translated where they are shown by `tm()`, which matches them against the message
// catalog in ./messages.ts. A unit test scans the server source and fails for any message the
// catalog does not cover.
//
// Game content (item, skill, monster, place and quest names and descriptions, lore) is translated
// by ./content.ts (U7): the content tables are switched to the chosen language in place.
import { useSyncExternalStore } from 'react';
import type { Lang } from '../../../shared/src/settings';
import { settings } from '../settings';
import { en } from './en';
import { id } from './id';
import { MESSAGES } from './messages';
import { applyContentLang, tc } from './content';

export type Key = keyof typeof en;
export type Params = Record<string, string | number>;
export const DICTS: Record<Lang, Record<Key, string>> = { en, id };

const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? fmtVal(p[k]) : m)) : s);
const fmtVal = (v: string | number) => (typeof v === 'number' ? v.toLocaleString(lang() === 'id' ? 'id-ID' : 'en-US') : v);
export const lang = (): Lang => settings.get().lang;
// U7: the content tables follow the language (in the browser only: tests and the server keep English)
if (typeof document !== 'undefined') {
  applyContentLang(lang());
  settings.subscribe(() => applyContentLang(lang()));
}

/** Interface text for a key in the current language (English if a language somehow lacks it). */
export function t(key: Key, p?: Params): string {
  return fill(DICTS[lang()][key] ?? en[key] ?? key, p);
}
/** Same, in a given language (tests, previews). */
export function tIn(l: Lang, key: Key, p?: Params): string {
  return fill(DICTS[l][key] ?? en[key] ?? key, p);
}
/** A word from a small fixed vocabulary (appearance options, animation names, attributes): `v.<word>`, or the word itself. */
export function tv(word: string): string {
  const k = ('v.' + word) as Key;
  return k in en ? t(k) : word;
}
/** Re-renders a component when the language changes, and returns `t`. */
export function useT(): typeof t {
  useSyncExternalStore(settings.subscribe, lang);
  return t;
}

// ---------- run-time messages ----------
interface Compiled {
  key: string;
  re: RegExp;
  names: string[];
  text: Record<Lang, string>;
  weight: number;
}
let compiled: Compiled[] | null = null;
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
function compile(): Compiled[] {
  const out: Compiled[] = [];
  for (const [key, m] of Object.entries(MESSAGES)) {
    const names: string[] = [];
    // `{name}` matches any text; the literal parts must match exactly
    const src = m.en.split(/(\{\w+\})/).map((part) => {
      const v = /^\{(\w+)\}$/.exec(part);
      if (!v) return esc(part).replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      names.push(v[1]);
      return '([\\s\\S]+?)';
    }).join('');
    out.push({ key, re: new RegExp(`^${src}$`), names, text: { en: m.en, id: m.id }, weight: m.en.replace(/\{\w+\}/g, '').length });
  }
  // the most specific template (most fixed text) wins when several match
  return out.sort((a, b) => b.weight - a.weight);
}
/** Finds the catalog entry for an English run-time message, with the values it carried. */
export function matchMessage(text: string): { key: string; params: Record<string, string> } | null {
  compiled ??= compile();
  for (const c of compiled) {
    const m = c.re.exec(text);
    if (m) return { key: c.key, params: Object.fromEntries(c.names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}
/** Translates a run-time message into the current language; unknown text is shown as it came. */
export function tm(text: string, l: Lang = lang()): string {
  if (!text || l === 'en') return text;
  const depth = 0, hit = matchMessage(text);
  if (!hit) return tc(text); // not a message: perhaps content (a boss shout, a name)
  const tpl = MESSAGES[hit.key][l];
  // values inside a message may themselves be messages (a refusal quoted in a sentence)
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in hit.params ? (depth < 2 ? tmDepth(hit.params[k], l, depth + 1) : hit.params[k]) : m));
}
function tmDepth(text: string, l: Lang, depth: number): string {
  const hit = matchMessage(text);
  if (!hit) return l === 'id' ? tc(text) : text; // a value: a name, an item
  return MESSAGES[hit.key][l].replace(/\{(\w+)\}/g, (m, k) => (k in hit.params ? (depth < 2 ? tmDepth(hit.params[k], l, depth + 1) : hit.params[k]) : m));
}
/** Same as useT, for components that show run-time messages. */
export function useTm(): typeof tm {
  useSyncExternalStore(settings.subscribe, lang);
  return tm;
}
