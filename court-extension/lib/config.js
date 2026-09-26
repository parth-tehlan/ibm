#!/usr/bin/env node
/**
 * lib/config.js — TRIUMPH repo-adapter config loader.
 *
 * Reads `.triumph.yml` (or .yaml / .json) from the target repo root and
 * returns a fully-resolved, default-filled, validated config object. The
 * engine (court.js) is driven *entirely* by this object — no path or stack
 * is ever assumed.
 *
 * Dependency policy: zero npm deps. The YAML subset parser below handles the
 * full `.triumph.yml` schema (nested maps, lists of scalars, lists of maps,
 * inline [a, b] and {k: v}, quoted strings, comments, booleans, numbers,
 * null). JSON configs parse via JSON.parse.
 *
 * Precedence: TRIUMPH_CONFIG env path > .triumph.yml > .triumph.yaml >
 * .triumph.json. Environment variables TRIUMPH_* still override individual
 * paths (escape hatch, honored after load).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser
// ---------------------------------------------------------------------------
function parseScalar(raw) {
  let s = raw.trim();
  if (s === '') return '';
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitInline(inner).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (!inner) return obj;
    for (const part of splitInline(inner)) {
      const idx = part.indexOf(':');
      obj[unquote(part.slice(0, idx).trim())] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return unquote(s);
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

// Split an inline flow sequence "a, b, c" respecting quotes and nesting.
function splitInline(inner) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * Parse a YAML-subset document. Supports block maps, block sequences of
 * scalars or maps, and flow scalars. Throws with line numbers on anything
 * outside the subset so users get an actionable error.
 */
function parseYamlSubset(text) {
  const lines = text.split(/\r?\n/);
  // Tokenize into {indent, content, lineNo}
  const toks = [];
  for (let i = 0; i < lines.length; i++) {
    const noComment = stripComment(lines[i]);
    if (noComment.trim() === '') continue;
    if (/^---\s*$/.test(noComment.trim())) continue;
    const indent = /^ */.exec(noComment)[0].length;
    if (/\t/.test(noComment.slice(0, indent))) {
      throw new Error(`.triumph.yml line ${i + 1}: tabs are not valid indentation`);
    }
    toks.push({ indent, content: noComment.trim(), lineNo: i + 1 });
  }
  let pos = 0;

  function parseBlock(indent) {
    // Decide map vs list from first token.
    if (pos >= toks.length) return null;
    if (toks[pos].content.startsWith('- ') || toks[pos].content === '-') {
      return parseList(indent);
    }
    return parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.indent < indent) break;
      if (t.indent > indent) {
        throw new Error(`.triumph.yml line ${t.lineNo}: unexpected indent (expected ${indent})`);
      }
      if (t.content.startsWith('- ')) break; // caller's list item
      const m = /^([^:]+):(?:\s+(.*))?$/.exec(t.content);
      if (!m) throw new Error(`.triumph.yml line ${t.lineNo}: expected "key: value"`);
      const key = unquote(m[1].trim());
      const rest = m[2];
      pos++;
      if (rest !== undefined && rest !== '') {
        obj[key] = parseScalar(rest);
      } else {
        // nested block or null
        if (pos < toks.length && toks[pos].indent > t.indent) {
          obj[key] = parseBlock(toks[pos].indent);
        } else if (pos < toks.length && toks[pos].indent === t.indent &&
                   (toks[pos].content.startsWith('- ') || toks[pos].content === '-')) {
          obj[key] = parseList(t.indent);
        } else {
          obj[key] = null;
        }
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.indent < indent) break;
      if (!(t.content.startsWith('- ') || t.content === '-')) break;
      if (t.indent > indent) {
        throw new Error(`.triumph.yml line ${t.lineNo}: unexpected indent in list`);
      }
      const itemText = t.content === '-' ? '' : t.content.slice(2).trim();
      pos++;
      if (itemText === '') {
        // nested block belongs to this item
        if (pos < toks.length && toks[pos].indent > t.indent) {
          arr.push(parseBlock(toks[pos].indent));
        } else {
          arr.push(null);
        }
      } else if (/^[^:]+:\s*/.test(itemText) && !itemText.startsWith('"') && !itemText.startsWith("'")) {
        // map item: first key on the dash line, rest on following deeper lines
        const obj = {};
        const m = /^([^:]+):(?:\s+(.*))?$/.exec(itemText);
        const key = unquote(m[1].trim());
        const rest = m[2];
        if (rest !== undefined && rest !== '') {
          obj[key] = parseScalar(rest);
        } else if (pos < toks.length && toks[pos].indent > t.indent) {
          obj[key] = parseBlock(toks[pos].indent);
        } else {
          obj[key] = null;
        }
        // consume additional keys of the same map item (indent > dash indent)
        if (pos < toks.length && toks[pos].indent > t.indent) {
          const subIndent = toks[pos].indent;
          const sub = parseMap(subIndent);
          Object.assign(obj, sub);
        }
        arr.push(obj);
      } else {
        arr.push(parseScalar(itemText));
      }
    }
    return arr;
  }

  if (toks.length === 0) return {};
  const result = parseBlock(toks[0].indent);
  if (pos < toks.length) {
    throw new Error(`.triumph.yml line ${toks[pos].lineNo}: could not parse (trailing content)`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Defaults + validation
// ---------------------------------------------------------------------------
const DEFAULTS = {
  version: 1,
  repo: { name: null },
  spec: { path: 'docs/api-spec.md', clausePattern: '^## (W\\d+)', clauseIdPattern: '^W\\d+$' },
  tests: {
    framework: 'jest',
    dir: 'tests',
    clauseTestPattern: 'clause-{{clause}}.test.ts',
    runAll: null,
    runClause: null,
  },
  mutation: {
    tool: 'stryker',
    report: 'reports/mutation/mutation.json',
    claimedCoverageFrom: null,
    command: null,
    timeoutSeconds: 900,
    strykerJestConfig: null, // optional: stryker-specific jest config for test-name resolution
  },
  fixtures: {
    deploys: 'fixtures/deploy.json',
    metrics: 'fixtures/metrics.json',
    logs: 'fixtures/logs.json',
    mutants: 'fixtures/mutants.json',
  },
  evidence: {
    dir: 'evidence',
    trustgap: 'trustgap/TrustGap.json',
    incidentDir: 'incident',
    reportsDir: 'reports/triumph',
  },
  wall: { denyGlobs: ['src/**'] },
  rules: { runbook: null }, // optional: cited in WARPATH triage output
  waivers: 'evidence/waivers.json',
};

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base;
  if (typeof base === 'object' && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;
}

function globToRegExp(glob) {
  // Supports **, *, ? — enough for wall denyGlobs.
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // '**/' matches zero or more path segments; trailing '**' matches all
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp('^' + re + '$');
}

const ALLOWED_TEST_FRAMEWORKS = ['jest', 'pytest', 'vitest', 'mocha', 'custom'];
const ALLOWED_MUTATION_TOOLS = ['stryker', 'mutmut', 'custom'];

function validate(cfg, repoRoot) {
  const errors = [];
  if (!ALLOWED_TEST_FRAMEWORKS.includes(cfg.tests.framework)) {
    errors.push(`tests.framework must be one of ${ALLOWED_TEST_FRAMEWORKS.join(', ')} (got ${cfg.tests.framework})`);
  }
  if (!ALLOWED_MUTATION_TOOLS.includes(cfg.mutation.tool)) {
    errors.push(`mutation.tool must be one of ${ALLOWED_MUTATION_TOOLS.join(', ')} (got ${cfg.mutation.tool})`);
  }
  if (!cfg.spec.clauseIdPattern) errors.push('spec.clauseIdPattern is required');
  if (cfg.wall.denyGlobs.some((g) => !globToRegExp(g).source)) errors.push('wall.denyGlobs contains an unparseable glob');
  if (!cfg.tests.clauseTestPattern.includes('{{clause}}')) {
    errors.push('tests.clauseTestPattern must contain {{clause}}');
  }
  if (cfg.version !== 1) errors.push(`version must be 1 (got ${cfg.version})`);
  try { new RegExp(cfg.spec.clausePattern); } catch (e) { errors.push(`spec.clausePattern is not a valid regex: ${e.message}`); }
  try { new RegExp(cfg.spec.clauseIdPattern); } catch (e) { errors.push(`spec.clauseIdPattern is not a valid regex: ${e.message}`); }
  if (!fs.existsSync(path.join(repoRoot, cfg.spec.path))) {
    errors.push(`spec.path '${cfg.spec.path}' does not exist under ${repoRoot}`);
  }
  // The wall must not swallow the spec or the tests dir — that would make
  // REDLINE impossible and silently defeat the method.
  for (const re of cfg.wall.denyGlobs.map(globToRegExp)) {
    if (re.test(cfg.tests.dir.replace(/\\/g, '/') + '/') || re.test(cfg.tests.dir.replace(/\\/g, '/'))) {
      errors.push(`wall.denyGlobs must not match the tests dir '${cfg.tests.dir}' — the wall guards implementation, not the witness suites`);
    }
    if (re.test(cfg.spec.path.replace(/\\/g, '/'))) {
      errors.push(`wall.denyGlobs must not match spec.path '${cfg.spec.path}' — the spec is the law`);
    }
  }
  if (errors.length) {
    const err = new Error('invalid .triumph.yml:\n  - ' + errors.join('\n  - '));
    err.validationErrors = errors;
    throw err;
  }
}

/** Resolve every path in the config to absolute, anchored at repoRoot. */
function resolvePaths(cfg, repoRoot) {
  const r = (p) => (p ? path.resolve(repoRoot, p) : null);
  return {
    ...cfg,
    repoRoot,
    spec: { ...cfg.spec, absPath: r(cfg.spec.path) },
    tests: { ...cfg.tests, absDir: r(cfg.tests.dir) },
    mutation: {
      ...cfg.mutation,
      absReport: cfg.mutation.report ? r(cfg.mutation.report) : null,
      absClaimedCoverageFrom: r(cfg.mutation.claimedCoverageFrom),
      absStrykerJestConfig: r(cfg.mutation.strykerJestConfig),
    },
    fixtures: {
      deploys: r(cfg.fixtures.deploys),
      metrics: r(cfg.fixtures.metrics),
      logs: r(cfg.fixtures.logs),
      mutants: r(cfg.fixtures.mutants),
    },
    rules: { runbook: r(cfg.rules && cfg.rules.runbook) },
    evidence: {
      dir: r(cfg.evidence.dir),
      trustgap: r(cfg.evidence.trustgap),
      incidentDir: r(cfg.evidence.incidentDir),
      reportsDir: r(cfg.evidence.reportsDir),
    },
    waivers: r(cfg.waivers),
    wall: {
      denyGlobs: cfg.wall.denyGlobs,
      denyRegexes: cfg.wall.denyGlobs.map((g) => globToRegExp(g)),
    },
  };
}

/** Find and load the config for a repo. Returns null when no file exists. */
function findConfigFile(repoRoot) {
  if (process.env.TRIUMPH_CONFIG) {
    const p = path.resolve(process.env.TRIUMPH_CONFIG);
    if (!fs.existsSync(p)) throw new Error(`TRIUMPH_CONFIG points at missing file ${p}`);
    return p;
  }
  for (const name of ['.triumph.yml', '.triumph.yaml', '.triumph.json']) {
    const p = path.join(repoRoot, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadConfig(repoRoot) {
  const root = path.resolve(repoRoot || process.env.TRIUMPH_REPO_ROOT || process.cwd());
  const file = findConfigFile(root);
  let raw = {};
  let source = 'defaults';
  if (file) {
    const text = fs.readFileSync(file, 'utf8');
    raw = file.endsWith('.json') ? JSON.parse(text) : parseYamlSubset(text);
    source = path.relative(root, file);
  }
  const merged = deepMerge(DEFAULTS, raw || {});
  const resolved = resolvePaths(merged, root);
  validate(resolved, root);

  // Escape-hatch env overrides (optional, applied last).
  if (process.env.TRIUMPH_SPEC) resolved.spec.absPath = path.resolve(process.env.TRIUMPH_SPEC);
  if (process.env.TRIUMPH_TRUSTGAP) resolved.evidence.trustgap = path.resolve(process.env.TRIUMPH_TRUSTGAP);

  resolved.configSource = source;
  return resolved;
}

/** Render a clause test path template. */
function clauseTestFile(cfg, clauseId) {
  return path.join(cfg.tests.absDir, cfg.tests.clauseTestPattern.replace('{{clause}}', clauseId));
}

module.exports = {
  loadConfig,
  parseYamlSubset,
  globToRegExp,
  clauseTestFile,
  DEFAULTS,
  findConfigFile,
};
