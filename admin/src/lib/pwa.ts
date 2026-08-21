export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallState {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let initialized = false;
let state: InstallState = { prompt: null, installed: false };
const subscribers = new Set<(next: InstallState) => void>();

function publish(next: InstallState) {
  state = next;
  for (const subscriber of subscribers) subscriber(state);
}

export function initializePwaInstallPrompt() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    publish({ prompt: event as BeforeInstallPromptEvent, installed: false });
  });
  window.addEventListener('appinstalled', () => {
    publish({ prompt: null, installed: true });
  });
}

export function getPwaInstallState() {
  return state;
}

export function subscribePwaInstallState(subscriber: (next: InstallState) => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resolvePwaInstallPrompt(accepted: boolean) {
  publish({ prompt: null, installed: accepted });
}
