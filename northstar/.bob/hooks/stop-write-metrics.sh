#!/usr/bin/env sh
# STOP HOOK — WARPATH emits incident MTTR metrics (elapsed seconds).
# SessionStart stamps the start; Stop computes elapsed and writes metrics.json.
# stdout is ignored at Stop; the file is the deliverable (read by the comms-officer).
set -e

INCIDENT_DIR="${TRIUMPH_ROOT:-.}/incident"
mkdir -p "$INCIDENT_DIR"

# Start time written by the gold-session script (see warpath-intake skill).
START_FILE="$INCIDENT_DIR/.start_epoch"
if [ -f "$START_FILE" ]; then
  START_EPOCH=$(cat "$START_FILE")
  NOW_EPOCH=$(date +%s)
  ELAPSED=$(( NOW_EPOCH - START_EPOCH ))
else
  ELAPSED=0
fi

cat > "$INCIDENT_DIR/metrics.json" <<EOF
{
  "mttrSeconds": $ELAPSED,
  "measuredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "placeholder value; replace after a real gold-session run"
}
EOF

echo "[TRIUMPH] incident metrics written (elapsed=${ELAPSED}s)"