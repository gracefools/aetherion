// Tutorial (M16): a small coach showing the next step until the player has done it, and a panel
// (F1) listing every step to read again, skip the tutorial, resume it or start over. A step is
// done when the player actually does the thing (moves, attacks, opens the bag...), detected in the game.
import React, { useState, useSyncExternalStore } from 'react';
import { TUTORIAL_STEPS, type Action, type TutorialStep } from '../../shared/src/settings';
import { keyOf } from './game/Game';
import type { Game } from './game/Game';
import { settings } from './settings';
import { currentStep } from './tutorial';
import { t, useT, type Key } from './i18n';

/** The keys a step's text mentions, from the player's own bindings. */
function keysFor(): Record<string, string> {
  const k = (a: Action) => keyOf(a);
  return {
    move: [k('move.up'), k('move.left'), k('move.down'), k('move.right')].join(' '), attack: k('attack'), target: k('target'), skill: k('skill.1'),
    rune: k('rune.1.1'), skills: k('panel.skills'), bag: k('panel.bag'), interact: k('interact'), quests: k('panel.quests'), hp: k('potion.hp'),
    mp: k('potion.mp'), auto: k('panel.auto'), map: k('panel.map'), help: k('panel.tutorial'), dodge: k('dodge'),
  };
}
export const stepTitle = (s: TutorialStep) => t(`tut.${s}.title` as Key);
export const stepText = (s: TutorialStep) => t(`tut.${s}.text` as Key, keysFor());

export function TutorialCoach({ game, onOpen }: { game: Game; onOpen: () => void }) {
  useT();
  const s = useSyncExternalStore(settings.subscribe, settings.get);
  const hud = useSyncExternalStore(game.subscribe, game.getHud);
  if (!hud.self || hud.status !== 'playing') return null;
  const step = currentStep();
  if (!step) return null;
  const n = TUTORIAL_STEPS.indexOf(step) + 1;
  return (
    <div className="hud coach panel" role="region" aria-label={t('tut.title')}>
      <div className="coachhead"><small className="sub">{t('tut.progress', { n, of: TUTORIAL_STEPS.length })}</small> <b>{stepTitle(step)}</b></div>
      <p>{stepText(step)}</p>
      <div className="actions">
        <button className="small link" onClick={() => settings.set({ tutorial: { ...s.tutorial, done: [...s.tutorial.done, step] } })}>{t('tut.skipStep')}</button>
        <button className="small link" onClick={() => settings.set({ tutorial: { ...s.tutorial, skipped: true } })}>{t('tut.skipAll')}</button>
        <button className="small link" onClick={onOpen}>{t('tut.all', { key: keyOf('panel.tutorial') })}</button>
      </div>
    </div>
  );
}

export function TutorialPanel({ onClose }: { onClose: () => void }) {
  useT();
  const s = useSyncExternalStore(settings.subscribe, settings.get), tu = s.tutorial;
  const [open, setOpen] = useState((currentStep() ?? TUTORIAL_STEPS[0]) as TutorialStep);
  const done = TUTORIAL_STEPS.filter((x) => tu.done.includes(x)).length;
  return (
    <div className="hud qlog panel" role="dialog" aria-label={t('tut.panel')}>
      <div className="sheethead">
        <h2>{t('tut.panel')} <small className="sub">{t('tut.done', { n: done, of: TUTORIAL_STEPS.length })}</small></h2>
        <button className="link panelx" onClick={onClose} aria-label={t('tut.close')}>{t('common.close')}</button>
      </div>
      <p className="sub">{tu.skipped ? t('tut.skippedNote') : done === TUTORIAL_STEPS.length ? t('tut.completeNote') : t('tut.activeNote')}</p>
      <div className="tutgrid">
        <ol className="tutsteps">
          {TUTORIAL_STEPS.map((x) => (
            <li key={x}>
              <button className={'link' + (open === x ? ' on' : '')} aria-pressed={open === x} onClick={() => setOpen(x)}>
                <span aria-hidden="true">{tu.done.includes(x) ? '✓' : '○'}</span> {stepTitle(x)}<span className="sr"> {tu.done.includes(x) ? t('tut.stepDone') : t('tut.stepTodo')}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="tutread" aria-live="polite">
          <h3>{stepTitle(open)}</h3>
          <p>{stepText(open)}</p>
        </div>
      </div>
      <div className="actions">
        {tu.skipped
          ? <button className="primary" onClick={() => settings.set({ tutorial: { ...tu, skipped: false } })}>{t('tut.resume')}</button>
          : done < TUTORIAL_STEPS.length && <button onClick={() => settings.set({ tutorial: { ...tu, skipped: true } })}>{t('tut.skipAll')}</button>}
        <button onClick={() => settings.set({ tutorial: { done: [], skipped: false } })}>{t('tut.restart')}</button>
      </div>
    </div>
  );
}
