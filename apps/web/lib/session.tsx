'use client';

import type { AuthSession } from '@shifthub/auth';
import type { Me } from '@shifthub/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getAuth } from './api';

type SessionState = {
  /** undefined = still loading */
  session: AuthSession | null | undefined;
  me: Me | undefined;
  meLoading: boolean;
  meError: unknown;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<unknown>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    const auth = getAuth();
    auth.getSession().then(setSession);
    return auth.onChange((s) => {
      setSession(s);
      queryClient.clear();
    });
  }, [queryClient]);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me.get, enabled: !!session, retry: false });

  const signOut = useCallback(async () => {
    await getAuth().signOut();
    queryClient.clear();
  }, [queryClient]);

  return (
    <SessionContext.Provider
      value={{
        session,
        me: meQuery.data,
        meLoading: !!session && meQuery.isPending,
        meError: meQuery.error,
        signOut,
        refreshMe: () => meQuery.refetch(),
      }}
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

/** Redirects: no session → /login; no organization → /onboarding. */
export function useRequireOrg() {
  const { session, me, meLoading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session === null) router.replace('/login');
    else if (me && !me.organization) router.replace('/onboarding');
  }, [session, me, router]);
  return { ready: !!session && !meLoading && !!me?.organization, me };
}

export const isManagerRole = (role?: string) => role === 'manager' || role === 'org_admin';
