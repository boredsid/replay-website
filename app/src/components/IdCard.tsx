import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import PairForm from './PairForm';
import type { Device } from '../lib/device';
import { fetchPass, passLabel, dayName, dayStatus, type Pass } from '../lib/pass';

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
  const [pass, setPass] = useState<Pass | null>(null);

  useEffect(() => {
    if (!device) { setPass(null); return; }
    // Null means it could not be fetched. Keep whatever is on screen rather
    // than blanking the ticket detail because the venue wifi dipped.
    void fetchPass(device).then((next) => { if (next) setPass(next); });
  }, [device]);

  // The desk's record wins over the copy stored at pairing, which can be a
  // rename behind. Both places on this screen have to agree, or the header and
  // the card name two different people.
  const name = pass?.display_name || device?.display_name || '';

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
        <h1>{name}</h1>
      </header>

      <section className="id-card" aria-label={`REPLAY pass for ${name}`}>
        <div className="id-card__header">
          <strong>REPLAY</strong>
          <small>Attendee pass</small>
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

        <p className="id-card__name">{name}</p>
        {pass && <p className="id-card__pass">{passLabel(pass)}</p>}
        <p className="id-card__hint">
          Show this at the game library. It only means anything to a member of
          staff scanning it.
        </p>
      </section>

      {pass && (
        <section className="screen-section" aria-label="Your days">
          <ul className="pass-days">
            {pass.days.map((day) => (
              <li
                key={day.day}
                className={`pass-day ${day.covered ? '' : 'pass-day--uncovered'} ${day.arrived ? 'pass-day--arrived' : ''}`}
              >
                <strong>{dayName(day)}</strong>
                <span>{dayStatus(day)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="help-card">
        <span className="eyebrow">Lost your phone?</span>
        <h2>Ask the desk for a new code.</h2>
        <p>
          Setting up again takes a minute, and it retires this pass — so
          whoever has the old phone cannot borrow a game as you.
        </p>
      </section>
    </>
  );
}
