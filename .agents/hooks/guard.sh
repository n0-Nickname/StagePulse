#!/usr/bin/env bash
set -euo pipefail
INPUT="$(cat || true)"

PARSED=$(python3 -c '
import sys, json
d = json.loads(sys.stdin.read() or "{}")
tc = d.get("toolCall", {})
args = tc.get("args", {})
print(tc.get("name", ""))
print(args.get("Path") or args.get("path") or "")
print("yes" if args.get("StartLine") is not None else "no")
' <<< "$INPUT" 2>/dev/null || true)

TOOL_NAME=$(sed -n '1p' <<< "$PARSED")
TARGET_PATH=$(sed -n '2p' <<< "$PARSED")
HAS_RANGE=$(sed -n '3p' <<< "$PARSED")

if [[ "$TOOL_NAME" != "read_file" ]] || [ -z "$TARGET_PATH" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

if echo "$TARGET_PATH" | grep -Eiq '(uv\.lock|poetry\.lock|package-lock\.json|\.venv/|__pycache__/|node_modules/|alembic/versions/|/\.env([^a-zA-Z0-9_]|$)|^\.env$)'; then
  echo '{"decision": "deny", "reason": "Harness Guard: Lockfiles, .venv, node_modules, migrations, and .env are blocked. Use grep_search on source files."}'
  exit 0
fi

if [[ "$HAS_RANGE" == "no" ]] && [ -f "$TARGET_PATH" ]; then
  LINES=$(wc -l < "$TARGET_PATH")
  if [ "$LINES" -gt 350 ]; then
    echo "{\"decision\": \"deny\", \"reason\": \"File has $LINES lines (>350). Use grep_search first, then read_file with StartLine and EndLine.\"}"
    exit 0
  fi
fi

echo '{"decision": "allow"}'