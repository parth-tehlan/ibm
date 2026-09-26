#!/usr/bin/env node
// scripts/mttr.mjs — manual MTTR (mean time to repair) measurement.
//
// Replaces the old `.bob/hooks/stop-write-metrics.sh` "Stop hook" mechanism,
// which never ran because the IDE (IBM Bob) has no hook system. Same file
// formats as before: incident/.start_epoch holds a plain Unix-epoch-seconds
// integer, incident/metrics.json holds { mttrSeconds, measuredAt, note }.
//
// Usage:
//   node scripts/mttr.mjs start [--force]   start the incident clock
//   node scripts/mttr.mjs status            show elapsed time so far
//   node scripts/mttr.mjs stop              stop the clock, write metrics.json

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // northstar/
const INCIDENT_DIR = join(ROOT, "incident");
const START_FILE = join(INCIDENT_DIR, ".start_epoch");
const METRICS_FILE = join(INCIDENT_DIR, "metrics.json");

const nowEpoch = () => Math.floor(Date.now() / 1000);
const isoFromEpoch = (epochSeconds) =>
  new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

function readStart() {
  if (!existsSync(START_FILE)) return null;
  const raw = readFileSync(START_FILE, "utf8").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function cmdStart(force) {
  const existing = readStart();
  if (existing !== null && !force) {
    console.error(
      `Incident already in progress (started at epoch ${existing}, ${isoFromEpoch(existing)}). ` +
        `Run "stop" to close it first, or pass --force to overwrite the start time.`
    );
    process.exit(1);
  }
  const epoch = nowEpoch();
  writeFileSync(START_FILE, `${epoch}\n`, "utf8");
  console.log(`Incident clock started at epoch ${epoch} (${isoFromEpoch(epoch)}).`);
}

function cmdStatus() {
  const start = readStart();
  if (start === null) {
    console.log("no incident in progress");
    return;
  }
  const elapsed = nowEpoch() - start;
  console.log(
    `Incident in progress: started at epoch ${start} (${isoFromEpoch(start)}), elapsed ${elapsed}s.`
  );
}

function cmdStop() {
  const start = readStart();
  if (start === null) {
    console.error(
      'No incident in progress: incident/.start_epoch not found. Run "node scripts/mttr.mjs start" first.'
    );
    process.exit(1);
  }
  const stop = nowEpoch();
  const elapsed = stop - start;
  const metrics = {
    mttrSeconds: elapsed,
    measuredAt: isoFromEpoch(stop),
    startedAt: isoFromEpoch(start),
    note: "measured by scripts/mttr.mjs",
  };
  writeFileSync(METRICS_FILE, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  rmSync(START_FILE, { force: true });
  console.log(
    `MTTR = ${elapsed}s (started ${metrics.startedAt}, stopped ${metrics.measuredAt}). Wrote ${METRICS_FILE}.`
  );
}

const [, , cmd, ...rest] = process.argv;
const force = rest.includes("--force");

switch (cmd) {
  case "start":
    cmdStart(force);
    break;
  case "status":
    cmdStatus();
    break;
  case "stop":
    cmdStop();
    break;
  default:
    console.error("Usage: node scripts/mttr.mjs <start|status|stop> [--force]");
    process.exit(1);
}
