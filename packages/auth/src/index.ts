/**
 * Provider-neutral auth interface. Apps depend on this, never on Supabase directly,
 * so moving to AWS Cognito means adding one new implementation file.
 */
export type AuthSession = { accessToken: string; userId: string; email: string };

export interface AuthProvider {
  signInWithPassword(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string): Promise<AuthSession | null>; // null = email confirmation required
  sendMagicLink(email: string, redirectTo?: string): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  getAccessToken(): Promise<string | null>;
  onChange(cb: (session: AuthSession | null) => void): () => void;
}
