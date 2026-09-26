#!/usr/bin/env python3
from __future__ import annotations

import ast
import io
import json
import re
import sys
import token
import tokenize
from collections.abc import Iterable
from pathlib import Path
from typing import Any, NamedTuple

from citations import citation_in

SUFFIX = ".py"

UNREADABLE = (OSError, SyntaxError, tokenize.TokenError, UnicodeDecodeError)

WORD_LIMIT = 25

DOCSTRING_LIMIT = 50

Comment = tuple[int, int, str]


NOTICE = r"SPDX-License-Identifier|Copyright"

A_NOTICE = re.compile(rf"^(?:{NOTICE})")

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
    rf"|{NOTICE}"
    r")"
)

# A suppression's codes are machinery; whatever follows them is its reason, and counts.
SUPPRESSION = re.compile(
    r"^(?:noqa(?::\s*[A-Z]+[0-9]+(?:[,\s]+[A-Z]+[0-9]+)*)?"
    r"|type:\s*ignore(?:\[[^\]]*\])?)"
)

# mypy and ruff take a directive's reason after a second `#`, so each `#` starts a part.
MARKER = re.compile(r"(?:^|\s)#+")

TOO_LONG = (
    "{path}:{line}: this comment runs to {words} words; a comment says only what the "
    "code cannot — a constraint, a trade-off, a trap — in {limit} at most "
    "([COMMENT1]). Delete what the code already says."
)

REASON_TOO_LONG = (
    "{path}:{line}: this directive's reason runs to {words} words, and a reason counts "
    "against the comment cap of {limit} ([COMMENT3]). Say the constraint alone."
)

DOCSTRING_TOO_LONG = (
    "{path}:{line}: this docstring runs to {words} words; a public function's "
    "docstring says only what its signature cannot — units, ranges, what None means, "
    "a side effect, a refusal — in {limit} at most ([COMMENT1]). Delete the rest."
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


class Block(NamedTuple):
    line: int
    prose: str
    limit: int = WORD_LIMIT
    too_long: str = TOO_LONG


DOCSTRING_HOLDERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)

A_TEST_PATH = re.compile(r"(?:^|/)(?:tests?|e2e)/|(?:^|/)(?:test_[^/]*|conftest)\.py$")

A_WORKER_MODULE = re.compile(r"(?:^|/)apps/worker/src/")

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


def _reason(part: str) -> str:
    suppression = SUPPRESSION.match(part)
    if suppression is not None:
        return part[suppression.end() :].lstrip(" -—:")
    return "" if EXEMPT_OPENING.match(part) else part


def _prose(written: str) -> str | None:
    parts = [part.strip() for part in MARKER.split(written)]
    reasons = [_reason(part) for part in parts]
    if reasons != parts and not any(reasons):
        return None
    return " ".join(reason for reason in reasons if reason)


def _suppresses(written: str) -> bool:
    return any(SUPPRESSION.match(part.strip()) for part in MARKER.split(written))


def _blocks(lines: list[str], comments: Iterable[Comment]) -> list[Block]:
    runs: list[tuple[int, list[str], str]] = []
    previous = -2
    for row, column, written in comments:
        text = _prose(written)
        if text is None:
            previous = -2
            continue
        # A reason is held to its own directive, never to the comments around it.
        if _suppresses(written):
            runs.append((row, [text], REASON_TOO_LONG))
            previous = -2
            continue
        own_line = lines[row - 1][:column].strip() == ""
        if own_line and row == previous + 1:
            runs[-1][1].append(text)
        else:
            runs.append((row, [text], TOO_LONG))
        previous = row if own_line else -2
    return [
        Block(start, "\n".join(parts), WORD_LIMIT, template)
        for start, parts, template in runs
    ]


def _python_comments(source: str) -> list[Comment]:
    found: list[Comment] = []
    for read in tokenize.generate_tokens(io.StringIO(source).readline):
        if read.type != token.COMMENT:
            continue
        row, column = read.start
        found.append((row, column, read.string))
    return found


def _public_worker_functions(path: Path, tree: ast.Module) -> set[ast.AST]:
    if A_WORKER_MODULE.search(path.as_posix()) is None:
        return set()
    return {
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and not node.name.startswith("_")
    }


def _docstrings(path: Path, tree: ast.Module) -> list[Block]:
    public = _public_worker_functions(path, tree)
    found: list[Block] = []
    for node in ast.walk(tree):
        if not isinstance(node, DOCSTRING_HOLDERS):
            continue
        text = ast.get_docstring(node, clean=False)
        if text is None or A_NOTICE.match(text.strip()) is not None:
            continue
        line = getattr(node.body[0], "lineno", 1)
        if node in public:
            found.append(Block(line, text, DOCSTRING_LIMIT, DOCSTRING_TOO_LONG))
        else:
            found.append(Block(line, text))
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


def _strings(tree: ast.Module) -> list[tuple[int, str]]:
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
    text = path.as_posix()
    return bool(A_TEST_PATH.search(text)) or any(
        text == gate or text.endswith(f"/{gate}") for gate in PRINTS_A_TAG
    )


def _string_findings(path: Path, tree: ast.Module) -> list[str]:
    if _strings_go_unread(path):
        return []
    said: list[str] = []
    for line, text in _strings(tree):
        cited = citation_in(text)
        if cited is not None:
            what, citation = cited
            said.append(
                STRING_CITES.format(path=path, line=line, what=what, cited=citation)
            )
    return said


def _findings(path: Path, source: str) -> list[str]:
    tree = ast.parse(source)
    said = _string_findings(path, tree)
    comments = _blocks(source.splitlines(), _python_comments(source))
    for line, prose, limit, too_long in comments + _docstrings(path, tree):
        cited = citation_in(prose)
        if cited is not None:
            what, citation = cited
            said.append(CITES.format(path=path, line=line, what=what, cited=citation))
            continue
        words = len(prose.split())
        if words > limit:
            said.append(too_long.format(path=path, line=line, words=words, limit=limit))
    return said


def _under(root: Path) -> Iterable[Path]:
    if root.is_file():
        return [root]
    return root.rglob(f"*{SUFFIX}")


def _argv_refusal(named: list[Path]) -> str | None:
    if not named:
        return "name at least one path to read"
    missing = [str(root) for root in named if not root.exists()]
    return f"no path at {', '.join(missing)}" if missing else None


def main(argv: list[str]) -> int:
    """0: clean. 1: findings. 2: no path is named, a named path does not exist,
    or a file cannot be read, decoded or parsed."""
    named = [Path(root) for root in argv]
    refused = _argv_refusal(named)
    if refused is not None:
        print(f"comment_gate: {refused}", file=sys.stderr)
        return 2
    files = sorted(
        {
            found
            for root in named
            for found in _under(root)
            if found.suffix == SUFFIX and NEVER_WALKED.isdisjoint(found.parts)
        }
    )
    findings: list[str] = []
    for path in files:
        try:
            findings.extend(_findings(path, path.read_text(encoding="utf8")))

        except UNREADABLE as unread:
            print(f"comment_gate: {path} could not be read: {unread}", file=sys.stderr)
            return 2
    for finding in sorted(findings):
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
