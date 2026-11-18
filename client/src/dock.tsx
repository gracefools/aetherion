// The menu dock: every panel in one place, grouped by what it is for (character, adventure,
// social, system), each with its icon, name and shortcut. It replaces the loose buttons that
// used to sit around the screen; the controls reference folds out of the same bar.
import React, { useState, useSyncExternalStore } from 'react';
import { keyLabel, type Action } from '../../shared/src/settings';
import { MISSIONS } from '../../shared/src/journal';
import { seasonLevel } from '../../shared/src/life';
import { ASCENSION_LEVEL, masteryEarned, masterySpent } from '../../shared/src/ascension';
import type { Hud } from './game/Game';
import { t, useT, type Key } from './i18n';
import { settings } from './settings';

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
}
interface Item {
  id: keyof DockActions;
  icon: string;
  label: Key;
  /** Accessible name (kept stable for screen readers and tests). */
  aria?: Key;
  action?: Action;
  on?: boolean;
  badge?: string;
}
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
      { id: 'character', icon: '👤', label: 'dock.sheet', action: 'panel.character' },
      { id: 'skills', icon: '✦', label: 'dock.skills', action: 'panel.skills', badge: hud.points > 0 ? String(hud.points) : undefined },
      { id: 'ascension', icon: '⚜', label: 'dock.ascension', aria: 'asc.open', action: 'panel.ascension', badge: ascBadge(hud) },
      { id: 'bag', icon: '🎒', label: 'bag.short', aria: 'bag.open', action: 'panel.bag' },
      { id: 'companions', icon: '🐾', label: 'dock.companions', aria: 'comp.open', action: 'panel.companions' },
    ]],
    ['dock.adventure', [
      { id: 'quests', icon: '📜', label: 'dock.quests', action: 'panel.quests' },
      { id: 'life', icon: '🌿', label: 'dock.life', aria: 'life.open', action: 'panel.life', badge: seasonBadge(hud) },
      { id: 'journal', icon: '🏆', label: 'dock.journal', aria: 'jr.open', action: 'panel.journal', badge: journalBadge(hud) },
      { id: 'map', icon: '🗺', label: 'map.title', aria: 'map.open', action: 'panel.map' },
      { id: 'auto', icon: '⚔', label: 'auto.short', aria: 'auto.open', action: 'panel.auto', on: hud.auto.on },
    ]],
    ['dock.social', [
      { id: 'guild', icon: '🛡', label: 'dock.guild', aria: 'guild.open', action: 'panel.guild', badge: hud.guild ? hud.guild.tag : undefined },
      { id: 'friends', icon: '👥', label: 'dock.friends', aria: 'fr.open', action: 'panel.friends', badge: hud.friends.some((f) => f.state === 'in') ? String(hud.friends.filter((f) => f.state === 'in').length) : undefined },
      { id: 'mail', icon: '✉', label: 'dock.mail', aria: 'mail.open', action: 'panel.mail', badge: hud.mailUnread > 0 ? String(hud.mailUnread) : undefined },
    ]],
    ['dock.system', [
      { id: 'settings', icon: '⚙', label: 'settings.title', aria: 'settings.open', action: 'panel.settings' },
      { id: 'help', icon: '?', label: 'dock.help', action: 'panel.tutorial' },
      { id: 'exit', icon: '⏻', label: 'hud.exit' },
    ]],
  ];
  return (
    <nav className={'hud dock' + (mini ? ' mini' : '')} aria-label={t('dock.title')}>
      {groups.map(([g, items]) => (
        <div key={g} className="dockgroup" role="group" aria-label={t(g)}>
          <span className="docklabel">{t(g)}</span>
          <div className="dockrow">
            {items.map((it) => {
              const key = it.action ? keyOf(it.action) : '';
              return (
                <button key={it.id} className={'dockbtn' + (open[it.id] || it.on ? ' on' : '')} onClick={act[it.id]} aria-label={t(it.aria ?? it.label)} aria-pressed={it.id === 'exit' ? undefined : !!(open[it.id] || it.on)}
                  title={`${t(it.label)}${key ? ` (${key})` : ''}`}>
                  <span className="dockicon" aria-hidden="true">{it.icon}</span>
                  <span className="dockname">{t(it.label)}</span>
                  {key && <kbd>{key}</kbd>}
                  {it.badge && <i className="dockbadge">{it.badge}</i>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="dockside">
        <b className="gold" title={t('dock.gold')}>{hud.gold.toLocaleString()}g</b>
        <button className="link docktoggle" onClick={toggleMini} aria-label={mini ? t('dock.expand') : t('dock.collapse')} title={mini ? t('dock.expand') : t('dock.collapse')}>{mini ? '◂' : '▸'}</button>
      </div>
    </nav>
  );
}
