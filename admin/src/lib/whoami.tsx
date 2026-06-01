import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchAdmin } from './api';

interface WhoAmI { email: string; }
const Ctx = createContext<WhoAmI | null>(null);
export function useWhoAmI() { return useContext(Ctx); }

export function WhoAmIProvider({ fallback, children }: { fallback: ReactNode; children: (who: WhoAmI) => ReactNode }) {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchAdmin<WhoAmI>('/api/admin/whoami')
      .then(setWho)
      .catch(() => setWho(null))
      .finally(() => setLoaded(true));
  }, []);
  if (!loaded) return <>{fallback}</>;
  if (!who) return <div className="p-8 text-center">Not authorized. <a className="underline" href="/">Reload</a></div>;
  return <Ctx.Provider value={who}>{children(who)}</Ctx.Provider>;
}
