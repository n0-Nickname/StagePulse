---
name: tokenleak
description: Token-efficient engineering rules for coding agents and subagents. Cuts context bloat from oversized reads, unbounded test/build logs, redundant round-trips, full rewrites, and verbose recaps without sacrificing correctness. Use on any coding, debugging, testing, git, or exploration task, and when auditing token leaks.
license: MIT
---

# Tokenleak Engineering Rules

Every tool output pulled into context is re-sent and re-paid on **every subsequent turn** until compaction. Output tokens cost ~5x input and join context too. Pull in only what the next decision requires.
**Golden Rule:** Correctness first. A targeted read is cheaper than a broken edit. Never skip verification to save tokens.

## 1. Navigation & Selective Reads
- **Locate before reading:** Check `wc -l <file>` if size is unknown. Search symbols first (`grep_search` / `rg -n` scoped by path/type), then read only the target window (`StartLine`..`EndLine`, +/- 30 lines) via `view_file` or `sed -n 'A,Bp'`. Read whole files only under ~300 lines.
- **Compute over reading:** For counts, JSON/CSV lookups, or log filtering, run a short one-liner (`jq`, `python3 -c`, `grep -c`) printing only the answer.
- **Hard exclusions (never full-scan):** Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `uv.lock`, `poetry.lock`, `Cargo.lock`), build/dep dirs (`node_modules/`, `dist/`, `build/`, `.venv/`, `__pycache__/`, `target/`), and auto-generated migrations.
- **Never re-read:** Do not re-read files already read or edited in this session unless modified externally or after compaction.
- **Delegate wide discovery:** If answering requires opening >5 files, hand exploration to a fast subagent (`explorer`) so only its summary enters main context.

## 2. Shell, Test & Build Output Bounding
- **Quiet flags by default:**
  - Python: `pytest -q -x --tb=short`, `ruff check --output-format=concise`
  - JS/TS: `vitest run --reporter=dot`, `npm ci --silent`, `npx tsc --noEmit --pretty false`
  - Go / Rust / Make: `go test ./... 2>&1 | grep -v '^ok'`, `cargo test -q`, `make -s`
  - Git: `git status -s`, `git diff --stat`, `git log --oneline -n 15`, `git show --stat <sha>`
- **Redirect long jobs to `/tmp`:**
  ```bash
  L="${TMPDIR:-/tmp}/agent_cmd.log"; <cmd> > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"
  ```
  Query failures directly via `grep -n -m 20 -E 'error|FAIL|Traceback|panic' "$L"` or `sed -n '100,160p' "$L"`. Never re-run a slow command just to see more output.
- **Iterate narrow, verify once:** Re-run only the single failing test case while fixing (`pytest path/test.py -k test_name -q`); run the full suite once quietly at the end.

## 3. Round-Trip & Editing Efficiency
- **Batch independent calls:** Issue parallel `view_file` / `grep_search` calls in one turn. Chain sequential shell checks with no intermediate judgment (`wc -l a b && rg -n "class " a b`).
- **Diff-first editing:** Use `replace_file_content` / `multi_replace_file_content` on existing files; never rewrite whole files for small edits.
- **Strict comments:** Comment ONLY non-obvious invariants, locks, or workarounds—never narrate obvious lines.

## 4. Zero-Fluff Output & Subagent Handoffs
- **No narration or recaps:** Never announce tool calls ("Let me check...") and never paste code or line-by-line diffs already on disk.
- **4-line subagent handoff (no prose or `.md` status files):**
  ```text
  STATUS: DONE | BLOCKED | NEEDS_USER
  FILES: <comma-separated modified paths>
  CHECKS: <command=PASS/FAIL>
  NOTE: <1-sentence blocker, decision needed, or key change>
  ```

## 5. Token Leak Audit (When Requested)
If `scripts/tokenleak.py` exists in this skill's folder and the user asks to audit tokens: run `python3 scripts/tokenleak.py --here` (or `--current`), report the leak score, top 3 leak kinds, and matching rules above, then run `python3 scripts/tokenleak.py suggest` and ask user approval before editing `AGENTS.md`.