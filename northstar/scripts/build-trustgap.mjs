#!/usr/bin/env node
/**
 * build-trustgap.mjs — derive trustgap/TrustGap.json from REAL tool output.
 *
 * Inputs (both produced by commands in package.json's "trustgap" script):
 *   - reports/mutation/mutation.json   (Stryker JSON report; `npm run mutation`
 *     i.e. `stryker run` per stryker.conf.json, mutating ONLY src/discounts.ts,
 *     jest-runner against stryker.jest.config.js which narrows testMatch to
 *     tests/discounts.test.ts + tests/policy-discounts.test.ts)
 *   - coverage/coverage-summary.json   (Jest `--coverage --coverageReporters
 *     =json-summary --testPathPattern discounts --collectCoverageFrom=
 *     src/discounts.ts`)
 *
 * Nothing in this file is hand-tuned: every number in the output comes from
 * these two JSON files. The only hand-authored data is METADATA below, which
 * maps each `it` block's full Jest test name (stable across reruns; test IDs
 * are NOT, since Stryker assigns them by discovery order) to bookkeeping
 * fields that Stryker doesn't know about: a stable itId, the PRICING_POLICY.md
 * anchor the test's own comments cite, and whether tests/discounts.test.ts is
 * flagged dishonest (per its own doc-comment: "does NOT assert any policy
 * rule ... can never fail").
 *
 * Per-test attribution rule (per test t, over all mutants m in
 * files["src/discounts.ts"].mutants):
 *   killed[t]     = # m with status === 'Killed'     and t in m.killedBy
 *   survived[t]   = # m with status === 'Survived'   and t in m.coveredBy
 *   timeout[t]    = # m with status === 'Timeout'    and t in m.coveredBy
 *   noCoverage[t] = # m with status === 'NoCoverage' and t in m.coveredBy
 *
 * Note: `survived`/`timeout` are "blamed" on every covering test (a mutant
 * covered by N tests but killed by none contributes to all N tests' survived
 * count), so summing them over the ledger can exceed the suite-level survived
 * count from Stryker's own summary table when a survivor is multi-covered.
 * `noCoverage` mutants have an empty coveredBy by definition, so no it-block
 * is ever blamed for them; the suite-level noCoverage total is reported
 * separately for cross-checking. Both effects are called out in `summary`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // northstar/
const MUTATION_REPORT = path.join(ROOT, 'reports', 'mutation', 'mutation.json');
const COVERAGE_SUMMARY = path.join(ROOT, 'coverage', 'coverage-summary.json');
const OUT = path.join(ROOT, 'trustgap', 'TrustGap.json');
const MUTATE_FILE = 'src/discounts.ts';

// Full Jest test name (describe + ' ' + it title, exactly as Stryker's
// testFiles[...].tests[].name records it) -> bookkeeping metadata.
const METADATA = {
  'Pricing policy: single-best discount (never stacks) applies the single best discount and does not stack SAVE10 + SAVE20': {
    itId: 'discount-single-best-nonstack-save10-save20',
    specRef: 'PRICING_POLICY.md#single-best',
    honest: true,
  },
  'Pricing policy: single-best discount (never stacks) keeps the pre-tax amount unchanged when it is below the 500-cent minimum': {
    itId: 'discount-min-order-below-threshold',
    specRef: 'PRICING_POLICY.md#min-order',
    honest: true,
  },
  'Pricing policy: single-best discount (never stacks) does not combine a flat $5 code with a percentage code': {
    itId: 'discount-single-best-no-flat-plus-percent',
    specRef: 'PRICING_POLICY.md#single-best',
    honest: true,
  },
  'Pricing policy: single-best discount (never stacks) applies the flat $5 at the exact 500-cent min-order boundary': {
    itId: 'discount-min-order-boundary-500',
    specRef: 'PRICING_POLICY.md#min-order',
    honest: true,
  },
  'Pricing policy: single-best discount (never stacks) applies the flat $5 alone when it is the single best': {
    itId: 'discount-single-best-flat-five-alone',
    specRef: 'PRICING_POLICY.md#single-best',
    honest: true,
  },
  'discount coverage (coverage-shaped) returns the discount-engine result for a set of codes': {
    itId: 'discount-tautology-bundle-codes',
    specRef: 'PRICING_POLICY.md#tautology',
    honest: false,
  },
  'discount coverage (coverage-shaped) keeps the result within a trivially-wide band for any input': {
    itId: 'discount-tautology-trivial-band',
    specRef: 'PRICING_POLICY.md#tautology',
    honest: false,
  },
};

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  let mutationReport;
  try {
    mutationReport = JSON.parse(readFileSync(MUTATION_REPORT, 'utf8'));
  } catch (err) {
    fail(`could not read/parse ${MUTATION_REPORT} — run "npm run mutation" first (${err.message})`);
  }

  let coverageSummary;
  try {
    coverageSummary = JSON.parse(readFileSync(COVERAGE_SUMMARY, 'utf8'));
  } catch (err) {
    fail(`could not read/parse ${COVERAGE_SUMMARY} — run jest with --coverageReporters=json-summary first (${err.message})`);
  }

  const fileReport = mutationReport.files?.[MUTATE_FILE];
  if (!fileReport) {
    fail(`mutation report has no entry for ${MUTATE_FILE} (files: ${Object.keys(mutationReport.files ?? {})})`);
  }
  const mutants = fileReport.mutants;

  // Build testId -> full test name from testFiles (only the two discount test
  // files should be present, since stryker.jest.config.js narrows testMatch).
  const idToName = new Map();
  for (const [testFile, entry] of Object.entries(mutationReport.testFiles ?? {})) {
    for (const t of entry.tests ?? []) {
      idToName.set(t.id, { name: t.name, file: testFile });
    }
  }
  if (idToName.size === 0) {
    fail('mutation report testFiles is empty — was coverageAnalysis "perTest"?');
  }

  // Suite-level totals, straight from Stryker's own per-mutant statuses.
  const suiteTotals = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0, other: 0 };
  for (const m of mutants) {
    if (m.status in suiteTotals) suiteTotals[m.status] += 1;
    else suiteTotals.other += 1;
  }
  // Matches Stryker's own clear-text "total" column (the headline mutation
  // score), which treats NoCoverage mutants as not-killed rather than
  // excluding them (that's the "covered" column instead).
  const suiteScoreDenom = suiteTotals.Killed + suiteTotals.Survived + suiteTotals.Timeout + suiteTotals.NoCoverage;
  const suiteMutationScore = suiteScoreDenom > 0 ? suiteTotals.Killed / suiteScoreDenom : null;

  // Per-test ledger.
  const ledger = [];
  const seenIds = new Set();
  for (const [testId, { name, file }] of idToName) {
    const meta = METADATA[name];
    if (!meta) {
      fail(`no METADATA entry for test name ${JSON.stringify(name)} in ${file} — update scripts/build-trustgap.mjs`);
    }
    if (seenIds.has(meta.itId)) fail(`duplicate itId ${meta.itId}`);
    seenIds.add(meta.itId);

    let killed = 0;
    let survived = 0;
    let timeout = 0;
    let noCoverage = 0;
    for (const m of mutants) {
      const killedBy = m.killedBy ?? [];
      const coveredBy = m.coveredBy ?? [];
      if (m.status === 'Killed' && killedBy.includes(testId)) killed += 1;
      else if (m.status === 'Survived' && coveredBy.includes(testId)) survived += 1;
      else if (m.status === 'Timeout' && coveredBy.includes(testId)) timeout += 1;
      else if (m.status === 'NoCoverage' && coveredBy.includes(testId)) noCoverage += 1;
    }

    ledger.push({
      itId: meta.itId,
      specRef: meta.specRef,
      file,
      killed,
      survived,
      timeout,
      noCoverage,
      honest: meta.honest,
    });
  }
  // Stable order: by file then by itId, so re-runs diff cleanly.
  ledger.sort((a, b) => (a.file === b.file ? a.itId.localeCompare(b.itId) : a.file.localeCompare(b.file)));

  const dishonestTests = ledger.filter((r) => r.honest === false).map((r) => r.itId);

  const ledgerKilled = ledger.reduce((s, r) => s + r.killed, 0);
  const ledgerSurvived = ledger.reduce((s, r) => s + r.survived, 0);
  const ledgerTimeout = ledger.reduce((s, r) => s + r.timeout, 0);
  const ledgerNoCoverage = ledger.reduce((s, r) => s + r.noCoverage, 0);
  // honestMutationScore counts each mutant ONCE (the per-test ledger above
  // double-counts multi-covered survivors, so it cannot be summed into a score):
  //   numerator   = # mutants killed by at least one HONEST test
  //   denominator = # mutants that are Killed or Survived (NoCoverage excluded,
  //                 per the schema's killed / (killed + survived) definition)
  const honestTestIds = new Set(
    [...idToName].filter(([, { name }]) => METADATA[name]?.honest).map(([id]) => id)
  );
  const honestKills = mutants.filter(
    (m) => m.status === 'Killed' && (m.killedBy ?? []).some((id) => honestTestIds.has(id))
  ).length;
  const ledgerDenom = suiteTotals.Killed + suiteTotals.Survived;
  if (ledgerDenom === 0) fail('killed+survived is 0 — cannot compute honestMutationScore');
  const honestMutationScore = honestKills / ledgerDenom;

  // claimedCoverage: this suite's self-reported line coverage of src/discounts.ts.
  const discountsCov = coverageSummary[Object.keys(coverageSummary).find((k) => k.replace(/\\/g, '/').endsWith(MUTATE_FILE)) ?? ''];
  if (!discountsCov) {
    fail(`coverage-summary.json has no entry for a file ending in ${MUTATE_FILE} (keys: ${Object.keys(coverageSummary)})`);
  }
  const claimedCoverage = discountsCov.lines.pct / 100;
  const trustGap = claimedCoverage - honestMutationScore;

  const crossCheckNotes = [];
  if (ledgerSurvived !== suiteTotals.Survived) {
    crossCheckNotes.push(
      `ledger survived total (${ledgerSurvived}) != Stryker suite-level survived (${suiteTotals.Survived}) ` +
      `because a Survived mutant covered by multiple tests is blamed on each covering it-block (per-test attribution), ` +
      `while Stryker's summary counts each surviving mutant once.`
    );
  }
  if (ledgerNoCoverage !== suiteTotals.NoCoverage) {
    crossCheckNotes.push(
      `ledger noCoverage total (${ledgerNoCoverage}) != Stryker suite-level noCoverage (${suiteTotals.NoCoverage}) ` +
      `because a NoCoverage mutant has an empty coveredBy by definition, so no it-block can be blamed for it; ` +
      `it only shows up in the suite-level total.`
    );
  }

  const summary =
    `Stryker mutated src/discounts.ts: ` +
    `${suiteTotals.Killed} killed / ${suiteTotals.Survived} survived / ${suiteTotals.Timeout} timeout / ` +
    `${suiteTotals.NoCoverage} no-coverage of ${mutants.length} mutants (suite mutation score ${(suiteMutationScore * 100).toFixed(2)}%). ` +
    `Honest policy-discounts.test.ts it-blocks account for ${ledger.filter((r) => r.honest).reduce((s, r) => s + r.killed, 0)} ` +
    `of the ${ledgerKilled} kills attributed in the per-test ledger; the dishonest tautology in discounts.test.ts ` +
    `(${dishonestTests.join(', ')}) kills 0 mutants and only accumulates survived counts. ` +
    `honestMutationScore (unique mutants killed by honest tests / killed+survived) = ${honestKills}/${ledgerDenom} = ${honestMutationScore.toFixed(4)}. ` +
    `Jest's self-reported line coverage of src/discounts.ts is ${(claimedCoverage * 100).toFixed(2)}%, ` +
    `giving trustGap = claimedCoverage - honestMutationScore = ${trustGap.toFixed(4)}. ` +
    (crossCheckNotes.length ? `Cross-check notes: ${crossCheckNotes.join(' ')}` : 'Ledger totals reconcile exactly with Stryker suite totals.');

  const out = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    itLedger: ledger,
    dishonestTests,
    honestMutationScore,
    claimedCoverage,
    trustGap,
    summary,
    _sourceCommands: {
      mutation: 'npx stryker run  (stryker.conf.json + stryker.jest.config.js, mutating src/discounts.ts only)',
      coverage: 'npx jest --coverage --coverageReporters=json-summary --testPathPattern discounts --collectCoverageFrom=src/discounts.ts',
    },
    _suiteLevelTotals: {
      killed: suiteTotals.Killed,
      survived: suiteTotals.Survived,
      timeout: suiteTotals.Timeout,
      noCoverage: suiteTotals.NoCoverage,
      totalMutants: mutants.length,
      mutationScore: suiteMutationScore,
    },
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log('Per-it ledger:');
  for (const r of ledger) {
    console.log(
      `  ${r.itId.padEnd(46)} killed=${r.killed} survived=${r.survived} timeout=${r.timeout} noCoverage=${r.noCoverage} honest=${r.honest}`
    );
  }
  console.log(
    `Suite totals (Stryker): killed=${suiteTotals.Killed} survived=${suiteTotals.Survived} timeout=${suiteTotals.Timeout} noCoverage=${suiteTotals.NoCoverage} / ${mutants.length} mutants, score=${(suiteMutationScore * 100).toFixed(2)}%`
  );
  console.log(`Ledger totals: killed=${ledgerKilled} survived=${ledgerSurvived} timeout=${ledgerTimeout} noCoverage=${ledgerNoCoverage}`);
  console.log(`honestMutationScore = ${honestKills}/${ledgerDenom} = ${honestMutationScore.toFixed(4)}`);
  console.log(`claimedCoverage = ${(claimedCoverage * 100).toFixed(2)}%`);
  console.log(`trustGap = ${trustGap.toFixed(4)}`);
  if (crossCheckNotes.length) {
    console.log('Cross-check notes:');
    for (const n of crossCheckNotes) console.log(`  - ${n}`);
  }
  console.log(`Wrote ${OUT}`);
}

main();
