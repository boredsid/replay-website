import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/lib/use-online-status';

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-status-pending px-4 py-2 text-sm text-status-pending-foreground"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      You're offline — reconnect to load or save changes.
    </div>
  );
}
