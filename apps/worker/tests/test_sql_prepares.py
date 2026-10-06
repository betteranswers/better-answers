import ast
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from functools import cache
from itertools import product
from pathlib import Path
from typing import TypeIs

import psycopg
import pytest

from better_answers_worker.pipeline import CHUNK_TABLE, Table
from pg_harness import migrated_postgres

WORKER_PACKAGE = Path(__file__).resolve().parents[1] / "src" / "better_answers_worker"

# The psycopg and asyncpg methods whose first argument is a statement.
SENDS = frozenset(
    (
        "execute",
        "executemany",
        "copy",
        "stream",
        "fetch",
        "fetchrow",
        "fetchval",
        "prepare",
    )
)

PREPARABLE = re.compile(
    r"\s*(?:SELECT|INSERT|UPDATE|DELETE|MERGE|VALUES|WITH)\b", re.IGNORECASE
)

# Upper case only, so prose opening with "Select" or "Set" is never taken for SQL.
STATEMENT_SHAPED = re.compile(
    r"\s*(?:SELECT|INSERT|UPDATE|DELETE|MERGE|VALUES|WITH|COPY|SET|CREATE|ALTER"
    r"|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b"
)

PLACEHOLDER = re.compile(r"%\((\w+)\)s|%s|%%")

# Statement text to why Postgres cannot prepare it. Empty: the worker sends no DDL,
# COPY, SET or transaction control as text.
UNPREPARABLE: Mapping[str, str] = {}

# cocoindex writes these from the worker's own table and column names.
TARGET_TABLES: Mapping[str, Table] = {"pipeline.rows:CHUNK_TABLE": CHUNK_TABLE}

SENDING_MODULES = {
    "audit",
    "health",
    "loop",
    "queue",
    "rebuild",
    "pipeline.catalogue",
    "pipeline.host",
    "pipeline.rows",
}


@dataclass(frozen=True, slots=True)
class Statement:
    label: str
    text: str


@dataclass(frozen=True, slots=True)
class Module:
    name: str
    tree: ast.Module
    parents: Mapping[ast.AST, ast.AST]
    constants: Mapping[str, ast.expr]


@dataclass
class Survey:
    statements: list[Statement] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


class UnreadableError(Exception):
    pass


type Reading = tuple[str, tuple[str, ...]]

type Function = ast.FunctionDef | ast.AsyncFunctionDef


def _constant_of(statement: ast.stmt) -> tuple[str, ast.expr] | None:
    if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
        target = statement.targets[0]
        if isinstance(target, ast.Name):
            return target.id, statement.value
    if (
        isinstance(statement, ast.AnnAssign)
        and statement.value is not None
        and isinstance(statement.target, ast.Name)
    ):
        return statement.target.id, statement.value
    return None


def read_module(path: Path, root: Path) -> Module:
    tree = ast.parse(path.read_text("utf-8"), filename=str(path))
    parents = {
        child: parent
        for parent in ast.walk(tree)
        for child in ast.iter_child_nodes(parent)
    }
    constants = dict(
        found for statement in tree.body if (found := _constant_of(statement))
    )
    name = ".".join(path.relative_to(root).with_suffix("").parts)
    return Module(name=name, tree=tree, parents=parents, constants=constants)


def _ancestors(module: Module, node: ast.AST) -> Iterator[ast.AST]:
    parent = module.parents.get(node)
    while parent is not None:
        yield parent
        parent = module.parents.get(parent)


def _site(module: Module, node: ast.expr | ast.stmt) -> str:
    names = [
        ancestor.name
        for ancestor in _ancestors(module, node)
        if isinstance(ancestor, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef)
    ]
    scope = ".".join(reversed(names)) or "<module>"
    return f"{module.name}:{scope} line {node.lineno}"


def _enclosing_function(module: Module, node: ast.AST) -> Function | None:
    for ancestor in _ancestors(module, node):
        if isinstance(ancestor, ast.FunctionDef | ast.AsyncFunctionDef):
            return ancestor
    return None


def _parameters(function: Function) -> list[str]:
    arguments = function.args
    every = (*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs)
    return [argument.arg for argument in every]


def _argument_at(call: ast.Call, position: int, parameter: str) -> ast.expr:
    if position < len(call.args):
        return call.args[position]
    for keyword in call.keywords:
        if keyword.arg == parameter:
            return keyword.value
    raise UnreadableError(f"{parameter}, unbound at line {call.lineno}")


def _callers(module: Module, function: Function) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(module.tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == function.name
    ]


def _readings_of_parameter(
    module: Module, function: Function, parameter: str, seen: set[ast.AST]
) -> list[Reading]:
    position = _parameters(function).index(parameter)
    callers = _callers(module, function)
    if not callers:
        raise UnreadableError(f"{parameter}, which no call in the module passes")
    readings: list[Reading] = []
    for call in callers:
        argument = _argument_at(call, position, parameter)
        bound = f"{parameter}={ast.unparse(argument)}"
        readings += [
            (text, (bound, *notes))
            for text, notes in readings_of(module, argument, seen)
        ]
    return readings


def _readings_of_name(
    module: Module, node: ast.Name, seen: set[ast.AST]
) -> list[Reading]:
    function = _enclosing_function(module, node)
    if function is not None and node.id in _parameters(function):
        return _readings_of_parameter(module, function, node.id, seen)
    if node.id in module.constants:
        return readings_of(module, module.constants[node.id], seen)
    raise UnreadableError(node.id)


def _readings_of_joined(
    module: Module, node: ast.JoinedStr, seen: set[ast.AST]
) -> list[Reading]:
    parts: list[list[Reading]] = []
    for value in node.values:
        inner = value
        if isinstance(value, ast.FormattedValue):
            if value.conversion != -1 or value.format_spec is not None:
                raise UnreadableError(ast.unparse(node))
            inner = value.value
        parts.append(readings_of(module, inner, seen))
    return [
        (
            "".join(text for text, _ in combination),
            tuple(note for _, notes in combination for note in notes),
        )
        for combination in product(*parts)
    ]


def readings_of(module: Module, node: ast.expr, seen: set[ast.AST]) -> list[Reading]:
    """Every text `node` can hold, each with the parameter values that gave it."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        seen.add(node)
        return [(node.value, ())]
    if isinstance(node, ast.JoinedStr):
        return _readings_of_joined(module, node, seen)
    if isinstance(node, ast.Name):
        return _readings_of_name(module, node, seen)
    raise UnreadableError(ast.unparse(node))


def _is_send(node: ast.AST) -> TypeIs[ast.Call]:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in SENDS
        and bool(node.args or node.keywords)
    )


def _statement_argument(call: ast.Call) -> ast.expr:
    if call.args:
        return call.args[0]
    for keyword in call.keywords:
        if keyword.arg == "query":
            return keyword.value
    raise UnreadableError(ast.unparse(call))


def _read_send(
    module: Module, call: ast.Call, found: Survey, seen: set[ast.AST]
) -> None:
    site = _site(module, call)
    try:
        argument = _statement_argument(call)
        readings = readings_of(module, argument, seen)
    except UnreadableError as unreadable:
        found.problems.append(
            f"{site}: the statement is not a string this test can read: {unreadable}"
        )
        return
    if isinstance(argument, ast.Name) and argument.id in module.constants:
        site = f"{site} via {argument.id}"
    found.statements += [
        Statement(" ".join((site, *notes)), text) for text, notes in readings
    ]


def _is_called(module: Module, node: ast.Attribute) -> bool:
    parent = module.parents.get(node)
    return isinstance(parent, ast.Call) and parent.func is node


def _aliases_in(module: Module) -> list[str]:
    return [
        f"{_site(module, node)}: `{node.attr}` is taken without a call,"
        " so its statement cannot be read"
        for node in ast.walk(module.tree)
        if isinstance(node, ast.Attribute)
        and node.attr in SENDS
        and not _is_called(module, node)
    ]


def _orphans_in(module: Module, seen: set[ast.AST]) -> list[str]:
    return [
        f"{_site(module, node)}: a statement no send reaches"
        for node in ast.walk(module.tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node not in seen
        and not isinstance(module.parents.get(node), ast.Expr)
        and STATEMENT_SHAPED.match(node.value)
    ]


def _tables_in(module: Module, found: Survey) -> list[str]:
    built: list[str] = []
    for node in ast.walk(module.tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
            continue
        if node.func.id != Table.__name__:
            continue
        named = [name for name, value in module.constants.items() if value is node]
        if named:
            built.append(f"{module.name}:{named[0]}")
        else:
            found.problems.append(
                f"{_site(module, node)}: a target table built where no name reaches it"
            )
    return built


def _quoted(names: Sequence[str]) -> str:
    return ", ".join(f'"{name}"' for name in names)


def target_statements(key: str, table: Table) -> list[Statement]:
    """The upsert and the delete cocoindex sends for one row of `table`."""
    name = f'"{table.schema}"."{table.name}"'
    columns = [column.name for column in table.columns]
    rest = [column for column in columns if column not in table.primary_key]
    updates = ", ".join(f'"{column}" = EXCLUDED."{column}"' for column in rest)
    conflict = f"DO UPDATE SET {updates}" if rest else "DO NOTHING"
    values = ", ".join(f"${number}" for number in range(1, len(columns) + 1))
    keyed = " AND ".join(
        f'"{column}" = ${number}'
        for number, column in enumerate(table.primary_key, start=1)
    )
    upsert = (
        f"INSERT INTO {name} ({_quoted(columns)}) VALUES ({values})"
        f" ON CONFLICT ({_quoted(table.primary_key)}) {conflict}"
    )
    return [
        Statement(f"{key} upsert", upsert),
        Statement(f"{key} delete", f"DELETE FROM {name} WHERE ({keyed})"),
    ]


def _check_tables(found: Survey, built: list[str], tables: Mapping[str, Table]) -> None:
    found.problems += [
        f"{key}: a target table this test does not prepare; name it in TARGET_TABLES"
        for key in built
        if key not in tables
    ]
    for key, table in tables.items():
        if key in built:
            found.statements += target_statements(key, table)
        else:
            found.problems.append(f"TARGET_TABLES names {key}, which nothing builds")


def _set_aside_unpreparable(found: Survey, unpreparable: Mapping[str, str]) -> None:
    prepared: list[Statement] = []
    refused: list[Statement] = []
    for statement in found.statements:
        (prepared if PREPARABLE.match(statement.text) else refused).append(statement)
    sent = {statement.text for statement in refused}
    found.problems += [
        f"UNPREPARABLE names a statement no send makes unprepared: {text!r}"
        for text in unpreparable
        if text not in sent
    ]
    found.problems += [
        f"{statement.label}: Postgres cannot prepare it;"
        " name it in UNPREPARABLE with the reason"
        for statement in refused
        if statement.text not in unpreparable
    ]
    found.statements = prepared


def survey(
    root: Path, *, tables: Mapping[str, Table], unpreparable: Mapping[str, str]
) -> Survey:
    """Every statement the modules under `root` send, and why any was missed."""
    found = Survey()
    built: list[str] = []
    for path in sorted(root.rglob("*.py")):
        module = read_module(path, root)
        seen: set[ast.AST] = set()
        for node in ast.walk(module.tree):
            if _is_send(node):
                _read_send(module, node, found, seen)
        found.problems += _aliases_in(module)
        found.problems += _orphans_in(module, seen)
        built += _tables_in(module, found)
    _check_tables(found, built, tables)
    _set_aside_unpreparable(found, unpreparable)
    return found


def numbered(text: str) -> str:
    """psycopg's placeholders as Postgres numbers them; a named one keeps one number."""
    numbers: dict[str, int] = {}

    def number_of(match: re.Match[str]) -> str:
        if match[0] == "%%":
            return "%"
        key = match[1] or f"%s at {match.start()}"
        return f"${numbers.setdefault(key, len(numbers) + 1)}"

    return PLACEHOLDER.sub(number_of, text)


def failures_preparing(
    connection: psycopg.Connection, statements: Sequence[Statement]
) -> list[str]:
    """Each statement Postgres refuses to plan, by its label and Postgres's words."""
    failures: list[str] = []
    with connection.transaction():
        for number, statement in enumerate(statements):
            # A savepoint each, so one refusal leaves the rest preparable.
            try:
                with connection.transaction():
                    connection.execute(
                        f"PREPARE probe_{number} AS {numbered(statement.text)}"
                    )
                    connection.execute(f"DEALLOCATE probe_{number}")
            except psycopg.Error as error:
                failures.append(f"{statement.label}: {error.diag.message_primary}")
    return failures


@cache
def worker_survey() -> Survey:
    return survey(WORKER_PACKAGE, tables=TARGET_TABLES, unpreparable=UNPREPARABLE)


def plant(root: Path, source: str) -> Path:
    (root / "planted.py").write_text(source, encoding="utf-8")
    return root


def test_reads_every_statement_the_worker_sends() -> None:
    found = worker_survey()

    assert found.problems == []
    assert {s.label.split(":")[0] for s in found.statements} == SENDING_MODULES


def test_every_statement_the_worker_sends_prepares() -> None:
    statements = worker_survey().statements

    with migrated_postgres() as connection:
        failures = failures_preparing(connection, statements)

    assert failures == []


A_MODULE_NAMING_WHAT_IS_GONE = """def read(cursor):
    cursor.execute("SELECT id FROM no_such_table")
    cursor.execute("SELECT id FROM workspace WHERE id = %s", ("one",))
    cursor.execute("SELECT no_such_column FROM workspace")
"""


def test_names_each_statement_naming_a_missing_table_or_column(
    tmp_path: Path,
) -> None:
    planted = survey(
        plant(tmp_path, A_MODULE_NAMING_WHAT_IS_GONE), tables={}, unpreparable={}
    )

    with migrated_postgres() as connection:
        failures = failures_preparing(connection, planted.statements)

    assert planted.problems == []
    assert failures == [
        'planted:read line 2: relation "no_such_table" does not exist',
        'planted:read line 4: column "no_such_column" does not exist',
    ]


def test_numbers_named_and_positional_placeholders_as_postgres_does() -> None:
    text = "SELECT %(a)s, %s, %(b)s, %(a)s, %s LIKE 'x%%'"

    assert numbered(text) == "SELECT $1, $2, $3, $1, $4 LIKE 'x%'"


@pytest.mark.parametrize(
    ("why", "source", "problems"),
    [
        (
            "a statement built by a call",
            "def read(cursor):\n    cursor.execute(statement_of())\n",
            [
                "planted:read line 2: the statement is not a string this test can"
                " read: statement_of()"
            ],
        ),
        (
            "a send taken as a value",
            "def read(cursor):\n    send = cursor.execute\n    send('SELECT 1')\n",
            [
                "planted:read line 2: `execute` is taken without a call,"
                " so its statement cannot be read",
                "planted:read line 3: a statement no send reaches",
            ],
        ),
        (
            "a send handed on as an argument",
            "def read(cursor):\n    run(cursor.execute)\n",
            [
                "planted:read line 2: `execute` is taken without a call,"
                " so its statement cannot be read"
            ],
        ),
        (
            "a statement no send reaches",
            'ORPHAN = "SELECT id FROM workspace"\n',
            ["planted:<module> line 1: a statement no send reaches"],
        ),
        (
            "a statement Postgres cannot prepare",
            "def tune(cursor):\n    cursor.execute('SET statement_timeout = 0')\n",
            [
                "planted:tune line 2: Postgres cannot prepare it;"
                " name it in UNPREPARABLE with the reason"
            ],
        ),
        (
            "a target table the test does not know",
            "EXTRA = Table(schema='index', name='extra', columns=(), primary_key=())\n",
            [
                "planted:EXTRA: a target table this test does not prepare;"
                " name it in TARGET_TABLES"
            ],
        ),
    ],
)
def test_refuses_a_statement_it_cannot_read_or_prepare(
    tmp_path: Path, why: str, source: str, problems: list[str]
) -> None:
    planted = survey(plant(tmp_path, source), tables={}, unpreparable={})

    assert planted.problems == problems, why


def test_sets_aside_an_unpreparable_statement_named_with_its_reason(
    tmp_path: Path,
) -> None:
    source = "def tune(cursor):\n    cursor.execute('SET statement_timeout = 0')\n"

    planted = survey(
        plant(tmp_path, source),
        tables={},
        unpreparable={"SET statement_timeout = 0": "SET is not a plannable statement"},
    )

    assert (planted.problems, planted.statements) == ([], [])


def test_refuses_an_exclusion_or_table_that_names_nothing(tmp_path: Path) -> None:
    planted = survey(
        plant(tmp_path, "VALUE = 1\n"),
        tables={"planted:GONE": CHUNK_TABLE},
        unpreparable={"SET work_mem = 1": "SET is not a plannable statement"},
    )

    assert planted.problems == [
        "TARGET_TABLES names planted:GONE, which nothing builds",
        "UNPREPARABLE names a statement no send makes unprepared: 'SET work_mem = 1'",
    ]
