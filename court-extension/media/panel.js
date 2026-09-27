'use strict';
/**
 * Vanilla sidebar, deliberately one local script to preserve the existing CSP.
 * HOST CONTRACT (flat legacy bridge; no new resource registration required):
 * Outbound: ready; runCourt {courts,outputTarget,timeoutSeconds?};
 * cancelRun/publishRun/selectRun/dashboardOpen/openLogs {runId?};
 * openArtifact {runId,artifactId}; loadMoreRuns {offset,limit:10};
 * openFolder/manageTrust; configValidate/configPreview {};
 * configApply {previewId,expectedConfigRevision}; installPreview {host};
 * installApply {previewId,expectedConfigRevision,host}. Every request also has requestId.
 * Old openConfig/openLastReport {format:'html'|'md'} remain compatibility adapters.
 * No detectConfig/installCourts write is dispatched by this UI.
 *
 * state: existing snapshot plus workspace.{id,root,name,trusted}, capabilities
 * (boolean keys matching new message names; cancelRun MUST mean verified process
 * cancellation, publishRun MUST publish persisted evidence without execution),
 * readiness:{courts:{WITNESS:{ready,reason},...},timeoutSeconds,timeoutSource},
 * activeRun/selectedRun/recentRuns[] (RunRecord or lightweight summaries),
 * recentRunsHasMore, config.{exists,path,valid,revision,notes},
 * hosts.{available,labels,configured,detected}, configPreview/installPreview,
 * configValidation/installResult. Summary: record.summary.{label,courts:{ID:
 * {label,verdict,execution,metrics,findings,basis,evidenceSource,evidenceFreshness}}}.
 * Metrics may be named numbers or [{name,value,unit}]; findings may contain
 * {label,reason,testsRun,artifactId}. Artifacts: {artifactId|id,kind,status,error}.
 * Preview: {previewId,expectedConfigRevision,files:[{path,action,content?,diff?}],
 * content?,diff?,replacesExisting?,host?,warnings?}. Revision null is valid for creation.
 * response: {requestId,status:'accepted'|'ok'|'rejected',data?,error?}.
 * data is preview for preview requests, validation/result for other Setup actions.
 * State snapshots may alternatively carry previews/results. Host must reject stale
 * preview tokens and recheck trust/workspace/paths; UI is not a security boundary.
 * Legacy state/step/log/error/focus are accepted. run.event with runId + sequence
 * deduplicates and requests an authoritative snapshot (never merges opaque payloads).
 */
(function () {
  const vscode = acquireVsCodeApi();
  const COURTS = [
    ['WITNESS', 'Verify spec requirements'],
    ['TRUSTGAP', 'Test assertion strength · slower'],
    ['TRIAGE', 'Investigate incident evidence'],
  ];
  const ids = COURTS.map(c => c[0]);
  let saved;
  try { saved = vscode.getState() || {}; } catch (_) { saved = {}; }
  let state = {}, workspaceKey = null, prefs = {}, initialized = false;
  let screen = route(saved.screen || saved.tab), backScreen = 'run';
  let feedPinned = true, consolePinned = true, feedRunId = null;
  let error = '', steps = [], logs = [], serial = 0, announceTimer, refreshTimer;
  const pending = new Map(), sequences = new Map();
  const previews = { config: null, install: null };
  const results = { config: null, install: null };
  const usedPreviews = new Set();
  let recentLimit = 10;
  const root = document.getElementById('root') || document.body.appendChild(document.createElement('div'));
  const live = node('div', { className: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  document.body.appendChild(live);

  function route(value) { return ['setup', 'config', 'install'].includes(value) ? 'setup' : ['report', 'evidence'].includes(value) ? 'evidence' : value === 'dashboard' ? 'dashboard' : 'run'; }
  function node(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'className') n.className = v;
      else if (['disabled', 'checked', 'hidden', 'open'].includes(k)) n[k] = !!v;
      else n.setAttribute(k, String(v));
    });
    children.filter(Boolean).forEach(c => n.appendChild(c));
    return n;
  }
  function text(value, className = '') { return node('p', { text: value, className }); }
  function button(label, id, fn, disabled = false, primary = false) {
    const b = node('button', { type: 'button', id, text: label, disabled, className: primary ? 'btn primary' : 'btn' });
    b.addEventListener('click', () => { if (!b.disabled) fn(); });
    return b;
  }
  function row(children) { return node('div', { className: 'actions' }, children); }
  function details(label, id, children) { return node('details', { id }, [node('summary', { text: label }), ...children]); }
  function heading(label, level = 2) { return node('h' + level, { text: label }); }
  function cap(name) { const c = state.capabilities || {}; return c[name] === true; }
  function hasWorkspace() { return !!(state.workspace && state.workspace.root); }
  function trusted() { return hasWorkspace() && state.workspace.trusted !== false && state.workspace.isTrusted !== false && state.trusted !== false; }
  function active() { const r = state.activeRun; return r && r.lifecycle !== 'completed' && r.lifecycle !== 'interrupted' && r.phase !== 'settled' ? r : null; }
  function busy() { return !!(active() || state.job || pendingType('runCourt')); }
  function pendingType(type) { return [...pending.values()].some(p => p.type === type); }
  function canWrite() { return trusted() && !busy(); }
  function post(type, fields = {}) {
    const requestId = 'ui-' + Date.now().toString(36) + '-' + (++serial);
    vscode.postMessage({ type, ...fields, requestId });
    return requestId;
  }
  function request(type, fields = {}) {
    const requestId = post(type, fields);
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      error = 'No acknowledgement received. Refresh status before retrying; the host may still be working.';
      post('ready'); render();
    }, 30000);
    pending.set(requestId, { type, fields, timer });
    render();
    return requestId;
  }
  function clearPending(id) { const p = pending.get(id); if (p) clearTimeout(p.timer); pending.delete(id); return p; }
  function announce(value) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { if (live.textContent !== value) live.textContent = value; }, 350);
  }
  function persist() {
    const workspaces = { ...(saved.workspaces || {}) };
    if (workspaceKey) workspaces[workspaceKey] = { ...prefs };
    saved = { version: 2, screen, workspaces };
    try { vscode.setState(saved); } catch (_) { /* host state is still authoritative */ }
  }
  function readiness(id) {
    const r = state.readiness || {};
    const value = (r.courts || r)[id] ?? (r.courts || r)[id.toLowerCase()];
    if (typeof value === 'boolean') return { ready: value, reason: value ? 'Ready' : 'Prerequisites unavailable' };
    if (value) return { ready: value.ready === true || value.available === true || value.status === 'ready', reason: value.reason || (value.reasons || []).join(' · ') || (value.ready ? 'Ready' : 'Needs configuration') };
    // Old host: do not mistake a historical verdict for readiness.
    return { ready: !!(state.config && state.config.exists && state.config.valid !== false), reason: state.config && state.config.exists ? 'Readiness checked by host on run' : 'Configuration required' };
  }
  function acceptState(next) {
    const key = next.workspace && (next.workspace.id || next.workspace.workspaceId || next.workspace.root) || '';
    state = next;
    if (key !== workspaceKey) {
      steps = []; logs = []; feedRunId = null; feedPinned = consolePinned = true;
      const first = workspaceKey === null;
      workspaceKey = key;
      Object.keys(previews).forEach(k => { previews[k] = null; results[k] = null; });
      [...pending.keys()].forEach(clearPending); sequences.clear(); usedPreviews.clear(); error = ''; recentLimit = 10;
      prefs = { ...((saved.workspaces || {})[key] || {}) };
      if (first && saved.version !== 2 && !Object.keys(prefs).length) {
        if (Array.isArray(saved.courts)) prefs.courts = saved.courts.filter(c => ids.includes(c));
        else if (ids.includes(saved.court)) prefs.courts = [saved.court];
        // Legacy outputTarget could have been an implicit default. Require a new explicit opt-in.
        if (saved.publishToDashboard === true) prefs.publishToDashboard = true;
        if (saved.timeoutSeconds) prefs.timeout = String(saved.timeoutSeconds);
        if (saved.host) prefs.host = saved.host;
      }
      if (!Array.isArray(prefs.courts)) prefs.courts = readiness('WITNESS').ready ? ['WITNESS'] : [];
      prefs.publishToDashboard = prefs.publishToDashboard === true;
      persist();
    }
    initialized = true;
    const runId = next.activeRun && next.activeRun.runId || (next.job && next.job.kind === 'runCourt' && next.job.startedAt);
    if (runId && runId !== feedRunId) { feedRunId = runId; steps = []; feedPinned = true; }
    if (Array.isArray(next.steps)) steps = next.steps.slice(-200);
    if (Array.isArray(next.log)) logs = next.log.slice(-200);
    if (next.configPreview !== undefined) previews.config = next.configPreview;
    if (next.installPreview !== undefined) previews.install = next.installPreview;
    if (next.configValidation !== undefined) results.config = next.configValidation;
    if (next.installResult !== undefined) results.install = next.installResult;
    for (const [id, p] of pending) {
      if ((p.type === 'runCourt' && (active() || next.job)) ||
          (p.type === 'configPreview' && previews.config) || (p.type === 'installPreview' && previews.install) ||
          (p.type === 'selectRun' && next.selectedRun && next.selectedRun.runId === p.fields.runId)) clearPending(id);
    }
    render();
  }
  function navigate(to, focus = true) {
    const destination = route(to);
    if (['setup', 'dashboard'].includes(destination) && !['setup', 'dashboard'].includes(screen)) backScreen = screen;
    screen = destination; persist(); render();
    if (focus) (document.getElementById(['setup', 'dashboard'].includes(screen) ? 'back-nav' : 'tab-' + screen) || root).focus();
  }
  function fullValue(label, value, id) {
    if (!value) return null;
    return details(label, id, [text(value, 'full-value'), button('Copy ' + label.toLowerCase(), id + '-copy', async () => {
      try { await navigator.clipboard.writeText(String(value)); announce('Copied ' + label.toLowerCase()); }
      catch (_) { error = 'Copy unavailable. Select and copy the value shown above.'; render(); }
    })]);
  }
  function timestamp(value) {
    const d = new Date(value), ms = d.getTime();
    if (!value || !Number.isFinite(ms)) return text('Time unknown', 'muted');
    const age = Math.max(0, Date.now() - ms), mins = Math.floor(age / 60000);
    const relative = mins < 1 ? 'Just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.floor(mins / 60) + ' hr ago' : Math.floor(mins / 1440) + ' days ago';
    return node('time', { datetime: value, text: relative, title: d.toLocaleString(undefined, { timeZoneName: 'short' }), className: 'muted' });
  }
  function render() {
    const focused = document.activeElement, focusId = focused && focused.id;
    const selection = focused && /^(text|number)$/.test(focused.type) ? [focused.selectionStart, focused.selectionEnd] : null;
    const opened = new Set([...root.querySelectorAll('details[open]')].map(n => n.id));
    const scroll = document.documentElement.scrollTop;
    const previousFeed = document.getElementById('activity-feed'), previousConsole = document.getElementById('console-entries');
    const feedTop = previousFeed && previousFeed.scrollTop, consoleTop = previousConsole && previousConsole.scrollTop;
    root.replaceChildren();
    const secondary = screen === 'setup' || screen === 'dashboard';
    const headerActions = secondary
      ? [button('Back', 'back-nav', () => navigate(backScreen))]
      : [button('Dashboard', 'dashboard-nav', () => navigate('dashboard')), button('Setup', 'setup-nav', () => navigate('setup'))];
    const header = node('header', { className: 'header' }, [heading('GAIA', 1), row(headerActions)]);
    root.appendChild(header);
    root.appendChild(node('div', { className: 'workspace-line' }, [text(state.workspace && state.workspace.name || 'No workspace', 'workspace-name'), text(configLabel(), 'muted')]));
    if (error) root.appendChild(node('div', { role: 'alert', className: 'notice error' }, [text(error), button('Dismiss', 'dismiss-error', () => { error = ''; render(); }), button('Refresh status', 'refresh-error', () => post('ready'))]));
    const tabs = node('nav', { role: 'tablist', 'aria-label': 'Gaia sections', className: 'tabs', hidden: secondary });
    const tabIds = ['run', 'evidence'];
    tabIds.forEach((id, index) => {
      const b = button(id === 'run' ? 'Run' : 'Evidence', 'tab-' + id, () => navigate(id));
      b.setAttribute('aria-label', id === 'run' ? 'Run' : 'Evidence');
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(screen === id));
      b.setAttribute('aria-controls', 'panel-' + id); b.tabIndex = screen === id ? 0 : -1;
      b.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); navigate(e.key === 'Home' ? 'run' : e.key === 'End' ? 'evidence' : tabIds[1 - index]);
      }); tabs.appendChild(b);
    });
    root.appendChild(tabs);
    const main = node('main'); root.appendChild(main);
    if (!initialized) main.appendChild(text('Loading workspace…', 'muted'));
    else {
      if (!hasWorkspace()) main.appendChild(node('div', { className: 'notice' }, [text('Open a workspace folder to configure and run courts.'), button('Open folder', 'open-folder', () => post('openFolder'), !cap('openFolder'))]));
      else if (!trusted()) main.appendChild(node('div', { className: 'notice warning' }, [text('Workspace is untrusted. Commands and configuration writes are disabled.'), button('Manage workspace trust', 'manage-trust', () => post('manageTrust'), !cap('manageTrust'))]));
      ['run', 'evidence', 'dashboard', 'setup'].forEach(id => {
        const panel = node('section', { id: 'panel-' + id, role: ['run', 'evidence'].includes(id) ? 'tabpanel' : 'region', 'aria-labelledby': ['run', 'evidence'].includes(id) ? 'tab-' + id : null, hidden: screen !== id });
        main.appendChild(panel);
        if (id === screen) ({ run: renderRun, evidence: renderEvidence, dashboard: renderDashboard, setup: renderSetup })[id](panel);
      });
    }

    opened.forEach(id => { const n = document.getElementById(id); if (n) n.open = true; });
    const replacement = focusId && document.getElementById(focusId);
    if (replacement && !replacement.disabled && !replacement.closest('[hidden]')) {
      replacement.focus({ preventScroll: true });
      if (selection && selection[0] !== null) try { replacement.setSelectionRange(...selection); } catch (_) { /* number inputs */ }
    }
    document.documentElement.scrollTop = scroll;
    const feed = document.getElementById('activity-feed'), consoleBox = document.getElementById('console-entries');
    if (feed) feed.scrollTop = feedPinned ? feed.scrollHeight : feedTop || 0;
    if (consoleBox) consoleBox.scrollTop = consolePinned ? consoleBox.scrollHeight : consoleTop || 0;
  }
  function configLabel() {
    if (!hasWorkspace()) return '';
    if (!trusted()) return 'Trust required';
    const c = state.config || {};
    return c.valid === true ? 'Config ready' : c.valid === false ? 'Config needs attention' : c.exists ? 'Config found · not validated' : 'Config required';
  }
  function renderRun(panel) {
    const frozen = busy();
    const fields = node('fieldset', { className: 'court-picker', disabled: frozen || !trusted() }, [node('legend', { text: 'Choose courts' })]);
    COURTS.forEach(([id, desc]) => {
      const r = readiness(id), checked = prefs.courts.includes(id);
      const input = node('input', { type: 'checkbox', id: 'court-' + id, checked, disabled: frozen || !trusted() || (!r.ready && !checked), 'aria-describedby': 'ready-' + id });
      input.addEventListener('change', () => { prefs.courts = ids.filter(c => c === id ? input.checked : prefs.courts.includes(c)); persist(); render(); });
      fields.appendChild(node('div', { className: 'court-choice' }, [node('label', { for: input.id, className: 'check-label' }, [input, node('span', {}, [node('strong', { text: id }), node('span', { text: desc, className: 'description' })])]), node('div', { className: 'readiness', id: 'ready-' + id }, [node('span', { className: r.ready ? 'muted' : 'warning', text: r.ready ? r.reason : 'Not ready · ' + r.reason }), !r.ready ? button('Configure', 'configure-' + id, () => navigate('setup')) : null])]));
    });
    panel.appendChild(fields);
    const publish = node('input', { type: 'checkbox', id: 'publish-toggle', checked: prefs.publishToDashboard, disabled: frozen || !trusted() || !cap('publishRun') });
    publish.addEventListener('change', () => { prefs.publishToDashboard = publish.checked; persist(); render(); });
    panel.appendChild(node('label', { className: 'check-label', for: publish.id }, [publish, node('span', { text: 'Also publish to local dashboard' })]));
    panel.appendChild(text('Reports are always saved locally.' + (!cap('publishRun') ? ' Dashboard publication requires an updated host.' : ''), 'muted hint'));
    const timeout = node('input', { type: 'number', id: 'timeout-input', min: 1, step: 1, value: prefs.timeout || '', disabled: frozen || !trusted() || !cap('timeoutOverride'), 'aria-describedby': 'timeout-effective' });
    timeout.addEventListener('input', () => { prefs.timeout = timeout.value; persist(); updateRunButton(); });
    const defaults = state.readiness || {}, cfg = state.config || {};
    const effective = defaults.timeoutSeconds ?? cfg.timeoutSeconds ?? 900;
    const source = defaults.timeoutSource || cfg.timeoutSource || 'host default (fallback)';
    const advanced = details('Options', 'advanced', [text('Effective mutation timeout: ' + (prefs.timeout || effective) + ' seconds · ' + (prefs.timeout ? 'per-run override' : source), 'muted'), node('label', { for: timeout.id, text: 'Timeout override (seconds)' }), timeout, text(cap('timeoutOverride') ? 'Leave blank to use ' + effective + ' seconds from ' + source + '.' : 'Per-run overrides are unavailable; change mutation.timeoutSeconds in the configuration to adjust the runner.', 'muted')]);
    advanced.querySelector('p').id = 'timeout-effective'; panel.appendChild(advanced);
    panel.appendChild(button('', 'run-btn', startRun, false, true));
    panel.appendChild(text('', 'warning'));
    panel.lastChild.id = 'run-reason'; updateRunButton();
    const current = active();
    if (current) renderProgress(panel, current);
    else if (state.job) panel.appendChild(node('section', { className: 'run-card' }, [heading(state.job.label || 'Working…'), text('Host job in progress · ' + elapsed(state.job.startedAt)), logsButton(null)]));
    const last = latestRun();
    if (!current && last) renderRunCard(panel, last);
    renderActivity(panel);
  }
  function renderActivity(panel) {
    const area = node('section', { className: 'activity-area', 'aria-label': 'Run activity' }, [heading('Run activity', 3)]);
    const feed = node('ol', { className: 'activity-list', id: 'activity-feed', 'aria-label': 'Live run steps' });
    if (!steps.length) feed.appendChild(node('li', { className: 'activity-empty muted', text: 'Run steps will appear here.' }));
    steps.forEach(s => {
      const status = ['running', 'success', 'warn', 'error', 'pending'].includes(s.status) ? s.status : 'pending';
      const icon = { running: '◌', success: '✓', warn: '⚠', error: '✕', pending: '·' }[status];
      const time = new Date(s.ts);
      const stamp = Number.isFinite(time.getTime()) ? time.toLocaleTimeString() : '';
      const item = node('li', { className: 'activity-step step-' + status }, [
        node('span', { className: 'step-icon', 'aria-hidden': 'true', text: icon }),
        node('span', { className: 'step-copy', text: s.text || '' }),
        node('time', { datetime: Number.isFinite(time.getTime()) ? s.ts : undefined, text: stamp, title: Number.isFinite(time.getTime()) ? time.toLocaleString() : '' }),
      ]);
      if (status === 'running' && s === steps.at(-1) && busy()) item.querySelector('.step-copy').appendChild(node('span', { className: 'step-elapsed', 'data-start': s.ts, text: ' · ' + elapsed(s.ts) }));
      feed.appendChild(item);
    });
    feed.addEventListener('scroll', () => { feedPinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24; });
    area.appendChild(feed);
    const drawer = details('Console log (' + logs.length + ' entries)', 'console-log', []);
    const consoleBox = node('div', { id: 'console-entries', className: 'console-entries', role: 'log', 'aria-label': 'Raw host log' });
    logs.forEach(entry => {
      const d = new Date(entry.ts);
      const stamp = Number.isFinite(d.getTime()) ? d.toLocaleTimeString() : '';
      consoleBox.appendChild(node('div', { className: 'console-line', text: [stamp, (entry.level || 'info').toUpperCase(), entry.text || ''].join(' · ') }));
    });
    consoleBox.addEventListener('scroll', () => { consolePinned = consoleBox.scrollHeight - consoleBox.scrollTop - consoleBox.clientHeight < 24; });
    drawer.appendChild(consoleBox); area.appendChild(drawer);
    panel.appendChild(area);
  }
  function validTimeout() { return !prefs.timeout || (Number.isInteger(Number(prefs.timeout)) && Number(prefs.timeout) > 0); }
  function runReason() {
    if (!trusted()) return hasWorkspace() ? 'Trust this workspace before running.' : 'Open a folder before running.';
    if (busy()) return 'Selection and settings are frozen while the host is working.';
    if (!prefs.courts.length) return 'Select at least one ready court.';
    if (prefs.courts.some(id => !readiness(id).ready)) return 'Review selected courts that are no longer ready. Configure them or uncheck them.';
    if (!validTimeout()) return 'Timeout must be a positive whole number of seconds.';
    if (prefs.timeout && !cap('timeoutOverride')) return 'Per-run timeout overrides are unavailable. Clear the saved override or change the configuration.';
    if (prefs.publishToDashboard && !cap('publishRun')) return 'Dashboard publication is unavailable. Turn it off in an updated host or restore publication support.';
    return '';
  }
  function updateRunButton() {
    const b = document.getElementById('run-btn'), reason = runReason();
    if (!b) return;
    b.disabled = !!reason;
    b.textContent = pendingType('runCourt') ? 'Starting…' : busy() ? '◌ Running…' : 'Run selected courts';
    b.setAttribute('aria-describedby', 'run-reason');
    const hint = document.getElementById('run-reason'); if (hint) { hint.textContent = reason; hint.hidden = !reason; }
  }
  function startRun() {
    if (runReason()) return;
    const fields = { courts: [...prefs.courts], outputTarget: prefs.publishToDashboard ? 'dashboard' : 'local' };
    if (prefs.timeout) fields.timeoutSeconds = Number(prefs.timeout);
    request('runCourt', fields);
  }
  function elapsed(start) { const n = Date.parse(start); if (!Number.isFinite(n)) return ''; const s = Math.max(0, Math.floor((Date.now() - n) / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + s % 60 + 's'; }
  function renderProgress(panel, run) {
    const box = node('section', { className: 'run-card', 'aria-label': 'Active run' }, [heading('Running ' + (run.requestedCourts || []).length + ' courts'), text(run.phase || 'executing', 'muted'), node('span', { id: 'elapsed', text: elapsed(run.startedAt), 'data-start': run.startedAt })]);
    (run.requestedCourts || ids.filter(id => outcome(run, id).execution !== 'not_run')).forEach(id => {
      const c = outcome(run, id), p = c.progress || {}, status = c.execution || 'queued';
      box.appendChild(text(id + ' · ' + status + (p.phase ? ' · ' + p.phase : ''), status === 'error' ? 'error' : ''));
      const counts = [];
      if (Number.isFinite(p.tested)) counts.push(p.tested + (Number.isFinite(p.total) ? ' / ' + p.total : '') + ' tested');
      if (Number.isFinite(p.killed)) counts.push(p.killed + ' killed');
      if (counts.length) box.appendChild(text(counts.join(' · '), 'muted'));
      if (Number.isFinite(p.tested) && Number.isFinite(p.total) && p.total > 0 && p.tested >= 0 && p.tested <= p.total && p.reliableTotal !== false) box.appendChild(node('progress', { max: p.total, value: p.tested, 'aria-label': id + ' tested mutations', 'aria-valuetext': p.tested + ' of ' + p.total + ' tested' }));
    });
    box.appendChild(text('Submitted: ' + (run.requestedCourts || []).join(', ') + (run.settings ? ' · ' + (run.settings.publishToDashboard ? 'Publish requested' : 'Local only') : ''), 'muted'));
    box.appendChild(row([cap('cancelRun') ? button(pendingType('cancelRun') || run.cancellationRequested ? 'Stopping…' : 'Stop run', 'stop-run', () => request('cancelRun', { runId: run.runId }), pendingType('cancelRun') || run.cancellationRequested || !trusted()) : null, logsButton(run)]));
    panel.appendChild(box); announce('Run ' + (run.phase || 'in progress'));
  }
  function logsButton(run) {
    return button('View logs', 'logs-' + (run && run.runId || 'current'), () => {
      if (cap('openLogs')) post('openLogs', run && run.runId ? { runId: run.runId } : {});
      else { const d = details('Recent host logs', 'legacy-logs', logs.slice(-30).map(e => text((e.level || 'info') + ' · ' + e.text, 'full-value'))); d.open = true; const p = document.getElementById('panel-' + screen); const old = document.getElementById('legacy-logs'); if (old) old.remove(); p.appendChild(d); d.querySelector('summary').focus(); }
    }, !hasWorkspace());
  }
  function latestRun() { return state.latestRun || (state.recentRuns || [])[0] || (state.activeRun && !active() ? state.activeRun : null) || state.lastReport || null; }
  function selectedRun() { return state.selectedRun || latestRun(); }
  function outcome(run, id) {
    return (run.courts || {})[id] || (run.courts || {})[id.toLowerCase()] || run[id.toLowerCase()] || { execution: 'not_run', verdict: 'unknown' };
  }
  function metricMap(value) {
    if (Array.isArray(value)) return Object.fromEntries(value.filter(m => m && m.name).map(m => [m.name, m.value]));
    return Object.fromEntries(Object.entries(value || {}).map(([k, v]) => [k, v && typeof v === 'object' ? v.value : v]));
  }
  function courtSummary(run, id) {
    const c = outcome(run, id), p = c.payload || c;
    const supplied = (run.summary && run.summary.courts || run.summaries || {})[id] || (typeof c.summary === 'object' && (c.summary.label || c.summary.verdict) ? c.summary : {});
    const m = { ...metricMap(p.metrics), ...metricMap(c.metrics), ...metricMap(supplied.metrics) };
    const execution = supplied.execution || c.execution || c.kind || 'complete';
    let verdict = supplied.verdict || c.verdict || 'unknown', label = supplied.label || supplied.text || '';
    const tests = m.testsRun ?? m.testsExecuted ?? p.testsRun ?? p.testsExecuted ?? (p.summary || {}).testsRun;
    if (execution === 'error' || c.kind === 'error') { verdict = 'error'; label = label || message(c.error) || 'Execution error'; }
    else if (execution === 'not_run') { verdict = 'unknown'; label = 'Not run'; }
    else if (['queued', 'running', 'cancelled', 'unavailable'].includes(execution)) { verdict = execution === 'unavailable' || execution === 'cancelled' ? 'inconclusive' : 'unknown'; label = label || ({ cancelled: 'Stopped · partial evidence', unavailable: 'Inputs unavailable', queued: 'Queued', running: 'Running' })[execution]; }
    else if (id === 'WITNESS') {
      const s = p.summary || {}, red = m.failed ?? s.red, yellow = m.incomplete ?? s.yellow;
      if (tests === 0) { verdict = 'inconclusive'; label = 'Inconclusive · zero tests executed'; }
      else if (red > 0) { verdict = 'findings'; label = label || red + ' failed' + (yellow > 0 ? ' · ' + yellow + ' incomplete' : ''); }
      else if (yellow > 0) { verdict = 'inconclusive'; label = label || yellow + ' incomplete'; }
      else if (!label) { label = verdict === 'pass' ? 'Passed · verified by host' : 'Inconclusive · test execution not verified'; if (verdict !== 'pass') verdict = 'inconclusive'; }
    } else if (id === 'TRUSTGAP') {
      if (p.trustGap !== undefined && m.trustGap === undefined) m.trustGap = p.trustGap;
      if (p.claimedCoverage !== undefined && m.claimedCoverage === undefined) m.claimedCoverage = p.claimedCoverage;
      if (p.mutationScore !== undefined && m.mutationScore === undefined) m.mutationScore = p.mutationScore;
      if (p.survivors !== undefined && m.survivors === undefined && typeof p.survivors === 'number') m.survivors = p.survivors;
      label = label || (Number.isFinite(m.trustGap) ? 'Trust gap ' + number(m.trustGap) + ' pp' : 'Inconclusive · mutation evidence unavailable');
      if (!Number.isFinite(m.trustGap) && verdict === 'unknown') verdict = 'inconclusive';
    } else if (id === 'TRIAGE' && !label) {
      if (p.incidentWindow) { label = 'Incident detected'; verdict = 'findings'; }
      else { label = 'Inconclusive · insufficient incident signal'; verdict = 'inconclusive'; }
    }
    return { ...supplied, label: label || 'Evidence unavailable', verdict, execution, metrics: m, tests, basis: supplied.basis || c.basis, findings: supplied.findings || c.findings || p.clauses || p.verdicts || [], evidenceSource: supplied.evidenceSource || c.evidenceSource || 'unknown', evidenceFreshness: supplied.evidenceFreshness || c.evidenceFreshness || 'unknown', errors: c.errors || [] };
  }
  function number(v) { return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'Unavailable'; }
  function runLabel(run) {
    const summaries = (run.requestedCourts || ids).map(id => courtSummary(run, id));
    if (run.lifecycle === 'interrupted') return 'Stopped — partial evidence';
    if (summaries.some(c => c.verdict === 'error' || c.execution === 'error')) return 'Finished with execution errors';
    if (summaries.some(c => c.verdict === 'findings')) return 'Completed — findings need attention';
    if (summaries.some(c => c.verdict === 'inconclusive' || (c.execution !== 'not_run' && c.verdict === 'unknown'))) return 'Completed — incomplete evidence';
    return run.summary && run.summary.label || (summaries.some(c => c.verdict === 'pass') ? 'Completed — no issues found' : 'Evidence available · outcome unknown');
  }
  function renderRunCard(panel, run) {
    const box = node('section', { className: 'run-card' }, [heading('Latest run'), timestamp(run.finishedAt || run.generatedAt || run.startedAt), text(runLabel(run))]);
    (run.requestedCourts || ids).forEach(id => box.appendChild(text(id + ' · ' + courtSummary(run, id).label, 'compact')));
    box.appendChild(button('View evidence', 'view-evidence', () => { navigate('evidence'); if (run.runId && cap('selectRun')) request('selectRun', { runId: run.runId }); }));
    renderPublication(box, run, 'latest'); panel.appendChild(box); announce(runLabel(run));
  }
  function renderPublication(panel, run, prefix) {
    const p = run.publication || { state: 'not_requested' };
    const label = { not_requested: 'Local evidence · not published', pending: 'Dashboard publication pending', publishing: 'Publishing saved evidence…', published: 'Published to local dashboard', failed: 'Evidence saved · dashboard publish failed' }[p.state] || 'Publication status unknown';
    const box = node('section', { id: prefix + '-publication', className: 'publication', tabindex: -1 }, [text(label, p.state === 'failed' ? 'warning' : 'muted')]);
    if (p.error) box.appendChild(text(message(p.error), 'warning'));
    if (p.state === 'published') box.appendChild(button('Open dashboard', prefix + '-dashboard', () => post('dashboardOpen', run.runId ? { runId: run.runId } : {}), !hasWorkspace()));
    else if (run.runId && !['pending', 'publishing'].includes(p.state)) box.appendChild(button(p.state === 'failed' ? 'Retry publish' : 'Publish to local dashboard', prefix + '-publish', () => request('publishRun', { runId: run.runId }), !cap('publishRun') || !canWrite() || pendingType('publishRun')));
    panel.appendChild(box);
  }
  function renderEvidence(panel) {
    panel.appendChild(heading('Report'));
    const score = node('section', { className: 'scorecard', 'aria-label': 'Latest court verdicts' });
    const latest = latestRun();
    COURTS.forEach(([id]) => {
      const c = latest && courtSummary(latest, id);
      const verdict = c && c.execution !== 'not_run' ? c.label : 'Not run yet';
      const tone = !c || c.execution === 'not_run' ? 'muted' : ['error', 'findings'].includes(c.verdict) ? 'error' : c.verdict === 'pass' ? 'pass' : 'warning';
      score.appendChild(node('div', { className: 'score-row' }, [node('strong', { text: id }), node('span', { className: 'verdict ' + tone, text: verdict }), latest && c && c.execution !== 'not_run' ? timestamp(latest.finishedAt || latest.generatedAt || latest.startedAt) : null]));
    });
    panel.appendChild(score);
    const run = selectedRun();
    if (!run) { /* Scorecard already communicates the empty state. */ }
    else {
      panel.appendChild(text(runLabel(run)));
      if (pendingType('selectRun')) panel.appendChild(text('Loading selected run…', 'muted'));
      panel.appendChild(timestamp(run.finishedAt || run.generatedAt || run.startedAt));
      panel.appendChild(fullValue('Run details', [run.runId ? 'Run ' + run.runId : 'Legacy report · run identity unknown', run.finishedAt || run.generatedAt || run.startedAt, run.workspaceId].filter(Boolean).join('\n'), 'run-details'));
      COURTS.forEach(([id]) => renderCourt(panel, run, id));
      renderExports(panel, run); renderPublication(panel, run, 'evidence'); panel.appendChild(logsButton(run));
    }
    const recent = Array.isArray(state.recentRuns) ? state.recentRuns : [];
    panel.appendChild(heading('Recent runs'));
    const list = node('ul', { className: 'recent-runs' });
    recent.slice(0, recentLimit).forEach((r, i) => {
      const b = button(runLabel(r), 'recent-' + i, () => request('selectRun', { runId: r.runId }), !r.runId || !cap('selectRun') || pendingType('selectRun'));
      if (run && r.runId === run.runId) b.setAttribute('aria-current', 'true');
      list.appendChild(node('li', {}, [b, timestamp(r.finishedAt || r.startedAt)]));
    }); panel.appendChild(list);
    if (recent.length > recentLimit || state.recentRunsHasMore) panel.appendChild(button('Load more runs', 'load-more', () => { recentLimit += 10; if (recent.length < recentLimit) request('loadMoreRuns', { offset: recent.length, limit: 10 }); else render(); }, pendingType('loadMoreRuns') || (recent.length <= recentLimit && !cap('loadMoreRuns'))));
  }
  function renderDashboard(panel) {
    const dashboard = state.dashboard || {}, connected = dashboard.connected === true;
    panel.appendChild(node('div', { className: 'connection ' + (connected ? 'pass' : 'warning'), text: connected ? '● Connected to local dashboard' : '○ Dashboard disconnected' }));
    if (connected && dashboard.url) panel.appendChild(fullValue('Dashboard URL', dashboard.url, 'dashboard-url'));
    panel.appendChild(row([button('Open dashboard', 'dashboard-open', () => post('dashboardOpen'), !trusted() || !connected || !dashboard.url, true), button('Refresh status', 'dashboard-refresh', () => post('ready'))]));
    if (!connected) panel.appendChild(text('Start the local server without running any courts. Refresh status after reconnecting; saved runs remain available in Report.', 'muted'));
    if (!connected) panel.appendChild(button('Start local dashboard', 'dashboard-start', () => request('dashboardStart'), !canWrite() || pendingType('dashboardStart')));
    const run = selectedRun();
    if (run) renderPublication(panel, run, 'dashboard');
  }
  function renderCourt(panel, run, id) {
    const s = courtSummary(run, id);
    const box = node('article', { className: 'court-evidence', id: 'evidence-' + id }, [heading(id, 3), text(s.label, 'verdict ' + (['error', 'findings'].includes(s.verdict) ? 'error' : s.verdict === 'pass' ? 'pass' : 'warning'))]);
    if (s.basis) box.appendChild(text(typeof s.basis === 'string' ? s.basis : JSON.stringify(s.basis), 'muted'));
    if (s.tests !== undefined && s.tests !== null) box.appendChild(text(s.tests + ' tests executed'));
    const metricLabels = { claimedCoverage: ['Claimed coverage', '%'], mutationScore: ['Mutation score', '%'], trustGap: ['Trust gap', ' pp'], survivors: ['Survivors', ''], survivorCount: ['Survivors', ''] };
    Object.entries(metricLabels).forEach(([key, [label, unit]]) => { if (Number.isFinite(s.metrics[key])) box.appendChild(text(label + ' ' + number(s.metrics[key]) + unit)); });
    if (s.metrics.trustGap < 0) box.appendChild(text('Negative gap: mutation score exceeds claimed coverage. This is not a pass/fail threshold.', 'muted'));
    box.appendChild(text('Source: ' + s.evidenceSource + ' · Freshness: ' + s.evidenceFreshness, 'muted'));
    const c = outcome(run, id);
    if (c.sourceGeneratedAt) box.appendChild(fullValue('Source timestamp', c.sourceGeneratedAt, 'source-' + id));
    const findings = Array.isArray(s.findings) ? s.findings : [];
    if (findings.length) box.appendChild(details('Clause findings (' + findings.length + ')', 'findings-' + id, findings.slice(0, 50).map((f, i) => {
      if (typeof f === 'string') return text(f);
      const zero = f.testsRun === 0 || f.testsExecuted === 0;
      const item = node('div', { className: 'finding' }, [text((f.label || f.clauseId || f.id || 'Finding') + ' · ' + (zero ? 'Inconclusive · zero tests executed' : f.reason || f.verdict || f.status || 'Evidence unavailable')), f.testsRun !== undefined ? text(f.testsRun + ' tests executed', 'muted') : null]);
      if (f.artifactId && run.runId) item.appendChild(button('Open source / test', 'finding-' + id + '-' + i, () => post('openArtifact', { runId: run.runId, artifactId: f.artifactId }), !cap('openArtifact')));
      return item;
    }).concat(findings.length > 50 ? [text('Showing 50 findings. Open the report for all findings.', 'muted')] : [])));
    (Array.isArray(s.errors) ? s.errors : []).forEach(e => box.appendChild(text(message(e), 'error')));
    panel.appendChild(box);
  }
  function renderExports(panel, run) {
    const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
    const children = [];
    [['html', 'HTML report'], ['md', 'Markdown'], ['json', 'JSON'], ['folder', 'Reveal report folder']].forEach(([kind, label]) => {
      const a = artifacts.find(a => a.kind === kind || (kind === 'md' && a.kind === 'markdown') || (kind === 'json' && a.kind === 'canonical'));
      const aid = a && (a.artifactId || a.id);
      const available = a && !['failed', 'error', 'pending', 'unavailable'].includes(a.status || a.generationStatus) && aid && run.runId && cap('openArtifact');
      const legacy = !run.runId && ['html', 'md'].includes(kind) && run[kind + 'Path'];
      const reason = available || legacy ? '' : a && a.error ? message(a.error) : 'Not available for this run';
      const b = button(label, 'export-' + kind, () => available ? post('openArtifact', { runId: run.runId, artifactId: aid }) : post('openLastReport', { format: kind }), !hasWorkspace() || (!available && !legacy));
      b.setAttribute('aria-describedby', 'export-reason-' + kind);
      children.push(node('div', { className: 'export-row' }, [b, node('span', { id: 'export-reason-' + kind, text: reason, className: 'muted' })]));
    }); panel.appendChild(details('Exports', 'exports', children));
  }
  function message(value) { return typeof value === 'string' ? value : value && (value.message || value.error || value.text) || ''; }
  function renderSetup(panel) {
    panel.appendChild(node('h2', { id: 'setup-title', tabindex: -1, text: 'Setup' }));
    const cfg = state.config || {}, hosts = state.hosts || {};
    panel.appendChild(heading('Configuration', 3)); panel.appendChild(text(configLabel()));
    if (cfg.path) panel.appendChild(fullValue('Configuration path', cfg.path, 'config-path'));
    (cfg.notes || []).forEach(n => panel.appendChild(text(message(n), 'muted')));
    panel.appendChild(row([button('Validate configuration', 'config-validate', () => request('configValidate'), !canWrite() || !cap('configValidate') || pendingType('configValidate')), button('Open config', 'config-open', () => post('openConfig'), !hasWorkspace() || !cfg.exists)]));
    panel.appendChild(button(cfg.exists ? 'Re-detect…' : 'Create configuration', 'config-preview', () => { previews.config = null; request('configPreview'); }, !canWrite() || !cap('configPreview') || pendingType('configPreview')));
    panel.appendChild(text('Validation is read-only. Preview detected values and file changes before applying. Replacement must retain a recoverable backup.', 'muted'));
    if (!cap('configPreview')) panel.appendChild(text('Safe configuration preview requires an updated host. No automatic writes will be performed.', 'warning'));
    renderResult(panel, results.config, 'config'); renderPreview(panel, 'config');
    panel.appendChild(heading('Court readiness', 3));
    COURTS.forEach(([id]) => { const r = readiness(id); panel.appendChild(text(id + ' · ' + r.reason, r.ready ? 'muted' : 'warning')); });
    panel.appendChild(heading('Optional agent integration', 3));
    panel.appendChild(text('Writes host prompts and MCP configuration. This does not supply or call a model, and is not required to run courts.', 'muted'));
    const host = node('select', { id: 'host-select', disabled: !canWrite() || pendingType('installApply') }, [node('option', { value: '', text: 'Choose a host…' })]);
    const available = Array.isArray(hosts.available) ? hosts.available : [];
    available.forEach(id => host.appendChild(node('option', { value: id, text: id === 'all' ? 'All hosts' : (hosts.labels || {})[id] || id })));
    // Never interpret legacy default:'all' as an explicit preference.
    const preferred = prefs.host || hosts.configured || hosts.detected || (hosts.default !== 'all' ? hosts.default : '');
    host.value = available.includes(preferred) ? preferred : '';
    host.addEventListener('change', () => { prefs.host = host.value; previews.install = null; results.install = null; persist(); render(); });
    panel.appendChild(node('label', { for: host.id, text: 'Integration host' })); panel.appendChild(host);
    panel.appendChild(button('Preview integration files', 'install-preview', () => { previews.install = null; request('installPreview', { host: host.value }); }, !canWrite() || !host.value || !cap('installPreview') || pendingType('installPreview')));
    if (!cap('installPreview')) panel.appendChild(text('Integration preview requires an updated host. No files will be written without a preview.', 'warning'));
    renderPreview(panel, 'install'); renderResult(panel, results.install, 'install');
  }
  function renderPreview(panel, kind) {
    const p = previews[kind]; if (!p) return;
    const type = kind === 'config' ? 'configApply' : 'installApply';
    const revision = p.expectedConfigRevision !== undefined ? p.expectedConfigRevision : p.configRevision;
    const stale = p.stale || (state.config && state.config.revision !== undefined && revision !== undefined && state.config.revision !== revision);
    // Revision null is valid for creating a config that does not exist yet;
    // integration previews carry no revision at all. Invalid only when the
    // token is gone, the token was already applied, or the config changed.
    const revisionMissing = kind === 'config' && !p.missingConfig && typeof revision !== 'string';
    const valid = !!p.previewId && !revisionMissing && !usedPreviews.has(p.previewId) && !stale;
    const box = node('section', { className: 'preview', id: kind + '-preview-result' }, [heading(kind === 'config' ? 'Configuration preview' : 'Integration preview', 3)]);
    if (stale) box.appendChild(text('This preview is stale. Preview again before applying.', 'warning'));
    if (p.content || p.diff) box.appendChild(node('pre', { text: p.diff || p.content }));
    (p.files || []).forEach((f, i) => box.appendChild(details((f.action || 'Write') + ' · ' + (f.path || f), kind + '-file-' + i, [node('pre', { text: f.diff || f.content || f.path || f })])));
    (p.warnings || []).forEach(w => box.appendChild(text(message(w), 'warning')));
    const confirm = node('input', { type: 'checkbox', id: kind + '-confirm', disabled: !valid || !canWrite() || pendingType(type) });
    const apply = button(p.replacesExisting || (kind === 'config' && state.config && state.config.exists) ? 'Replace configuration' : kind === 'config' ? 'Create configuration' : 'Install integration', kind + '-apply', () => {
      if (!confirm.checked || !valid || !canWrite()) return;
      const fields = { previewId: p.previewId, expectedConfigRevision: revision };
      if (kind === 'install') fields.host = p.host || prefs.host || (document.getElementById('host-select') || {}).value;
      request(type, fields);
    }, true, true);
    confirm.addEventListener('change', () => { apply.disabled = !confirm.checked || !valid || !canWrite() || !cap(type) || pendingType(type); });
    box.appendChild(node('label', { for: confirm.id, className: 'check-label' }, [confirm, node('span', { text: kind === 'config' && state.config && state.config.exists ? 'I reviewed these changes and confirm replacement with a backup.' : 'I reviewed and approve these file writes.' })]));
    box.appendChild(row([apply, button('Discard preview', kind + '-discard', () => { previews[kind] = null; render(); }, pendingType(type))]));
    if (!valid && !stale) box.appendChild(text('Preview token or revision unavailable, or preview already used. Preview again.', 'warning'));
    panel.appendChild(box);
  }
  function renderResult(panel, result, kind) {
    if (!result) return;
    const box = node('section', { role: 'status', className: 'notice' }, [text(message(result) || (result.valid === true ? 'Configuration valid' : result.valid === false ? 'Configuration needs attention' : 'Host operation finished. Review file results below.'))]);
    (result.errors || result.failures || []).forEach(e => box.appendChild(text(message(e), 'error')));
    (result.files || []).forEach(f => box.appendChild(text((f.path || f.file || 'File') + ' · ' + (f.status || (f.error ? 'failed' : 'status unknown')) + (f.error ? ' · ' + message(f.error) : ''), f.error || f.status === 'failed' ? 'error' : '')));
    if (result.partial || (result.failures || []).length) box.appendChild(text('Partial ' + (kind === 'install' ? 'installation' : 'completion') + ' — some writes failed.', 'warning'));
    panel.appendChild(box);
  }
  window.addEventListener('message', event => {
    const m = event.data; if (!m || typeof m.type !== 'string') return;
    if (m.type === 'state' && m.state) acceptState(m.state);
    else if (m.type === 'focus') {
      const p = m.preselect || {};
      if (p.host) prefs.host = p.host;
      if (p.court && ids.includes(p.court) && !busy()) prefs.courts = [...new Set([...(prefs.courts || []), p.court])];
      navigate(route(m.section));
      if (m.section === 'dashboard') { const n = document.getElementById('dashboard-open') || document.getElementById('dashboard-start'); if (n && !n.disabled) n.focus(); }
      if (m.section === 'install') { const n = document.getElementById('host-select'); if (n) n.focus(); }
    } else if (m.type === 'error') { error = m.text || message(m.error) || 'Host operation failed'; [...pending.keys()].forEach(clearPending); render(); }
    else if (m.type === 'step' && m.step) { if (m.replace && steps.length) steps[steps.length - 1] = m.step; else steps.push(m.step); steps = steps.slice(-200); render(); }
    else if (m.type === 'log' && m.entry) { logs.push(m.entry); logs = logs.slice(-200); if (screen === 'run') render(); }
    else if (m.type === 'response') {
      const p = pending.get(m.requestId); if (!p) return;
      if (m.status === 'accepted') { announce('Request accepted'); return; }
      clearPending(m.requestId);
      if (m.status === 'rejected' || m.error) {
        error = message(m.error) || 'Request rejected';
        if (p.type === 'configApply') previews.config = null;
        if (p.type === 'installApply') previews.install = null;
      } else {
        const data = m.data || {};
        if (p.type === 'configPreview') previews.config = data.preview || data;
        if (p.type === 'installPreview') previews.install = data.preview || data;
        if (p.type === 'configValidate') results.config = data;
        if (p.type === 'configApply' || p.type === 'installApply') { const kind = p.type === 'configApply' ? 'config' : 'install'; usedPreviews.add(p.fields.previewId); previews[kind] = null; results[kind] = data; post('ready'); }
        if (p.type === 'selectRun' && data.run) state.selectedRun = data.run;
      }
      render();
    } else if (m.type === 'run.event' && m.runId && Number.isInteger(m.sequence)) {
      if (m.sequence <= (sequences.get(m.runId) ?? -1)) return;
      sequences.set(m.runId, m.sequence);
      if (sequences.size > 50) sequences.delete(sequences.keys().next().value);
      if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; post('ready'); }, 150);
    }
  });
  setInterval(() => { const n = document.getElementById('elapsed'); if (n) n.textContent = elapsed(n.dataset.start); const step = document.querySelector('.step-elapsed'); if (step) step.textContent = ' · ' + elapsed(step.dataset.start); }, 1000);
  render(); post('ready');
})();
