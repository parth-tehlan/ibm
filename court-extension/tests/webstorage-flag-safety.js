'use strict';
// Regression coverage for the conditional --no-experimental-webstorage
// injection in lib/runners.js's spawnCollect: the flag must only reach a
// child whose own `node` actually accepts it, existing NODE_OPTIONS must
// survive, and the flag must never be duplicated on repeat calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runners = require('../lib/runners');

const FLAG = '--no-experimental-webstorage';

// A fake `node` placed first on PATH: it plays two roles, matching exactly
// what production code does with the real `node` binary. (1) The probe
// invocation `node --no-experimental-webstorage -e ...` - exits 0 only when
// FAKE_NODE_SUPPORTS_FLAG=1, otherwise mimics a real older Node's refusal.
// (2) Any other invocation is spawnCollect's actual child - it dumps the
// NODE_OPTIONS it received so the test can inspect it.
const FAKE_NODE = `#!/bin/sh
if [ "$1" = "${FLAG}" ]; then
  if [ "$FAKE_NODE_SUPPORTS_FLAG" = "1" ]; then
    exit 0
  fi
  echo "bad option: ${FLAG}" 1>&2
  exit 9
fi
printf '%s' "$NODE_OPTIONS" > "$FAKE_NODE_ENV_DUMP"
exit 0
`;

async function withFakeNode(supportsFlag, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-webstorage-'));
  const oldPath = process.env.PATH;
  const oldSupports = process.env.FAKE_NODE_SUPPORTS_FLAG;
  const oldDump = process.env.FAKE_NODE_ENV_DUMP;
  const dumpFile = path.join(tmp, 'env-dump.txt');
  try {
    fs.writeFileSync(path.join(tmp, 'node'), FAKE_NODE, { mode: 0o700 });
    process.env.PATH = tmp + path.delimiter + oldPath;
    process.env.FAKE_NODE_SUPPORTS_FLAG = supportsFlag ? '1' : '0';
    process.env.FAKE_NODE_ENV_DUMP = dumpFile;
    return await fn(tmp, dumpFile);
  } finally {
    process.env.PATH = oldPath;
    if (oldSupports === undefined) delete process.env.FAKE_NODE_SUPPORTS_FLAG; else process.env.FAKE_NODE_SUPPORTS_FLAG = oldSupports;
    if (oldDump === undefined) delete process.env.FAKE_NODE_ENV_DUMP; else process.env.FAKE_NODE_ENV_DUMP = oldDump;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  const oldNodeOptions = process.env.NODE_OPTIONS;
  try {
    // 1. Supported Node: the flag is probed successfully and added.
    await withFakeNode(true, async (tmp, dumpFile) => {
      delete process.env.NODE_OPTIONS;
      const r = await runners.spawnCollect('node', ['ignored'], { cwd: tmp });
      assert.equal(r.ok, true);
      const seen = fs.readFileSync(dumpFile, 'utf8');
      assert.match(seen, new RegExp(FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    // 2. Unsupported Node (older Node's "bad option"): must never add the
    //    flag, and must not otherwise alter the child's environment.
    await withFakeNode(false, async (tmp, dumpFile) => {
      delete process.env.NODE_OPTIONS;
      const r = await runners.spawnCollect('node', ['ignored'], { cwd: tmp });
      assert.equal(r.ok, true);
      const seen = fs.readFileSync(dumpFile, 'utf8');
      assert.equal(seen, '', 'an unsupported node must receive no NODE_OPTIONS at all');
    });

    // 3. Existing NODE_OPTIONS is preserved (appended to, not clobbered),
    //    and a repeat call never duplicates the flag.
    await withFakeNode(true, async (tmp, dumpFile) => {
      process.env.NODE_OPTIONS = '--max-old-space-size=4096';
      const r1 = await runners.spawnCollect('node', ['ignored'], { cwd: tmp });
      assert.equal(r1.ok, true);
      const seen1 = fs.readFileSync(dumpFile, 'utf8');
      assert.match(seen1, /--max-old-space-size=4096/);
      assert.match(seen1, new RegExp(FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      fs.writeFileSync(dumpFile, '');
      const r2 = await runners.spawnCollect('node', ['ignored'], { cwd: tmp });
      assert.equal(r2.ok, true);
      const seen2 = fs.readFileSync(dumpFile, 'utf8');
      const occurrences = seen2.split(FLAG).length - 1;
      assert.equal(occurrences, 1, `flag must not be duplicated on repeat calls, got: ${JSON.stringify(seen2)}`);
      assert.match(seen2, /--max-old-space-size=4096/);
    });

    console.log('webstorage flag safety: added only when the child node supports it, existing NODE_OPTIONS preserved, never duplicated');
  } finally {
    if (oldNodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = oldNodeOptions;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
