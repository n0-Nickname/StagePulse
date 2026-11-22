#!/usr/bin/env python3
"""ag_leak: find where Google Antigravity leaks context tokens.

Reads local session and subagent transcripts (~/.gemini/antigravity/brain),
prices every tool result by the "context tax" it imposed (its size x every
later call that re-sent it), and generates rules for .agents/AGENTS.md.
Local, read-only, stdlib only.
"""
from __future__ import annotations

import argparse
import bisect
import html
import json
import os
import re
import shlex
import sys
import tempfile
import time
from datetime import datetime

__version__ = "2.0.0-ag"
CHARS_PER_TOKEN = 4.0
IMAGE_TOKENS = 1500
MAX_KEEP_CHARS = 200_000

# Token price weights for Gemini (Argon / Pro / Flash):
# fresh input = 1.0, cached read = 0.25, output = 4.5
WEIGHTS = {"read": 0.25, "out": 4.5, "enter": 1.0}

# kind: (threshold tokens, target budget after fix, fix rule)
KINDS = {
    "noisy-shell": (2000, 600, "Bound command output: use quiet flags (-q), `> /tmp/out.log; tail -n 40`"),
    "big-read": (3500, 1500, "Use `grep_search` or `view_file_outline` first, then read only required lines"),
    "re-read": (0, 0, "Never re-read a file that is already in context and unchanged"),
    "wide-search": (2000, 500, "Narrow searches: scope directory, extension, or result count"),
    "big-fetch": (3000, 1200, "Fetch precisely: targeted queries or specific fields only"),
    "big-result": (4000, 1500, "Cap tool and subagent output: return concise summaries"),
    "rewrite": (1500, 0, "Use `replace_file_content` instead of overwriting whole files"),
    "serial-call": (0, 0, "Batch independent reads and searches into a single turn"),
    "wasted-call": (0, 0, "Avoid duplicate tool calls with identical arguments"),
    "verbose-reply": (2000, 500, "Answer lean: result first, no recap"),
}

SIZE_KIND = {
    "shell": "noisy-shell",
    "read": "big-read",
    "search": "wide-search",
    "fetch": "big-fetch",
    "subagent": "big-result",
    "other": "big-result",
}

READ_TOOLS = {"view_file", "view_file_outline", "view_code_item", "read_file", "read"}
SEARCH_TOOLS = {"grep_search", "find_by_name", "list_dir", "codebase_search", "grep", "glob", "ls"}
SHELL_TOOLS = {"run_command", "command_status", "send_command_input", "bash", "exec_command", "shell"}
EDIT_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content", "edit_file", "write_file"}
FETCH_TOOLS = {"read_url_content", "search_web", "webfetch", "web_search"}
SUBAGENT_TOOLS = {"invoke_subagent", "browser_subagent", "task", "agent", "spawn_agent"}

READ_CMDS = {"cat", "sed", "head", "tail", "nl", "less", "more", "bat"}
SEARCH_CMDS = {"rg", "grep", "egrep", "ag", "find", "fd", "ls", "tree"}
MUTATES_ALL = re.compile(
    r"git\s+(checkout|switch|stash|reset|pull|merge|rebase|restore|apply)|--fix\b|"
    r"prettier|black\b|ruff\s+format|gofmt|cargo\s+fmt|npm\s+run\s+format|sed\s+-i"
)

WORD = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*")
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)


# ---------------------------------------------------------------- model

class Call:
    __slots__ = ("pos", "seg", "fresh", "cread", "out", "tools", "text_chars", "ts")

    def __init__(self, pos: int, seg: int, ts: float | None = None):
        self.pos, self.seg, self.ts = pos, seg, ts
        self.fresh = self.cread = self.out = 0
        self.tools: list[ToolUse] = []
        self.text_chars = 0

    @property
    def ctx_in(self) -> int:
        return self.fresh + self.cread


class ToolUse:
    __slots__ = ("id", "name", "input", "pos", "call", "result")

    def __init__(self, uid: str | None, name: str, inp: dict | str, pos: int):
        self.id, self.name, self.input, self.pos = uid, name or "", inp, pos
        self.call: Call | None = None
        self.result: Result | None = None


class Result:
    __slots__ = ("tool", "pos", "seg", "tokens", "text")

    def __init__(self, tool: ToolUse, pos: int, seg: int, tokens: float, text: str):
        self.tool, self.pos, self.seg, self.tokens, self.text = tool, pos, seg, tokens, text


class Thread:
    __slots__ = (
        "path", "session", "cwd", "subagent", "calls", "uses", "results",
        "human_pos", "notes", "start", "start_ctx", "mtime"
    )

    def __init__(self, path: str):
        self.path = path
        self.session: str | None = None
        self.cwd: str | None = None
        self.subagent = "/subagents/" in path.replace(os.sep, "/") or "subagent" in os.path.basename(path).lower()
        self.calls: list[Call] = []
        self.uses: list[ToolUse] = []
        self.results: list[Result] = []
        self.human_pos: list[int] = []
        self.notes: list[tuple[int, str]] = []
        self.start: str | None = None
        self.start_ctx: int | None = None
        self.mtime = os.path.getmtime(path)


class Finding:
    __slots__ = ("kind", "thread", "tool", "label", "tokens", "avoidable", "later", "cost", "pos")

    def __init__(self, kind, thread, tool, label, tokens, avoidable, later, cost, pos):
        self.kind, self.thread, self.tool, self.label = kind, thread, tool, label
        self.tokens, self.avoidable, self.later, self.cost, self.pos = tokens, avoidable, later, cost, pos


# ---------------------------------------------------------------- helpers

def epoch(iso) -> float | None:
    if iso is None:
        return None
    if isinstance(iso, (int, float)) and not isinstance(iso, bool):
        return iso / 1000.0 if iso > 1e11 else float(iso)
    text = re.sub(r"(\.\d{6})\d+", r"\1", str(iso).strip().replace("Z", "+00:00"))
    text = re.sub(r"\.(\d{1,5})(?=[+-]|$)", lambda m: "." + m.group(1).ljust(6, "0"), text)
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def measure(content) -> tuple[str, float]:
    if content is None:
        return "", 0.0
    if isinstance(content, str):
        return content, len(content) / CHARS_PER_TOKEN
    if isinstance(content, dict):
        if "result" in content and len(content) == 1:
            return measure(content["result"])
        content = [content]
    parts, images = [], 0
    for c in content if isinstance(content, list) else []:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict):
            if "image" in str(c.get("type", "")) or "inlineData" in c:
                images += 1
            elif isinstance(c.get("text"), str):
                parts.append(c["text"])
            else:
                parts.append(json.dumps(c, ensure_ascii=False))
    text = "\n".join(parts)
    return text, len(text) / CHARS_PER_TOKEN + images * IMAGE_TOKENS


def _body(text: str) -> str:
    return REMINDER.sub("", text or "").strip()


def _norm(path: str, cwd: str | None) -> str:
    if not path:
        return ""
    path = os.path.expanduser(str(path))
    if cwd and not os.path.isabs(path):
        path = os.path.join(cwd, path)
    return os.path.normpath(path)


def _num(v) -> int | float | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def call_cost(c: Call) -> float:
    return c.fresh + WEIGHTS["read"] * c.cread + WEIGHTS["out"] * c.out


# ---------------------------------------------------------------- parser

def _iter_events(path: str):
    """Stream .jsonl line-by-line or load monolithic .json (trajectory / steps / list)."""
    with open(path, encoding="utf-8", errors="replace") as f:
        first_char = ""
        while True:
            ch = f.read(1)
            if not ch:
                return
            if not ch.isspace():
                first_char = ch
                break
        f.seek(0)
        if first_char == "[":
            try:
                data = json.load(f)
                if isinstance(data, list):
                    yield from enumerate(data, 1)
            except ValueError:
                return
        else:
            for pos, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if pos == 1 and isinstance(obj, dict):
                    steps = obj.get("trajectory") or obj.get("steps") or obj.get("messages")
                    if isinstance(steps, list):
                        yield from enumerate(steps, 1)
                        return
                yield pos, obj


def parse_antigravity(path: str) -> Thread:
    t = Thread(path)
    parts = path.replace(os.sep, "/").split("/")
    if "brain" in parts:
        idx = parts.index("brain")
        if idx + 1 < len(parts):
            t.session = parts[idx + 1]

    pending: dict[str, ToolUse] = {}
    running_ctx = 0
    seg = 0

    for pos, d in _iter_events(path):
        if not isinstance(d, dict):
            continue

        t.start = t.start or d.get("timestamp") or d.get("created_at") or d.get("createTime")
        t.cwd = t.cwd or d.get("cwd") or d.get("workspace") or d.get("workspace_root") or d.get("projectPath")
        if d.get("sessionId") or d.get("session_id"):
            t.session = str(d.get("sessionId") or d.get("session_id"))

        typ = d.get("type") or d.get("role") or d.get("author") or ""
        if typ in ("compact", "compacted", "context_reset"):
            seg += 1
            running_ctx = int(running_ctx * 0.25)
            continue

        # 1. User message
        if typ in ("user", "human", "user_message", "USER"):
            raw_msg = d.get("text") or d.get("content") or d.get("message") or ""
            if isinstance(raw_msg, dict):
                raw_msg = raw_msg.get("text") or raw_msg.get("content") or ""
            elif isinstance(raw_msg, list):
                raw_msg = "\n".join(str(x.get("text", "")) for x in raw_msg if isinstance(x, dict))
            txt = str(raw_msg)
            if txt:
                t.human_pos.append(pos)
                t.notes.append((pos, txt[:MAX_KEEP_CHARS]))
                running_ctx += int(len(txt) / CHARS_PER_TOKEN)

        # 2. Model / Agent step
        elif typ in ("model", "assistant", "agent", "step", "MODEL", "ASSISTANT"):
            call = Call(pos, seg, epoch(d.get("timestamp") or d.get("createTime")))
            usage = d.get("usage") or d.get("usageMetadata") or {}
            msg_obj = d.get("message") if isinstance(d.get("message"), dict) else d

            out_text = str(msg_obj.get("text") or msg_obj.get("thought") or "")
            parts_list = msg_obj.get("parts") or msg_obj.get("content") or []
            if isinstance(parts_list, list):
                out_text += "".join(
                    str(p.get("text") or p.get("thought") or "")
                    for p in parts_list if isinstance(p, dict)
                )
            call.text_chars = len(out_text)

            if usage:
                cached = (
                    usage.get("cachedContentTokenCount")
                    or usage.get("cached_tokens")
                    or usage.get("cache_read_input_tokens")
                    or 0
                )
                prompt_toks = (
                    usage.get("promptTokenCount")
                    or usage.get("input_tokens")
                    or 0
                )
                call.cread = int(cached)
                call.fresh = max(0, int(prompt_toks) - int(cached))
                call.out = int(
                    usage.get("candidatesTokenCount")
                    or usage.get("output_tokens")
                    or max(1, len(out_text) // int(CHARS_PER_TOKEN))
                )
                running_ctx = call.ctx_in + call.out
            else:
                call.cread = int(running_ctx * 0.85)
                call.fresh = max(250, int(running_ctx * 0.15))
                call.out = max(1, int(len(out_text) / CHARS_PER_TOKEN))
                running_ctx += call.out

            t.calls.append(call)

            # Extract tool calls across Gemini/Antigravity schemas
            raw_tcs = []
            for key in ("tool_calls", "function_calls", "toolCalls"):
                if isinstance(msg_obj.get(key), list):
                    raw_tcs.extend(msg_obj[key])
            if "functionCall" in msg_obj:
                raw_tcs.append(msg_obj["functionCall"])
            if isinstance(parts_list, list):
                for p in parts_list:
                    if isinstance(p, dict):
                        if "functionCall" in p:
                            raw_tcs.append(p["functionCall"])
                        elif p.get("type") in ("tool_use", "tool_call", "function_call"):
                            raw_tcs.append(p)

            for idx_tc, tc in enumerate(raw_tcs):
                if not isinstance(tc, dict):
                    continue
                name = str(tc.get("name") or tc.get("tool_name") or "")
                if not name:
                    continue
                cid = str(tc.get("id") or tc.get("call_id") or f"{pos}_{idx_tc}_{name}")
                inp = tc.get("args") if tc.get("args") is not None else (
                    tc.get("arguments") if tc.get("arguments") is not None else tc.get("input", {})
                )
                if isinstance(inp, str):
                    try:
                        inp = json.loads(inp)
                    except ValueError:
                        pass
                tu = ToolUse(cid, name, inp, pos)
                tu.call = call
                call.tools.append(tu)
                t.uses.append(tu)
                pending[cid] = tu
                pending[name] = tu
                running_ctx += int(len(json.dumps(inp, default=str)) / CHARS_PER_TOKEN)

        # 3. Tool response
        elif typ in ("tool", "function", "tool_result", "function_response", "TOOL", "FUNCTION"):
            resp_list = [d.get("functionResponse") or d]
            if isinstance(d.get("parts"), list):
                resp_list = [p["functionResponse"] for p in d["parts"] if isinstance(p, dict) and "functionResponse" in p] or resp_list

            for resp in resp_list:
                if not isinstance(resp, dict):
                    continue
                cid = str(resp.get("id") or resp.get("call_id") or resp.get("tool_use_id") or resp.get("name") or "")
                tu = pending.pop(cid, None)
                if tu is not None:
                    content = (
                        resp.get("response")
                        if resp.get("response") is not None
                        else resp.get("output", resp.get("content", resp.get("result")))
                    )
                    text, toks = measure(content)
                    tu.result = Result(tu, pos, seg, toks, text[:MAX_KEEP_CHARS])
                    t.results.append(tu.result)
                    running_ctx += int(toks)

    return t


# ---------------------------------------------------------------- classification

def shell_command(inp) -> str:
    if isinstance(inp, str):
        return inp
    if not isinstance(inp, dict):
        return ""
    c = inp.get("CommandLine") or inp.get("command") or inp.get("cmd") or inp.get("code") or ""
    if isinstance(c, list):
        return " ".join(map(str, c))
    return str(c)


def _main_segment(cmd: str) -> list[str]:
    for seg in re.split(r"&&|\|\||;|\n", cmd):
        seg = seg.split("|")[0].strip()
        try:
            words = shlex.split(seg) if any(ch in seg for ch in "'\"\\") else seg.split()
        except ValueError:
            words = seg.split()
        while words and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0]) or words[0] in ("sudo", "time", "env")):
            words = words[1:]
        if words and words[0] not in ("cd", "export", "source", ".", "set", "echo", "pushd"):
            return words
    return []


def classify(tu: ToolUse) -> tuple[str, str, tuple | str | None]:
    n = tu.name.lower()
    inp = tu.input if isinstance(tu.input, dict) else {}

    if n in READ_TOOLS:
        path = inp.get("TargetFile") or inp.get("file_path") or inp.get("path") or inp.get("target_file") or ""
        start = _num(inp.get("StartLine") or inp.get("offset") or inp.get("start_line"))
        end = _num(inp.get("EndLine") or inp.get("limit") or inp.get("end_line"))
        if start is not None and end is not None and inp.get("EndLine") is not None:
            end = max(1, end - start + 1)
        return "read", str(path), (start, end)

    if n in SEARCH_TOOLS:
        target = (
            inp.get("Query") or inp.get("pattern") or inp.get("query")
            or inp.get("SearchDirectory") or inp.get("SearchPath") or inp.get("path") or ""
        )
        return "search", str(target), None

    if n in EDIT_TOOLS:
        target = inp.get("TargetFile") or inp.get("file_path") or inp.get("path") or ""
        return "edit", str(target), None

    if n in FETCH_TOOLS or "mcp" in n:
        target = inp.get("Url") or inp.get("url") or inp.get("Query") or inp.get("query") or tu.name
        return "fetch", str(target), None

    if n in SUBAGENT_TOOLS:
        target = inp.get("TaskName") or inp.get("Task") or inp.get("description") or inp.get("prompt") or ""
        return "subagent", str(target)[:80], None

    if n in SHELL_TOOLS or "CommandLine" in inp or "command" in inp:
        cmd = shell_command(tu.input)
        words = _main_segment(cmd)
        head = words[0].rsplit("/", 1)[-1] if words else ""
        if head in READ_CMDS and len(words) > 1:
            files = [w for w in words[1:] if not w.startswith("-") and not re.match(r"^[0-9,]+p?$", w)]
            return "read", files[-1] if files else "", cmd.strip()
        if head in SEARCH_CMDS or words[:2] == ["git", "grep"]:
            return "search", cmd, None
        return "shell", cmd, None

    return "other", tu.name, None


def _covers(prev, new) -> bool:
    if isinstance(prev, str) or isinstance(new, str):
        if isinstance(prev, str) and isinstance(new, str) and prev == new:
            return True
        return isinstance(prev, str) and _main_segment(prev)[:1] == ["cat"] and "|" not in prev
    if not prev or not new:
        return False
    po, pl = prev
    no, nl = new
    if pl is None and (po in (None, 0, 1)):
        return True
    if pl is None or nl is None:
        return False
    po, no = po or 1, no or 1
    return po <= no and po + pl >= no + nl


# ---------------------------------------------------------------- analysis

def analyze(t: Thread) -> tuple[list[Finding], float]:
    by_seg: dict[int, list[int]] = {}
    for c in t.calls:
        by_seg.setdefault(c.seg, []).append(c.pos)

    def later(pos: int, seg: int) -> int:
        ps = by_seg.get(seg, [])
        return len(ps) - bisect.bisect_right(ps, pos)

    findings: list[Finding] = []

    def add(kind: str, tu: ToolUse | None, label: str, tokens: float, avoidable: float,
            pos: int, seg: int, out_w: float = 0.0, cost: float | None = None):
        n = later(pos, seg)
        if cost is None:
            cost = avoidable * (out_w + ((WEIGHTS["enter"] + (n - 1) * WEIGHTS["read"]) if n else 0))
        if cost > 0:
            findings.append(Finding(kind, t, tu.name if tu else "reply", label, tokens, avoidable, n, cost, pos))

    reads: dict[str, tuple[int, tuple | str | None, str]] = {}
    seen_calls: dict[tuple[str, str], tuple[int, int]] = {}

    for tu in sorted(t.uses, key=lambda u: u.pos):
        cat, target, rng = classify(tu)
        r = tu.result

        if cat == "edit":
            norm_t = _norm(target, t.cwd)
            reads.pop(norm_t, None)
            if tu.name.lower() == "write_to_file" and isinstance(tu.input, dict) and not tu.input.get("EmptyFile"):
                content = str(tu.input.get("CodeContent") or tu.input.get("content") or "")
                toks = len(content) / CHARS_PER_TOKEN
                if toks > KINDS["rewrite"][0] and tu.input.get("Overwrite"):
                    add("rewrite", tu, target, toks, toks * 0.7, tu.pos, r.seg if r else 0, out_w=WEIGHTS["out"])
            continue

        if cat == "shell":
            if MUTATES_ALL.search(target):
                reads.clear()
            else:
                for p in [p for p in reads if os.path.basename(p) and os.path.basename(p) in target]:
                    reads.pop(p)

        if r is None:
            continue

        if cat == "read" and target:
            key, body = _norm(target, t.cwd), _body(r.text)
            prev = reads.get(key)
            same = bool(prev) and prev[0] == r.seg and _covers(prev[1], rng) and bool(body) and body in prev[2]
            if same and r.tokens >= 50:
                add("re-read", tu, target, r.tokens, r.tokens, r.pos, r.seg)
                continue
            if not same:
                reads[key] = (r.seg, rng, body)

        elif cat in ("search", "fetch", "subagent", "other"):
            sig = (tu.name, json.dumps(tu.input, sort_keys=True, default=str))
            prev = seen_calls.get(sig)
            body = _body(r.text)
            digest = hash(body)
            if body and prev == (r.seg, digest) and r.tokens >= 50:
                add("wasted-call", tu, target, r.tokens, r.tokens, r.pos, r.seg)
                continue
            seen_calls[sig] = (r.seg, digest)

        kind = SIZE_KIND.get(cat)
        if kind:
            flag, budget, _ = KINDS[kind]
            if r.tokens > flag:
                add(kind, tu, target, r.tokens, r.tokens - budget, r.pos, r.seg)

    # Detect serial round-trips (two independent read/search calls across separate turns)
    human, known, ei = t.human_pos, set(), 0
    texts = sorted([(r.pos, r.text) for r in t.results] + t.notes, key=lambda x: x[0])
    for a, b in zip(t.calls, t.calls[1:]):
        while ei < len(texts) and texts[ei][0] < a.pos:
            known.update(WORD.findall(texts[ei][1]))
            ei += 1
        if a.seg != b.seg or len(a.tools) != 1 or len(b.tools) != 1:
            continue
        ta, tb = a.tools[0], b.tools[0]
        ca, tga, _ = classify(ta)
        cb, tgb, _ = classify(tb)
        if ca not in ("read", "search") or cb not in ("read", "search") or not ta.result:
            continue
        if bisect.bisect_left(human, a.pos) != bisect.bisect_left(human, b.pos):
            continue
        key = os.path.basename(str(tgb).rstrip("/")) if cb == "read" else _longest_word(tgb)
        if not key or key not in known or (ca == cb == "read" and tga == tgb):
            continue
        if key.rsplit(".", 1)[0] in ta.result.text:
            continue
        if any(n in ta.result.text for n in re.findall(r"\d{2,}", json.dumps(tb.input, default=str))):
            continue
        add("serial-call", tb, tgb, 0, 0, b.pos, b.seg, cost=b.cread * WEIGHTS["read"])

    flag, budget, _ = KINDS["verbose-reply"]
    for c in t.calls:
        toks = c.text_chars / CHARS_PER_TOKEN
        if toks > flag:
            add("verbose-reply", None, "", toks, toks - budget, c.pos, c.seg, out_w=WEIGHTS["out"])

    return findings, sum(call_cost(c) for c in t.calls)


def _longest_word(target: str) -> str:
    words = [w for w in re.findall(r"[A-Za-z0-9_]{4,}", str(target)) if w not in ("grep", "find", "head", "tail")]
    return max(words, key=len) if words else ""


# ---------------------------------------------------------------- discovery & aggregation

def default_root() -> str:
    return os.environ.get("ANTIGRAVITY_HOME") or os.path.join(os.path.expanduser("~"), ".gemini", "antigravity", "brain")


def find_files(paths: list[str], since: float) -> list[str]:
    out = []
    targets = paths or [default_root()]
    ignore = {"task.md", "implementation_plan.md", "walkthrough.md", "package.json", "tsconfig.json"}
    for root in targets:
        if os.path.isfile(root):
            out.append(root)
            continue
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f in ignore or f.endswith(".resolved"):
                    continue
                if f.endswith(".jsonl") or (f.endswith(".json") and any(k in f for k in ("session", "trajectory", "event", "log", "trace"))):
                    p = os.path.join(dirpath, f)
                    try:
                        if os.path.getmtime(p) >= since:
                            out.append(p)
                    except OSError:
                        pass
    return list(dict.fromkeys(os.path.realpath(p) for p in out))


def parse_since(s: str | None) -> float:
    if not s or s == "all":
        return 0.0
    m = re.fullmatch(r"(\d+)([hdw])", s)
    if m:
        return time.time() - int(m.group(1)) * {"h": 3600, "d": 86400, "w": 604800}[m.group(2)]
    ts = epoch(s) if re.search(r"[T ]\d|Z$|[+-]\d\d:?\d\d$", s) else None
    if ts is None:
        try:
            ts = datetime.fromisoformat(s).timestamp()
        except ValueError:
            raise ValueError(f"Invalid time format {s!r}: use 24h, 7d, 4w, 2026-11-01, or all") from None
    return ts


_INSTR_CACHE: dict[str | None, list[tuple[str, float]]] = {}


def always_loaded(cwd: str | None) -> list[tuple[str, float]]:
    if cwd in _INSTR_CACHE:
        return _INSTR_CACHE[cwd]
    home = os.path.expanduser("~")
    cands = [os.path.join(home, ".gemini", "GEMINI.md")]
    names = ("AGENTS.md", "GEMINI.md", ".antigravityrules", os.path.join(".agents", "AGENTS.md"), os.path.join(".gemini", "GEMINI.md"))
    d = cwd
    while d:
        cands += [os.path.join(d, n) for n in names]
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    out, seen = [], set()
    for f in cands:
        real = os.path.realpath(f)
        if real in seen or not os.path.isfile(f):
            continue
        seen.add(real)
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                size = len(fh.read()) / CHARS_PER_TOKEN
            if size >= 1:
                out.append((f, size))
        except OSError:
            pass
    _INSTR_CACHE[cwd] = out
    return out


def collect(args) -> tuple[list[Thread], float]:
    if args.compare and args.since is None:
        split = parse_since(args.compare)
        since = split - (time.time() - split)
    else:
        since = 0.0 if args.paths and args.since is None else parse_since(args.since or "7d")

    files = find_files(args.paths, since)
    here = os.path.realpath(os.getcwd())
    threads = []

    for f in files:
        try:
            t = parse_antigravity(f)
        except (OSError, UnicodeError) as e:
            print(f"ag_leak: skipped {f}: {e}", file=sys.stderr)
            continue

        if t.calls:
            t.start_ctx = t.calls[0].ctx_in
        if since and t.calls:
            keep = [c for c in t.calls if c.ts is None or c.ts >= since]
            if len(keep) < len(t.calls):
                first = keep[0].pos if keep else float("inf")
                t.calls = keep
                t.uses = [u for u in t.uses if u.pos >= first]
                t.results = [r for r in t.results if r.pos >= first]
        if not t.calls:
            continue
        if args.here or args.current:
            cwd = os.path.realpath(t.cwd) if t.cwd else ""
            if not (cwd == here or cwd.startswith(here + os.sep)):
                continue
        if args.project and args.project.lower() not in (t.cwd or "").lower():
            continue
        if args.session and args.session not in (t.session or "") and args.session not in f:
            continue
        threads.append(t)

    if args.current and threads:
        latest = max((t for t in threads if not t.subagent), key=lambda t: t.mtime, default=threads[0])
        threads = [t for t in threads if t.session == latest.session]

    return threads, since


def summarize(threads: list[Thread]):
    findings, units, sess, loaded, firsts, base_cost = [], 0.0, {}, {}, [], 0.0
    projects, per_thread = {}, []
    split = {"cache_read": 0.0, "cache_write": 0.0, "output": 0.0}

    for t in threads:
        try:
            fs, u = analyze(t)
        except Exception as e:
            print(f"ag_leak: error analyzing {t.path}: {e}", file=sys.stderr)
            continue

        key = t.session or t.path
        per_thread.append((t.cwd or "?", key, u, sum(f.cost for f in fs)))
        pj = projects.setdefault(t.cwd or "?", {"units": 0.0, "leak": 0.0, "sessions": set()})
        pj["units"] += u
        pj["leak"] += sum(f.cost for f in fs)
        pj["sessions"].add(key)

        if not t.subagent and t.calls:
            n, nseg = len(t.calls), len({c.seg for c in t.calls})
            first = t.calls[0]
            start = t.start_ctx if t.start_ctx is not None else first.ctx_in
            firsts.append(start)
            if start == first.ctx_in:
                base_cost += call_cost(first) - WEIGHTS["out"] * first.out + start * WEIGHTS["read"] * (n - 1)
            else:
                base_cost += start * WEIGHTS["read"] * n

            for f, toks in always_loaded(t.cwd):
                e = loaded.setdefault(f, {"tokens": toks, "cost": 0.0, "sessions": 0})
                e["cost"] += toks * (nseg * WEIGHTS["enter"] + (n - nseg) * WEIGHTS["read"])
                e["sessions"] += 1

        findings += fs
        units += u
        s = sess.setdefault(key, {"units": 0.0, "leak": 0.0})
        s["units"] += u
        s["leak"] += sum(f.cost for f in fs)

        for c in t.calls:
            split["cache_read"] += WEIGHTS["read"] * c.cread
            split["output"] += WEIGHTS["out"] * c.out
            split["cache_write"] += call_cost(c) - WEIGHTS["read"] * c.cread - WEIGHTS["out"] * c.out
            c.tools = []
        for r in t.results:
            r.text = ""

    leak = sum(f.cost for f in findings)
    pct = 100 * leak / units if units else 0.0

    by_project = [
        {
            "cwd": cwd,
            "sessions": len(pj["sessions"]),
            "cost_units": pj["units"],
            "leak_pct": 100 * pj["leak"] / pj["units"] if pj["units"] else 0,
            "leak_units": pj["leak"],
        }
        for cwd, pj in projects.items()
    ]
    by_project.sort(key=lambda p: -p["leak_units"])

    totals = {
        "threads": len(threads),
        "sessions": len(sess),
        "api_calls": sum(len(t.calls) for t in threads),
        "context_tokens": sum(c.ctx_in for t in threads for c in t.calls),
        "cache_read_tokens": sum(c.cread for t in threads for c in t.calls),
        "fresh_tokens": sum(c.fresh for t in threads for c in t.calls),
        "output_tokens": sum(c.out for t in threads for c in t.calls),
        "cost_units": units,
        "cost_split_pct": {
            k: round(100 * v / units, 1) if units else 0
            for k, v in dict(split, context=split["cache_read"] + split["cache_write"]).items()
        },
        "leak_units": leak,
        "leak_pct": pct,
        "grade": grade(pct),
        "avg_first_call_context": sum(firsts) / len(firsts) if firsts else 0,
        "base_context_pct": 100 * base_cost / units if units else 0,
        "always_loaded": sorted(({"path": f, **e} for f, e in loaded.items()), key=lambda e: -e["cost"]),
        "projects": by_project,
    }

    by_kind = {}
    for f in findings:
        k = by_kind.setdefault(f.kind, {"count": 0, "avoidable_tokens": 0.0, "cost": 0.0})
        k["count"] += 1
        k["avoidable_tokens"] += f.avoidable
        k["cost"] += f.cost

    findings.sort(key=lambda f: -f.cost)
    return totals, by_kind, findings


# ---------------------------------------------------------------- formatting & reports

def fmt(n: float) -> str:
    n = float(n)
    for unit, div in (("B", 1e9), ("M", 1e6), ("k", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.1f}{unit}"
    return f"{n:.0f}"


def pct_str(p: float) -> str:
    return f"{p:.1f}%" if p >= 0.1 else f"{p:.2f}%" if p >= 0.01 else "<0.01%"


def grade(pct: float) -> str:
    for g, lim in (("A", 5), ("B", 10), ("C", 20), ("D", 30)):
        if pct < lim:
            return g
    return "F"


class Style:
    def __init__(self, on: bool):
        self.on = on

    def __call__(self, code: str, s) -> str:
        return f"\033[{code}m{s}\033[0m" if self.on else str(s)


def label_of(f: Finding, redact: bool) -> str:
    if f.kind == "verbose-reply":
        return "assistant reply"
    if redact:
        return f.tool
    lab = re.sub(r"\s+", " ", str(f.label)).strip()
    cwd = (f.thread.cwd or "").rstrip("/")
    if cwd:
        lab = re.sub(r'cd "?' + re.escape(cwd) + r'"? *&& *', "", lab).replace(cwd + "/", "")
    lab = lab.replace(os.path.expanduser("~"), "~")
    return f"{f.tool} {lab}" if lab and lab != f.tool else f.tool


def fit(lab: str, width: int) -> str:
    if len(lab) <= width:
        return lab
    tool, _, rest = lab.partition(" ")
    if rest and " " not in rest and ("/" in rest or "\\" in rest) and width - len(tool) - 2 > 0:
        return f"{tool} …{rest[len(rest) - (width - len(tool) - 2):]}"
    return lab[: width - 1] + "…"


def print_report(totals, by_kind, findings, since, args, out=None):
    out = out or sys.stdout
    st = Style((out.isatty() or bool(os.environ.get("FORCE_COLOR"))) and not args.no_color and not os.environ.get("NO_COLOR"))
    w = out.write

    if not totals["threads"]:
        w(f"ag_leak: no Antigravity transcripts found in {default_root()}.\n"
          "Try --since 30d or pass a session folder path directly.\n")
        return

    when = datetime.fromtimestamp(since).strftime("%Y-%m-%d") if since else "the beginning"
    w(f"\n{st('1', 'ag_leak')} {__version__}  {st('2', '·')}  {totals['sessions']} Antigravity session{'s' * (totals['sessions'] != 1)}  "
      f"{st('2', '·')}  {fmt(totals['api_calls'])} API calls  {st('2', '·')}  since {when}\n\n")
    w(f"  context processed  {st('1', fmt(totals['context_tokens']))} tokens  "
      f"{st('2', '(cache reads ' + fmt(totals['cache_read_tokens']) + ' · fresh ' + fmt(totals['fresh_tokens']) + ')')}"
      f"   output {fmt(totals['output_tokens'])}\n")

    sp = totals["cost_split_pct"]
    w(f"  cost split         context {sp['context']:.0f}% "
      f"{st('2', '(cache reads ' + format(sp['cache_read'], '.0f') + '% · fresh ' + format(sp['cache_write'], '.0f') + '%)')}"
      f"   output {sp['output']:.0f}%\n")

    pct, g = totals["leak_pct"], totals["grade"]
    color = {"A": "32", "B": "32", "C": "33", "D": "31", "F": "31"}[g]
    w(f"\n  {st('1', 'LEAK SCORE')}  {st('1;' + color, f'{pct:.1f}%')}  grade {st('1;' + color, g)}"
      f"   {st('2', '% of token cost that was avoidable · A<5 B<10 C<20 D<30')}\n\n")

    if not by_kind:
        w("  No leaks found. Your agent is lean.\n")
    else:
        w(st("2", f"  {'leak':<14}{'count':>7}{'avoidable':>12}{'of cost':>10}   fix\n"))
    for kind, k in sorted(by_kind.items(), key=lambda kv: -kv[1]["cost"]):
        share = 100 * k["cost"] / totals["cost_units"] if totals["cost_units"] else 0
        avoid = fmt(k["avoidable_tokens"]) if k["avoidable_tokens"] else "-"
        w(f"  {kind:<14}{k['count']:>7}{avoid:>12}{share:>9.1f}%   {st('2', KINDS[kind][2])}\n")

    tmp = tuple(os.path.realpath(d) + os.sep for d in {tempfile.gettempdir(), "/tmp"} if os.path.isdir(d))
    repeat = [pj for pj in totals["projects"] if pj["sessions"] >= 2 and not os.path.realpath(pj["cwd"]).startswith(tmp)]
    if len(repeat) >= 2 and not args.redact:
        w(f"\n  {st('1', 'by project')}\n")
        home = os.path.expanduser("~")
        for pj in repeat[:6]:
            name = pj["cwd"].replace(home, "~")
            name = name if len(name) <= 44 else "…" + name[-43:]
            n = f"{pj['sessions']} sessions"
            w(f"  {pj['leak_pct']:>6.1f}%  {name:<44} {st('2', f'{n:>12}')}\n")

    if totals["always_loaded"] or totals["avg_first_call_context"]:
        note = fmt(totals["avg_first_call_context"]) + " tok at session start (system prompt, tools, rules), re-sent every call"
        w(f"\n  {st('1', 'always loaded')}  ~{totals['base_context_pct']:.0f}% of cost  {st('2', note)}\n")
        home = os.path.expanduser("~")
        for e in totals["always_loaded"][:5]:
            share = pct_str(100 * e["cost"] / totals["cost_units"] if totals["cost_units"] else 0)
            path = (e["path"] if not args.redact else os.path.basename(e["path"])).replace(home, "~")
            path = path if len(path) <= 60 else "…" + path[-59:]
            w(f"  {share:>7}  {path:<60} {st('2', fmt(e['tokens']) + ' tok')}\n")

    if findings:
        w(f"\n  {st('1', 'top leaks')}\n")
    width = 46
    for i, f in enumerate(findings[: args.top], 1):
        share = pct_str(100 * f.cost / totals["cost_units"] if totals["cost_units"] else 0)
        lab = fit(label_of(f, args.redact), width)
        size = "extra round-trip" if f.kind == "serial-call" else f"{fmt(f.tokens)} tok" + (f" × {f.later} later calls" if f.later else "")
        proj = os.path.basename((f.thread.cwd or "").rstrip("/")) or "?"
        where = "" if args.redact else f"{proj[:20]} · {(f.thread.session or '')[:8]}"
        w(f"  {i:>2}  {share:>6}  {st('33', f'{f.kind:<13}')} {lab:<{width}}  {st('2', size)}  {st('2', where)}\n")
    w("\n")


# ---------------------------------------------------------------- suggest rules for .agents/AGENTS.md

QUIET_RULES = [
    (r"\b(pytest|py\.test)\b", '`L="/tmp/out.log"; {cmd} -q -x > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`'),
    (r"\bvitest\b", '`L="/tmp/out.log"; {cmd} --reporter=dot > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`'),
    (r"^(npm|pnpm|yarn|bun) (run )?test", '`L="/tmp/out.log"; {cmd} --silent > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`'),
    (r"^cargo (test|build|check|clippy)", '`L="/tmp/out.log"; {cmd} -q > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`'),
    (r"^go (test|build|vet)", '`L="/tmp/out.log"; {cmd} > "$L" 2>&1; grep -v "^ok" "$L" | tail -n 40`'),
    (r"^git status", "`git status -s`"),
    (r"^git (log|reflog)", "`git log --oneline -n 20`"),
    (r"^git (diff|show)", "`git diff --stat` first, then `git diff -- <path>`"),
    (r"^(tsc|npx tsc|eslint|ruff|mypy|pyright)\b", '`L="/tmp/out.log"; {cmd} > "$L" 2>&1; echo "exit=$?"; head -n 30 "$L"`'),
]


def suggest(threads: list[Thread], out=None, since: float = 0.0):
    out = out or sys.stdout
    totals, _, findings = summarize(threads)
    if not totals["threads"]:
        out.write("ag_leak: no sessions found for this project.\n")
        return

    cwds = [t.cwd for t in threads if t.cwd]
    root = max(set(cwds), key=cwds.count) if cwds else ""
    rel = lambda p: os.path.relpath(p, root) if root and os.path.isabs(str(p)) and str(p).startswith(root) else str(p)

    shells, files, searches = {}, {}, {}
    for f in findings:
        if f.kind == "noisy-shell":
            words = _main_segment(str(f.label))
            fam = " ".join(words[:2]) if words else ""
            if fam:
                e = shells.setdefault(fam, [0, 0.0, 0.0])
                e[0] += 1; e[1] += f.tokens; e[2] += f.cost
        elif f.kind in ("big-read", "re-read"):
            path = _norm(f.label, f.thread.cwd)
            if root and path.startswith(root) and os.path.isfile(path):
                key = rel(path)
                e = files.setdefault(key, [0, 0.0, 0.0])
                e[0] += 1; e[1] = max(e[1], f.tokens); e[2] += f.cost
        elif f.kind == "wide-search":
            e = searches.setdefault(f.tool, [0, 0.0, 0.0])
            e[0] += 1; e[1] += f.tokens; e[2] += f.cost

    lines = []
    for fam, (n, toks, _) in sorted(shells.items(), key=lambda kv: -kv[1][2])[:5]:
        if n >= 2 or toks >= 5000:
            advice = next((adv.format(cmd=fam) for pat, adv in QUIET_RULES if re.search(pat, fam)),
                          f'`L="/tmp/out.log"; {fam} > "$L" 2>&1; echo "exit=$?"; tail -n 40 "$L"`')
            lines.append(f"- `{fam}` printed ~{fmt(toks / n)} tokens per run ({n}x). Run it as {advice}.")

    big = [(p, n, toks) for p, (n, toks, _) in sorted(files.items(), key=lambda kv: -kv[1][2])[:6] if n >= 2 or toks >= 5000]
    if big:
        listed = ", ".join(f"`{p}` (~{fmt(toks)} tok, {n}x)" for p, n, toks in big)
        lines.append(f"- Large files: {listed}. Use `grep_search` or `view_file_outline` instead of reading whole files.")

    for tool, (n, toks, _) in sorted(searches.items(), key=lambda kv: -kv[1][2])[:2]:
        if n >= 2:
            lines.append(f"- `{tool}` returned ~{fmt(toks / n)} tokens each ({n}x): scope `SearchDirectory` or tighten the pattern.")

    if not lines:
        out.write("No project-specific leaks found.\n")
        return

    out.write("## Token Hygiene (auto-generated for .agents/AGENTS.md)\n\n")
    out.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- HTML export

def write_html(totals, by_kind, findings, since, args, path: str):
    esc = html.escape
    when = datetime.fromtimestamp(since).strftime("%Y-%m-%d") if since else "the beginning"
    units = totals["cost_units"] or 1
    kinds = sorted(by_kind.items(), key=lambda kv: -kv[1]["cost"])
    top_share = max((k["cost"] for _, k in kinds), default=1) or 1

    rows = "".join(
        f'<div class="row"><div><code>{esc(kind)}</code></div><div class="m">{100 * k["cost"] / units:.1f}%</div>'
        f'<div><div class="bar" style="width:{max(2, 100 * k["cost"] / top_share):.0f}%"></div>'
        f'<div class="fix">{k["count"]} found. {esc(KINDS[kind][2])}</div></div></div>' for kind, k in kinds
    )
    leaks = "".join(
        f'<tr><td class="n">{100 * f.cost / units:.2f}%</td><td><code>{esc(f.kind)}</code></td>'
        f'<td class="lab">{esc(label_of(f, args.redact))}</td><td class="n">{fmt(f.tokens)} tok'
        f'{" × " + str(f.later) if f.later else ""}</td></tr>' for f in findings[: args.top or 15]
    )

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>ag_leak report</title><style>
body{{margin:0;background:#09090b;color:#f4f4f5;font:15px/1.55 system-ui,sans-serif}}
.w{{max-width:980px;margin:0 auto;padding:36px 20px}}code,.m{{font-family:monospace}}
.hero{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}}
.card{{background:#121216;border:1px solid #27272a;border-radius:12px;padding:16px}}
.k{{color:#a1a1aa;font-size:13px}}.v{{font-family:monospace;font-size:32px;color:#fbbf24;margin-top:4px}}
.row{{display:grid;grid-template-columns:130px 70px 1fr;gap:12px;align-items:center;padding:10px 0;border-top:1px solid #27272a}}
.bar{{height:8px;border-radius:4px;background:#f59e0b}}.fix{{color:#a1a1aa;font-size:13px;margin-top:4px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}}
th,td{{text-align:left;padding:8px;border-bottom:1px solid #27272a}}
</style></head><body><div class="w">
<h1>ag_leak · Antigravity Context Audit</h1>
<p style="color:#a1a1aa">{totals['sessions']} sessions since {esc(when)}, {fmt(totals['api_calls'])} API calls</p>
<div class="hero">
<div class="card"><div class="k">Leak Score</div><div class="v">{totals['leak_pct']:.1f}% ({totals['grade']})</div></div>
<div class="card"><div class="k">Context Processed</div><div class="v">{fmt(totals['context_tokens'])}</div></div>
<div class="card"><div class="k">Output Tokens</div><div class="v">{fmt(totals['output_tokens'])}</div></div>
</div>
<h2>Where it leaks</h2>{rows or '<p>No leaks found.</p>'}
<h2>Top leaks</h2><table><tr><th>Of cost</th><th>Kind</th><th>Details</th><th>Size</th></tr>{leaks}</table>
</div></body></html>"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)


# ---------------------------------------------------------------- CLI

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="ag_leak",
        description="Audit context token leaks in Google Antigravity sessions."
    )
    ap.add_argument("paths", nargs="*", help=f"transcript path (default: {default_root()})")
    ap.add_argument("--since", help="window: 24h, 7d (default), 4w, 2026-11-01, or all")
    ap.add_argument("--here", action="store_true", help="only sessions started in this directory")
    ap.add_argument("--current", action="store_true", help="only the latest session in this directory")
    ap.add_argument("--project", help="filter by project name / path substring")
    ap.add_argument("--session", help="filter by session ID")
    ap.add_argument("--compare", metavar="WHEN", help="compare before vs after a date (e.g., 2026-11-15)")
    ap.add_argument("--top", type=int, default=10, help="number of top leaks to list")
    ap.add_argument("--json", action="store_true", help="output as JSON")
    ap.add_argument("--html", metavar="FILE", help="write self-contained HTML report to FILE")
    ap.add_argument("--redact", action="store_true", help="hide file paths and commands")
    ap.add_argument("--no-color", action="store_true")

    argv = sys.argv[1:] if argv is None else argv

    if argv[:1] == ["suggest"]:
        args = ap.parse_args(argv[1:])
        if not (args.paths or args.project or args.session or args.current):
            args.here = True
        args.since = args.since or "30d"
        threads, since = collect(args)
        suggest(threads, since=since)
        return 0

    args = ap.parse_args(argv)
    threads, since = collect(args)
    totals, by_kind, findings = summarize(threads)

    if args.html:
        write_html(totals, by_kind, findings, since, args, args.html)
        print(f"ag_leak: HTML report saved to {os.path.abspath(args.html)}", file=sys.stderr)

    if args.json:
        out_data = {
            "version": __version__,
            "totals": totals,
            "by_kind": by_kind,
            "findings": [
                {
                    "kind": f.kind,
                    "tool": f.tool,
                    "label": None if args.redact else label_of(f, False),
                    "tokens": round(f.tokens),
                    "avoidable_tokens": round(f.avoidable),
                    "later_calls": f.later,
                    "cost_units": round(f.cost, 1),
                    "session": None if args.redact else f.thread.session,
                }
                for f in findings[: args.top]
            ],
        }
        json.dump(out_data, sys.stdout, indent=2, ensure_ascii=False, default=str)
        sys.stdout.write("\n")
    else:
        print_report(totals, by_kind, findings, since, args)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
    except KeyboardInterrupt:
        sys.exit(130)