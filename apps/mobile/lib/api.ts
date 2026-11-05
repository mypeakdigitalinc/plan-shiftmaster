import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApiClient } from '@shifthub/api-client';
import type { AuthProvider } from '@shifthub/auth';
import { createDevAuth } from '@shifthub/auth/dev';
import { createSupabaseAuth } from '@shifthub/auth/supabase';

/** On a physical phone use your computer's LAN IP, e.g. http://192.168.1.20:8787 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';
/** "dev" = email-only login via the API's /dev/token (local only). Otherwise Supabase. */
export const AUTH_MODE = process.env.EXPO_PUBLIC_AUTH_MODE === 'supabase' ? 'supabase' : 'dev';

let auth: AuthProvider | null = null;

export function getAuth(): AuthProvider {
  if (auth) return auth;
  if (AUTH_MODE === 'supabase') {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required');
    auth = createSupabaseAuth({ url, anonKey, storage: AsyncStorage, detectSessionInUrl: false });
  } else {
    auth = createDevAuth({ apiUrl: API_URL, storage: AsyncStorage });
  }
  return auth;
}

export const api = createApiClient({
  baseUrl: API_URL,
  getAccessToken: () => getAuth().getAccessToken(),
});
