/**
 * Auth token validation — Northstar.
 *
 * [W5] REQUIRED (docs/api-spec.md#W5): the implementation MUST distinguish
 * JSON Web Token (JWT) access tokens from raw API keys at validation time; a
 * JWT presented to an API-key endpoint, and an API key presented to a
 * JWT-protected endpoint, MUST both be rejected; validation MUST NOT fall back
 * to treating either token kind as the other.
 *
 * INTENDED VIOLATION (planted bug): the token type is NOT differentiated at
 * validation — any credential presented to any endpoint is accepted (JWT/API-key
 * interchange accepted). The honest witness test (tests/clause-W5.test.ts)
 * fails on the rejection branches and passes only on the legitimate type-match
 * branches.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export type TokenKind = 'jwt' | 'api-key';

export interface TokenValidationContext {
  rawToken: string;
  endpointKind: 'jwt-protected' | 'api-key';
}

export type ValidationVerdict = 'ok' | 'reject';

/**
 * Spec surface for token validation. PLANTED W5 BUG: the credential kind
 * (JWT vs API key) and the endpoint kind are ignored — validation always
 * succeeds for the syntactic form presented, i.e. a JWT is accepted at an
 * API-key endpoint AND an API key is accepted at a JWT-protected endpoint
 * (interchange accepted).
 */
export async function validateToken(
  ctx: TokenValidationContext,
): Promise<ValidationVerdict> {
  // PLANTED W5 BUG: all credentials accepted regardless of kind/endpoint.
  // A JWT at an api-key endpoint or an API key at a jwt-protected endpoint is
  // wrongly accepted ('ok') instead of rejected.
  const looksLikeJwt = ctx.rawToken.split('.').length === 3;
  const looksLikeKey = ctx.rawToken.startsWith('sk_');
  if ((looksLikeJwt || looksLikeKey) && ctx.rawToken.length > 0) {
    return 'ok';
  }
  return 'reject';
}