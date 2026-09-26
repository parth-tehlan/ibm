import { snapshotSchema } from './snapshot.js';

const COURTS = ['redline', 'splitbrain', 'warpath'];
const text = (value) => value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value) ?? '—';
const html = (value) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Escape Markdown syntax AND raw HTML (Markdown renderers commonly allow inline HTML).
// Flatten newlines so untrusted text cannot start a new heading, list, or fenced block.
const md = (value) => text(value).replace(/\r\n?|\n/g, ' / ').replace(/[\t\v\f]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1');
const list = (value) => Array.isArray(value) ? value : [];

// A stable, data-only document shared by the Markdown and HTML renderers.
export function evidence(snapshot) {
  snapshotSchema.parse(snapshot);
  const sections = COURTS.map((court) => {
    const entry = snapshot[court];
    const rows = [['State', entry.state], ['Collected at', entry.collectedAt], ['Source generated at', entry.sourceGeneratedAt], ...entry.errors.map((error) => ['Error', error])];
    const p = entry.payload;
    if (court === 'redline' && p) {
      rows.push(['Summary', p.summary]);
      for (const r of list(p.results)) {
        if (!r || typeof r !== 'object') { rows.push(['Clause record (unusable)', r]); continue; }
        rows.push([`Clause ${text(r.clause)} (${text(r.status)})`, `${text(r.test)}; passed ${text(r.passed)}, failed ${text(r.failed)}, total ${text(r.total)}; spec ${text(r.spec_anchor)}`]);
        if (r.spec_text) rows.push([`Specification for ${text(r.clause)}`, r.spec_text]);
        for (const f of list(r.failures)) rows.push(f && typeof f === 'object' ? [`Failure: ${text(f.title)}`, f.message] : ['Failure record (unusable)', f]);
      }
      if (p.detail) rows.push(['Detail', p.detail]);
      if (p.stderr_lines) rows.push(['Runner stderr', p.stderr_lines]);
    }
    if (court === 'splitbrain' && p) {
      rows.push(['Provenance', 'Existing TrustGap.json; dashboard did not run Stryker'], ['Code commit at', p.codeCommitAt], ['Stale against code commit', p.stale ?? 'unknown'], ['Claimed coverage', p.claimedCoverage], ['Honest mutation score', p.honestMutationScore], ['Trust gap', p.trustGap]);
      for (const w of list(p.warnings)) rows.push(['Warning', w]);
      for (const d of list(p.dishonestTests)) rows.push(['Flagged test', d]);
      for (const m of list(p.mutants)) rows.push(['Mutant', m]);
      for (const t of list(p.itLedger)) rows.push([`Test ${text(t && typeof t === 'object' ? t.itId || t.name : null)}`, t]);
      if (p.summary) rows.push(['Artifact summary', p.summary]);
      if (p.suiteLevelTotals) rows.push(['Suite totals', p.suiteLevelTotals]);
    }
    if (court === 'warpath' && p) {
      const c = p.context || {}, t = p.triage || {};
      rows.push(['Incident window', t.incidentWindow || c.metrics?.window], ['Triage status', t.status], ['Suspect deploy', t.suspect], ['Breaker snapshot', t.breakerSnapshot], ['Rule', t.rule]);
      for (const d of list(c.deploys)) rows.push(['Deploy', d]);
      rows.push(['Metrics', c.metrics]);
      for (const l of list(c.logWindow)) rows.push(['Log', l]);
      for (const d of list(t.clearedDeploys)) rows.push(['Cleared deploy', d]);
      for (const e of list(t.evidence)) rows.push(['Correlated evidence', e]);
      if (t.detail) rows.push(['Triage detail', t.detail]);
    }
    if (entry.state !== 'complete' || !p) rows.push(['Verdict', 'Evidence unavailable or incomplete; no passing verdict can be inferred.']);
    return { heading: court.toUpperCase(), court, state: entry.state, rows };
  });
  return { title: 'Northstar court report', meta: [['Schema version', snapshot.schemaVersion], ['Run ID', snapshot.runId], ['Repository', snapshot.repository], ['Checked-out commit', snapshot.checkedOutCommit], ['Working tree dirty', snapshot.workingTreeDirty], ['Created at', snapshot.createdAt], ['Run state', snapshot.state]], sections };
}

const definitionList = (rows) => `<dl>${rows.map(([key, value]) => `<div><dt>${html(key)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>`;

export function exportHtml(snapshot) {
  const doc = evidence(snapshot);
  // Radio controls work both from file:// and under the server's script-blocking CSP.
  // Details/summary provides keyboard-accessible clause drill-down without JavaScript.
  const tabs = ['overview', ...COURTS];
  const controls = tabs.map((tab, index) => `<input class="tab-choice" type="radio" name="court" id="tab-${tab}"${index === 0 ? ' checked' : ''}><label class="tab-label" for="tab-${tab}">${html(tab.toUpperCase())}</label>`).join('');
  const panels = doc.sections.map((section) => {
    const entry = snapshot[section.court];
    const clauses = section.court === 'redline' && entry.payload ? list(entry.payload.results).filter((r) => r && typeof r === 'object') : [];
    const drilldown = clauses.length ? `<h3>Clause register</h3><div class="clauses">${clauses.map((clause) => `<details class="clause"><summary>${html(clause.clause)} — ${html(clause.status)} · ${html(clause.failed)} failed / ${html(clause.passed)} passed</summary>${definitionList([['Status', clause.status], ['Test', clause.test], ['Passed', clause.passed], ['Failed', clause.failed], ['Total', clause.total], ['Spec anchor', clause.spec_anchor]])}${clause.spec_text ? `<h4>Specification text</h4><pre>${html(clause.spec_text)}</pre>` : ''}<h4>Failure testimony</h4>${list(clause.failures).length ? list(clause.failures).map((failure) => `<div class="failure"><strong>${html(failure && typeof failure === 'object' ? failure.title : 'Unusable failure record')}</strong><pre>${html(failure && typeof failure === 'object' ? failure.message : failure)}</pre></div>`).join('') : '<p>No failure messages recorded; absence is not proof of safety.</p>'}</details>`).join('')}</div>` : section.court === 'redline' && entry.state === 'complete' && entry.payload ? '<p>No clauses reported; no clause verdict can be inferred.</p>' : '';
    return `<section class="panel" id="panel-${section.court}" aria-labelledby="heading-${section.court}"><h2 id="heading-${section.court}">${html(section.heading)}</h2><p class="state">State: ${html(section.state)}</p>${drilldown}<h3>Evidence ledger</h3>${definitionList(section.rows)}</section>`;
  }).join('');
  const overview = `<section class="panel" id="panel-overview" aria-labelledby="heading-overview"><h2 id="heading-overview">Provenance</h2>${definitionList(doc.meta)}<h3>Courts</h3><div class="cards">${doc.sections.map((section) => `<label for="tab-${section.court}" class="card">${html(section.heading)} <span>${html(section.state)}</span></label>`).join('')}</div><p>Independent evidence, not release authorization. Missing evidence is never a pass.</p></section>`;
  const visibility = tabs.map((tab) => `#tab-${tab}:checked ~ #panel-${tab}`).join(',');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${html(doc.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:75rem;margin:auto;padding:2rem;background:#f7f8fb;color:#162034}*{box-sizing:border-box}h1{margin-bottom:.3rem}.intro{margin-top:0}nav{display:contents}.tab-choice{position:absolute;opacity:0;width:1px;height:1px}.tab-label{display:inline-block;padding:.65rem .9rem;margin:.3rem .2rem .7rem 0;border:1px solid #65758c;border-radius:.3rem;cursor:pointer;background:white} .tab-choice:focus-visible + .tab-label,summary:focus-visible,.card:focus-visible{outline:3px solid #2757b6;outline-offset:2px}.tab-choice:checked + .tab-label{background:#162034;color:white}.panel{display:none;border-top:2px solid #526780;padding-top:1rem}${visibility}{display:block}dl>div{margin:.7rem 0}dt{font-weight:700}dd{white-space:pre-wrap;overflow-wrap:anywhere;margin:.1rem 0 .5rem 1rem}summary{cursor:pointer;font-weight:600;padding:.7rem;background:#e8edf5;overflow-wrap:anywhere}.clause{border:1px solid #b5c1d0;margin:.6rem 0;border-radius:.3rem}.clause[open]{padding-bottom:1rem}.clause dl,.clause h4,.clause p,.failure{margin-left:1rem;margin-right:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}.cards{display:flex;flex-wrap:wrap;gap:.7rem}.card{cursor:pointer;border:1px solid #65758c;background:white;padding:1rem;border-radius:.3rem}.card span{display:block}.state{font-weight:600} @media print{.panel{display:block!important}.tab-label,.tab-choice,.cards{display:none!important}}
</style></head><body><h1>${html(doc.title)}</h1><p class="intro">Standalone offline report · no network or scripts required</p>${controls}${overview}${panels}</body></html>\n`;
}

export function exportMarkdown(snapshot) {
  const doc = evidence(snapshot);
  return `# ${md(doc.title)}\n\n## Provenance\n\n${doc.meta.map(([k, v]) => `- **${md(k)}:** ${md(v)}`).join('\n')}\n\n${doc.sections.map((s) => `## ${md(s.heading)}\n\n${s.rows.map(([k, v]) => `- **${md(k)}:** ${md(v)}`).join('\n')}`).join('\n\n')}\n`;
}

export function exportJson(snapshot) {
  snapshotSchema.parse(snapshot);
  return JSON.stringify(snapshot, null, 2) + '\n';
}

export function exportSnapshot(snapshot, format) {
  if (format === 'json') return exportJson(snapshot);
  if (format === 'md') return exportMarkdown(snapshot);
  if (format === 'html') return exportHtml(snapshot);
  throw new Error('Unsupported export format');
}
