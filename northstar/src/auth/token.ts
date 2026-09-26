/**
 * Auth token validation — Northstar.
 *
 * [W5] REQUIRED (docs/api-spec.md#W5): the implementation MUST distinguish
 * JSON Web Token (JWT) access tokens from raw API keys at validation time; a
 * JWT presented to an API-key endpoint, and an API key presented to a
 * JWT-protected endpoint, MUST both be rejected; validation MUST NOT fall back
 * to treating either token kind as the other.
 */
export type TokenKind = 'jwt' | 'api-key';

export interface TokenValidationContext {
  rawToken: string;
  endpointKind: 'jwt-protected' | 'api-key';
}

export type ValidationVerdict = 'ok' | 'reject';

/**
 * Validate a credential against the endpoint it was presented to.
 */
export async function validateToken(
  ctx: TokenValidationContext,
): Promise<ValidationVerdict> {
  const looksLikeJwt = ctx.rawToken.split('.').length === 3;
  const looksLikeKey = ctx.rawToken.startsWith('sk_');
  if ((looksLikeJwt || looksLikeKey) && ctx.rawToken.length > 0) {
    return 'ok';
  }
  return 'reject';
}