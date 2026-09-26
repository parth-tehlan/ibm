# Deploying the TRIUMPH 3-Court Extension

A simple, repeatable workflow for building and deploying the extension to a
**code-server (VS Code Server)**. Three pieces work together — a local script,
a GitHub Actions CI pipeline, and a packaging ignore file.

## Quick start (local deploy)

```bash
bin/deploy.sh                # test → package .vsix → install into code-server → verify
bin/deploy.sh --no-install   # test + package only (no code-server needed)
bin/deploy.sh --restart      # also restart code-server after installing
bin/deploy.sh --server user@host   # build locally, install+verify on a remote server
```

The script:
1. Stages the self-contained dashboard runtime from `../northstar-ui/.runtime` (build once with `cd ../northstar-ui && npm ci && npm run package:runtime`). Only the court-extension copy is shipped. The runtime must be present before tests or packaging.
2. Runs `npm test`, including a live child-process browser rerun regression.
3. Packages with pinned `@vscode/vsce@2.15.0` (the packaging subprocess has a Node 18 `File` compatibility shim) and checks that the VSIX includes its server, assets, `express`/`zod` runtime, and bundled YAML parser. It extracts the **actual VSIX** into a disposable workspace, installs and reinstalls Bob court files there, and checks that existing modes and disabled MCP settings survive. The committed `dashboard/` files alone are **not** a complete runtime without staged dependencies.
4. Unless `--no-install` is specified, installs it into code-server (`code-server --install-extension … --force`).
5. Verifies with `code-server --list-extensions --show-versions`.

### What each file does
| File | Purpose |
|------|---------|
| `bin/deploy.sh` | The deploy pipeline entry point (local & remote). |
| `../.github/workflows/deploy.yml` | CI/CD: on tag push, build and publish a GitHub Release with the `.vsix`; manual dispatch can deploy over SSH. Runs typecheck, both test suites, and disposable packaged Bob/VSIX checks. |
| `.vscodeignore` | Keeps the `.vsix` small and clean (excludes tests, design docs, deploy scaffolding). |
| `LICENSE` | MIT license (declared in `package.json`). |
| `package.json` → `repository` | Points `vsce` to this repository. |

## GitHub Actions (CI/CD)
- **On tag push `v*`:** the `build` job tests + packages the `.vsix`; the `release`
  job drafts a GitHub Release with the artifact attached.
- **Manual (`workflow_dispatch`):** supply a `deploy_target` (e.g. `root@host`) to
  deploy over SSH. Requires two secrets:
  - `DEPLOY_HOST` — the server hostname/IP
  - `SSH_DEPLOY_KEY` — an ed25519 private key authorized on the target

## Artifacts
The deploy produces `court-extension/triumph-courts.vsix`. Install it manually:
```bash
code-server --install-extension triumph-courts.vsix --force
```

## Re-deploy / upgrade
Safe to run repeatedly — `--force` upgrades in place and re-verifies. Reload the
code-server window (`Cmd/Ctrl+Shift+P` → *Developer: Reload Window*) to activate
a new build.

## Bob desktop upgrade (0.2.3)

On the computer running Bob (not the build server), in the `ibm` checkout:

```bash
git pull --ff-only origin main
cp court-extension/triumph-courts.vsix "$HOME/Desktop/triumph-courts.vsix"
sha256sum "$HOME/Desktop/triumph-courts.vsix"  # compare with the checksum for this build
```

In Bob: **Extensions → ⋯ → Install from VSIX…**, select the copied file, then
**Developer: Reload Window**. Check that `triumph.triumph-courts` shows version
`0.2.3`. Open the previous run in the dashboard (refresh if it was already open):
its saved evidence remains unchanged, and server-valid long SPLITBRAIN error messages
no longer invalidate the whole report. The failed mutation still appears as an
error, not a passing result. Then, with Northstar dependencies installed
(`cd northstar && npm ci`), use **TRIUMPH: Run courts and publish to dashboard**
to create a *new* run. Do not overwrite the previous report. The new REDLINE result should list source clause files only; zero-assertion suites,
duplicate suites and unexplained Jest exits are errors rather than passes. The
Northstar sample currently has failing clause assertions, so a new run shows red
entries, not green. SPLITBRAIN records the exit code and command output when
the mutation job fails, refuses a stale report, and rejects a second concurrent
job in the same engine. An isolated mutation run succeeded, but the cause of
the earlier failed run cannot be reconstructed from an old report without stdout. For investigation, run `npm run mutation` in the
project terminal when no other Stryker job is active, and inspect its output.
No mutation result is certified unless the new job completes and produces fresh
JSON. Deliberately failing sample clauses are not repaired by this update.

The VSIX is a local Git artifact, not a marketplace release and not an automatic
editor update. Pulling Git alone does not replace an installed extension. The disposable checks do not touch any real Bob configuration.

## Safe workspace setup and rollback
Run `node bin/triumph-setup.js --repo /path/to/project --host bob` to prepare a project (or choose **TRIUMPH: Install Courts** inside the editor). Existing Bob modes are merged by slug; existing agent, rule and skill files are left alone. MCP entries keep user settings such as `disabled`, `alwaysAllow`, and `env`. Malformed config or unsafe targets fail before the host install writes anything; if an install fails midway, it restores changed files. When an existing config is changed successfully, setup retains a permission-preserving hidden `*.triumph-backup-*` file beside it. The CLI prints backup paths; the editor's **Show files and backups** lists them. To roll back a successful install, copy the relevant backup over its corresponding config file after checking that no newer user edits need preserving. Newly created files have no prior version to restore and can be removed manually if desired.

The packaged Bob check installs into a temporary extracted workspace; it does **not** install the extension into a real editor. `--no-install` also leaves the real editor untouched.