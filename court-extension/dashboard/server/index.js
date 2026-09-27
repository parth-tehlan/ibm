import { createApp } from './app.js';
import { createHistory } from './history.js';

const history = createHistory(process.env.GAIA_LEGACY_DIR ? { legacyDir: process.env.GAIA_LEGACY_DIR } : {});
await history.migrateLegacy(); // Non-destructive: keep old Northstar JSON in .data/.
await history.recoverInterrupted();
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const host = process.env.GAIA_HOST || '127.0.0.1';
// app must exist before the maintenance interval closes over app.locals.bridge.
const app = createApp({ history });
const maintenance = setInterval(async () => {
  try { await history.renewOwned(); await app.locals.bridge.sweep(); await history.recoverInterrupted(); app.locals.mutationBus.sweep(); }
  catch (error) { console.error('Dashboard maintenance failed:', error); }
}, 10_000);
maintenance.unref();
// Only when this process was forked with an 'ipc' stdio channel does a real
// parent IPC channel exist. `process.connected` is true then, undefined when
// standalone. process.send is *callable* standalone but emits an async
// 'error' (EINVAL), which try/catch cannot catch — so gate strictly on
// process.connected === true and also swallow any process-level IPC error.
const ipc = typeof process.send === 'function' && process.connected === true;
function ipcSend(message) {
  if (!ipc) return;
  try { process.send(message); } catch { /* no live IPC channel — running standalone */ }
}
// A standalone run has no IPC channel; never let a stray IPC write crash us.
process.on('error', (err) => {
  if (err && (err.code === 'EINVAL' || err.code === 'EPIPE' || err.syscall === 'write')) return;
  throw err;
});
const server = app.listen(port, host, () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Gaia dashboard listening on ${url}`);
  // IPC exists only when a trusted editor-host process forked this server.
  // Never put registration or its secret on a browser-accessible HTTP route.
  ipcSend({ type: 'gaia.ready', url });
});

if (ipc) {
  process.on('message', async (message) => {
if (!message || typeof message !== 'object') return;
    // Live mutation progress relayed by the trusted editor host (Feature:
    // real-time TRUSTGAP execution stream). runKey is `${projectId}:${runId}`;
    // browser SSE subscribers see exactly what the mutation runner prints.
    if (message.type === 'gaia.mutationProgress' && typeof message.runKey === 'string') {
      try { app.locals.mutationBus.push(message.runKey, message.event); } catch { /* never let IPC break the server */ }
      return;
    }
    if (message.type === 'gaia.mutationDone' && typeof message.runKey === 'string') {
      try { app.locals.mutationBus.done(message.runKey, message.status, message.error); } catch { /* ignore */ }
      return;
    }
    if (message.type !== 'gaia.register' || typeof message.requestId !== 'string') return;
    try {
      await app.locals.bridge.sweep();
      const { project, token } = app.locals.bridge.registerProject({ project: message.project });
      ipcSend({ type: 'gaia.registered', requestId: message.requestId, project, token });
    } catch (error) {
      ipcSend({ type: 'gaia.registrationError', requestId: message.requestId,
        error: error?.code === 'CONFLICT' ? 'Project is already connected' : 'Invalid project registration' });
    }
  });
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(maintenance);
  // Stop new HTTP work and give any in-flight durable publication a brief
  // chance to finish before marking this process's unfinished runs interrupted.
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  try { await history.recoverInterrupted({ ownedOnly: true, force: true }); }
  catch (error) { console.error('Dashboard shutdown recovery failed:', error); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);
