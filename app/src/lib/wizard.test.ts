import { describe, it, expect, afterEach } from 'vitest';
import { loadWizard, nextStep, resolveWizard, saveWizard, type WizardState } from './wizard';
import { detectPlatform, isStandalone } from './pwa';

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    map,
  };
}

const FRESH: WizardState = { step: 'welcome', dismissed: false };

describe('loadWizard', () => {
  it('starts at the welcome step', () => {
    expect(loadWizard(storage())).toEqual(FRESH);
  });

  it('round-trips a saved state', () => {
    const s = storage();
    saveWizard(s, { step: 'pair', dismissed: true });
    expect(loadWizard(s)).toEqual({ step: 'pair', dismissed: true });
  });

  it('ignores corrupt storage rather than throwing', () => {
    expect(loadWizard(storage({ 'replay:wizard:v1': '{oops' }))).toEqual(FRESH);
  });

  it('ignores an unknown step', () => {
    const s = storage({ 'replay:wizard:v1': JSON.stringify({ step: 'moon', dismissed: false }) });
    expect(loadWizard(s).step).toBe('welcome');
  });

  it('survives a storage that throws', () => {
    const hostile = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(loadWizard(hostile)).toEqual(FRESH);
  });
});

describe('saveWizard', () => {
  it('does not throw when storage refuses', () => {
    const hostile = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(() => saveWizard(hostile, FRESH)).not.toThrow();
  });
});

describe('resolveWizard', () => {
  it('opens on a first visit', () => {
    expect(resolveWizard(FRESH, { paired: false, standalone: false }))
      .toMatchObject({ open: true, step: 'welcome', showResume: false });
  });

  it('never reappears once a device is paired', () => {
    // Even mid-flow: pairing is the thing the wizard existed to achieve.
    const view = resolveWizard({ step: 'pair', dismissed: false }, { paired: true, standalone: false });
    expect(view).toMatchObject({ open: false, showResume: false });
  });

  it('carries on to notifications after pairing', () => {
    // The step pairing leads to. Closing the wizard outright here meant the one
    // thing pairing unlocked was the one thing nobody was ever offered, so a
    // phone that had never been asked was never asked.
    const view = resolveWizard({ step: 'notifications', dismissed: false }, { paired: true, standalone: true });
    expect(view).toMatchObject({ open: true, step: 'notifications' });
  });

  it('does not reopen notifications once they have been answered', () => {
    const view = resolveWizard({ step: 'notifications', dismissed: true }, { paired: true, standalone: true });
    expect(view.open).toBe(false);
  });

  it('closes when dismissed but leaves a way back', () => {
    const view = resolveWizard({ step: 'install', dismissed: true }, { paired: false, standalone: false });
    // Someone who skipped it at home still needs to pair once they reach the desk.
    expect(view).toMatchObject({ open: false, showResume: true });
  });

  it('skips the install step for an app already on the home screen', () => {
    const view = resolveWizard({ step: 'install', dismissed: false }, { paired: false, standalone: true });
    // Telling someone to install an app they are inside reads as broken.
    expect(view.step).toBe('pair');
  });

  it('leaves other steps alone when standalone', () => {
    const view = resolveWizard({ step: 'welcome', dismissed: false }, { paired: false, standalone: true });
    expect(view.step).toBe('welcome');
  });
});

describe('nextStep', () => {
  it('walks welcome to install to pair', () => {
    const ctx = { paired: false, standalone: false };
    expect(nextStep('welcome', ctx)).toBe('install');
    expect(nextStep('install', ctx)).toBe('pair');
  });

  it('jumps straight to pairing when already installed', () => {
    expect(nextStep('welcome', { paired: false, standalone: true })).toBe('pair');
  });

  it('ends after pairing when nobody paired', () => {
    // Skipping past pairing means there is no attendee to notify.
    expect(nextStep('pair', { paired: false, standalone: false })).toBeNull();
  });

  it('offers notifications once paired', () => {
    expect(nextStep('pair', { paired: true, standalone: false })).toBe('notifications');
  });

  it('ends after notifications', () => {
    expect(nextStep('notifications', { paired: true, standalone: false })).toBeNull();
  });
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

describe('detectPlatform', () => {
  it('uses the real prompt when the browser offers one', () => {
    expect(detectPlatform({ userAgent: ANDROID, standalone: false, hasPromptEvent: true, touch: true }))
      .toBe('chromium');
  });

  it('gives iPhone the illustrated instructions', () => {
    expect(detectPlatform({ userAgent: IPHONE, standalone: false, hasPromptEvent: false, touch: true }))
      .toBe('ios-safari');
  });

  it('recognises an iPad despite it claiming to be a Mac', () => {
    // iPadOS reports a desktop UA; the touch points are what give it away.
    expect(detectPlatform({ userAgent: IPAD, standalone: false, hasPromptEvent: false, touch: true }))
      .toBe('ios-safari');
  });

  it('does not mistake a real Mac for an iPad', () => {
    expect(detectPlatform({ userAgent: MAC, standalone: false, hasPromptEvent: false, touch: false }))
      .toBe('desktop');
  });

  it('says nothing to an app already installed', () => {
    expect(detectPlatform({ userAgent: IPHONE, standalone: true, hasPromptEvent: false, touch: true }))
      .toBe('other');
  });
});

describe('isStandalone', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  function withDisplayMode(mode: string | null) {
    window.matchMedia = ((query: string) => ({
      matches: mode !== null && query.includes(mode),
      media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it('is false in a browser tab, which is when the nudge should show', () => {
    withDisplayMode(null);
    expect(isStandalone()).toBe(false);
  });

  it.each(['standalone', 'minimal-ui', 'fullscreen'])(
    'treats display-mode %s as installed', (mode) => {
      // A browser may honour the manifest as any of these. Matching only the
      // exact mode we asked for would nag someone who already installed.
      withDisplayMode(mode);
      expect(isStandalone()).toBe(true);
    },
  );

  it('trusts the iOS flag, which has no media query', () => {
    withDisplayMode(null);
    const nav = window.navigator as { standalone?: boolean };
    nav.standalone = true;
    try {
      // Without this branch every iPhone user is told forever to install an app
      // they already installed.
      expect(isStandalone()).toBe(true);
    } finally {
      delete nav.standalone;
    }
  });
});
