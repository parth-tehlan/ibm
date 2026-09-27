#!/usr/bin/env node
/**
 * tests/panel-ui.js — structural integrity checks for the redesigned webview
 * (media/panel.js + media/panel.css). The webview runs inside VS Code's
 * sandbox, so these checks verify the shipped assets directly:
 *
 *   - no hardcoded colors anywhere (var(--vscode-*) tokens only)
 *   - the four-tab layout exists with the specified icons and labels
 *   - the agent-activity step protocol is wired (message type + statuses)
 *   - the mutation live component + log drawer + scorecard are present
 *   - no transitions longer than 200ms
 *   - narrow-width (320px) fallback present
 *   - media/panel.js parses as valid JS
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const JS = fs.readFileSync(path.join(EXT, 'media', 'panel.js'), 'utf8');
const CSS = fs.readFileSync(path.join(EXT, 'media', 'panel.css'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok  ' + name); })
    .catch((e) => { failed++; console.error('  FAIL ' + name + ' — ' + e.message); });
}

(async () => {
  console.log('panel UI integrity checks\n');

  await t('media/panel.js parses as valid JavaScript', () => {
    new Function(JS); // syntax check only — never executed
  });

  await t('no hardcoded colors: every color is a var(--vscode-*) token', () => {
    // Hex colors, rgb()/rgba(), and named-color declarations are banned in CSS.
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS), 'hex color found in panel.css');
    assert.ok(!/\brgba?\(/.test(CSS), 'rgb()/rgba() found in panel.css');
    const decl = /(?:^|[{;\s])color\s*:\s*([^;}]+)/g;
    let m;
    while ((m = decl.exec(CSS))) {
      const value = m[1].trim();
      assert.ok(/^var\(--vscode-/.test(value) || value === 'inherit' || value === 'transparent',
        'non-token color declaration: ' + value);
    }
    // The webview JS must never inject a color literal either.
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(JS), 'hex color literal found in panel.js');
  });

  await t('all transitions are 150ms ease (none longer than 200ms)', () => {
    const times = [...CSS.matchAll(/transition:[^;]*?(\d+(?:\.\d+)?)(m?s)\b/g)];
    assert.ok(times.length > 0, 'expected at least one transition');
    for (const [, n, unit] of times) {
      const ms = unit === 's' ? parseFloat(n) * 1000 : parseFloat(n);
      assert.ok(ms <= 200, `transition longer than 200ms found: ${n}${unit}`);
    }
    assert.ok(CSS.includes('150ms ease'), 'transitions should use 150ms ease');
  });

  await t('tab bar: four tabs (Run ▶ / Report 📋 / Dashboard ⬡ / Setup ⚙) with active focusBorder indicator', () => {
    for (const [id, icon, label] of [['run', '▶', 'Run'], ['report', '📋', 'Report'], ['dashboard', '⬡', 'Dashboard'], ['setup', '⚙', 'Setup']]) {
      assert.ok(JS.includes(`id: '${id}'`), `missing tab id ${id}`);
      assert.ok(JS.includes(`icon: '${icon}'`), `missing tab icon for ${id}`);
      assert.ok(JS.includes(`label: '${label}'`), `missing tab label ${label}`);
    }
    assert.ok(/\.tab-item\.active\s*\{[^}]*border-left-color:\s*var\(--vscode-focusBorder\)/.test(CSS), 'active tab must use a focusBorder left strip');
  });

  await t('tab persistence via vscode.setState', () => {
    assert.ok(JS.includes("persist({ tab: tab.id })"), 'tab clicks must persist the active tab');
    assert.ok(/persisted\.tab/.test(JS), 'the active tab must be restored on load');
  });

  await t('court tiles: multi-select (aria-pressed, not radio), badge classes, selected tint via color-mix', () => {
    assert.ok(JS.includes("aria-pressed"), 'tiles must expose toggle state');
    assert.ok(!/name: 'court'/.test(JS), 'old single-select radio selector must be gone');
    for (const cls of ['badge-passed', 'badge-failed', 'badge-running']) {
      assert.ok(CSS.includes('.tile-badge.' + cls), 'missing tile badge class ' + cls);
    }
    assert.ok(CSS.includes('color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 40%, transparent)'),
      'selected tile must tint with list-activeSelectionBackground at 40%');
  });

  await t('single Run button + options block (output target, timeout, formats)', () => {
    assert.ok(JS.includes("'Run selected courts'"), 'the single Run button label');
    assert.ok(JS.includes("value: 'local'") && JS.includes("value: 'dashboard'"), 'output target radio options');
    assert.ok(JS.includes('timeout-input'), 'SPLITBRAIN timeout override input');
    for (const fmt of ['HTML', 'Markdown', 'JSON']) assert.ok(JS.includes(`'${fmt}'`), `format checkbox ${fmt}`);
    assert.ok(!JS.includes("'Run courts → dashboard'"), 'the old split dashboard run button must be gone');
  });

  await t('agent activity feed: step message protocol with the five states', () => {
    assert.ok(JS.includes("case 'step'"), 'webview must handle the step message type');
    for (const s of ['success', 'warn', 'error', 'pending', 'running']) {
      assert.ok(JS.includes(`'${s}'`), `step status '${s}' must be handled`);
    }
    assert.ok(JS.includes('feedPinned'), 'feed needs pin-to-bottom auto-scroll logic');
    assert.ok(JS.includes('STEP_LIMIT'), 'feed must cap entries');
  });

  await t('green ticks use the plain Unicode ✓ colored with testing-iconPassed (no emoji)', () => {
    assert.ok(JS.includes("'✓'"), 'plain ✓ glyph required for success steps');
    assert.ok(CSS.includes('var(--vscode-testing-iconPassed'), 'testing-iconPassed token required');
    assert.ok(!CSS.includes('content: "✅"') && !JS.includes('✅'), 'emoji ticks are not allowed');
  });

  await t('console log drawer: collapsible, 180px max-height, live entry count', () => {
    assert.ok(JS.includes('log-drawer') && JS.includes('logSummaryCount'), 'log drawer + live count');
    assert.ok(/\.log-container\s*\{[^}]*max-height:\s*180px/.test(CSS), 'log drawer max-height must be 180px');
  });

  await t('report tab scorecard: per-court rows, pills, gap bar, "Not run yet" empty state', () => {
    for (const cls of ['pill-pass', 'pill-fail', 'pill-skip']) assert.ok(CSS.includes('.' + cls), 'missing pill class ' + cls);
    assert.ok(JS.includes('Not run yet'), 'scorecard rows must say "Not run yet"');
    assert.ok(JS.includes('gap-track') && JS.includes('gap-fill'), 'SPLITBRAIN gap bar');
    assert.ok(!JS.includes('No report has been generated yet'), 'the old empty-state paragraph must be gone');
  });

  await t('dashboard tab: no run button (output target lives on the Run tab)', () => {
    assert.ok(!JS.includes("dashboardRunBtn"), 'dashboard tab must not carry a run button');
    assert.ok(JS.includes("'Open dashboard'") && JS.includes("'Refresh status'"), 'open/refresh buttons remain');
  });

  await t('mutation live component: progress bar, climbing counter, status classes', () => {
    assert.ok(JS.includes('mutation-live') && JS.includes('progress-fill') && JS.includes('mutation-pct'),
      'mutation live widget must render bar + counter in the panel');
    for (const sel of ['.progress-track', '.progress-fill', '.mutation-stats']) {
      assert.ok(CSS.includes(sel), 'missing CSS selector ' + sel);
    }
  });

  await t('narrow-width fallback below 320px: tiles stack, tab labels hide', () => {
    assert.ok(/@media\s*\(max-width:\s*320px\)/.test(CSS), 'a 320px media query is required');
    assert.ok(/@media\s*\(max-width:\s*320px\)[\s\S]*?\.tab-label\s*\{\s*display:\s*none/.test(CSS), 'tab labels must hide at narrow width');
    assert.ok(/@media\s*\(max-width:\s*320px\)[\s\S]*?\.court-tiles\s*\{\s*flex-direction:\s*column/.test(CSS), 'court tiles must stack at narrow width');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
