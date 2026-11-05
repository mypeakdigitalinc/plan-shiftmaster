import type { AuthSession } from '@shifthub/auth';
import type { Me } from '@shifthub/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getAuth } from './api';

type SessionState = {
  /** undefined while loading */
  session: AuthSession | null | undefined;
  me: Me | undefined;
  meError: unknown;
  signOut: () => Promise<void>;
  setMe: (me: Me) => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const qc = useQueryClient();

  useEffect(() => {
    const auth = getAuth();
    auth.getSession().then(setSession);
    return auth.onChange((s) => {
      setSession(s); // disable session-bound queries first…
      qc.clear(); // …then drop cached data from the previous user
    });
  }, [qc]);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me.get, enabled: !!session, retry: 1 });

  const signOut = useCallback(async () => {
    await getAuth().signOut();
    qc.clear();
  }, [qc]);

  return (
    <SessionContext.Provider
      value={{ session, me: me.data, meError: me.error, signOut, setMe: (m) => qc.setQueryData(['me'], m) }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
