#!/usr/bin/env bash
set -euo pipefail
cat > /dev/null || true

cd "$(dirname "$0")/../.."
LOG="/tmp/harness_stop_gate.log"
RETRY_FILE="/tmp/harness_stop_retries"
: > "$LOG"

# Запобіжник від нескінченного циклу (макс 3 авто-повернення на одне завдання)
RETRIES=$(cat "$RETRY_FILE" 2>/dev/null || echo 0)
if [ "$RETRIES" -ge 3 ]; then
  rm -f "$RETRY_FILE"
  echo '{}'
  exit 0
fi

fail_stop() {
  echo $((RETRIES + 1)) > "$RETRY_FILE"
  local TITLE="$1"
  local BODY="$2"
  python3 -c '
import sys, json
msg = f"STOP BLOCKED (attempt {sys.argv[2]}/3) — {sys.argv[1]}:\n{sys.stdin.read()}"
print(json.dumps({"decision": "continue", "reason": msg}))
' "$TITLE" "$((RETRIES + 1))" <<< "$BODY"
  exit 0
}

# 1. Python full suite (якщо є змінені/нові .py)
if git status --porcelain | grep -q '\.py$'; then
  if ! uv run ruff check --output-format=concise . >> "$LOG" 2>&1; then
    fail_stop "ruff errors remain" "$(head -n 20 "$LOG")"
  fi

  if ! uv run pyrefly check >> "$LOG" 2>&1; then
    fail_stop "pyrefly type errors remain" "$(head -n 20 "$LOG")"
  fi

  if ! uv run pytest -q -x --tb=short >> "$LOG" 2>&1; then
    fail_stop "pytest failed" "$(tail -n 25 "$LOG")"
  fi
fi

# 2. Frontend full suite (якщо є змінені/нові .ts/.tsx)
CHANGED_FE=$(git status --porcelain | awk '{print $2}' | grep -E '\.(ts|tsx)$' | head -n 1 || true)
if [ -n "$CHANGED_FE" ]; then
  FE_DIR=$(dirname "$CHANGED_FE")
  while [ "$FE_DIR" != "." ] && [ "$FE_DIR" != "/" ] && [ ! -f "$FE_DIR/package.json" ]; do
    FE_DIR=$(dirname "$FE_DIR")
  done

  if [ -f "$FE_DIR/package.json" ]; then
    if [ -f "$FE_DIR/scripts/lint_design.mjs" ]; then
      if ! (cd "$FE_DIR" && node scripts/lint_design.mjs) >> "$LOG" 2>&1; then
        fail_stop "design/TS lint violations remain" "$(head -n 20 "$LOG")"
      fi
    fi

    if ! (cd "$FE_DIR" && npx tsc --noEmit --pretty false) >> "$LOG" 2>&1; then
      fail_stop "tsc type errors remain" "$(head -n 20 "$LOG")"
    fi

    if ! (cd "$FE_DIR" && npx vitest run --reporter=dot) >> "$LOG" 2>&1; then
      fail_stop "vitest failed" "$(tail -n 25 "$LOG")"
    fi
  fi
fi

# Усе зелене — скидаємо лічильник і дозволяємо вихід
rm -f "$RETRY_FILE"
echo '{}'