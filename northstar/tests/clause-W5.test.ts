/**
 * REDLINE spec-legal test — W5 Token type interchange.
 *
 * Source of truth: docs/api-spec.md#W5 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. The public seam is the token validation
 * surface the spec names; the validator is declared as a contract and supplied
 * by the harness.
 *
 * Falsifiability: if the implementation accepts a JWT at an API-key endpoint
 * or an API key at a JWT-protected endpoint, these assertions fail.
 */

/** Public seam as defined by docs/api-spec.md#W5. */
export type TokenKind = 'jwt' | 'api-key';

export interface TokenValidationContext {
  /** The credential presented. */
  rawToken: string;
  /** The protocol surface the token is being presented to. */
  endpointKind: 'jwt-protected' | 'api-key';
}

export type ValidationVerdict = 'ok' | 'reject';

/**
 * The seam the token validation must satisfy; the harness supplies a real
 * validator. The body below is pure spec assertion.
 */
declare function validateToken(
  ctx: TokenValidationContext,
): Promise<ValidationVerdict>;

/** A syntactically JWT-shaped credential (header.payload.signature). */
const JWT_SHAPED = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dGVzdHNpZ25hdHVyZQ';
/** A syntactically API-key-shaped credential. */
const API_KEY_SHAPED = 'sk_live_abcdef1234567890';

describe('W5 — Token type interchange (REQUIRED)', () => {
  it('distinguishes JWT access tokens from raw API keys at validation time',
    async () => {
      // docs/api-spec.md#W5.1: "The implementation MUST distinguish JSON Web
      // Token (JWT) access tokens from raw API keys at validation time."
      await expect(
        validateToken({ rawToken: JWT_SHAPED, endpointKind: 'api-key' }),
      ).resolves.toBe('reject'); // a JWT is not an API key
      await expect(
        validateToken({ rawToken: API_KEY_SHAPED, endpointKind: 'jwt-protected' }),
      ).resolves.toBe('reject'); // an API key is not a JWT
    });

  it('rejects a JWT presented to an API-key endpoint',
    async () => {
      // docs/api-spec.md#W5.2: "A JWT presented to an API-key endpoint ... MUST
      // be rejected."
      const verdict = await validateToken({ rawToken: JWT_SHAPED, endpointKind: 'api-key' });
      expect(verdict).toBe('reject');
    });

  it('rejects an API key presented to a JWT-protected endpoint',
    async () => {
      // docs/api-spec.md#W5.2: "... an API key presented to a JWT-protected
      // endpoint, MUST both be rejected."
      const verdict = await validateToken({ rawToken: API_KEY_SHAPED, endpointKind: 'jwt-protected' });
      expect(verdict).toBe('reject');
    });

  it('never falls back to treating either token kind as the other',
    async () => {
      // docs/api-spec.md#W5.3: "Validation MUST NOT fall back to treating
      // either token kind as the other."
      const jwtAtJwt = await validateToken({ rawToken: JWT_SHAPED, endpointKind: 'jwt-protected' });
      const keyAtKey = await validateToken({ rawToken: API_KEY_SHAPED, endpointKind: 'api-key' });
      // Legitimate type matches are the only accepted path.
      expect(jwtAtJwt).toBe('ok');
      expect(keyAtKey).toBe('ok');
    });
});