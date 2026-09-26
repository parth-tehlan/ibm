'use strict';
// Newline-framed MCP engine client. Reject all outstanding calls on engine death.
const { spawn } = require('child_process');
const readline = require('readline');

class McpClient {
  constructor(enginePath, repoRoot) {
    this.enginePath = enginePath;
    this.repoRoot = repoRoot;
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = '';
  }
  async start() {
    if (this.child) throw new Error('Engine already started');
    const child = spawn(process.execPath, [this.enginePath, '--repo', this.repoRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    child.on('error', (e) => this._fail(e));
    child.on('exit', (code, signal) => this._fail(new Error(`Engine exited (${signal || code}): ${this.stderr.slice(-500)}`)));
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(msg.error.message || 'MCP engine error'));
      else pending.resolve(msg.result);
    });
    await this._request('initialize', {}, 15000);
  }
  _fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  _request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin.writable || this.child.exitCode !== null) return reject(new Error('Engine not running'));
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Engine ${method} timed out: ${this.stderr.slice(-500)}`));
        this.dispose();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (e) => {
        if (e && this.pending.has(id)) {
          clearTimeout(timer); this.pending.delete(id); reject(e);
        }
      });
    });
  }
  async call(name, args) {
    // Court execution (especially mutation and test suites) can be long-running;
    // finite deadline prevents a broken pipe from pinning the extension forever.
    const result = await this._request('tools/call', { name, arguments: args || {} }, 20 * 60_000);
    if (result?.isError) throw new Error(result.content?.[0]?.text || `Engine ${name} failed`);
    try { return JSON.parse(result.content[0].text); }
    catch { throw new Error(`Engine ${name} returned invalid JSON evidence`); }
  }
  dispose() {
    this._fail(new Error('Engine disposed'));
    if (this.rl) this.rl.close();
    if (this.child) {
      try { this.child.stdin.end(); } catch { /* closed */ }
      try { this.child.kill(); } catch { /* gone */ }
    }
    this.child = null;
  }
}
module.exports = { McpClient };
