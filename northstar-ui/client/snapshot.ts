export const COURTS = ['witness', 'trustgap', 'triage'] as const;
export type Court = (typeof COURTS)[number];
export type CourtState = 'not_run' | 'running' | 'complete' | 'error' | 'unavailable';
export type CourtResult<T> = { state: CourtState; collectedAt: string | null; sourceGeneratedAt: string | null; payload: T | Record<string, unknown> | null; errors: string[] };
export type Witness = { court: 'WITNESS'; summary: { green: number; red: number; total: number }; results: { clause: string; status: 'red' | 'yellow' | 'green'; passed: number; failed: number; total: number; spec_anchor: string; spec_text?: string; failures: { title: string; message: string }[] }[] };
export type Trustgap = { court: 'TRUSTGAP'; status: 'ok'; claimedCoverage: number; honestMutationScore: number; trustGap: number; dishonestTests: string[]; mutants: unknown[]; summary?: string | null; itLedger?: { itId: string; specRef?: string; file?: string; killed: number; survived: number; timeout: number; noCoverage: number; honest: boolean }[]; suiteLevelTotals?: { killed: number; survived: number; timeout: number; noCoverage: number; totalMutants: number; mutationScore: number } | null; stale?: boolean; warnings?: string[]; codeCommitAt?: string | null };
export type LedgerEntry = NonNullable<Trustgap['itLedger']>[number];
export type Deploy = { id?: string; service?: string; commit?: string; at?: string; [key: string]: unknown };
export type LogLine = { at?: string; timestamp?: string; level?: string; message?: string; [key: string]: unknown };
export type Triage = { context: { court: 'TRIAGE'; deploys: Deploy[]; metrics: Record<string, unknown>; logWindow: LogLine[] }; triage: { court: 'TRIAGE'; status?: string; detail?: string; incidentWindow?: string; suspect?: Record<string, unknown> | null; clearedDeploys?: Record<string, unknown>[]; breakerSnapshot?: Record<string, unknown>; evidence?: LogLine[]; rule?: string } };
export type CourtsReport = { witness: CourtResult<Witness>; trustgap: CourtResult<Trustgap>; triage: CourtResult<Triage> };
export type LegacySnapshot = CourtsReport & { schemaVersion: 1; runId: string; repository: string; checkedOutCommit: string | null; workingTreeDirty: boolean | null; createdAt: string; state: 'running' | 'complete' };
export type Snapshot = CourtsReport & { schemaVersion: 2; project: { id: string; name: string }; runId: string; createdAt: string; updatedAt: string; revision: number; state: 'running' | 'complete' | 'interrupted'; checkedOutCommit: string | null; branch: string | null; workingTreeDirty: boolean | null; producer: { name: string; version: string } };
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 100000;
const smallString = (v: unknown): v is string => string(v) && v.length <= 2000;
// Court error strings are unbounded in the server contract. A failed command can
// carry its stdout/stderr tail here; rejecting it would hide the whole saved run.
const errors = (v: unknown): v is string[] => Array.isArray(v) && v.every((entry) => typeof entry === 'string');
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v >= 0;
const fraction = (v: unknown): v is number => number(v) && v >= 0 && v <= 1;
const ledger = (v: unknown): v is LedgerEntry => record(v) && smallString(v.itId) && (v.specRef === undefined || smallString(v.specRef)) && (v.file === undefined || smallString(v.file)) && count(v.killed) && count(v.survived) && count(v.timeout) && count(v.noCoverage) && typeof v.honest === 'boolean';
const suite = (v: unknown): v is NonNullable<Trustgap['suiteLevelTotals']> => record(v) && count(v.killed) && count(v.survived) && count(v.timeout) && count(v.noCoverage) && count(v.totalMutants) && fraction(v.mutationScore);
const arr = <T>(v: unknown, guard: (v: unknown) => v is T): v is T[] => Array.isArray(v) && v.length <= 5000 && v.every(guard);
const date = (v: unknown): v is string => smallString(v) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const fail = (v: unknown): v is { title: string; message: string } => record(v) && smallString(v.title) && string(v.message);
const clause = (v: unknown): v is Witness['results'][number] => record(v) && smallString(v.clause) && ['red', 'yellow', 'green'].includes(String(v.status)) && count(v.passed) && count(v.failed) && count(v.total) && v.passed + v.failed <= v.total && (v.status !== 'green' || (v.total > 0 && v.passed === v.total)) && (v.status !== 'red' || v.failed > 0) && (v.status !== 'yellow' || (v.failed === 0 && (v.total === 0 || v.passed !== v.total))) && smallString(v.spec_anchor) && (v.spec_text === undefined || string(v.spec_text)) && arr(v.failures, fail);
export const witness = (v: unknown): v is Witness => record(v) && v.court === 'WITNESS' && record(v.summary) && count(v.summary.green) && count(v.summary.red) && count(v.summary.total) && arr(v.results, clause) && v.summary.total === v.results.length && v.summary.green === v.results.filter((r) => r.status === 'green').length && v.summary.red === v.results.filter((r) => r.status === 'red').length;
export const trustgap = (v: unknown): v is Trustgap => record(v) && v.court === 'TRUSTGAP' && v.status === 'ok' && fraction(v.claimedCoverage) && fraction(v.honestMutationScore) && number(v.trustGap) && v.trustGap >= -1 && v.trustGap <= 1 && Math.abs(v.trustGap - (v.claimedCoverage - v.honestMutationScore)) < 0.000001 && arr(v.dishonestTests, smallString) && Array.isArray(v.mutants) && v.mutants.length <= 5000 && (v.summary === undefined || v.summary === null || string(v.summary)) && (v.itLedger === undefined || arr(v.itLedger, ledger)) && (v.suiteLevelTotals === undefined || v.suiteLevelTotals === null || suite(v.suiteLevelTotals)) && (v.stale === undefined || typeof v.stale === 'boolean') && (v.warnings === undefined || arr(v.warnings, smallString)) && (v.codeCommitAt === undefined || v.codeCommitAt === null || date(v.codeCommitAt));
export const triage = (v: unknown): v is Triage => {
  if (!record(v) || !record(v.context) || !record(v.triage)) return false;
  const { context, triage: triageResult } = v;
  return context.court === 'TRIAGE' && triageResult.court === 'TRIAGE' && arr(context.deploys, record) && record(context.metrics) && arr(context.logWindow, record) && (triageResult.status === undefined || smallString(triageResult.status)) && (triageResult.detail === undefined || smallString(triageResult.detail)) && (triageResult.incidentWindow === undefined || smallString(triageResult.incidentWindow)) && (triageResult.suspect === undefined || triageResult.suspect === null || record(triageResult.suspect)) && (triageResult.clearedDeploys === undefined || arr(triageResult.clearedDeploys, record)) && (triageResult.breakerSnapshot === undefined || record(triageResult.breakerSnapshot)) && (triageResult.evidence === undefined || arr(triageResult.evidence, record)) && (triageResult.rule === undefined || smallString(triageResult.rule));
};
// Engine output is a different wire format from the dashboard's fractional
// artifact. These guards recognize only fields the engine actually emits; they
// do not convert units, fill missing coverage, or recompute its ledger.
export type EngineDishonestTest = { testId: string; testName?: string | null; survivedMutants: unknown[] };
export type EngineTrustgap = { court: 'TRUSTGAP'; status: 'ok'; schemaVersion: 1; claimedCoverage: number | null; honestMutationScore: number | null; trustGap: number | null; dishonestTests: EngineDishonestTest[]; attribution?: string; attributionNote?: string; totals?: Record<string, unknown>; survivors?: unknown[]; mutants?: unknown[]; itLedger?: unknown[]; summary?: string | null; source?: string; reportPath?: string; generated?: string };
const points = (v: unknown): v is number | null => v === null || number(v) && v >= 0 && v <= 100;
const gapPoints = (v: unknown): v is number | null => v === null || number(v) && v >= -100 && v <= 100;
const engineTest = (v: unknown): v is EngineDishonestTest => record(v) && smallString(v.testId) && (v.testName === undefined || v.testName === null || smallString(v.testName)) && Array.isArray(v.survivedMutants) && v.survivedMutants.length <= 5000;
export const engineTrustgap = (v: unknown): v is EngineTrustgap => record(v) && v.court === 'TRUSTGAP' && v.status === 'ok' && v.schemaVersion === 1 && points(v.claimedCoverage) && points(v.honestMutationScore) && gapPoints(v.trustGap) && arr(v.dishonestTests, engineTest) && (v.totals === undefined || record(v.totals)) && (v.mutants === undefined || Array.isArray(v.mutants)) && (v.survivors === undefined || Array.isArray(v.survivors)) && (v.itLedger === undefined || Array.isArray(v.itLedger)) && (v.summary === undefined || v.summary === null || string(v.summary)) && (v.attribution === undefined || smallString(v.attribution)) && (v.attributionNote === undefined || string(v.attributionNote)) && (v.generated === undefined || smallString(v.generated));
export type EngineTriage = { court: 'TRIAGE'; incidentWindow: string; suspect: Record<string, unknown> | null; breakerSnapshot: Record<string, unknown>; evidence: Record<string, unknown>[]; clearedDeploys: Record<string, unknown>[]; rule: string | null };
export const engineTriage = (v: unknown): v is EngineTriage => record(v) && v.court === 'TRIAGE' && smallString(v.incidentWindow) && (v.suspect === null || record(v.suspect)) && record(v.breakerSnapshot) && arr(v.evidence, record) && arr(v.clearedDeploys, record) && (v.rule === null || smallString(v.rule));
// An engine's court brand identifies its source, not its payload schema. Only
// recognize the dashboard's *specific* fractional-score shape when the key
// fields have that shape. In particular, a percentage-point score plus object
// dishonestTests is opaque evidence, not a broken fractional score to convert.
// Once recognized, retain the full guard (including bounds and consistency):
// invalid known-schema metrics must not silently fall back to generic evidence.
const recognizedTrustgap = (p: Record<string, unknown>): boolean =>
  p.schemaVersion !== 1 && p.court === 'TRUSTGAP' && p.status === 'ok' && 'claimedCoverage' in p && 'honestMutationScore' in p && 'trustGap' in p && arr(p.dishonestTests, smallString) && Array.isArray(p.mutants);
function result<T>(v: unknown, guard: (v: unknown) => v is T, recognized: (v: Record<string, unknown>) => boolean, generic = false): v is CourtResult<T> {
  if (!record(v)) return false;
  return ['not_run', 'running', 'complete', 'error', 'unavailable'].includes(String(v.state)) && nullableDate(v.collectedAt) && nullableDate(v.sourceGeneratedAt) && errors(v.errors) && (v.state === 'complete' ? (generic && record(v.payload) && !recognized(v.payload) ? true : guard(v.payload)) : v.payload === null || record(v.payload));
}
const courts = (v: Record<string, unknown>, generic = false): boolean => result(v.witness, witness, (p) => 'summary' in p || 'results' in p, generic) && result(v.trustgap, trustgap, recognizedTrustgap, generic) && result(v.triage, triage, (p) => 'context' in p || 'triage' in p, generic);
export function isLegacySnapshot(v: unknown): v is LegacySnapshot {
  return record(v) && v.schemaVersion === 1 && isUuid(v.runId) && smallString(v.repository) && v.repository.length > 0 && (v.checkedOutCommit === null || smallString(v.checkedOutCommit)) && (v.workingTreeDirty === null || typeof v.workingTreeDirty === 'boolean') && date(v.createdAt) && (v.state === 'running' || v.state === 'complete') && courts(v);
}
export function isSnapshot(v: unknown): v is Snapshot | LegacySnapshot { return isV2Snapshot(v) || isLegacySnapshot(v); }
export function isV2Snapshot(v: unknown): v is Snapshot {
  return record(v) && v.schemaVersion === 2 && record(v.project) && isUuid(v.project.id) && smallString(v.project.name) && v.project.name.trim().length > 0 && isUuid(v.runId) && date(v.createdAt) && date(v.updatedAt) && count(v.revision) && ['running', 'complete', 'interrupted'].includes(String(v.state)) && (v.checkedOutCommit === null || smallString(v.checkedOutCommit)) && (v.branch === null || smallString(v.branch)) && (v.workingTreeDirty === null || typeof v.workingTreeDirty === 'boolean') && record(v.producer) && smallString(v.producer.name) && smallString(v.producer.version) && courts(v, true);
}
// Preserve the legacy validation API for callers that need the original JSON unchanged.
export function validateSnapshot(value: unknown): Snapshot | LegacySnapshot {
  if (!isSnapshot(value)) throw new Error('Invalid snapshot. Expected a valid schemaVersion 1 or 2 report with court evidence.');
  return value;
}
// Stable, deterministic UUID for legacy reports with no project identity. No execution is
// enabled by this synthetic identity: imported reports stay detached until explicitly saved.
export function legacyProjectId(repository: string): string {
  const bytes = new TextEncoder().encode(`gaia:legacy-project:${repository}`);
  const words = [2166136261, 2166136261 ^ 0x9e3779b9, 2166136261 ^ 0x85ebca6b, 2166136261 ^ 0xc2b2ae35];
  for (const byte of bytes) for (let i = 0; i < words.length; i++) words[i] = Math.imul(words[i] ^ byte, 16777619) >>> 0;
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function normalizeSnapshot(value: unknown): Snapshot {
  const report = validateSnapshot(value);
  if (report.schemaVersion === 2) return report;
  return { schemaVersion: 2, project: { id: legacyProjectId(report.repository), name: report.repository }, runId: report.runId, createdAt: report.createdAt, updatedAt: report.createdAt, revision: 0, state: report.state, checkedOutCommit: report.checkedOutCommit, branch: null, workingTreeDirty: report.workingTreeDirty, producer: { name: 'legacy-snapshot', version: '1' }, witness: report.witness, trustgap: report.trustgap, triage: report.triage };
}
export function prettyTime(value: string | null | undefined): string { if (!value) return 'Not recorded'; const time = new Date(value); return Number.isFinite(time.getTime()) ? time.toLocaleString() : 'Invalid timestamp'; }
// Explicit source units: legacy dashboard artifacts use fractions; native engine
// ledgers use 0–100 percent. Never choose an adapter from numeric magnitude.
export function formatMetric(value: number | null | undefined, unit: 'percent' | 'percentage_points' | 'count'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not recorded';
  return `${Number(value.toFixed(2))}${unit === 'percent' ? '%' : unit === 'percentage_points' ? ' pp' : ''}`;
}
export function fractionPercent(value: number): string { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Not recorded'; }
export function fractionGap(value: number): string { return formatMetric(value * 100, 'percentage_points'); }
// Compatibility alias. Only for the validated legacy fractional payload schema.
export const pct = fractionPercent;
export function text(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return 'Unrenderable value'; }
}