// Hermetic MCP fixture: the dashboard tests protocol/allowlist behavior, not
// the extension owner's live court engine or any repository's evidence.
const readline = require('node:readline');

const tools = ['redline_verdict_all', 'splitbrain_trustgap', 'warpath_context', 'warpath_triage'];
const payloads = {
  redline_verdict_all: { court: 'REDLINE', status: 'complete', results: [{ clause: 'R1', status: 'red' }] },
  splitbrain_trustgap: { court: 'SPLITBRAIN', status: 'complete', trustGap: 0.42 },
  warpath_context: { court: 'WARPATH', status: 'complete', deploys: [{ id: 'D1' }], logWindow: [{ message: 'breaker OPEN' }] },
  warpath_triage: { court: 'WARPATH', status: 'complete', suspect: { id: 'D1' }, evidence: [{ message: 'breaker OPEN' }] },
};

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (message.method === 'tools/list') result = { tools: tools.map((name) => ({ name })) };
  else if (message.method === 'tools/call' && Object.hasOwn(payloads, message.params?.name)) {
    result = { content: [{ type: 'text', text: JSON.stringify(payloads[message.params.name]) }] };
  }
  const response = result === undefined
    ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown tool' } }
    : { jsonrpc: '2.0', id: message.id, result };
  process.stdout.write(JSON.stringify(response) + '\n');
});
