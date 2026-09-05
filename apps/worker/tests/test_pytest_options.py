"""pytest's own options, read as values (`[CHECK2]`).

Two of pytest's defaults let a suite report success for running less than it claims. A
marker the suite never declared is a typo that silently marks nothing —
`@pytest.mark.slwo` skips no test and fails no run. And an expected failure that passes
is a bug that was fixed and an `xfail` that outlived it, reported as `xpass` and counted
as success.

Both are settings rather than behaviour, so the seam is the manifest. Prior art in the
other tier: `apps/api/tests/check-scripts.test.ts`.
"""

import tomllib
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]


def pytest_options() -> dict[str, object]:
    """The `[tool.pytest.ini_options]` table, as pytest itself reads it."""
    text = (WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    tool = tomllib.loads(text)["tool"]
    assert isinstance(tool, dict), "pyproject.toml has no [tool] table"
    pytest_table = tool["pytest"]
    assert isinstance(pytest_table, dict), "pyproject.toml has no [tool.pytest] table"
    options = pytest_table["ini_options"]
    assert isinstance(options, dict), "[tool.pytest.ini_options] is missing"
    return options


def test_refuses_a_marker_the_suite_never_declared() -> None:
    addopts = pytest_options()["addopts"]
    assert isinstance(addopts, str)
    assert "--strict-markers" in addopts.split()


def test_fails_an_expected_failure_that_has_started_passing() -> None:
    assert pytest_options()["xfail_strict"] is True
