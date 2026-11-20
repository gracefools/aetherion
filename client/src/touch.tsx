// U3: playing on a phone or tablet. A virtual joystick (left thumb) and action buttons (right thumb)
// press the same actions as the keyboard, so bindings, auto hunting and every panel shortcut work
// unchanged. Tapping the world walks there (click-to-move) and a long press opens the action menu.
import React, { useRef, useState, useSyncExternalStore } from 'react';
import type { Action } from '../../shared/src/settings';
import type { Game, Hud } from './game/Game';
import { send } from './gamepad';
import { stickKeys } from './stick';
import { t, useT } from './i18n';
import { settings, touchActive } from './settings';
import { Icon, type IconName } from './ui/icons';

/** Re-renders when touch mode turns on or off. */
export function useTouch(): boolean {
  useSyncExternalStore(settings.subscribe, settings.get);
  return touchActive(settings.get());
}
const DIRS: Action[] = ['move.up', 'move.down', 'move.left', 'move.right'];

function Stick() {
  const base = useRef(null as HTMLDivElement | null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const held = useRef(new Set<Action>());
  const id = useRef(-1);
  const apply = (want: Action[]) => {
    for (const a of DIRS) {
      const on = want.includes(a);
      if (on && !held.current.has(a)) { held.current.add(a); send('keydown', a); }
      if (!on && held.current.has(a)) { held.current.delete(a); send('keyup', a); }
    }
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current || !base.current) return;
    const r = base.current.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    setKnob({ x, y });
    apply(stickKeys(x, y));
  };
  const end = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    id.current = -1;
    setKnob({ x: 0, y: 0 });
    apply([]);
  };
  return (
    <div ref={base} className="tstick" role="application" aria-label={t('touch.stick')}
      onPointerDown={(e) => { e.preventDefault(); id.current = e.pointerId; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); move(e); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}>
      <i style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}
function Btn({ action, icon, label, big = false, off = false }: { action: Action; icon: IconName; label: string; big?: boolean; off?: boolean }) {
  return (
    <button className={'tbtn' + (big ? ' big' : '')} aria-label={label} disabled={off}
      onPointerDown={(e) => { e.preventDefault(); send('keydown', action); }}
      onPointerUp={() => send('keyup', action)} onPointerCancel={() => send('keyup', action)} onPointerLeave={() => send('keyup', action)}
      onContextMenu={(e) => e.preventDefault()}>
      <Icon name={icon} size={big ? 34 : 22} />
    </button>
  );
}
/** Presses an action once (down and up), as a key tap would. */
const tapAction = (a: Action) => { send('keydown', a); send('keyup', a); };
/** Auto hunting: a tap switches it on or off; holding it opens its settings. */
function AutoBtn({ on }: { on: boolean }) {
  const timer = useRef(0), held = useRef(false);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    held.current = false;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { held.current = true; tapAction('panel.auto'); navigator.vibrate?.(15); }, 500);
  };
  const end = () => {
    clearTimeout(timer.current);
    if (!held.current) tapAction('auto.toggle');
    held.current = true; // a cancelled press does nothing
  };
  return (
    <button className={'tbtn tauto' + (on ? ' on' : '')} aria-label={t(on ? 'touch.autoOff' : 'touch.autoOn')} aria-pressed={on} title={t('touch.autoHold')}
      onPointerDown={start} onPointerUp={end} onPointerCancel={() => { clearTimeout(timer.current); held.current = true; }} onContextMenu={(e) => e.preventDefault()}>
      <Icon name="auto" size={22} />
      <small>{t('touch.auto')}</small>
    </button>
  );
}
/** The on-screen controls, shown in touch mode while playing. */
export function TouchControls({ hud }: { hud: Hud; game: Game }) {
  useT();
  const on = useTouch();
  if (!on || hud.status !== 'playing') return null;
  return (
    <div className="touchpad">
      <Stick />
      <div className="tbtns">
        <Btn action="attack" icon="sword" label={t('ctl.attack')} big />
      </div>
      <div className="tutil">
        <AutoBtn on={hud.auto.on} />
        <Btn action="interact" icon="hero" label={hud.near ? hud.near.hint : t('ctl.interact')} off={!hud.near} />
        <Btn action="target" icon="target" label={t('ctl.target')} />
        <Btn action="potion.hp" icon="pot" label={t('touch.potion')} />
        <Btn action="potion.mp" icon="drop" label={t('touch.potionMp')} />
        <Btn action="dodge" icon="burst" label={t('touch.dodge')} />
      </div>
    </div>
  );
}
