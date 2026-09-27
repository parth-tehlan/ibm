'use strict';
/**
 * lib/spec-author.js — generate a minimal RFC 2119 spec contract for a repo
 * that doesn't have one.
 *
 * Called by actions.createSpec(). Reads signals from the repo (README,
 * package.json, entry points, existing tests) and writes a Markdown spec to
 * the path configured in .triumph.yml (or docs/spec.md as default).
 *
 * Returns { specPath, clauseCount } on success. Throws on failure.
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Repo scanner — same logic as .bob/skills/spec-author/scan-repo.js but
// inlined here so the extension has zero extra dependencies.
// ---------------------------------------------------------------------------

function tryRead(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
}

function tryJson(root, rel) {
  const t = tryRead(root, rel);
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

function walkFiles(dir, maxDepth, exts, limit) {
  const results = [];
  const SKIP = new Set(['node_modules', 'vendor', 'dist', '__pycache__', '.git']);
  function _walk(d, depth) {
    if (results.length >= limit || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) _walk(full, depth + 1);
      else if (!exts || exts.some((x) => e.name.endsWith(x))) results.push(path.relative(dir, full));
      if (results.length >= limit) return;
    }
  }
  _walk(dir, 0);
  return results;
}

function scanRepo(root) {
  const pkg   = tryJson(root, 'package.json');
  const readme = tryRead(root, 'README.md') || tryRead(root, 'README.rst') || tryRead(root, 'README') || '';

  const name = (pkg && pkg.name) || path.basename(root);
  let description = (pkg && pkg.description) || '';
  if (!description) {
    const line = readme.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.includes('!['));
    if (line) description = line.trim().slice(0, 200);
  }

  // entry points
  const entryPoints = [];
  if (pkg && pkg.main) entryPoints.push(pkg.main);
  for (const c of ['src/index.ts','src/index.js','index.ts','index.js','app.js','app.ts','lib/index.ts','lib/index.js']) {
    if (fs.existsSync(path.join(root, c)) && !entryPoints.includes(c)) entryPoints.push(c);
    if (entryPoints.length >= 3) break;
  }

  // exported names from first entry point
  const publicApi = [];
  for (const ep of entryPoints.slice(0, 2)) {
    const src = tryRead(root, ep);
    if (!src) continue;
    const matches = src.match(/^export\s+(async\s+)?(function|class|const|let|var)\s+(\w+)/gm) || [];
    matches.slice(0, 10).forEach((m) => { const id = m.match(/\b(\w+)\s*$/); if (id) publicApi.push(id[1]); });
  }

  // existing test files (signals what's already being tested)
  let existingTests = [];
  for (const d of ['tests','test','__tests__','spec']) {
    if (fs.existsSync(path.join(root, d))) {
      existingTests = existingTests.concat(
        walkFiles(path.join(root, d), 2, ['.ts','.js','.py'], 8).map((f) => path.join(d, f))
      );
    }
    if (existingTests.length >= 8) break;
  }

  return { name, description, readme: readme.slice(0, 800), entryPoints, publicApi, existingTests };
}

// ---------------------------------------------------------------------------
// Clause builder — derives normative clauses from scan signals.
// ---------------------------------------------------------------------------

function buildClauses(scan) {
  const clauses = [];
  let n = 1;

  function add(title, level, body) {
    clauses.push({ id: `S${n++}`, title, level, body });
  }

  // Always include a basic "system must be importable/startable" clause
  const name = scan.name || 'The system';
  add(
    'Module initialisation',
    'MUST',
    `${name} MUST export its public interface without throwing errors on import or require.`
  );

  // If there are exported names, one clause per logical group (max 5)
  if (scan.publicApi.length > 0) {
    const apis = scan.publicApi.slice(0, 5);
    add(
      'Public API availability',
      'MUST',
      `${name} MUST export the following symbols: ${apis.join(', ')}. Each MUST be a non-null value after module load.`
    );
  }

  // Description-derived clause if we have something useful
  if (scan.description && scan.description.length > 10) {
    add(
      'Core behaviour',
      'MUST',
      `${scan.description.replace(/\.$/, '')}. The system MUST perform this function without unhandled exceptions under normal operating conditions.`
    );
  }

  // If tests exist, infer a "tested paths must not regress" clause
  if (scan.existingTests.length > 0) {
    add(
      'Test suite must pass',
      'MUST',
      `All existing test files MUST pass without error. Specifically: ${scan.existingTests.slice(0, 4).join(', ')}.`
    );
  }

  // Error handling clause — always valid
  add(
    'Invalid input handling',
    'MUST NOT',
    `${name} MUST NOT crash or expose an unhandled rejection when called with null, undefined, or out-of-range arguments to any exported function.`
  );

  // README-derived SHOULD clause if readme is substantial
  if (scan.readme.length > 100) {
    add(
      'Documentation accuracy',
      'SHOULD',
      `The behaviour described in the README SHOULD match the implemented behaviour. Any divergence SHOULD be documented as a known limitation.`
    );
  }

  return clauses;
}

// ---------------------------------------------------------------------------
// Spec document renderer
// ---------------------------------------------------------------------------

function renderSpec(scan, clauses) {
  const index = clauses.map((c) => `| ${c.id} | ${c.level} | ${c.title} |`).join('\n');
  const bodies = clauses.map((c) => `### ${c.id} — ${c.title}\n\n**Level:** ${c.level}\n\n${c.body}`).join('\n\n');

  return `# ${scan.name} — Specification

> Version: 1.0.0-draft
> Status: Draft — generated by TRIUMPH spec-author

## Overview

${scan.description || `${scan.name} specification.`}

## Clause index

| ID | Level | Title |
|----|-------|-------|
${index}

## Clauses

${bodies}
`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate a spec file for the repo at `root`.
 * Writes to `specPath` (absolute). Creates parent dirs as needed.
 * Returns { specPath, clauseCount }.
 */
function createSpec(root, specPath) {
  const scan    = scanRepo(root);
  const clauses = buildClauses(scan);
  const content = renderSpec(scan, clauses);

  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, content, 'utf8');

  return { specPath, clauseCount: clauses.length };
}

module.exports = { createSpec, scanRepo, buildClauses };
