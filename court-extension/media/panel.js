'use strict';
/**
 * media/panel.js — TRIUMPH webview UI (tabbed redesign).
 *
 * Layout: a narrow vertical icon-tab bar on the left (Run / Report /
 * Dashboard / Setup) and an independently scrolling content area on the
 * right. The webview keeps no business logic: it renders the host's state
 * snapshots and talks to the extension host purely via postMessage.
 *
 * Message protocol (host → webview): state, step, log, error, focus.
 *   state — full snapshot {workspace, config, hosts, lastReport, dashboard,
 *           job, log[], steps[], mutations}
 *   step  — append-only agent-activity entry {ts, status, text}
 *   log   — append-only raw console entry {ts, level, text}
 *   focus — {section, preselect} reveal a tab (+ preselect host)
 *
 * Persisted via vscode.getState()/setState(): active tab, selected courts,
 * host, run options. Feed buffers are kept in-memory (they are rebuilt from
 * the host's state snapshot on reload).
 */
(function () {
  const vscode = acquireVsCodeApi();

  const COURTS = [
    { id: 'REDLINE', label: 'REDLINE', desc: 'Spec-witness verdicts per clause' },
    { id: 'SPLITBRAIN', label: 'SPLITBRAIN', desc: 'Honesty audit — mutation vs claimed coverage' },
    { id: 'WARPATH', label: 'WARPATH', desc: 'Incident forensics triage' },
  ];

  const TABS = [
    { id: 'run', icon: '▶', label: 'Run' },
    { id: 'report', icon: '📋', label: 'Report' },
    { id: 'dashboard', icon: '⬡', label: 'Dashboard' },
    { id: 'setup', icon: '⚙', label: 'Setup' },
  ];

  const STEP_LIMIT = 200;

  /** Latest full state snapshot from the host, or null before first `state`. */
  let state = null;
  /** Interval id for the running-job elapsed-time ticker. */
  let jobTimer = null;
  /** Activity-feed pin-to-bottom (auto-scroll unless the user scrolled up). */
  let feedPinned = true;
  /** Console-log pin-to-bottom. */
  let logPinned = true;
  /** In-memory feed buffers (rebuilt from state snapshots after reload). */
  let feedEntries = [];
  let logEntries = [];

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
    if (opts.value !== undefined) node.value = opts.value;
    if (opts.checked) node.checked = true;
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

  const errorBanner = el('div', { className: 'banner banner-error', id: 'error-banner', attrs: { role: 'alert' } });
  // Belt and braces: the [hidden] attribute can be overridden by a
  // `display: flex` rule on some webview builds — the CSS uses the stronger
  // `display: none !important` guard, and we also collapse the element.
  errorBanner.hidden = true;
  errorBanner.setAttribute('aria-hidden', 'true');
  const errorText = el('span', { className: 'banner-text' });
  const errorDismiss = button('Dismiss', () => { errorBanner.hidden = true; errorBanner.setAttribute('aria-hidden', 'true'); }, { secondary: true, id: 'error-dismiss' });
  errorDismiss.classList.add('banner-dismiss');
  errorBanner.appendChild(errorText);
  errorBanner.appendChild(errorDismiss);

  root.appendChild(workspaceNotice);
  root.appendChild(errorBanner);

  const layout = el('div', { className: 'layout' });
  root.appendChild(layout);

  // ---- vertical tab bar ----------------------------------------------------

  const tabBar = el('nav', { className: 'tabbar', attrs: { 'aria-label': 'TRIUMPH sections', role: 'tablist' } });
  const tabButtons = {};
  TABS.forEach((tab) => {
    const btn = el('button', {
      className: 'tab-item', type: 'button', attrs: { role: 'tab', 'aria-label': tab.label },
    }, [
      el('span', { className: 'tab-icon', text: tab.icon, attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'tab-label', text: tab.label }),
    ]);
    btn.addEventListener('click', () => {
      activateTab(tab.id);
      persist({ tab: tab.id });
    });
    tabButtons[tab.id] = btn;
    tabBar.appendChild(btn);
  });
  layout.appendChild(tabBar);

  const content = el('main', { className: 'content' });
  layout.appendChild(content);

  function makePanel(id) {
    const panel = el('section', { className: 'tab-panel', id: 'panel-' + id, attrs: { role: 'tabpanel' } });
    panel.hidden = true;
    content.appendChild(panel);
    return panel;
  }

  function activateTab(id) {
    for (const t of TABS) {
      const active = t.id === id;
      tabButtons[t.id].classList.toggle('active', active);
      tabButtons[t.id].setAttribute('aria-selected', active ? 'true' : 'false');
      panels[t.id].hidden = !active;
    }
  }

  // ============================================================ TAB: RUN ====

  const runPanel = makePanel('run');

  // -- court selector: three large multi-select tiles
  const tileWrap = el('div', { className: 'court-tiles', attrs: { role: 'group', 'aria-label': 'Courts to run' } });
  const courtTiles = {};
  const courtBadges = {};
  COURTS.forEach((court) => {
    const tile = el('button', {
      className: 'court-tile', type: 'button', attrs: { 'aria-pressed': 'false' },
    }, [
      el('div', { className: 'tile-head' }, [
        el('span', { className: 'tile-name', text: court.label }),
        el('span', { className: 'tile-badge badge-idle', text: 'ready' }),
      ]),
      el('div', { className: 'tile-desc', text: court.desc }),
    ]);
    tile.addEventListener('click', () => {
      tile.classList.toggle('selected');
      const selected = tile.classList.contains('selected');
      tile.setAttribute('aria-pressed', selected ? 'true' : 'false');
      persist({ courts: selectedCourts() });
      renderRunButton();
    });
    courtTiles[court.id] = tile;
    courtBadges[court.id] = tile.querySelector('.tile-badge');
    tileWrap.appendChild(tile);
  });
  runPanel.appendChild(tileWrap);

  // -- options (collapsed by default)
  const optionsDetails = el('details', { className: 'options-block' });
  const optionsSummary = el('summary', { text: 'Options ' });
  optionsSummary.appendChild(el('span', { className: 'summary-arrow', text: '▸', attrs: { 'aria-hidden': 'true' } }));
  optionsDetails.appendChild(optionsSummary);
  if (persisted.optionsOpen) optionsDetails.open = true;
  optionsDetails.addEventListener('toggle', () => persist({ optionsOpen: optionsDetails.open }));

  const optionsBody = el('div', { className: 'options-body' });

  // Output target
  const targetField = el('div', { className: 'opt-field' }, [el('span', { className: 'opt-label', text: 'Output target' })]);
  const targetLocal = el('input', { type: 'radio', id: 'target-local', attrs: { name: 'output-target', value: 'local' } });
  const targetDash = el('input', { type: 'radio', id: 'target-dashboard', attrs: { name: 'output-target', value: 'dashboard' } });
  targetLocal.addEventListener('change', () => { if (targetLocal.checked) persist({ outputTarget: 'local' }); });
  targetDash.addEventListener('change', () => { if (targetDash.checked) persist({ outputTarget: 'dashboard' }); });
  targetField.appendChild(el('label', { className: 'radio-option', attrs: { for: 'target-local' } }, [
    targetLocal,
    el('span', {}, [
      el('span', { className: 'radio-title', text: 'Local only' }),
      el('span', { className: 'radio-desc', text: ' — writes reports/triumph/' }),
    ]),
  ]));
  targetField.appendChild(el('label', { className: 'radio-option', attrs: { for: 'target-dashboard' } }, [
    targetDash,
    el('span', {}, [
      el('span', { className: 'radio-title', text: 'Dashboard' }),
      el('span', { className: 'radio-desc', text: ' — publish all courts to the connected dashboard' }),
    ]),
  ]));
  optionsBody.appendChild(targetField);

  // Mutation timeout (SPLITBRAIN only)
  const timeoutField = el('div', { className: 'opt-field', id: 'timeout-field' }, [
    el('label', { className: 'opt-label', text: 'Mutation timeout (seconds)', attrs: { for: 'timeout-input' } }),
  ]);
  const timeoutInput = el('input', { className: 'number-input', type: 'number', id: 'timeout-input', attrs: { min: '1', step: '1', placeholder: 'from .triumph.yml (default 900)' } });
  timeoutInput.addEventListener('change', () => {
    const v = parseInt(timeoutInput.value, 10);
    persist({ timeoutSeconds: Number.isFinite(v) && v > 0 ? v : null });
  });
  timeoutField.appendChild(timeoutInput);
  optionsBody.appendChild(timeoutField);

  // Report formats
  const formatField = el('div', { className: 'opt-field' }, [el('span', { className: 'opt-label', text: 'Report format' })]);
  const formatRow = el('div', { className: 'format-row' });
  const formatChecks = {};
  ['HTML', 'Markdown', 'JSON'].forEach((name) => {
    const key = name.toLowerCase() === 'markdown' ? 'md' : name.toLowerCase();
    const input = el('input', { type: 'checkbox', id: 'fmt-' + key });
    input.checked = !persisted.formats || persisted.formats.includes(key);
    input.addEventListener('change', () => {
      persist({ formats: Object.keys(formatChecks).filter((k) => formatChecks[k].checked) });
    });
    formatChecks[key] = input;
    formatRow.appendChild(el('label', { className: 'check-option', attrs: { for: 'fmt-' + key } }, [input, el('span', { text: name })]));
  });
  formatField.appendChild(formatRow);
  optionsBody.appendChild(formatField);
  optionsDetails.appendChild(optionsBody);
  runPanel.appendChild(optionsDetails);

  // -- the single Run button
  const runBtn = button('Run selected courts', () => {
    const courts = selectedCourts();
    if (!courts.length) return;
    const msg = { type: 'runCourt', courts, outputTarget: targetDash.checked ? 'dashboard' : 'local' };
    const timeout = parseInt(timeoutInput.value, 10);
    if (Number.isFinite(timeout) && timeout > 0) msg.timeoutSeconds = timeout;
    if (courts.length === 3) msg.formats = selectedFormats(); // full run writes artifacts directly
    post(msg);
  }, { id: 'run-btn' });
  runPanel.appendChild(el('div', { className: 'run-btn-row' }, [runBtn]));

  function selectedCourts() {
    return COURTS.filter((c) => courtTiles[c.id].classList.contains('selected')).map((c) => c.id);
  }
  function selectedFormats() {
    return Object.keys(formatChecks).filter((k) => formatChecks[k].checked);
  }

  // -- mutation live progress (visible while SPLITBRAIN streams)
  const mutationLive = el('div', { className: 'mutation-live', id: 'mutation-live' });
  mutationLive.hidden = true;
  mutationLive.setAttribute('aria-hidden', 'true');
  const mutationTitle = el('div', { className: 'mutation-title' }, [
    el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'mutation-heading', text: 'Mutation run in progress' }),
    el('span', { className: 'mutation-pct', text: '' }),
  ]);
  const mutationBarTrack = el('div', { className: 'progress-track' });
  const mutationBarFill = el('div', { className: 'progress-fill' });
  mutationBarTrack.appendChild(mutationBarFill);
  const mutationStats = el('div', { className: 'mutation-stats' });
  mutationLive.appendChild(mutationTitle);
  mutationLive.appendChild(mutationBarTrack);
  mutationLive.appendChild(mutationStats);
  runPanel.appendChild(mutationLive);

  // -- agent activity feed (the most prominent element on this tab)
  const feedHeading = el('h3', { className: 'feed-heading', text: 'Agent activity' });
  runPanel.appendChild(feedHeading);
  const feedContainer = el('div', { className: 'feed-container', id: 'feed-container' });
  const feedList = el('ul', { className: 'feed-list', attrs: { 'aria-live': 'polite', 'aria-label': 'Agent activity feed' } });
  const feedEmpty = el('li', { className: 'feed-empty', text: 'Run a court to see the agent trace here.' });
  feedList.appendChild(feedEmpty);
  feedContainer.appendChild(feedList);
  feedContainer.addEventListener('scroll', () => {
    feedPinned = feedContainer.scrollHeight - feedContainer.scrollTop - feedContainer.clientHeight < 24;
  });
  runPanel.appendChild(feedContainer);

  // -- collapsible console-log drawer, pinned to the bottom of the Run tab
  const logDrawer = el('details', { className: 'log-drawer' });
  const logSummary = el('summary');
  const logSummaryText = el('span', { text: 'Console log ' });
  const logSummaryCount = el('span', { className: 'log-count', text: '(0 entries)' });
  logSummary.appendChild(logSummaryText);
  logSummary.appendChild(el('span', { className: 'summary-arrow', text: '▸', attrs: { 'aria-hidden': 'true' } }));
  logSummary.appendChild(logSummaryCount);
  logDrawer.appendChild(logSummary);
  const logContainer = el('div', { className: 'log-container', id: 'log-container' });
  const logList = el('ul', { className: 'log-list', attrs: { 'aria-live': 'polite', 'aria-label': 'Run log' } });
  logContainer.appendChild(logList);
  logContainer.addEventListener('scroll', () => {
    logPinned = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 24;
  });
  logDrawer.appendChild(logContainer);
  runPanel.appendChild(logDrawer);

  // ========================================================= TAB: REPORT ====

  const reportPanel = makePanel('report');

  // Per-court verdict scorecard
  const scorecard = el('div', { className: 'scorecard' });
  const scoreRows = {};
  COURTS.forEach((court) => {
    const name = el('span', { className: 'score-name', text: court.label });
    const verdict = el('span', { className: 'score-verdict' });
    const lastRun = el('span', { className: 'score-last' });
    const row = el('div', { className: 'score-row', id: 'score-' + court.id.toLowerCase() }, [name, verdict, lastRun]);
    scoreRows[court.id] = { row, verdict, lastRun };
    scorecard.appendChild(row);
  });
  reportPanel.appendChild(scorecard);

  const reportGenerated = el('div', { className: 'report-generated' });
  reportPanel.appendChild(reportGenerated);

  const reportButtons = el('div', { className: 'button-row' });
  const openHtmlBtn = button('Open HTML report', () => post({ type: 'openLastReport', format: 'html' }));
  const openMdBtn = button('Open Markdown', () => post({ type: 'openLastReport', format: 'md' }), { secondary: true });
  reportButtons.appendChild(openHtmlBtn);
  reportButtons.appendChild(openMdBtn);
  reportPanel.appendChild(reportButtons);

  // ====================================================== TAB: DASHBOARD ====

  const dashboardPanel = makePanel('dashboard');
  const dashboardBadge = el('span', { className: 'badge badge-disconnected', text: 'Disconnected' });
  const dashboardBadgeRow = el('div', { className: 'field-row' }, [dashboardBadge]);
  const dashboardUrlRow = el('div', { className: 'field-row' });
  const dashboardUrlLabel = el('span', { className: 'field-label', text: 'URL:' });
  const dashboardUrlValue = el('span', { className: 'field-value field-mono' });
  dashboardUrlRow.appendChild(dashboardUrlLabel);
  dashboardUrlRow.appendChild(dashboardUrlValue);
  dashboardUrlRow.hidden = true;

  const dashboardButtons = el('div', { className: 'button-row' });
  const dashboardOpenBtn = button('Open dashboard', () => post({ type: 'dashboardOpen' }));
  const dashboardStatusBtn = button('Refresh status', () => post({ type: 'dashboardStatus' }), { secondary: true });
  dashboardButtons.appendChild(dashboardOpenBtn);
  dashboardButtons.appendChild(dashboardStatusBtn);

  const dashboardHint = el('p', { className: 'empty-state', text: 'Running to the dashboard: select courts on the Run tab, choose "Dashboard" as the output target, then Run selected courts.' });

  dashboardPanel.appendChild(dashboardBadgeRow);
  dashboardPanel.appendChild(dashboardUrlRow);
  dashboardPanel.appendChild(dashboardButtons);
  dashboardPanel.appendChild(dashboardHint);

  // ========================================================== TAB: SETUP ====

  const setupPanel = makePanel('setup');

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

  const configButtons = el('div', { className: 'button-row' });
  const detectConfigBtn = button('Auto-detect .triumph.yml', () => post({ type: 'detectConfig' }));
  const openConfigBtn = button('Open config', () => post({ type: 'openConfig' }), { secondary: true });
  configButtons.appendChild(detectConfigBtn);
  configButtons.appendChild(openConfigBtn);

  const setupDivider = el('hr', { className: 'setup-divider' });

  const hostFieldWrap = el('div', { className: 'field-row' });
  const hostSelectLabel = el('label', { className: 'field-label', text: 'Host:', attrs: { for: 'host-select' } });
  const hostSelect = el('select', { id: 'host-select', className: 'dropdown' });
  hostSelect.addEventListener('change', () => persist({ host: hostSelect.value }));
  hostFieldWrap.appendChild(hostSelectLabel);
  hostFieldWrap.appendChild(hostSelect);

  const installButtons = el('div', { className: 'button-row' });
  const installBtn = button('Install', () => post({ type: 'installCourts', host: hostSelect.value || 'all' }));
  installButtons.appendChild(installBtn);

  setupPanel.appendChild(configExists);
  setupPanel.appendChild(configPath);
  setupPanel.appendChild(configButtons);
  setupPanel.appendChild(setupDivider);
  setupPanel.appendChild(hostFieldWrap);
  setupPanel.appendChild(installButtons);

  const panels = { run: runPanel, report: reportPanel, dashboard: dashboardPanel, setup: setupPanel };

  // -------------------------------------------------------------- rendering

  function jobStartingButtons() {
    return [runBtn, detectConfigBtn, installBtn];
  }

  function render() {
    if (!state) return;
    const hasRoot = !!(state.workspace && state.workspace.root);
    workspaceNotice.hidden = hasRoot;

    renderTiles();
    renderRunButton();
    renderMutationLive();
    renderFeed(true);
    renderLog(true);
    renderReport();
    renderDashboard();
    renderSetup();

    const jobBusy = !!state.job;
    jobStartingButtons().forEach((b) => { b.disabled = !hasRoot || jobBusy || (b === runBtn && selectedCourts().length === 0); });
    if (!hasRoot) {
      [openConfigBtn, openHtmlBtn, openMdBtn, dashboardOpenBtn, dashboardStatusBtn].forEach((b) => { b.disabled = true; });
    } else {
      openConfigBtn.disabled = !(state.config && state.config.exists);
      const canOpenReport = !!(state.lastReport && state.lastReport.htmlPath);
      openHtmlBtn.disabled = !canOpenReport;
      openMdBtn.disabled = !(state.lastReport && state.lastReport.mdPath);
      dashboardOpenBtn.disabled = !(state.dashboard && state.dashboard.url);
      dashboardStatusBtn.disabled = false;
    }
  }

  // -- Run tab ----------------------------------------------------------------

  /** Court tile badges derive from lastReport: red verdicts -> failed,
   *  all-green or yellow-only -> passed (yellow is not a failure), no
   *  evidence -> not run. A live job overrides with 'running'. */
  function renderTiles() {
    const job = state.job;
    const lr = state.lastReport || {};
    for (const court of COURTS) {
      const badge = courtBadges[court.id];
      let cls = 'badge-idle';
      let text = 'not run';
      if (job && /^runCourt/.test(job.kind || '') && selectedCourts().includes(court.id)) {
        cls = 'badge-running';
        text = 'running';
      } else if (court.id === 'REDLINE' && lr.redline && lr.redline.summary) {
        const s = lr.redline.summary;
        if (s.red > 0) { cls = 'badge-failed'; text = 'failed'; }
        else { cls = 'badge-passed'; text = 'passed'; }
      } else if (court.id === 'SPLITBRAIN' && lr.splitbrain && lr.splitbrain.trustGap != null) {
        const pct = Math.round((lr.splitbrain.trustGap || 0) * 100) / 100;
        cls = 'badge-gap';
        text = `gap ${pct}`;
      } else if (court.id === 'WARPATH' && lr.warpath) {
        if (lr.warpath.incidentWindow) { cls = 'badge-failed'; text = 'incident'; }
        else { cls = 'badge-passed'; text = 'clear'; }
      }
      badge.className = 'tile-badge ' + cls;
      badge.textContent = text;
    }
    // Timeout field only matters when SPLITBRAIN is selected.
    timeoutField.hidden = !selectedCourts().includes('SPLITBRAIN');
  }

  function renderRunButton() {
    const any = selectedCourts().length > 0;
    if (state && state.job) {
      runBtn.disabled = true;
      clear(runBtn);
      runBtn.appendChild(el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }));
      runBtn.appendChild(el('span', { text: ' Running… ' + (state.job.startedAt ? fmtElapsed(state.job.startedAt) : '') }));
      if (!jobTimer) {
        jobTimer = setInterval(() => {
          if (state && state.job) renderRunButton();
          else { clearInterval(jobTimer); jobTimer = null; renderRunButton(); }
        }, 1000);
      }
    } else {
      runBtn.disabled = !any || !(state && state.workspace && state.workspace.root);
      runBtn.textContent = any ? 'Run selected courts' : 'Select courts to run';
    }
  }

  function renderMutationLive() {
    const m = state.mutations;
    const running = !!(m && m.status === 'running');
    mutationLive.hidden = !running;
    mutationLive.setAttribute('aria-hidden', running ? 'false' : 'true');
    if (!running) return;
    const tested = m.tested != null ? m.tested : null;
    const total = m.total != null ? m.total : null;
    const pct = (tested != null && total) ? Math.min(100, Math.round((tested / total) * 100)) : null;
    mutationLive.querySelector('.mutation-pct').textContent =
      (tested != null ? ` ${tested}${total != null ? '/' + total : ''}` : '') +
      (m.killRate != null ? ` · ${m.killRate}% killed` : '');
    mutationBarFill.style.width = pct != null ? pct + '%' : '0%';
    clear(mutationStats);
    mutationStats.appendChild(el('span', { text: `tested ${tested != null ? tested : '—'}` }));
    mutationStats.appendChild(el('span', { text: `killed ${m.killed != null ? m.killed : '—'}` }));
    if (m.killRate != null) mutationStats.appendChild(el('span', { text: `kill rate ${m.killRate}%` }));
    if (m.line) mutationStats.appendChild(el('span', { className: 'mutation-line', text: m.line }));
  }

  // -- activity feed ------------------------------------------------------------

  const STEP_ICON = { running: null, success: '✓', warn: '⚠', error: '✕', pending: '·' };

  function stepIcon(status) {
    if (status === 'running') {
      const wrap = el('span', { className: 'step-icon', attrs: { 'aria-hidden': 'true' } });
      wrap.appendChild(el('span', { className: 'spinner' }));
      return wrap;
    }
    return el('span', { className: 'step-icon step-' + status, text: STEP_ICON[status] || '·', attrs: { 'aria-hidden': 'true' } });
  }

  function renderFeed(full) {
    if (full) {
      feedEntries = (state.steps || []).slice(-STEP_LIMIT);
      clear(feedList);
    }
    feedEmpty.hidden = feedEntries.length > 0;
    if (full) {
      if (!feedEntries.length) feedList.appendChild(feedEmpty);
      feedEntries.forEach((entry) => feedList.appendChild(buildStepItem(entry)));
    }
    if (feedPinned) feedContainer.scrollTop = feedContainer.scrollHeight;
  }

  function buildStepItem(entry) {
    const done = entry.status === 'success';
    const item = el('li', { className: 'feed-entry feed-' + entry.status });
    item.appendChild(stepIcon(entry.status));
    item.appendChild(el('span', { className: 'feed-text' + (done ? ' feed-done' : ''), text: entry.text }));
    item.appendChild(el('span', { className: 'feed-ts', text: fmtTs(entry.ts) }));
    return item;
  }

  function appendStep(entry) {
    feedEntries.push(entry);
    if (feedEntries.length > STEP_LIMIT) {
      feedEntries.splice(0, feedEntries.length - STEP_LIMIT);
      if (feedList.firstChild && feedList.firstChild !== feedEmpty) feedList.removeChild(feedList.firstChild);
    }
    feedEmpty.hidden = true;
    feedList.appendChild(buildStepItem(entry));
    if (feedPinned) feedContainer.scrollTop = feedContainer.scrollHeight;
  }

  // -- console log drawer ---------------------------------------------------------

  function renderLog(full) {
    if (full) {
      logEntries = (state.log || []).slice(-STEP_LIMIT);
      clear(logList);
      logEntries.forEach((entry) => logList.appendChild(buildLogItem(entry)));
    }
    logSummaryCount.textContent = `(${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'})`;
    if (logPinned) logContainer.scrollTop = logContainer.scrollHeight;
  }

  function buildLogItem(entry) {
    const level = entry.level === 'error' || entry.level === 'warn' ? entry.level : 'info';
    const item = el('li', { className: 'log-entry log-' + level });
    item.appendChild(el('span', { className: 'log-ts', text: fmtTs(entry.ts) }));
    item.appendChild(el('span', { className: 'log-level', text: level.toUpperCase() }));
    item.appendChild(el('span', { className: 'log-text', text: entry.text }));
    return item;
  }

  function appendLog(entry) {
    logEntries.push(entry);
    if (logEntries.length > STEP_LIMIT) {
      logEntries.splice(0, logEntries.length - STEP_LIMIT);
      if (logList.firstChild) logList.removeChild(logList.firstChild);
    }
    logList.appendChild(buildLogItem(entry));
    logSummaryCount.textContent = `(${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'})`;
    if (logPinned) logContainer.scrollTop = logContainer.scrollHeight;
  }

  // -- Report tab -------------------------------------------------------------------

  function pill(text, cls) {
    return el('span', { className: 'pill ' + cls, text });
  }

  function renderReport() {
    const report = state.lastReport;
    // REDLINE row
    const r = report && report.redline && report.redline.summary;
    const rVerdict = scoreRows.REDLINE.verdict;
    clear(rVerdict);
    if (r) {
      rVerdict.appendChild(pill(`${r.green} passed`, 'pill-pass'));
      if (r.red > 0) rVerdict.appendChild(pill(`${r.red} failed`, 'pill-fail'));
      if (r.yellow > 0) rVerdict.appendChild(pill(`${r.yellow} skipped`, 'pill-skip'));
    } else {
      rVerdict.appendChild(el('span', { className: 'score-none', text: 'Not run yet' }));
    }
    // SPLITBRAIN row
    const sb = report && report.splitbrain;
    const sbVerdict = scoreRows.SPLITBRAIN.verdict;
    clear(sbVerdict);
    if (sb && sb.trustGap != null) {
      const gapPct = Math.min(100, Math.max(0, Math.round((sb.trustGap || 0) * 100)));
      sbVerdict.appendChild(pill(`gap ${gapPct}%`, gapPct > 20 ? 'pill-fail' : gapPct > 0 ? 'pill-skip' : 'pill-pass'));
      const barTrack = el('span', { className: 'gap-track' });
      const barFill = el('span', { className: 'gap-fill' });
      barFill.style.width = gapPct + '%';
      barTrack.appendChild(barFill);
      sbVerdict.appendChild(barTrack);
    } else {
      sbVerdict.appendChild(el('span', { className: 'score-none', text: 'Not run yet' }));
    }
    // WARPATH row
    const w = report && report.warpath;
    const wVerdict = scoreRows.WARPATH.verdict;
    clear(wVerdict);
    if (w) {
      if (w.incidentWindow) wVerdict.appendChild(pill('1 incident', 'pill-fail'));
      else wVerdict.appendChild(pill('clear', 'pill-pass'));
    } else {
      wVerdict.appendChild(el('span', { className: 'score-none', text: 'Not run yet' }));
    }
    // Last-run timestamps share the report's generatedAt.
    const stamp = report && report.generatedAt ? 'Last run ' + fmtTs(report.generatedAt) : '';
    for (const c of COURTS) scoreRows[c.id].lastRun.textContent = stamp;

    clear(reportGenerated);
    if (report && report.generatedAt) {
      reportGenerated.appendChild(el('span', { className: 'field-label', text: 'Generated: ' }));
      reportGenerated.appendChild(el('span', { className: 'field-value', text: fmtTs(report.generatedAt) + ' (' + report.generatedAt + ')' }));
    }
  }

  // -- Dashboard tab -----------------------------------------------------------------

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

  // -- Setup tab -----------------------------------------------------------------------

  function renderSetup() {
    const cfg = state.config || { exists: false, path: null };
    configExistsValue.textContent = cfg.exists ? 'found' : 'not found';
    configExistsValue.className = 'field-value ' + (cfg.exists ? 'value-ok' : 'value-warn');
    configPathValue.textContent = cfg.path || '(none)';

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

  // ---------------------------------------------------------------- focus

  const FOCUS_TAB = { run: 'run', report: 'report', dashboard: 'dashboard', config: 'setup', install: 'setup' };

  function focusSection(section, preselect) {
    const tabId = FOCUS_TAB[section] || 'run';
    activateTab(tabId);
    persist({ tab: tabId });
    const panel = panels[tabId];
    if (panel) {
      panel.classList.add('section-highlight');
      setTimeout(() => panel.classList.remove('section-highlight'), 1600);
    }
    if (preselect) {
      if (preselect.court && courtTiles[preselect.court] && !courtTiles[preselect.court].classList.contains('selected')) {
        courtTiles[preselect.court].click();
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

  // Restore persisted court selection (default: all three selected).
  const savedCourts = Array.isArray(persisted.courts) ? persisted.courts : (persisted.court ? [persisted.court] : COURTS.map((c) => c.id));
  savedCourts.forEach((id) => {
    if (courtTiles[id]) {
      courtTiles[id].classList.add('selected');
      courtTiles[id].setAttribute('aria-pressed', 'true');
    }
  });
  // Restore output target.
  if (persisted.outputTarget === 'dashboard') targetDash.checked = true;
  else targetLocal.checked = true;
  // Restore timeout override.
  if (persisted.timeoutSeconds) timeoutInput.value = String(persisted.timeoutSeconds);
  // Restore the active tab.
  activateTab(TABS.some((t) => t.id === persisted.tab) ? persisted.tab : 'run');
  timeoutField.hidden = !selectedCourts().includes('SPLITBRAIN');

  // ------------------------------------------------------------- messages

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'state': {
        const hadJob = !!(state && state.job);
        state = msg.state;
        // A new job clears the feed: state.steps restarts from the host's
        // cleared buffer, so a full re-render shows exactly the new run.
        if (state.job && !hadJob) { feedPinned = true; }
        render();
        break;
      }
      case 'step':
        if (msg.step) {
          const last = feedEntries[feedEntries.length - 1];
          if (msg.replace && last && last.status === 'running' && last.text === msg.step.text) {
            // Coalesced consecutive running step: refresh in place.
            feedEntries[feedEntries.length - 1] = msg.step;
            const node = feedList.lastElementChild;
            if (node && node !== feedEmpty) {
              const ts = node.querySelector('.feed-ts');
              if (ts) ts.textContent = fmtTs(msg.step.ts);
            }
            break;
          }
          if (msg.step.status !== 'pending' && last && last.status === 'pending' && last.text === msg.step.text) {
            // A pending announcement that now starts: replace it in place.
            feedEntries[feedEntries.length - 1] = msg.step;
            if (feedList.lastElementChild && feedList.lastElementChild !== feedEmpty) {
              feedList.removeChild(feedList.lastElementChild);
            }
          }
          appendStep(msg.step);
        }
        break;
      case 'log':
        if (msg.entry) appendLog(msg.entry);
        break;
      case 'error':
        // Never show an empty banner: a missing/blank message is a no-op.
        if (!msg.text || !String(msg.text).trim()) break;
        errorText.textContent = msg.text;
        errorBanner.hidden = false;
        errorBanner.removeAttribute('aria-hidden');
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
