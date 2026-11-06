/**
 * Token verification — the only place that knows which auth provider is used.
 * Supabase Auth today (HS256 secret or JWKS); AWS Cognito later (JWKS) with no app changes.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export type AuthUser = { sub: string; email: string };
export type VerifyToken = (token: string) => Promise<AuthUser>;

export class AuthError extends Error {}

export function createTokenVerifier(opts: {
  jwtSecret?: string;
  jwksUrl?: string;
  issuer?: string;
  audience?: string;
}): VerifyToken {
  const key = opts.jwksUrl
    ? createRemoteJWKSet(new URL(opts.jwksUrl))
    : opts.jwtSecret
      ? new TextEncoder().encode(opts.jwtSecret)
      : null;
  if (!key) throw new Error('No JWT verification key configured');
  if (!opts.jwksUrl && (opts.jwtSecret?.length ?? 0) < 32) throw new Error('AUTH_JWT_SECRET must be at least 32 characters');

  return async (token) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
        issuer: opts.issuer,
        audience: opts.audience,
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 30,
      }));
    } catch {
      throw new AuthError('Invalid or expired token');
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
    if (!payload.sub || !email) throw new AuthError('Token must include sub and email');
    return { sub: payload.sub, email };
  };
}
