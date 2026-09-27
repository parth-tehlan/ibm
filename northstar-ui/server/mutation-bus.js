/**
 * server/mutation-bus.js — in-process pub/sub for live mutation-runner
 * progress events, fanned out to browser SSE subscribers.
 *
 * The trusted editor-host process relays engine progress over IPC
 * (gaia.mutationProgress / gaia.mutationDone) keyed by runKey
 * (`${projectId}:${runId}`); the browser subscribes at
 * GET /api/projects/:id/runs/:runId/mutation-stream.
 *
 * Event frame (JSON-serializable):
 *   { type: 'progress', event: {tested?, total?, killed?, survived?,
 *                               killRate?, verdict?, line} }
 *   { type: 'done', status: 'done'|'error', error: string|null }
 *
 * Process-local, memory-bounded (500 events per run), and self-cleaning:
 * streams drop their listener on close; whole runs are discarded 30 minutes
 * after their terminal `done` event.
 */
const PROGRESS_LIMIT = 500;
const RUN_TTL_MS = 30 * 60_000;
const SSE_MAX_BYTES = 16 * 1024;

export function createMutationBus({ now = Date.now } = {}) {
  /** runKey -> { events: object[], done: {status,error}|null, listeners: Set<fn>, createdAt, finishedAt } */
  const runs = new Map();

  function entryFor(runKey) {
    let entry = runs.get(runKey);
    if (!entry) {
      entry = { events: [], done: null, listeners: new Set(), createdAt: now(), finishedAt: null };
      runs.set(runKey, entry);
    }
    return entry;
  }

  /** Append a progress event. Unknown/corrupt events are dropped, never thrown. */
  function push(runKey, event) {
    if (typeof runKey !== 'string' || !runKey.includes(':')) return;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    const entry = entryFor(runKey);
    if (entry.done) return; // a terminal run is immutable
    if (entry.events.length >= PROGRESS_LIMIT) entry.events.shift();
    entry.events.push(event);
    const frame = { type: 'progress', event };
    for (const listener of entry.listeners) {
      try { listener(frame); } catch { /* a broken listener never blocks the bus */ }
    }
  }

  /** Mark a run terminal; listeners get one final frame. Idempotent. */
  function done(runKey, status = 'done', error = null) {
    if (typeof runKey !== 'string' || !runKey.includes(':')) return;
    const entry = runs.get(runKey);
    if (!entry || entry.done) return;
    entry.done = { status: status === 'error' ? 'error' : 'done', error: error ? String(error) : null };
    entry.finishedAt = now();
    const frame = { type: 'done', status: entry.done.status, error: entry.done.error };
    for (const listener of entry.listeners) {
      try { listener(frame); } catch { /* ignore */ }
    }
  }

  /**
   * Subscribe a listener. Returns an unsubscribe function.
   * Replays buffered events first so a late subscriber catches up, then the
   * terminal frame when the run already finished.
   */
  function subscribe(runKey, listener) {
    const entry = entryFor(runKey);
    for (const event of entry.events) {
      try { listener({ type: 'progress', event }); } catch { /* ignore */ }
    }
    if (entry.done) {
      try { listener({ type: 'done', status: entry.done.status, error: entry.done.error }); } catch { /* ignore */ }
      return () => {};
    }
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Buffered event log for the warm-cache replay endpoint. */
  function replay(runKey) {
    const entry = runs.get(runKey);
    if (!entry || !entry.events.length) return null;
    return { events: [...entry.events], done: entry.done ? { ...entry.done } : null };
  }

  /** Drop finished runs older than the TTL. Called from the app's timer. */
  function sweep() {
    const t = now();
    for (const [key, entry] of runs) {
      if (entry.finishedAt !== null && t - entry.finishedAt > RUN_TTL_MS && entry.listeners.size === 0) {
        runs.delete(key);
      }
    }
  }

  return { push, done, subscribe, replay, sweep, PROGRESS_LIMIT, SSE_MAX_BYTES };
}
