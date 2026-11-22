#!/usr/bin/env bash
set -euo pipefail
cat > /dev/null || true

PENDING="/tmp/harness_gate_pending.txt"
if [ -f "$PENDING" ]; then
  python3 -c '
import json
with open("/tmp/harness_gate_pending.txt") as f:
    msg = f.read()
print(json.dumps({"injectSteps": [{"systemMessage": {"systemMessage": msg}}]}))
'
  rm -f "$PENDING"
  exit 0
fi

echo '{}'