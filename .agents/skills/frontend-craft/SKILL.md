---
name: frontend-craft
description: Strict TypeScript, UI architecture, performance, and testing standards for frontend applications. Use when building or modifying UI components, state, or API clients.
---

# Frontend Craft & UI Standards

## 1. Architecture Escalation (NO GUESSING)
If a task has ambiguous UX flows, state ownership, or API contract mismatches not covered in `Task Packet` or `.agents/memory/DECISIONS.md`:
- **STOP immediately.** Return `STATUS: NEEDS_USER` with 2 concrete options and trade-offs.

## 2. TypeScript & State Discipline
- **Strict types:** Zero `any`, zero `@ts-ignore` / `@ts-expect-error`, zero unsafe `as Type` casts unless validated via runtime schema (Zod).
- **Single source of truth:** Derive types from backend OpenAPI/schemas or shared contracts; never duplicate DTO interfaces manually across components.
- **Data fetching & state:** Handle all 4 states explicitly (`loading`, `empty`, `error`, `success`). Cancel stale requests (`AbortController`) and debounce rapid user inputs.
- **Performance:** Memoize expensive computations/callbacks only where profiling or list rendering warrants it; virtualize large tables/lists; avoid layout thrashing and waterfall fetches.

## 3. UI & Design Consistency
- Maintain dark Raycast-inspired density (crisp 1px borders, high contrast, keyboard-first shortcuts/navigation) and clean, readable typography.
- Extract reusable primitives instead of copy-pasting long utility class strings across views.

## 4. Testing Pyramid (Mandatory)
- **Unit / Component (`Vitest` + Testing Library):** Test user interactions, keyboard shortcuts, form validation, error/empty states, and edge cases via `@testing-library` queries (`getByRole`, `getByLabelText`)—never test internal state or CSS classes. Mock API boundaries cleanly (MSW or typed fetch mocks).
- **E2E (`Playwright`):** Cover critical user journeys end-to-end against real/staged API (auth flow, primary CRUD/booking flows, permission denials).