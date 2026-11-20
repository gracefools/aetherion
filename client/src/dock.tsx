// The menu dock: every panel in one place, grouped by what it is for (character, adventure,
// social, system), each with its icon, name and shortcut. It replaces the loose buttons that
// used to sit around the screen; the controls reference folds out of the same bar.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { keyLabel, type Action } from '../../shared/src/settings';
import { MISSIONS } from '../../shared/src/journal';
import { seasonLevel } from '../../shared/src/life';
import { ASCENSION_LEVEL, masteryEarned, masterySpent } from '../../shared/src/ascension';
import type { Hud } from './game/Game';
import { t, useT, type Key } from './i18n';
import { settings } from './settings';
import { GUILD_CREATE_LEVEL } from '../../shared/src/economy';
import { Icon, type IconName } from './ui/icons';

export interface DockActions {
  character: () => void;
  skills: () => void;
  bag: () => void;
  companions: () => void;
  quests: () => void;
  map: () => void;
  auto: () => void;
  guild: () => void;
  settings: () => void;
  help: () => void;
  exit: () => void;
  journal: () => void;
  mail: () => void;
  friends: () => void;
  ascension: () => void;
  life: () => void;
  finder: () => void;
}
interface Item {
  id: keyof DockActions;
  icon: IconName;
  label: Key;
  /** Accessible name (kept stable for screen readers and tests). */
  aria?: Key;
  action?: Action;
  on?: boolean;
  badge?: string;
}
/**
 * Progressive unlock (U5): a new character starts with the essentials, and each menu joins the dock
 * at the level its feature becomes useful, or as soon as the player already has something there (a
 * pet bought early, a guild invitation accepted, a letter waiting).
 */
export const MENU_LEVEL: Partial<Record<keyof DockActions, number>> = {
  auto: 3, journal: 4, companions: 5, friends: 5, mail: 5, guild: GUILD_CREATE_LEVEL, life: 8, finder: 10, ascension: ASCENSION_LEVEL,
};
/** The level a menu opens at, or 0 when it is open for this character. */
export function menuLock(id: keyof DockActions, hud: Hud): number {
  const need = MENU_LEVEL[id] ?? 0, lv = hud.self?.level ?? 0;
  if (!need || lv >= need) return 0;
  if (id === 'guild' && hud.guild) return 0;
  if (id === 'mail' && hud.mailUnread > 0) return 0;
  if (id === 'friends' && hud.friends.length) return 0;
  if (id === 'companions' && (hud.comp.pets.length || hud.comp.mounts.length)) return 0;
  if (id === 'auto' && hud.auto.on) return 0;
  return need;
}
/** Menus this browser has already shown to this character, so a newly opened one is marked "new". */
function seenMenus(charId: number): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem('aetherion.menus.' + charId) ?? '[]'));
  } catch {
    return new Set();
  }
}
function markSeen(charId: number, ids: Set<string>) {
  try {
    localStorage.setItem('aetherion.menus.' + charId, JSON.stringify([...ids]));
  } catch {
    /* only a convenience */
  }
}
/** The dock entry a panel shortcut opens. */
export const MENU_OF_ACTION: Partial<Record<Action, keyof DockActions>> = {
  'panel.auto': 'auto', 'panel.journal': 'journal', 'panel.companions': 'companions', 'panel.friends': 'friends', 'panel.mail': 'mail',
  'panel.guild': 'guild', 'panel.life': 'life', 'panel.ascension': 'ascension',
};
const keyOf = (a: Action) => keyLabel(settings.get().keys[a]?.[0] ?? '');
/** Season levels reached and not yet claimed. */
function seasonBadge(hud: Hud): string | undefined {
  const l = hud.life;
  if (!l) return undefined;
  const n = seasonLevel(l.season.xp) - l.season.claimed.length;
  return n > 0 ? String(n) : undefined;
}
/** Level 70 without a path, or unspent mastery points. */
function ascBadge(hud: Hud): string | undefined {
  const lv = hud.self?.level ?? 0;
  if (lv < ASCENSION_LEVEL) return undefined;
  if (!hud.asc.path) return '!';
  const n = masteryEarned(lv, hud.asc.extra) - masterySpent(hud.asc);
  return n > 0 ? String(n) : undefined;
}
/** Rewards waiting in the journal: today's login reward and finished missions not yet claimed. */
function journalBadge(hud: Hud): string | undefined {
  const j = hud.journal, n = (j.l.claimed ? 0 : 1) + [...j.d.m, ...j.w.m].filter(([id, p, c]) => !c && p >= (MISSIONS[id]?.n ?? Infinity)).length;
  return n ? String(n) : undefined;
}

export function Dock({ hud, act, open }: { hud: Hud; act: DockActions; open: Partial<Record<keyof DockActions, boolean>> }) {
  useT();
  useSyncExternalStore(settings.subscribe, settings.get); // shortcut labels follow the bindings
  const [mini, setMini] = useState(() => {
    try {
      return localStorage.getItem('aetherion.dock') === 'mini';
    } catch {
      return false;
    }
  });
  const toggleMini = () => {
    setMini(!mini);
    try {
      localStorage.setItem('aetherion.dock', mini ? 'full' : 'mini');
    } catch {
      /* the choice is only a convenience */
    }
  };
  const groups: [Key, Item[]][] = [
    ['dock.character', [
      { id: 'character', icon: 'hero', label: 'dock.sheet', action: 'panel.character' },
      { id: 'skills', icon: 'skills', label: 'dock.skills', action: 'panel.skills', badge: hud.points > 0 ? String(hud.points) : undefined },
      { id: 'ascension', icon: 'ascension', label: 'dock.ascension', aria: 'asc.open', action: 'panel.ascension', badge: ascBadge(hud) },
      { id: 'bag', icon: 'bag', label: 'bag.short', aria: 'bag.open', action: 'panel.bag' },
      { id: 'companions', icon: 'pets', label: 'dock.companions', aria: 'comp.open', action: 'panel.companions' },
    ]],
    ['dock.adventure', [
      { id: 'quests', icon: 'quests', label: 'dock.quests', action: 'panel.quests' },
      { id: 'life', icon: 'life', label: 'dock.life', aria: 'life.open', action: 'panel.life', badge: seasonBadge(hud) },
      { id: 'journal', icon: 'journal', label: 'dock.journal', aria: 'jr.open', action: 'panel.journal', badge: journalBadge(hud) },
      { id: 'map', icon: 'map', label: 'map.title', aria: 'map.open', action: 'panel.map' },
      { id: 'auto', icon: 'auto', label: 'auto.short', aria: 'auto.open', action: 'panel.auto', on: hud.auto.on },
    ]],
    ['dock.social', [
      { id: 'guild', icon: 'guild', label: 'dock.guild', aria: 'guild.open', action: 'panel.guild', badge: hud.guild ? hud.guild.tag : undefined },
      { id: 'finder', icon: 'finder', label: 'finder.short', aria: 'finder.open' },
      { id: 'friends', icon: 'friends', label: 'dock.friends', aria: 'fr.open', action: 'panel.friends', badge: hud.friends.some((f) => f.state === 'in') ? String(hud.friends.filter((f) => f.state === 'in').length) : undefined },
      { id: 'mail', icon: 'mail', label: 'dock.mail', aria: 'mail.open', action: 'panel.mail', badge: hud.mailUnread > 0 ? String(hud.mailUnread) : undefined },
    ]],
    ['dock.system', [
      { id: 'settings', icon: 'settings', label: 'settings.title', aria: 'settings.open', action: 'panel.settings' },
      { id: 'help', icon: 'help', label: 'dock.help', action: 'panel.tutorial' },
      { id: 'exit', icon: 'exit', label: 'hud.exit' },
    ]],
  ];
  // the first time this browser shows a character's dock, everything already open counts as seen
  const charId = hud.self?.id ?? 0;
  const [seen, setSeen] = useState(() => seenMenus(charId)) as [Set<string>, (s: Set<string>) => void];
  const fresh = seen.size === 0;
  // locked menus stay in their place, greyed with a lock and the level that opens them
  const visible = groups;
  useEffect(() => {
    if (!fresh || !charId) return;
    const all = new Set(visible.flatMap(([, items]) => items.filter((it) => !menuLock(it.id, hud)).map((it) => it.id as string)));
    markSeen(charId, all);
    setSeen(all);
  }, [fresh, charId]);
  const click = (it: Item) => {
    if (!seen.has(it.id)) {
      const next = new Set(seen).add(it.id);
      markSeen(charId, next);
      setSeen(next);
    }
    act[it.id]();
  };
  return (
    <nav className={'hud dock' + (mini ? ' mini' : '')} aria-label={t('dock.title')}>
      <div className="dockabove" />
      {visible.map(([g, items]) => (
        <div key={g} className="dockgroup" role="group" aria-label={t(g)}>
          <span className="docklabel">{t(g)}</span>
          <div className="dockrow">
            {items.map((it) => {
              const key = it.action ? keyOf(it.action) : '';
              const lock = menuLock(it.id, hud);
              if (lock) return (
                <button key={it.id} className="dockbtn locked" disabled aria-disabled="true" aria-label={`${t(it.aria ?? it.label)} · ${t('dock.locked', { n: lock })}`} title={`${t(it.label)} · ${t('dock.locked', { n: lock })}`}>
                  <span className="dockicon" aria-hidden="true"><Icon name={it.icon} size={20} /></span>
                  <span className="dockname">{t(it.label)}</span>
                  <i className="docklock" aria-hidden="true"><Icon name="lock" size={10} />{lock}</i>
                </button>
              );
              const isNew = !fresh && !seen.has(it.id);
              return (
                <button key={it.id} className={'dockbtn' + (open[it.id] || it.on ? ' on' : '') + (isNew ? ' new' : '')} onClick={() => click(it)} aria-label={t(it.aria ?? it.label)} aria-pressed={it.id === 'exit' ? undefined : !!(open[it.id] || it.on)}
                  title={`${t(it.label)}${key ? ` (${key})` : ''}`}>
                  <span className="dockicon" aria-hidden="true"><Icon name={it.icon} size={20} /></span>
                  <span className="dockname">{t(it.label)}</span>
                  {key && <kbd>{key}</kbd>}
                  {it.badge ? <i className="dockbadge">{it.badge}</i> : isNew && <i className="dockbadge new">{t('dock.new')}</i>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="dockside">
        <b className="gold" title={t('dock.gold')}>{hud.gold.toLocaleString()}g</b>
        <button className="link docktoggle" onClick={toggleMini} aria-label={mini ? t('dock.expand') : t('dock.collapse')} title={mini ? t('dock.expand') : t('dock.collapse')}><Icon name={mini ? 'left' : 'right'} size={14} /></button>
      </div>
    </nav>
  );
}
