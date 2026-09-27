'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { McpClient } = require('../src/mcp-client');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mutation-safety-'));
  // runMutationJob gates on node_modules presence (fail-fast npm-install
  // prereq); an empty dir satisfies the existence check so the async job stays
  // 'running' long enough for the concurrent busy-refusal to be exercised.
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  const client = new McpClient(path.resolve(__dirname, '..', 'court.js'), root);
  try {
    fs.mkdirSync(path.join(root, 'reports', 'mutation'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'));
    fs.mkdirSync(path.join(root, 'tests'));
    fs.writeFileSync(path.join(root, 'docs', 'spec.md'), '## W1 — sample\n');
    fs.writeFileSync(path.join(root, 'reports', 'mutation', 'mutation.json'), '{"old":"not evidence"}\n');
    fs.writeFileSync(path.join(root, '.gaia.yml'), [
      'version: 1',
      'spec: { path: docs/spec.md, clausePattern: "^## (W\\d+)", clauseIdPattern: "^W\\d+$" }',
      'tests: { framework: jest, dir: tests, clauseTestPattern: "clause-{{clause}}.test.ts" }',
      'mutation: { tool: stryker, report: reports/mutation/mutation.json, command: "node mutation.cjs", timeoutSeconds: 10 }',
      'wall: { denyGlobs: ["src/**"] }',
    ].join('\n') + '\n');
    // Keep the first job alive ~1s: long enough that the immediately-following
    // second trustgap_mutate overlaps it and is refused with 'busy', yet short
    // enough that the 30x100ms status-poll window below observes it finishing.
    fs.writeFileSync(path.join(root, 'mutation.cjs'), 'setTimeout(() => { console.error("stryker dry-run failed"); process.exit(42) }, 1000)\n');
    await client.start();
    const started = await client.call('trustgap_mutate');
    assert.equal(started.status, 'started');
    const busy = await client.call('trustgap_mutate');
    assert.equal(busy.status, 'busy');
    assert.equal(busy.job_id, started.job_id);
    let status;
    for (let i = 0; i < 30; i++) {
      status = await client.call('trustgap_status', { job_id: started.job_id });
      if (status.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status.status, 'error', JSON.stringify(status));
    assert.equal(status.commandResult.exitCode, 42);
    assert.equal(status.commandResult.reportProduced, false);
    assert.match(status.commandResult.stderrTail, /dry-run failed/);
    assert.match(status.error, /mutation command failed \(exit 42\)/);
    assert.equal(status.result, undefined, 'historical report must not certify a failed command');

    fs.writeFileSync(path.join(root, 'mutation.cjs'), 'console.log("no report written")\n');
    const second = await client.call('trustgap_mutate');
    assert.equal(second.status, 'started');
    for (let i = 0; i < 30; i++) {
      status = await client.call('trustgap_status', { job_id: second.job_id });
      if (status.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status.status, 'error', JSON.stringify(status));
    assert.equal(status.commandResult.exitCode, 0);
    assert.equal(status.commandResult.reportProduced, false);
    assert.match(status.error, /exited successfully but produced no fresh report/);
    console.log('mutation safety: command failure, stale report, no-report exit and concurrent job checked');
  } finally {
    client.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
