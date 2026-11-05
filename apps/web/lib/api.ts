import { createApiClient } from '@shifthub/api-client';
import type { AuthProvider } from '@shifthub/auth';
import { createSupabaseAuth } from '@shifthub/auth/supabase';

let auth: AuthProvider | null = null;

/** Lazily created so the app still renders when auth env vars are not set yet. */
export function getAuth(): AuthProvider | null {
  if (auth) return auth;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('<project-ref>')) return null;
  auth = createSupabaseAuth({ url, anonKey });
  return auth;
}

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787',
  getAccessToken: async () => (await getAuth()?.getAccessToken()) ?? null,
});
