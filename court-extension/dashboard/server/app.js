import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError, z } from 'zod';
import { createHistory } from './history.js';
import { createBridge } from './bridge.js';
import { createMutationBus } from './mutation-bus.js';
import { normalizeReport } from '../contracts/report.js';
import { exportSnapshot } from '../reports/export.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const uuid = z.string().uuid();
const courts = z.object({ courts: z.array(z.enum(['redline', 'splitbrain', 'warpath'])).min(1).max(3).refine((value) => new Set(value).size === value.length) }).strict();
const empty = (state = 'not_run') => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const bad = (res) => res.status(404).json({ error: 'Not found' });
function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError || error?.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request' });
  if (error?.code === 'CONFLICT') return res.status(409).json({ error: error.message });
  if (error?.code === 'NOT_CONNECTED') return res.status(409).json({ error: 'Project is not connected to the extension' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: 'Extension credentials rejected' });
  console.error('Dashboard server error:', error);
  res.status(500).json({ error: 'Internal server error' });
}

/** Browser surface only. Extension registration is deliberately NOT an HTTP route:
 * trusted editor-host code calls app.locals.bridge.registerProject() in-process.
 */
export function createApp({ history = createHistory(), bridge = createBridge({ history }), mutationBus = createMutationBus(), allowedHosts = (process.env.TRIUMPH_ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean), devOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', ...allowedHosts.map((hostname) => `http://${hostname}:5173`)] } = {}) {
  const app = express();
  const trustedHostnames = new Set(['127.0.0.1', 'localhost', ...allowedHosts]);
  app.locals.history = history;
  app.locals.bridge = bridge;
  app.locals.mutationBus = mutationBus;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host;
    const hostMatch = typeof host === 'string' ? /^(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d{1,5})?$/.exec(host.toLowerCase()) : null;
    if (!hostMatch || !trustedHostnames.has(hostMatch[1])) return res.status(403).json({ error: 'Host is not allowed' });
    const origin = req.headers.origin;
    if (origin) {
      try {
        const allowed = new Set([`http://${host}`, ...devOrigins]);
        if (new URL(origin).origin !== origin || !allowed.has(origin)) return res.status(403).json({ error: 'Origin not allowed' });
      } catch { return res.status(403).json({ error: 'Origin not allowed' }); }
    }
    // Browser writes require a legitimate same-origin request. Other local
    // processes have machine access already; untrusted web origins are refused.
    next();
  });
  app.use('/api', express.json({ limit: '5mb', strict: true }));
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  app.get('/api/projects', route(async (_req, res) => {
    await bridge.sweep();
    const saved = await history.listProjects();
    const projects = new Map(saved.map(({ project, lastRun }) => [project.id, { id: project.id, name: project.name, lastRunAt: lastRun.createdAt, runCount: 0, connected: bridge.isConnected(project.id) }]));
    for (const project of bridge.connectedProjects?.() || []) {
      if (!projects.has(project.id)) projects.set(project.id, { id: project.id, name: project.name, lastRunAt: null, runCount: 0, connected: true });
      else projects.get(project.id).connected = true;
    }
    // One round of reads for every project, never a sequential N+1 await chain.
    const runCounts = await Promise.all([...projects.keys()].map(async (id) => (await history.listRuns(id)).length));
    [...projects.values()].forEach((record, i) => { record.runCount = runCounts[i]; });
    res.json([...projects.values()].sort((a, b) => (b.lastRunAt || '').localeCompare(a.lastRunAt || '') || a.name.localeCompare(b.name)));
  }));
  app.get('/api/projects/:id/runs', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return bad(res);
    res.json((await history.listRuns(req.params.id)).map((run) => ({ runId: run.runId, createdAt: run.createdAt, updatedAt: run.updatedAt, revision: run.revision, state: run.state, branch: run.branch, courts: ['redline', 'splitbrain', 'warpath'].filter((court) => run[court].state !== 'not_run') })));
  }));
  app.get('/api/projects/:id/runs/:runId', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.runId).success) return bad(res);
    const report = await history.load(req.params.id, req.params.runId);
    return report ? res.json(report) : bad(res);
  }));
  app.post('/api/projects/:id/run', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return bad(res);
    const parsed = courts.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Expected distinct redline, splitbrain, warpath courts' });
    const request = await bridge.requestRun({ projectId: req.params.id, courts: parsed.data.courts, prepare: async (pending, project) => {
      const report = {
        schemaVersion: 2, project, runId: pending.runId, createdAt: pending.createdAt, updatedAt: pending.createdAt,
        revision: 0, state: 'running', checkedOutCommit: null, branch: null, workingTreeDirty: null,
        producer: { name: 'triumph-extension-request', version: '1' },
        ...Object.fromEntries(['redline', 'splitbrain', 'warpath'].map((court) => [court, empty(parsed.data.courts.includes(court) ? 'running' : 'not_run')])),
      };
      await history.save(report);
    } });
    res.status(202).json({ runId: request.runId, requestId: request.requestId });
  }));
  // --- Live mutation execution stream (SPLITBRAIN) --------------------------
  // Server-Sent Events fed by the trusted editor host over IPC (see
  // server/index.js). The bus is keyed `${projectId}:${runId}` — exactly the
  // runKey the extension computes when it relays splitbrain_status progress.
  app.get('/api/projects/:id/runs/:runId/mutation-stream', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.runId).success) return bad(res);
    const runKey = `${req.params.id.toLowerCase()}:${req.params.runId.toLowerCase()}`;
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let closed = false;
    const send = (frame) => {
      if (closed) return;
      let data;
      try { data = JSON.stringify(frame); } catch { return; }
      if (data.length > mutationBus.SSE_MAX_BYTES) data = JSON.stringify({ type: 'progress', event: { line: '(oversized event dropped)' } });
      try { res.write(`data: ${data}\n\n`); } catch { closed = true; }
    };
    const unsubscribe = mutationBus.subscribe(runKey, (frame) => {
      send(frame);
      if (frame.type === 'done') cleanup();
    });
    const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch { cleanup(); } }, 15000);
    heartbeat.unref?.();
    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      try { res.end(); } catch { /* already closed */ }
    }
    req.on('close', cleanup);
    // No buffered events and no terminal state yet: leave the stream open —
    // the extension will begin relaying as soon as the mutation job starts.
  }));
  // Warm-cache demo guardrail: replay a run's event log so a live pitch never
  // stalls on stage. Live in-memory events win; the extension-written JSONL
  // log under the history dir is the durable fallback across restarts.
  app.get('/api/projects/:id/runs/:runId/mutation-stream/replay', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.runId).success) return bad(res);
    const runKey = `${req.params.id.toLowerCase()}:${req.params.runId.toLowerCase()}`;
    const live = mutationBus.replay(runKey);
    if (live) return res.json({ ...live, source: 'live' });
    const cached = typeof history.loadMutationEvents === 'function'
      ? await history.loadMutationEvents(req.params.id, req.params.runId) : null;
    if (!cached) return res.status(404).json({ error: 'No mutation event log for this run' });
    res.json({ ...cached, source: 'cache' });
  }));
  app.get('/api/runs/:id/export', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return bad(res);
    if (Array.isArray(req.query.format) || !['html', 'md', 'json'].includes(req.query.format)) return res.status(400).json({ error: 'format must be html, md, or json' });
    let report = null;
    if (typeof req.query.projectId === 'string' && uuid.safeParse(req.query.projectId).success) report = await history.load(req.query.projectId, req.params.id);
    else if (typeof req.query.importId === 'string' && uuid.safeParse(req.query.importId).success) {
      const imported = await history.loadImport(req.query.importId);
      if (imported?.runId === req.params.id) report = imported;
    }
    if (!report) return bad(res);
    if (report.state === 'running') return res.status(409).json({ error: 'Run is still in progress' });
    res.set('Content-Type', { html: 'text/html; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json; charset=utf-8' }[req.query.format]);
    res.set('Content-Disposition', `attachment; filename="triumph-${report.runId}.${req.query.format}"`);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(exportSnapshot(report, req.query.format));
  }));
  app.post('/api/import', route(async (req, res) => {
    const report = normalizeReport(req.body);
    const { id } = await history.importReport(report);
    res.status(201).json({ importId: id, projectId: report.project.id, runId: report.runId, detached: true });
  }));
  app.get('/api/imports', route(async (_req, res) => {
    res.json((await history.listImports()).map(({ id, snapshot }) => ({ id, project: snapshot.project, runId: snapshot.runId, createdAt: snapshot.createdAt, state: snapshot.state })));
  }));
  app.get('/api/imports/:id', route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return bad(res);
    const imported = await history.loadImport(req.params.id);
    return imported ? res.json(imported) : bad(res);
  }));
  // A token is minted only by the trusted editor-host API, never by an HTTP
  // endpoint. Extension polling and submissions must present that capability.
  const extension = (fn) => route(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return bad(res);
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer [0-9a-f]{64}$/.test(auth)) return res.status(403).json({ error: 'Extension credentials required' });
    return fn(req, res, auth.slice(7));
  });
  app.post('/api/extension/:id/heartbeat', extension((req, res, token) => res.json(bridge.heartbeat({ projectId: req.params.id, token }))));
  app.get('/api/extension/:id/requests', extension((req, res, token) => res.json({ request: bridge.poll({ projectId: req.params.id, token }) })));
  app.post('/api/extension/:id/requests/:requestId/ack', extension((req, res, token) => res.json(bridge.acknowledge({ projectId: req.params.id, token, requestId: req.params.requestId }))));
  app.post('/api/extension/:id/runs', extension(async (req, res, token) => {
    const saved = await bridge.submit({ projectId: req.params.id, token, snapshot: req.body });
    res.status(201).json({ projectId: saved.project.id, runId: saved.runId, revision: saved.revision });
  }));
  app.post('/api/extension/:id/disconnect', extension(async (req, res, token) => {
    await bridge.disconnect({ projectId: req.params.id, token });
    res.status(204).end();
  }));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(handleError);
  return app;
}
