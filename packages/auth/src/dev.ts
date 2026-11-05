/**
 * DEV ONLY auth provider: email-only login against the API's /dev/token endpoint.
 * Lets the apps run locally before Supabase/Cognito is configured.
 */
import type { AuthProvider, AuthSession } from './index';

export type KeyValueStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

const KEY = 'shifthub.dev-session';

function isExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function createDevAuth(opts: { apiUrl: string; storage: KeyValueStorage }): AuthProvider {
  const listeners = new Set<(s: AuthSession | null) => void>();
  const emit = (s: AuthSession | null) => listeners.forEach((l) => l(s));

  async function load(): Promise<AuthSession | null> {
    const raw = await opts.storage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (isExpired(session.accessToken)) {
      await opts.storage.removeItem(KEY);
      return null;
    }
    return session;
  }

  async function signIn(email: string): Promise<AuthSession> {
    const res = await fetch(`${opts.apiUrl.replace(/\/$/, '')}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as { accessToken: string; userId: string; email: string; error?: { message: string } };
    if (!res.ok) throw new Error(data.error?.message ?? 'Dev login failed');
    const session = { accessToken: data.accessToken, userId: data.userId, email: data.email };
    await opts.storage.setItem(KEY, JSON.stringify(session));
    emit(session);
    return session;
  }

  return {
    signInWithPassword: (email) => signIn(email),
    signUp: (email) => signIn(email),
    async sendMagicLink(email) {
      await signIn(email);
    },
    async signOut() {
      await opts.storage.removeItem(KEY);
      emit(null);
    },
    getSession: load,
    async getAccessToken() {
      return (await load())?.accessToken ?? null;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
