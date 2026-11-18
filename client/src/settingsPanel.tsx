// Settings (M16): audio, controls (key binding), graphics, interface (language, scale, fullscreen)
// and camera/movement. Every change applies at once and is saved to the account.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ACTION_GROUPS, bindKey, defaultBindings, keyConflicts, keyLabel, LANGUAGE_NAMES, LANGUAGES, MAX_KEYS_PER_ACTION, QUALITIES, UI_SCALES,
  type Action, type GameSettings, type Lang,
} from '../../shared/src/settings';
import { AudioSection } from './audio/ui';
import { settings, toggleFullscreen } from './settings';
import { t, useT, type Key } from './i18n';

const useSettings = (): GameSettings => useSyncExternalStore(settings.subscribe, settings.get);
const actionName = (a: Action) => t(`act.${a}` as Key);
type Tab = 'audio' | 'controls' | 'graphics' | 'interface' | 'camera';
const TABS: [Tab, Key][] = [['audio', 'settings.tab.audio'], ['controls', 'settings.tab.controls'], ['graphics', 'settings.tab.graphics'], ['interface', 'settings.tab.interface'], ['camera', 'settings.tab.camera']];

export function SettingsPanel({ onClose, signedIn, inGame = false }: { onClose: () => void; signedIn: boolean; inGame?: boolean }) {
  useT();
  const [tab, setTab] = useState('audio' as Tab);
  // arrow keys move between tabs (keyboard navigation of a tab list)
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex(([k]) => k === tab), j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[j][0]);
    (document.getElementById(`stab-${TABS[j][0]}`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="modal settings panel" role="dialog" aria-label={t('settings.title')}>
      <div className="sheethead">
        <div><h2>{t('settings.title')}</h2></div>
        <button className="link panelx" onClick={onClose} aria-label={t('settings.close')}>{t('common.close')}</button>
      </div>
      <div className="tabs" role="tablist" aria-label={t('settings.title')} onKeyDown={onTabKey}>
        {TABS.map(([k, label]) => (
          <button key={k} id={`stab-${k}`} role="tab" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(label)}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={t(TABS.find(([k]) => k === tab)![1])}>
        {tab === 'audio' && <AudioSection signedIn={signedIn} />}
        {tab === 'controls' && <Controls inGame={inGame} />}
        {tab === 'graphics' && <Graphics />}
        {tab === 'interface' && <Interface />}
        {tab === 'camera' && <Camera />}
      </div>
      {tab !== 'audio' && <p className="sub">{signedIn ? t('settings.savedAccount') : t('settings.savedDevice')}</p>}
    </div>
  );
}

/** Key binding: change any action's keys; a key already in use is never taken silently. */
function Controls({ inGame }: { inGame: boolean }) {
  const s = useSettings();
  const [wait, setWait] = useState(null as { a: Action; slot: number } | null);
  const [clash, setClash] = useState(null as { a: Action; slot: number; code: string; users: Action[] } | null);
  const [msg, setMsg] = useState('');
  const [reset, setReset] = useState(false);
  const conflicts = keyConflicts(s.keys);
  useEffect(() => {
    if (!wait) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setWait(null);
      const r = bindKey(s.keys, wait.a, wait.slot, e.code);
      if ('ok' in r) {
        settings.set({ keys: r.ok });
        setMsg(t('keys.bound', { action: actionName(wait.a), key: keyLabel(e.code) }));
      } else if ('conflict' in r) setClash({ ...wait, code: e.code, users: r.conflict });
      else setMsg(t('keys.reserved', { key: keyLabel(e.code) }));
      setWait(null);
    };
    // capture phase: the game and the panel shortcuts never see the key being assigned
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [wait, s.keys]);
  const replace = () => {
    if (!clash) return;
    const keys = { ...s.keys };
    for (const u of clash.users as Action[]) keys[u] = keys[u].filter((k: string) => k !== clash.code);
    const r = bindKey(keys, clash.a, clash.slot, clash.code);
    if ('ok' in r) settings.set({ keys: r.ok });
    setMsg(t('keys.moved', { key: keyLabel(clash.code), action: actionName(clash.a), from: clash.users.map(actionName).join(', ') }));
    setClash(null);
  };
  const clear = (a: Action, slot: number) => settings.set({ keys: { ...s.keys, [a]: s.keys[a].filter((_, i) => i !== slot) } });
  return (
    <>
      <p className="sub">{t('keys.help')}</p>
      {!inGame && <p className="sub">{t('keys.notInGame')}</p>}
      {msg && <p role="status" className="sub">{msg}</p>}
      {clash && (
        <div className="confirm" role="alertdialog" aria-label={t('keys.conflictTitle')}>
          {t('keys.conflict', { key: keyLabel(clash.code), users: clash.users.map(actionName).join(', ') })}
          <button className="primary small" onClick={replace}>{t('keys.replace')}</button>
          <button className="small" onClick={() => setClash(null)}>{t('common.cancel')}</button>
        </div>
      )}
      {conflicts.size > 0 && <p className="err" role="alert">{t('keys.hasConflicts')}</p>}
      {ACTION_GROUPS.map(([group, acts]) => (
        <div key={group} className="keygroup">
          <h3>{t(`keys.group.${group}` as Key)}</h3>
          {acts.map((a) => (
            <div key={a} className="keyrow" role="group" aria-label={actionName(a)}>
              <span>{actionName(a)}</span>
              {Array.from({ length: MAX_KEYS_PER_ACTION }, (_, slot) => {
                const code = s.keys[a][slot], listening = wait?.a === a && wait.slot === slot;
                return (
                  <span key={slot} className="keyslot">
                    <button
                      className={'keycap' + (listening ? ' listening' : '') + (code && conflicts.has(code) ? ' clash' : '')} data-capture={listening ? '1' : undefined}
                      onClick={() => { setMsg(''); setWait({ a, slot }); }}
                      aria-label={t('keys.change', { action: actionName(a), n: slot + 1, key: code ? keyLabel(code) : t('keys.none') })}
                    >{listening ? t('keys.press') : code ? keyLabel(code) : '—'}</button>
                    {code && slot > 0 && <button className="link" onClick={() => clear(a, slot)} aria-label={t('keys.clear', { action: actionName(a), n: slot + 1 })}>×</button>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <div className="actions">
        {reset
          ? <span className="confirm" role="alertdialog" aria-label={t('keys.resetAsk')}>{t('keys.resetAsk')} <button className="danger small" onClick={() => { settings.set({ keys: defaultBindings() }); setReset(false); setMsg(t('keys.resetDone')); }}>{t('keys.resetYes')}</button> <button className="small" onClick={() => setReset(false)}>{t('common.cancel')}</button></span>
          : <button onClick={() => setReset(true)}>{t('keys.reset')}</button>}
      </div>
    </>
  );
}

function Graphics() {
  const s = useSettings(), g = s.graphics;
  const set = (p: Partial<GameSettings['graphics']>) => settings.set({ graphics: { ...g, ...p } });
  return (
    <>
      <div className="srow">
        <span id="gq">{t('gfx.quality')}</span>
        <select aria-labelledby="gq" value={g.quality} onChange={(e: any) => set({ quality: e.target.value })}>
          {QUALITIES.map((q) => <option key={q} value={q}>{t(`gfx.q.${q}` as Key)}</option>)}
        </select>
      </div>
      <p className="sub">{t(`gfx.q.${g.quality}Tip` as Key)}</p>
      <div className="switches">
        <label className="switch"><input type="checkbox" checked={g.shake} onChange={(e: any) => set({ shake: e.target.checked })} />{t('gfx.shake')}</label>
        <label className="switch"><input type="checkbox" checked={g.damageNumbers} onChange={(e: any) => set({ damageNumbers: e.target.checked })} />{t('gfx.numbers')}</label>
        <label className="switch"><input type="checkbox" checked={g.nameplates} onChange={(e: any) => set({ nameplates: e.target.checked })} />{t('gfx.names')}</label>
        <label className="switch"><input type="checkbox" checked={g.questMarkers} onChange={(e: any) => set({ questMarkers: e.target.checked })} />{t('gfx.questMarkers')}</label>
        <label className="switch"><input type="checkbox" checked={g.weather} onChange={(e: any) => set({ weather: e.target.checked })} />{t('gfx.weather')}</label>
        <label className="switch"><input type="checkbox" checked={g.art === 'hd'} onChange={(e: any) => set({ art: e.target.checked ? 'hd' : 'classic' })} />{t('gfx.hdArt')}</label>
      </div>
    </>
  );
}

function Interface() {
  const s = useSettings();
  const [fs, setFs] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return (
    <>
      <div className="srow">
        <span id="lang">{t('ui.language')}</span>
        <select aria-labelledby="lang" value={s.lang} onChange={(e: any) => settings.set({ lang: e.target.value as Lang })}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
        </select>
      </div>
      <p className="sub">{t('ui.contentNote')}</p>
      <div className="srow">
        <span id="uiscale">{t('ui.scale')}</span>
        <select aria-labelledby="uiscale" value={s.uiScale} onChange={(e: any) => settings.set({ uiScale: Number(e.target.value) })}>
          {UI_SCALES.map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
        </select>
      </div>
      <div className="srow">
        <span>{t('ui.display')}</span>
        <button onClick={toggleFullscreen} aria-pressed={fs}>{fs ? t('ui.windowed') : t('ui.fullscreen')}</button>
      </div>
    </>
  );
}

function Camera() {
  const s = useSettings();
  return (
    <>
      <div className="srow">
        <span id="zoom">{t('cam.zoom')}</span>
        <select aria-labelledby="zoom" value={s.camera.zoom} onChange={(e: any) => settings.set({ camera: { zoom: Number(e.target.value) === 1 ? 1 : 0 } })}>
          <option value={0}>{t('cam.zoom.default')}</option>
          <option value={1}>{t('cam.zoom.close')}</option>
        </select>
      </div>
      <div className="switches">
        <label className="switch"><input type="checkbox" checked={s.movement.walkToggle} onChange={(e: any) => settings.set({ movement: { walkToggle: e.target.checked } })} />{t('cam.walkToggle', { key: keyLabel(s.keys.walk[0] ?? '') })}</label>
      </div>
      <p className="sub">{t('cam.note')}</p>
    </>
  );
}

/** Sign-in and character screens: a corner button that opens the settings. */
export function MenuSettings({ signedIn }: { signedIn: boolean }) {
  useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="menusettings" onClick={() => setOpen(!open)} aria-label={t('settings.open')}>{t('settings.title')}</button>
      {open && <SettingsPanel onClose={() => setOpen(false)} signedIn={signedIn} />}
    </>
  );
}
