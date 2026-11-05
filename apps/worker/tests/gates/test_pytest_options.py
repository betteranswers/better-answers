import tomllib

import test_image
from better_answers_worker.check import CI_RUNNER_VCPUS, IMAGES, SUITE
from support.roots import WORKER_ROOT


def pytest_options() -> dict[str, object]:
    text = (WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    tool = tomllib.loads(text)["tool"]
    assert isinstance(tool, dict), "pyproject.toml has no [tool] table"
    pytest_table = tool["pytest"]
    assert isinstance(pytest_table, dict), "pyproject.toml has no [tool.pytest] table"
    options = pytest_table["ini_options"]
    assert isinstance(options, dict), "[tool.pytest.ini_options] is missing"
    return options


def test_pytest_refuses_an_undeclared_marker() -> None:
    addopts = pytest_options()["addopts"]
    assert isinstance(addopts, str)
    assert "--strict-markers" in addopts.split()


def test_fails_an_expected_failure_that_has_started_passing() -> None:
    assert pytest_options()["xfail_strict"] is True


def test_only_the_gate_command_runs_tests_in_parallel_workers() -> None:
    addopts = pytest_options()["addopts"]
    assert isinstance(addopts, str)
    _, command = SUITE

    assert command[command.index("-n") + 1] == str(CI_RUNNER_VCPUS), (
        "the gate does not pass -n CI_RUNNER_VCPUS. Do not use -n auto, "
        "because it ran slower on a larger machine"
    )
    assert not {"-n", "--numprocesses"} & set(addopts.split())


def test_the_gate_runs_each_xdist_group_in_one_worker() -> None:
    _, command = SUITE

    assert command[command.index("--dist") + 1] == "loadgroup"


def test_image_tests_run_in_the_images_command_not_the_gate() -> None:
    _, gate = SUITE
    _, images = IMAGES

    assert test_image.pytestmark.name == "image"
    assert gate[gate.index("-m") + 1] == "not image"
    assert images[images.index("-m") + 1] == "image"
