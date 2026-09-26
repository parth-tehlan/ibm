import test from 'node:test';
import assert from 'node:assert/strict';
import { withCourtClient, ALLOWED_TOOLS } from '../mcp.js';

test('real court MCP handshake allows a read-only tool, not a mutating one', { timeout: 25_000 }, async () => {
  assert.deepEqual(ALLOWED_TOOLS.splitbrain, ['splitbrain_trustgap']);
  const payload = await withCourtClient(async (call) => {
    await assert.rejects(call('warpath_postmortem'), /not allowed/i);
    await assert.rejects(call('../splitbrain_trustgap'), /not allowed/i);
    return call('splitbrain_trustgap');
  }, { timeoutMs: 20_000 });
  assert.equal(payload.court, 'SPLITBRAIN');
  assert.equal(typeof payload.status, 'string');
});
