'use strict';
// The webview is an untrusted boundary. Paths and commands are never accepted.
const TYPES = {
  ready: [], runCourt: ['court', 'courts', 'outputTarget', 'publishToDashboard', 'timeoutSeconds', 'workspaceId'],
  cancelRun: ['runId'], publishRun: ['runId'], selectRun: ['runId'], loadMoreRuns: [],
  openArtifact: ['runId', 'artifactId'], openLogs: ['runId', 'court'],
  dashboardOpen: ['runId'], dashboardStart: [], dashboardStatus: [], dashboardRun: [],
  openConfig: [], detectConfig: [], configValidate: ['workspaceId'], configPreview: ['workspaceId'],
  configApply: ['previewId', 'expectedConfigRevision'], installPreview: ['host'],
  installApply: ['previewId'], installCourts: ['host'], openFolder: [], manageTrust: [],
  generateReport: ['formats'], openLastReport: ['format'], refresh: [],
};
const ALIASES = {
  'run.start': 'runCourt', 'run.cancel': 'cancelRun', 'run.publish': 'publishRun', 'run.select': 'selectRun',
  'artifact.open': 'openArtifact', 'diagnostics.open': 'openLogs', 'dashboard.open': 'dashboardOpen',
  'config.validate': 'configValidate', 'config.preview': 'configPreview', 'config.apply': 'configApply',
  'integration.preview': 'installPreview', 'integration.install': 'installApply',
};
function decodeMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.type !== 'string') throw new Error('Malformed message');
  let msg = raw;
  if (raw.requestId !== undefined && (typeof raw.requestId !== 'string' || !/^[\w.-]{1,128}$/.test(raw.requestId))) throw new Error('Invalid requestId');
  if (raw.protocolVersion !== undefined) {
    if (raw.protocolVersion !== 2 || typeof raw.requestId !== 'string' || !/^[\w.-]{1,128}$/.test(raw.requestId)) throw new Error('Unsupported protocol or invalid requestId');
    if (Object.keys(raw).some(k => !['protocolVersion', 'requestId', 'type', 'payload'].includes(k))) throw new Error('Unknown envelope field');
    const payload = raw.payload || {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid message payload');
    msg = { ...payload, type: ALIASES[raw.type] || raw.type, requestId: raw.requestId };
  }
  const fields = TYPES[msg.type];
  if (!fields) throw new Error(`Unknown message type: ${msg.type}`);
  if (Object.keys(msg).some(k => k !== 'type' && k !== 'requestId' && !fields.includes(k))) throw new Error(`Unknown ${msg.type} field`);
  for (const key of ['runId', 'artifactId', 'previewId', 'workspaceId', 'expectedConfigRevision']) {
    if (msg[key] !== undefined && msg[key] !== null && (typeof msg[key] !== 'string' || msg[key].length > 4096)) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['cancelRun', 'publishRun', 'selectRun', 'openArtifact']) {
    if (msg.type === key && !msg.runId) throw new Error(`${key} requires runId`);
  }
  if (msg.type === 'openArtifact' && !msg.artifactId) throw new Error('openArtifact requires artifactId');
  if (msg.publishToDashboard !== undefined && typeof msg.publishToDashboard !== 'boolean') throw new Error('publishToDashboard must be boolean');
  if (msg.type === 'configApply' || msg.type === 'installApply') {
    if (!msg.previewId) throw new Error(`${msg.type} requires a previewId`);
  }
  return msg;
}
function allowedDashboardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
module.exports = { TYPES, ALIASES, decodeMessage, allowedDashboardUrl };
