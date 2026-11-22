#!/usr/bin/env bash
set -euo pipefail
INPUT="$(cat || true)"

cd "$(dirname "$0")/../.."

FILE=$(python3 -c '
import sys, json
d = json.loads(sys.stdin.read() or "{}")
args = d.get("toolCall", {}).get("args", {})
print(args.get("Path") or args.get("path") or "")
' <<< "$INPUT" 2>/dev/null || true)

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo '{}'
  exit 0
fi

LOG="/tmp/harness_gate.log"
PENDING="/tmp/harness_gate_pending.txt"
: > "$LOG"
STATUS=""

# --- PYTHON GATE ---
if [[ "$FILE" == *.py ]]; then
  uv run ruff check --fix -q "$FILE" >> "$LOG" 2>&1 || true
  uv run ruff format -q "$FILE" >> "$LOG" 2>&1 || true

  if ! uv run ruff check --output-format=concise "$FILE" >> "$LOG" 2>&1; then
    STATUS="FAIL (ruff)"
  elif ! uv run pyrefly check "$FILE" >> "$LOG" 2>&1; then
    STATUS="FAIL (pyrefly)"
  else
    BASENAME=$(basename "$FILE" .py)
    TEST_TARGET=""
    if [[ "$BASENAME" == test_* ]]; then
      TEST_TARGET="$FILE"
    else
      TEST_TARGET=$(find tests -name "test_${BASENAME}*.py" 2>/dev/null | head -n 1 || true)
    fi

    if [ -n "$TEST_TARGET" ]; then
      if ! uv run pytest "$TEST_TARGET" -q -x --tb=short >> "$LOG" 2>&1; then
        STATUS="FAIL (pytest: $TEST_TARGET)"
      else
        STATUS="PASS (ruff + pyrefly + $TEST_TARGET)"
      fi
    else
      STATUS="PASS (ruff + pyrefly; no direct unit test)"
    fi
  fi

# --- TYPESCRIPT / REACT GATE ---
elif [[ "$FILE" == *.ts || "$FILE" == *.tsx ]]; then
  FE_DIR=$(dirname "$FILE")
  while [ "$FE_DIR" != "." ] && [ "$FE_DIR" != "/" ] && [ ! -f "$FE_DIR/package.json" ]; do
    FE_DIR=$(dirname "$FE_DIR")
  done

  if [ ! -f "$FE_DIR/package.json" ]; then
    echo '{}'
    exit 0
  fi

  if ! (cd "$FE_DIR" && npx tsc --noEmit --pretty false) >> "$LOG" 2>&1; then
    STATUS="FAIL (tsc)"
  elif ! (cd "$FE_DIR" && npx eslint "$FILE" --quiet) >> "$LOG" 2>&1; then
    STATUS="FAIL (eslint)"
  else
    BASENAME=$(basename "$FILE" | sed -E 's/\.(test|spec)?\.(ts|tsx)$//')
    TEST_FILE=$(find "$FE_DIR" -maxdepth 5 \( -name "${BASENAME}.test.ts*" -o -name "${BASENAME}.spec.ts*" \) 2>/dev/null | head -n 1 || true)
    if [ -n "$TEST_FILE" ]; then
      if ! (cd "$FE_DIR" && npx vitest run "$TEST_FILE" --reporter=dot) >> "$LOG" 2>&1; then
        STATUS="FAIL (vitest: $TEST_FILE)"
      else
        STATUS="PASS (tsc + eslint + $TEST_FILE)"
      fi
    else
      STATUS="PASS (tsc + eslint; no direct unit test)"
    fi
  fi
else
  echo '{}'
  exit 0
fi

{
  echo "# LIVE WORKSPACE SNAPSHOT"
  echo "Last edit: $FILE -> $STATUS"
  git diff --stat || true
} > .agents/memory/HOT_CONTEXT.md

if [[ "$STATUS" == FAIL* ]]; then
  {
    echo "HARD GATE $STATUS on $FILE. Fix immediately before proceeding:"
    head -n 25 "$LOG"
  } > "$PENDING"
else
  rm -f "$PENDING"
fi

echo '{}'