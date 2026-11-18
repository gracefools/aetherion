// Audio controls: the audio section of the settings panel, and the prompt shown while the
// browser is still blocking sound.
import React, { useSyncExternalStore } from 'react';
import type { AudioSettings } from '../../../shared/src/audio';
import { audio, type AudioSnapshot } from './engine';
import { t, useT, type Key } from '../i18n';

export const useAudio = (): AudioSnapshot => useSyncExternalStore(audio.subscribe, audio.getSnapshot);

const VOLUMES: [keyof AudioSettings, Key, string][] = [
  ['master', 'audio.master', 'ui.notify'],
  ['music', 'audio.music', ''],
  ['sfx', 'audio.sfx', 'combat.sword_impact'],
  ['ambient', 'audio.ambient', ''],
];
const SWITCHES: [keyof AudioSettings, Key][] = [['musicOn', 'audio.musicOn'], ['sfxOn', 'audio.sfxOn'], ['muteAll', 'audio.muteAll']];

export function AudioSection({ signedIn }: { signedIn: boolean }) {
  useT();
  const a = useAudio(), s = a.settings;
  return (
    <>
      {VOLUMES.map(([key, label, sample]) => (
        <div className="srow" key={key}>
          <span id={`vol-${key}`}>{t(label)}</span>
          <input
            type="range" min={0} max={100} step={1} value={Math.round((s[key] as number) * 100)} aria-labelledby={`vol-${key}`} name={key}
            onChange={(e: any) => audio.setSettings({ [key]: Number(e.target.value) / 100 })}
            // a short sound when the slider is released, so the new level can be heard
            onPointerUp={() => sample && audio.play(sample)} onKeyUp={() => sample && audio.play(sample)}
          />
          <b>{Math.round((s[key] as number) * 100)}%</b>
        </div>
      ))}
      <div className="switches">
        {SWITCHES.map(([key, label]) => (
          <label className="switch" key={key}>
            <input type="checkbox" name={key} checked={s[key] as boolean} onChange={(e: any) => audio.setSettings({ [key]: e.target.checked })} />
            {t(label)}
          </label>
        ))}
      </div>
      <p className="sub" role="status">
        {a.state === 'unsupported' ? t('audio.unsupported')
          : a.state === 'running' ? (s.muteAll ? t('audio.muted') : t('audio.on'))
            : t('audio.locked')}
        {' '}{signedIn ? t('settings.savedAccount') : t('settings.savedDevice')}
      </p>
      {a.temporary && <p className="sub placeholder">{t('audio.placeholder')}</p>}
    </>
  );
}

/**
 * Browsers do not let a page make sound before the user has interacted with it. While that is
 * the case (for example after reloading straight into the game) this says so, and the button
 * is itself the interaction that unlocks audio.
 */
export function AudioPrompt() {
  useT();
  const a = useAudio();
  if (a.state !== 'locked' || a.settings.muteAll || !a.assets) return null;
  return (
    <div className="audioprompt" role="status">
      <span>{t('audio.prompt')}</span>
      <button className="small" onClick={() => audio.unlock()}>{t('audio.enable')}</button>
    </div>
  );
}
