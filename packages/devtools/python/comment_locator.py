#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import re
import sys
import tokenize
from typing import Literal, TypedDict

from comment_blocks import (
    Docstring,
    Run,
    comments_in,
    docstrings_in,
    is_notice,
    runs_in,
)

UNREADABLE = (SyntaxError, ValueError, tokenize.TokenError)

BOM = "\ufeff"

TOKEN_LINE_END = re.compile("\n")

# ast ends a line at a lone carriage return too; tokenize does not.
AST_LINE_END = re.compile(r"\r\n?|\n")

DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)

UPDATES = (ast.AnnAssign, ast.AugAssign)

# ast has no TypeAlias before Python 3.12, and the locator runs on any python3.
TYPE_ALIAS = getattr(ast, "TypeAlias", ())

Kind = Literal["doc", "line", "trailing", "directive"]


class Cut(TypedDict):
    start: int
    end: int
    replacement: str


class Located(TypedDict):
    start: int
    end: int
    kind: Kind
    attached: str
    words: int
    text: str
    cut: Cut


def _target(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    return node.attr if isinstance(node, ast.Attribute) else None


def _named(node: ast.stmt) -> str | None:
    if isinstance(node, DEFINITIONS):
        return node.name
    if isinstance(node, TYPE_ALIAS):
        return _target(node.name)
    if isinstance(node, ast.Assign) and len(node.targets) == 1:
        return _target(node.targets[0])
    if isinstance(node, UPDATES):
        return _target(node.target)
    return None


def _names_at(tree: ast.Module) -> dict[int, str]:
    names: dict[int, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.stmt):
            continue
        name = _named(node)
        if name is None:
            continue
        decorators = getattr(node, "decorator_list", [])
        for line in [*(one.lineno for one in decorators), node.lineno]:
            names.setdefault(line, name)
    return names


def _line_starts(source: str, line_end: re.Pattern[str]) -> list[int]:
    return [0, *(found.end() for found in line_end.finditer(source))]


def _ast_offset(source: str, starts: list[int], line: int, column: int) -> int:
    start = starts[line - 1]
    # ast counts a column in UTF-8 bytes, and no character is narrower than one byte.
    return start + len(source[start : start + column].encode()[:column].decode())


def _utf16(source: str, offset: int) -> int:
    return len(source[:offset].encode("utf-16-le")) // 2


def _kind(run: Run) -> Kind:
    if run.kind != "prose":
        return "directive"
    return "line" if run.own_line else "trailing"


def _run_row(
    source: str, starts: list[int], names: dict[int, str], run: Run
) -> Located:
    first = run.comments[0]
    last = run.comments[-1]
    start = starts[first.row - 1] + first.column
    end = starts[last.row - 1] + last.column + len(last.written)
    return {
        "start": first.row,
        "end": last.row,
        "kind": _kind(run),
        "attached": names.get(last.row + 1, "") if run.own_line else "",
        "words": len(run.prose.split()),
        "text": source[start:end],
        "cut": {"start": start, "end": end, "replacement": ""},
    }


def _docstring_row(source: str, starts: list[int], found: Docstring) -> Located:
    holder = found.holder
    statement = found.statement
    text = ast.get_source_segment(source, statement) or ""
    start = _ast_offset(source, starts, statement.lineno, statement.col_offset)
    whole_body = not isinstance(holder, ast.Module) and len(holder.body) == 1
    return {
        "start": statement.lineno,
        "end": statement.end_lineno or statement.lineno,
        "kind": "directive" if is_notice(found.text) else "doc",
        "attached": holder.name if not isinstance(holder, ast.Module) else "",
        "words": len(found.text.split()),
        "text": text,
        "cut": {
            "start": start,
            "end": start + len(text),
            "replacement": "..." if whole_body else "",
        },
    }


def _in_utf16(source: str, shift: int, row: Located) -> Located:
    cut = row["cut"]
    return {
        **row,
        "cut": {
            "start": _utf16(source, shift + cut["start"]),
            "end": _utf16(source, shift + cut["end"]),
            "replacement": cut["replacement"],
        },
    }


def _located(source: str) -> list[Located]:
    body = source.removeprefix(BOM)
    tree = ast.parse(body)
    names = _names_at(tree)
    token_starts = _line_starts(body, TOKEN_LINE_END)
    ast_starts = _line_starts(body, AST_LINE_END)
    rows = [_docstring_row(body, ast_starts, found) for found in docstrings_in(tree)]
    rows += [
        _run_row(body, token_starts, names, run) for run in runs_in(comments_in(body))
    ]
    shift = len(source) - len(body)
    return sorted(
        (_in_utf16(source, shift, row) for row in rows), key=lambda row: row["start"]
    )


def main(argv: list[str]) -> int:
    """Reads one file's source on stdin, the path in argv for messages, and
    writes its comment blocks as JSON. 0: written. 2: unreadable."""
    path = argv[0] if argv else "<stdin>"
    try:
        located = _located(sys.stdin.buffer.read().decode("utf8"))
    except UNREADABLE as unread:
        sys.stderr.write(f"comment_locator: {path} could not be read: {unread}\n")
        return 2
    sys.stdout.write(json.dumps(located))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
