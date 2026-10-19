#!/usr/bin/env python3
from __future__ import annotations

import ast
import re
import sys
import tokenize
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

from citations import citation_in
from comment_blocks import (
    DOCSTRING_HOLDERS,
    Comment,
    comments_in,
    docstrings_in,
    is_notice,
    runs_in,
)

SUFFIX = ".py"

UNREADABLE = (OSError, SyntaxError, tokenize.TokenError, UnicodeDecodeError)

WORD_LIMIT = 25

TOO_LONG = (
    "{path}:{line}: this comment runs to {words} words, over the cap of {limit}. A "
    "comment stays only for a constraint outside this repository (a library, platform "
    "or protocol), a public contract, a generated-file marker, a license, or a "
    "suppression's reason. Any other comment is deleted: hold its reason in a name, a "
    "type, a test, a grant or a lint, or report it open in the tracker."
)

REASON_TOO_LONG = (
    "{path}:{line}: this directive's reason runs to {words} words, and a reason counts "
    "against the comment cap of {limit}. Say the constraint alone."
)

NO_REASON = (
    "{path}:{line}: this suppression gives no reason; a `noqa` or a `type: ignore` "
    "says on the same line why the rule does not hold here. Add the reason after a "
    "second `#`."
)

CITES = (
    "{path}:{line}: this comment cites {what} (`{cited}`); a comment never says which "
    "ticket, decision or rule asked for the code. git, a spec and an ADR are where "
    "that is read."
)

STRING_CITES = (
    "{path}:{line}: this string cites {what} (`{cited}`); a string that reaches a "
    "person names what they can act on, never a document they cannot open from where "
    "they read it. Say the thing instead."
)


class Block(NamedTuple):
    line: int
    prose: str
    limit: int = WORD_LIMIT
    too_long: str = TOO_LONG
    unreasoned: str | None = None


A_TEST_PATH = re.compile(r"(?:^|/)(?:tests?|e2e)/|(?:^|/)(?:test_[^/]*|conftest)\.py$")

A_SPACE = re.compile(r"\s")


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


def _blocks(comments: Iterable[Comment]) -> list[Block]:
    return [
        Block(run.comments[0].row, run.prose, WORD_LIMIT, REASON_TOO_LONG, NO_REASON)
        if run.kind == "suppression"
        else Block(run.comments[0].row, run.prose)
        for run in runs_in(comments)
        if run.kind != "exempt"
    ]


def _docstrings(tree: ast.Module) -> list[Block]:
    return [
        Block(found.statement.lineno, found.text)
        for found in docstrings_in(tree)
        if not is_notice(found.text)
    ]


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
    return A_TEST_PATH.search(path.as_posix()) is not None


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
    comments = _blocks(comments_in(source))
    for line, prose, limit, too_long, unreasoned in comments + _docstrings(tree):
        cited = citation_in(prose)
        if cited is not None:
            what, citation = cited
            said.append(CITES.format(path=path, line=line, what=what, cited=citation))
            continue
        words = len(prose.split())
        if words > limit:
            said.append(too_long.format(path=path, line=line, words=words, limit=limit))
        elif not words and unreasoned is not None:
            said.append(unreasoned.format(path=path, line=line))
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
