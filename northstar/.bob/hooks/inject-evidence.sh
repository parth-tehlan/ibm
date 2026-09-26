#!/usr/bin/env sh
# SESSION-START HOOK — stamps branch/SHA/date into evidence/manifest.json.
# stdout is injected into Bob's context (docs confirm SessionStart stdout is fed in).
# Cannot block. Use it for evidence provenance, not enforcement.
set -e

EVIDENCE_DIR="${TRIUMPH_ROOT:-.}/evidence"
mkdir -p "$EVIDENCE_DIR"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$EVIDENCE_DIR/manifest.json" <<EOF
{
  "branch": "$BRANCH",
  "sha": "$SHA",
  "stampedAt": "$STAMP",
  "project": "northstar"
}
EOF

echo "[TRIUMPH evidence stamp] branch=$BRANCH sha=$SHA at $STAMP"