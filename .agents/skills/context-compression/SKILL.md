---
name: context-compression
description: Maintains lightweight cross-session project memory in .agents/memory/ (STATE.md and DECISIONS.md) so new sessions or post-compaction agents resume instantly without re-scanning the codebase. Invoke ONLY at milestone boundaries, before /compact, or when finishing a work session.
---

# Cross-Session Project Memory

## When to Invoke
- After completing a verified milestone/feature (NOT after every minor edit).
- Before running `/compact` or ending a coding session.
- At the start of a new session: read `.agents/memory/STATE.md` and `DECISIONS.md` first instead of scanning the repo.

## Rules
1. **No scratchpad files in repo:** Raw command logs belong in `/tmp` (see `tokenleak`), never inside `.agents/`.
2. **Overwrite, don't append to `STATE.md`:** Keep `.agents/memory/STATE.md` strictly under 40 lines. Replace completed/obsolete items rather than keeping a running diary.
3. **Append-only `DECISIONS.md` (with pruning):** Keep `.agents/memory/DECISIONS.md` under 30 lines. Record only permanent architectural constraints, schema invariants, or resolved non-obvious bugs—never routine tasks.

## File Formats

### `.agents/memory/STATE.md` (Max 40 lines)
```markdown
# Project State
## Active Goal
- <1-line current milestone>
## Done (Verified)
- [x] <feature/module> (`key/file/paths`)
## Next Up
- [ ] <next concrete slice>
## Entrypoints & Hotspots
- `path/to/core`: <1-line responsibility>