#!/usr/bin/env python3
from __future__ import annotations

import ast
import sys
from pathlib import Path
from typing import NamedTuple

HELPERS = {
    "apps/worker/tests": (
        "`REPOSITORY_ROOT` or `WORKER_ROOT` from `support.roots` "
        "(apps/worker/tests/support/roots.py)"
    ),
    "packages/devtools/python": (
        "`REPOSITORY_ROOT` from `roots` (packages/devtools/python/roots.py)"
    ),
}

NO_HELPER = "the root helper of the folder, which it does not have yet"

CLIMBS = (
    "`{written}` climbs above this file's folder, so the path breaks when the file "
    "moves. Import {helper} and join the path from there."
)

MAX_WRITTEN = 60


class Refused(NamedTuple):
    message: str


class Scanned(NamedTuple):
    findings: list[str]
    modules: int


def _is_parent(node: ast.expr) -> bool:
    return isinstance(node, ast.Attribute) and node.attr == "parent"


def _is_parents_index(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Attribute)
        and node.value.attr == "parents"
    )


def _is_dotdot_step(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.Div)
        and isinstance(node.right, ast.Constant)
        and node.right.value == ".."
    )


def _is_climb(node: ast.expr) -> bool:
    if _is_parents_index(node) or _is_dotdot_step(node):
        return True
    return (
        _is_parent(node) and isinstance(node, ast.Attribute) and _is_parent(node.value)
    )


def _outermost_climbs(tree: ast.AST) -> list[ast.expr]:
    climbs = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.expr) and _is_climb(node)
    ]
    inner = {
        id(child)
        for node in climbs
        for child in ast.iter_child_nodes(node)
        if isinstance(child, ast.expr)
    }
    return [node for node in climbs if id(node) not in inner]


def _helper_for(module: Path) -> str:
    posix = module.as_posix()
    return next(
        (
            helper
            for folder, helper in HELPERS.items()
            if posix.startswith(f"{folder}/")
        ),
        NO_HELPER,
    )


def _written(node: ast.expr) -> str:
    text = ast.unparse(node)
    return text if len(text) <= MAX_WRITTEN else f"{text[:MAX_WRITTEN]}..."


def _findings_in(module: Path, tree: ast.AST) -> list[str]:
    helper = _helper_for(module)
    return [
        f"{module}:{node.lineno}: "
        + CLIMBS.format(written=_written(node), helper=helper)
        for node in sorted(_outermost_climbs(tree), key=lambda found: found.lineno)
    ]


def _modules(argv: list[str]) -> list[Path] | Refused:
    if not argv:
        return Refused("name at least one directory to read")
    missing = [root for root in argv if not Path(root).is_dir()]
    if missing:
        return Refused(f"no directory at {', '.join(missing)}")
    modules = sorted({found for root in argv for found in Path(root).rglob("*.py")})
    return modules or Refused(f"no Python file under {', '.join(argv)}")


def _scan(argv: list[str]) -> Scanned | Refused:
    modules = _modules(argv)
    if isinstance(modules, Refused):
        return modules
    findings: list[str] = []
    for module in modules:
        try:
            tree = ast.parse(module.read_bytes(), filename=str(module))
        except (OSError, SyntaxError, ValueError) as unread:
            return Refused(f"{module} could not be read: {unread}")
        findings += _findings_in(module, tree)
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
        "climb_scan: no module climbs above its own folder "
        f"(modules read: {scanned.modules})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
