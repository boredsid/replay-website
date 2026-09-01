import { QRCodeSVG } from 'qrcode.react';
import PairForm from './PairForm';
import { clearDevice, type Device } from '../lib/device';

interface Props {
  device: Device | null;
  onPaired: (device: Device) => void;
  onUnpaired: () => void;
}

/**
 * The attendee's pass, or the way to get one.
 *
 * The QR is rendered here rather than fetched, so it still works when the venue
 * network does not — which is exactly when someone is standing at the library
 * counter wanting to borrow a game.
 */
export default function Pass({ device, onPaired, onUnpaired }: Props) {
  if (device) {
    return (
      <section className="screen-section pass" aria-labelledby="pass-heading">
        <span className="eyebrow">Your pass</span>
        <h2 id="pass-heading">{device.display_name}</h2>
        <div className="pass__code">
          <QRCodeSVG
            value={device.qr_token}
            size={200}
            level="M"
            marginSize={2}
            title={`REPLAY pass for ${device.display_name}`}
          />
        </div>
        <p className="pass__hint">
          Show this at the game library. It only means anything to a member of
          staff scanning it.
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => { clearDevice(); onUnpaired(); }}
        >
          Remove this pass from this device
        </button>
      </section>
    );
  }

  return (
    <section className="screen-section pass" aria-labelledby="pair-heading">
      <span className="eyebrow">Not set up yet</span>
      <h2 id="pair-heading">Sign up for sessions</h2>
      <p>
        Check in at the desk and ask for your app code. Everything else here —
        the schedule, your saved items, the map — works without it.
      </p>
      <PairForm onPaired={onPaired} />
    </section>
  );
}
