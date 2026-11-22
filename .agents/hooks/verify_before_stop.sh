#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ -d "web/src" ] && [ -f "web/scripts/lint_design.mjs" ]; then
  (cd web && node scripts/lint_design.mjs)
  if [ -d "web/node_modules" ] && [ -f "web/package.json" ]; then
    (cd web && npm run lint)
  fi
fi
