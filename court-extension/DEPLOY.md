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
1. Runs the full test suite (`npm test` → 29 checks across 4 suites).
2. Packages the extension with `@vscode/vsce` into `triumph-courts.vsix`.
3. Installs it into code-server (`code-server --install-extension … --force`).
4. Verifies with `code-server --list-extensions --show-versions`.

### What each file does
| File | Purpose |
|------|---------|
| `bin/deploy.sh` | The deploy pipeline entry point (local & remote). |
| `.github/workflows/deploy.yml` | CI/CD: build on tag push → draft GitHub Release with the `.vsix`; manual dispatch to deploy over SSH. |
| `.vscodeignore` | Keeps the `.vsix` small and clean (excludes tests, design docs, deploy scaffolding). |
| `LICENSE` | MIT license (declared in `package.json`). |
| `package.json` → `repository` | Needed for clean `vsce` packaging (update the URL to your real repo). |

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