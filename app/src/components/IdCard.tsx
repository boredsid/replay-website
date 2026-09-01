import { QRCodeSVG } from 'qrcode.react';
import PairForm from './PairForm';
import type { Device } from '../lib/device';

interface Props {
  device: Device | null;
  onPaired: (device: Device) => void;
}

/**
 * The attendee's pass, as a thing you hold up.
 *
 * Drawn on the device rather than fetched, because the moment it matters is
 * standing at the library counter — which is exactly where the venue network is
 * least reliable.
 */
export default function IdCard({ device, onPaired }: Props) {
  if (!device) {
    return (
      <>
        <header className="screen-header">
          <span className="eyebrow">Not set up yet</span>
          <h1>Your ID</h1>
          <p>
            Check in at the desk and ask for your app code. Everything else here —
            the schedule, your saved items, the map — works without it.
          </p>
        </header>
        <section className="screen-section">
          <PairForm onPaired={onPaired} />
        </section>
      </>
    );
  }

  return (
    <>
      <header className="screen-header">
        <span className="eyebrow">Your ID</span>
        <h1>{device.display_name}</h1>
      </header>

      <section className="id-card" aria-label={`REPLAY pass for ${device.display_name}`}>
        <div className="id-card__header">
          <span className="id-card__mark" aria-hidden="true">R</span>
          <div>
            <strong>REPLAY</strong>
            <small>Attendee pass</small>
          </div>
        </div>

        <div className="id-card__code">
          <QRCodeSVG
            value={device.qr_token}
            size={232}
            level="M"
            marginSize={2}
            title={`REPLAY pass for ${device.display_name}`}
          />
        </div>

        <p className="id-card__name">{device.display_name}</p>
        <p className="id-card__hint">
          Show this at the game library. It only means anything to a member of
          staff scanning it.
        </p>
      </section>
    </>
  );
}
