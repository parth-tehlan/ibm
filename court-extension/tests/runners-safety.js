'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runners = require('../lib/runners');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-runner-'));
  // runJestCli gates on node_modules presence (fail-fast npm-install prereq);
  // an empty dir satisfies the existence check so the fake-npx jest path below
  // is exercised for the zero-assertion / crash / duplicate detection cases.
  fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
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
    fs.writeFileSync(fake, '#!/bin/sh\ncat "$GAIA_FAKE_JEST_JSON"\nexit "${GAIA_FAKE_JEST_EXIT:-1}"\n', { mode: 0o700 });
    const fixture = path.join(tmp, 'jest.json');
    process.env.PATH = tmp + path.delimiter + oldPath;
    process.env.GAIA_FAKE_JEST_JSON = fixture;
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
    fs.writeFileSync(fixture, JSON.stringify({ testResults: [
      { name: source, status: 'passed', assertionResults: [{ title: 'looks green', status: 'passed' }] },
    ] }));
    const crashed = await runners.runTests(cfg, 'W1');
    assert.equal(crashed.suites, null);
    assert.match(crashed.error, /exited 1 without recorded assertion failures/);
    process.env.GAIA_FAKE_JEST_EXIT = '0';
    fs.writeFileSync(fixture, JSON.stringify({ testResults: [
      { name: source, status: 'passed', assertionResults: [{ title: 'pass', status: 'passed' }] },
      { name: source, status: 'passed', assertionResults: [{ title: 'pass', status: 'passed' }] },
    ] }));
    const duplicated = await runners.runTests(cfg, null);
    assert.equal(duplicated.suites, null);
    assert.match(duplicated.error, /duplicate clause suite/);
    console.log('runner safety: sandbox excluded, zero assertions and crashes reported, duplicate suites rejected, real failures retained');
  } finally {
    process.env.PATH = oldPath;
    delete process.env.GAIA_FAKE_JEST_JSON;
    delete process.env.GAIA_FAKE_JEST_EXIT;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
