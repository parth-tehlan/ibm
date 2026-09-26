import { createApp } from './app.js';
import { createHistory } from './history.js';

const history = createHistory();
await history.migrateLegacy(); // Non-destructive: keep old Northstar JSON in .data/.
await history.recoverInterrupted();
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const app = createApp({ history });
const server = app.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`TRIUMPH dashboard listening on ${url}`);
  // IPC exists only when a trusted editor-host process forked this server.
  // Never put registration or its secret on a browser-accessible HTTP route.
  if (process.send) process.send({ type: 'triumph.ready', url });
});

if (process.send) {
  process.on('message', (message) => {
    if (!message || message.type !== 'triumph.register' || typeof message.requestId !== 'string') return;
    try {
      const { project, token } = app.locals.bridge.registerProject({ project: message.project });
      process.send({ type: 'triumph.registered', requestId: message.requestId, project, token });
    } catch (error) {
      process.send({ type: 'triumph.registrationError', requestId: message.requestId,
        error: error?.code === 'CONFLICT' ? 'Project is already connected' : 'Invalid project registration' });
    }
  });
}
