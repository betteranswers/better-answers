from __future__ import annotations

import ast
import io
import re
import token
import tokenize
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, NamedTuple

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

DOCSTRING_HOLDERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


class Comment(NamedTuple):
    row: int
    column: int
    written: str
    own_line: bool


RunKind = Literal["suppression", "exempt", "prose"]


@dataclass
class Run:
    kind: RunKind
    comments: list[Comment]
    parts: list[str] = field(default_factory=list)

    @property
    def own_line(self) -> bool:
        return self.comments[0].own_line

    @property
    def prose(self) -> str:
        return "\n".join(self.parts)


class Docstring(NamedTuple):
    holder: ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
    statement: ast.stmt
    text: str


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


def runs_in(comments: Iterable[Comment]) -> list[Run]:
    runs: list[Run] = []
    previous = -2
    for comment in comments:
        # A reason is held to its own directive, never to the comments around it.
        if _suppresses(comment.written):
            prose = _prose(comment.written) or ""
            runs.append(Run("suppression", [comment], [prose]))
            previous = -2
            continue
        text = _prose(comment.written)
        if text is None:
            runs.append(Run("exempt", [comment]))
            previous = -2
            continue
        if comment.own_line and comment.row == previous + 1:
            runs[-1].comments.append(comment)
            runs[-1].parts.append(text)
        else:
            runs.append(Run("prose", [comment], [text]))
        previous = comment.row if comment.own_line else -2
    return runs


def comments_in(source: str) -> list[Comment]:
    return [
        Comment(
            read.start[0],
            read.start[1],
            read.string,
            read.line[: read.start[1]].strip() == "",
        )
        for read in tokenize.generate_tokens(io.StringIO(source).readline)
        if read.type == token.COMMENT
    ]


def docstrings_in(tree: ast.Module) -> list[Docstring]:
    found: list[Docstring] = []
    for node in ast.walk(tree):
        if not isinstance(node, DOCSTRING_HOLDERS):
            continue
        text = ast.get_docstring(node, clean=False)
        if text is not None:
            found.append(Docstring(node, node.body[0], text))
    return found


def is_notice(text: str) -> bool:
    return A_NOTICE.match(text.strip()) is not None
