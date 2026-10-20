#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import sys
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import NamedTuple

MANIFEST = Path("contracts/manifest.json")

DECLARED = ("PORT_OF", "AGREEMENT")

TYPESCRIPT = frozenset({".ts", ".tsx"})

UNREADABLE = (OSError, SyntaxError, ValueError)

HALF_DECLARED = (
    "this module declares `{present}` but not `{missing}`, and a port declares both, "
    "so that what it mirrors and the fixture holding the two tiers to one behaviour "
    "are both named. Add {shape}."
)

UNKNOWN_AGREEMENT = (
    "`AGREEMENT` names `{agreement}`, which contracts/manifest.json's agreements do "
    "not hold, so no fixture holds this port. Name a key of contracts/manifest.json's "
    "agreements, or add the agreement to contracts/ in its own pull request."
)

NOT_A_MODULE = (
    "`PORT_OF` names `{ported}`, which is not a TypeScript module the tree holds, so "
    "the port does not say what it mirrors. Name each module as it now stands, by its "
    "path from the repository root, with no `..` segment, ending `.ts` or `.tsx`."
)

NOT_A_LITERAL = (
    "`{name}` is not assigned alone as a literal of the shape the gate reads. The gate "
    "reads only that form, so any other would pass unchecked. Write it as {shape}."
)

TWICE = (
    "`{name}` is declared twice in this module, so which value holds depends on the "
    "order. Declare it once."
)

AUGMENTED = (
    "`{name}` is extended by an augmented assignment, which the gate does not read, so "
    "what it adds would pass unchecked. Declare the whole value once, as {shape}."
)

SHAPES = {
    "PORT_OF": '`PORT_OF = ("packages/<package>/src/<module>.ts",)`, a non-empty '
    "tuple of string literals",
    "AGREEMENT": '`AGREEMENT = "<key>"`, a string literal naming a key of '
    "contracts/manifest.json's agreements",
}


class Refused(NamedTuple):
    message: str


class Declared(NamedTuple):
    name: str
    line: int
    value: object


class Augmented(NamedTuple):
    name: str
    line: int


class Port(NamedTuple):
    path: Path
    declared: list[Declared]
    augmented: list[Augmented]


class Scanned(NamedTuple):
    findings: list[str]
    ports: int
    modules: int


def _literal(value: ast.expr) -> object:
    try:
        return ast.literal_eval(value)
    except (ValueError, TypeError):
        return None


def _declared_in(statement: ast.stmt) -> list[Declared]:
    targets: Sequence[ast.expr]
    if isinstance(statement, ast.Assign):
        targets, value = statement.targets, statement.value
    elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
        targets, value = [statement.target], statement.value
    else:
        return []
    bound = [
        node.id
        for target in targets
        for node in ast.walk(target)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    ]
    declared = [name for name in bound if name in DECLARED]
    if not declared:
        return []
    alone = len(targets) == 1 and isinstance(targets[0], ast.Name)
    literal = _literal(value) if alone else None
    return [Declared(name, statement.lineno, literal) for name in declared]


def _augmented_in(statement: ast.stmt) -> list[Augmented]:
    if not isinstance(statement, ast.AugAssign):
        return []
    target = statement.target
    if not isinstance(target, ast.Name) or target.id not in DECLARED:
        return []
    return [Augmented(target.id, statement.lineno)]


def _names_a_module(ported: str) -> bool:
    pure = PurePosixPath(ported)
    return (
        not pure.is_absolute()
        and ".." not in pure.parts
        and pure.suffix in TYPESCRIPT
        and Path(ported).is_file()
    )


def _port_of_findings(value: object) -> list[str]:
    if not isinstance(value, tuple) or not value:
        return [NOT_A_LITERAL.format(name="PORT_OF", shape=SHAPES["PORT_OF"])]
    if not all(isinstance(ported, str) for ported in value):
        return [NOT_A_LITERAL.format(name="PORT_OF", shape=SHAPES["PORT_OF"])]
    return [
        NOT_A_MODULE.format(ported=ported)
        for ported in value
        if not _names_a_module(ported)
    ]


def _agreement_findings(value: object, agreements: frozenset[str]) -> list[str]:
    if not isinstance(value, str):
        return [NOT_A_LITERAL.format(name="AGREEMENT", shape=SHAPES["AGREEMENT"])]
    if value in agreements:
        return []
    return [UNKNOWN_AGREEMENT.format(agreement=value)]


def _value_findings(declared: Declared, agreements: frozenset[str]) -> list[str]:
    if declared.name == "PORT_OF":
        return _port_of_findings(declared.value)
    return _agreement_findings(declared.value, agreements)


def _declared_twice(port: Port) -> list[tuple[int, str]]:
    return [
        (line, TWICE.format(name=name))
        for name in DECLARED
        for line in [found.line for found in port.declared if found.name == name][1:]
    ]


def _half_declared(port: Port) -> list[tuple[int, str]]:
    first = {found.name: found.line for found in reversed(port.declared)}
    missing = [name for name in DECLARED if name not in first]
    if len(missing) != 1:
        return []
    present = next(name for name in DECLARED if name in first)
    message = HALF_DECLARED.format(
        present=present, missing=missing[0], shape=SHAPES[missing[0]]
    )
    return [(first[present], message)]


def _findings_for(port: Port, agreements: frozenset[str]) -> list[str]:
    said = [
        (found.line, message)
        for found in port.declared
        for message in _value_findings(found, agreements)
    ]
    said += [
        (found.line, AUGMENTED.format(name=found.name, shape=SHAPES[found.name]))
        for found in port.augmented
    ]
    said += _declared_twice(port) + _half_declared(port)
    return [f"{port.path}:{line}: {message}" for line, message in sorted(said)]


def _agreements() -> frozenset[str] | Refused:
    try:
        read = json.loads(MANIFEST.read_text(encoding="utf8"))
    except (OSError, ValueError) as unread:
        return Refused(f"{MANIFEST} could not be read: {unread}")
    agreements = read.get("agreements") if isinstance(read, dict) else None
    if not isinstance(agreements, dict) or not agreements:
        return Refused(f"{MANIFEST} names no agreement, so no port could name one")
    return frozenset(agreements)


def _modules(argv: list[str]) -> list[Path] | Refused:
    if not argv:
        return Refused("name at least one directory to read")
    missing = [root for root in argv if not Path(root).is_dir()]
    if missing:
        return Refused(f"no directory at {', '.join(missing)}")
    modules = sorted({found for root in argv for found in Path(root).rglob("*.py")})
    return modules or Refused(f"no Python file under {', '.join(argv)}")


def _ports(modules: list[Path]) -> list[Port] | Refused:
    ports: list[Port] = []
    for module in modules:
        try:
            tree = ast.parse(module.read_bytes(), filename=str(module))
        except UNREADABLE as unread:
            return Refused(f"{module} could not be read: {unread}")
        declared = [
            found for statement in tree.body for found in _declared_in(statement)
        ]
        augmented = [
            found for statement in tree.body for found in _augmented_in(statement)
        ]
        if declared or augmented:
            ports.append(Port(module, declared, augmented))
    return ports


def _scan(argv: list[str]) -> Scanned | Refused:
    modules = _modules(argv)
    if isinstance(modules, Refused):
        return modules
    agreements = _agreements()
    if isinstance(agreements, Refused):
        return agreements
    ports = _ports(modules)
    if isinstance(ports, Refused):
        return ports
    if not ports:
        return Refused(
            f"no module under {', '.join(argv)} declares `PORT_OF` or `AGREEMENT`, "
            "so the walk proved nothing"
        )
    findings = [said for port in ports for said in _findings_for(port, agreements)]
    return Scanned(findings, len(ports), len(modules))


def main(argv: list[str]) -> int:
    scanned = _scan(argv)
    if isinstance(scanned, Refused):
        print(f"port_scan: {scanned.message}", file=sys.stderr)
        return 2
    for finding in scanned.findings:
        print(finding)
    if scanned.findings:
        return 1
    print(
        "port_scan: every port names TypeScript modules the tree holds and an "
        f"agreement in contracts/manifest.json (ports: {scanned.ports}, modules "
        f"read: {scanned.modules})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
