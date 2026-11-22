---
name: lean-delegation
description: Principal Architect & Orchestrator protocol: Human-in-the-Loop gates, quota triage, parallel dispatch, and Task Packets.
---
# Orchestrator & Lean Delegation Protocol

## 1. Human-in-the-Loop Checkpoints (STOP & Ask First)
Wait for explicit user approval before executing or delegating:
1. **Gate 0 (New Module/Feature):** Present file tree, libraries/patterns, and edge-case questions first.
2. **Dependencies & Schema:** Adding/upgrading packages, altering DB schemas, migrations, or core auth/RBAC.
3. **Side-Effects:** Mutating `.env`, background daemons, external tunnels/webhooks, or infra configs.
4. **Ambiguous Logic:** Multiple valid UX flows or architectural trade-offs.
*Format:* State decision needed, 2 concrete options (pros/cons), wait for confirmation.

## 2. Session State & Economic Triage
- **State:** Read `.agents/memory/STATE.md` and `HOT_CONTEXT.md` (plus `DECISIONS.md` if needed) in 1 batch at task start. Invoke `context-compression` ONLY after verified milestones to keep `STATE.md` (<40 lines) and `DECISIONS.md` (<30 lines) updated.
- **1-Turn Quota Rule:** Execute **at most 1 batched tool turn** per user message. Anything requiring >1 round-trip MUST be delegated.
- **Direct Execution (Main Agent):** Known 1–2 files, <50 LOC (`edit_file`), or single `rg -n` lookup.
- **Delegation (`invoke_subagent` — ALWAYS specify `Model` and required `Skills`):**
  - `explorer` (`Model: "hydrogen-low"`): Discovery across >5 files; returns `file:start-end` + signatures.
  - `coder` (`Model: "hydrogen-medium"`): Scoped TDD + full test pyramid.
    - *Backend skills:* `backend-craft`, `exhaustive-testing`, `tokenleak`
    - *Frontend skills:* `frontend-craft`, `tokenleak`
  - `docs-writer` (`Model: "hydrogen-low"`): Post-milestone doc, `.env.example` & `DECISIONS.md` sync. **Skills:** `doc-sync`, `tokenleak`.
  - `devops` (`Model: "hydrogen-low"`): Docker, migrations, atomic git commits. **Skills:** `atomic-git`, `tokenleak`, `context-compression`.
- **Reuse Idle Workers:** Send follow-up fixes in the same `SCOPE` via `send_message` to the idle subagent ID instead of spawning a new one.

## 3. Parallel Dispatch Rules
- **Single subagent:** Scoped implementation in 1–3 files or fixing related failures with one root cause.
- **Parallel subagents (2–4 max in ONE turn):** Strictly non-overlapping writable paths. Freeze shared interfaces/types first and pass them as `Read-only reference`.
- **Do NOT parallelize writes** if shared types/DB schemas aren't finalized, files overlap, or debugging lacks a clear hypothesis.

## 4. Task Packet Template
Strip conversational history; pass ONLY this in `Prompt`:
```markdown
SKILLS: <comma-separated required skills for this worker>
GOAL: <1-sentence objective>
SCOPE:
- Allowed files/dirs: <exact non-overlapping writable paths>
- Read-only reference: <exact paths:line-ranges>
CONSTRAINTS:
- <Exact invariants, libraries, signatures, types>
- Do NOT modify files outside SCOPE. Fix root causes (no dummy stubs/sleeps).
VERIFY:
- <Exact /tmp-logged command for lint/compile/test>
RETURN_SCHEMA:
- Follow AGENTS.md Required Output Format strictly (<=15 lines).
```

## 5. Post-Dispatch Verification
- Audit every worker's `MODIFIED` block for contract drift.
- If `STATUS: BLOCKED` or `NEEDS_USER`, stop immediately—adjust `SCOPE` or escalate the 2 options to the user.
- Run full test/build suite once before closing the milestone.