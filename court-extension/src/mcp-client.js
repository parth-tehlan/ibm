'use strict';
/**
 * src/mcp-client.js — minimal MCP stdio client for the extension host.
 * Speaks JSON-RPC 2.0 newline-delimited to court.js. No deps.
 */

const { spawn } = require('child_process');
const readline = require('readline');

class McpClient {
  constructor(enginePath, repoRoot) {
    this.enginePath = enginePath;
    this.repoRoot = repoRoot;
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.rl = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.child = spawn('node', [this.enginePath, '--repo', this.repoRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.on('error', reject);
      let stderr = '';
      this.child.stderr.on('data', (d) => { stderr += d; });
      this.rl = readline.createInterface({ input: this.child.stdout });
      this.rl.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      });
      const rid = ++this.nextId;
      this.pending.set(rid, { resolve: () => resolve(), reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'initialize', params: {} }) + '\n');
      setTimeout(() => reject(new Error('engine initialize timeout: ' + stderr.split('\n').slice(-5).join(' '))), 15000);
    });
  }

  call(name, args) {
    return new Promise((resolve, reject) => {
      const rid = ++this.nextId;
      this.pending.set(rid, {
        resolve: (result) => {
          try { resolve(JSON.parse(result.content[0].text)); }
          catch (e) { reject(e); }
        },
        reject,
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: { name, arguments: args || {} } }) + '\n');
    });
  }

  dispose() {
    try { this.child && this.child.stdin.end(); } catch { /* noop */ }
    try { this.child && this.child.kill(); } catch { /* noop */ }
    this.pending.clear();
  }
}

module.exports = { McpClient };
