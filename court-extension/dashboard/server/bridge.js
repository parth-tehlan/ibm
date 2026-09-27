import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeReport, snapshotSchema } from '../contracts/report.js';

const uuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const courts = new Set(['redline', 'splitbrain', 'warpath']);
function error(message, code = 'FORBIDDEN') { const err = new Error(message); err.code = code; return err; }
function authenticate(connection, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw error('Invalid extension credentials');
  const supplied = Buffer.from(token, 'hex');
  if (!connection || !timingSafeEqual(supplied, connection.secret)) throw error('Invalid extension credentials');
}
function validateProject(project) {
  if (!project || !uuid(project.id) || typeof project.name !== 'string' || !project.name.trim()) throw new TypeError('Expected project with UUID id and name');
  return { id: project.id.toLowerCase(), name: project.name };
}
function validateCourts(selected) {
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 3 || new Set(selected).size !== selected.length || selected.some((court) => !courts.has(court))) throw new TypeError('Expected distinct redline, splitbrain, or warpath courts');
}

/** createBridge({history, heartbeatTimeoutMs?, now?}) is PROCESS-LOCAL.
 * Wire registerProject({project}) ONLY from trusted extension-host integration,
 * never from browser routes. Give its returned random token ONLY to that host.
 * Browser routes may call requestRun({projectId,courts}); a connected, timely
 * extension is required. Extension routes require {projectId,token} for
 * heartbeat, poll, acknowledge, submit, disconnect. Poll returns a pending
 * request until acknowledged, and offers it again after the short ack lease
 * unless its final snapshot is submitted. Call sweep() on an app timer to expire
 * dead connections and interrupt persisted running snapshots. Stop accepting
 * requests on process restart until
 * the trusted host registers again (tokens are deliberately not persisted).
 * Caller must enforce loopback host/origin and protect registration wiring.
 */
export function createBridge({ history, heartbeatTimeoutMs = 30_000, now = Date.now } = {}) {
  if (!history || typeof history.save !== 'function' || typeof history.load !== 'function') throw new TypeError('A history store is required');
  if (!Number.isSafeInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs <= 0) throw new TypeError('Invalid heartbeat timeout');
  const connections = new Map();
  const time = () => now();
  function get(projectId, token) {
    if (!uuid(projectId)) throw error('Invalid extension credentials');
    const connection = connections.get(projectId.toLowerCase());
    authenticate(connection, token);
    if (time() - connection.lastHeartbeat > heartbeatTimeoutMs) throw error('Extension connection expired');
    return connection;
  }
  async function interrupt(connection) {
    for (const runId of connection.activeRuns) {
      const run = await history.load(connection.project.id, runId);
      if (run?.state !== 'running') continue;
      if (history.assertOwned) { try { await history.assertOwned(connection.project.id, runId); } catch { continue; } }
      const updated = { ...run, state: 'interrupted', revision: run.revision + 1, updatedAt: new Date(time()).toISOString() };
      for (const court of courts) {
        if (updated[court].state === 'running') updated[court] = {
          state: 'error', collectedAt: updated.updatedAt, sourceGeneratedAt: null, payload: null,
          errors: ['Extension disconnected before collection finished.'],
        };
      }
      await history.save(updated);
    }
    connection.activeRuns.clear();
    connection.request = null;
  }
  async function expire(projectId, connection) {
    if (connections.get(projectId) !== connection) return;
    connections.delete(projectId); // fail closed even when persistence fails
    await interrupt(connection);
  }
  async function sweep() {
    for (const [id, connection] of connections) {
      if (time() - connection.lastHeartbeat > heartbeatTimeoutMs) await expire(id, connection);
    }
  }
  function registerProject({ project }) {
    const identity = validateProject(project);
    if (connections.has(identity.id)) throw error('Project is already connected', 'CONFLICT');
    const secret = randomBytes(32);
    connections.set(identity.id, { project: identity, secret, lastHeartbeat: time(), request: null, activeRuns: new Set() });
    return { project: identity, token: secret.toString('hex') };
  }
  function heartbeat({ projectId, token }) {
    const connection = get(projectId, token);
    connection.lastHeartbeat = time();
    return { connected: true };
  }
  function poll({ projectId, token }) {
    const connection = get(projectId, token);
    if (!connection.ready || !connection.request) return null;
    if (connection.request.status === 'accepted' && time() - connection.request.acceptedAt < 5_000) return null;
    return { ...connection.request, status: 'pending' };
  }
  function acknowledge({ projectId, token, requestId }) {
    const connection = get(projectId, token);
    if (!uuid(requestId) || connection.request?.requestId !== requestId) throw error('Unknown run request', 'NOT_FOUND');
    // Acceptance is a short lease, not a terminal state.
    connection.request.status = 'accepted';
    connection.request.acceptedAt = time();
    return { ...connection.request };
  }
  async function requestRun({ projectId, courts: selected, prepare }) {
    if (!uuid(projectId)) throw error('Project is not connected', 'NOT_CONNECTED');
    validateCourts(selected);
    await sweep();
    const connection = connections.get(projectId.toLowerCase());
    if (!connection) throw error('Project is not connected', 'NOT_CONNECTED');
    if (connection.request) throw error('Run already requested', 'CONFLICT');
    const request = { requestId: randomUUID(), runId: randomUUID(), projectId: connection.project.id,
      courts: [...selected], createdAt: new Date(time()).toISOString(), status: 'pending' };
    connection.request = request;
    connection.ready = !prepare;
    connection.activeRuns.add(request.runId); // Includes pending requests with a persisted placeholder.
    if (history.claimRun) {
      try { await history.claimRun(connection.project.id, request.runId); }
      catch (cause) { cancelRequest({ projectId, requestId: request.requestId }); throw cause; }
    }
    if (prepare) {
      try {
        // Do not expose a request to polling until its browser placeholder is
        // durable. Otherwise an early extension update can win revision 0.
        await prepare(request, connection.project);
        if (connections.get(connection.project.id) !== connection) {
          connection.activeRuns.add(request.runId);
          await interrupt(connection); // disconnect may have raced persistence
          throw error('Project disconnected', 'NOT_CONNECTED');
        }
        connection.ready = true;
      } catch (cause) { cancelRequest({ projectId, requestId: request.requestId }); throw cause; }
    }
    return { ...request };
  }
  async function submit({ projectId, token, snapshot }) {
    const connection = get(projectId, token);
    const parsed = snapshotSchema.parse(normalizeReport(snapshot));
    if (parsed.project.id.toLowerCase() !== connection.project.id || parsed.project.name !== connection.project.name) throw error('Report project does not match connection');
    if (connection.request && parsed.runId !== connection.request.runId) throw error('Report run does not match requested run');
    // A trusted extension may submit an unsolicited run when no run request is
    // active. Imports cannot reach this method without a live extension token.
    if (history.claimRun && !connection.activeRuns.has(parsed.runId)) await history.claimRun(connection.project.id, parsed.runId);
    if (history.assertOwned) await history.assertOwned(connection.project.id, parsed.runId);
    const result = await history.save(parsed);
    if (result.state === 'running') connection.activeRuns.add(result.runId);
    else connection.activeRuns.delete(result.runId);
    if (connection.request && result.runId === connection.request.runId && result.state !== 'running') connection.request = null;
    return result;
  }
  async function disconnect({ projectId, token }) {
    const connection = get(projectId, token);
    await expire(connection.project.id, connection);
  }
  function cancelRequest({ projectId, requestId }) {
    const connection = connections.get(projectId.toLowerCase());
    if (connection?.request?.requestId === requestId) {
      connection.activeRuns.delete(connection.request.runId);
      connection.request = null;
    }
  }
  function connectedProjects() {
    return [...connections.values()].filter((connection) => time() - connection.lastHeartbeat <= heartbeatTimeoutMs).map(({ project }) => ({ ...project }));
  }
  function isConnected(projectId) {
    if (!uuid(projectId)) return false;
    const connection = connections.get(projectId.toLowerCase());
    return Boolean(connection && time() - connection.lastHeartbeat <= heartbeatTimeoutMs);
  }
  return { registerProject, heartbeat, poll, acknowledge, requestRun, cancelRequest, submit, disconnect, sweep, isConnected, connectedProjects };
}
