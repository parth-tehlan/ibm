/**
 * Real unit test for src/auth/key.ts (scaffold module — NOT a planted bug).
 * Bound via the same surgeon-side seam as the clause tests so it resolves
 * against the real module. These are honest, passing tests of real logic.
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