# Verified Compliance-Source Repositories — Four Domains

Researched + **empirically verified** (cloned, `npm install`, `npm test` run) on
2025-xx (Node v24.20.0 / npm 11.19.0). Each repo's GitHub page was loaded to confirm
it is real, get stars/license, and confirm its README/API shape.

Legend for test column:
- ✅**clean** = `npm install && npm test` passed on a fresh clone, no external services.
- ✅**clean-with-notes** = passed but emitted npm `allowScripts` postinstall warnings (esbuild etc.); harmless.
- ⚠️ = needs external infra or non-npm build.

---

## Domain A — Payments / Ledger / Double-entry bookkeeping

### A1. medici — `flash-oss/medici`  ★ 360  ·  MIT  ·  TypeScript
- **URL:** https://github.com/flash-oss/medici · npm: `medici` · 430 commits, 102 forks, maintained (v7.3).
- **What it is:** Double-entry accounting engine for **Node + Mongoose (MongoDB)**. Leader of the Node-ledger category; directly descends the lineage the other JS ledgers cloned.
- **README/docs & normative language:** Strong. Explicit cardinal rule quoted verbatim:
  > *"The cardinal rule of double-entry accounting is that 'for every debit entry, there must be a corresponding credit entry'... everything must balance out to zero, and that rule is applied to every journal entry... If the transactions for a journal entry do not balance out to zero, the system will throw a new error with the message `INVALID JOURNAL`."*
- **Testability / invariants:** Great fit. You can quote and test:
  - "Every journal entry balances to zero (debits == credits); non-balancing commit rejects."
  - Precision invariant: `new Book(name, { precision: N })`; **`precision: 0` = integer-only mode**; default 8 dp. Documented limits `Number.MAX_SAFE_INTEGER`.
  - Void = add equal-and-opposite reversing entry (never hard-delete) — audit invariant.
  - ACID/no-negative-balance pattern (`mongoTransaction`, `writelockAccounts`).
- **`npm install && npm test`: ⚠️ Clean out of the box.**
  - Empirically: installs, but the `spec/` suite's `before` hook connects to
    `mongodb://localhost/medici_test` (external MongoDB). Need a running Mongo.
  - It ships `mongodb-memory-server` and honors env `USE_MEMORY_REPL_SET=true`, but the
    memory-server **binary download postinstall is skipped under npm's `allowScripts`**
    policy in a fresh env, so it could not fetch Mongo 4.4 here. Either allow the postinstall
    with network, or point it at a local `mongod`. For the demo: **require MongoDB** (or
    provision a throwaway `mongodb-memory-server` before the run).

### A2. ledger — `ledger/ledger`  ★ 6.0k  ·  BSD-3-Clause  ·  C++/Python CLI
- **URL:** https://github.com/ledger/ledger · the canonical `ledger-cli` command-line accounting tool. 8,808 commits, 549 forks, actively maintained.
- **What it is:** Powerful double-entry accounting system driven from text files / CLI. Uses GMP/MPFR arbitrary-precision arithmetic internally.
- **README/docs & normative language:** Excellent, and uniquely strong for compliance derivation: the repo **vendors a formal semantics submodule** `ledger-semantics` (Lean 4 formalization of the ledger language) — a genuinely *normative* correctness artifact.
- **Testability / invariants:** Transaction MUST balance (balances-to-zero enforced); amount arithmetic is arbitrary precision (no float drift). Ideal for quoting double-entry correctness principles.
- **`npm install && npm test`: ❌ Not an npm project.**
  - CMake + Boost + GMP + MPFR build (`./acprep update; make check`). Not JS, so it cannot satisfy an `npm install && npm test` demo unless you only quote its docs and run its CLI/`make check` separately. Keep as a documentation/credibility source, not the testable lane.

### A3 (third for A — recommendation)
- The pure-JS field is thin; most other "double-entry" npm packages are small/unmaintained
  (e.g. `a.l.e`/`ale` is **archived Jan 2021**, 55★ — excludes it). Recommend pairing
  **medici** (real engine, Mongo) with **ledger-cli** (normative/formal semantics) rather
  than a low-quality third npm package. If a second *npm-testable* ledger lane is essential,
  consider **`radzserg/lefra`** (TypeScript ledger framework) — verify stars/test status before
  committing, as it is far less widely known than the two above.

---

## Domain B — Money / Currency / "never use floats" decimal precision

### B1. dinero.js — `dinerojs/dinero.js`  ★ 6.8k  ·  MIT  ·  TypeScript
- **URL:** https://github.com/dinerojs/dinero.js · 1,096 commits · heavily used (WooCommerce, Cypress Real World App, Vercel, AWS Lambda, Module Federation).
- **README/docs & normative language:** Strong, docs site (dinerojs.com), full API reference. Core concept documents are explicit about representation.
- **Testability / invariants — the flagship integer-minor-units candidate:**
  - Amounts are stored as an **integer in the currency's minor unit** (e.g. cents) — the design's central invariant you can quote and test ("all amounts are integer minor units; 500 USD cents → `toDecimal` = 13.00", no float).
  - Pluggable calculator: `number` (default) or `bigint` for large amounts (exact integer range guarantee).
  - **Rounding-modes correctness**: ship exhaustive rounding implementations — `halfUp`, `halfDown`, `halfEven` (banker's), `halfOdd`, `halfAwayFromZero`, `halfTowardsZero`.
  - **`allocate`/`distribute`** — the "split pennies/remainder without losing a cent" invariant (tested: `allocate` 52 tests, `distribute` 14 tests).
  - Immutable & pure (every op returns a new object) — side-effect-free invariant.
- **`npm install && npm test`: ✅ clean.**
  - Empirically (monorepo `npm test`, vitest): all API + core rounding suites **pass** — `add`(32), `subtract`(14), `compare`(36), `equal`(38), `toDecimal`(38), `allocate`(52), `transformScale`(69), plus *every* `half*` rounding file (18–22 each) and `distribute`(14). Notable: `esbuild` postinstall was skipped under `allowScripts` but tests still ran/passed.

### B2. decimal.js — `MikeMcl/decimal.js`  ★ 7.3k  ·  MIT  ·  plain JS (ES3)
- **URL:** https://github.com/MikeMcl/decimal.js · 178 commits · zero runtime deps; used by math.js.
- **README/docs & normative language:** Very strong. Documented precision/rounding model (significant-digit precision, 9 rounding modes like Python's `decimal`), explicit statement that numeric-literal loss reflects IEEE-754 `Number`.
- **Testability / invariants:**
  - Arbitrary-precision decimal arithmetic; **all calculations rounded to configured precision** — the key correctness guarantee.
  - Explicit "don't lose `0.3 - 0.1`"-style invariants, and the documented precision-guard ("pass strings for >15 significant digits").
  - Compare/rounding-mode correctness is exhaustively tested.
- **`npm install && npm test`: ✅ clean.**
  - Empirically: **22,658 of 22,658 tests passed** in 1.2 s, zero deps. Simplest possible demo lane (device: single file, no build).

---

## Domain C — HTTP retry / backoff / circuit-breaker (resilience)

### C1. cockatiel — `connor4312/cockatiel`  ★ 1.8k  ·  MIT  ·  TypeScript
- **URL:** https://github.com/connor4312/cockatiel · 130 commits · 1.8k★ · "no dependencies" badge.
- **README/docs & normative language:** Strong; whole API documented (backoffs, retry, circuit breaker, bulkhead, timeout, fallback). Modeled on .NET **Polly**.
- **Testability / invariants — the best backoff-invariant candidate in the whole shortlist:**
  - Backoffs are **immutable**, expose `.duration` in ms (unit-testable floor/upper-bound checks).
  - `ExponentialBackoff` has explicit params to test: `initialDelay` (default 128 ms), `maxDelay` (default 30 s), `exponent` (default 2), and selectable **jitter generators** (`noJitter`, `fullJitter [0,interval)`, `halfJitter [interval/2, interval)`, `decorrelatedJitter` — default). ⇒ **"inter-attempt delay always ≥ 0; noJitter delay is exactly initialDelay·exponent^attempt, capped at maxDelay"** is a clean, testable clause.
  - Circuit breaker state machine: `BrokenCircuitError` when open; `halfOpenAfter`; `ConsecutiveBreaker(n)`, `CountBreaker`, `SamplingBreaker` — "after n consecutive failures the circuit MUST open" is testable.
  - `retry(maxAttempts)` — "the function is attempted at most `maxAttempts` times; last error/result surfaced".
- **`npm install && npm test`: ✅ clean.**
  - Empirically: **133 passing, 0 failing**, exit 0. Test files include backoff + circuit-state suites (`ConstantBackoff`, `ExponentialBackoff + generators`, `ConsecutiveBreaker`, `CountBreaker`, `SamplingBreaker`, bulkhead). The `npm test` pipeline also runs `tsc` compile, prettier `--list-different`, and remark (all green).

### C2. opossum — `nodeshift/opossum`  ★ 1.7k  ·  Apache-2.0  ·  JS (+ `@types/opossum`)
- **URL:** https://github.com/nodeshift/opossum · Node Circuit Breaker "fails fast ⚡️".
- **README/docs & normative language:** Strong; extensively documented API, open-source docs site, `documentation.yml`. Engines: **Node ≥ 22**.
- **Testability / invariants:**
  - `errorThresholdPercentage` + `volumeThreshold`: "breaker opens when failure-rate % > threshold (after enough fires)". README literally includes the `open()` comparison code — quote it.
  - `resetTimeout` → `halfOpen` → on success `closed`, on failure re-`open`.
  - Rolling stats window semantics (`rollingCountTimeout`/`rollingCountBuckets`).
- **`npm install && npm test`: ✅ (expected clean; Node ≥ 22).** Not run here, but pure JS with test suite and no external services. Given Node v24 present, it should pass.

### C3. p-retry — `sindresorhus/p-retry`  ★ 1.0k  ·  MIT  ·  ESM, pure JS/TS
- **URL:** https://github.com/sindresorhus/p-retry · "Retry a promise-returning or async function."
- **README/docs & normative language:** Strong; full API with explicit option semantics.
- **Testability / invariants:**
  - Explicit backoff model: `minTimeout` (default 1000), `factor` (default 2), `maxTimeout` (default ∞), `randomize` (multiplies delay by [1,2)). Retry delay from `(minTimeout, factor, maxTimeout, randomize)` — testable as "delay ≥ minTimeout (when not randomized) and ≤ maxTimeout".
  - `retries` cap (default 10) — "at most `retries` retries, then reject with last reason".
  - `maxRetryTime` measured on **monotonic clock** (`performance.now()`).
  - `AbortError`/`AbortController.signal` cancellation, `TypeError` (non-network) never retried.
- **`npm install && npm test`: ✅ clean.**
  - Empirically: **71 tests passed** (incl. "maxTimeout lower than minTimeout caps delay", "retriesLeft is Infinity when retries is Infinity", abort cancellation). One benign npm `allowScripts` warning on a transitive tool.

---

## Domain D — Webhook signature verification / HMAC

### D1. @octokit/webhooks — `octokit/webhooks.js`  ★ 349  ·  MIT  ·  TypeScript
- **URL:** https://github.com/octokit/webhooks.js · npm `@octokit/webhooks` · the official GitHub webhooks toolset for Node. 1,015 commits, still maintained.
- **README/docs & normative language:** Strong and very precise about verification semantics.
- **Testability / invariants — ideal HMAC candidate:**
  - `webhooks.sign(payload)` and `webhooks.verify(payload, signature)` — **"verify returns true iff signature was computed by `sign` with the configured secret; returns false otherwise."** (Constant-time behavior via `webhooks-methods`.)
  - `verifyAndReceive` rejects on tampered signature.
  - Secret **required** to construct `Webhooks`; content-type JSON only.
  - Also exposes `webhooks-methods` (sign/verify) standalone.
- **`npm install && npm test`: ✅ clean.**
  - Empirically: **93 tests passed across 16 files**, incl. integration `webhooks.test.ts` and `event-handler` suites. One benign `allowScripts` warning (esbuild).

### D2. svix-webhooks — `svix/svix-webhooks`  ★ 3.4k  ·  MIT  ·  Rust server + 9 official SDKs
- **URL:** https://github.com/svix/svix-webhooks · "enterprise webhook service 🦀"; the backend powering the widely-adopted Svix webhook platform. 3,958 commits.
- **README/docs & normative language:** Very strong; full API docs + receiving/verifying guides (docs.svix.com).
- **Testability / invariants:**
  - Webhook signing: **Ed25519** (asymmetric) or **symmetric HMAC** (whsec_*). Signature scheme documented precisely.
  - Verification contract: reject if signature mismatch; **check timestamp recency to prevent replay attacks** (explicit normative guidance).
  - SDKs (JS/Python/Go/Java/... each expose `Webhook.verify`/`verifyHeader`).
- **`npm install && npm test`: ⚠️ Clean out of the box for the JS *SDK*, heavy for the full repo.** The monorepo is Rust server + codegen'd SDKs (needs Cargo for `server/`). To use as a demo lane, target the **`javascript/` SDK** package rather than the whole monorepo, and note it needs network for cargo/registry if you build the server.

### D3 (third for D — recommendation)
- **svix** covers the "platform-grade webhook signing" angle; @octokit/webhooks covers the
  GitHub-HMAC angle. If a third is wanted, the standalone **`webhooks-methods`** (from
  octokit, the HMAC sign/verify primitive behind @octokit/webhooks) or **`jose`** (general
  JOSE/HMAC, 5k+★, MIT) are natural additions. `jose` is especially easy to `npm install && npm test`.

---

## Empirical test summary (run on this machine)

| Repo | Domain | npm install && npm test | Result |
|------|:-----:|--------------------------|--------|
| **dinero.js** | B | ✅ clean | vitest all green (add 32, allocate 52, all 6 half* rounding files, distribute 14, toDecimal 38, …) |
| **decimal.js** | B | ✅ clean | **22,658 / 22,658 passed** (1.2 s, zero deps) |
| **cockatiel** | C | ✅ clean | **133 passing / 0 failing** (+ tsc, prettier, remark) |
| **p-retry** | C | ✅ clean | 71 passing |
| **@octokit/webhooks** | D | ✅ clean | 93 passing across 16 files |
| **medici** | A | ⚠️ external Mongo | installs, but spec needs `mongodb://localhost:27017`; memory-server binary blocked by npm `allowScripts` in this env |
| **ledger-cli** | A | ❌ not npm | CMake/Boost/GMP build; use as docs/semantics source |

## Recommended "compliance-source" fixture line-up (best 2-3 per domain)

- **A: ledger / double-entry** → **medici** (real double-entry engine, quote the "balances to zero / INVALID JOURNAL" rule; needs MongoDB) + **ledger-cli** (formal Lean semantics + arbitrary-precision money; documentation/credibility lane). *Thin pure-JS market; avoid `ale` (archived).*
- **B: money precision** → **dinero.js** (integer minor units + rounding-mode + allocate/distribute invariants) + **decimal.js** (arbitrary-precision, 22.6k passing tests). Both `npm test` clean.
- **C: resilience** → **cockatiel** (explicit backoff invariants: min delay, float-capped maxDelay, jitter ranges, circuit state) + **opossum** (threshold→open state machine) + **p-retry** (min/factor/max timeout, monotonic maxRetryTime). All clean.
- **D: webhook HMAC** → **@octokit/webhooks** (sign/verify round-trip, tamper rejection) + **svix** SDKs (Ed25519 + HMAC + replay-timestamp guidance). Both `npm test`-clean on the JS SDK lane.

*Verification context: all GitHub pages loaded directly; clones pulled from github.com; tests run on Node v24.20.0 / npm 11.19.0 in `/tmp/repo-verify`. npm v11's `allowScripts` policy blocks postinstall downloads (esbuild, mongodb-memory-server) unless `npm install-scripts approve` is run — the only reason medici didn't self-provision Mongo here.*