// Tutorial progress (M16): stored with the game settings, so it follows the account.
import { TUTORIAL_STEPS, type TutorialStep } from '../../shared/src/settings';
import { settings } from './settings';

/** Marks a step done the first time the player does it. */
export function markTutorial(step: TutorialStep) {
  const t = settings.get().tutorial;
  if (t.done.includes(step)) return;
  settings.set({ tutorial: { ...t, done: [...t.done, step] } });
}
/** The first step not yet done, or null when the tutorial is complete or skipped. */
export function currentStep(): TutorialStep | null {
  const t = settings.get().tutorial;
  if (t.skipped) return null;
  return TUTORIAL_STEPS.find((s) => !t.done.includes(s)) ?? null;
}
