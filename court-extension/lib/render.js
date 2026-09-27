#!/usr/bin/env node
/**
 * lib/render.js — Gaia report generator.
 *
 * One deterministic engine output in → two artifacts out:
 *   - Interactive HTML report: R/Y/G per clause, mutation gutters, postmortem
 *     timeline, click-to-jump vscode:// edit links. Zero-dependency,
 *     self-contained (inline CSS/JS), safe to open from the file system.
 *   - Agent-friendly Markdown report: clean, parseable, re-runnable.
 *
 * Model-free: rendered from tool JSON, never from model prose.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { summarizeCourt, formatMetric, clauseStatus } = require('./run-summary');

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
function renderMarkdown(input) {
  const L = [];
  const { repo, generated, witness, trustgap, triage } = input;
  L.push('# Gaia 3-Court Report');
  L.push('');
  L.push(`- **Repo:** \`${repo}\``);
  L.push(`- **Generated:** ${generated}`);
  L.push(`- **Manifesto:** Legal. Honest. Survivable.`);
  L.push('');

  if (witness) {
    const s = witness.summary || {};
    L.push(`## WITNESS — spec-witness`);
    L.push('');
    L.push(`Verdict: **${s.green ?? 0} green / ${s.red ?? 0} red / ${s.yellow ?? 0} yellow** of ${s.total ?? 0} clauses`);
    L.push('');
    L.push('| Clause | Verdict | Passed | Failed | Total | Spec |');
    L.push('|--------|---------|--------|--------|-------|------|');
    for (const r of witness.results || []) {
      const status = clauseStatus(r);
      const mark = status === 'green' ? '🟢' : status === 'red' ? '🔴' : '🟡';
      L.push(`| ${r.clause} | ${mark} ${status} | ${r.passed} | ${r.failed} | ${r.total} | ${r.spec_anchor || ''} |`);
    }
    L.push('');
    for (const r of (witness.results || []).filter((x) => (x.failures || []).length)) {
      L.push(`### ${r.clause} — failures`);
      for (const f of r.failures) {
        L.push(`- **${f.title}**`);
        if (f.message) L.push(`  \`\`\`\n  ${String(f.message).split('\n').slice(0, 4).join('\n  ')}\n  \`\`\``);
      }
      L.push('');
    }
  }

  if (trustgap) {
    L.push('## TRUSTGAP — honesty audit');
    L.push('');
    if (trustgap.status === 'not-run' || trustgap.status === 'unconfigured') {
      L.push(`_${trustgap.note || 'not run'}_`);
    } else {
      L.push(`- **Claimed coverage:** ${fmtPct(trustgap.claimedCoverage)}`);
      L.push(`- **Honest mutation score:** ${fmtPct(trustgap.honestMutationScore)}`);
      L.push(`- **Trust gap:** ${formatMetric(trustgap.trustGap, 'percentage_points')}`);
      const dt = trustgap.dishonestTests || [];
      L.push(`- **Dishonest tests (tautologies):** ${dt.length ? dt.length : 'none'}`);
      if (dt.length) {
        L.push('');
        for (const d of dt) {
          const name = d.testName || d.testId || d;
          L.push(`  - \`${name}\` tolerated mutants ${JSON.stringify(d.survivedMutants || [])}`);
        }
      }
      const survivors = (trustgap.mutants || trustgap.survivors || []).filter((m) => /survived/i.test(m.status || ''));
      if (survivors.length) {
        L.push('');
        L.push('| Surviving mutant | File:line | Replacement |');
        L.push('|------------------|-----------|-------------|');
        for (const m of survivors) {
          const loc = m.location ? `${m.file}:${m.location.line}` : (m.file || '');
          L.push(`| ${m.id} (${m.mutatorName || 'mutant'}) | ${loc} | \`${(m.replacement || '').replace(/\n/g, ' ').slice(0, 60)}\` |`);
        }
      }
      if (trustgap.summary) { L.push(''); L.push('> ' + trustgap.summary); }
    }
    L.push('');
  }

  if (triage) {
    L.push('## TRIAGE — incident forensics');
    L.push('');
    if (triage.status && triage.status.startsWith('no-')) {
      L.push(`_${triage.detail || triage.status}_`);
    } else {
      L.push(`- **Incident window:** ${triage.incidentWindow || '(none)'}`);
      if (triage.suspect) {
        const commit = triage.suspect.commit ? ` (${triage.suspect.commit})` : '';
        L.push(`- **Suspect deploy:** \`${triage.suspect.id}\`${commit} at ${triage.suspect.deployedAt} — ${triage.suspect.reason}`);
      }
      const b = triage.breakerSnapshot || {};
      if (b.state) L.push(`- **Breaker:** ${b.state} at consecutiveFailures=${b.consecutiveFailures} (openThreshold=${b.openThreshold})`);
      if ((triage.evidence || []).length) {
        L.push('');
        L.push('### Evidence timeline');
        for (const e of triage.evidence) L.push(`- \`${e.t}\` [${e.level}] ${e.msg}`);
      }
      if ((triage.clearedDeploys || []).length) {
        L.push('');
        L.push(`Cleared: ${triage.clearedDeploys.map((d) => `\`${d.id}\``).join(', ')}`);
      }
    }
    L.push('');
  }

  L.push('## Raw court evidence', '', '```json', JSON.stringify({ witness, trustgap, triage }, null, 2), '```', '');
  L.push('---');
  L.push('*Rendered deterministically from Gaia engine JSON. Re-run: collect witness_verdict_all / trustgap_report / triage_run and feed to the report generator.*');
  return L.join('\n');
}

function fmtPct(v) { return formatMetric(v, 'percent'); }

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtml(input) {
  const { repo, generated, witness, trustgap, triage } = input;
  const verdict = (st) => `<span class="pill ${st}">${st}</span>`;

  const clauseRows = (witness && witness.results || []).map((r, i) => `
    <tr class="clause-row ${clauseStatus(r)}" data-i="${i}">
      <td class="mono">${esc(r.clause)}</td>
      <td>${verdict(clauseStatus(r))}</td>
      <td>${r.passed}/${r.failed}/${r.total}</td>
      <td class="mono"><a href="vscode://file/${esc(input.repoRootAbs || '')}/${esc(r.test)}">${esc(r.test)}</a></td>
      <td class="mono">${esc(r.spec_anchor || '')}</td>
    </tr>
    ${(r.failures || []).length ? `<tr class="failures"><td colspan="5">${r.failures.map((f) => `<div class="failure"><b>${esc(f.title)}</b><pre>${esc(String(f.message || '').split('\n').slice(0, 5).join('\n'))}</pre></div>`).join('')}</td></tr>` : ''}
  `).join('');

  const survivorRows = (trustgap ? (trustgap.mutants || trustgap.survivors || []) : [])
    .filter((m) => /survived/i.test(m.status || ''))
    .map((m) => {
      const loc = m.location ? `${m.file}:${m.location.line}` : m.file || '';
      return `<tr><td class="mono">${esc(m.id)}</td><td>${esc(m.mutatorName || '')}</td>
        <td class="mono"><a href="vscode://file/${esc(input.repoRootAbs || '')}/${esc(m.file || '')}#${m.location ? m.location.line : 1}">${esc(loc)}</a></td>
        <td><pre>${esc((m.replacement || '').slice(0, 200))}</pre></td>
        <td class="mono small">${esc((m.coveredByNames || m.coveredBy || []).join(', '))}</td></tr>`;
    }).join('');

  const timeline = (triage && triage.evidence || []).map((e) =>
    `<li class="${e.level}"><span class="mono">${esc(e.t)}</span> <span class="lvl">${esc(e.level)}</span> ${esc(e.msg)}</li>`
  ).join('');

  const sbSummary = trustgap && trustgap.claimedCoverage != null ? `
    <div class="gauges">
      <div class="gauge"><div class="num">${esc(fmtPct(trustgap.claimedCoverage))}</div><div class="lbl">claimed coverage</div></div>
      <div class="gauge"><div class="num">${esc(fmtPct(trustgap.honestMutationScore))}</div><div class="lbl">honest kill-rate</div></div>
      <div class="gauge ${trustgap.trustGap != null && (trustgap.trustGap > 5 && trustgap.trustGap > 0.05) ? 'bad' : 'good'}"><div class="num">${esc(formatMetric(trustgap.trustGap, 'percentage_points'))}</div><div class="lbl">trust gap</div></div>
    </div>
    ${(trustgap.dishonestTests || []).length ? `<div class="dishonest"><b>Dishonest tests (tautologies):</b><ul>${trustgap.dishonestTests.map((d) => `<li><code>${esc(d.testName || d.testId || d)}</code> tolerated ${esc(JSON.stringify(d.survivedMutants || []))}</li>`).join('')}</ul></div>` : '<div class="honest">No tautologies found — every covered mutant was killed.</div>'}
  ` : `<p class="muted">${esc(trustgap && (trustgap.note || trustgap.status) || 'TRUSTGAP not run')}</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Gaia 3-Court Report — ${esc(repo)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --line:#30363d; --fg:#e6edf3; --muted:#8b949e;
          --green:#2ea043; --red:#f85149; --yellow:#d29922; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { padding:28px 36px 18px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
  h1 { margin:0 0 4px; font-size:22px }
  .sub { color:var(--muted); font-size:13px }
  nav { margin-top:10px } nav a { color:#58a6ff; margin-right:16px; text-decoration:none; font-size:13px }
  main { padding:24px 36px 60px; max-width:1100px }
  section { margin-bottom:44px }
  h2 { font-size:17px; border-bottom:1px solid var(--line); padding-bottom:6px }
  table { border-collapse:collapse; width:100%; margin-top:10px }
  td, th { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top }
  th { background:var(--panel); font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px }
  .small { font-size:11.5px }
  a { color:#58a6ff; text-decoration:none } a:hover { text-decoration:underline }
  .pill { display:inline-block; padding:1px 10px; border-radius:10px; font-size:12px; font-weight:600; text-transform:uppercase }
  .pill.green { background:rgba(46,160,67,.18); color:#3fb950; border:1px solid var(--green) }
  .pill.red { background:rgba(248,81,73,.15); color:#ff7b72; border:1px solid var(--red) }
  .pill.yellow { background:rgba(210,153,34,.15); color:#e3b341; border:1px solid var(--yellow) }
  tr.clause-row { cursor:pointer } tr.clause-row:hover { background:var(--panel) }
  tr.failures td { background:#1c1013 } .failure pre { white-space:pre-wrap; color:#ffa198; font-size:12px; margin:4px 0 8px }
  .gauges { display:flex; gap:16px; margin:14px 0 }
  .gauge { flex:0 0 180px; border:1px solid var(--line); border-radius:10px; padding:14px; background:var(--panel) }
  .gauge .num { font-size:26px; font-weight:700 } .gauge .lbl { color:var(--muted); font-size:12px }
  .gauge.bad .num { color:#ff7b72 } .gauge.good .num { color:#3fb950 }
  .dishonest { border:1px solid var(--red); border-radius:10px; padding:12px 16px; background:rgba(248,81,73,.08) }
  .honest { border:1px solid var(--green); border-radius:10px; padding:12px 16px; background:rgba(46,160,67,.08); color:#3fb950 }
  ul.timeline { list-style:none; padding:0 } ul.timeline li { border-left:3px solid var(--line); padding:6px 12px; margin:6px 0 }
  ul.timeline li.error { border-color:var(--red) } ul.timeline li.warn { border-color:var(--yellow) }
  .lvl { font-size:11px; text-transform:uppercase; color:var(--muted) }
  .muted { color:var(--muted) } pre { font-family:ui-monospace,Menlo,monospace; font-size:12px; white-space:pre-wrap; margin:0 }
</style></head>
<body>
<header>
  <h1>⚖️ Gaia 3-Court Report</h1>
  <div class="sub">${esc(repo)} · generated ${esc(generated)} · <b>Legal. Honest. Survivable.</b></div>
  <nav><a href="#witness">WITNESS</a><a href="#trustgap">TRUSTGAP</a><a href="#triage">TRIAGE</a></nav>
</header>
<main>
<section id="witness">
  <h2>WITNESS — spec-witness ${witness ? verdict(summaryStatus(witness.summary)) : ''}</h2>
  ${witness && witness.summary ? `<p class="sub">${witness.summary.green} green / ${witness.summary.red} red / ${witness.summary.yellow} yellow of ${witness.summary.total} clauses. Click a row to expand failures.</p>` : '<p class="muted">WITNESS not run.</p>'}
  ${clauseRows ? `<table><thead><tr><th>Clause</th><th>Verdict</th><th>Pass/Fail/Total</th><th>Test</th><th>Spec anchor</th></tr></thead><tbody>${clauseRows}</tbody></table>` : ''}
</section>
<section id="trustgap">
  <h2>TRUSTGAP — honesty audit</h2>
  ${sbSummary}
  ${survivorRows ? `<h3 style="margin-top:18px">Surviving mutants (gutter)</h3><table><thead><tr><th>ID</th><th>Mutator</th><th>Location</th><th>Replacement</th><th>Covered by</th></tr></thead><tbody>${survivorRows}</tbody></table>` : ''}
</section>
<section id="triage">
  <h2>TRIAGE — incident forensics</h2>
  ${triage && triage.suspect ? `
    <div class="gauges">
      <div class="gauge"><div class="num mono" style="font-size:18px">${esc(triage.suspect.id)}</div><div class="lbl">suspect deploy${triage.suspect.commit ? ' (' + esc(triage.suspect.commit) + ')' : ''}</div></div>
      <div class="gauge"><div class="num mono" style="font-size:13px;padding-top:8px">${esc(triage.incidentWindow)}</div><div class="lbl">incident window</div></div>
      <div class="gauge bad"><div class="num">${esc(triage.breakerSnapshot && triage.breakerSnapshot.state || '?')}</div><div class="lbl">breaker @ failures=${esc(triage.breakerSnapshot && triage.breakerSnapshot.consecutiveFailures)} / threshold=${esc(triage.breakerSnapshot && triage.breakerSnapshot.openThreshold)}</div></div>
    </div>
    <p class="sub">${esc(triage.suspect.reason)}. Cleared: ${(triage.clearedDeploys || []).map((d) => esc(d.id)).join(', ')}</p>
    <h3>Evidence timeline</h3><ul class="timeline">${timeline}</ul>
  ` : `<p class="muted">${esc(triage && (triage.detail || triage.status) || 'TRIAGE not run')}</p>`}
</section>
<details><summary>Raw court JSON · as reported</summary><pre>${esc(JSON.stringify({ witness, trustgap, triage }, null, 2))}</pre></details>
</main>
<script>
  document.querySelectorAll('tr.clause-row').forEach((row) => {
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('failures')) {
        next.style.display = next.style.display === 'none' ? '' : 'none';
      }
    });
    const next = row.nextElementSibling;
    if (next && next.classList.contains('failures')) next.style.display = 'none';
  });
</script>
</body></html>`;
}

function summaryStatus(s) {
  if (!s) return 'yellow';
  return s.red > 0 ? 'red' : (s.green === s.total && s.total > 0) ? 'green' : 'yellow';
}

/** Write both reports into outDir. Returns the two file paths. */
function writeReports(input, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const md = renderMarkdown(input);
  const html = renderHtml(input);
  const mdPath = path.join(outDir, 'gaia-report.md');
  const htmlPath = path.join(outDir, 'gaia-report.html');
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(htmlPath, html, 'utf8');
  return { mdPath, htmlPath };
}

module.exports = { renderMarkdown, renderHtml, writeReports };
