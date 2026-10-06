#!/usr/bin/env python3
"""Read a Claude Code session log for the session-retro skill.

  session.py list [--limit N]
  session.py digest [SESSION] [--top N]
  session.py show SESSION [--agent AGENT] LINE

Run from the repository root. SESSION is an id or an id prefix; digest
without one reads the current session from CLAUDE_CODE_SESSION_ID.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

INVOCATION = "<command-name>/session-retro</command-name>"
COMMAND = re.compile(r"<command-name>/?([^<]+)</command-name>")
FIELD_LIMIT = 300
OWNER_WAITS = {"AskUserQuestion"}


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def repository_folders():
    root = (
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        or os.getcwd()
    )
    slug = re.sub(r"[/.]", "-", root)
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return []
    return sorted(
        p for p in projects.iterdir() if p.is_dir() and p.name.startswith(slug)
    )


def session_files():
    return [f for folder in repository_folders() for f in folder.glob("*.jsonl")]


def resolve(session):
    matches = [f for f in session_files() if f.stem.startswith(session)]
    if not matches:
        fail(f"no session in this repository's logs matches {session}")
    if len(matches) > 1:
        names = ", ".join(sorted(f.stem for f in matches))
        fail(f"{session} matches several sessions: {names}")
    return matches[0]


def current_session():
    session = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not session:
        fail(
            "not a Claude Code session: CLAUDE_CODE_SESSION_ID is unset, so name a session"
        )
    return resolve(session), True


def records(path):
    skipped = 0
    with open(path, errors="replace") as handle:
        for number, line in enumerate(handle, start=1):
            try:
                record = json.loads(line)
            except ValueError:
                skipped += 1
                continue
            if isinstance(record, dict):
                yield number, record
    yield 0, {"type": "_skipped", "count": skipped}


def blocks(record):
    content = (record.get("message") or {}).get("content")
    return (
        [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
    )


def text_of(record):
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    return " ".join(
        b.get("text", "") for b in blocks(record) if b.get("type") == "text"
    )


def seconds(stamp):
    return (
        datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
        if stamp
        else None
    )


def tokens(usage):
    fresh = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0)
    return fresh, usage.get("cache_read_input_tokens", 0), usage.get("output_tokens", 0)


class Digest:
    def __init__(self):
        self.calls = {}
        self.results = {}
        self.requests = {}
        self.skills = []
        self.compactions = []
        self.skipped = 0
        self.title = ""
        self.first = None
        self.last = None
        self.finished = False

    def take(self, number, record):
        kind = record.get("type")
        stamp = record.get("timestamp")
        if stamp:
            self.first = self.first or stamp
            self.last = stamp
        if kind == "_skipped":
            self.skipped = record["count"]
        elif kind == "ai-title":
            self.title = record.get("aiTitle", "")
        elif kind == "cost-state":
            self.finished = True
        elif kind == "system" and record.get("subtype") == "compact_boundary":
            meta = record.get("compactMetadata") or {}
            self.compactions.append((number, meta.get("preTokens")))
        elif kind == "assistant":
            self.take_assistant(number, record)
        elif kind == "user":
            self.take_user(number, record)

    def take_assistant(self, number, record):
        request = record.get("requestId") or record.get("uuid")
        usage = (record.get("message") or {}).get("usage")
        if usage and request not in self.requests:
            self.requests[request] = (number, tokens(usage))
        for block in blocks(record):
            if block.get("type") == "tool_use":
                self.take_call(number, record, request, block)

    def take_call(self, number, record, request, block):
        name, given = block.get("name", "?"), block.get("input") or {}
        if name == "Skill" and given.get("skill"):
            self.skills.append(given["skill"].split(":")[-1])
        self.calls[block.get("id")] = {
            "line": number,
            "name": name,
            "request": request,
            "start": seconds(record.get("timestamp")),
            "input": json.dumps(given, sort_keys=True),
            "background": bool(given.get("run_in_background")),
        }

    def take_user(self, _number, record):
        self.skills += [
            m.strip().split(":")[-1] for m in COMMAND.findall(text_of(record))
        ]
        for block in blocks(record):
            if block.get("type") == "tool_result":
                content = block.get("content")
                text = content if isinstance(content, str) else json.dumps(content)
                self.results[block.get("tool_use_id")] = {
                    "end": seconds(record.get("timestamp")),
                    "error": bool(block.get("is_error")),
                    "text": " ".join(text.split())[:120],
                }


def cut_for_current(path):
    lines = [
        n
        for n, r in records(path)
        if r.get("type") == "user" and INVOCATION in text_of(r)
    ]
    return lines[-1] if lines else None


def build(path, current):
    digest = Digest()
    stop = cut_for_current(path) if current else None
    for number, record in records(path):
        if stop and number >= stop:
            continue
        digest.take(number, record)
    return digest


def owner_wait(digest):
    return sum(
        digest.results[k]["end"] - c["start"]
        for k, c in digest.calls.items()
        if k in digest.results and c["name"] in OWNER_WAITS
    )


def spans(digest):
    grouped = defaultdict(list)
    for key, call in digest.calls.items():
        timed = not call["background"] and call["name"] not in OWNER_WAITS
        if key in digest.results and timed:
            grouped[call["request"]].append((call, digest.results[key]))
    rows = []
    for pairs in grouped.values():
        start = min(c["start"] for c, _ in pairs)
        end = max(r["end"] for _, r in pairs)
        names = ", ".join(dict.fromkeys(c["name"] for c, _ in pairs))
        rows.append((end - start, min(c["line"] for c, _ in pairs), names))
    return sorted(rows, reverse=True)


def repeated(digest):
    seen = defaultdict(list)
    for call in digest.calls.values():
        seen[(call["name"], call["input"])].append(call["line"])
    return [(k, v) for k, v in seen.items() if len(v) > 1]


def subagents(path):
    folder = path.parent / path.stem / "subagents"
    rows = []
    for log in sorted(folder.glob("agent-*.jsonl")):
        agent = log.stem.removeprefix("agent-")
        meta_file = log.with_suffix(".meta.json")
        meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        sub = Digest()
        for number, record in records(log):
            sub.take(number, record)
        spent = [sum(t) for t in zip(*(v for _, v in sub.requests.values()))] or [
            0,
            0,
            0,
        ]
        rows.append((agent, meta, spent, len(sub.calls)))
    return sorted(rows, key=lambda r: -sum(r[2]))


def report(path, digest, top):
    out = [f"session {path.stem}", f"title: {digest.title}"]
    out.append(
        f"from {digest.first} to {digest.last}; finished: {'yes' if digest.finished else 'no'}"
    )
    main_in, main_cache, main_out = [
        sum(t) for t in zip(*(v for _, v in digest.requests.values()))
    ] or [0, 0, 0]
    pending = [k for k in digest.calls if k not in digest.results]
    errors = [k for k in digest.calls if digest.results.get(k, {}).get("error")]
    out.append(
        f"calls: {len(digest.calls)}; pending: {len(pending)}; failed: {len(errors)}"
    )
    out.append(f"main tokens: input {main_in}, cache {main_cache}, output {main_out}")
    out.append(f"waiting on the owner: {owner_wait(digest):.1f}s")
    out.append(f"skipped lines: {digest.skipped}")
    out.append(f"compactions: {len(digest.compactions)}")
    out += [f"  line {n}, {pre} tokens before" for n, pre in digest.compactions]
    out.append("")
    out.append("slowest:")
    out += [
        f"  line {line}  {span:.1f}s  {names}"
        for span, line, names in spans(digest)[:top]
    ]
    out.append("")
    out.append("costliest requests:")
    costly = sorted(digest.requests.values(), key=lambda v: -sum(v[1]))[:top]
    out += [
        f"  line {line}  input {i}, cache {c}, output {o}" for line, (i, c, o) in costly
    ]
    out.append("")
    out.append("errors:")
    out += [
        f"  line {digest.calls[k]['line']}  {digest.calls[k]['name']}: {digest.results[k]['text']}"
        for k in errors[:top]
    ]
    out.append("")
    out.append("repeated:")
    out += [
        f"  lines {lines}  {name} {given[:120]}"
        for (name, given), lines in repeated(digest)[:top]
    ]
    out.append("")
    out.append("skills:")
    out += [f"  {skill}" for skill in dict.fromkeys(digest.skills)]
    out.append("")
    rows = subagents(path)
    sub_in = sum(r[2][0] for r in rows)
    sub_cache = sum(r[2][1] for r in rows)
    sub_out = sum(r[2][2] for r in rows)
    out.append(f"subagent tokens: input {sub_in}, cache {sub_cache}, output {sub_out}")
    out.append("")
    out.append("subagents:")
    for agent, meta, (i, _, o), calls in rows[:top]:
        link = "linked" if meta.get("toolUseId") else "unlinked"
        label = f"{meta.get('agentType', '?')} {meta.get('description', '')}".strip()
        out.append(f"  {agent}  {label}  input {i}, output {o}, calls {calls}, {link}")
    return "\n".join(out)


def cut(value, depth=0):
    if isinstance(value, str):
        return value if len(value) <= FIELD_LIMIT else value[:FIELD_LIMIT] + " [cut]"
    if isinstance(value, list):
        return [cut(v, depth + 1) for v in value[:20]]
    if isinstance(value, dict):
        return (
            {k: cut(v, depth + 1) for k, v in value.items()} if depth < 6 else "{...}"
        )
    return value


def show(path, agent, line):
    if agent:
        path = path.parent / path.stem / "subagents" / f"agent-{agent}.jsonl"
        if not path.exists():
            fail(f"no subagent {agent} in this session")
    for number, record in records(path):
        if number == line:
            print(json.dumps(cut(record), indent=1))
            return
    fail(f"no record on line {line}")


def tail_title(path):
    with open(path, "rb") as handle:
        handle.seek(max(0, path.stat().st_size - 200_000))
        titles = re.findall(rb'"aiTitle":\s*"((?:[^"\\]|\\.)*)"', handle.read())
    return json.loads(b'"' + titles[-1] + b'"') if titles else ""


def listing(limit):
    files = sorted(session_files(), key=lambda f: -f.stat().st_mtime)[:limit]
    print("id  last written  size  title")
    for f in files:
        written = (
            datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
            .astimezone()
            .strftime("%Y-%m-%d %H:%M")
        )
        size = f"{f.stat().st_size / 1_000_000:.1f}MB"
        print(f"{f.stem}  {written}  {size}  {tail_title(f)}")


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("list").add_argument("--limit", type=int, default=20)
    digest = modes.add_parser("digest")
    digest.add_argument("session", nargs="?")
    digest.add_argument("--top", type=int, default=10)
    shown = modes.add_parser("show")
    shown.add_argument("session")
    shown.add_argument("--agent")
    shown.add_argument("line", type=int)
    args = parser.parse_args()
    if args.mode == "list":
        listing(args.limit)
    elif args.mode == "digest":
        if args.session is None:
            path, current = current_session()
        else:
            path = resolve(args.session)
            current = path.stem == os.environ.get("CLAUDE_CODE_SESSION_ID")
        print(report(path, build(path, current), args.top))
    else:
        show(resolve(args.session), args.agent, args.line)


if __name__ == "__main__":
    main()
