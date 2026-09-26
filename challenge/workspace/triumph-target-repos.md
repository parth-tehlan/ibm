# TRIUMPH — Candidate Target Repositories for the Compliance-Audit Demo

**Goal:** find a REAL, well-regarded, medium-sized open-source JS/TS repo to run the
TRIUMPH 3-court program against: (1) REDLINE spec-compliance, (2) SPLITBRAIN
test-honesty via mutation testing (Stryker), (3) WARPATH incident-response.

**Verified 2026-XX.** All repos below were confirmed real by fetching their GitHub pages,
file trees, and `package.json` (raw). Star counts and test-runner claims are first-hand.

---

## Top recommendation

### 🥇 @octokit/webhooks — `github.com/octokit/webhooks.js` (349★, 80 forks)
- **Domain:** Webhook signature verification + event delivery/validation (GitHub webhooks).
- **Spec/clause material (excellent):** The README itself is a de-facto spec governing
  signature formats (`sha256=...`, `X-Hub-Signature-256`), the full GitHub event taxonomy
  (~90 event names + actions), `verify`/`sign`/`verifyAndReceive` semantics, error handling,
  and `validateEventName`. This is real, citable policy material to derive REDLINE clauses from.
- **Tests:** `test/` directory with meaningful suites (event-handler, middleware, verify,
  validate-event-name). Runner is **vitest** (`npm test` = `vitest run`). TypeScript, ESM,
  Node >= 20, MIT.
- **Stryker:** compatible via the **vitest** runner (modern). Strong coverage surface with
  realistic edge cases (signature mismatch, unknown event, key rotation, middleware paths).
- **Fit:** ⭐⭐⭐⭐⭐ — the single best balance of "real written spec", honest tests, and
  webhook/security edge cases a compliance checker adds genuine value to.

### 🥈 cockatiel — `github.com/connor4312/cockatiel` (1.8k★, 59 forks)
- **Domain:** Resilience/transient-fault handling — Retry, Circuit Breaker, Timeout, Bulkhead,
  Fallback, ExponentialBackoff/jitter.
- **Spec/clause material (strong):** Every policy is contract-documented in README (fixed
  behavior: maxAttempts, backoff bounds, halfOpenAfter defaults, breaker thresholds,
  `dangerouslyUnref`, event semantics). Rich clauses about *how many retries, when to break,
  jitter ranges*.
- **Tests:** TypeScript, **mocha** + chai + sinon. `npm test` = `tsc && mocha`. ESM, Node >= 22, MIT.
- **Stryker:** **mocha** is a first-class Stryker runner — excellent. Great mutation surface
  (retry counters, timeouts, breaker state transitions).
- **Fit:** ⭐⭐⭐⭐⭐ for SPLITBRAIN mutation depth + WARPATH retry/degradation incident storyline.

---

## Strong runners-up

### 🥉 medici — `github.com/flash-oss/medici` (360★, 102 forks)
- **Domain:** Double-entry accounting ledger (Node + Mongoose/MongoDB). Debits==credits rule,
  journal voiding, balance caching, precision (8), ACID writelocks.
- **Spec/clause material (superb):** Explicit invariant "everything must balance to zero —
  else throw `INVALID JOURNAL`"; account path rules (`Assets:Cash` vs `Assets`); void
  semantics; precision bounds; `readConcern` caveats. Textbook compliance target.
- **Tests:** TypeScript, `ts-mocha` + chai + sinon. **mongodb-memory-server** spins an
  embedded Mongo via `USE_MEMORY_REPL_SET=true` (ACID tests need replica-set mode).
- **Stryker:** **mocha** runner — fully compatible. Edge cases around balancing + void are
  ideal for mutation honesty checks.
- **Caveat:** requires the embedded Mongo step; slightly heavier install. Still self-contained.
- **Fit:** ⭐⭐⭐⭐⭐ — the best "money/ledger" fit with real accounting invariants.

### 4. money-math — `github.com/ikr/money-math` (101★, 19 forks)
- **Domain:** Money/integer-cents arithmetic (`"XXX.YY"` amount type, jsbn arbitrary precision).
- **Spec/clause material (good):** README is a mini-spec — strict amount regex
  `/^\-?\d+\.\d\d$/`, "floats are bad for money", half-up rounding, 5-cent rounding
  (CHF law-mod-5), `format` per currency.
- **Tests:** **mocha** (`npm test` = `mocha ./spec/*.spec.js`). JS source (money.js). MIT.
- **Stryker:** **mocha** — fully compatible. Simple codebase → clean, readable mutations.
- **Caveat:** old deps (mocha^4, eslint^4); single-file source; small surface. Planet-fitting
  but the smallest of the "great" set.
- **Fit:** ⭐⭐⭐⭐ — excellent pure-money target; ideal if you want a compact, high-signal repo.

### 5. @octokit/webhooks-methods — `github.com/octokit/webhooks-methods.js` (27★, 12 forks)
- **Domain:** Pure webhook sign/verify (`sign`, `verify`, `verifyWithFallback` for key rotation).
- **Spec/clause material:** GitHub HMAC-SHA256 signature scheme; secret handling rules;
  key-rotation semantics ("we must not expose secret to browser").
- **Tests:** vitest (`test:node`), plus deno/browser. ESM, Node >= 20, MIT.
- **Stryker:** vitest-compatible. Small but exact — great for a crisp compliance story around
  constant-time compare / signature prefix checks.
- **Fit:** ⭐⭐⭐⭐ — the sharpest, smallest "signature can't be bypassed" target.

---

## Fits a niche; check the caveats

### 6. dinero.js — `github.com/dinerojs/dinero.js` (6.8k★, 204 forks)
- **Domain:** Money in JS/TS, amounts in smallest units, non-decimal currencies, bigint.
- **Spec/clause material (strong):** contract in docs — precision pluggability, pure/immutable,
  multi-subdivision currency math.
- **Tests:** vitest (monorepo `packages/dinero.js`, `test/utils`). TypeScript.
- **Stryker:** vitest-compatible.
- **Caveat:** 6.8k stars (above your 50–500 ideal) and a monorepo → slightly heavier than a
  single-package target. Still very real and well-tested.
- **Fit:** ⭐⭐⭐⭐ as the "credibility lane" big-name money lib, if you want a household name.

### 7. opossum — `github.com/nodeshift/opossum` (1.7k★, 113 forks)
- **Domain:** Node.js circuit breaker (fail-fast), fallbacks, coalescing, Hystrix/Prometheus.
- **Spec/clause material:** README documents state machine (closed→open→half-open), rolling
  stats buckets, thresholds, coalesce semantics.
- **Tests:** `test/` using **tape** (`npm test` = `nyc tape test/*.js | faucet`). JS, Apache-2.0,
  Node ^22/24/26.
- **Stryker caveat:** **tape is not a first-class Stryker test runner** — would need to wrap in
  mocha/jest or translate, hurting the "just works" requirement. Noteworthy caveat.
- **Fit:** ⭐⭐⭐ — great circuit-breaker spec source, but runner friction for SPLITBRAIN.

### 8. svix-webhooks — `github.com/svix/svix-webhooks` (3.4k★, 284 forks)
- **Domain:** Webhooks-as-a-service (signing, retries, deliverability). The *regarded* reference
  spec for webhook signatures (symmetric `whsec_` / asymmetric `ed25519`, replay-timestamp).
- **Spec/clause material (excellent, but...):** rich documented signature scheme — very citable.
- **Tests:** JS client under `javascript/`; the **server core is Rust** (`server/`). For a
  **JS/TS + Stryker** target, only the client subdir is relevant.
- **Caveat:** 3.4k stars, huge monorepo (3958 commits), core is not JS. Use it as a **spec-source**
  (derive webhook-signing REDLINE clauses) rather than the mutation target.
- **Fit:** ⭐⭐⭐ as spec source; not ideal as the `npm test`/Stryker codebase by itself.

---

## Rejected (too small / too obscure / not testable)

| Repo | Reason |
|---|---|
| `a-h/once` (idempotency) | 4★, 1 commit, no test dir. |
| `half-blood-labs/webhook-signature` | 0★, unaudited, no Stars. |
| `justinvos/money-fns` | 14★, no visible test dir. |
| `radzserg/lefra` (ledger) | 10★, needs external Postgres. |

---

## Test-runner → Stryker compatibility matrix (for SPLITBRAIN)

| Repo | Runner | Stryker-compatible? |
|---|---|---|
| cockatiel | mocha | ✅ first-class |
| money-math | mocha | ✅ first-class |
| medici | ts-mocha | ✅ first-class |
| @octokit/webhooks | vitest | ✅ (vitest runner) |
| @octokit/webhooks-methods | vitest | ✅ (vitest runner) |
| dinero.js | vitest | ✅ (vitest runner) |
| opossum | tape | ⚠️ no first-class Stryker runner |

---

## Recommended pairing for the demo

**Primary target:** `@octokit/webhooks` (REDLINE webhook-signature + event-validation clauses;
SPLITBRAIN via vitest; WARPATH on a signature-rejection incident).

**Best-perfect-mutation target (mocha):** `cockatiel` (retry/breaker/timeout — deep mutation
surface) or `money-math` (compact, crystal-clear money/cents clauses).

**Best money/ledger target:** `medici` (accounting invariants; embedded Mongo, mocha).

**Credibility-lane big name:** `dinero.js` (6.8k★ money lib, vitest) — use as the "public
spec" lane per the dual-spec stance.

**Spec-source only:** `svix-webhooks` (webhook-signing spec) — derive clauses, don't mutate.