#!/usr/bin/env sh
# PRE-TOOL-USE HOOK — defense-in-depth isolation wall (PATH-BASED).
# PRIMARY enforcement of the wall is the per-agent `tools:` allowlists in
# .claude/agents/*.md (walled agents literally lack the tools to touch src/).
# This hook is the coarse fallback: it never keys off a `mode`/subagent field
# (Bob's PreToolUse stdin schema has none), so it is safe and portable even if
# we move to an extension/ACP-based runtime.
#
# Rule (simple, subagent-safe, demo-readable):
#   * src/ is WRITE-PROTECTED for everyone except the surgeon path.
#   * src/ reads are the responsibility of the per-agent tool allowlist; this
#     hook additionally blocks src/ reads when the tool is a bash/execute that
#     could shell its way around the wall (cat src/..., grep -r ... src/...).
# exit code 2 = BLOCK the tool.
set -e

payload="$(cat /dev/stdin)"
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)

# Detect whether a src/ path is involved anywhere in the tool input.
# Boundary = non-identifier char so "cat src/circuit.ts" and
# {"path":"src/..."} are both caught.
if ! printf '%s' "$payload" | grep -qE '(^|[^A-Za-z0-9_./-])src/'; then
  exit 0  # nothing about src/ -> allow
fi

blocked=""
case "$tool" in
  # WRITE tools: src/ is write-protected (the per-agent allowlists already
  # block this for non-surgeon agents; this hook is the coarse backstop).
  write_file|apply_diff|insert_content|search_and_replace)
    blocked="writes to src/ are not permitted (defense-in-depth)"
    ;;
  # WRITE via shell (mv/cp/tee into src, git checkout, etc.).
  execute_command|Bash)
    blocked="src/ must not be modified or read via shell (defense-in-depth)"
    ;;
  *)
    # read_file/list/grep/glob via native tools are governed by the per-agent
    # allowlist; this hook adds no blocking for them (they cannot bypass).
    ;;
esac

if [ -n "$blocked" ]; then
  echo "BLOCKED: $blocked (tool=$tool, src/ referenced)"
  exit 2
fi

exit 0