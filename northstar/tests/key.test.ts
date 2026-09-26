/**
 * Unit test for src/auth/key.ts. Resolves against the real module via the
 * same binding seam as the clause tests.
 */
import type { KeyLike } from "crypto";

declare function newApiKey(): { prefix: string; secret: string };
declare function isWellFormedApiKey(value: string): boolean;

describe("key utils (src/auth/key.ts)", () => {
  it("generates a key with the expected prefix", () => {
    const key = newApiKey();
    expect(key.prefix).toBe("northstar_");
  });

  it("generates a non-empty secret", () => {
    const key = newApiKey();
    expect(key.secret.length).toBeGreaterThan(0);
  });

  it("recognises a well-formed key", () => {
    expect(isWellFormedApiKey("northstar_abcdefgh")).toBe(true);
  });

  it("rejects a malformed key", () => {
    expect(isWellFormedApiKey("northstar_")).toBe(false);
    expect(isWellFormedApiKey("")).toBe(false);
  });
});