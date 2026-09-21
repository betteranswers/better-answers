#!/usr/bin/env python3
from __future__ import annotations

import ast
import io
import re
import sys
import token
import tokenize
from pathlib import Path

WORD_LIMIT = 25

# Deleting one of these changes what another tool does, so text alone decides.
EXEMPT_OPENING = re.compile(
    r"^(?:!"
    r"|type:"
    r"|noqa"
    r"|pragma:"
    r"|mypy:"
    r"|ruff:"
    r"|fmt:"
    r"|isort:"
    r"|nosec"
    r"|coding[:=]"
    r"|jscpd:ignore"
    r"|SPDX-License-Identifier"
    r"|Copyright"
    r")"
)

CITATIONS = (
    ("a ticket id", re.compile(r"\bT-\d+\b")),
    ("an ADR number", re.compile(r"\bADR[ -]?\d+\b", re.IGNORECASE)),
    ("a rule tag", re.compile(r"\[[A-Z]{2,}\d+\]")),
    ("a date", re.compile(r"\b\d{4}-\d{2}-\d{2}\b")),
    ("a date", re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b")),
)

TOO_LONG = (
    "{path}:{line}: this comment runs to {words} words; a comment gives a reason the "
    "code cannot — a constraint, a trade-off, a gotcha — in {limit} at most "
    "([COMMENT1]). Delete what the code already says."
)

CITES = (
    "{path}:{line}: this comment cites {what} (`{cited}`); a comment never says which "
    "ticket, decision or rule asked for the code ([COMMENT1]). git, a spec and an ADR "
    "are where that is read."
)

DOCSTRING_HOLDERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)

# Nobody here wrote these, and a vendored tree is thousands of findings nobody reads.
NEVER_WALKED = frozenset(
    {
        ".git",
        ".venv",
        "__pycache__",
        "build",
        "dist",
        "lifts",
        "node_modules",
        "site-packages",
    }
)


# Tokens, not quotes: a `#` inside a string is not a comment, and a reader sees touching
# `#` lines as one paragraph.
def _comment_blocks(source: str) -> list[tuple[int, str]]:
    lines = source.splitlines()
    blocks: list[tuple[int, str]] = []
    start: int | None = None
    parts: list[str] = []
    previous = -2
    for found in tokenize.generate_tokens(io.StringIO(source).readline):
        if found.type != token.COMMENT:
            continue
        row, column = found.start
        text = found.string.lstrip("#")
        # Dropped before grouping, never after: a directive between two paragraphs would
        # otherwise lend them its exemption.
        if EXEMPT_OPENING.match(text.strip()):
            if start is not None:
                blocks.append((start, "\n".join(parts)))
            start, parts, previous = None, [], -2
            continue
        own_line = lines[row - 1][:column].strip() == ""
        if not own_line:
            if start is not None:
                blocks.append((start, "\n".join(parts)))
            blocks.append((row, text))
            start, parts, previous = None, [], -2
            continue
        if start is not None and row == previous + 1:
            parts.append(text)
        else:
            if start is not None:
                blocks.append((start, "\n".join(parts)))
            start, parts = row, [text]
        previous = row
    if start is not None:
        blocks.append((start, "\n".join(parts)))
    return blocks


# A docstring is a comment here: it is the form this tier's narrative voice takes, and
# no ruff rule caps one or forbids one.
def _docstrings(source: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, DOCSTRING_HOLDERS):
            continue
        text = ast.get_docstring(node, clean=False)
        if text is None or EXEMPT_OPENING.match(text.strip()):
            continue
        found.append((getattr(node.body[0], "lineno", 1), text))
    return found


def _findings(path: Path, source: str) -> list[str]:
    said: list[str] = []
    for line, prose in _comment_blocks(source) + _docstrings(source):
        cited = next(
            (
                (what, found.group(0))
                for what, pattern in CITATIONS
                if (found := pattern.search(prose))
            ),
            None,
        )
        if cited is not None:
            what, citation = cited
            said.append(CITES.format(path=path, line=line, what=what, cited=citation))
            continue
        words = len(prose.split())
        if words > WORD_LIMIT:
            said.append(
                TOO_LONG.format(path=path, line=line, words=words, limit=WORD_LIMIT)
            )
    return said


def main(argv: list[str]) -> int:
    if not argv:
        print("comment_gate: name at least one path to read", file=sys.stderr)
        return 2
    named = (Path(root) for root in argv)
    files = sorted(
        {
            found
            for root in named
            for found in ([root] if root.is_file() else root.rglob("*.py"))
            if NEVER_WALKED.isdisjoint(found.parts)
        }
    )
    findings: list[str] = []
    for path in files:
        try:
            findings.extend(_findings(path, path.read_text(encoding="utf8")))
        # A file this cannot parse is a gate that read nothing, never a clean tree.
        except (SyntaxError, tokenize.TokenError, UnicodeDecodeError) as refused:
            print(f"comment_gate: {path} could not be read: {refused}", file=sys.stderr)
            return 2
    for finding in sorted(findings):
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
