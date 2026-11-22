---
name: doc-sync
description: Keep project documentation and architectural decisions synchronized with code changes concisely. Use after implementing features, changing APIs/schemas, or making architectural decisions.
---

# Lean Documentation Sync

Write concise, scannable technical docs for developers—never fluff or narrative essays.

## 1. What to Update (Only When Touched)
- **Public API / Bot Flows:** Update endpoint contracts, request/response payloads, auth headers, or callback payload formats in `docs/` (or `README.md`).
- **Database & Infra:** Document new environment variables in `.env.example` (with dummy values) and non-obvious DB constraints/indexes.
- **Architectural Decisions:** Append a 1–2 line entry to `.agents/memory/DECISIONS.md` (`- **[YYYY-MM-DD] <Topic>:** <Decision & why>`) ONLY when a permanent architectural invariant or non-obvious trade-off was established. Keep `DECISIONS.md` strictly under 30 lines (prune obsolete entries if needed).

## 2. Style Rules
- Use tables, bullet points, and exact code/curl snippets.
- Every documented command or env var must match actual code in the repo.
- Never duplicate docstrings or explain obvious Python syntax.