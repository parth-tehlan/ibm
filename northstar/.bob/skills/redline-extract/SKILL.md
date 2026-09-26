---
name: redline-extract
description: Parse the RFC-2119 API spec (@/docs/api-spec.md) into machine-useable clause-wall entries (W1..W8 MUST/SHALL clauses) and write evidence/clauses.json. Activate whenever a REDLINE extraction of spec requirements is needed.
user-invocable: true
---

# redline-extract

Turn the normative spec document into the **clause wall** that the whole REDLINE
lane (and later SPLITBRAIN trust-gap) hangs off of. You are a **clause miner**:
you read only the *document*, never the implementation. Isolation-as-correctness
applies to every REDLINE step.

> **WITNESS RULE** — You must never read anything under `src/`. Never
> `@`-mention a source path. If you are tempted to open the code, stop: the
> clause wall exists precisely because you did not read it.

## Goal / Definition of done

A single source-of-truth file `evidence/clauses.json` that lists every normative
requirement of the spec with a stable ID, import level (RFC 2119), and the
document text it came from.

```json
{
  "schemaVersion": 1,
  "source": "docs/api-spec.md",
  "clauses": [
    {
      "id": "W1",
      "level": "REQUIRED",
      "title": "Payment intent idempotency",
      "sourceDoc": "docs/api-spec.md#W1",
      "summary": "POST /v1/payment_intents MUST be idempotent on Idempotency-Key."
    }
  ]
}
```

## Steps

1. **Keep the spec in context.** Reference `@/docs/api-spec.md` at the top of your
   work so the clause text is grounded in the document, not memory.
2. **Enumerate clauses.** Walk the spec section by section and extract every
   requirement that uses a normative keyword. There are expected to be exactly
   **W1..W8**. Do not invent clauses beyond the document.
3. **For each clause**, record:
   - `id`: the stable W-number in the doc.
   - `level`: the RFC 2119 level literally stated (`REQUIRED`, `SHALL`, ...).
   - `title`: a short human name from the section heading.
   - `summary`: one sentence, in the document's own words.
   - `sourceDoc`: anchor back to `docs/api-spec.md#W<n>`.
4. **Write `evidence/clauses.json`** with every clause, exactly one entry per
   normative paragraph group. Keep the JSON strictly valid — you will
   cross-check with a JSON parse before finishing.
5. **Cross-check count.** Re-open the written file and confirm all of W1..W8 are
   present and no W-number is missing or duplicated.
6. **Hand off.** Emit a short summary of how many clauses were extracted and
   their levels, so the next REDLINE step (`redline-test`) has a known input.

## Constraints

- Only edit `evidence/clauses.json` (and any scratch under the writable
  `tests/` area). Do NOT touch `src/`.
- Strict valid JSON; no trailing comments.
- Do not block on whether the implementation complies — that is
  `redline-test`'s job, later.