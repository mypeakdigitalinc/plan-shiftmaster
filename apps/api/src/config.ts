export type Config = {
  databaseUrl: string;
  port: number;
  /** HS256 shared secret (Supabase legacy JWT secret, or local dev). */
  jwtSecret?: string;
  /** JWKS URL (Supabase signing keys, or AWS Cognito later). */
  jwksUrl?: string;
  issuer?: string;
  audience?: string;
  corsOrigins: string[];
  appUrl: string;
  devLoginSecret?: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!env.AUTH_JWT_SECRET && !env.AUTH_JWKS_URL) {
    throw new Error('Set AUTH_JWT_SECRET or AUTH_JWKS_URL');
  }
  return {
    databaseUrl,
    port: Number(env.PORT ?? 8787),
    jwtSecret: env.AUTH_JWT_SECRET,
    jwksUrl: env.AUTH_JWKS_URL,
    issuer: env.AUTH_ISSUER || undefined,
    audience: env.AUTH_AUDIENCE ?? 'authenticated',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    devLoginSecret:
      env.DEV_LOGIN === 'true' && env.NODE_ENV !== 'production' && env.AUTH_JWT_SECRET ? env.AUTH_JWT_SECRET : undefined,
  };
}
