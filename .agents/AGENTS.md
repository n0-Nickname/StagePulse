# Workspace Rules & Engineering Standards

## 1. Role Boundary & Boot
- **Main Agent (Orchestrator):** Before executing or delegating any multi-step task, load the `lean-delegation` skill for Human-in-the-Loop gates, quota triage, and Task Packet protocols.
- Orchestrator MUST NOT call `read_file` with >80 lines on source/test files—delegate file inspection to `explorer-flash` or inspect exact line windows after `rg -n`.
- **Subagents (`explorer`, `coder`, `devops`):** Execute your assigned Task Packet directly within `SCOPE`. Do NOT load `lean-delegation` or spawn subagents.

## 2. Context & Token Hygiene (Mandatory for All Agents)
- **NEVER** call `schedule` or `manage_subagents` in a polling loop to check subagent progress.
- **After** calling `invoke_subagent` or `send_message`, IMMEDIATELY end your turn and wait for the reactive system wakeup when the subagent finishes.
- **Zero Narration & Compact Output:** Omit greetings, filler, and step-by-step narration. Reference exact `path/to/file.ext:line` locations and concise diffs. Subagents must return `<=15` lines matching their Required Output Format.
- **Targeted Reads Only:** Never read entire large files blindly. Locate symbols with `rg -n` first, then read exact `StartLine`/`EndLine` ranges. Never re-read files already in your context.
- **Do Not Read Injected Rules:** `.agents/AGENTS.md` and `.agents/rules/*.md` are already loaded in your system prompt—edit them directly via `edit_file` without calling `read_file`.
- **Log Offloading (`/tmp`):** Never allow raw test suites, `docker compose` build streams, or stack traces (`>40` lines) into context. Always redirect and tail:
  `L="/tmp/agent_cmd.log"; <cmd> > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`

## 3. Code Quality & Safety Guardrails
- **Root-Cause Fixes:** No dummy stubs, commented-out tests, or arbitrary `sleep` hacks. Keep edits minimal and idiomatic to the repository stack.
- **Strict Scope & Safety:** Never edit files outside your assigned `SCOPE`. Never read/mutate `.env` secrets, spawn detached background daemons, or alter DB schemas/dependencies without explicit approval.
## Token-Efficiency & Execution Guardrails

1. **Bounded Command Output (No Raw Test Dumps):**
   - Never run raw `pytest` or `vitest` without output filtering.
   - Always pipe or restrict logs: `pytest ... --tb=short -q | grep -m 5 -E "FAIL|ERROR|TOTAL"` or `vitest run --reporter=dot | tail -n 15`.
   - Never use `tail -n 40` or higher on failing test runs.

2. **Read Signatures Before Editing:**
   - Before editing any call site across modules, locate the target definition via `rg -n "<symbol>"` and read the exact 10–15 line signature window first. Do not guess parameter names or types.

3. **Sandbox Environment Constraints (Do Not Probe):**
   - **No internet access** inside sandbox: never run `npm install`, `pip install`, or `uv sync`.
   - **No host PostgreSQL** inside sandbox: never run `tests/integration/` inside sandbox unless explicitly instructed that host DB is exposed; run unit/mocked suites (`tests/unit/`) in sandbox and leave full DB integration runs for the host verification step.