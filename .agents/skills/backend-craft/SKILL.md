---
name: backend-craft
description: Production Python 3.14+ engineering standards (FastAPI, async SQLAlchemy, Redis, aiogram). Use when writing or refactoring application code.
---

# Backend Craft & Performance Standards

## 1. Architecture Escalation (NO GUESSING)
If a task involves ambiguous business logic, schema trade-offs, new external integrations, or cross-module coupling not specified in `Task Packet` or `.agents/memory/DECISIONS.md`:
- **STOP immediately.** Do NOT invent workarounds or guess defaults.
- Return `STATUS: NEEDS_USER` with 2 concrete options and trade-offs so the Orchestrator can escalate.

## 2. Performance & Concurrency Rules
- **Zero blocking I/O in async:** Never call sync DB drivers, `requests`, `time.sleep`, or heavy CPU loops on the event loop. Offload CPU-bound work via `asyncio.to_thread`.
- **Bounded concurrency:** Never run unbounded `asyncio.gather(*untrusted_list)`. Always wrap external/batch I/O in `asyncio.Semaphore(N)` or `asyncio.TaskGroup`.
- **Database & N+1 discipline:**
  - Always use explicit eager loading (`selectinload` / `joinedload`) in async SQLAlchemy; lazy loads raise `MissingGreenlet`.
  - Protect concurrent state mutations (e.g., seat holds, balances) with `SELECT ... FOR UPDATE` or atomic `INSERT ... ON CONFLICT` / Redis Lua/atomic ops.
  - Batch bulk writes (`insert().values(...)` or PostgreSQL `UNNEST`), never `session.add()` in a loop.
- **Memory & Hot Paths:** Use `@dataclass(slots=True)` or Pydantic v2 `BaseModel` (`model_config = ConfigDict(extra="forbid")`) for internal DTOs. Avoid unnecessary dict/list copies in hot loops.

## 3. Code & Type Strictness
- Full type annotations on all functions/methods (`X | None`, `collections.abc` protocols). Zero `Any` unless interfacing with untyped third-party JSON.
- Always use timezone-aware UTC (`datetime.now(UTC)`).
- Catch specific exceptions (`except ValueError:`), never bare `except:` or silent `except Exception: pass`.
- Keep functions small and single-purpose; split complex flows into pure domain functions + thin I/O adapters.