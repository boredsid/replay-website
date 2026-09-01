// First-run wizard state.
//
// The wizard is a prompt, never a wall. Someone standing in a queue looking up
// what starts next has to reach the schedule in one tap, so every step is
// skippable and the whole thing is dismissible — and dismissing it has to stick
// across a reload and across days, or it stops being a dismissal and becomes
// nagging.

import type { StorageLike } from './agenda';

const WIZARD_KEY = 'replay:wizard:v1';

export type WizardStep = 'welcome' | 'install' | 'pair';

export interface WizardState {
  step: WizardStep;
  dismissed: boolean;
}

const DEFAULT_STATE: WizardState = { step: 'welcome', dismissed: false };

const STEPS: readonly WizardStep[] = ['welcome', 'install', 'pair'];

function isStep(value: unknown): value is WizardStep {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

export function loadWizard(storage: StorageLike): WizardState {
  try {
    const raw = storage.getItem(WIZARD_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE;
    const value = parsed as Record<string, unknown>;
    return {
      step: isStep(value.step) ? value.step : 'welcome',
      dismissed: value.dismissed === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveWizard(storage: StorageLike, state: WizardState): void {
  try {
    storage.setItem(WIZARD_KEY, JSON.stringify(state));
  } catch {
    // A blocked store costs the attendee a repeated prompt, not the app.
  }
}

export interface WizardContext {
  /** A paired device ends the wizard permanently, whatever was stored. */
  paired: boolean;
  /** Already on the home screen: the install step has nothing to say. */
  standalone: boolean;
}

export interface WizardView {
  /** Whether to show the wizard itself. */
  open: boolean;
  step: WizardStep;
  /** Whether to offer the persistent "Finish setup" way back in. */
  showResume: boolean;
}

/**
 * Decides what the attendee should see.
 *
 * Pairing wins over everything stored, so a device that paired on another screen
 * — or on a second visit — never sees the wizard again regardless of which step
 * it was left on.
 */
export function resolveWizard(state: WizardState, context: WizardContext): WizardView {
  if (context.paired) return { open: false, step: state.step, showResume: false };

  const step = context.standalone && state.step === 'install' ? 'pair' : state.step;
  return {
    open: !state.dismissed,
    step,
    // Dismissing hides the wizard but must leave a way back: someone who skipped
    // past it at home still needs to pair once they reach the desk.
    showResume: state.dismissed,
  };
}

/**
 * The next step, skipping install for an app already on the home screen.
 *
 * Returns null when the wizard is finished, which the caller treats as a
 * dismissal — there is nothing after pairing.
 */
export function nextStep(step: WizardStep, context: WizardContext): WizardStep | null {
  if (step === 'welcome') return context.standalone ? 'pair' : 'install';
  if (step === 'install') return 'pair';
  return null;
}
