"""The cocoindex ban, proved by running the tier's ruff rather than reading its config.

A ban nobody has run is a convention, not a rule — the reading
``tests/test_monkeypatch_guard.py`` takes of the `unittest.mock` ban beside it — so
this suite runs the tier's own configuration over a file that makes the import and
over one that makes an import the tier really makes.

The redaction seam takes plain types and returns plain types (`[PIPE1]`), so a
cocoindex type reaching into it would make it a function only cocoindex could call.
The ban is the whole tier's, which is what forces the one module allowed to compose
the engine to declare itself: the pipeline package lifts the ban for its own directory
by a per-file ignore (ADR 0036).

Both readings are held (`[TEST7]`), and there are now two pairs. The ban: the import is
refused wherever else in the tier it is written, and an import the tier really makes is
left alone — a ban that refused everything would pass the first half and mean nothing.
The exception: a module beneath the pipeline package may compose the engine, and that
package is the *only* path the tier's configuration lifts the rule for — a second
exemption, or one widened past the pipeline directory, is what the second pair refuses,
because a ban more than one directory can lift is not a ban.
"""

import json
import subprocess
import tomllib
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]

#: Ruff's own name for a banned-api hit, which is what the tier's entry is written as.
BANNED_API = "TID251"

AN_IMPORT_OF_COCOINDEX = "import cocoindex\n\nflow = cocoindex.flow\n"
A_NAME_TAKEN_OFF_COCOINDEX = "from cocoindex import flow\n\nFLOW = flow\n"
AN_IMPORT_THE_TIER_MAKES = "import structlog\n\nlogger = structlog.get_logger()\n"

#: The one path the tier's configuration lifts the ban for, written down here as well as
#: in `pyproject.toml` so the exemption cannot widen, move or gain a sibling without
#: this file saying so (`[TEST9]`).
THE_ONE_EXEMPT_PATTERN = "src/better_answers_worker/pipeline/**"

#: A module inside that package — where composing the engine is the whole point.
A_MODULE_OF_THE_PIPELINE_PACKAGE = "src/better_answers_worker/pipeline/flow.py"


def rules_fired_over(source: str, filename: str) -> list[str]:
    """Every rule the tier's ruff reports over one file's text, read as ruff's own JSON.

    The text arrives on stdin under the name it would have on disk, because where a
    file sits is what decides which per-file ignore reaches it.
    """
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
    """Every per-file ignore in the tier's configuration that lifts the banned-api rule.

    Read out of the manifest rather than off ruff's behaviour, because the question this
    answers is how many doors exist, and a door nobody knocked on is still a door.
    """
    manifest = tomllib.loads((WORKER_ROOT / "pyproject.toml").read_text())
    ignores: dict[str, list[str]] = manifest["tool"]["ruff"]["lint"]["per-file-ignores"]
    return sorted(pattern for pattern, rules in ignores.items() if BANNED_API in rules)


def test_the_pipeline_package_may_compose_the_engine() -> None:
    fired = rules_fired_over(AN_IMPORT_OF_COCOINDEX, A_MODULE_OF_THE_PIPELINE_PACKAGE)

    assert BANNED_API not in fired


def test_the_pipeline_package_is_the_only_path_the_ban_is_lifted_for() -> None:
    # The other direction of the pair the exception makes (`[TEST7]`): the test above
    # would pass just as well with the whole of `src` exempted, and this is the half
    # that would not.
    assert paths_the_ban_is_lifted_for() == [THE_ONE_EXEMPT_PATTERN]
