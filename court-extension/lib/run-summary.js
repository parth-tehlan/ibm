'use strict';

/** Pure presentation adapters. Engine payloads are opaque evidence: never mutate
 * them, manufacture timestamps, or infer score units from numeric magnitude.
 * Native TRUSTGAP scores are percent and trustGap is percentage_points.
 */
const COURTS = ['WITNESS', 'TRUSTGAP', 'TRIAGE'];
const EXECUTIONS = ['not_run', 'queued', 'running', 'complete', 'unavailable', 'error', 'cancelled'];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const metric = (name, value, unit) => ({ name, value: finite(value) ? value : null, unit });

/** @param {{value:number|null,unit:'count'|'percent'|'percentage_points'}} metric
 * Also accepts (value, unit). No implicit fraction conversion or clamping.
 */
function formatMetric(value, unit) {
  if (object(value)) { unit = value.unit; value = value.value; }
  if (!['count', 'percent', 'percentage_points'].includes(unit)) return 'Not recorded';
  if (!finite(value)) return 'Not recorded';
  const formatted = String(Number(value.toFixed(2)));
  return formatted + (unit === 'percent' ? '%' : unit === 'percentage_points' ? ' pp' : '');
}

/** Derive a display verdict from executed assertions, not discovery or a badge. */
function clauseStatus(row) {
  if (!object(row)) return 'yellow';
  if (count(row.failed) && row.failed > 0) return 'red';
  if (count(row.total) && row.total > 0 && row.failed === 0 && row.passed === row.total && row.status === 'green') return 'green';
  return 'yellow';
}

function summarizeCourt(court, payloadOrOutcome) {
  court = String(court).toUpperCase();
  if (!COURTS.includes(court)) throw new TypeError(`Unknown court: ${court}`);
  const input = payloadOrOutcome;
  const wrapped = object(input) && ('execution' in input || (('kind' in input || 'state' in input) && ('payload' in input || EXECUTIONS.includes(input.kind || input.state))));
  const outcome = wrapped ? input : {};
  const payload = wrapped ? (input.payload ?? null) : (input ?? null);
  const p = object(payload) ? payload : {};
  let execution = outcome.execution || outcome.kind || outcome.state || (payload == null ? 'not_run' : 'complete');
  if (execution === 'completed') execution = 'complete';
  if (!EXECUTIONS.includes(execution)) execution = 'error';
  // A collector may return a complete envelope carrying an engine failure.
  if (execution === 'complete') {
    if (p.status === 'error' || p.status === 'failed' || p.error) execution = 'error';
    else if (['not-run', 'not_run', 'unconfigured', 'unavailable', 'no-report', 'no-fixtures', 'no-data', 'no-logs', 'no-deploys', 'no-signal-window'].includes(p.status)) execution = 'unavailable';
  }
  const errors = Array.isArray(outcome.errors) ? outcome.errors.slice() : [];
  if (outcome.error) errors.push(outcome.error);
  if (p.error && !errors.includes(p.error)) errors.push(p.error);
  const evidenceFreshness = outcome.evidenceFreshness || (p.stale === true ? 'stale' : 'unknown');
  const summary = {
    court, execution, verdict: 'unknown', tone: 'neutral', label: '', detail: '',
    payload, errors, metrics: [], findings: [],
    collectedAt: outcome.collectedAt ?? null,
    sourceGeneratedAt: outcome.sourceGeneratedAt ?? p.generated ?? null,
    evidenceSource: outcome.evidenceSource || (payload == null ? 'none' : 'imported'),
    evidenceFreshness,
  };
  if (court === 'WITNESS') {
    const rows = Array.isArray(p.results) ? p.results : [];
    const clauses = rows.map((row) => ({ clause: object(row) ? row.clause : null, status: clauseStatus(row), payload: row }));
    const counts = { green: 0, red: 0, yellow: 0, total: clauses.length };
    for (const row of clauses) counts[row.status]++;
    // A producer's summary can disclose additional missing rows. Do not fill
    // them with invented passes, or ignore explicitly reported failures.
    const reported = object(p.summary) ? p.summary : {};
    const missing = count(reported.total) ? Math.max(0, reported.total - rows.length) : 0;
    counts.total += missing; counts.yellow += missing;
    summary.counts = counts;
    summary.clauses = clauses;
    const tests = rows.every((r) => object(r) && count(r.passed) && count(r.failed))
      ? rows.reduce((n, r) => n + r.passed + r.failed, 0) : null;
    summary.metrics = [metric('clauses', counts.total, 'count'), metric('testsExecuted', tests, 'count'), metric('failedClauses', counts.red, 'count'), metric('incompleteClauses', counts.yellow, 'count')];
    summary.findings = clauses.filter((r) => r.status !== 'green');
    const hasFailures = counts.red > 0 || (count(reported.red) && reported.red > 0);
    summary.verdict = hasFailures ? 'findings' : counts.green > 0 && counts.green === counts.total && !(reported.yellow > 0) && !(reported.total === 0) && tests > 0 ? 'pass' : 'inconclusive';
    summary.detail = counts.total ? `${counts.red} failed · ${counts.yellow} incomplete · ${counts.green} passed clauses` : 'No executed clause evidence';
  } else if (court === 'TRUSTGAP') {
    summary.metrics = [metric('claimedCoverage', p.claimedCoverage, 'percent'), metric('honestMutationScore', p.honestMutationScore, 'percent'), metric('trustGap', p.trustGap, 'percentage_points')];
    const totals = object(p.totals) ? p.totals : {};
    const mutants = Array.isArray(p.mutants) ? p.mutants : Array.isArray(p.survivors) ? p.survivors : [];
    const survivors = mutants.filter((m) => object(m) && /^survived$/i.test(m.status));
    const uncovered = mutants.filter((m) => object(m) && /^nocoverage$/i.test(m.status));
    const named = Array.isArray(p.dishonestTests) ? p.dishonestTests : [];
    summary.findings = [...survivors, ...uncovered, ...named];
    const findings = survivors.length || uncovered.length || named.length || (count(totals.survived) && totals.survived > 0) || (count(totals.noCoverage) && totals.noCoverage > 0);
    // There is no authoritative gap threshold in the native engine. Metrics,
    // even 100% or a negative gap, are not an invented pass/fail policy.
    summary.verdict = findings ? 'findings' : 'inconclusive';
    summary.detail = finite(p.trustGap) ? `Trust gap ${formatMetric(p.trustGap, 'percentage_points')}` : 'Mutation evidence incomplete';
    if (totals.counted === 0) summary.detail += ' · zero counted mutants';
    if (finite(p.trustGap) && p.trustGap < 0) summary.detail += ' · mutation score exceeds claimed coverage';
  } else {
    const triage = object(p.triage) ? p.triage : p;
    const evidence = Array.isArray(triage.evidence) ? triage.evidence : [];
    const suspect = object(triage.suspect) && Object.keys(triage.suspect).length > 0;
    summary.findings = evidence;
    summary.metrics = [metric('signals', evidence.length, 'count')];
    summary.verdict = suspect || evidence.length > 0 || (typeof triage.incidentWindow === 'string' && triage.incidentWindow.trim()) ? 'findings' : 'inconclusive';
    summary.detail = summary.verdict === 'findings' ? 'Incident evidence · cause unconfirmed' : 'Insufficient incident evidence · no clearance inferred';
  }
  // run-store manifests deliberately omit payload, retaining derived verdicts and
  // explicit-unit metrics. An explicit payload:null is NOT such a manifest.
  if (wrapped && !('payload' in input) && ['pass', 'findings', 'inconclusive', 'unknown'].includes(input.verdict)) {
    summary.verdict = input.verdict;
    summary.metrics = Array.isArray(input.metrics) ? input.metrics.map((m) => ({ ...m })) : [];
    summary.detail = 'Saved evidence summary · open run for payload';
  }
  // Partial evidence remains inspectable, but never overrides execution failure,
  // missing execution or stale provenance with an affirmative passing verdict.
  if (execution !== 'complete') summary.verdict = summary.verdict === 'findings' && payload != null ? 'findings' : 'unknown';
  if (evidenceFreshness === 'stale' && summary.verdict === 'pass') summary.verdict = 'inconclusive';
  summary.tone = execution === 'error' || summary.verdict === 'findings' ? 'red'
    : execution === 'unavailable' || execution === 'cancelled' || summary.verdict === 'inconclusive' ? 'yellow'
      : summary.verdict === 'pass' ? 'green' : 'neutral';
  const labels = { not_run: 'Not run', queued: 'Queued', running: 'Running', unavailable: 'Unavailable', error: 'Execution error', cancelled: 'Stopped' };
  summary.label = labels[execution] || ({ pass: 'Passed', findings: 'Findings', inconclusive: 'Incomplete evidence', unknown: 'Unknown' })[summary.verdict];
  return summary;
}

function summarizeRun(record) {
  record = object(record) ? record : {};
  const source = record.courts || record.results || record;
  const requested = Array.isArray(record.requestedCourts) ? record.requestedCourts.map((c) => String(c).toUpperCase()).filter((c) => COURTS.includes(c)) : COURTS.filter((c) => source[c] || source[c.toLowerCase()]);
  const courts = {};
  for (const court of COURTS) courts[court] = summarizeCourt(court, requested.includes(court) ? source[court] ?? source[court.toLowerCase()] : null);
  const selected = [...new Set(requested)].map((c) => courts[c]);
  const hasErrors = selected.some((c) => c.execution === 'error');
  const interrupted = record.lifecycle === 'interrupted' || selected.some((c) => c.execution === 'cancelled');
  const running = record.lifecycle === 'running' || selected.some((c) => ['queued', 'running'].includes(c.execution));
  const findings = selected.some((c) => c.verdict === 'findings');
  const incomplete = !selected.length || selected.some((c) => c.execution !== 'complete' || c.verdict !== 'pass');
  const artifactErrors = (Array.isArray(record.artifacts) ? record.artifacts : []).filter((a) => a.status === 'error' || a.status === 'failed' || a.error);
  const publicationState = record.publication?.state || 'not_requested';
  const verdict = findings ? 'findings' : incomplete ? 'inconclusive' : 'pass';
  const execution = running ? 'running' : interrupted ? 'interrupted' : hasErrors ? 'error' : selected.length ? 'complete' : 'not_run';
  let label = running ? 'Running' : interrupted ? 'Stopped — partial evidence' : hasErrors ? 'Finished with execution errors' : findings ? 'Completed — findings need attention' : incomplete ? 'Completed — incomplete evidence' : 'Completed — no issues found';
  if (artifactErrors.length) label += ' · report save failed';
  if (publicationState === 'failed') label += ' · dashboard publish failed';
  return { runId: record.runId ?? null, execution, lifecycle: record.lifecycle || (running ? 'running' : interrupted ? 'interrupted' : 'completed'), verdict, tone: hasErrors || findings ? 'red' : interrupted || incomplete || artifactErrors.length || publicationState === 'failed' ? 'yellow' : 'green', label, courts, requestedCourts: [...new Set(requested)], hasErrors, hasFindings: findings, incomplete, artifactErrors, publicationState };
}

module.exports = { summarizeCourt, summarizeRun, formatMetric, clauseStatus };
