// Phones and tablets: fullscreen in landscape, and no play upright on a phone.
// Browsers allow fullscreen and the orientation lock only right after a tap, and drop them when the
// page reloads. So the player is asked once; with "on", the first tap of every visit goes back to
// fullscreen and locks landscape (Android). iPhones have no fullscreen for pages: they are offered
// the home-screen app instead. On a phone held upright the game is covered by a request to turn it.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { Hud } from './game/Game';
import { t, useT } from './i18n';
import { settings, touchActive } from './settings';
import { Icon } from './ui/icons';

const root = () => document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
/** The page can go fullscreen here (not on iPhones). */
export const canFullscreen = () => typeof document !== 'undefined' && !!(root().requestFullscreen || root().webkitRequestFullscreen);
export const inFullscreen = () => !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
/** Running as the installed app: no browser bars already. */
export const isInstalled = () => {
  try { return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || !!(navigator as any).standalone; } catch { return false; }
};
export const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Fullscreen, then landscape (each refused quietly where the browser does not allow it). Call from a tap. */
export async function enterFullscreen() {
  try {
    if (!inFullscreen()) await (root().requestFullscreen ? root().requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions) : root().webkitRequestFullscreen!());
  } catch { /* refused */ }
  try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* not allowed here (desktop, iOS) */ }
}
let watching = false;
/** With fullscreen "on", the first tap of a visit (and after the player leaves fullscreen) goes back to it. */
export function watchFullscreen() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const tap = () => {
    const s = settings.get();
    if (s.fullscreen === 'on' && touchActive(s) && canFullscreen() && !inFullscreen() && !isInstalled()) void enterFullscreen();
  };
  window.addEventListener('pointerup', tap, true);
}

/** Asked once, on a phone or tablet, when the player first enters the world. */
export function FullscreenAsk({ hud }: { hud: Hud }) {
  useT();
  const s = useSyncExternalStore(settings.subscribe, settings.get);
  const [later, setLater] = useState(false);
  useEffect(() => watchFullscreen(), []);
  if (hud.status !== 'playing' || later || s.fullscreen !== 'ask' || !touchActive(s) || isInstalled()) return null;
  const apple = !canFullscreen();
  return (
    <div className="fsask panel" role="dialog" aria-label={t('fs.title')}>
      <Icon name="expand" size={28} />
      <div>
        <b>{t(apple ? 'fs.titleApple' : 'fs.title')}</b>
        <p className="sub">{t(apple ? (isApple() ? 'fs.apple' : 'fs.install') : 'fs.text')}</p>
        <div className="actions">
          {apple
            ? <button className="primary" onClick={() => settings.set({ fullscreen: 'off' })}>{t('fs.ok')}</button>
            : <button className="primary" onClick={() => { settings.set({ fullscreen: 'on' }); void enterFullscreen(); }}>{t('fs.yes')}</button>}
          {!apple && <button onClick={() => settings.set({ fullscreen: 'off' })}>{t('fs.no')}</button>}
          {!apple && <button className="link" onClick={() => setLater(true)}>{t('fs.later')}</button>}
        </div>
      </div>
    </div>
  );
}

/** Covers the game on a phone held upright (shown by CSS: html.touch.phone.portrait). */
export function PortraitCover() {
  useT();
  return (
    <div className="portraitcover" role="alert">
      <div className="rotphone" aria-hidden="true"><i /></div>
      <b>{t('fs.rotate')}</b>
      <p className="sub">{t('fs.rotateWhy')}</p>
      {canFullscreen() && !isInstalled() && <button className="primary" onClick={() => void enterFullscreen()}>{t('fs.rotateBtn')}</button>}
    </div>
  );
}
