#!/usr/bin/env node
/**
 * lib/micro.js — diff-scoped micro-mutation planner.
 *
 * Turns "these lines changed" into a bounded set of high-yield mutants that
 * can each be applied in-memory and judged in well under a second of test
 * execution. This is the in-loop complement to Stryker's full-repo pass:
 * Stryker answers "is the whole suite honest?"; micro-mutation answers
 * "is the change the agent just made actually pinned by a test?"
 *
 * Zero-dependency guarantee is load-bearing:
 *   - No Tree-sitter, no Babel, no Stryker.
 *   - Operators run on masked source (strings/comments blanked) so a '>'
 *     inside a string literal is never mutated.
 *   - TypeScript sources are inspected directly; transpile is the executor's
 *     concern (court.js), not the planner's.
 *
 * Operators (conservative, semantics-bearing only):
 *   boundary        < ↔ <= , > ↔ >=            (off-by-one on guards)
 *   negation        if (C) -> if (!(C))         (inverted guard)
 *   logical         a && b -> a || b            (condition merge)
 *   return-literal  return L -> return <swap>   (contract on output value)
 *   arithmetic      a - b -> a + b  (limited)   (sign/operator slip)
 *
 * Equivalence policy: a mutation whose `before` === `after`, or that lands
 * inside a string/comment, or that targets a line with no operator match,
 * is never emitted. No mutant is emitted unless it changes the byte stream.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_MUTANTS_PER_FILE = 3;

// ---------------------------------------------------------------------------
// Masking — blank string/comment content so operators never fire inside it.
// Handles ', ", `, //, /* */. Template-literal ${} nesting is not masked
// (rare in guard lines); a mutant that would land inside ${} is rejected
// later by the executor's apply-check if it fails to parse — the planner
// stays conservative and simple.
// ---------------------------------------------------------------------------
function maskSource(src) {
  const out = src.split('');
  let i = 0;
  let state = 'code'; // code | sq | dq | tpl | line | block
  while (i < out.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out[i] = ' '; i++; continue; }
      if (c === '"') { state = 'dq'; out[i] = ' '; i++; continue; }
      if (c === '`') { state = 'tpl'; out[i] = ' '; i++; continue; }
      i++;
    } else if (state === 'sq' || state === 'dq' || state === 'tpl') {
      const quote = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === quote) { state = 'code'; out[i] = ' '; i++; continue; }
      if (c === '\n') { state = 'code'; i++; continue; } // unterminated: bail to code
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; continue; }
      out[i] = ' ';
      i++;
    } else if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Operators. Each returns { before, after, operator, repair } or null.
// `before`/`after` are full replacement strings for the matched span.
// `repair` is the deterministic, operator-derived hint schema fragment.
// ---------------------------------------------------------------------------

function tryBoundary(maskedLine, rawLine) {
  // Order matters: check 2-char operators before their 1-char prefixes.
  const swaps = [
    ['>=', '>', 'boundary', 'Guard boundary weakened (>= to >): the exact-boundary input is now excluded.'],
    ['<=', '<', 'boundary', 'Guard boundary weakened (<= to <): the exact-boundary input is now excluded.'],
    ['>', '>=', 'boundary', 'Guard boundary widened (> to >=): the exact-boundary input is now included.'],
    ['<', '<=', 'boundary', 'Guard boundary widened (< to <=): the exact-boundary input is now included.'],
  ];
  for (const [from, to, operator, why] of swaps) {
    const idx = maskedLine.indexOf(from);
    if (idx < 0) continue;
    // Disallow === / !== / => / <=>= overlaps: neighbors must not be = or >.
    const prev = maskedLine[idx - 1] || '';
    const next = maskedLine[idx + from.length] || '';
    if (from === '>' && (prev === '=' || prev === '-' || next === '=')) continue;
    if (from === '<' && (prev === '=' || next === '=')) continue;
    if (from === '>=' && next === '>') continue;
    if (from === '<=' && next === '>') continue;
    if (from === '>' && prev === '>') continue;
    if (from === '<' && prev === '<') continue;
    const before = rawLine.slice(idx, idx + from.length);
    const after = to;
    return {
      operator, idx, len: from.length, before, after,
      spanBefore: before, spanAfter: after,
      repair: {
        kind: 'boundary-assertion',
        explanation: why + ` No test exercised the exact boundary at this line.`,
        suggestion: `Add an assertion at the boundary value (the input where the condition flips).`,
      },
    };
  }
  return null;
}

function tryNegation(maskedLine, rawLine) {
  // if (COND)  ->  if (!(COND))   — conservative: single-level, no nested
  // unparenthesized && / || mixing (that would change precedence).
  const m = /\bif\s*\(\s*([^()]+?)\s*\)\s*\{?/.exec(maskedLine);
  if (!m) return null;
  const cond = m[1];
  if (cond.includes('!')) return null;           // already negated: skip
  if (/&&|\|\|/.test(cond) && !/^\s*\(.*\)\s*$/.test(cond)) {
    // Mixed logical operators without full parens: negation changes binding.
    return null;
  }
  const idx = m.index + m[0].indexOf(cond);
  return {
    operator: 'conditional-negation', idx, len: cond.length,
    before: rawLine.slice(idx, idx + cond.length),
    after: `!(${rawLine.slice(idx, idx + cond.length)})`,
    repair: {
      kind: 'missing-assertion',
      explanation: 'Negating this guard did not fail any test: the suite reaches the line but never asserts the guarded outcome differs.',
      suggestion: 'Assert the observable effect of the guard (return value, state change, or thrown error) for an input that satisfies it and one that does not.',
    },
  };
}

function tryLogical(maskedLine, rawLine) {
  for (const [op, to] of [['&&', '||'], ['||', '&&']]) {
    const idx = maskedLine.indexOf(op);
    if (idx < 0) continue;
    return {
      operator: 'logical-swap', idx, len: op.length,
      before: rawLine.slice(idx, idx + op.length), after: to,
      repair: {
        kind: 'missing-assertion',
        explanation: `Swapping ${op} to ${to} kept the suite green: the combined condition's truth table is not pinned.`,
        suggestion: 'Add cases where exactly one operand is true (both directions).',
      },
    };
  }
  return null;
}

function tryReturnLiteral(maskedLine, rawLine) {
  const m = /\breturn\s+(-?\d+(?:\.\d+)?|true|false|null)\b/.exec(maskedLine);
  if (!m) return null;
  const lit = m[1];
  const swap = lit === 'true' ? 'false'
    : lit === 'false' ? 'true'
    : lit === 'null' ? 'undefined'
    : String(Number(lit) + 1);
  const idx = m.index + m[0].lastIndexOf(lit);
  return {
    operator: 'return-literal', idx, len: lit.length,
    before: rawLine.slice(idx, idx + lit.length), after: swap,
    repair: {
      kind: 'missing-assertion',
      explanation: `Changing the returned literal ${lit} to ${swap} kept the suite green: no test asserts this return value.`,
      suggestion: `Assert the exact return value for an input that reaches this line.`,
    },
  };
}

function tryArithmetic(maskedLine, rawLine) {
  // a - b -> a + b, only when both sides look like identifiers/numbers.
  const m = /([\w)\]]+)\s+-\s+([\w(\[]+)/.exec(maskedLine);
  if (!m) return null;
  const idx = m.index + m[1].length + m[0].slice(m[1].length).indexOf('-');
  return {
    operator: 'arithmetic-sign', idx, len: 1,
    before: rawLine.slice(idx, idx + 1), after: '+',
    repair: {
      kind: 'missing-assertion',
      explanation: 'Flipping subtraction to addition kept the suite green: the arithmetic result is not asserted.',
      suggestion: 'Assert the numeric result for inputs where + and - differ.',
    },
  };
}

const OPERATORS = [tryBoundary, tryNegation, tryLogical, tryReturnLiteral, tryArithmetic];

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plan micro-mutants for one changed file.
 *
 * @param {string} absPath   absolute path to the CURRENT (post-diff) file
 * @param {string} relPath   repo-relative path (for reporting)
 * @param {number[]} addedLines  new-file line numbers from the diff
 * @param {string} srcText   full current file content
 * @returns { mutants: [...], skipped: [ { line, reason } ] }
 *
 * Mutant shape:
 *   { id, file, line, col, operator, before, after, lineBefore, lineAfter, repair }
 * `lineBefore`/`lineAfter` are the FULL source lines — the executor swaps the
 * whole line, so no column arithmetic survives into the write path.
 */
function planFileMutants(relPath, srcText, addedLines) {
  const masked = maskSource(srcText);
  const srcLines = srcText.split('\n');
  const maskedLines = masked.split('\n');
  const mutants = [];
  const skipped = [];
  const seen = new Set(); // line|operator dedupe

  const candidates = [...new Set(addedLines)].sort((a, b) => a - b);
  for (const ln of candidates) {
    if (ln < 1 || ln > srcLines.length) { skipped.push({ line: ln, reason: 'line outside current file (diff stale?)' }); continue; }
    const raw = srcLines[ln - 1];
    const mask = maskedLines[ln - 1];
    if (!mask.trim()) { skipped.push({ line: ln, reason: 'comment/blank/string-only line' }); continue; }
    for (const op of OPERATORS) {
      if (mutants.length >= MAX_MUTANTS_PER_FILE) break;
      const r = op(mask, raw);
      if (!r) continue;
      const key = `${ln}|${r.operator}|${r.idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lineAfter = raw.slice(0, r.idx) + r.after + raw.slice(r.idx + r.len);
      if (lineAfter === raw) continue; // equivalent: never emit
      mutants.push({
        id: `mm-${mutants.length + 1}`,
        file: relPath,
        line: ln,
        operator: r.operator,
        before: r.before,
        after: r.after,
        lineBefore: raw,
        lineAfter,
        repair: r.repair,
      });
      break; // one operator per line: highest-priority match wins
    }
    if (mutants.length >= MAX_MUTANTS_PER_FILE) break;
  }
  return { mutants, skipped };
}

// ---------------------------------------------------------------------------
// Impacted-test selection (test-impact analysis, zero-coverage-tooling).
//
// Strategy, in priority order:
//   1. Static import scan — test file text references the source basename or
//      relative path (../src/discounts, ./discounts, require('../src/x')).
//   2. Harness binding scan — a setup/harness file under the repo binds the
//      source module to a global seam; every non-clause test is a candidate
//      for sources bound this way (northstar's bind-seams.cjs pattern).
//   3. Basename heuristic — discounts.ts <-> discounts.test.ts.
// Clause witness suites are ALWAYS excluded: micro-mutation measures the
// honesty of the repo's regular suite, not REDLINE's wall-enforced witnesses
// (consistent with splitbrain attribution exclusions in court.js).
// ---------------------------------------------------------------------------

function isClauseTest(cfg, absFile) {
  try {
    const runners = require('./runners');
    return runners.isClauseTestFile(cfg, absFile);
  } catch { return false; }
}

function selectImpactedTests(cfg, srcRelPath, allTestFiles) {
  const base = path.basename(srcRelPath).replace(/\.[^.]+$/, '');
  const srcNoExt = srcRelPath.replace(/\.[^.]+$/, '').split(path.sep).join('/');
  const impacted = [];
  const reasons = {};

  for (const absTest of allTestFiles) {
    if (isClauseTest(cfg, absTest)) continue;
    let why = null;
    try {
      const text = fs.readFileSync(absTest, 'utf8');
      // (1) direct import/require of the source path or basename
      if (text.includes(srcNoExt) || new RegExp(`['"\`][^'"\`]*${escapeRe(base)}['"\`]`).test(text)) {
        why = 'static-import';
      }
    } catch { /* unreadable test file: fall through to basename */ }
    // (3) basename
    if (!why && path.basename(absTest).replace(/\.[^.]+$/, '').includes(base)) {
      why = 'basename';
    }
    if (why) { impacted.push(absTest); reasons[path.basename(absTest)] = why; }
  }

  // (2) harness-bound sources: if a harness/setup file requires this src,
  // non-clause tests whose text mentions any of its bound seam names are
  // impacted. Discover harness files by scanning tests.dir + jest.config's
  // setupFiles entries would require config parsing; keep it conservative:
  // scan files under tests.dir named *seam*/*harness*/*bind*.
  const harnessSeams = discoverHarnessSeams(cfg, srcRelPath);
  if (harnessSeams.length) {
    for (const absTest of allTestFiles) {
      if (isClauseTest(cfg, absTest) || impacted.includes(absTest)) continue;
      try {
        const text = fs.readFileSync(absTest, 'utf8');
        if (harnessSeams.some((s) => text.includes(s))) {
          impacted.push(absTest);
          reasons[path.basename(absTest)] = 'harness-seam';
        }
      } catch { /* skip */ }
    }
  }

  return { impacted, reasons };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Find seam names bound to srcRelPath by harness files under tests.dir.
 * Recognizes the bind-seams pattern:  bind('../src/x', { seam: 'export' })
 * Returns seam names (e.g. ['applyDiscount']).
 */
function discoverHarnessSeams(cfg, srcRelPath) {
  const seams = [];
  const srcNoExt = srcRelPath.replace(/\.[^.]+$/, '');
  const dir = cfg.tests && cfg.tests.absDir;
  const harnessDir = path.join(cfg.repoRoot, 'harness');
  const candidates = [];
  for (const d of [harnessDir, dir]) {
    if (!d || !fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d)) {
      if (/bind|seam|harness/i.test(e) && /\.(cjs|js|ts)$/.test(e)) candidates.push(path.join(d, e));
    }
  }
  for (const fp of candidates) {
    let text;
    try { text = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    // bind('<path ending in srcNoExt>', { Seam: 'export', ... })
    const re = /bind\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Strip a real file extension only — naive /\.[^.]+$/ would eat the
      // leading '..' of a relative require like '../src/discounts'.
      const base = path.basename(m[1]);
      const strippedBase = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, '');
      const boundPath = path.join(path.dirname(m[1]), strippedBase).split(path.sep).join('/');
      const tail2 = srcNoExt.split('/').slice(-2).join('/');
      if (!boundPath.endsWith(tail2) && !boundPath.endsWith(srcNoExt.split('/').pop())) continue;
      if (!srcNoExt.endsWith(path.basename(boundPath))) continue;
      const body = m[2];
      for (const km of body.matchAll(/(\w+)\s*:/g)) seams.push(km[1]);
    }
  }
  return [...new Set(seams)];
}

module.exports = { planFileMutants, maskSource, selectImpactedTests, MAX_MUTANTS_PER_FILE };
