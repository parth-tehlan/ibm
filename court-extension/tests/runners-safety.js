'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runners = require('../lib/runners');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-runner-'));
  const oldPath = process.env.PATH;
  try {
    const cfg = { repoRoot: tmp, tests: { framework: 'jest', absDir: path.join(tmp, 'tests'), clauseTestPattern: 'clause-{{clause}}.test.ts' }, spec: { clauseIdPattern: '^W\\d+$' } };
    const source = path.join(tmp, 'tests', 'clause-W1.test.ts');
    const sandbox = path.join(tmp, '.stryker-tmp', 'sandbox', 'tests', 'clause-W1.test.ts');
    assert.equal(runners.isClauseTestFile(cfg, source), true);
    assert.equal(runners.isClauseTestFile(cfg, sandbox), false);
    assert.equal(new RegExp(runners.allClauseFilesRegex(cfg)).test(sandbox), false);
    assert.equal(new RegExp(runners.clauseFileRegex(cfg, 'W1')).test(source), true);
    const fake = path.join(tmp, 'npx');
    fs.writeFileSync(fake, '#!/bin/sh\ncat "$TRIUMPH_FAKE_JEST_JSON"\nexit 1\n', { mode: 0o700 });
    const fixture = path.join(tmp, 'jest.json');
    process.env.PATH = tmp + path.delimiter + oldPath;
    process.env.TRIUMPH_FAKE_JEST_JSON = fixture;
    fs.writeFileSync(fixture, JSON.stringify({ testResults: [
      { name: source, assertionResults: [], message: 'suite setup failed' },
      { name: sandbox, assertionResults: [{ title: 'fake', status: 'passed' }] },
    ] }));
    const zero = await runners.runTests(cfg, null);
    assert.equal(zero.suites, null);
    assert.match(zero.error, /zero assertions/);
    assert.match(zero.stderr.join('\n'), /suite setup failed/);
    fs.writeFileSync(fixture, JSON.stringify({ numPassedTests: 0, numFailedTests: 1, numTotalTests: 1, testResults: [
      { name: source, assertionResults: [{ title: 'real', status: 'failed', failureMessages: ['intentional'] }] },
      { name: sandbox, assertionResults: [{ title: 'fake', status: 'passed' }] },
    ] }));
    const failed = await runners.runTests(cfg, null);
    assert.equal(failed.suites.length, 1);
    assert.equal(failed.suites[0].assertions[0].status, 'failed');
    assert.equal(failed.raw.exitCode, 1);
    console.log('runner safety: sandbox excluded, zero assertions reported, real failures retained');
  } finally {
    process.env.PATH = oldPath;
    delete process.env.TRIUMPH_FAKE_JEST_JSON;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
