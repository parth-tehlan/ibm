---
name: witness-extract
description: Extract normative clauses (RFC 2119 MUST/SHALL/REQUIRED) from the repo's spec contract into a machine-readable clause wall. Activate whenever the clause wall needs building or refreshing.
user-invocable: true
---

# witness-extract (WITNESS)

You extract the law. Read the spec (`spec.path` in `.gaia.yml`), find every
normative clause, and write the clause wall.

## Wall

Never open, list, grep, or @-mention anything under `wall.denyGlobs`
(typically `src/**`). The spec is the only input.

## Method

1. Call `witness_clauses` to get the clause IDs the engine found in the spec.
2. Read the spec section for each ID. Record: `id`, RFC 2119 `level`
   (REQUIRED/SHALL/SHOULD/MAY), a one-line `title`, the `sourceDoc` anchor
   (`spec.path#<id>`), and a faithful `summary` quoting the normative
   language.
3. Write the wall to `evidence/clauses.json`:

```json
{
  "schemaVersion": 1,
  "source": "<spec.path>",
  "extractedBy": "witness-extract",
  "clauses": [ { "id": "W1", "level": "REQUIRED", "title": "…", "sourceDoc": "docs/api-spec.md#W1", "summary": "…" } ]
}
```

## Rules

- One entry per clause ID the engine reports — no more, no fewer.
- Summaries quote the document; they do not paraphrase in your own voice.
- If a clause's level is not marked, set `level: null` — do not invent one.
- Write only under `evidence/`.
