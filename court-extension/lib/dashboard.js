'use strict';
const { fork } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const SERVER_ENTRY = path.join(DASHBOARD_DIR, 'server', 'index.js');

function jsonRequest(method, url, body, token) {
  const u = new URL(url);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw new Error('Dashboard URL must be loopback HTTP');
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('error', reject);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else { const error = new Error(`${method} ${u.pathname} → ${res.statusCode}: ${buf.slice(0, 200)}`); error.status = res.statusCode; reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Dashboard request timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// One process owns recovery for a history directory. Projects are separate
// capabilities on that process, not separate servers pointing at the same files.
class DashboardServer {
  constructor({ historyDir } = {}) { this.historyDir = historyDir; }
  async start() {
    if (this._starting) return this._starting;
    this._starting = this._start();
    try { return await this._starting; }
    catch (e) { this._starting = null; throw e; }
  }
  wait(predicate, timeoutMs) {
    const child = this.child;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError); child.off('disconnect', onDisconnect); };
      const fail = (error) => { cleanup(); reject(error); };
      const onMessage = (m) => { if (predicate(m)) { cleanup(); resolve(m); } };
      const onExit = (code) => fail(new Error(`Dashboard exited (code ${code})`));
      const onError = (error) => fail(error);
      const onDisconnect = () => fail(new Error('Dashboard IPC disconnected'));
      const timer = setTimeout(() => fail(new Error('Dashboard handshake timed out')), timeoutMs);
      child.on('message', onMessage); child.once('exit', onExit); child.once('error', onError); child.once('disconnect', onDisconnect);
    });
  }
  async _start() {
    if (!fs.existsSync(path.join(DASHBOARD_DIR, 'node_modules', 'zod')) || !fs.existsSync(path.join(DASHBOARD_DIR, 'dist', 'index.html'))) {
      throw new Error('Dashboard runtime missing; run npm run stage:dashboard before packaging');
    }
    const child = fork(SERVER_ENTRY, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      cwd: DASHBOARD_DIR,
      env: { ...process.env, PORT: '0', GAIA_HOST: '127.0.0.1',
        ...(this.historyDir ? { XDG_DATA_HOME: this.historyDir } : {}) } });
    this.child = child;
    child.stderr.on('data', (d) => process.stderr.write('[dashboard] ' + d));
    try {
      const ready = await this.wait((m) => m?.type === 'gaia.ready', 15000);
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url)) throw new Error('Invalid dashboard ready URL');
      this.url = ready.url;
      return this;
    } catch (e) { await this.stop(); throw e; }
  }
  async register(project) {
    await this.start();
    if (!this.child?.connected) throw new Error('Dashboard IPC disconnected');
    const requestId = crypto.randomUUID();
    const registration = this.wait((m) => m?.requestId === requestId &&
      ['gaia.registered', 'gaia.registrationError'].includes(m.type), 10000);
    try { this.child.send({ type: 'gaia.register', requestId, project }); }
    catch (e) {
      // The waiter has an exit/disconnect listener and will settle there.
      // Suppress its rejection explicitly so it doesn't become an unhandled
      // promise rejection — the real error is re-thrown to the caller below.
      registration.catch((suppressedErr) => {
        console.error('Dashboard registration waiter settled after IPC send failure:', suppressedErr && suppressedErr.message ? suppressedErr.message : suppressedErr);
      });
      throw e;
    }
    const reg = await registration;
    if (reg.type !== 'gaia.registered') throw new Error(reg.error);
    if (reg.project?.id !== project.id || !/^[a-f0-9]{64}$/.test(reg.token)) throw new Error('Invalid dashboard registration');
    return reg.token;
  }
  async stop() {
    if (this._stopping) return this._stopping;
    this._stopping = (async () => {
      const child = this.child;
      if (!child) return;
      if (child.exitCode === null && !child.signalCode) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        let timeout;
        await Promise.race([exited, new Promise((resolve) => { timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); })]);
        clearTimeout(timeout);
      }
      if (this.child === child) this.child = null;
    })();
    return this._stopping;
  }
}

class DashboardClient {
  constructor({ project, historyDir, server, onError }) {
    if (!project?.id || !project?.name) throw new Error('DashboardClient requires project {id,name}');
    this.project = project;
    this.server = server || new DashboardServer({ historyDir });
    this.ownsServer = !server;
    this.connected = false;
    this.onError = onError;
  }
  get child() { return this.server.child; }
  get url() { return this.server.url; }
  async start() {
    if (this._started) throw new Error('Dashboard already started');
    this._started = true;
    try {
      this.token = await this.server.register(this.project);
      this.connected = true;
      this._onExit = () => { this.connected = false; clearInterval(this._hb); };
      this.child.once('exit', this._onExit);
      this.child.once('disconnect', this._onExit);
      await this.heartbeat();
      this._hb = setInterval(() => {
        this.heartbeat().then(() => { this._misses = 0; }, async (error) => {
          if (error.status === 403) {
            try { await this.reconnect(); this._misses = 0; return; }
            catch (cause) { error = cause; }
          }
          if (++this._misses >= 3) { this._misses = 0; this.onError?.(error); }
        });
      }, 10000);
      return this;
    } catch (e) { await this.stop(); throw e; }
  }
  _api(p) { return `${this.url}/api/extension/${this.project.id}${p}`; }
  _request(method, p, data) {
    if (!this.connected) throw new Error('dashboard not connected');
    return jsonRequest(method, this._api(p), data, this.token);
  }
  heartbeat() { return this._request('POST', '/heartbeat', {}); }
  async publish(snapshot) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this._request('POST', '/runs', snapshot); }
      catch (error) {
        failure = error;
        if (error.status === 403) {
          try { await this.reconnect(); } catch { break; }
        } else if (error.status === 409 || error.status === 400) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw failure;
  }
  async reconnect() {
    if (this._stopping || !this.child?.connected) throw new Error('Dashboard server disconnected');
    if (this._reconnecting) return this._reconnecting;
    this._reconnecting = (async () => {
      this.token = await this.server.register(this.project);
      this.connected = true;
      await this.heartbeat();
    })();
    try { await this._reconnecting; } finally { this._reconnecting = null; }
  }
  async abandonRun() {
    if (this.connected) {
      try { await jsonRequest('POST', this._api('/disconnect'), {}, this.token); }
      catch (error) { this.onError?.(error); }
    }
    this.connected = false;
    this.token = null;
    try { await this.reconnect(); } catch (error) { this.onError?.(error); }
  }
  async poll() {
    try { return (await this._request('GET', '/requests'))?.request || null; }
    catch (error) {
      if (error.status !== 403) throw error;
      await this.reconnect();
      return (await this._request('GET', '/requests'))?.request || null;
    }
  }
  acknowledge(requestId) { return this._request('POST', `/requests/${requestId}/ack`, {}); }
  runUrl(runId) { return `${this.url}/projects/${this.project.id}/runs/${runId}`; }
  async stop() {
    if (this._stopping) return this._stopping;
    this._stopping = (async () => {
      clearInterval(this._hb);
      if (this.connected) {
        try { await jsonRequest('POST', this._api('/disconnect'), {}, this.token); }
        catch (e) {
          // Best-effort disconnect — server may already be gone, but log
          // unexpected failures (wrong URL, logic bug) so they're diagnosable.
          if (e && e.status !== 404) {
            console.error('Dashboard disconnect request failed:', e && e.message ? e.message : e);
          }
        }
      }
      this.connected = false;
      this.token = null;
      this.child?.off('exit', this._onExit);
      this.child?.off('disconnect', this._onExit);
      if (this.ownsServer) await this.server.stop();
    })();
    return this._stopping;
  }
}
module.exports = { DashboardClient, DashboardServer, DASHBOARD_DIR, SERVER_ENTRY };
