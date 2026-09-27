'use strict';
/**
 * lib/mutation-progress.js — shared mutation-runner progress line parser.
 *
 * Used by both court.js (streaming spawn hook) and src/dashboard.js
 * (McpClient stderr relay). Kept in lib/ so neither file needs to
 * depend on the other.
 *
 * parseMutationLine(line) → event object | null
 *
 * Handles Stryker v6/v7 progress output and a generic "X/Y" pattern.
 * Returns null for lines that carry no recognisable progress signal.
 */

/**
 * Parse a single line of mutation-runner stdout/stderr.
 *
 * Matched patterns:
 *   Stryker v6: "Tested 42 mutants, 30 killed (71%), 12 survived."
 *   Stryker v7: progress bar "42/100 Mutants" or "[====] 42/100"
 *   Stryker v7: summary "Killed: 30" / "Survived: 12" etc.
 *   Generic:    "progress: 42/100" or "mutant 42/100"
 *
 * @param {string} line
 * @returns {{ tested?, total?, killed?, survived?, killRate?, verdict?, line } | null}
 */
function parseMutationLine(line) {
  // Stryker v6: "Tested N mutants, K killed (P%), S survived"
  let m = /Tested\s+(\d+)\s+mutants?,\s*(\d+)\s+killed[^,]*,\s*(\d+)\s+survived/i.exec(line);
  if (m) {
    const tested = parseInt(m[1], 10);
    const killed = parseInt(m[2], 10);
    const survived = parseInt(m[3], 10);
    const killRate = tested > 0 ? Math.round((killed / tested) * 100) : 0;
    return { tested, killed, survived, killRate, total: null, line: line.trim() };
  }
  // Stryker v7: progress bar "42/100 Mutants"
  m = /(\d+)\/(\d+)\s*Mutant/i.exec(line);
  if (m) {
    const tested = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    return { tested, total, killed: null, survived: null, killRate: null, line: line.trim() };
  }
  // Stryker v7 summary lines during run: "Killed: N", "Survived: N", etc.
  m = /^(?:Killed|Survived|Timed out|No coverage):\s*(\d+)/i.exec(line.trim());
  if (m) return { verdict: line.trim(), line: line.trim() };
  // Generic: "progress: N/M" or "mutant N/M"
  m = /(?:progress|mutant)[:\s]+(\d+)\/(\d+)/i.exec(line);
  if (m) {
    return { tested: parseInt(m[1], 10), total: parseInt(m[2], 10), killed: null, survived: null, killRate: null, line: line.trim() };
  }
  return null;
}

module.exports = { parseMutationLine };
