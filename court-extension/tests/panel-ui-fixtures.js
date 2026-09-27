'use strict';
const capabilities = Object.fromEntries(['publishRun', 'selectRun', 'openLogs', 'openArtifact', 'loadMoreRuns', 'configValidate', 'configPreview', 'configApply', 'installPreview', 'installApply', 'openFolder', 'manageTrust'].map(k => [k, true]));
function ready(patch = {}) {
  return { workspace: { id: 'workspace-one', root: '/work', name: 'Example workspace', trusted: true }, config: { exists: true, valid: true, revision: 'revision-1' }, hosts: { available: ['all', 'bob', 'claude'], default: 'all' }, capabilities,
    readiness: { courts: Object.fromEntries(['WITNESS', 'TRUSTGAP', 'TRIAGE'].map(k => [k, { ready: true, reason: 'Ready' }])), timeoutSeconds: 900, timeoutSource: '.gaia.yml' }, recentRuns: [], ...patch };
}
function evidence() {
  return { runId: 'run-one', requestedCourts: ['WITNESS', 'TRUSTGAP', 'TRIAGE'], phase: 'settled', lifecycle: 'completed', startedAt: '2026-05-08T10:00:00Z', finishedAt: '2026-05-08T10:02:00Z',
    courts: { WITNESS: { execution: 'complete', verdict: 'pass', metrics: [{ name: 'testsExecuted', value: 0, unit: 'count' }], payload: { summary: { green: 2, red: 0, yellow: 0 } } }, TRUSTGAP: { execution: 'complete', payload: { claimedCoverage: 88.5, mutationScore: 90.69, trustGap: 2.19 }, evidenceSource: 'imported', evidenceFreshness: 'unknown' }, TRIAGE: { execution: 'complete', payload: {} } },
    artifacts: [{ artifactId: 'canonical', kind: 'json', status: 'ready' }, { artifactId: 'markdown', kind: 'md', status: 'failed', error: 'Markdown write failed' }], publication: { state: 'failed', error: 'Dashboard unavailable' } };
}
function running() {
  return { runId: 'active-one', requestedCourts: ['WITNESS', 'TRUSTGAP', 'TRIAGE'], lifecycle: 'running', phase: 'executing', startedAt: new Date().toISOString(), settings: { timeoutSeconds: 900, publishToDashboard: false }, courts: { WITNESS: { execution: 'complete', verdict: 'findings' }, TRUSTGAP: { execution: 'running', progress: { phase: 'Testing mutations', tested: 37, total: 120, killed: 24 } }, TRIAGE: { execution: 'queued' } } };
}
function preview() { return { previewId: 'preview-config-1', expectedConfigRevision: 'revision-1', replacesExisting: true, files: [{ path: '.gaia.yml', action: 'replace', diff: '- timeoutSeconds: 900\n+ timeoutSeconds: 120' }] }; }
module.exports = { capabilities, ready, evidence, running, preview };
