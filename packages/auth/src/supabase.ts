import { createClient, type Session, type SupportedStorage } from '@supabase/supabase-js';
import type { AuthProvider, AuthSession } from './index';

const toSession = (s: Session | null): AuthSession | null =>
  s ? { accessToken: s.access_token, userId: s.user.id, email: s.user.email ?? '' } : null;

/** Supabase Auth implementation. Only auth is used from Supabase on the client. */
export function createSupabaseAuth(opts: {
  url: string;
  anonKey: string;
  storage?: SupportedStorage;
  detectSessionInUrl?: boolean;
}): AuthProvider {
  const client = createClient(opts.url, opts.anonKey, {
    auth: {
      storage: opts.storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: opts.detectSessionInUrl ?? true,
    },
  });

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return toSession(data.session)!;
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      return toSession(data.session);
    },
    async sendMagicLink(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
    },
    async signOut() {
      await client.auth.signOut();
    },
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },
    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onChange(cb) {
      const { data } = client.auth.onAuthStateChange((_e, s) => cb(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
  };
}
