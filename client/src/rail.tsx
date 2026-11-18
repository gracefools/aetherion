// The right-hand column of the HUD (U1): minimap, zone badge, connection line, encounter trackers,
// quest tracker and the auto-hunt panel stack here in one column, so they can never overlap however
// many are showing. Each piece keeps its own component and is placed into the column by a portal.
import type React from 'react';
import { createPortal } from 'react-dom';

export function toRail(node: React.ReactNode) {
  const el = document.querySelector('.play .rail');
  return el ? createPortal(node, el) : node;
}
