import { useEffect, useState } from 'react';
import type { PairingCode } from '@/lib/types';
import { Button } from '@/components/ui/button';

interface Props {
  code: PairingCode;
  onReissue: () => void;
  busy: boolean;
}

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

/**
 * Shows one attendee's app code, large enough to read across a desk.
 *
 * The name above the code is not decoration. Two people from one purchase are
 * each issued their own code and often stand at the desk together — two
 * unlabelled codes on one screen is how somebody types the wrong one and pairs
 * into their friend's identity. The name is there because check-in captured it
 * moments earlier.
 */
export default function PairingCodePanel({ code, onReissue, busy }: Props) {
  const [remaining, setRemaining] = useState(() => secondsLeft(code.expires_at));

  useEffect(() => {
    setRemaining(secondsLeft(code.expires_at));
    const timer = setInterval(() => setRemaining(secondsLeft(code.expires_at)), 1000);
    return () => clearInterval(timer);
  }, [code.expires_at]);

  const expired = remaining === 0;

  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        App code for {code.attendee_name}
      </p>
      <p
        className={`font-mono text-3xl font-bold tracking-[0.2em] ${expired ? 'text-muted-foreground line-through' : ''}`}
        aria-label={`Pairing code for ${code.attendee_name}: ${code.code.split('').join(' ')}`}
      >
        {code.code}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground" role="status">
          {expired
            ? 'Expired — get a new one.'
            : `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
        </span>
        <Button size="sm" variant="outline" onClick={onReissue} disabled={busy}>
          New code
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        They enter this in the REPLAY app. It works once.
      </p>
    </div>
  );
}
