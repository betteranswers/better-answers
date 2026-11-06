import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

from support.roots import WORKER_ROOT

SOURCE_ROOT = WORKER_ROOT / "src"

CONFIG_MODULE = "better_answers_worker/config.py"

LIBRARY_SWITCHES = frozenset(
    {
        ("better_answers_worker/__init__.py", "ORT_DISABLE_TELEMETRY"),
        (
            "better_answers_worker/pipeline/__init__.py",
            "COCOINDEX_DISABLE_USAGE_TRACKING",
        ),
        ("better_answers_worker/pipeline/__init__.py", "RUST_LOG"),
    }
)

ENVIRONMENT_NAMES = frozenset(
    {"environ", "environb", "getenv", "getenvb", "putenv", "unsetenv"}
)


@dataclass(frozen=True, slots=True)
class Access:
    line: int
    key: str | None


def literal(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def key_named_by(access: ast.Attribute, parents: dict[ast.AST, ast.AST]) -> str | None:
    parent = parents.get(access)
    if isinstance(parent, ast.Subscript) and parent.value is access:
        return literal(parent.slice)
    method = parent if isinstance(parent, ast.Attribute) else access
    call = parents.get(method)
    if isinstance(call, ast.Call) and call.func is method and call.args:
        return literal(call.args[0])
    return None


def names_bound_to_os(tree: ast.AST) -> set[str]:
    return {
        alias.asname or "os"
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
        if alias.name.split(".")[0] == "os"
        and (alias.asname is None or alias.name == "os")
    }


def import_accesses(tree: ast.AST) -> list[Access]:
    return [
        Access(node.lineno, None)
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        and node.module == "os"
        and any(alias.name in ENVIRONMENT_NAMES for alias in node.names)
    ]


def attribute_accesses(tree: ast.AST) -> list[Access]:
    parents = {
        child: parent
        for parent in ast.walk(tree)
        for child in ast.iter_child_nodes(parent)
    }
    modules = names_bound_to_os(tree)
    return [
        Access(node.lineno, key_named_by(node, parents))
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and node.attr in ENVIRONMENT_NAMES
        and isinstance(node.value, ast.Name)
        and node.value.id in modules
    ]


def accesses_in(source: str) -> list[Access]:
    tree = ast.parse(source)
    found = import_accesses(tree) + attribute_accesses(tree)
    return sorted(found, key=lambda access: access.line)


def accesses_under(root: Path) -> list[tuple[str, Access]]:
    return [
        (file.relative_to(root).as_posix(), access)
        for file in sorted(root.rglob("*.py"))
        for access in accesses_in(file.read_text("utf-8"))
    ]


def refusals_under(root: Path) -> list[str]:
    return [
        f"{relative}:{access.line} reads the environment outside config.py."
        f" Read it in {CONFIG_MODULE} and pass the value in"
        for relative, access in accesses_under(root)
        if relative != CONFIG_MODULE and (relative, access.key) not in LIBRARY_SWITCHES
    ]


def test_src_reads_the_environment_only_in_config() -> None:
    assert refusals_under(SOURCE_ROOT) == []


def test_each_library_switch_is_still_set_where_it_is_excused() -> None:
    present = {
        (relative, access.key) for relative, access in accesses_under(SOURCE_ROOT)
    }

    assert LIBRARY_SWITCHES - present == frozenset()


def planted(tree: Path, filename: str, source: str) -> list[str]:
    file = tree / filename
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(source, encoding="utf-8")
    return refusals_under(tree)


ENGINE = "better_answers_worker/redaction/engine.py"
LIBRARY_INIT = "better_answers_worker/__init__.py"


@pytest.mark.parametrize(
    ("why", "filename", "source"),
    [
        ("a subscript", ENGINE, 'import os\n\nKEK = os.environ["KEK"]\n'),
        ("a get", ENGINE, 'import os\n\nURL = os.environ.get("DATABASE_URL")\n'),
        ("a getenv", ENGINE, 'import os\n\nURL = os.getenv("DATABASE_URL")\n'),
        ("a copy of the whole map", ENGINE, "import os\n\nALL = dict(os.environ)\n"),
        ("a key chosen at run time", ENGINE, "import os\n\nREAD = os.environ[NAME]\n"),
        (
            "an aliased os",
            ENGINE,
            'import os as system\n\nKEK = system.environ["KEK"]\n',
        ),
        ("environ imported by name", ENGINE, "from os import environ\n"),
        (
            "getenv imported under another name",
            ENGINE,
            "from os import getenv as env\n",
        ),
        (
            "a write of a secret's name",
            ENGINE,
            'import os\n\nos.environ["KEK"] = "x"\n',
        ),
        (
            "a name the library switch does not set, in the file that sets one",
            LIBRARY_INIT,
            'import os\n\nos.environ["KEK"] = os.environ["ORT_DISABLE_TELEMETRY"]\n',
        ),
        (
            "the library switch, set in a file that does not own it",
            "better_answers_worker/pipeline/flow.py",
            'import os\n\nos.environ["ORT_DISABLE_TELEMETRY"] = "1"\n',
        ),
    ],
)
def test_refuses_a_planted_read_and_names_config(
    tmp_path: Path, why: str, filename: str, source: str
) -> None:
    refusals = planted(tmp_path, filename, source)

    assert refusals, why
    assert all(CONFIG_MODULE in refusal for refusal in refusals), why


@pytest.mark.parametrize(
    ("why", "filename", "source"),
    [
        (
            "the config module, which owns every read",
            CONFIG_MODULE,
            'from os import environ\n\nURL = environ.get("DATABASE_URL")\n',
        ),
        (
            "the telemetry switch, set where it is excused",
            LIBRARY_INIT,
            'import os\n\nos.environ["ORT_DISABLE_TELEMETRY"] = "1"\n',
        ),
        (
            "the log switch, read and set where it is excused",
            "better_answers_worker/pipeline/__init__.py",
            'import os\n\nos.environ["RUST_LOG"] = '
            'os.environ.get("RUST_LOG") or "warn"\n',
        ),
        ("os used for something else", ENGINE, "import os\n\nPID = os.getpid()\n"),
        (
            "an environ attribute of another object",
            ENGINE,
            "settings = object()\nENVIRONMENT = settings.environ\n",
        ),
    ],
)
def test_accepts_an_excused_read_and_other_use_of_os(
    tmp_path: Path, why: str, filename: str, source: str
) -> None:
    assert planted(tmp_path, filename, source) == [], why
