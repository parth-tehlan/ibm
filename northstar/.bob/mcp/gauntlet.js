#!/usr/bin/env node
// gauntlet.js - MCP server for GAIA (STDIO transport, JSON-RPC 2.0).
// Serves real local fixture and evidence data only. Fully offline. No internet.
//
// Every tool reads real state from fixtures/ and evidence/. No tool returns a
// canned or mock payload. If a source file is missing or unreadable, the tool
// returns a real error.
//
// Protocol (per bob.ibm.com/docs/ide MCP docs):
//   - reads JSON-RPC 2.0 requests newline-delimited on stdin
//   - writes responses newline-delimited on stdout
//   - initializes with the MCP handshake, then serves tools via
//     tools/list and tools/call

const readline = require("readline");
const fs = require("fs");
const path = require("path");

const SERVER_INFO = { name: "gauntlet-signals", version: "0.2.0" };

// Resolve project root as the directory two levels above this file
// (.bob/mcp/gauntlet.js -> northstar/)
const ROOT = path.resolve(__dirname, "..", "..");

function readJson(rel) {
  const full = path.join(ROOT, rel);
  const raw = fs.readFileSync(full, "utf8");
  return JSON.parse(raw);
}

// Tool definitions
const TOOLS = [
  { name: "list_clauses", description: "List spec clauses from evidence/clauses.json" },
  { name: "get_test_status", description: "Get status for a clause id" },
  { name: "submit_waiver", description: "File a waiver for a clause" },
  { name: "get_trust_gap", description: "Read TrustGap.json" },
  { name: "get_logs", description: "Return the log window fixture" },
  { name: "get_metrics", description: "Return metrics fixture" },
  { name: "get_recent_deploys", description: "Return deploy history fixture" },
  { name: "get_mutants", description: "Return the Stryker mutation fixture" },
];

function handleToolCall(tool, args) {
  switch (tool) {
    case "list_clauses": {
      const data = readJson("evidence/clauses.json");
      return { clauses: data.clauses || [] };
    }
    case "get_test_status": {
      const data = readJson("evidence/clauses.json");
      const clauseId = args && args.clause_id;
      const clause = (data.clauses || []).find((c) => c.id === clauseId);
      if (!clause) {
        throw new Error(`unknown clause id: ${clauseId}`);
      }
      return {
        clauseId: clause.id,
        title: clause.title,
        level: clause.level,
        status: clause.summary ? "covered" : "unknown",
      };
    }
    case "submit_waiver": {
      const full = path.join(ROOT, "evidence", "waivers.json");
      const current = JSON.parse(fs.readFileSync(full, "utf8"));
      const waiverId = (args && args.waiver_id) || null;
      if (!waiverId) {
        throw new Error("waiver_id is required");
      }
      const key = String(Date.now());
      current[key] = { waiver_id: waiverId };
      fs.writeFileSync(full, JSON.stringify(current, null, 2) + "\n", "utf8");
      return { ok: true, waiver_id: waiverId };
    }
    case "get_trust_gap": {
      const data = readJson("trustgap/TrustGap.json");
      return {
        schemaVersion: data.schemaVersion,
        dishonestTests: data.dishonestTests || [],
        honestMutationScore: data.honestMutationScore,
        claimedCoverage: data.claimedCoverage,
        trustGap: data.trustGap,
      };
    }
    case "get_logs": {
      const data = readJson("fixtures/logs.json");
      return { logs: data.log || [] };
    }
    case "get_metrics": {
      const data = readJson("fixtures/metrics.json");
      return { metrics: data.metrics || {} };
    }
    case "get_recent_deploys": {
      const data = readJson("fixtures/deploy.json");
      return { deploys: data.deploys || [] };
    }
    case "get_mutants": {
      const data = readJson("fixtures/mutants.json");
      return { mutants: data.mutants || [] };
    }
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let initialized = false;

rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    console.error(`[gauntlet] bad JSON: ${line}`);
    return;
  }
  const id = req.id;
  let result;
  let isError = false;

  try {
    switch (req.method) {
      case "initialize":
        initialized = true;
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        };
        break;
      case "notifications/initialized":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const text = JSON.stringify(handleToolCall(req.params && req.params.name, req.params && req.params.arguments));
        result = { content: [{ type: "text", text }] };
        break;
      }
      case "ping":
        result = {};
        break;
      default:
        isError = true;
        result = { code: -32601, message: `unknown method ${req.method}` };
    }
  } catch (e) {
    // Return a real error so the caller can see the cause. Never a mock value.
    isError = true;
    result = { code: -32603, message: String(e) };
  }

  if (isError) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: result }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }
});

rl.on("close", () => process.exit(0));