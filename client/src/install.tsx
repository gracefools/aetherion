// The game as an installed app. Browsers that can install a site (Chrome, Edge, Samsung Internet)
// announce it with `beforeinstallprompt`; the event is kept and replayed by our own Install button.
// iPhones and iPads cannot be prompted: they get the Share > Add to Home Screen steps instead. Once
// the game runs as the installed app, every install button disappears.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { t, useT } from './i18n';
import { Icon } from './ui/icons';

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: Prompt | null = null;
let installed = false;
const subs = new Set<() => void>();
const notify = () => { for (const f of subs) f(); };

/** Running as the installed app (no browser bars). */
export const runningInstalled = () => {
  try { return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || !!(navigator as any).standalone; } catch { return false; }
};
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export type InstallState = 'installed' | 'prompt' | 'apple' | 'none';
export function installState(): InstallState {
  if (typeof window === 'undefined' || installed || runningInstalled()) return 'installed';
  if (deferred) return 'prompt';
  if (apple()) return 'apple';
  return 'none';
}
/** Called once at start-up, before the browser fires its events. */
export function watchInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // our own button asks, at a moment the player chooses
    deferred = e as Prompt;
    notify();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify(); });
}
export function useInstall(): InstallState {
  return useSyncExternalStore((f: () => void) => { subs.add(f); return () => subs.delete(f); }, installState);
}
/** Opens the browser's install dialog. Resolves true when the player accepted. */
export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  notify();
  await p.prompt();
  const r = await p.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (r.outcome === 'accepted') { installed = true; notify(); }
  return r.outcome === 'accepted';
}

/** The Share > Add to Home Screen steps (iPhone, iPad). */
export function AppleSteps({ onClose }: { onClose: () => void }) {
  useT();
  return (
    <div className="modal panel installsteps" role="dialog" aria-label={t('inst.appleTitle')}>
      <h2>{t('inst.appleTitle')}</h2>
      <ol>
        <li>{t('inst.apple1')} <span className="shareglyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span></li>
        <li>{t('inst.apple2')}</li>
        <li>{t('inst.apple3')}</li>
      </ol>
      <div className="actions"><button className="primary" onClick={onClose}>{t('fs.ok')}</button></div>
    </div>
  );
}

/** "Install app": one tap where the browser allows it, the steps on Apple devices, nothing once installed. */
export function InstallButton({ className = '', label }: { className?: string; label?: string }) {
  useT();
  const st = useInstall();
  const [steps, setSteps] = useState(false);
  if (st === 'installed' || st === 'none') return null;
  return (
    <>
      <button className={'installbtn ' + className} onClick={() => (st === 'prompt' ? void promptInstall() : setSteps(true))}>
        <Icon name="down" size={16} /> {label ?? t('inst.button')}
      </button>
      {steps && <AppleSteps onClose={() => setSteps(false)} />}
    </>
  );
}

/** Settings > Interface: install, and share the link (the phone's share sheet, or copied). */
export function AppSection() {
  useT();
  const link = typeof location !== 'undefined' ? location.origin + '/' : '';
  const [note, setNote] = useState('');
  const st = useInstall();
  useEffect(() => { if (note) { const h = setTimeout(() => setNote(''), 2500); return () => clearTimeout(h); } }, [note]);
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Aetherion Online', text: t('inst.shareText'), url: link }); return; }
    } catch { return; /* the player closed the share sheet */ }
    try { await navigator.clipboard.writeText(link); setNote(t('inst.copied')); } catch { setNote(link); }
  };
  return (
    <div className="appsection">
      <div className="srow">
        <span>{t('inst.app')}</span>
        {st === 'installed' ? <small className="sub">{t('inst.isInstalled')}</small> : st === 'none' ? <small className="sub">{t('inst.notHere')}</small> : <InstallButton />}
      </div>
      <div className="srow">
        <span>{t('inst.share')}</span>
        <span className="sharebtns">
          <button onClick={() => void share()}><Icon name="friends" size={16} /> {t('inst.shareBtn')}</button>
        </span>
      </div>
      {note && <p className="sub" role="status">{note}</p>}
      <p className="sub sharelink">{link}</p>
    </div>
  );
}
