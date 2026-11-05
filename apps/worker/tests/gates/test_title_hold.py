import os
import shutil
import subprocess
import sys

import pytest

from support.roots import WORKER_ROOT

CONFTEST = WORKER_ROOT / "tests" / "conftest.py"

ELEVEN = "_".join(f"word{index}" for index in range(1, 12))

TEN = "_".join(f"word{index}" for index in range(1, 11))

NINE = "_".join(f"word{index}" for index in range(1, 10))

SAMPLE_SUITE = f"""
import pytest


def test_{ELEVEN}() -> None:
    pass


def test_{TEN}() -> None:
    pass


@pytest.mark.parametrize("row", ["one_two_three"])
def test_{NINE}_row(row: str) -> None:
    pass


def test_refuses_what_it_should_not() -> None:
    pass
"""


@pytest.fixture(name="pytest_output", scope="module")
def run_pytest_on_the_sample_suite(tmp_path_factory: pytest.TempPathFactory) -> str:
    tree = tmp_path_factory.mktemp("titles")
    shutil.copy(CONFTEST, tree / "conftest.py")
    (tree / "test_titles.py").write_text(SAMPLE_SUITE, encoding="utf-8")
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-rA", "-p", "no:cacheprovider", str(tree)],
        capture_output=True,
        text=True,
        cwd=tree,
        check=False,
        # pytest's short summary cuts a test id to the terminal's width.
        env={**os.environ, "COLUMNS": "400"},
    )
    return run.stdout


def test_an_eleven_word_name_errors_on_its_own_test(
    pytest_output: str,
) -> None:
    assert f"ERROR test_titles.py::test_{ELEVEN} - Failed" in pytest_output
    assert f'never "should": `test_{ELEVEN}` runs to 11' in pytest_output


def test_passes_a_ten_word_name(pytest_output: str) -> None:
    assert f"PASSED test_titles.py::test_{TEN}\n" in pytest_output


def test_counts_a_parametrized_name_without_its_parameter_id(
    pytest_output: str,
) -> None:
    assert f"PASSED test_titles.py::test_{NINE}_row[one_two_three]" in pytest_output


def test_reports_a_name_with_the_forbidden_word_as_an_error(pytest_output: str) -> None:
    assert "ERROR test_titles.py::test_refuses_what_it_should_not" in pytest_output
