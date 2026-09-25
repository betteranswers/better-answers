import json
import subprocess
from pathlib import Path

import pytest

MANIFEST = Path(__file__).resolve().parents[1] / "pyproject.toml"

A_REASON = "the loader imports it by name"


def rules_fired_over(tree: Path, source: str) -> list[str]:
    probe = tree / "probe.py"
    probe.write_text(source, encoding="utf-8")
    completed = subprocess.run(
        (
            "ruff",
            "check",
            "--no-cache",
            "--config",
            str(MANIFEST),
            "--output-format",
            "json",
            str(probe),
        ),
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode in {0, 1}, completed.stderr
    reported: list[dict[str, object]] = json.loads(completed.stdout)
    return sorted({str(item["code"]) for item in reported})


@pytest.mark.parametrize(
    ("what", "source", "rule"),
    [
        ("a blanket noqa", "import os  # noqa\n", "PGH004"),
        ("a blanket type: ignore", 'KEEP: int = "one"  # type: ignore\n', "PGH003"),
        ("a noqa that suppresses nothing", "KEEP = 1  # noqa: E501\n", "RUF100"),
        ("a FIXME", "# FIXME: read the limit from the config\nKEEP = 1\n", "FIX001"),
        ("a TODO", "# TODO: read the limit from the config\nKEEP = 1\n", "FIX002"),
        ("an XXX", "# XXX: read the limit from the config\nKEEP = 1\n", "FIX003"),
        ("a HACK", "# HACK: read the limit from the config\nKEEP = 1\n", "FIX004"),
    ],
)
def test_ruff_refuses_a_blanket_directive_and_a_deferred_task(
    tmp_path: Path, what: str, source: str, rule: str
) -> None:
    assert rule in rules_fired_over(tmp_path, source), what


@pytest.mark.parametrize(
    ("what", "source"),
    [
        ("a noqa naming its rule", f"import os  # noqa: F401  # {A_REASON}\n"),
        (
            "a type: ignore naming its code",
            f'KEEP: int = "one"  # type: ignore[assignment]  # {A_REASON}\n',
        ),
        ("a comment giving a reason", f"# {A_REASON}\nKEEP = 1\n"),
    ],
)
def test_ruff_accepts_a_directive_naming_what_it_suppresses(
    tmp_path: Path, what: str, source: str
) -> None:
    assert rules_fired_over(tmp_path, source) == [], what
