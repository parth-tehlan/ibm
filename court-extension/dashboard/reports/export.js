import { normalizeReport } from '../contracts/report.js';

const COURTS = ['redline', 'splitbrain', 'warpath'];
const text = (value) => value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '—';
const html = (value) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Inline Markdown cannot contain raw HTML, new headings, lists, or code fences.
const md = (value) => text(value).replace(/\r\n?|\n/g, ' / ').replace(/[\t\v\f]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1');

// A neutral, data-only projection shared by the offline renderers. The entire
// opaque payload is shown, rather than assuming particular clause or test IDs.
export function evidence(input) {
  const report = normalizeReport(input);
  return {
    title: `${report.project.name} court report`,
    meta: [
      ['Schema version', report.schemaVersion], ['Project ID', report.project.id],
      ['Project name', report.project.name], ['Run ID', report.runId],
      ['Created at', report.createdAt], ['Updated at', report.updatedAt],
      ['Revision', report.revision], ['Run state', report.state],
      ['Checked-out commit', report.checkedOutCommit], ['Branch', report.branch],
      ['Working tree dirty', report.workingTreeDirty],
      ['Producer name', report.producer.name], ['Producer version', report.producer.version],
    ],
    sections: COURTS.map((court) => {
      const entry = report[court];
      return {
        court, heading: court.toUpperCase(), state: entry.state,
        rows: [
          ['State', entry.state], ['Collected at', entry.collectedAt],
          ['Source generated at', entry.sourceGeneratedAt],
          ...entry.errors.map((error) => ['Error', error]),
          ['Payload', entry.payload],
          ...(entry.state !== 'complete' || entry.payload === null
            ? [['Verdict', 'Evidence unavailable or incomplete; no passing verdict can be inferred.']]
            : []),
        ],
      };
    }),
  };
}

const definitionList = (rows) => `<dl>${rows.map(([key, value]) => `<div><dt>${html(key)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>`;

/** Standalone HTML, escaped in both text and attribute contexts; no scripts/assets. */
export function exportHtml(input) {
  const doc = evidence(input);
  const tabs = ['overview', ...COURTS];
  const controls = tabs.map((tab, index) => `<input class="tab-choice" type="radio" name="court" id="tab-${tab}"${index === 0 ? ' checked' : ''}><label class="tab-label" for="tab-${tab}">${html(tab.toUpperCase())}</label>`).join('');
  const panels = doc.sections.map((section) => `<section class="panel" id="panel-${section.court}" aria-labelledby="heading-${section.court}"><h2 id="heading-${section.court}">${html(section.heading)}</h2>${definitionList(section.rows)}</section>`).join('');
  const overview = `<section class="panel" id="panel-overview" aria-labelledby="heading-overview"><h2 id="heading-overview">Provenance</h2>${definitionList(doc.meta)}<h3>Courts</h3><div class="cards">${doc.sections.map((section) => `<label for="tab-${section.court}" class="card">${html(section.heading)} <span>${html(section.state)}</span></label>`).join('')}</div><p>Independent evidence, not release authorization. Missing evidence is never a pass.</p></section>`;
  const visibility = tabs.map((tab) => `#tab-${tab}:checked ~ #panel-${tab}`).join(',');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${html(doc.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:75rem;margin:auto;padding:2rem;background:#f7f8fb;color:#162034}*{box-sizing:border-box}.tab-choice{position:absolute;opacity:0;width:1px;height:1px}.tab-label{display:inline-block;padding:.65rem .9rem;margin:.3rem .2rem .7rem 0;border:1px solid #65758c;border-radius:.3rem;cursor:pointer;background:white}.tab-choice:focus-visible + .tab-label,.card:focus-visible{outline:3px solid #2757b6;outline-offset:2px}.tab-choice:checked + .tab-label{background:#162034;color:white}.panel{display:none;border-top:2px solid #526780;padding-top:1rem}${visibility}{display:block}dl>div{margin:.7rem 0}dt{font-weight:700}dd{white-space:pre-wrap;overflow-wrap:anywhere;margin:.1rem 0 .5rem 1rem}.cards{display:flex;flex-wrap:wrap;gap:.7rem}.card{cursor:pointer;border:1px solid #65758c;background:white;padding:1rem;border-radius:.3rem}.card span{display:block}@media print{.panel{display:block!important}.tab-label,.tab-choice,.cards{display:none!important}}
</style></head><body><h1>${html(doc.title)}</h1><p>Standalone offline report · no network or scripts required</p>${controls}${overview}${panels}</body></html>\n`;
}

export function exportMarkdown(input) {
  const doc = evidence(input);
  return `# ${md(doc.title)}\n\n## Provenance\n\n${doc.meta.map(([k, v]) => `- **${md(k)}:** ${md(v)}`).join('\n')}\n\n${doc.sections.map((s) => `## ${md(s.heading)}\n\n${s.rows.map(([k, v]) => `- **${md(k)}:** ${md(v)}`).join('\n')}`).join('\n\n')}\n`;
}

/** JSON is the full validated v2 report, not a lossy human-readable projection. */
export function exportJson(input) {
  return JSON.stringify(normalizeReport(input), null, 2) + '\n';
}

/** Export either a v2 report or a migrated v1 snapshot as 'json', 'md', 'html'. */
export function exportSnapshot(input, format) {
  if (format === 'json') return exportJson(input);
  if (format === 'md') return exportMarkdown(input);
  if (format === 'html') return exportHtml(input);
  throw new Error('Unsupported export format');
}
