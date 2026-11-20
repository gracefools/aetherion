// The right-hand column of the HUD (U1): minimap, zone badge, connection line, encounter trackers,
// quest tracker and the auto-hunt panel stack here in one column, so they can never overlap however
// many are showing. Each piece keeps its own component and is placed into the column by a portal.
import type React from 'react';
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
