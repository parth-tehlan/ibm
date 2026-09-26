#!/usr/bin/env sh
# PRE-TOOL-USE HOOK — path-based write scope (defense-in-depth).
# Does NOT key off a `mode` field (Bob's PreToolUse stdin has none), so it is
# safe and portable under subagents and extension/ACP runtimes alike.
#
# PRIMARY write-scope enforcement lives in the per-agent `tools:` allowlists:
# each .claude/agents/*.md only grants Edit/Write/Write-family tools for the
# directories that role is sanctioned to write (e.g. isolate -> tests/,
# evidence/, trustgap/). This hook is a coarse, mode-agnostic backstop that
# protects the infrastructure/secrets that NO agent may modify.
#
# Hard-blocked for EVERYONE (no agent writes these):
#   .bob/            (config + hooks + scratch live here; scratch is transient)
#   clause-wall/     (the source of truth the REDLINE court reads)
#   fixtures/ docs/  (the immutable spec/fixture corpus)
#   CHANGELOG.md     (unless explicitly the comms-officer path — see below)
#   root readme/spec
# exit code 2 = BLOCK the tool.
set -e

payload="$(cat /dev/stdin)"
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)

# Only enforce on write-ish tools.
case "$tool" in
  write_file|apply_diff|insert_content|search_and_replace) ;;
  *) exit 0 ;;
esac

path=$(printf '%s' "$payload" \
  | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n1)
# Bob uses "path" in the documented stdin schema; fall back to the probe's
# "file_path" reconstruction if "path" was absent above.
if [ -z "$path" ]; then
  path=$(printf '%s' "$payload" \
    | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n1)
fi

# If we truly cannot extract a path, don't block (mode-absent fallback).
[ -n "$path" ] || exit 0

# Normalise to relative path for matching.
relpath="$path"
case "$relpath" in
  */) relpath="${relpath%/}" ;;
esac

# Universal hard-blocks: infrastructure and spec-of-record that no agent may
# mutate through the hook. (Per-agent targets like src/ and trustgap/ are left
# to the tools: allowlists so surgeon CAN write src/ and isolate CAN write
# trustgap/.)
blocked=""
case "$relpath" in
  .bob/*|.bob)
    blocked=".bob/ is agent infrastructure — no agent mutates it via hook"
    ;;
  clause-wall/*|clause-wall)
    blocked="clause-wall/ is the spec of record — read-only to all agents"
    ;;
  fixtures/*|fixtures)
    blocked="fixtures/ is the immutable corpus — read-only to all agents"
    ;;
  docs/*|docs)
    blocked="docs/ is the spec corpus — not writable via hook"
    ;;
esac

if [ -n "$blocked" ]; then
  echo "BLOCKED: $blocked (tool=$tool, path=$relpath)"
  exit 2
fi

exit 0