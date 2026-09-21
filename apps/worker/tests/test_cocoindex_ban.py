import json
import subprocess
import tomllib
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]


BANNED_API = "TID251"

AN_IMPORT_OF_COCOINDEX = "import cocoindex\n\nflow = cocoindex.flow\n"
A_NAME_TAKEN_OFF_COCOINDEX = "from cocoindex import flow\n\nFLOW = flow\n"
AN_IMPORT_THE_TIER_MAKES = "import structlog\n\nlogger = structlog.get_logger()\n"


THE_ONE_EXEMPT_PATTERN = "src/better_answers_worker/pipeline/**"


A_MODULE_OF_THE_PIPELINE_PACKAGE = "src/better_answers_worker/pipeline/flow.py"


def rules_fired_over(source: str, filename: str) -> list[str]:
    completed = subprocess.run(
        (
            "ruff",
            "check",
            "--no-cache",
            "--output-format",
            "json",
            "--stdin-filename",
            filename,
            "-",
        ),
        input=source,
        capture_output=True,
        text=True,
        cwd=WORKER_ROOT,
        check=False,
    )
    reported: list[dict[str, object]] = json.loads(completed.stdout)
    return sorted({str(item["code"]) for item in reported})


@pytest.mark.parametrize(
    ("why", "source", "filename"),
    [
        (
            "the module imported whole",
            AN_IMPORT_OF_COCOINDEX,
            "src/better_answers_worker/redaction/engine.py",
        ),
        (
            "one name taken off it",
            A_NAME_TAKEN_OFF_COCOINDEX,
            "src/better_answers_worker/redaction/engine.py",
        ),
        (
            "the tier's tests, which are part of the tier",
            AN_IMPORT_OF_COCOINDEX,
            "tests/test_redaction.py",
        ),
    ],
)
def test_refuses_an_import_of_cocoindex(why: str, source: str, filename: str) -> None:
    assert BANNED_API in rules_fired_over(source, filename), why


def test_leaves_an_import_the_tier_really_makes_alone() -> None:
    filename = "src/better_answers_worker/redaction/engine.py"

    assert rules_fired_over(AN_IMPORT_THE_TIER_MAKES, filename) == []


def paths_the_ban_is_lifted_for() -> list[str]:
    manifest = tomllib.loads((WORKER_ROOT / "pyproject.toml").read_text())
    ignores: dict[str, list[str]] = manifest["tool"]["ruff"]["lint"]["per-file-ignores"]
    return sorted(pattern for pattern, rules in ignores.items() if BANNED_API in rules)


def test_the_pipeline_package_may_compose_the_engine() -> None:
    fired = rules_fired_over(AN_IMPORT_OF_COCOINDEX, A_MODULE_OF_THE_PIPELINE_PACKAGE)

    assert BANNED_API not in fired


def test_the_pipeline_package_is_the_only_path_the_ban_is_lifted_for() -> None:

    assert paths_the_ban_is_lifted_for() == [THE_ONE_EXEMPT_PATTERN]
