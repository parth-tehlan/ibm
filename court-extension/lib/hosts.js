#!/usr/bin/env node
/**
 * lib/hosts.js — TRIUMPH setup orchestrator: per-host writers.
 *
 * Materializes the court subagent prompts + MCP wiring into the recognized
 * location of every agent host the user might be in. Written once, adapted
 * per host. Path-1 by construction: we only ever write *files*; each host's
 * own model executes the subagents.
 *
 * Supported hosts:
 *   claude  → .claude/agents/<name>.md            + .mcp.json
 *   bob     → .bob/agents/<name>.md (rules-ready) + .bob/mcp.json
 *   codex   → .codex/agents/<name>.md             + .codex/config.json (mcp_servers)
 *   vscode  → .vscode/mcp.json (+ chatmode briefs) — chat participants need the
 *             extension host, so the extension registers the MCP server itself.
 *   generic → .triumph/agents/*.md                + .triumph/mcp.json
 *
 * Merges, never clobbers: existing MCP servers / agents are preserved.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const AGENTS = ['spec-witness', 'test-author', 'mutant-analyst', 'war-room'];
const ENGINE_TOOL_NAMES = [
  'redline_clauses', 'redline_verdict_all', 'redline_clause',
  'splitbrain_trustgap', 'splitbrain_mutants', 'splitbrain_mutate', 'splitbrain_status',
  'warpath_context', 'warpath_triage', 'warpath_postmortem',
  'courts_about',
];

/** Absolute path of the extension directory (one level up from lib/). */
const EXT_DIR = path.resolve(__dirname, '..');
const ENGINE_ENTRY = path.join(EXT_DIR, 'court.js');

function readJsonSafe(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}
function writeJsonMerged(fp, merge) {
  const existing = readJsonSafe(fp) || {};
  const merged = merge(existing);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}
function engineMcpEntry(repoRoot) {
  return {
    command: 'node',
    args: [ENGINE_ENTRY, '--repo', repoRoot],
    alwaysAllow: ENGINE_TOOL_NAMES,
    disabled: false,
  };
}
function copyAgents(destDir, transform) {
  fs.mkdirSync(destDir, { recursive: true });
  const written = [];
  for (const name of AGENTS) {
    const src = path.join(EXT_DIR, 'agents', name + '.md');
    let body = fs.readFileSync(src, 'utf8');
    if (transform) body = transform(body, name);
    const dest = path.join(destDir, name + '.md');
    fs.writeFileSync(dest, body, 'utf8');
    written.push(dest);
  }
  return written;
}

/** Recursively copy a directory tree, returning every written file. */
function copyTree(srcDir, destDir) {
  const written = [];
  if (!fs.existsSync(srcDir)) return written;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      written.push(...copyTree(s, d));
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      written.push(d);
    }
  }
  return written;
}

const HOSTS = {
  claude: {
    name: 'Claude Code',
    install(repoRoot) {
      const agents = copyAgents(path.join(repoRoot, '.claude', 'agents'));
      writeJsonMerged(path.join(repoRoot, '.mcp.json'), (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers['triumph-courts'] = engineMcpEntry(repoRoot);
        return j;
      });
      return { files: [...agents, path.join(repoRoot, '.mcp.json')] };
    },
  },

  bob: {
    name: 'IBM Bob',
    install(repoRoot) {
      const bobDir = path.join(repoRoot, '.bob');
      // Subagent prompts (the four court personas).
      const agents = copyAgents(path.join(bobDir, 'agents'));
      // Skills, rule packs, and custom modes — the full Bob-native structure.
      const skills = copyTree(path.join(EXT_DIR, 'agents', 'skills'), path.join(bobDir, 'skills'));
      const rules = copyTree(path.join(EXT_DIR, 'agents', 'bob'), bobDir); // rules-*/ + custom_modes.yaml land at .bob/
      const files = [...agents, ...skills, ...rules];
      writeJsonMerged(path.join(bobDir, 'mcp.json'), (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers['triumph-courts'] = engineMcpEntry(repoRoot);
        return j;
      });
      files.push(path.join(bobDir, 'mcp.json'));
      return { files };
    },
  },

  codex: {
    name: 'OpenAI Codex',
    install(repoRoot) {
      const agents = copyAgents(path.join(repoRoot, '.codex', 'agents'));
      writeJsonMerged(path.join(repoRoot, '.codex', 'config.json'), (j) => {
        j.mcp_servers = j.mcp_servers || {};
        j.mcp_servers['triumph-courts'] = {
          command: 'node',
          args: [ENGINE_ENTRY, '--repo', repoRoot],
        };
        return j;
      });
      return { files: [...agents, path.join(repoRoot, '.codex', 'config.json')] };
    },
  },

  vscode: {
    name: 'VS Code Chat',
    install(repoRoot) {
      // mcp.json wires the engine for Copilot agent mode / MCP-aware chat.
      writeJsonMerged(path.join(repoRoot, '.vscode', 'mcp.json'), (j) => {
        j.servers = j.servers || {};
        j.servers['triumph-courts'] = {
          type: 'stdio',
          command: 'node',
          args: [ENGINE_ENTRY, '--repo', repoRoot],
        };
        return j;
      });
      // Chatmode briefs let Copilot Chat adopt a court persona (>= VS Code 1.101).
      const chatDir = path.join(repoRoot, '.github', 'chatmodes');
      fs.mkdirSync(chatDir, { recursive: true });
      const files = [path.join(repoRoot, '.vscode', 'mcp.json')];
      for (const name of AGENTS) {
        const body = fs.readFileSync(path.join(EXT_DIR, 'agents', name + '.md'), 'utf8')
          .replace(/^name:/m, 'description:').replace(/^description:.*$/m, (m) => m); // keep description
        const dest = path.join(chatDir, `triumph-${name}.chatmode.md`);
        fs.writeFileSync(dest, body, 'utf8');
        files.push(dest);
      }
      return { files };
    },
  },

  generic: {
    name: 'Generic MCP host',
    install(repoRoot) {
      const agents = copyAgents(path.join(repoRoot, '.triumph', 'agents'));
      writeJsonMerged(path.join(repoRoot, '.triumph', 'mcp.json'), (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers['triumph-courts'] = engineMcpEntry(repoRoot);
        return j;
      });
      return { files: [...agents, path.join(repoRoot, '.triumph', 'mcp.json')] };
    },
  },
};

function installHost(hostId, repoRoot) {
  const host = HOSTS[hostId];
  if (!host) throw new Error('unknown host ' + hostId + ' (known: ' + Object.keys(HOSTS).join(', ') + ')');
  return { host: hostId, hostName: host.name, ...host.install(path.resolve(repoRoot)) };
}

module.exports = { HOSTS, installHost, AGENTS, ENGINE_TOOL_NAMES, ENGINE_ENTRY, EXT_DIR };
