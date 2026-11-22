---
name: atomic-git
description: Enforce clean, atomic Conventional Commits split by logical layer. Use when committing work or preparing a changeset.
---

# Atomic Git Commits

NEVER dump unrelated files, migrations, features, tests, and docs into one giant commit.

## 1. Split Strategy (Commit Order)
Group changes by logical concern into separate commits:
1. `build` / `chore`: Dependencies (`pyproject.toml`, `uv.lock`) or config changes.
2. `feat(db)` / `refactor(db)`: Models and Alembic migrations (verify migration file before staging).
3. `feat(<module>)` / `fix(<module>)`: Core application logic.
4. `test(<module>)`: Unit, integration, and E2E tests.
5. `docs`: Architecture updates, README, or `.agents/memory/DECISIONS.md`.

## 2. Execution & Safety
- Inspect first: `git status --porcelain=v2` and `git diff --stat`.
- Stage specific files only: `git add -- <exact-paths>` (never `git add .` or `git add -A` when multiple concerns exist).
- Format: `<type>(<scope>): <imperative summary <=72 chars>` + `-m "<why and what changed>"`.
- **Forbidden:** Committing `.env`, `HOT_CONTEXT.md`, or `/tmp` logs; using `--no-verify`, `--amend`, `git reset --hard`, or `git push`.
- Verify after each commit: `git log -1 --stat` and `git status -s`.