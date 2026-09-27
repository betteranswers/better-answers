import tomllib
from pathlib import Path

import test_image
from better_answers_worker.check import SUITE

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


def test_only_the_gate_spreads_the_suite_over_workers() -> None:
    addopts = pytest_options()["addopts"]
    assert isinstance(addopts, str)
    _, command = SUITE

    assert "-n" in command
    assert not {"-n", "--numprocesses"} & set(addopts.split())


def test_the_image_builds_in_one_worker_of_the_gates_run() -> None:
    _, command = SUITE

    assert command[command.index("--dist") + 1] == "loadgroup"
    assert test_image.pytestmark.name == "xdist_group"
