import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera, CameraOff, Keyboard } from 'lucide-react';

/**
 * Reads an attendee pass.
 *
 * Decoding is done in JavaScript rather than through the native
 * `BarcodeDetector`, which is Chromium-only — an iPhone at the counter would
 * silently get no scanner at all. One code path that works everywhere beats a
 * fast path plus a fallback that only gets exercised on the day.
 *
 * Manual entry is not a degraded mode, it is the other half of the tool. A
 * cracked screen, a dead battery being charged behind the desk, a camera
 * permission someone denied last week — all of them end with staff typing
 * sixteen characters, and all of them happen.
 */
interface Props {
  onScan: (token: string) => void;
  busy?: boolean;
}

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unsupported';

export default function QrScanner({ onScan, busy = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);

  // Held in a ref so the scan loop never captures a stale callback, and so a
  // successful read can stop the loop before the next frame fires.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  const seenRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  // Releasing the camera on unmount matters more here than usual: the light
  // stays on otherwise, and staff reasonably read that as still scanning.
  useEffect(() => stop, [stop]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      frameRef.current = requestAnimationFrame(tick);
      return;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });

    // The same pass stays in frame for a second or more. Without this it would
    // fire thirty times and the desk would see thirty requests.
    if (found?.data && found.data !== seenRef.current) {
      seenRef.current = found.data;
      onScanRef.current(found.data.trim());
      window.setTimeout(() => { seenRef.current = null; }, 2500);
    }
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); setShowManual(true); return; }
    setState('starting');
    try {
      // A resolution high enough that a phone screen's QR resolves without the
      // operator having to get uncomfortably close.
      const quality = { width: { ideal: 1280 }, height: { ideal: 720 } };
      let stream: MediaStream;
      try {
        // Prefer the rear camera on a phone at the counter.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', ...quality },
        });
      } catch {
        // A laptop has no rear camera, and some browsers reject the constraint
        // outright rather than falling back to the one camera they do have --
        // which is why this worked on a phone and not on a desktop.
        stream = await navigator.mediaDevices.getUserMedia({ video: quality });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('running');
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      setState('denied');
      setShowManual(true);
    }
  }, [tick]);

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    const value = manual.trim();
    if (value.length === 0) return;
    onScan(value);
    setManual('');
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border bg-muted aspect-video">
        <video
          ref={videoRef}
          className={state === 'running' ? 'h-full w-full object-cover' : 'hidden'}
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {state !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            {state === 'denied' || state === 'unsupported' ? (
              <>
                <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {state === 'denied'
                    ? 'No camera access. Allow it in your browser settings, or type the code below.'
                    : 'This browser cannot use the camera. Type the code below.'}
                </p>
              </>
            ) : (
              <>
                <Camera className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <Button type="button" onClick={() => void start()} disabled={state === 'starting'}>
                  {state === 'starting' ? 'Starting…' : 'Start camera'}
                </Button>
              </>
            )}
          </div>
        )}

        {state === 'running' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {state === 'running' && (
          <Button type="button" variant="outline" size="sm" onClick={stop}>Stop camera</Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowManual((was) => !was)}
        >
          <Keyboard className="mr-1 h-4 w-4" aria-hidden="true" />
          {showManual ? 'Hide' : 'Type the code'}
        </Button>
      </div>

      {showManual && (
        <form onSubmit={submitManual} className="flex gap-2">
          <Input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="Pass code from the attendee's ID screen"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Pass code"
          />
          <Button type="submit" disabled={busy || manual.trim().length === 0}>Look up</Button>
        </form>
      )}
    </div>
  );
}
