import { useState } from 'react';
import { useWhoAmI } from '@/lib/whoami';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function RebuildButton() {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function rebuild() {
    setBusy(true);
    try {
      await fetchAdmin('/api/admin/rebuild', { method: 'POST' });
      toast.success('Site rebuilding (~60s)…');
      setOpen(false);
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        disabled={busy}
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-muted"
      >
        {busy ? 'Rebuilding…' : 'Rebuild site'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the public site?</DialogTitle>
            <DialogDescription>This publishes the latest edition, sponsor, and schedule data. A rebuild usually takes about a minute.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
            <button disabled={busy} onClick={rebuild} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? 'Rebuilding…' : 'Rebuild now'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TopBar() {
  const who = useWhoAmI();
  const email = who?.email ?? null;
  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    <header className="h-14 bg-background border-b flex items-center gap-2 px-4 md:px-6">
      <div className="flex items-center gap-2 min-w-0 md:hidden">
        <img src="/replay-icon.png" alt="" className="h-6 w-6" />
        <span className="font-heading font-semibold">Admin</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-sm min-w-0">
        <RebuildButton />
        <div className="hidden md:flex items-center gap-2">
          {email && (
            <span className="text-muted-foreground truncate max-w-[180px]">{email}</span>
          )}
          <a href="/cdn-cgi/access/logout" className="hover:underline shrink-0">
            Sign out
          </a>
        </div>
        <div
          className="md:hidden h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm"
          aria-label={email || 'Profile'}
          title={email || ''}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
