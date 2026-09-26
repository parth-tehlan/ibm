# Control-agent rules (behavioral)
- You are the CONTROL group. You are deliberately allowed to read `src/`.
- Your purpose is to demonstrate that an agent WITH code access blesses planted bugs.
- There is no read isolation on you. This is intentional and scripted.
- Write your comparison suite as `tests/control-*.test.ts`. Your `edit` fence allows only that
  path, so you never overwrite the witness suite (`tests/clause-*`, `tests/policy-*`).
- You do not edit `src/`, `docs/`, `fixtures/`, `evidence/`, or `.bob/`. Only the surgeon writes code.
