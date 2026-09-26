import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ALLOWED_TOOLS = Object.freeze({
  redline: ['redline_verdict_all'],
  splitbrain: ['splitbrain_trustgap'],
  warpath: ['warpath_context', 'warpath_triage'],
});
const ENGINE = fileURLToPath(new URL('../../court-extension/court.js', import.meta.url));
const MAX_OUTPUT = 8 * 1024 * 1024;

// Only fixed, read-only tools are callable; the engine contains other mutating tools.
export async function withCourtClient(work, { engine = ENGINE, timeoutMs = 150_000 } = {}) {
  const child = spawn(process.execPath, [engine], {
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    env: { ...process.env },
  });
  let nextId = 0;
  let bytes = 0;
  let ended = false;
  const pending = new Map();
  let stderr = '';
  const fail = (error) => {
    ended = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const kill = () => {
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    } else if (!child.killed) child.kill('SIGKILL');
  };
  const timer = setTimeout(() => {
    fail(new Error(`Court MCP timeout after ${timeoutMs}ms`));
    kill();
  }, timeoutMs);
  timer.unref();
  child.stdin.on('error', (error) => fail(error));
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT) { fail(new Error('Court MCP output limit exceeded')); kill(); }
  });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { fail(new Error('Invalid court MCP JSON')); kill(); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.jsonrpc !== '2.0') entry.reject(new Error('Invalid court MCP response'));
    else if (message.error) entry.reject(new Error(`Court MCP: ${String(message.error.message || 'unknown error')}`));
    else entry.resolve(message.result);
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.on('error', (error) => fail(error));
  child.on('close', (code) => {
    if (!ended) fail(new Error(`Court MCP exited (${code})${stderr ? `: ${stderr}` : ''}`));
  });
  function request(method, params) {
    if (ended) return Promise.reject(new Error('Court MCP process closed'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
        if (err) { pending.delete(id); reject(err); }
      });
    });
  }
  try {
    const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'northstar-dashboard', version: '1.0.0' } });
    if (init?.protocolVersion !== '2024-11-05' || !init?.capabilities?.tools) throw new Error('Incompatible court MCP server');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await request('tools/list');
    const names = new Set(listed?.tools?.map((t) => t.name));
    if (![...Object.values(ALLOWED_TOOLS).flat()].every((name) => names.has(name))) throw new Error('Required court MCP tools unavailable');
    return await work(async (name) => {
      if (![...Object.values(ALLOWED_TOOLS).flat()].includes(name)) throw new Error('Court MCP tool not allowed');
      const result = await request('tools/call', { name, arguments: {} });
      const text = result?.content?.find((c) => c.type === 'text')?.text;
      if (typeof text !== 'string') throw new Error(`Court MCP ${name}: missing text response`);
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Court MCP ${name}: invalid payload`);
      return payload;
    });
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    // Do not leave a Jest grandchild alive on error/timeout or a hung engine on success.
    if (!ended) {
      await Promise.race([
        new Promise((resolve) => child.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    kill();
    rl.close();
  }
}
