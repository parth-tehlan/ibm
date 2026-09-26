#!/usr/bin/env bash
# =============================================================================
# TRIUMPH 3-Court — Deploy workflow
#
# Packages the court-extension into a .vsix and installs it into a running
# code-server (VS Code Server). Re-runnable: safe to run repeatedly, upgrade
# in place, verify, and self-report. Designed to be the single entry point for
# both local deploys and remote/CI deploys.
#
#   Usage:
#     bin/deploy.sh                        # package + install into local code-server
#     bin/deploy.sh --no-install           # just build/test the .vsix, don't install
#     bin/deploy.sh --server <user@host>   # scp the vsix and install over ssh
#     bin/deploy.sh --restart              # restart code-server after install
#
# Requires: node, npm, npx (for @vscode/vsce), and code-server on PATH.
# =============================================================================
set -euo pipefail

# --- config -----------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_JSON="$ROOT/package.json"
VSIX_OUT="$ROOT/triumph-courts.vsix"
EXT_ID="triumph.triumph-courts"

INSTALL=1
RESTART=0
SERVER=""

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install)  INSTALL=0;  shift ;;
    --restart)     RESTART=1;  shift ;;
    --server)      SERVER="$2"; shift 2 ;;
    -h|--help)     usage 0 ;;
    *) usage 1 ;;
  esac
done

cd "$ROOT"

log()  { printf '\e[1;34m[deploy]\e[0m %s\n' "$*"; }
die()  { printf '\e[1;31m[deploy] ERROR:\e[0m %s\n' "$*" >&2; exit 1; }
pass() { printf '\e[1;32m[deploy] OK:\e[0m %s\n' "$*"; }

# Require only tooling we actually need.
command -v node >/dev/null 2>&1  || die "node is required"
command -v npm  >/dev/null 2>&1  || die "npm is required"
command -v npx  >/dev/null 2>&1  || die "npx is required"
[[ -f "$PKG_JSON" ]] || die "package.json not found in $ROOT"

# Read a field from package.json. Uses `node -e` with an explicit process.exit(0)
# because `node -p` on this runtime prints the value then SIGABRTs (exit 134),
# which trips `set -e`. Reading+exiting(0) avoids that entirely.
pkg_field() {
  node -e "process.stdout.write(String(require('$PKG_JSON')['$1'])); process.exit(0)"
}
VERSION="$(pkg_field version)"
NAME="$(pkg_field name)"
PUB="$(pkg_field publisher)"
EXT_ID="${PUB}.${NAME}"

# --- 1. Stage the isolated runtime before tests and packaging -------------------
log "Staging dashboard runtime…"
npm run stage:dashboard

# --- 2. Test (offline/disposable only; npm run test:live is opt-in) ------------
log "Running extension test suite (no live Northstar mutation)…"
npm test

# --- 3. Package ----------------------------------------------------------------
log "Packaging $EXT_ID@$VERSION → $(basename "$VSIX_OUT")…"
# Always via npx @vscode/vsce (no vendored-vsce assumption). --no-dependencies:
# runtime deps (express, zod) live under dashboard/node_modules and are shipped
# as-is, not re-resolved by vsce.
# Pin a Node 18-compatible CLI rather than resolving latest vsce (Node 20+).
# A transitive undici release expects File on globalThis; Node 18 exports it
# from node:buffer. This shim applies only to the packaging subprocess.
NODE_OPTIONS="--require=$ROOT/bin/vsce-node18.cjs ${NODE_OPTIONS:-}" \
  npx --yes @vscode/vsce@2.15.0 package --no-dependencies --out "$VSIX_OUT"
[[ -s "$VSIX_OUT" ]] || die "packaging failed: $VSIX_OUT missing/empty"
node bin/verify-vsix.js "$VSIX_OUT"
# Exercise the exact just-packaged archive in an isolated temporary Bob workspace.
# This does not install into an IDE or mutate a real Bob configuration.
node "$ROOT/../scripts/verify-packaged-bob.mjs" "$VSIX_OUT"
pass "built $(du -h "$VSIX_OUT" | cut -f1) → $(basename "$VSIX_OUT")"

if [[ "$INSTALL" -ne 0 ]]; then
  # --- 3. Install (local, or remote via --server) ------------------------------
  if [[ -n "$SERVER" ]]; then
    # Remote: build locally, copy the artifact, install on the target over ssh.
    # (The remote box has no access to this local $VSIX_OUT path.)
    log "Deploying to remote code-server at $SERVER…"
    scp "$VSIX_OUT" "$SERVER:/tmp/$(basename "$VSIX_OUT")" || die "scp to $SERVER failed"
    ssh "$SERVER" "code-server --install-extension '/tmp/$(basename "$VSIX_OUT")' --force" || \
      die "remote install failed (is code-server on PATH on $SERVER?)"
    pass "installed on remote $SERVER"

  else
    command -v code-server >/dev/null 2>&1 || die "code-server not on PATH; give --server or add code-server to PATH"

    log "Installing $EXT_ID@$VERSION into code-server…"
    code-server --install-extension "$VSIX_OUT" --force

    pass "installed $EXT_ID@$VERSION"
    code-server --list-extensions --show-versions | grep -F "$EXT_ID" || die "install not reflected by --list-extensions"

    if [[ "$RESTART" -eq 1 ]]; then
      if command -v systemctl >/dev/null 2>&1 && systemctl is-active code-server@* >/dev/null 2>&1; then
        log "Restarting code-server (systemd)…"
        sudo systemctl restart code-server@\* 
      elif command -v pkill >/dev/null 2>&1; then
        # Launched ad-hoc: restart the bound instance on $CODE_PORT or 3000.
        pkill -f 'code-server.*:3000' || true
        nohup code-server --bind-addr 0.0.0.0:3000 >/tmp/code-server.log 2>&1 &
        log "code-server restarted (see /tmp/code-server.log)"
      else
        log "Cannot auto-restart; code-server will pick up the extension on next launch."
      fi
    else
      log "Extension activated on the next code-server window reload/startup."
    fi
  fi
else
  log "--no-install: skipping install. Artifact ready: $(basename "$VSIX_OUT")"
fi

# --- 4. Report ------------------------------------------------------------------
log "Deploy complete for $EXT_ID@$VERSION"
echo "  Artifact : $VSIX_OUT"
echo "  Installed: $([ "$INSTALL" -eq 1 ] && echo yes || echo 'no (--no-install)')"
echo "  Server   : ${SERVER:-localhost:3000 (default)}"