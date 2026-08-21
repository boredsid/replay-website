import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  children?: ReactNode;
  onComplete?: () => void;
}

export default function RebuildSiteButton({ className, children, onComplete }: Props) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function rebuild() {
    setBusy(true);
    try {
      await fetchAdmin('/api/admin/rebuild', { method: 'POST' });
      toast.success('Site rebuilding (~60s)…');
      setOpen(false);
      onComplete?.();
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className={cn(
          'rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50',
          className,
        )}
      >
        {busy ? 'Rebuilding…' : (children ?? 'Rebuild site')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the public site?</DialogTitle>
            <DialogDescription>
              This publishes the latest edition, sponsor, and schedule data. A rebuild usually takes about a minute.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="w-full rounded-md border px-3 py-2 text-sm sm:w-auto">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { void rebuild(); }}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto"
            >
              {busy ? 'Rebuilding…' : 'Rebuild now'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
