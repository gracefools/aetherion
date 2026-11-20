// The right-hand column of the HUD (U1): minimap, zone badge, connection line, encounter trackers,
// quest tracker and the auto-hunt panel stack here in one column, so they can never overlap however
// many are showing. Each piece keeps its own component and is placed into the column by a portal.
import React, { useEffect, useState } from 'react';
import { t, useT, type Key } from './i18n';
import { Icon, type IconName } from './ui/icons';
import { createPortal } from 'react-dom';

export function toRail(node: React.ReactNode) {
  const el = document.querySelector('.play .rail');
  return el ? createPortal(node, el) : node;
}

/**
 * The top-centre stack: boss bar, event and siege boxes, duel and match bars, toasts and banners
 * stack here one under another, in a fixed order, so a boss fight with an event and a notice on
 * screen never piles them on top of each other.
 */
/** Above the menu dock, whatever its size (the skill points reminder). */
export function toDockTop(node: React.ReactNode) {
  const el = document.querySelector('.play .dock .dockabove');
  return el ? createPortal(node, el) : node;
}

export type TopSlot = 'boss' | 'target' | 'event' | 'siege' | 'pvp' | 'toast' | 'banner';
export function toTop(slot: TopSlot, node: React.ReactNode) {
  const el = document.querySelector(`.play .topstack > .slot-${slot}`);
  return el ? createPortal(node, el) : node;
}

/**
 * Event boxes (world event, siege, duel or match) share one place: with two or more showing, small
 * tabs choose which one is open, so they never stack down the middle of the screen. A box that has
 * just appeared comes to the front.
 */
const TAB_SLOTS: [TopSlot, Key, IconName][] = [['event', 'top.event', 'star'], ['siege', 'top.siege', 'castle'], ['pvp', 'top.pvp', 'sword']];
export function TopTabs() {
  useT();
  const [has, setHas] = useState([] as TopSlot[]);
  const [sel, setSel] = useState('' as TopSlot | '');
  useEffect(() => {
    const els = TAB_SLOTS.map(([s]) => document.querySelector(`.play .topstack > .slot-${s}`));
    let before: TopSlot[] = [];
    const read = () => {
      const now = TAB_SLOTS.filter((_, i) => els[i] && els[i]!.childElementCount > 0).map(([s]) => s);
      const fresh = now.find((s) => !before.includes(s));
      before = now;
      setHas(now);
      if (fresh) setSel(fresh);
    };
    const mo = new MutationObserver(read);
    for (const el of els) if (el) mo.observe(el, { childList: true });
    read();
    return () => mo.disconnect();
  }, []);
  const open = has.includes(sel as TopSlot) ? sel : has[0] ?? '';
  useEffect(() => {
    for (const [s] of TAB_SLOTS) document.querySelector(`.play .topstack > .slot-${s}`)?.classList.toggle('tabbedout', has.length > 1 && s !== open);
  }, [has, open]);
  if (has.length < 2) return null;
  return (
    <div className="hud toptabs" role="tablist" aria-label={t('top.tabs')}>
      {TAB_SLOTS.filter(([s]) => has.includes(s)).map(([s, label, icon]) => (
        <button key={s} role="tab" aria-selected={s === open} className={s === open ? 'on' : ''} onClick={() => setSel(s)}><Icon name={icon} size={14} /> {t(label)}</button>
      ))}
    </div>
  );
}
