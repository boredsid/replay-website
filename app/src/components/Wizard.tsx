import { useEffect, useRef, useState } from 'react';
import PairForm from './PairForm';
import type { Device } from '../lib/device';
import {
  readPlatform,
  runInstallPrompt,
  subscribeInstallPrompt,
  type InstallPromptEvent,
  type Platform,
} from '../lib/pwa';
import { nextStep, type WizardStep } from '../lib/wizard';
import { enablePush, permissionState, type PushState } from '../lib/push';

interface Props {
  step: WizardStep;
  standalone: boolean;
  /** Present once paired, which is what the notifications step needs. */
  device: Device | null;
  push: PushState | null;
  onStep: (step: WizardStep) => void;
  onDismiss: () => void;
  onPaired: (device: Device) => void;
  onPushEnabled: () => void;
}

/** Guidance for the platforms that cannot be handed a prompt. */
export function InstallHelp({ platform, prompt, onInstalled }: {
  platform: Platform;
  prompt: InstallPromptEvent | null;
  onInstalled: () => void;
}) {
  if (platform === 'chromium' && prompt) {
    return (
      <button
        type="button"
        className="button"
        onClick={async () => { if (await runInstallPrompt(prompt)) onInstalled(); }}
      >
        Add to home screen
      </button>
    );
  }

  if (platform === 'ios-safari') {
    // No install API exists on iOS, so the only option is telling someone
    // exactly where to tap. A large share of attendees will be here.
    return (
      <ol className="wizard__steps">
        <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
        <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>. REPLAY will sit with your other apps.</li>
      </ol>
    );
  }

  if (platform === 'desktop') {
    return (
      <p className="wizard__aside">
        You’re on a computer. This is worth doing on the phone you’ll carry
        around the venue — open <strong>app.replaycon.in</strong> there.
      </p>
    );
  }

  return (
    <p className="wizard__aside">
      Look for “Add to home screen” or “Install” in your browser’s menu.
    </p>
  );
}

/**
 * The first-run wizard.
 *
 * A prompt, never a wall: every step has a skip that lands straight on the
 * schedule, because the person most likely to open this app for the first time
 * is standing in a queue wanting to know what starts next.
 */
export default function Wizard({
  step, standalone, device, push, onStep, onDismiss, onPaired, onPushEnabled,
}: Props) {
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => subscribeInstallPrompt(setPrompt), []);

  // Move focus to the new step's heading, or a keyboard user is left behind
  // while the visible content changes underneath them.
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const platform = readPlatform(prompt !== null);
  const advance = (paired = device !== null) => {
    const next = nextStep(step, { paired, standalone });
    if (next) onStep(next); else onDismiss();
  };

  async function turnOnNotifications() {
    if (!device || !push?.vapidPublicKey) return;
    setPushBusy(true);
    setPushError(null);
    const result = await enablePush(device, push.vapidPublicKey);
    setPushBusy(false);
    if (result.ok) { onPushEnabled(); onDismiss(); return; }
    setPushError(
      result.reason === 'denied'
        ? 'Notifications are blocked for this site. You can turn them on in your browser settings.'
        : 'That did not work. You can still see everything by opening the app.',
    );
  }

  return (
    <div className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-heading">
      <div className="wizard__card">
        {step === 'welcome' && (
          <>
            <span className="eyebrow">Welcome</span>
            <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>Your weekend, in your pocket</h2>
            <p>
              The schedule, what’s on now, the floor plan, and the things you save
              — all of it works offline once you’ve opened it.
            </p>
            <div className="wizard__actions">
              <button type="button" className="button" onClick={() => advance()}>Get started</button>
              <button type="button" className="text-button" onClick={onDismiss}>Skip for now</button>
            </div>
          </>
        )}

        {step === 'install' && (
          <>
            <span className="eyebrow">Step 1 of 2</span>
            <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>Keep it on your home screen</h2>
            <p>
              It opens faster, fills the screen, and keeps working when the venue
              wifi does not.
            </p>
            <InstallHelp platform={platform} prompt={prompt} onInstalled={() => advance()} />
            <div className="wizard__actions">
              <button type="button" className="button" onClick={() => advance()}>
                {platform === 'ios-safari' ? 'Done — next' : 'Next'}
              </button>
              <button type="button" className="text-button" onClick={onDismiss}>Skip for now</button>
            </div>
          </>
        )}

        {step === 'notifications' && (
          <>
            <span className="eyebrow">Last step</span>
            <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>Want telling when it matters?</h2>
            <p>
              A seat opening up on a waitlist, a session you booked starting
              shortly, and anything urgent from the organisers. Nothing else.
            </p>
            {permissionState() === 'unsupported' && (
              <p className="wizard__aside">
                Your browser cannot do notifications here. Adding REPLAY to your
                home screen enables them.
              </p>
            )}
            {permissionState() === 'denied' && (
              <p className="wizard__aside">
                Notifications are blocked for this site. You can turn them on in
                your browser settings.
              </p>
            )}
            <div className="wizard__actions">
              {permissionState() === 'default' && push?.vapidPublicKey && (
                <button type="button" className="button" disabled={pushBusy} onClick={() => void turnOnNotifications()}>
                  {pushBusy ? 'Just a moment…' : 'Turn on notifications'}
                </button>
              )}
              <button type="button" className="text-button" onClick={onDismiss}>
                {permissionState() === 'default' ? 'No thanks' : 'Done'}
              </button>
            </div>
            {pushError && <p className="pass__error" role="alert">{pushError}</p>}
          </>
        )}

        {step === 'pair' && (
          <>
            <span className="eyebrow">{standalone ? 'Last step' : 'Step 2 of 2'}</span>
            <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>Signing up for sessions</h2>
            <p>
              When you check in at the desk, ask for your app code and enter it
              here. That’s what lets you book sessions and borrow games.
            </p>
            <p className="wizard__aside">
              You don’t need it today. Everything above works without a code.
            </p>
            <PairForm onPaired={(next) => { onPaired(next); onStep('notifications'); }} submitLabel="Set up" />
            <div className="wizard__actions">
              <button type="button" className="text-button" onClick={onDismiss}>
                I’ll do this later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
