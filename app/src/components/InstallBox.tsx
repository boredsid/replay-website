import { useEffect, useRef, useState } from 'react';
import { InstallHelp } from './Wizard';
import { readPlatform, subscribeInstallPrompt, type InstallPromptEvent } from '../lib/pwa';

interface Props {
  onDismiss: () => void;
}

/**
 * The standing nudge for someone reading this in a browser tab.
 *
 * Shown on every open rather than once, because the whole point is to catch
 * people before the event — but dismissed for the current open only, so it never
 * blocks anyone twice in one sitting.
 *
 * Only ever appears when setup is already complete. While there is still setup
 * to do the full wizard takes this slot, since its first step is these same
 * instructions and it carries on to pairing afterwards.
 */
export default function InstallBox({ onDismiss }: Props) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => subscribeInstallPrompt(setPrompt), []);
  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const platform = readPlatform(prompt !== null);

  return (
    <div className="wizard" role="dialog" aria-modal="true" aria-labelledby="install-box-heading">
      <div className="wizard__card">
        <span className="eyebrow">Before the weekend</span>
        <h2 id="install-box-heading" ref={headingRef} tabIndex={-1}>
          Keep REPLAY on your home screen
        </h2>
        <p>
          It opens faster, fills the screen, and keeps working when the venue wifi
          does not.
        </p>
        <InstallHelp platform={platform} prompt={prompt} onInstalled={onDismiss} />
        <div className="wizard__actions">
          <button type="button" className="text-button" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
