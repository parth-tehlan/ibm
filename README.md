# Gaia 3-Court Dev Tool

> **"Build tests, review coverage honestly, and debug incidents — for any repo, any model, any platform."**

Gaia (formerly TRIUMPH) is a developer extension and CLI tool designed to enforce the 3-court testing method across any codebase. By orchestrating spec-witness test creation, coverage honesty audits, and incident forensics through the Model Context Protocol (MCP), Gaia provides rigorous, model-agnostic quality and survivability guarantees.

---

## Table of Contents

1. [What is Gaia?](#1-what-is-gaia)
2. [The Three Courts](#2-the-three-courts)
3. [Prerequisites](#3-prerequisites)
4. [Installation](#4-installation)
   - [4a. VS Code Extension (All Platforms)](#4a-installing-the-vs-code-extension)
   - [4b. CLI (Standalone, No VS Code)](#4b-cli-installation-no-vs-code-required)
5. [Quick Start](#5-quick-start)
   - [5a. VS Code (GUI)](#5a-vs-code-quick-start)
   - [5b. CLI](#5b-cli-quick-start)
6. [Configuration (.gaia.yml / .triumph.yml)](#6-configuration-gaiayml--triumphyml)
7. [Installing Courts into Your Agent Host](#7-installing-courts-into-your-agent-host)
8. [Running the Courts](#8-running-the-courts)
9. [Reading the Reports](#9-reading-the-reports)
10. [Supported Agent Hosts](#10-supported-agent-hosts)
11. [Advanced: The Engine as a Standalone MCP Server](#11-advanced-the-engine-as-a-standalone-mcp-server)
12. [CI/CD Integration](#12-cicd-integration)
13. [Contributing](#13-contributing)
14. [License](#14-license)

---

## 1. What is Gaia?

Gaia is a VS Code extension and command-line system that enforces the 3-court testing method — spec-witness tests, honest coverage audits, and incident forensics — for any repository. It replaces optimistic assumptions with deterministic evidence, giving engineering teams and autonomous agents a rigorous framework for software quality.

Architecturally, the extension **never calls an LLM directly**. Instead, it acts as a lightweight, model-free orchestrator and engine: it ships structured court subagent prompts and MCP tools that your existing AI agent host (IBM Bob, Claude Code, OpenAI Codex, VS Code Chat, etc.) runs using its own model.

Gaia serves three core roles:
1. **Setup Orchestrator**: Automatically detects repository structure, test runners, and mutation frameworks to provision subagent prompts and MCP wiring safely into your host.
2. **Model-Free MCP Engine Server**: A deterministic engine that executes wall-enforced tests, mutation runs, and log/metric fixture correlations over standard JSON-RPC 2.0.
3. **Report Generator**: Produces interactive HTML reports and agent-readable Markdown summaries detailing clause-by-clause compliance and test honesty.

> **Manifesto**: *"Legal. Honest. Survivable."*

---

## 2. The Three Courts

| Court | What it does | MCP tool prefix |
| :--- | :--- | :--- |
| **WITNESS** *(formerly REDLINE)* | **Spec-witness**: Tests authored from the spec contract alone, wall-enforced (never reads `src`) | `witness_*` (`redline_*`) |
| **TRUSTGAP** *(formerly SPLITBRAIN)* | **Honesty audit**: Claimed coverage vs. real mutation kill-rate; names tautologies | `trustgap_*` (`splitbrain_*`) |
| **TRIAGE** *(formerly WARPATH)* | **Incident forensics**: Correlates deploy/metrics/log fixtures, isolates suspect deploy | `triage_*` (`warpath_*`) |

### WITNESS (Spec-Witness Testing)
WITNESS tests whether your code satisfies its contractual specification without looking at how the code was implemented. Tests are authored strictly from specification contracts, OpenAPI definitions, or requirements documents. A strict file-access deny-wall (`wall.denyGlobs`, e.g., denying access to `src/**`) prevents the agent from reading the implementation. This guarantees tests are objective witnesses to the spec, avoiding the common failure mode where tests merely mirror the existing code bugs.

### TRUSTGAP (Coverage Honesty Audit)
High line-coverage percentages frequently mask superficial or tautological assertions. TRUSTGAP runs mutation testing (via Stryker or mutmut) to inject synthetic faults into your codebase and calculates the delta between claimed line coverage and the actual mutation kill-rate. By explicitly cataloging surviving mutants, TRUSTGAP exposes tautological tests, hollow mocks, and false confidence.

### TRIAGE (Incident Forensics)
When production failures happen, TRIAGE provides automated root-cause analysis. It ingests deployment manifests, time-series metrics fixtures (e.g., error rate spikes, latency surges), and diagnostic logs across an incident window. Through timestamp and event correlation, TRIAGE pinpoints the suspect deployment commit or configuration change and synthesizes a structured postmortem report.

> **How they compose:** Run all three courts to obtain a complete, uncompromised evaluation — spec compliance (**WITNESS**), test honesty (**TRUSTGAP**), and incident survivability (**TRIAGE**).

---

## 3. Prerequisites

### All Platforms
- **Node.js**: v18.0.0 or later ([https://nodejs.org](https://nodejs.org))
- **Git**: Recent version in PATH ([https://git-scm.com](https://git-scm.com))

### VS Code Extension Path
- **VS Code**: v1.101.0 or later ([https://code.visualstudio.com](https://code.visualstudio.com))  
  *OR*  
  **code-server**: Any recent release ([https://github.com/coder/code-server](https://github.com/coder/code-server))

### TRUSTGAP Court (Mutation Testing)
*Note: Only required if you run the TRUSTGAP mutation testing court.*
- **JavaScript/TypeScript repos**: Stryker Mutator
  ```bash
  npm install --save-dev @stryker-mutator/core
  ```
- **Python repos**: mutmut
  ```bash
  pip install mutmut
  ```

### Agent Host (At Least One)
- **IBM Bob**: ([https://bob.ibm.com](https://bob.ibm.com)) — *recommended*
- **Claude Code**: `claude` CLI ([https://docs.anthropic.com/en/docs/agents-and-tools/claude-code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code))
- **OpenAI Codex**: `codex` CLI
- **VS Code Chat**: Built-in GitHub Copilot / VS Code Chat

### Platform-Specific Notes
- **Windows**: Use PowerShell 5.1+ or Windows Terminal. Ensure `node` and `git` are added to your system `PATH`. No Windows Subsystem for Linux (WSL) is required.
- **macOS / Linux**: Standard shell (`bash` or `zsh`). No special requirements beyond Node.js and Git in `PATH`.

---

## 4. Installation

### 4a. Installing the VS Code Extension

#### Option A — From the .vsix file (All platforms, recommended)
1. Download `triumph-courts.vsix` (or `gaia-courts.vsix`) from the latest GitHub Release:  
   [https://github.com/parth-tehlan/ibm/releases/latest](https://github.com/parth-tehlan/ibm/releases/latest)
2. Open VS Code (or code-server).
3. Open the Extensions panel (`Ctrl+Shift+X` on Windows/Linux, `Cmd+Shift+X` on macOS).
4. Click the `⋯` (More Actions) menu in the Extensions view title bar → **Install from VSIX…**
5. Select the downloaded `.vsix` file.
6. When prompted, click **Reload Window** (or open Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P` → type `Developer: Reload Window`).
7. Verify installation: Open Extensions panel → search `Gaia` (or `TRIUMPH`) → should show version `0.3.0` (or latest).

#### Option B — Install into code-server via CLI
```bash
code-server --install-extension triumph-courts.vsix --force
```

#### Option C — Build from source (Advanced)
```bash
git clone https://github.com/parth-tehlan/ibm.git
cd ibm/court-extension

# Stage the dashboard runtime first (required before tests or packaging)
cd ../northstar-ui && npm ci && npm run package:runtime
cd ../court-extension

# Run the test suite
npm test

# Build the .vsix package
node bin/vsce-node18.cjs package

# Install into VS Code
code --install-extension triumph-courts.vsix --force

# OR for code-server:
code-server --install-extension triumph-courts.vsix --force
```

### 4b. CLI Installation (No VS Code Required)

```bash
git clone https://github.com/parth-tehlan/ibm.git
cd ibm
```

No global npm install is required — all CLI tools can be run directly using Node: `node court-extension/...`.

---

## 5. Quick Start

### 5a. VS Code Quick Start

1. Open your repository folder in VS Code (`File` → `Open Folder…`).
2. Click the **Gaia** (TRIUMPH) icon in the Activity Bar (left sidebar) to open the **3-Court** panel.
3. In the **Config** section, click **Auto-detect** to generate `.gaia.yml` (or `.triumph.yml`) for your repository.
4. In the **Install courts** section, select your agent host (**Bob**, **Claude**, **Codex**, **VS Code**, or **All**) and click **Install**.
5. In the **Run** section, choose a court:
   - **WITNESS** — Spec-witness test authoring and verification
   - **TRUSTGAP** — Coverage honesty audit and mutation testing
   - **TRIAGE** — Incident forensics and root cause isolation  
   Click **Run**.
6. Execution logs stream live into the panel. Upon completion, the **Last report** section activates — click **Open HTML report** or **Open Markdown report**.

### 5b. CLI Quick Start

```bash
# Step 1: Detect repository structure and install court subagents
node court-extension/bin/triumph-setup.js --repo /path/to/your/repo

# (Optional) Target specific agent hosts:
node court-extension/bin/triumph-setup.js --repo . --host bob --host claude

# Step 2: Run all three courts and generate reports
node court-extension/bin/triumph-report.js --repo .
```

#### Generated Report Artifacts
All reports are written relative to your repository root:
- `reports/triumph/triumph-report.html` — Interactive HTML report featuring Red/Yellow/Green clause indicators, mutation gutter view, evidence timeline, and clickable `vscode://` links.
- `reports/triumph/triumph-report.md` — Agent-friendly Markdown summary, structured for immediate consumption and re-running.
- `reports/triumph/triumph-input.json` — Deterministic raw engine data used for auditing, automated grading, and run diffing.

---

## 6. Configuration (.gaia.yml / .triumph.yml)

Gaia is completely repository-agnostic: every path, test regex, and command runner is configured in a single YAML file placed at your repo root. Both `.gaia.yml` and `.triumph.yml` are supported.

### Minimal Configuration

```yaml
version: 1
spec:
  path: docs/api-spec.md
  clausePattern: '^## (W\d+)'
  clauseIdPattern: '^W\d+$'
tests:
  framework: jest          # Supported: jest | pytest | custom
  dir: tests
  clauseTestPattern: clause-{{clause}}.test.ts
mutation:
  tool: stryker            # Supported: stryker | mutmut | custom
  report: reports/mutation/mutation.json
  command: npm run mutation
wall:
  denyGlobs:
    - src/**               # WITNESS court cannot read paths matching these globs
```

### Full Northstar Reference Configuration

Below is the complete configuration from the reference `northstar` payments service:

```yaml
# Gaia 3-court adapter configuration
# Schema: court-extension/schemas/triumph-config.schema.json
version: 1
repo:
  name: northstar                       # Repository / service name

spec:
  path: docs/api-spec.md                # Path to specification contract markdown
  clausePattern: '^## (W\d+)'           # Regex identifying clause headers
  clauseIdPattern: '^W\d+$'             # Pattern validating individual clause IDs

tests:
  framework: jest                       # Test runner framework
  dir: tests                            # Directory containing test suites
  clauseTestPattern: clause-{{clause}}.test.ts # File naming convention for clause tests

mutation:
  tool: stryker                         # Mutation testing tool
  report: reports/mutation/mutation.json # Path where mutation engine writes report
  claimedCoverageFrom: coverage/coverage-summary.json # Test coverage source for trust gap
  command: npm run mutation             # Shell command to execute mutation run
  timeoutSeconds: 900                   # Execution timeout for mutation suite
  strykerJestConfig: stryker.jest.config.js # Runner config for Stryker with Jest

fixtures:
  deploys: fixtures/deploy.json         # Deployment log fixtures for incident triage
  metrics: fixtures/metrics.json        # Time-series metrics fixtures
  logs: fixtures/logs.json              # Diagnostic log fixtures

evidence:
  dir: evidence                         # Directory where court evidence artifacts are stored
  trustgap: trustgap/TrustGap.json      # Output destination for TrustGap honesty delta
  incidentDir: incident                 # Output directory for Triage incident findings
  reportsDir: reports/triumph           # Root directory for generated HTML and MD reports

wall:
  denyGlobs:                            # Wall enforcement globs
    - src/**                            # Prevents Witness from accessing implementation code

waivers: evidence/waivers.json          # Approved waivers for accepted risks or exemptions
```

- **JSON Schema**: `court-extension/schemas/triumph-config.schema.json`
- **Supported Test Frameworks**: `jest`, `pytest`, `custom`
- **Supported Mutation Tools**: `stryker`, `mutmut`, `custom`

---

## 7. Installing Courts into Your Agent Host

Running "Install courts" writes the court subagent instructions and MCP wiring directly into your agent host's native configuration directories. Your host's model then executes those subagents — Gaia never contacts an external model directly.

### Files Written per Host

| Host | Files Written |
| :--- | :--- |
| **IBM Bob** | `.bob/` subagent configuration + `.bob/mcp.json` |
| **Claude Code** | `.claude/agents/*.md` + `.mcp.json` |
| **OpenAI Codex** | Agent definitions + MCP configuration |
| **VS Code Chat** | Chat participant registrations + `.vscode/mcp.json` |
| **Generic** | `.gaia/` (or `.triumph/`) subagent prompt templates + MCP configuration |

### Safe Installation Guarantees
- **Non-destructive Merging**: Existing agent modes are merged by slug name. Your custom tools and prompts are never overwritten.
- **MCP Setting Preservation**: Existing MCP tool configurations retain their user overrides (such as `disabled`, `alwaysAllow`, and environment variables).
- **Automated Backups**: Timestamped backup copies (`*.triumph-backup-*` or `*.gaia-backup-*`) are automatically created alongside any modified files.
- **Atomic Rollback**: If an error occurs during installation, all modified files are immediately restored from their backups.

### Rollback Process
1. Backup files are displayed in the VS Code panel under "Show files and backups" and listed in CLI command outputs.
2. To undo changes, copy the `.triumph-backup-*` file over the active configuration file.
3. Newly created subagent prompt files can simply be removed.

---

## 8. Running the Courts

### 8a. Via the VS Code Panel
1. Open the **Gaia** panel in the Activity Bar → navigate to the **Run** section.
2. Select your desired court: **WITNESS**, **TRUSTGAP**, or **TRIAGE**.
3. Click **Run** or click **Generate full report** to execute all three.
4. Output streams live into the panel console.
5. **Non-blocking Async Jobs**: Mutation testing under TRUSTGAP runs asynchronously (`trustgap_mutate` returns a `job_id` immediately; the panel polls `trustgap_status`), ensuring the UI and chat remain responsive.

### 8b. Via CLI
```bash
# Generate the full 3-court report
node court-extension/bin/triumph-report.js --repo .

# Or run the engine directly as an interactive MCP server
node court-extension/court.js --repo .
```
Send JSON-RPC 2.0 requests over `stdin`:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"witness_verdict_all","arguments":{}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trustgap_mutate","arguments":{}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"triage_incident","arguments":{}}}
```
*(Legacy tool aliases `redline_*`, `splitbrain_*`, and `warpath_*` remain fully supported).*

### 8c. Via Your AI Agent Host (IBM Bob, Claude Code, etc.)
Once courts are installed:
1. Open a session with your agent in your repository.
2. The subagents will be detected automatically.
3. Instruct your model:
   - *"Run WITNESS on this repo to check spec compliance."*
   - *"Run TRUSTGAP to identify mutation gaps and tautological tests."*
   - *"Run TRIAGE to isolate the root cause of the incident fixtures."*
   - *"Run the full Gaia 3-court audit and show the report."*
4. The agent drives the subagents and calls engine tools through MCP.

---

## 9. Reading the Reports

### HTML Report (`triumph-report.html`)
- Opens in VS Code's integrated WebView tab or any external browser.
- **R/Y/G per clause**: Visual status indicator for each specification requirement.
- **Mutation Gutter**: Interactive line gutter displaying which mutants were killed vs. survived per clause.
- **Evidence Timeline (TRIAGE)**: Interactive timeline aligning deploy commits, error log bursts, and metric anomalies.
- **Click-to-jump Links**: Native `vscode://` hyperlinks open the exact source file and line number in VS Code.

### Markdown Report (`triumph-report.md`)
- Clean, compact Markdown document.
- Ideal for pasting into PR comments, issue trackers, or agent chat contexts for automated follow-ups.

### Raw JSON Data (`triumph-input.json`)
- Fully deterministic machine-readable engine output.
- Used for automated CI/CD assertions, custom reporting scripts, and diffing between commits.

### Verdict Colors Explained

| Verdict | Meaning | Action Needed |
| :--- | :--- | :--- |
| 🔴 **RED** | Clause is failing or untested | Author missing witness tests or resolve contract violations. |
| 🟡 **YELLOW** | Clause has coverage, but mutation kill-rate is below threshold | Tests exist but are likely tautological or superficial; strengthen assertions. |
| 🟢 **GREEN** | Clause is tested and synthetic mutations are killed | Spec contract is satisfied and backed by high-assurance assertions. |

---

## 10. Supported Agent Hosts

| Host | Install Flag | Description |
| :--- | :--- | :--- |
| **IBM Bob** | `--host bob` | *Recommended.* Provisions `.bob/` subagents and configures `.bob/mcp.json`. |
| **Claude Code** | `--host claude` | Writes `.claude/agents/*.md` subagents and `.mcp.json`. |
| **OpenAI Codex** | `--host codex` | Provisions Codex agent definitions and MCP wiring. |
| **VS Code Chat** | `--host vscode` | Registers chat participants and configures `.vscode/mcp.json`. |
| **Generic / Other** | `--host generic` | Provisions `.gaia/` (`.triumph/`) subagents for any MCP-compliant host. |
| **All** | `--host all` | *Default.* Provisions configurations for all detected hosts simultaneously. |

Gaia is completely model-agnostic. Switching agent hosts requires only passing a different `--host` flag. The deterministic engine and rendered reports remain identical regardless of which model powers your agent.

---

## 11. Advanced: The Engine as a Standalone MCP Server

`court-extension/court.js` is a standalone, standards-compliant Model Context Protocol server (JSON-RPC 2.0 over `stdio`, MCP protocol version `2024-11-05`). It can be wired directly into any MCP client or orchestration pipeline:

```bash
node court-extension/court.js --repo /path/to/your/repo
```

### Exposed MCP Tools

| Tool | Court | Description |
| :--- | :--- | :--- |
| `witness_verdict_all`<br>*(alias: `redline_verdict_all`)* | WITNESS | Runs all spec-witness test suites; returns Red/Yellow/Green verdict per clause. Wall-enforced against implementation paths. |
| `witness_clause`<br>*(alias: `redline_clause`)* | WITNESS | Evaluates a single spec clause (e.g., `W4`) and returns test execution details and failures. |
| `witness_clauses`<br>*(alias: `redline_clauses`)* | WITNESS | Lists all spec clause IDs extracted from the specification contract. |
| `trustgap_mutate`<br>*(alias: `splitbrain_mutate`)* | TRUSTGAP | Starts async mutation testing run in the background; returns a `job_id` immediately so chat never blocks. |
| `trustgap_status`<br>*(alias: `splitbrain_status`)* | TRUSTGAP | Polls the progress or completion status of an active mutation job. |
| `trustgap_report`<br>*(alias: `splitbrain_trustgap`)* | TRUSTGAP | Returns claimed coverage vs. honest mutation kill-rate, naming every tautology and surviving mutant. |
| `trustgap_mutants`<br>*(alias: `splitbrain_mutants`)* | TRUSTGAP | Lists mutants from the latest mutation report, with optional filtering by status (e.g., `Survived`). |
| `triage_incident`<br>*(alias: `warpath_triage`)* | TRIAGE | Computes suspect deployment and anomalous signal window by correlating timestamps across fixtures. |
| `triage_context`<br>*(alias: `warpath_context`)* | TRIAGE | Pulls raw deploy, metrics, and log fixture incident context. |
| `triage_postmortem`<br>*(alias: `warpath_postmortem`)* | TRIAGE | Renders a structured postmortem under the configured incident directory. |
| `courts_about` | Meta | Returns the 3-court manifesto, loaded configuration source, and active wall policy. |

---

## 12. CI/CD Integration

Gaia includes automated GitHub Actions workflows under `.github/workflows/deploy.yml`.

### Automated Release on Version Tag
When a version tag is pushed, the workflow automatically runs tests, builds the `.vsix` package, and creates a draft GitHub release with the compiled extension artifact:
```bash
git tag v0.3.0
git push origin v0.3.0
```

### Manual Remote Deployment (workflow_dispatch)
Trigger a remote deployment directly from the GitHub Actions tab by providing a `deploy_target` (e.g., `root@your-server`).  
*Requires GitHub repository secrets `DEPLOY_HOST` and `SSH_DEPLOY_KEY`.*

### Local / Self-Hosted Deployment Script
Deploy cross-platform using `court-extension/bin/deploy.sh`:

```bash
cd court-extension

# Full pipeline: test -> package -> install -> verify
bin/deploy.sh

# Build and package without installing
bin/deploy.sh --no-install

# Install and automatically restart code-server
bin/deploy.sh --restart

# Build locally and install on a remote server over SSH
bin/deploy.sh --server user@host
```

#### Windows PowerShell Equivalent
On Windows without Git Bash or WSL, execute via PowerShell:
```powershell
# Run the test suite
cd court-extension
npm test

# Package the extension
node bin/vsce-node18.cjs package

# Install into code-server
code-server --install-extension triumph-courts.vsix --force
```

---

## 13. Contributing

- Review [CONTRIBUTIONS.md](file:///c:/Users/Parth/OneDrive/Desktop/College/ibm_/ibm/CONTRIBUTIONS.md) for contribution guidelines and project history.
- The `northstar/` directory serves as the canonical reference implementation, validated continuously against the Gaia engine.
- To execute the comprehensive test suite:
  ```bash
  cd court-extension
  npm test
  ```
- Test suites cover runner safety, deny-wall strength, mutation safety, MCP client interactions, panel webview UI, dashboard integration, and validator parity.

---

## 14. License

Distributed under the MIT License. See [court-extension/LICENSE](file:///c:/Users/Parth/OneDrive/Desktop/College/ibm_/ibm/court-extension/LICENSE) for details.
