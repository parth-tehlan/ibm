import { createApp } from './app.js';
import { createHistory } from './history.js';

const history = createHistory(process.env.TRIUMPH_LEGACY_DIR ? { legacyDir: process.env.TRIUMPH_LEGACY_DIR } : {});
await history.migrateLegacy(); // Non-destructive: keep old Northstar JSON in .data/.
await history.recoverInterrupted();
const maintenance = setInterval(async () => {
  try { await history.renewOwned(); await app.locals.bridge.sweep(); await history.recoverInterrupted(); }
  catch (error) { console.error('Dashboard maintenance failed:', error); }
}, 10_000);
maintenance.unref();
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const host = process.env.TRIUMPH_HOST || '127.0.0.1';
const app = createApp({ history });
const server = app.listen(port, host, () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`TRIUMPH dashboard listening on ${url}`);
  // IPC exists only when a trusted editor-host process forked this server.
  // Never put registration or its secret on a browser-accessible HTTP route.
  if (process.send) process.send({ type: 'triumph.ready', url });
});

if (process.send) {
  process.on('message', async (message) => {
    if (!message || message.type !== 'triumph.register' || typeof message.requestId !== 'string') return;
    try {
      await app.locals.bridge.sweep();
      const { project, token } = app.locals.bridge.registerProject({ project: message.project });
      process.send({ type: 'triumph.registered', requestId: message.requestId, project, token });
    } catch (error) {
      process.send({ type: 'triumph.registrationError', requestId: message.requestId,
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
