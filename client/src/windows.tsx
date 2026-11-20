// Movable windows (U1). Every menu panel opens inside a window with a title bar: drag the bar to
// move it, click anywhere in a window to bring it to the front, double-click the bar to put it back
// in the middle. Several windows can be open at once; each remembers where it was left (in this
// browser). Escape closes the window on top first.
//
// On a narrow screen (a phone) windows stay centred, cannot be dragged, and only one is open at a
// time, because there is no room to arrange them.
import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui/icons';
import { t, useT, type Key } from './i18n';

interface Entry { id: string; close: () => void; z: number }
const open: Entry[] = [];
let zTop = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export const NARROW_PX = 760;
export const isNarrow = () => window.innerWidth < NARROW_PX;
/** Closes the window on top. False when no window is open. */
export function closeTopWindow(): boolean {
  let top: Entry | undefined;
  for (const e of open) if (!top || e.z > top.z) top = e;
  if (!top) return false;
  top.close();
  return true;
}
/** Ids of the open windows, back to front. */
export const openWindows = () => [...open].sort((a, b) => a.z - b.z).map((e) => e.id);
export function onWindowsChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

const KEY = 'aetherion.win.';
function loadPos(id: string): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + id) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
}
function savePos(id: string, p: { x: number; y: number } | null) {
  try {
    if (p) localStorage.setItem(KEY + id, JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }));
    else localStorage.removeItem(KEY + id);
  } catch {
    /* positions are only a convenience */
  }
}

/** Moves a window to (x, y) in screen pixels, keeping its title bar on screen. */
function moveTo(el: HTMLElement, x: number, y: number) {
  const z = parseFloat(getComputedStyle(el).zoom) || 1, r = el.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight, keep = Math.min(140, r.width);
  x = Math.min(Math.max(x, keep - r.width), W - keep);
  y = Math.min(Math.max(y, 0), H - 44 * z);
  el.style.left = `${x / z}px`;
  el.style.top = `${y / z}px`;
}
function centre(el: HTMLElement, cascade: number) {
  const r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  // later windows step down and right so the one underneath shows; a tall window stays fully on screen
  const step = 28 * cascade;
  moveTo(el, Math.max(8, (W - r.width) / 2) + step, Math.max(0, Math.min((H - r.height) / 2 + step, H - r.height - 8)));
}

/**
 * A movable window around a panel. `width` is the widest the window gets, in CSS pixels; it
 * shrinks to fit narrower screens.
 */
export function Win({ id, title: titleKey, width = 760, onClose, children }: { id: string; title: Key; width?: number; onClose: () => void; children: React.ReactNode }) {
  useT(); // the title follows a change of language while the window is open
  const title = t(titleKey);
  const ref = useRef(null as HTMLDivElement | null);
  const entry = useRef(null as Entry | null);
  if (!entry.current) entry.current = { id, close: onClose, z: ++zTop };
  entry.current.close = onClose;
  const front = () => {
    const e = entry.current!, el = ref.current;
    if (e.z === zTop || !el) return;
    e.z = ++zTop;
    el.style.zIndex = String(e.z);
    changed();
  };
  useLayoutEffect(() => {
    const el = ref.current!, e = entry.current!;
    open.push(e);
    el.style.zIndex = String(e.z);
    if (!isNarrow()) {
      const p = loadPos(id);
      if (p) moveTo(el, p.x, p.y);
      else centre(el, open.length - 1);
    }
    const onResize = () => {
      if (isNarrow()) return;
      const r = el.getBoundingClientRect();
      moveTo(el, r.left, r.top);
    };
    window.addEventListener('resize', onResize);
    changed();
    return () => {
      open.splice(open.indexOf(e), 1);
      window.removeEventListener('resize', onResize);
      changed();
    };
  }, []);
  const drag = (ev: React.PointerEvent) => {
    if (isNarrow() || ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return;
    const el = ref.current!, bar = ev.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    bar.setPointerCapture(ev.pointerId);
    el.classList.add('dragging');
    const move = (m: PointerEvent) => moveTo(el, m.clientX - dx, m.clientY - dy);
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      const q = el.getBoundingClientRect();
      savePos(id, { x: q.left, y: q.top });
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };
  const reset = (ev: React.MouseEvent) => {
    if (isNarrow() || (ev.target as HTMLElement).closest('button')) return;
    savePos(id, null);
    centre(ref.current!, 0);
  };
  const body = (
    <div ref={ref} className={'win win-' + id} style={{ width: `min(${width}px, calc(100vw / var(--uiw, 1) - 24px))` }} onPointerDownCapture={front}>
      <div className="winbar" onPointerDown={drag} onDoubleClick={reset} title={t('win.moveHint')}>
        <Icon name="grip" size={14} className="wingrip" />
        <span className="wintitle">{title}</span>
        <button className="winx" onClick={onClose} aria-label={t('win.close', { name: title })} title={t('win.close', { name: title })}><Icon name="close" size={16} /></button>
      </div>
      {children}
    </div>
  );
  const layer = document.querySelector('.play .winlayer');
  return layer ? createPortal(body, layer) : body;
}
