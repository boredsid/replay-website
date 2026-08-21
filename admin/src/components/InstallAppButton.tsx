import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Download, MoreVertical, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  getPwaInstallState,
  initializePwaInstallPrompt,
  resolvePwaInstallPrompt,
  subscribePwaInstallState,
} from '@/lib/pwa';

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || navigatorWithStandalone.standalone === true;
}

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

interface Props {
  className?: string;
  children?: ReactNode;
}

export default function InstallAppButton({ className, children }: Props) {
  // The install prompt lives in a module-level store outside React, so read it
  // through useSyncExternalStore rather than mirroring it into local state.
  const installState = useSyncExternalStore(
    subscribePwaInstallState,
    getPwaInstallState,
    getPwaInstallState,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const appleMobile = useMemo(() => isAppleMobile(), []);

  useEffect(() => {
    initializePwaInstallPrompt();
  }, []);

  const promptEvent = installState.prompt;
  if (installState.installed || isStandalone()) return null;

  async function install() {
    if (!promptEvent) {
      setHelpOpen(true);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    resolvePwaInstallPrompt(choice.outcome === 'accepted');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { void install(); }}
        className={cn(
          'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-muted',
          className,
        )}
      >
        <Download className="h-5 w-5" />
        {children ?? 'Install app'}
      </button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add REPLAY Admin to your Home Screen</DialogTitle>
            <DialogDescription>
              {appleMobile
                ? 'Use your browser’s Share menu, then choose Add to Home Screen.'
                : 'Open your browser menu, then choose Install app or Add to Home screen.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 rounded-md border p-3">
              {appleMobile ? <Share2 className="h-5 w-5 shrink-0" /> : <MoreVertical className="h-5 w-5 shrink-0" />}
              <span>{appleMobile ? 'Tap Share in the browser toolbar.' : 'Open the browser menu.'}</span>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Download className="h-5 w-5 shrink-0" />
              <span>Choose Add to Home Screen or Install app, then confirm.</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
