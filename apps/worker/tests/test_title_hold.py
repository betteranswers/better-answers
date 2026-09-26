import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

CONFTEST = Path(__file__).with_name("conftest.py")

# In two halves, so the tag scan does not read a fixture as a citation.
TAG = "[" + "TEST5]"

ELEVEN = "_".join(f"word{index}" for index in range(1, 12))

TEN = "_".join(f"word{index}" for index in range(1, 11))

NINE = "_".join(f"word{index}" for index in range(1, 10))

SUITE = f"""
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


@pytest.fixture(name="outcomes", scope="module")
def run_over_a_tree(tmp_path_factory: pytest.TempPathFactory) -> str:
    tree = tmp_path_factory.mktemp("titles")
    shutil.copy(CONFTEST, tree / "conftest.py")
    (tree / "test_titles.py").write_text(SUITE, encoding="utf-8")
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-rA", "-p", "no:cacheprovider", str(tree)],
        capture_output=True,
        text=True,
        cwd=tree,
        check=False,
        # Wide, or the summary cuts a long test id short.
        env={**os.environ, "COLUMNS": "400"},
    )
    return run.stdout


def test_errors_an_eleven_word_name_under_its_own_name(outcomes: str) -> None:
    assert f"ERROR test_titles.py::test_{ELEVEN} - Failed" in outcomes
    assert f"{TAG}: `test_{ELEVEN}` runs to 11" in outcomes


def test_passes_a_ten_word_name(outcomes: str) -> None:
    assert f"PASSED test_titles.py::test_{TEN}\n" in outcomes


def test_counts_a_parametrized_name_without_its_row(outcomes: str) -> None:
    assert f"PASSED test_titles.py::test_{NINE}_row[one_two_three]" in outcomes


def test_errors_a_name_holding_the_forbidden_word(outcomes: str) -> None:
    assert "ERROR test_titles.py::test_refuses_what_it_should_not" in outcomes
