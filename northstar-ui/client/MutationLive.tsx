import { useEffect, useReducer, useRef, useState } from 'react';

/**
 * MutationLive — real-time SPLITBRAIN mutation execution stream.
 *
 * Subscribes to the dashboard server's SSE endpoint
 *   GET /api/projects/:projectId/runs/:runId/mutation-stream
 * and renders a live progress bar, a climbing kill-rate counter, and a
 * scrolling ticker of recent mutant verdicts.
 *
 * Demo guardrail (warm cache): when the stream opens with no live events
 * (server restarted, or a rerun of a finished run), the component fetches
 *   GET .../mutation-stream/replay
 * once and fast-replays the persisted event log (~40ms/frame), marking the
 * panel with a "replayed from cache" badge so the evidence is never
 * misrepresented as a live run. `replayOnly` skips SSE entirely.
 */

export type MutationEvent = {
  tested?: number | null;
  total?: number | null;
  killed?: number | null;
  survived?: number | null;
  killRate?: number | null;
  verdict?: string;
  line?: string;
};

export type MutationFrame =
  | { type: 'progress'; event: MutationEvent }
  | { type: 'done'; status: 'done' | 'error'; error: string | null };

type TickerEntry = { key: number; kind: 'killed' | 'survived' | 'timeout' | 'progress'; text: string };

type LiveState = {
  tested: number | null;
  total: number | null;
  killed: number | null;
  survived: number | null;
  killRate: number | null;
  line: string | null;
  status: 'connecting' | 'running' | 'done' | 'error';
  errorText: string | null;
  ticker: TickerEntry[];
  events: number;
};

const INITIAL: LiveState = {
  tested: null, total: null, killed: null, survived: null, killRate: null,
  line: null, status: 'connecting', errorText: null, ticker: [], events: 0,
};

const TICKER_LIMIT = 24;
let tickerKey = 0;

function classify(event: MutationEvent): TickerEntry['kind'] {
  const verdict = (event.verdict || '').toLowerCase();
  if (/^killed/.test(verdict)) return 'killed';
  if (/^(survived|no coverage)/.test(verdict)) return 'survived';
  if (/timed?\s*out|timeout/.test(verdict)) return 'timeout';
  return 'progress';
}

function reduce(state: LiveState, frame: MutationFrame): LiveState {
  if (frame.type === 'done') {
    return { ...state, status: frame.status === 'error' ? 'error' : 'done', errorText: frame.error };
  }
  const event = frame.event || {};
  const text = event.line || event.verdict || 'mutation runner progress';
  const ticker = [...state.ticker, { key: ++tickerKey, kind: classify(event), text }].slice(-TICKER_LIMIT);
  return {
    ...state,
    status: 'running',
    events: state.events + 1,
    tested: event.tested != null ? event.tested : state.tested,
    total: event.total != null ? event.total : state.total,
    killed: event.killed != null ? event.killed : state.killed,
    survived: event.survived != null ? event.survived : state.survived,
    killRate: event.killRate != null ? event.killRate : state.killRate,
    line: event.line || state.line,
    ticker,
  };
}

export function MutationLive({ projectId, runId, active, replayOnly = false }: {
  projectId: string;
  runId: string;
  /** The run is still collecting evidence — open the live SSE stream. */
  active: boolean;
  /** Demo fast-path: skip SSE and replay the persisted event log only. */
  replayOnly?: boolean;
}) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [replayed, setReplayed] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);

  // Keep the verdict ticker pinned to the latest entry.
  useEffect(() => {
    const node = tickerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [state.ticker.length]);

  useEffect(() => {
    if (!active && !replayOnly) return;
    let cancelled = false;
    let source: EventSource | null = null;
    const base = `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/mutation-stream`;

    async function replayCache(): Promise<boolean> {
      try {
        const res = await fetch(`${base}/replay`);
        if (!res.ok) return false;
        const body = await res.json() as { events?: MutationEvent[]; done?: { status: 'done' | 'error'; error: string | null } | null };
        if (!body || !Array.isArray(body.events) || !body.events.length) return false;
        if (cancelled) return true;
        // Fast-replay: 40ms per frame reads as a live run without stalling.
        for (const event of body.events) {
          if (cancelled) return true;
          dispatch({ type: 'progress', event });
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (!cancelled) {
          dispatch({ type: 'done', status: body.done?.status === 'error' ? 'error' : 'done', error: body.done?.error ?? null });
          setReplayed(true);
        }
        return true;
      } catch { return false; }
    }

    if (replayOnly) { void replayCache(); return () => { cancelled = true; }; }

    source = new EventSource(base);
    source.onmessage = (message) => {
      if (cancelled) return;
      try { dispatch(JSON.parse(message.data) as MutationFrame); } catch { /* malformed frame: skip */ }
    };
    // Warm-cache fallback: if ~2s pass without a single live event, replay
    // whatever the server has buffered/persisted for this run instead of
    // showing dead air on stage.
    const warmup = setTimeout(() => {
      if (cancelled) return;
      // No events yet → nothing is streaming. Try the cache once.
      void (async () => {
        const had = await replayCache();
        if (had && source) { source.close(); source = null; }
      })();
    }, 2000);
    const stopWarmup = () => clearTimeout(warmup);
    source.addEventListener('message', stopWarmup, { once: true });

    return () => {
      cancelled = true;
      clearTimeout(warmup);
      if (source) { source.close(); source = null; }
    };
  }, [projectId, runId, active, replayOnly]);

  if (!active && !replayOnly) return null;

  const pct = state.tested != null && state.total ? Math.min(100, Math.round((state.tested / state.total) * 100)) : null;
  const running = state.status === 'running' || state.status === 'connecting';

  return (
    <div className={`mutation-live ${running ? 'is-live' : ''}`} role="status" aria-label="Live mutation run">
      <div className="mutation-live-head">
        <span className={`mutation-dot ${running ? 'pulse' : state.status === 'error' ? 'dot-error' : 'dot-done'}`} aria-hidden="true" />
        <strong>{state.status === 'done' ? 'Mutation run complete' : state.status === 'error' ? 'Mutation run failed' : 'Mutation run in progress'}</strong>
        {replayed && <span className="mutation-replay-badge" title="Streamed from the persisted event log, not a live runner">replayed from cache</span>}
        <span className="mutation-counter">
          {state.tested != null ? `${state.tested}${state.total != null ? `/${state.total}` : ''}` : '…'}
          {state.killRate != null ? ` · ${state.killRate}% killed` : ''}
        </span>
      </div>
      <div className="mutation-track">
        <div className="mutation-fill" style={{ width: pct != null ? `${pct}%` : state.status === 'done' ? '100%' : '2%' }} />
      </div>
      <div className="mutation-meta">
        <span>tested {state.tested ?? '—'}</span>
        <span>killed {state.killed ?? '—'}</span>
        {state.survived != null && <span>survived {state.survived}</span>}
        {state.killRate != null && <span>kill rate {state.killRate}%</span>}
        {state.errorText && <span className="mutation-error">{state.errorText}</span>}
      </div>
      {state.ticker.length > 0 && (
        <div className="mutation-ticker" ref={tickerRef} aria-label="Recent mutant verdicts">
          {state.ticker.map((entry) => (
            <div key={entry.key} className={`mutation-tick tick-${entry.kind}`}>
              <span className="tick-mark" aria-hidden="true">
                {entry.kind === 'killed' ? '✓' : entry.kind === 'survived' ? '⚠' : entry.kind === 'timeout' ? '✕' : '·'}
              </span>
              <span className="tick-text">{entry.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
