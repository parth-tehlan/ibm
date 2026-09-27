#!/usr/bin/env node
/**
 * lib/diff.js — unified-diff parsing for the in-loop court.
 *
 * Pure functions, zero dependencies, no git binary required: the calling
 * agent pastes the patch text (or pipes `git diff HEAD`); the engine never
 * shells out to git. The output is the mutation targeting contract consumed
 * by lib/micro.js:
 *
 *   parseDiff(text) -> {
 *     files: [ { path, oldPath, kind, addedLines: [n...], hunks: [...] } ],
 *     rejected: [ { path, reason } ],
 *     stats: { filesChanged, linesAdded, linesRemoved }
 *   }
 *
 * kind: 'modify' | 'add' | 'delete' | 'rename'
 *
 * Rejected (never silently mistargeted): binary patches, /dev/null paths we
 * cannot interpret, mode-only changes. Renames are accepted (target = new
 * path) and recorded.
 *
 * Line numbering: addedLines are NEW-file line numbers — the numbers a human
 * sees in an editor after the patch is applied. That is the numbering the
 * repair hints must speak.
 */

'use strict';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isBinaryBlock(lines, i) {
  // "Binary files a/x and b/y differ" or "GIT binary patch"
  return /^Binary files /.test(lines[i]) || /^GIT binary patch/.test(lines[i]);
}

/**
 * Parse one file's diff body starting at the index of its first header line
 * ("--- "). Returns { file, next } where next is the index of the next
 * "diff --git" (or lines.length).
 */
function parseFileDiff(lines, start, diffGitPath) {
  let i = start;
  const file = {
    path: diffGitPath || null,
    oldPath: null,
    kind: 'modify',
    addedLines: [],
    removedCount: 0,
    hunks: [],
  };
  let rejected = null;

  // Header lines until the first hunk.
  while (i < lines.length && !HUNK_RE.test(lines[i])) {
    const l = lines[i];
    if (/^diff --git /.test(l)) break; // no hunks for this file (mode-only)
    if (isBinaryBlock(lines, i)) { rejected = 'binary patch'; i++; continue; }
    if (l.startsWith('--- ')) {
      const p = l.slice(4).trim();
      if (p === '/dev/null') file.kind = 'add';
      else file.oldPath = stripAB(p);
    } else if (l.startsWith('+++ ')) {
      const p = l.slice(4).trim();
      if (p === '/dev/null') { file.kind = 'delete'; }
      else file.path = stripAB(p);
    } else if (l.startsWith('new file mode')) {
      file.kind = 'add';
    } else if (l.startsWith('deleted file mode')) {
      file.kind = 'delete';
    } else if (l.startsWith('rename from ')) {
      file.kind = 'rename';
      file.oldPath = l.slice('rename from '.length).trim();
    } else if (l.startsWith('rename to ')) {
      file.kind = 'rename';
      file.path = l.slice('rename to '.length).trim();
    }
    i++;
  }

  // Hunks.
  while (i < lines.length) {
    const m = HUNK_RE.exec(lines[i]);
    if (!m) {
      if (/^diff --git /.test(lines[i])) break;
      if (/^--- /.test(lines[i]) && i + 1 < lines.length && /^\+\+\+ /.test(lines[i + 1])) break;
      // Tolerate trailing context lines / "\ No newline at end of file".
      if (/^\\ No newline/.test(lines[i])) { i++; continue; }
      // Unknown content outside a hunk: stop this file conservatively.
      break;
    }
    const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    const newStart = parseInt(m[3], 10);
    const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
    const hunk = { newStart, added: [], removed: 0 };
    let newLine = newStart;
    let seenOld = 0, seenNew = 0;
    i++;
    // A hunk body is exactly (oldCount removals+context) and (newCount
    // additions+context) lines. Counting declared lines — not guessing from
    // prefixes — is what keeps numbering honest when a context line happens
    // to start with '-' or '+'.
    while (i < lines.length && (seenOld < oldCount || seenNew < newCount)) {
      const l = lines[i];
      if (l.startsWith('+')) {
        hunk.added.push(newLine);
        file.addedLines.push(newLine);
        newLine++; seenNew++;
        i++;
      } else if (l.startsWith('-')) {
        hunk.removed++;
        file.removedCount++;
        seenOld++;
        i++;
      } else if (/^\\ No newline/.test(l)) {
        i++;
      } else {
        // context (' '-prefixed, or the empty-string edge case)
        newLine++; seenOld++; seenNew++;
        i++;
      }
    }
    file.hunks.push(hunk);
  }

  return { file, rejected, next: i };
}

function stripAB(p) {
  // "a/src/x.ts" / "b/src/x.ts" / quoted paths
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.replace(/^[ab]\//, '');
}

/** Route a parsed file body to files[] or rejected[] — never silently drop. */
function classify(file, rej, files, rejected) {
  const target = file.path || file.oldPath || '(unknown)';
  if (rej) { rejected.push({ path: target, reason: rej }); return; }
  if (file.kind === 'delete') { rejected.push({ path: file.oldPath || target, reason: 'file deleted — nothing to mutate' }); return; }
  if (!file.path) { rejected.push({ path: target, reason: 'no target path (+++ line missing)' }); return; }
  if (file.addedLines.length === 0) { rejected.push({ path: file.path, reason: 'no added lines in diff' }); return; }
  files.push(file);
}

/**
 * Parse a unified diff (git format). Accepts output of `git diff`,
 * `git diff --cached`, `git show`, or a bare patch without "diff --git"
 * headers (starts directly at "--- a/x").
 */
function parseDiff(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { files: [], rejected: [], stats: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 }, error: 'empty diff' };
  }
  const lines = text.split(/\r?\n/);
  const files = [];
  const rejected = [];

  // Commit-headers from `git show` / `git format-patch` (commit ..., Author:,
  // Date:, message lines) are skipped implicitly: we only start a file at a
  // "diff --git" line or a "--- a/" +++ pair.
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const dm = /^diff --git a\/(.+?) b\/(.+)$/.exec(l);
    if (dm) {
      // Delegate the whole file body. Binary and rename-only files may carry
      // no ---/+++ pair at all, so scanning for that pair would miss them.
      const { file, rejected: rej, next } = parseFileDiff(lines, i + 1, dm[2]);
      classify(file, rej, files, rejected);
      i = Math.max(next, i + 1);
      continue;
    }
    if (/^--- /.test(l) && i + 1 < lines.length && /^\+\+\+ /.test(lines[i + 1])) {
      // Bare patch without a "diff --git" header.
      const { file, rejected: rej, next } = parseFileDiff(lines, i, null);
      classify(file, rej, files, rejected);
      i = Math.max(next, i + 1);
      continue;
    }
    i++;
  }

  const linesAdded = files.reduce((n, f) => n + f.addedLines.length, 0);
  const linesRemoved = files.reduce((n, f) => n + f.removedCount, 0);
  return {
    files,
    rejected,
    stats: { filesChanged: files.length, linesAdded, linesRemoved },
  };
}

/**
 * Filter parsed files to mutation-eligible source paths.
 * Eligible = under one of includePrefixes (default: any non-test source
 * extension we can mutate with confidence). Test files, fixtures, docs,
 * and config are excluded from mutation targeting (they may still be the
 * diff's *subject* — e.g. the agent edited only tests — in which case the
 * caller reports 'skipped' honestly).
 */
const MUTABLE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec|fixtures?)\/|\.(test|spec)\.[tj]sx?$|\.(test|spec)\.py$|^test_.*\.py$/;

function mutableFiles(parsed, opts) {
  const exts = (opts && opts.extensions) ? new Set(opts.extensions) : MUTABLE_EXT;
  const out = [];
  const skipped = [];
  for (const f of parsed.files) {
    const p = f.path.split('\\').join('/');
    const dot = p.lastIndexOf('.');
    const ext = dot >= 0 ? p.slice(dot) : '';
    if (!exts.has(ext)) { skipped.push({ path: f.path, reason: `extension '${ext || '(none)'}' not mutable` }); continue; }
    if (TEST_PATH_RE.test(p)) { skipped.push({ path: f.path, reason: 'test/fixture file — not a mutation target' }); continue; }
    out.push(f);
  }
  return { mutable: out, skipped };
}

module.exports = { parseDiff, mutableFiles, MUTABLE_EXT };
