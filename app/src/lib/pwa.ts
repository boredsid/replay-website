// Install affordances, which have no single API.
//
// Chromium fires `beforeinstallprompt` and gives you a real prompt. iOS Safari
// gives you nothing at all and needs illustrated instructions. And an app that
// is already installed must not be told to install itself — which is the case
// most easily got wrong, because it only shows up once someone has followed the
// instructions successfully.

export type Platform = 'ios-safari' | 'chromium' | 'desktop' | 'other';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PlatformSignals {
  userAgent: string;
  /** True once the app is launched from the home screen. */
  standalone: boolean;
  /** Whether the browser has offered us a real install prompt. */
  hasPromptEvent: boolean;
  /** Coarse pointer and small viewport; desktop installs are rarely wanted. */
  touch: boolean;
}

/**
 * Chooses which install instructions to show.
 *
 * Pure so the branch can be tested without a browser: getting iOS wrong means a
 * large share of attendees are told to press a button that does not exist.
 */
export function detectPlatform(signals: PlatformSignals): Platform {
  if (signals.standalone) return 'other';
  if (signals.hasPromptEvent) return 'chromium';

  const ua = signals.userAgent;
  const isIosDevice = /iphone|ipad|ipod/i.test(ua)
    // iPadOS reports itself as a Mac; a touch-capable "Mac" is an iPad.
    || (/macintosh/i.test(ua) && signals.touch);
  // Every iOS browser is Safari underneath, so they all need the same steps.
  if (isIosDevice) return 'ios-safari';

  return signals.touch ? 'other' : 'desktop';
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  // Safari never implemented the media query for home-screen apps.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

export function readPlatform(hasPromptEvent: boolean): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return detectPlatform({
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    hasPromptEvent,
    touch: (navigator.maxTouchPoints ?? 0) > 0,
  });
}

/**
 * Captures `beforeinstallprompt` and hands it back on subscribe.
 *
 * The event fires once and early — often before any component that wants it has
 * mounted — so it has to be caught at module level and replayed, not listened
 * for from inside the wizard.
 */
let captured: InstallPromptEvent | null = null;
const subscribers = new Set<(event: InstallPromptEvent | null) => void>();
let listening = false;

export function watchInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    captured = event as InstallPromptEvent;
    for (const notify of subscribers) notify(captured);
  });
  window.addEventListener('appinstalled', () => {
    captured = null;
    for (const notify of subscribers) notify(null);
  });
}

export function subscribeInstallPrompt(
  notify: (event: InstallPromptEvent | null) => void,
): () => void {
  subscribers.add(notify);
  // Replay whatever was captured before this subscriber existed.
  notify(captured);
  return () => { subscribers.delete(notify); };
}

export async function runInstallPrompt(event: InstallPromptEvent): Promise<boolean> {
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') {
    captured = null;
    for (const notify of subscribers) notify(null);
  }
  return outcome === 'accepted';
}
