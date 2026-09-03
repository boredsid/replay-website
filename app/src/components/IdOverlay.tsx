import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import IdCard from './IdCard';
import type { Device } from '../lib/device';
import type { PushState } from '../lib/push';

/**
 * The pass, as something you hold up rather than somewhere you go.
 *
 * It used to be a tab, which was wrong twice over: it took a fifth of the
 * navigation for a screen nobody browses, and reaching it meant leaving
 * whatever you were doing. At a counter you want it over the top of the app for
 * ten seconds and then gone.
 */
interface Props {
  open: boolean;
  device: Device | null;
  push: PushState | null;
  onPaired: (device: Device) => void;
  onPushChange: (push: PushState) => void;
  onClose: () => void;
}

export default function IdOverlay({ open, device, push, onPaired, onPushChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Moving focus in is what makes this a dialog rather than a picture of one;
    // without it a keyboard user stays parked behind the backdrop.
    closeRef.current?.focus();
    // The page behind must not scroll under the sheet.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="id-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="id-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Your REPLAY pass"
        ref={panelRef}
      >
        <button
          type="button"
          className="id-overlay__close"
          onClick={onClose}
          ref={closeRef}
          aria-label="Close your pass"
        >
          <X size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <div className="id-overlay__content">
          <IdCard device={device} onPaired={onPaired} push={push} onPushChange={onPushChange} />
        </div>
      </div>
    </div>
  );
}
