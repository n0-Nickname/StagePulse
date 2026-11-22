#!/usr/bin/env bash
set -euo pipefail
cat > /dev/null || true

cd "$(dirname "$0")/../.."
mkdir -p .agents/memory
touch .agents/memory/DECISIONS.md
rm -f /tmp/harness_gate_pending.txt

{
  echo "# LIVE WORKSPACE SNAPSHOT"
  echo "## Branch & Dirty Files"
  git status -s || true
  echo "## Recent Commits"
  git log -n 5 --oneline || true
  echo "## Architectural Invariants"
  cat .agents/memory/DECISIONS.md
} > .agents/memory/HOT_CONTEXT.md

python3 -c '
import json
with open(".agents/memory/HOT_CONTEXT.md") as f:
    ctx = f.read()[:3000]
msg = f"PROJECT HARNESS ACTIVE. Live state:\n{ctx}\nRules: Strict ruff+pyrefly+pytest / tsc+eslint+vitest gates active."
print(json.dumps({"injectSteps": [{"systemMessage": {"systemMessage": msg}}]}))
'