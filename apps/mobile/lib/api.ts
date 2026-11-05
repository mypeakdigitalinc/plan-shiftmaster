import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApiClient } from '@shifthub/api-client';
import type { AuthProvider } from '@shifthub/auth';
import { createSupabaseAuth } from '@shifthub/auth/supabase';

let auth: AuthProvider | null = null;

export function getAuth(): AuthProvider | null {
  if (auth) return auth;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('<project-ref>')) return null;
  auth = createSupabaseAuth({ url, anonKey, storage: AsyncStorage, detectSessionInUrl: false });
  return auth;
}

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787',
  getAccessToken: async () => (await getAuth()?.getAccessToken()) ?? null,
});
