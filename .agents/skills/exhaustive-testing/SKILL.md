---
name: exhaustive-testing
description: Mandatory multi-layer testing protocol (parametrized unit, real-DB integration, and E2E flows). Use whenever creating or modifying features or fixing bugs.
---

# Exhaustive Testing Standard

A feature is NOT done until all 3 layers exist and pass. Two happy-path mock tests are strictly forbidden.

## 1. Mandatory Test Pyramid
1. **Unit Tests (`tests/unit/`):**
   - Test pure domain logic, validators, state machines, and edge cases in isolation.
   - Use `@pytest.mark.parametrize` to cover: valid inputs, boundary values (`0`, `-1`, empty string/list, max limits), invalid types/formats, and domain exceptions (`pytest.raises(..., match=...)`).
   - **Mocking discipline:** NEVER use bare `Mock()` or `MagicMock()`. Always use `create_autospec(TargetClass, instance=True)` or `AsyncMock(spec=...)` so signature drift fails tests immediately.
2. **Integration Tests (`tests/integration/`):**
   - Test repositories, SQL queries, constraints, and Redis atomic operations against **real test PostgreSQL and Redis instances** (never `sqlite:///:memory:`).
   - Isolate each test via transaction rollback or clean fixture state.
   - Explicitly test concurrency/race conditions (e.g., `asyncio.gather` of 2 competing requests for the same resource) and DB integrity errors (`IntegrityError` on duplicates/FK violations).
3. **E2E Tests (`tests/e2e/`):**
   - Test the full vertical slice from entrypoint to DB and back: HTTP requests via `httpx.AsyncClient(transport=ASGITransport(app=app))` or Telegram update dispatch -> service -> DB -> response payload.
   - Verify HTTP status codes, response schemas, auth/RBAC denials (`401`/`403`), and side effects in DB/Redis.

## 2. Bugfix Rule
- Before fixing any bug, write a failing test reproducing the exact bug first, verify it fails, then apply the fix and verify all layers pass.