'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { McpClient } = require('../src/mcp-client');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-mcp-'));
  const engine = path.join(dir, 'engine.js');
  try {
    fs.writeFileSync(engine, `const r = require('readline').createInterface({input:process.stdin});
      r.on('line', s => { const x=JSON.parse(s);
        if(x.method==='initialize') console.log(JSON.stringify({id:x.id,result:{}}));
        else if(x.params.name==='crash') process.exit(7);
        else if(x.params.name==='bad') console.log(JSON.stringify({id:x.id,result:{content:[{text:'bad json'}]}}));
        else console.log(JSON.stringify({id:x.id,result:{content:[{text:'{"summary":{"red":1}}'}]}}));
      });`);
    const client = new McpClient(engine, dir);
    await client.start();
    assert.deepStrictEqual(await client.call('ok'), { summary: { red: 1 } });
    await assert.rejects(client.call('bad'), /invalid JSON evidence/);
    await assert.rejects(client.call('crash'), /Engine exited \(7\)/);
    client.dispose();
    console.log('  ok  MCP engine exit rejects pending calls; invalid evidence fails closed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
