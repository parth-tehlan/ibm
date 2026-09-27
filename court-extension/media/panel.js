'use strict';
/**
 * media/panel.js — TRIUMPH webview UI.
 *
 * Stateless re-renderer: builds its own DOM (the host-provided HTML shell
 * only supplies CSP + <link>/<script> tags and an empty <body>), keeps no
 * business logic, and communicates with the extension host purely via
 * postMessage per the contract in design.md section C.
 *
 * Persists only the user's selected court + host across reloads via
 * vscode.getState()/setState().
 */
(function () {
  const vscode = acquireVsCodeApi();

  const COURTS = [
    { id: 'REDLINE', label: 'REDLINE', desc: 'spec-witness verdicts per clause' },
    { id: 'SPLITBRAIN', label: 'SPLITBRAIN', desc: 'honesty audit (mutation vs claimed coverage)' },
    { id: 'WARPATH', label: 'WARPATH', desc: 'incident forensics triage' },
  ];

  const SECTION_IDS = ['config', 'run', 'report', 'dashboard', 'install'];

  /** Latest full state snapshot from the host, or null before first `state`. */
  let state = null;
  /** Interval id for the running-job elapsed-time ticker. */
  let jobTimer = null;
  /** Whether the log list is pinned to the bottom (auto-scroll) or the user scrolled up. */
  let logPinned = true;

  const persisted = safeGetState();

  // ---------------------------------------------------------------- helpers

  function safeGetState() {
    try { return vscode.getState() || {}; } catch (e) { return {}; }
  }

  function persist(patch) {
    const next = Object.assign({}, safeGetState(), patch);
    try { vscode.setState(next); } catch (e) { /* ignore */ }
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function el(tag, opts, children) {
    const node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.id) node.id = opts.id;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
    }
    if (opts.type) node.type = opts.type;
    if (opts.disabled) node.disabled = true;
    (children || []).forEach((c) => { if (c) node.appendChild(c); });
    return node;
  }

  function button(text, onClick, opts) {
    opts = opts || {};
    const btn = el('button', { className: opts.secondary ? 'btn btn-secondary' : 'btn', type: 'button', text: text });
    if (opts.id) btn.id = opts.id;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtElapsed(startedAtIso) {
    const started = Date.parse(startedAtIso);
    if (isNaN(started)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (secs < 60) return secs + 's';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + 'm ' + s + 's';
  }

  function fmtTs(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '';
    return d.toLocaleTimeString();
  }

  // ------------------------------------------------------------- DOM: shell

  const root = document.body;

  const workspaceNotice = el('div', { className: 'notice notice-warning', id: 'workspace-notice' }, [
    el('span', { text: 'Open a workspace folder to use TRIUMPH.' }),
  ]);
  workspaceNotice.hidden = true;

  const errorBanner = el('div', { className: 'banner banner-error', id: 'error-banner' });
  errorBanner.hidden = true;
  const errorText = el('span', { className: 'banner-text' });
  const errorDismiss = button('Dismiss', () => { errorBanner.hidden = true; }, { secondary: true, id: 'error-dismiss' });
  errorDismiss.classList.add('banner-dismiss');
  errorBanner.appendChild(errorText);
  errorBanner.appendChild(errorDismiss);

  root.appendChild(workspaceNotice);
  root.appendChild(errorBanner);

  const main = el('main', { className: 'panel' });
  root.appendChild(main);

  function makeSection(id, title) {
    const section = el('section', { className: 'card', id: id, attrs: { 'aria-labelledby': id + '-heading' } });
    const heading = el('h2', { id: id + '-heading', text: title });
    section.appendChild(heading);
    main.appendChild(section);
    return section;
  }

  // ---- 1. Config -------------------------------------------------------

  const configSection = makeSection('config', 'Config');
  const configExists = el('div', { className: 'field-row' });
  const configExistsLabel = el('span', { className: 'field-label', text: 'Status:' });
  const configExistsValue = el('span', { className: 'field-value' });
  configExists.appendChild(configExistsLabel);
  configExists.appendChild(configExistsValue);

  const configPath = el('div', { className: 'field-row' });
  const configPathLabel = el('span', { className: 'field-label', text: 'Path:' });
  const configPathValue = el('span', { className: 'field-value field-mono' });
  configPath.appendChild(configPathLabel);
  configPath.appendChild(configPathValue);

  const configNotes = el('ul', { className: 'notes-list' });

  const configButtons = el('div', { className: 'button-row' });
  const detectConfigBtn = button('Auto-detect .triumph.yml', () => post({ type: 'detectConfig' }));
  const openConfigBtn = button('Open config', () => post({ type: 'openConfig' }), { secondary: true });
  configButtons.appendChild(detectConfigBtn);
  configButtons.appendChild(openConfigBtn);

  configSection.appendChild(configExists);
  configSection.appendChild(configPath);
  configSection.appendChild(configNotes);
  configSection.appendChild(configButtons);

  // ---- 2. Run ------------------------------------------------------------

  const runSection = makeSection('run', 'Run');

  const courtFieldset = el('fieldset', { className: 'court-fieldset' });
  const courtLegend = el('legend', { text: 'Court' });
  courtFieldset.appendChild(courtLegend);

  const courtRadios = {};
  COURTS.forEach((court, idx) => {
    const inputId = 'court-radio-' + court.id;
    const wrap = el('div', { className: 'radio-option' });
    const input = el('input', { id: inputId, type: 'radio', attrs: { name: 'court' } });
    input.value = court.id;
    input.addEventListener('change', () => {
      if (input.checked) persist({ court: court.id });
    });
    const label = el('label', { attrs: { for: inputId } }, [
      el('span', { className: 'radio-title', text: court.label }),
      el('span', { className: 'radio-desc', text: ' — ' + court.desc }),
    ]);
    wrap.appendChild(input);
    wrap.appendChild(label);
    courtFieldset.appendChild(wrap);
    courtRadios[court.id] = input;
  });
  runSection.appendChild(courtFieldset);

  const runButtons = el('div', { className: 'button-row' });
  const runCourtBtn = button('Run court', () => {
    const court = selectedCourt();
    if (court) post({ type: 'runCourt', court: court });
  });
  const generateReportBtn = button('Generate full report', () => post({ type: 'generateReport' }), { secondary: true });
  runButtons.appendChild(runCourtBtn);
  runButtons.appendChild(generateReportBtn);
  runSection.appendChild(runButtons);

  const jobIndicator = el('div', { className: 'job-indicator', id: 'job-indicator' });
  jobIndicator.hidden = true;
  const jobLabel = el('span', { className: 'job-label' });
  const jobElapsed = el('span', { className: 'job-elapsed' });
  jobIndicator.appendChild(el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }));
  jobIndicator.appendChild(jobLabel);
  jobIndicator.appendChild(jobElapsed);
  runSection.appendChild(jobIndicator);

  const logHeading = el('h3', { className: 'log-heading', text: 'Log' });
  runSection.appendChild(logHeading);
  const logContainer = el('div', { className: 'log-container', id: 'log-container' });
  const logList = el('ul', { className: 'log-list', attrs: { 'aria-live': 'polite', 'aria-label': 'Run log' } });
  logContainer.appendChild(logList);
  logContainer.addEventListener('scroll', () => {
    const atBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 24;
    logPinned = atBottom;
  });
  runSection.appendChild(logContainer);

  function selectedCourt() {
    for (const id in courtRadios) if (courtRadios[id].checked) return id;
    return null;
  }

  // ---- 3. Last report -----------------------------------------------------

  const reportSection = makeSection('report', 'Last report');
  const reportEmpty = el('p', { className: 'empty-state', text: 'No report has been generated yet.' });
  const reportDetails = el('div', { className: 'report-details' });
  reportDetails.hidden = true;
  const reportGenerated = el('div', { className: 'field-row' });
  const reportGeneratedLabel = el('span', { className: 'field-label', text: 'Generated:' });
  const reportGeneratedValue = el('span', { className: 'field-value' });
  reportGenerated.appendChild(reportGeneratedLabel);
  reportGenerated.appendChild(reportGeneratedValue);
  const reportSummary = el('ul', { className: 'summary-list' });
  reportDetails.appendChild(reportGenerated);
  reportDetails.appendChild(reportSummary);

  const reportButtons = el('div', { className: 'button-row' });
  const openHtmlBtn = button('Open HTML report', () => post({ type: 'openLastReport', format: 'html' }));
  const openMdBtn = button('Open Markdown', () => post({ type: 'openLastReport', format: 'md' }), { secondary: true });
  reportButtons.appendChild(openHtmlBtn);
  reportButtons.appendChild(openMdBtn);

  reportSection.appendChild(reportEmpty);
  reportSection.appendChild(reportDetails);
  reportSection.appendChild(reportButtons);

  // ---- 4. Dashboard --------------------------------------------------------

  const dashboardSection = makeSection('dashboard', 'Dashboard');
  const dashboardBadge = el('span', { className: 'badge badge-disconnected', text: 'Disconnected' });
  const dashboardBadgeRow = el('div', { className: 'field-row' }, [dashboardBadge]);
  const dashboardUrlRow = el('div', { className: 'field-row' });
  const dashboardUrlLabel = el('span', { className: 'field-label', text: 'URL:' });
  const dashboardUrlValue = el('span', { className: 'field-value field-mono' });
  dashboardUrlRow.appendChild(dashboardUrlLabel);
  dashboardUrlRow.appendChild(dashboardUrlValue);
  dashboardUrlRow.hidden = true;

  const dashboardButtons = el('div', { className: 'button-row' });
  const dashboardRunBtn = button('Run courts → dashboard', () => post({ type: 'dashboardRun' }));
  const dashboardOpenBtn = button('Open dashboard', () => post({ type: 'dashboardOpen' }), { secondary: true });
  const dashboardStatusBtn = button('Refresh status', () => post({ type: 'dashboardStatus' }), { secondary: true });
  dashboardButtons.appendChild(dashboardRunBtn);
  dashboardButtons.appendChild(dashboardOpenBtn);
  dashboardButtons.appendChild(dashboardStatusBtn);

  dashboardSection.appendChild(dashboardBadgeRow);
  dashboardSection.appendChild(dashboardUrlRow);
  dashboardSection.appendChild(dashboardButtons);

  // ---- 5. Install courts -----------------------------------------------------

  const installSection = makeSection('install', 'Install courts');
  const hostFieldWrap = el('div', { className: 'field-row' });
  const hostSelectLabel = el('label', { className: 'field-label', text: 'Host:', attrs: { for: 'host-select' } });
  const hostSelect = el('select', { id: 'host-select', className: 'dropdown' });
  hostSelect.addEventListener('change', () => persist({ host: hostSelect.value }));
  hostFieldWrap.appendChild(hostSelectLabel);
  hostFieldWrap.appendChild(hostSelect);
  installSection.appendChild(hostFieldWrap);

  const installButtons = el('div', { className: 'button-row' });
  const installBtn = button('Install', () => post({ type: 'installCourts', host: hostSelect.value || 'all' }));
  installButtons.appendChild(installBtn);
  installSection.appendChild(installButtons);

  const SECTION_ELS = {
    config: configSection,
    run: runSection,
    report: reportSection,
    dashboard: dashboardSection,
    install: installSection,
  };

  // -------------------------------------------------------------- rendering

  function jobStartingButtons() {
    return [detectConfigBtn, runCourtBtn, generateReportBtn, installBtn, dashboardRunBtn];
  }

  function allActionButtons() {
    return [
      detectConfigBtn, openConfigBtn, runCourtBtn, generateReportBtn,
      openHtmlBtn, openMdBtn, dashboardRunBtn, dashboardOpenBtn, dashboardStatusBtn,
      installBtn,
    ];
  }

  function render() {
    if (!state) return;
    const hasRoot = !!(state.workspace && state.workspace.root);
    workspaceNotice.hidden = hasRoot;

    renderConfig();
    renderHosts();
    renderJob();
    renderLog();
    renderReport();
    renderDashboard();

    const jobBusy = !!state.job;
    jobStartingButtons().forEach((b) => { b.disabled = !hasRoot || jobBusy; });
    if (!hasRoot) {
      allActionButtons().forEach((b) => { b.disabled = true; });
    } else {
      openConfigBtn.disabled = !(state.config && state.config.exists);
      openHtmlBtn.disabled = !state.lastReport;
      openMdBtn.disabled = !state.lastReport;
      dashboardOpenBtn.disabled = !(state.dashboard && state.dashboard.url);
      dashboardStatusBtn.disabled = false;
    }
  }

  function renderConfig() {
    const cfg = state.config || { exists: false, path: null, notes: [] };
    configExistsValue.textContent = cfg.exists ? 'found' : 'not found';
    configExistsValue.className = 'field-value ' + (cfg.exists ? 'value-ok' : 'value-warn');
    configPathValue.textContent = cfg.path || '(none)';
    clear(configNotes);
    (cfg.notes || []).forEach((note) => {
      configNotes.appendChild(el('li', { text: note }));
    });
  }

  function renderHosts() {
    const hosts = state.hosts || { available: ['all'], labels: {}, default: 'all' };
    const wanted = persisted.host || hosts.default || 'all';
    const currentValue = hostSelect.value;
    clear(hostSelect);
    (hosts.available || ['all']).forEach((id) => {
      const label = id === 'all' ? 'All hosts' : ((hosts.labels && hosts.labels[id]) || id);
      hostSelect.appendChild(el('option', { text: label, attrs: { value: id } }));
    });
    const toSelect = [currentValue, wanted, hosts.default, 'all'].find(
      (v) => v && Array.from(hostSelect.options).some((o) => o.value === v)
    );
    if (toSelect) hostSelect.value = toSelect;
  }

  function renderJob() {
    const job = state.job;
    if (job) {
      jobIndicator.hidden = false;
      jobLabel.textContent = job.label || job.kind || 'Running…';
      jobElapsed.textContent = fmtElapsed(job.startedAt);
      if (!jobTimer) {
        jobTimer = setInterval(() => {
          if (state && state.job) jobElapsed.textContent = fmtElapsed(state.job.startedAt);
        }, 1000);
      }
    } else {
      jobIndicator.hidden = true;
      if (jobTimer) { clearInterval(jobTimer); jobTimer = null; }
    }
  }

  function renderLog() {
    clear(logList);
    (state.log || []).forEach((entry) => appendLogEntry(entry, false));
    scrollLogIfPinned();
  }

  function appendLogEntry(entry, isAppend) {
    const level = entry.level === 'error' || entry.level === 'warn' ? entry.level : 'info';
    const item = el('li', { className: 'log-entry log-' + level });
    item.appendChild(el('span', { className: 'log-ts', text: fmtTs(entry.ts) }));
    item.appendChild(el('span', { className: 'log-level', text: level.toUpperCase() }));
    item.appendChild(el('span', { className: 'log-text', text: entry.text }));
    logList.appendChild(item);
    if (isAppend) scrollLogIfPinned();
  }

  function scrollLogIfPinned() {
    if (logPinned) logContainer.scrollTop = logContainer.scrollHeight;
  }

  function renderReport() {
    const report = state.lastReport;
    if (!report) {
      reportEmpty.hidden = false;
      reportDetails.hidden = true;
      return;
    }
    reportEmpty.hidden = true;
    reportDetails.hidden = false;
    reportGeneratedValue.textContent = report.generatedAt ? fmtTs(report.generatedAt) + ' (' + report.generatedAt + ')' : '(unknown)';
    clear(reportSummary);
    if (report.summary && typeof report.summary === 'object') {
      Object.keys(report.summary).forEach((key) => {
        const li = el('li');
        li.appendChild(el('span', { className: 'summary-key', text: key + ': ' }));
        li.appendChild(el('span', { className: 'summary-value', text: String(report.summary[key]) }));
        reportSummary.appendChild(li);
      });
    }
  }

  function renderDashboard() {
    const dash = state.dashboard || { connected: false, url: null };
    dashboardBadge.textContent = dash.connected ? 'Connected' : 'Disconnected';
    dashboardBadge.className = 'badge ' + (dash.connected ? 'badge-connected' : 'badge-disconnected');
    if (dash.url) {
      dashboardUrlRow.hidden = false;
      dashboardUrlValue.textContent = dash.url;
    } else {
      dashboardUrlRow.hidden = true;
      dashboardUrlValue.textContent = '';
    }
  }

  // ---------------------------------------------------------------- focus

  function focusSection(section, preselect) {
    const target = SECTION_ELS[section];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('section-highlight');
    setTimeout(() => target.classList.remove('section-highlight'), 1600);
    if (preselect) {
      if (preselect.court && courtRadios[preselect.court]) {
        courtRadios[preselect.court].checked = true;
        persist({ court: preselect.court });
      }
      if (preselect.host) {
        const opt = Array.from(hostSelect.options).find((o) => o.value === preselect.host);
        if (opt) {
          hostSelect.value = preselect.host;
          persist({ host: preselect.host });
        }
      }
    }
  }

  // ----------------------------------------------------------- initial UI

  // Apply persisted court/host selection before the first state arrives so
  // the controls are not empty while waiting on the host.
  if (persisted.court && courtRadios[persisted.court]) {
    courtRadios[persisted.court].checked = true;
  } else if (courtRadios[COURTS[0].id]) {
    courtRadios[COURTS[0].id].checked = true;
  }

  // ------------------------------------------------------------- messages

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'state':
        state = msg.state;
        render();
        break;
      case 'log':
        if (msg.entry) appendLogEntry(msg.entry, true);
        break;
      case 'error':
        errorText.textContent = msg.text || '';
        errorBanner.hidden = false;
        break;
      case 'focus':
        focusSection(msg.section, msg.preselect);
        break;
      default:
        // Unknown message types from the host are ignored.
        break;
    }
  });

  post({ type: 'ready' });
})();
