#!/usr/bin/env python3
from __future__ import annotations

import ast
import io
import json
import re
import sys
import token
import tokenize
from bisect import bisect_right
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from citations import citation_in

WORD_LIMIT = 25

Comment = tuple[int, int, str]
Block = tuple[int, str]
Reader = Callable[[str], list[Block]]


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
    r"|shellcheck "
    r"|renovate:"
    r"|yaml-language-server:"
    r"|SPDX-License-Identifier"
    r"|Copyright"
    r")"
)

MARKER = Path(__file__).resolve().parents[1] / "migration-marker.json"


def _migration_marker() -> str:
    fixture: Any = json.loads(MARKER.read_text(encoding="utf8"))
    return str(fixture["marker"])


# Read rather than written, so the gate and the strip cannot disagree on a marker that
# names the decision allowing it.
EXEMPT_WHOLE = frozenset({"--> statement-breakpoint", _migration_marker()})

MARKERS = "#-"

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

STRING_CITES = (
    "{path}:{line}: this string cites {what} (`{cited}`); a string that reaches a "
    "person names what they can act on, never a document they cannot open from where "
    "they read it ([COMMENT1]). Say the thing instead."
)

DOCSTRING_HOLDERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)

A_TEST_PATH = re.compile(r"(?:^|/)(?:tests?|e2e)/|(?:^|/)(?:test_[^/]*|conftest)\.py$")

A_SPACE = re.compile(r"\s")

GATES = Path(__file__).resolve().parents[1] / "gates-printing-a-tag.json"


def _gates_printing_a_tag() -> tuple[str, ...]:
    fixture: Any = json.loads(GATES.read_text(encoding="utf8"))
    return tuple(str(gate) for gate in fixture["gates"])


PRINTS_A_TAG = _gates_printing_a_tag()


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
        "skills",
    }
)

# Named by no root of the strip, so a finding here would refuse an edit the root
# `check` accepts.
UNCOVERED = (Path("apps/worker/pyproject.toml"),)

DOLLAR = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$")


def _prose(comment: str) -> str:
    return comment.lstrip(MARKERS)


def _exempt(comment: str) -> bool:
    said = comment.strip()
    return said in EXEMPT_WHOLE or EXEMPT_OPENING.match(_prose(said)) is not None


def _blocks(lines: list[str], comments: Iterable[Comment]) -> list[Block]:
    blocks: list[Block] = []
    start: int | None = None
    parts: list[str] = []
    previous = -2
    for row, column, written in comments:
        text = _prose(written)
        if _exempt(written):
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


def _python_comments(source: str) -> list[Comment]:
    found: list[Comment] = []
    for read in tokenize.generate_tokens(io.StringIO(source).readline):
        if read.type != token.COMMENT:
            continue
        row, column = read.start
        found.append((row, column, read.string))
    return found


def _hash_at(line: str) -> int | None:
    quote: str | None = None
    for index, character in enumerate(line):
        if quote is not None:
            if character == quote:
                quote = None
        elif character in "'\"":
            quote = character
        elif character == "#" and (index == 0 or line[index - 1].isspace()):
            return index
    return None


def _hash_comments(source: str) -> list[Comment]:
    found: list[Comment] = []
    for row, line in enumerate(source.splitlines(), start=1):
        column = _hash_at(line)
        if column is not None:
            found.append((row, column, line[column:]))
    return found


def _quote_at(source: str, index: int) -> tuple[str, int, bool] | None:
    before = source[index - 1] if index > 0 else ""
    escaping = source[index] in "Ee" and not (before.isalnum() or before == "_")
    if escaping and source.startswith("'", index + 1):
        return "'", index + 2, True
    if source[index] in "'\"":
        return source[index], index + 1, False
    return None


def _past_code(source: str, index: int) -> int:
    body = DOLLAR.match(source, index)
    if body is not None:
        closed = source.find(body.group(0), body.end())
        return len(source) if closed == -1 else closed + len(body.group(0))
    opened = _quote_at(source, index)
    if opened is None:
        return index + 1
    quote, inside, escaping = opened
    while inside < len(source):
        if escaping and source[inside] == "\\":
            inside += 2
        elif source[inside] != quote:
            inside += 1
        elif source.startswith(quote * 2, inside):
            inside += 2
        else:
            return inside + 1
    return len(source)


def _placed(starts: list[int], index: int) -> tuple[int, int]:
    row = bisect_right(starts, index)
    return row, index - starts[row - 1]


def _sql_comments(source: str) -> list[Comment]:
    starts = [0] + [at + 1 for at, character in enumerate(source) if character == "\n"]
    found: list[Comment] = []
    index = 0
    while index < len(source):
        if source.startswith("--", index):
            ended = source.find("\n", index)
            ended = len(source) if ended == -1 else ended
            row, column = _placed(starts, index)
            found.append((row, column, source[index:ended]))
            index = ended
            continue
        index = _past_code(source, index)
    return found


def _docstrings(source: str) -> list[Block]:
    found: list[Block] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, DOCSTRING_HOLDERS):
            continue
        text = ast.get_docstring(node, clean=False)
        if text is None or _exempt(text):
            continue
        found.append((getattr(node.body[0], "lineno", 1), text))
    return found


def _docstring_nodes(tree: ast.AST) -> set[int]:
    held: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, DOCSTRING_HOLDERS) or not node.body:
            continue
        first = node.body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
            held.add(id(first.value))
    return held


def _strings(source: str) -> list[Block]:
    tree = ast.parse(source)
    a_docstring = _docstring_nodes(tree)
    # A string with no space in it is an identifier, a path, a key or a version —
    # a value, not something a person reads.
    return [
        (node.lineno, node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and A_SPACE.search(node.value) is not None
        and id(node) not in a_docstring
    ]


def _strings_go_unread(path: Path) -> bool:
    # Only Python source carries a string literal this check can read; the other
    # languages in the table carry none.
    if path.suffix != ".py":
        return True
    text = path.as_posix()
    return bool(A_TEST_PATH.search(text)) or any(
        text == gate or text.endswith(f"/{gate}") for gate in PRINTS_A_TAG
    )


def _python_blocks(source: str) -> list[Block]:
    return _blocks(source.splitlines(), _python_comments(source)) + _docstrings(source)


def _hash_blocks(source: str) -> list[Block]:
    return _blocks(source.splitlines(), _hash_comments(source))


def _sql_blocks(source: str) -> list[Block]:
    return _blocks(source.splitlines(), _sql_comments(source))


SYNTAX: dict[str, Reader] = {
    ".py": _python_blocks,
    ".yml": _hash_blocks,
    ".yaml": _hash_blocks,
    ".sh": _hash_blocks,
    ".bash": _hash_blocks,
    ".toml": _hash_blocks,
    ".sql": _sql_blocks,
}


def _findings(path: Path, source: str) -> list[str]:
    said: list[str] = []
    if not _strings_go_unread(path):
        for line, text in _strings(source):
            cited = citation_in(text)
            if cited is not None:
                what, citation = cited
                said.append(
                    STRING_CITES.format(path=path, line=line, what=what, cited=citation)
                )
    for line, prose in SYNTAX[path.suffix](source):
        cited = citation_in(prose)
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


def _this_gates(found: Path) -> bool:
    return not any(found == root or root in found.parents for root in UNCOVERED)


def _under(root: Path) -> Iterable[Path]:
    if root.is_file():
        return [root]
    return (found for suffix in SYNTAX for found in root.rglob(f"*{suffix}"))


def main(argv: list[str]) -> int:
    if not argv:
        print("comment_gate: name at least one path to read", file=sys.stderr)
        return 2
    named = (Path(root) for root in argv)
    files = sorted(
        {
            found
            for root in named
            for found in _under(root)
            if found.suffix in SYNTAX
            and NEVER_WALKED.isdisjoint(found.parts)
            and _this_gates(found)
        }
    )
    findings: list[str] = []
    for path in files:
        try:
            findings.extend(_findings(path, path.read_text(encoding="utf8")))

        except (SyntaxError, tokenize.TokenError, UnicodeDecodeError) as refused:
            print(f"comment_gate: {path} could not be read: {refused}", file=sys.stderr)
            return 2
    for finding in sorted(findings):
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
