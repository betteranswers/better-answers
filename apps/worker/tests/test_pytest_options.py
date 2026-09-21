import tomllib
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]


def pytest_options() -> dict[str, object]:
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
