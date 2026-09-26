#!/usr/bin/env node
/**
 * lib/trustgap.js — SPLITBRAIN honesty math.
 *
 * Falsifiable by construction: the trust gap is *derived* from a mutation
 * report, never asserted. Every surviving mutant maps to the test(s) that
 * covered it (per-test coverage when available) and those tests are named
 * dishonest. No fake-pass survives because a survivor is concrete evidence.
 *
 * Supported inputs:
 *   - Stryker JSON report (mutation-testing-report-schema) — full fidelity.
 *   - Generic JSON { mutants: [...] } — reduced fidelity.
 * Claimed coverage: jest coverage-summary.json totals.lines.pct, or an
 * explicit number in .triumph.yml / tool argument.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

/** Normalize a Stryker report into a flat mutant ledger. */
function fromStrykerReport(report) {
  const mutants = [];
  const files = report.files || {};
  for (const [file, fdata] of Object.entries(files)) {
    for (const m of fdata.mutants || []) {
      mutants.push({
        id: m.id,
        file,
        mutatorName: m.mutatorName,
        status: m.status, // Killed | Survived | Timeout | NoCoverage | ...
        replacement: m.replacement,
        location: m.location
          ? { line: m.location.start.line, column: m.location.start.column }
          : null,
        coveredBy: m.coveredBy || [],
        killedBy: m.killedBy || [],
        description: m.description || null,
      });
    }
  }
  return mutants;
}

function fromGenericReport(report) {
  const arr = Array.isArray(report) ? report : report.mutants || [];
  return arr.map((m, i) => ({
    id: m.id != null ? String(m.id) : String(i),
    file: m.file || m.fileName || null,
    mutatorName: m.mutatorName || m.mutator || m.operator || null,
    status: m.status || (m.killed ? 'Killed' : 'Survived'),
    replacement: m.replacement || null,
    location: m.location && typeof m.location.line === 'number'
      ? m.location
      : (typeof m.line === 'number' ? { line: m.line, column: m.column || 0 } : null),
    coveredBy: m.coveredBy || [],
    killedBy: m.killedBy || [],
    description: m.description || null,
  }));
}

/** Apply a resolved {testId: testName} map in place. */
function applyTestNames(ledger, names) {
  if (!names) return ledger;
  for (const d of ledger.dishonestTests || []) {
    d.testName = names[d.testId] || d.testName || null;
  }
  for (const m of ledger.mutants || []) {
    if (m.coveredBy) m.coveredByNames = m.coveredBy.map((t) => names[t] || t);
    if (m.killedBy) m.killedByNames = m.killedBy.map((t) => names[t] || t);
  }
  return ledger;
}

const KILLED = new Set(['Killed', 'killed', 'Timeout', 'timeout']);
const SURVIVED = new Set(['Survived', 'survived']);
const NO_COVERAGE = new Set(['NoCoverage', 'nocoverage', 'noCoverage']);

/**
 * Compute the trust-gap ledger.
 * @param mutants normalized mutant list
 * @param claimedCoverage number|null (0-100)
 */
function computeTrustGap(mutants, claimedCoverage) {
  const counted = mutants.filter((m) => KILLED.has(m.status) || SURVIVED.has(m.status));
  const killed = counted.filter((m) => KILLED.has(m.status));
  const survived = counted.filter((m) => SURVIVED.has(m.status));
  const noCoverage = mutants.filter((m) => NO_COVERAGE.has(m.status));

  const honestMutationScore = counted.length
    ? Math.round((killed.length / counted.length) * 10000) / 100
    : null;

  // A test is dishonest when it *covered* a surviving mutant and failed to
  // kill it — the test executes the code but asserts nothing meaningful.
  // When per-test coverage is absent we cannot name names; we say so.
  const dishonestMap = new Map(); // testId -> {testId, survivedMutants: []}
  let attribution = 'per-test';
  for (const m of survived) {
    const tids = m.coveredBy && m.coveredBy.length ? m.coveredBy : null;
    if (!tids) { attribution = 'unattributed'; continue; }
    for (const t of tids) {
      if (!dishonestMap.has(t)) dishonestMap.set(t, { testId: t, survivedMutants: [] });
      dishonestMap.get(t).survivedMutants.push(m.id);
    }
  }

  const trustGap = (claimedCoverage != null && honestMutationScore != null)
    ? Math.round((claimedCoverage - honestMutationScore) * 100) / 100
    : null;

  return {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    claimedCoverage: claimedCoverage != null ? claimedCoverage : null,
    honestMutationScore,
    trustGap,
    attribution,
    totals: {
      mutants: mutants.length,
      killed: killed.length,
      survived: survived.length,
      noCoverage: noCoverage.length,
      counted: counted.length,
    },
    dishonestTests: [...dishonestMap.values()],
    mutants,
  };
}

/** Pull claimed line-coverage % from a jest coverage-summary.json. */
function claimedFromJestSummary(fp) {
  const j = readJson(fp);
  if (j && j.total && j.total.lines && typeof j.total.lines.pct === 'number') {
    return j.total.lines.pct;
  }
  return null;
}

/** Load + normalize a mutation report from disk. */
function loadMutationReport(absPath) {
  const report = readJson(absPath);
  if (report && report.files && report.schemaVersion) {
    const mutants = fromStrykerReport(report);
    // Stryker embeds the authoritative id→test-name map under testFiles —
    // prefer it over any re-derivation.
    let testNames = null;
    if (report.testFiles) {
      testNames = {};
      for (const tf of Object.values(report.testFiles)) {
        for (const t of tf.tests || []) {
          if (t && t.id != null) testNames[String(t.id)] = t.name || null;
        }
      }
      if (!Object.keys(testNames).length) testNames = null;
    }
    return { mutants, kind: 'stryker', testNames };
  }
  return { mutants: fromGenericReport(report), kind: 'generic', testNames: null };
}

module.exports = { computeTrustGap, loadMutationReport, claimedFromJestSummary, fromGenericReport, fromStrykerReport, applyTestNames };
