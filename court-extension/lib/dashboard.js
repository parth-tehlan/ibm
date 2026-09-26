'use strict';
/**
 * lib/dashboard.js — extension-side driver for the packaged dashboard server.
 *
 * Separate-process handoff (PROCESS-HANDOFF.md): we fork server/index.js with
 * a Node IPC channel, register the project, and publish authenticated v2
 * snapshots over HTTP on loopback. The bearer token never leaves this process
 * and is never put in a URL.
 *
 * The child binds TRIUMPH_HOST=127.0.0.1 (forced here, not inherited) and an
 * ephemeral PORT=0. History lives in a caller-provided dir (or XDG default).
 */

const { fork } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const SERVER_ENTRY = path.join(DASHBOARD_DIR, 'server', 'index.js');

function postJson(url, body, token) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require('http').request({
      host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(buf); } catch { /* non-json */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else { const e = new Error(`POST ${u.pathname} → ${res.statusCode}: ${buf.slice(0, 200)}`); e.status = res.statusCode; reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(buf); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(`GET ${u.pathname} → ${res.statusCode}: ${buf.slice(0, 200)}`));
      });
    });
    req.on('error', reject); req.end();
  });
}

class DashboardClient {
  /**
   * @param {object} o
   * @param {{id:string,name:string}} o.project  stable project identity
   * @param {string} [o.historyDir]  dashboard history dir (else XDG default)
   * @param {(url:string)=>void} [o.onUrl]  called with the ready URL
   */
  constructor(o) {
    if (!o || !o.project || !o.project.id || !o.project.name) throw new Error('DashboardClient requires project {id,name}');
    this.project = o.project;
    this.historyDir = o.historyDir;
    this.onUrl = o.onUrl;
    this.child = null;
    this.url = null;
    this.token = null;
    this.connected = false;
    this._hb = null;
  }

  /** Fork the server, wait for ready, register the project, start heartbeats. */
  async start() {
    if (this.child) return this;
    this.child = fork(SERVER_ENTRY, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, PORT: '0', TRIUMPH_HOST: '127.0.0.1', ...(this.historyDir ? { XDG_DATA_HOME: this.historyDir } : {}) },
      cwd: DASHBOARD_DIR,
    });
    this.child.stderr.on('data', (d) => process.stderr.write('[dashboard] ' + d));
    const url = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('dashboard did not become ready')), 15000);
      const onMsg = (m) => {
        if (m && m.type === 'triumph.ready' && m.url) { clearTimeout(to); this.child.off('message', onMsg); resolve(m.url); }
      };
      this.child.on('message', onMsg);
      this.child.once('exit', (code) => { clearTimeout(to); reject(new Error('dashboard exited before ready (code ' + code + ')')); });
    });
    this.url = url;
    // Register over IPC; the token comes back only to this trusted process.
    const requestId = crypto.randomUUID();
    const reg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('registration timed out')), 10000);
      const onMsg = (m) => {
        if (m && m.requestId === requestId && m.type === 'triumph.registered') { clearTimeout(to); this.child.off('message', onMsg); resolve(m); }
        else if (m && m.requestId === requestId && m.type === 'triumph.registrationError') { clearTimeout(to); this.child.off('message', onMsg); reject(new Error(m.error)); }
      };
      this.child.on('message', onMsg);
      this.child.send({ type: 'triumph.register', requestId, project: this.project });
    });
    this.token = reg.token;
    this.connected = true;
    if (this.onUrl) this.onUrl(url);
    // Heartbeat immediately (establish liveness) then at 1/3 the 30s timeout.
    await this.heartbeat().catch(() => {});
    this._hb = setInterval(() => { this.heartbeat().catch(() => {}); }, 10_000);
    if (this._hb.unref) this._hb.unref();
    return this;
  }

  _api(p) { return `${this.url}/api/extension/${this.project.id}${p}`; }

  heartbeat() { return this.connected ? postJson(this._api('/heartbeat'), {}, this.token) : Promise.resolve(); }

  /** Publish a validated v2 snapshot. Returns {projectId,runId,revision}. */
  async publish(snapshot) {
    if (!this.connected) throw new Error('dashboard not connected');
    return postJson(this._api('/runs'), snapshot, this.token);
  }

  /** Poll for a pending browser "Run again" request. Returns request|null. */
  async poll() {
    if (!this.connected) return null;
    const r = await getJson(this._api('/requests'), this.token);
    return r && r.request ? r.request : null;
  }

  /** Acknowledge a pending rerun request so the server stops redelivering it. */
  acknowledge(requestId) { return postJson(this._api(`/requests/${requestId}/ack`), {}, this.token); }

  runUrl(runId) { return `${this.url}/projects/${this.project.id}/runs/${runId}`; }

  /** Clean shutdown: disconnect (interrupts unfinished runs), kill child, await exit. */
  async stop() {
    if (!this.connected) return;
    this.connected = false;
    if (this._hb) clearInterval(this._hb);
    try { await postJson(this._api('/disconnect'), {}, this.token); } catch { /* child may already be gone */ }
    const child = this.child;
    this.child = null;
    if (child) {
      await new Promise((resolve) => {
        const to = setTimeout(resolve, 5000); // don't hang forever
        child.once('exit', () => { clearTimeout(to); resolve(); });
        try { child.kill(); } catch { clearTimeout(to); resolve(); }
      });
    }
  }
}

module.exports = { DashboardClient, DASHBOARD_DIR, SERVER_ENTRY };
