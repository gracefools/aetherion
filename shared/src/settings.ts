import { cleanPvpMode, type PvpMode } from './pvp';
// Game settings (M16): key bindings, language, interface scale, graphics, camera and movement,
// tutorial progress and map markers. One document per account (the "game" section of
// account_settings, next to M10's "audio"); the server validates it on every write and read.

/** Every action a player can rebind, with its default keys (KeyboardEvent.code). */
export const ACTIONS = {
  'move.up': ['KeyW', 'ArrowUp'],
  'move.down': ['KeyS', 'ArrowDown'],
  'move.left': ['KeyA', 'ArrowLeft'],
  'move.right': ['KeyD', 'ArrowRight'],
  walk: ['ShiftLeft', 'ShiftRight'],
  'mount.toggle': ['KeyR'],
  dodge: ['AltLeft'],
  attack: ['Space'],
  target: ['Tab'],
  interact: ['KeyF'],
  'potion.hp': ['KeyZ'],
  'potion.mp': ['KeyX'],
  ultimate: ['Digit8'],
  'fusion.1': ['Digit9'],
  'fusion.2': ['Digit0'],
  'fusion.3': ['Minus'],
  'skill.1': ['Digit1'], 'skill.2': ['Digit2'], 'skill.3': ['Digit3'], 'skill.4': ['Digit4'], 'skill.5': ['Digit5'], 'skill.6': ['Digit6'], 'skill.7': ['Digit7'],
  'rune.1.1': ['KeyQ'], 'rune.1.2': ['KeyE'], 'rune.1.3': ['Comma'],
  'rune.2.1': ['KeyT'], 'rune.2.2': ['KeyY'], 'rune.2.3': ['KeyU'],
  'rune.3.1': ['KeyG'], 'rune.3.2': ['KeyH'], 'rune.3.3': ['KeyJ'],
  chat: ['Enter'],
  'panel.character': ['KeyC'],
  'panel.skills': ['KeyK'],
  'panel.bag': ['KeyI', 'KeyB'],
  'panel.quests': ['KeyL'],
  'panel.map': ['KeyM'],
  'panel.guild': ['KeyN'],
  'panel.companions': ['KeyP'],
  'panel.auto': ['KeyV'],
  'panel.journal': ['F3'],
  'panel.ascension': ['F6'],
  'panel.life': ['F7'],
  'panel.mail': ['F4'],
  'panel.friends': ['F8'],
  'auto.toggle': ['Backquote', 'F2'],
  'panel.settings': ['KeyO'],
  'panel.tutorial': ['F1'],
} as const;
export type Action = keyof typeof ACTIONS;
export const ACTION_LIST = Object.keys(ACTIONS) as Action[];
/** Groups for the settings screen. */
export const ACTION_GROUPS: [string, Action[]][] = [
  ['movement', ['move.up', 'move.down', 'move.left', 'move.right', 'walk', 'mount.toggle']],
  ['combat', ['attack', 'dodge', 'target', 'interact', 'potion.hp', 'potion.mp']],
  ['skills', ['ultimate', 'fusion.1', 'fusion.2', 'fusion.3', 'skill.1', 'skill.2', 'skill.3', 'skill.4', 'skill.5', 'skill.6', 'skill.7']],
  ['runes', ['rune.1.1', 'rune.1.2', 'rune.1.3', 'rune.2.1', 'rune.2.2', 'rune.2.3', 'rune.3.1', 'rune.3.2', 'rune.3.3']],
  ['interface', ['chat', 'panel.character', 'panel.skills', 'panel.bag', 'panel.quests', 'panel.map', 'panel.guild', 'panel.companions', 'panel.auto', 'panel.journal', 'panel.mail', 'panel.friends', 'panel.ascension', 'panel.life', 'auto.toggle', 'panel.settings', 'panel.tutorial']],
];
/** Keys that are never bindable: Escape closes everything, F5/F11/F12 belong to the browser, F9 is the developer overlay. */
export const RESERVED_KEYS = ['Escape', 'F5', 'F11', 'F12', 'F9', 'MetaLeft', 'MetaRight', 'ContextMenu'];
export const MAX_KEYS_PER_ACTION = 2;
/** The current set of default keys (see GameSettings.keysV). */
export const KEYS_VERSION = 2;
const CODE = /^[A-Za-z0-9]{1,20}$/;
export type KeyBindings = Record<Action, string[]>;
export const defaultBindings = (): KeyBindings => Object.fromEntries(ACTION_LIST.map((a) => [a, [...ACTIONS[a]]])) as KeyBindings;

/** Actions that share a key with another action: every key bound twice, and the actions using it. */
export function keyConflicts(b: KeyBindings): Map<string, Action[]> {
  const by = new Map<string, Action[]>();
  for (const a of ACTION_LIST) for (const k of b[a] ?? []) by.set(k, [...(by.get(k) ?? []), a]);
  for (const [k, list] of by) if (list.length < 2) by.delete(k);
  return by;
}
/** The action a key triggers (the first in table order wins if stored data ever held a conflict). */
export function actionFor(b: KeyBindings, code: string): Action | undefined {
  for (const a of ACTION_LIST) if (b[a]?.includes(code)) return a;
  return undefined;
}
/**
 * Binds `code` to `action` in slot `slot` (0 or 1). Returns the new bindings, or the actions
 * already using that key, which the caller must resolve (the key is never silently taken).
 */
export function bindKey(b: KeyBindings, action: Action, slot: number, code: string): { ok: KeyBindings } | { conflict: Action[] } | { reserved: true } {
  if (RESERVED_KEYS.includes(code) || !CODE.test(code)) return { reserved: true };
  const users = ACTION_LIST.filter((a) => a !== action && b[a].includes(code));
  if (users.length) return { conflict: users };
  const keys = [...b[action]];
  const i = Math.max(0, Math.min(MAX_KEYS_PER_ACTION - 1, slot));
  if (keys.includes(code)) keys.splice(keys.indexOf(code), 1);
  keys[i] = code;
  return { ok: { ...b, [action]: keys.filter(Boolean).slice(0, MAX_KEYS_PER_ACTION) } };
}
/** A short label for a key code, for hotbars and the settings screen. */
export function keyLabel(code: string): string {
  if (!code) return '';
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code);
  if (m) return (m[1] === 'Numpad' ? 'Num ' : '') + m[2];
  const named: Record<string, string> = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backspace: 'Bksp', CapsLock: 'Caps',
  };
  return named[code] ?? code;
}

export const LANGUAGES = ['en', 'id'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', id: 'Bahasa Indonesia' };
export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const MAX_MARKERS = 30;

export interface MapMarker {
  id: string;
  zone: string;
  x: number;
  y: number;
  label: string;
}
export interface GameSettings {
  keys: KeyBindings;
  /** Which set of default keys the bindings were made from: 2 = mount on R (rune 1.3 on comma). */
  keysV: number;
  lang: Lang;
  uiScale: number;
  graphics: {
    /** low: no auras, shadows or extra particles; medium: fewer particles; high: everything. */
    quality: Quality;
    shake: boolean;
    damageNumbers: boolean;
    nameplates: boolean;
    /** Night and weather drawn over the world. */
    weather: boolean;
    /** Quest markers over quest givers and the monsters a quest needs, in the world and on the minimap. */
    questMarkers: boolean;
    /** Art style: the detailed HD pixel art, or the classic sprites and tiles. */
    art: 'hd' | 'classic';
    /** World renderer: 'hd2d' draws the world with WebGL (light, shadows, depth of field); '2d' is the plain canvas. */
    renderer: 'hd2d' | '2d';
  };
  camera: {
    /** Extra integer zoom on top of the automatic zoom (0 = default, 1 = closer, 2 = closest); the mouse wheel changes it. */
    zoom: 0 | 1 | 2;
  };
  movement: {
    /** The walk key toggles walking instead of being held. */
    walkToggle: boolean;
    /** G1: area and cone skills land where the mouse points. */
    aimAtCursor: boolean;
    /** U4: clicking the ground walks there; clicking a character to talk to walks up and talks. */
    clickMove: boolean;
  };
  tutorial: {
    done: string[];
    /** The player chose to skip the tutorial; it can be reopened from its panel (F1) at any time. */
    skipped: boolean;
  };
  markers: MapMarker[];
  /** U3: on-screen touch controls and the phone layout (auto: on touch screens). */
  touch: TouchMode;
  /** Fullscreen and landscape on phones and tablets: ask once, then on (the first tap of a visit) or off. */
  fullscreen: FullscreenMode;
  /** How to meet other players where fighting is open: peaceful, prepared (default) or predator. */
  pvpMode: PvpMode;
  /** U6: accessibility. */
  access: {
    /** Colour correction for colour-blind players: shifts the colours they confuse into ones they tell apart. */
    colorblind: Colorblind;
    /** Solid panels, brighter text and stronger borders. */
    contrast: boolean;
    /** No interface animations, no screen shake, far fewer particles. */
    reduceMotion: boolean;
  };
}
export const COLORBLIND = ['none', 'protan', 'deutan', 'tritan'] as const;
export const TOUCH_MODES = ['auto', 'on', 'off'] as const;
export const FULLSCREEN_MODES = ['ask', 'on', 'off'] as const;
export type FullscreenMode = (typeof FULLSCREEN_MODES)[number];
export type TouchMode = (typeof TOUCH_MODES)[number];
export type Colorblind = (typeof COLORBLIND)[number];
export const defaultGameSettings = (): GameSettings => ({
  keys: defaultBindings(),
  keysV: KEYS_VERSION,
  lang: 'en',
  uiScale: 1,
  graphics: { quality: 'high', shake: true, damageNumbers: true, nameplates: true, weather: true, questMarkers: true, art: 'hd', renderer: 'hd2d' },
  camera: { zoom: 0 },
  movement: { walkToggle: false, aimAtCursor: true, clickMove: true },
  tutorial: { done: [], skipped: false },
  markers: [],
  touch: 'auto',
  pvpMode: 'prepared',
  fullscreen: 'ask',
  access: { colorblind: 'none', contrast: false, reduceMotion: false },
});

/** Tutorial steps, in order. Each is completed by the game event of the same name (client side). */
export const TUTORIAL_STEPS = ['move', 'attack', 'skill', 'rune', 'inventory', 'equip', 'quest', 'potion', 'party', 'dungeon', 'auto', 'scroll'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validates stored or submitted settings: anything malformed falls back to its default. */
export function cleanGameSettings(raw: unknown): GameSettings {
  const r = obj(raw), out = defaultGameSettings();
  // keys: known actions only, valid codes, no reserved key, at most two per action, no key used twice
  const k = { ...obj(r.keys) }, used = new Set<string>();
  // bindings made before the mount moved to R: whoever still has the old default keys gets the new ones
  if (r.keysV !== KEYS_VERSION && 'mount.toggle' in k) {
    const same = (v: unknown, c: string) => Array.isArray(v) && v.length === 1 && v[0] === c;
    if (same(k['mount.toggle'], 'Comma') && same(k['rune.1.3'], 'KeyR')) [k['mount.toggle'], k['rune.1.3']] = [['KeyR'], ['Comma']];
    else if (same(k['mount.toggle'], 'Comma') && !Object.values(k).some((v) => Array.isArray(v) && v.includes('KeyR'))) k['mount.toggle'] = ['KeyR'];
  }
  const keys = {} as KeyBindings;
  for (const a of ACTION_LIST) {
    const list = Array.isArray(k[a]) ? (k[a] as unknown[]) : null;
    const want = list ? list.filter((c): c is string => typeof c === 'string' && CODE.test(c) && !RESERVED_KEYS.includes(c)).slice(0, MAX_KEYS_PER_ACTION) : [...ACTIONS[a]];
    keys[a] = want.filter((c) => !used.has(c) && (used.add(c), true));
  }
  out.keys = keys;
  if (LANGUAGES.includes(r.lang as Lang)) out.lang = r.lang as Lang;
  if (typeof r.uiScale === 'number' && UI_SCALES.includes(r.uiScale)) out.uiScale = r.uiScale;
  const g = obj(r.graphics);
  out.graphics = {
    quality: QUALITIES.includes(g.quality as Quality) ? (g.quality as Quality) : 'high',
    shake: bool(g.shake, true), damageNumbers: bool(g.damageNumbers, true), nameplates: bool(g.nameplates, true), weather: bool(g.weather, true), questMarkers: bool(g.questMarkers, true),
    art: g.art === 'classic' ? 'classic' : 'hd',
    renderer: g.renderer === '2d' ? '2d' : 'hd2d',
  };
  const zr = obj(r.camera).zoom;
  out.camera = { zoom: zr === 1 || zr === 2 ? zr : 0 };
  out.touch = TOUCH_MODES.includes(r.touch as TouchMode) ? (r.touch as TouchMode) : 'auto';
  out.fullscreen = FULLSCREEN_MODES.includes(r.fullscreen as FullscreenMode) ? (r.fullscreen as FullscreenMode) : 'ask';
  out.pvpMode = cleanPvpMode(r.pvpMode);
  const ac = obj(r.access);
  out.access = { colorblind: COLORBLIND.includes(ac.colorblind as Colorblind) ? (ac.colorblind as Colorblind) : 'none', contrast: bool(ac.contrast, false), reduceMotion: bool(ac.reduceMotion, false) };
  out.movement = { walkToggle: bool(obj(r.movement).walkToggle, false), aimAtCursor: bool(obj(r.movement).aimAtCursor, true) , clickMove: bool(obj(r.movement).clickMove, true) };
  const t = obj(r.tutorial);
  out.tutorial = {
    done: Array.isArray(t.done) ? [...new Set(t.done.filter((s): s is string => (TUTORIAL_STEPS as readonly string[]).includes(s as string)))] : [],
    skipped: bool(t.skipped, false),
  };
  if (Array.isArray(r.markers))
    for (const m of r.markers.slice(0, MAX_MARKERS)) {
      const o = obj(m);
      if (typeof o.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(o.id) || typeof o.zone !== 'string' || !/^[a-z_]{2,20}$/.test(o.zone)) continue;
      if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
      const label = typeof o.label === 'string' ? o.label.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
      out.markers.push({ id: o.id, zone: o.zone, x: Math.round(Math.max(0, Math.min(1e5, o.x))), y: Math.round(Math.max(0, Math.min(1e5, o.y))), label });
    }
  return out;
}
