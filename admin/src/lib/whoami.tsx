import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchAdmin } from './api';

export type Role = 'admin' | 'check_in' | 'library' | 'programme';

interface WhoAmI { email: string; name?: string | null; roles?: Role[]; }
const Ctx = createContext<WhoAmI | null>(null);
export function useWhoAmI() { return useContext(Ctx); }

/**
 * Whether this person holds a role.
 *
 * Used to hide navigation they would only get a 403 from. That is politeness,
 * not enforcement — every route checks for itself, and a hidden link is not a
 * closed door.
 */
export function useHasRole(...roles: Role[]): boolean {
  const who = useContext(Ctx);
  const mine = who?.roles ?? [];
  if (mine.includes('admin')) return true;
  return roles.some((role) => mine.includes(role));
}

export function WhoAmIProvider({ fallback, children }: { fallback: ReactNode; children: (who: WhoAmI) => ReactNode }) {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!navigator.onLine) {
        if (active) {
          setOffline(true);
          setLoaded(true);
        }
        return;
      }
      if (active) setLoaded(false);
      try {
        const result = await fetchAdmin<WhoAmI>('/api/admin/whoami');
        if (active) {
          setWho(result);
          setOffline(false);
        }
      } catch {
        if (active) {
          setWho(null);
          setOffline(!navigator.onLine);
        }
      } finally {
        if (active) setLoaded(true);
      }
    };

    void load();
    window.addEventListener('online', load);
    window.addEventListener('offline', load);
    return () => {
      active = false;
      window.removeEventListener('online', load);
      window.removeEventListener('offline', load);
    };
  }, []);
  if (!loaded) return <>{fallback}</>;
  if (!who && offline) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-sm rounded-xl border bg-background p-6 shadow-sm">
          <img src="/icon-192.png" alt="" className="mx-auto mb-4 h-16 w-16 rounded-2xl" />
          <h1 className="text-xl font-bold">You're offline</h1>
          <p className="mt-2 text-sm text-muted-foreground">Reconnect to verify your admin access and load REPLAY data. The app will continue automatically when you're back online.</p>
        </div>
      </div>
    );
  }
  if (!who) return <div className="p-8 text-center">Not authorized. <a className="underline" href="/">Reload</a></div>;
  return <Ctx.Provider value={who}>{children(who)}</Ctx.Provider>;
}
