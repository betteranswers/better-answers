import json
import subprocess
import tomllib

import pytest

from support.roots import WORKER_ROOT

BANNED_API = "TID251"

IMPORTS_COCOINDEX_MODULE = "import cocoindex\n\nflow = cocoindex.flow\n"
IMPORTS_A_NAME_FROM_COCOINDEX = "from cocoindex import flow\n\nFLOW = flow\n"
IMPORTS_STRUCTLOG = "import structlog\n\nlogger = structlog.get_logger()\n"


PIPELINE_PACKAGE_PATTERN = "src/better_answers_worker/pipeline/**"


PIPELINE_MODULE = "src/better_answers_worker/pipeline/flow.py"


def ruff_codes_for(source: str, filename: str) -> list[str]:
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
            IMPORTS_COCOINDEX_MODULE,
            "src/better_answers_worker/redaction/engine.py",
        ),
        (
            "one name taken off it",
            IMPORTS_A_NAME_FROM_COCOINDEX,
            "src/better_answers_worker/redaction/engine.py",
        ),
        (
            "the tier's tests, which are part of the tier",
            IMPORTS_COCOINDEX_MODULE,
            "tests/test_redaction.py",
        ),
    ],
)
def test_refuses_an_import_of_cocoindex(why: str, source: str, filename: str) -> None:
    assert BANNED_API in ruff_codes_for(source, filename), why


def test_accepts_an_import_of_another_library() -> None:
    filename = "src/better_answers_worker/redaction/engine.py"

    assert ruff_codes_for(IMPORTS_STRUCTLOG, filename) == []


def paths_exempt_from_the_ban() -> list[str]:
    manifest = tomllib.loads((WORKER_ROOT / "pyproject.toml").read_text())
    ignores: dict[str, list[str]] = manifest["tool"]["ruff"]["lint"]["per-file-ignores"]
    return sorted(pattern for pattern, rules in ignores.items() if BANNED_API in rules)


def test_the_pipeline_package_may_import_cocoindex() -> None:
    fired = ruff_codes_for(IMPORTS_COCOINDEX_MODULE, PIPELINE_MODULE)

    assert BANNED_API not in fired


def test_only_the_pipeline_package_is_exempt_from_the_ban() -> None:

    assert paths_exempt_from_the_ban() == [PIPELINE_PACKAGE_PATTERN]
