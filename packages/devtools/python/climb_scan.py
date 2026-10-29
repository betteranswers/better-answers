#!/usr/bin/env python3
from __future__ import annotations

import ast
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import NamedTuple

WORKSPACE_PARENTS = frozenset({"apps", "packages"})

HELPERS = {
    "apps/worker": (
        "`REPOSITORY_ROOT` or `WORKER_ROOT` from `support.roots` "
        "(apps/worker/tests/support/roots.py)"
    ),
    "packages/devtools": (
        "`REPOSITORY_ROOT` from `roots` (packages/devtools/python/roots.py)"
    ),
}

CLIMBS = (
    "`{written}` climbs to the root of `{workspace}` or out of it, so a move breaks "
    "the path. Import {helper} and join the path from there."
)

MAX_WRITTEN = 60

METHODS = frozenset({"resolve", "absolute"})
PASSES_THROUGH = frozenset({"abspath", "realpath", "normpath"})
JOINS = frozenset({"Path", "PurePath", "join"})
READS = frozenset({"open", "Path"})


class Refused(NamedTuple):
    message: str


class Scanned(NamedTuple):
    findings: list[str]
    modules: int


class Position(NamedTuple):
    rise: int
    names: int


class Placement(NamedTuple):
    workspace: str
    depth: int


def _placement(module: Path) -> Placement | None:
    parts = module.parts
    if len(parts) < 3 or parts[0] not in WORKSPACE_PARENTS:
        return None
    workspace = f"{parts[0]}/{parts[1]}"
    return Placement(workspace, len(parts) - 3) if workspace in HELPERS else None


def _segments(nodes: Sequence[ast.expr]) -> list[str]:
    segments: list[str] = []
    for node in nodes:
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            break
        segments += node.value.split("/")
    return segments


def _after(at: Position, segments: Sequence[str]) -> Position:
    for segment in segments:
        if segment == "..":
            at = _up(at)
        elif segment not in ("", "."):
            at = Position(at.rise, at.names + 1)
    return at


def _up(at: Position) -> Position:
    return Position(at.rise, at.names - 1) if at.names else Position(at.rise + 1, 0)


def _called(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    return node.func.attr if isinstance(node.func, ast.Attribute) else None


def _up_by(at: Position | None, steps: int) -> Position | None:
    for _ in range(steps):
        at = None if at is None else _up(at)
    return at


def _parents_rise(node: ast.Subscript) -> Position | None:
    parents, index = node.value, node.slice
    if not (isinstance(parents, ast.Attribute) and parents.attr == "parents"):
        return None
    if not (isinstance(index, ast.Constant) and isinstance(index.value, int)):
        return None
    return _up_by(_rise(parents.value), index.value + 1)


def _divided_rise(node: ast.BinOp) -> Position | None:
    base = _rise(node.left) if isinstance(node.op, ast.Div) else None
    return None if base is None else _after(base, _segments([node.right]))


def _call_rise(node: ast.Call) -> Position | None:
    name = _called(node)
    if name in METHODS and isinstance(node.func, ast.Attribute):
        return _rise(node.func.value)
    base = _rise(node.args[0]) if node.args else None
    if base is None:
        return None
    if name == "dirname":
        return _up(base)
    if name in JOINS:
        return _after(base, _segments(node.args[1:]))
    return base if name in PASSES_THROUGH else None


def _rise(node: ast.expr) -> Position | None:
    if isinstance(node, ast.Name):
        return Position(-1, 0) if node.id == "__file__" else None
    if isinstance(node, ast.Attribute):
        return _up_by(_rise(node.value), 1) if node.attr == "parent" else None
    if isinstance(node, ast.Subscript):
        return _parents_rise(node)
    if isinstance(node, ast.BinOp):
        return _divided_rise(node)
    return _call_rise(node) if isinstance(node, ast.Call) else None


def _reads_from_cwd(node: ast.expr) -> bool:
    if not (isinstance(node, ast.Call) and _called(node) in READS):
        return False
    return _segments(node.args[:1])[:1] == [".."]


def _climbs(node: ast.expr, depth: int) -> bool:
    at = _rise(node)
    return (at is not None and at.rise >= max(depth, 1)) or _reads_from_cwd(node)


def _outermost(climbs: list[ast.expr]) -> list[ast.expr]:
    covered = {
        id(child) for node in climbs for child in ast.walk(node) if child is not node
    }
    return [node for node in climbs if id(node) not in covered]


def _written(node: ast.expr) -> str:
    text = ast.unparse(node)
    return text if len(text) <= MAX_WRITTEN else f"{text[:MAX_WRITTEN]}..."


def _message(node: ast.expr, placement: Placement) -> str:
    return CLIMBS.format(
        written=_written(node),
        workspace=placement.workspace,
        helper=HELPERS[placement.workspace],
    )


def _findings_in(module: Path, tree: ast.AST, placement: Placement) -> list[str]:
    climbs = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.expr) and _climbs(node, placement.depth)
    ]
    return [
        f"{module}:{node.lineno}: {_message(node, placement)}"
        for node in sorted(_outermost(climbs), key=lambda found: found.lineno)
    ]


def _modules(argv: list[str]) -> list[Path] | Refused:
    roots = [Path(root) for root in argv]
    if not roots:
        return Refused("name at least one directory to read")
    absent = next((root for root in roots if not root.is_dir()), None)
    if absent is not None:
        return Refused(f"no directory at {absent}")
    found = {module for root in roots for module in root.rglob("*.py")}
    return sorted(found) or Refused(f"no Python file under {', '.join(argv)}")


def _scan(argv: list[str]) -> Scanned | Refused:
    modules = _modules(argv)
    if isinstance(modules, Refused):
        return modules
    findings: list[str] = []
    for module in modules:
        placement = _placement(module)
        if placement is None:
            return Refused(
                f"{module} sits in no workspace the scan has a roots helper for"
            )
        try:
            tree = ast.parse(module.read_bytes(), filename=str(module))
        except (OSError, SyntaxError, ValueError) as unread:
            return Refused(f"{module} could not be read: {unread}")
        findings += _findings_in(module, tree, placement)
    return Scanned(findings, len(modules))


def main(argv: list[str]) -> int:
    scanned = _scan(argv)
    if isinstance(scanned, Refused):
        print(f"climb_scan: {scanned.message}", file=sys.stderr)
        return 2
    for finding in scanned.findings:
        print(finding)
    if scanned.findings:
        return 1
    print(
        "climb_scan: no module climbs to the root of its workspace or out of it "
        f"(modules read: {scanned.modules})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
