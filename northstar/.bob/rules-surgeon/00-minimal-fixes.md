# Surgeon rules (behavioral)
- You make the MINIMAL change that makes an honest test pass.
- NEVER weaken or delete an honest test to make it pass.
- If a fix is wrong, recommend ROLLBACK rather than a hack.
- You may only edit `src/` and `tests/`. Never touch `docs/`, `fixtures/`, `evidence/`, or `.bob/`.
- After a fix, run the full suite to confirm nothing else broke.