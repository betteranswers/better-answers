import json
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]
WORKER_CONFIG = WORKER_ROOT / "pyproject.toml"
DEVTOOLS_CONFIG = WORKER_ROOT.parents[1] / "packages/devtools/python/ruff.toml"

RULE = "C901"

OFF_THE_LIST = "src/better_answers_worker/probe.py"


def of_complexity(complexity: int) -> str:
    branches = "".join(
        f"    if value == {index}:\n        return {index}\n"
        for index in range(complexity - 1)
    )
    return f"def decide(value: int) -> int:\n{branches}    return -1\n"


def listed() -> list[str]:
    manifest = tomllib.loads(WORKER_CONFIG.read_text())
    ignores: dict[str, list[str]] = manifest["tool"]["ruff"]["lint"]["per-file-ignores"]
    return sorted(pattern for pattern, rules in ignores.items() if RULE in rules)


def rules_fired_over(
    tree: Path, config: Path, files: dict[str, str]
) -> dict[str, list[str]]:
    root = tree.resolve()
    shutil.copy(config, root / config.name)
    for relative, source in files.items():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(source, encoding="utf-8")
    completed = subprocess.run(
        ("ruff", "check", "--no-cache", "--output-format", "json", *files),
        capture_output=True,
        text=True,
        cwd=root,
        check=False,
    )
    assert completed.returncode in {0, 1}, completed.stderr
    reported: list[dict[str, object]] = json.loads(completed.stdout)
    fired: dict[str, set[str]] = {relative: set() for relative in files}
    for item in reported:
        fired[Path(str(item["filename"])).relative_to(root).as_posix()].add(
            str(item["code"])
        )
    return {relative: sorted(codes) for relative, codes in fired.items()}


@pytest.mark.parametrize(
    ("config", "file"),
    [
        (WORKER_CONFIG, OFF_THE_LIST),
        (WORKER_CONFIG, "tests/test_probe.py"),
        (DEVTOOLS_CONFIG, "probe.py"),
    ],
)
def test_ruff_refuses_a_function_of_nine_off_the_list(
    tmp_path: Path, config: Path, file: str
) -> None:
    fired = rules_fired_over(tmp_path, config, {file: of_complexity(9)})

    assert fired[file] == [RULE]


@pytest.mark.parametrize(
    ("config", "file"),
    [(WORKER_CONFIG, OFF_THE_LIST), (DEVTOOLS_CONFIG, "probe.py")],
)
def test_ruff_accepts_a_function_of_eight(
    tmp_path: Path, config: Path, file: str
) -> None:
    fired = rules_fired_over(tmp_path, config, {file: of_complexity(8)})

    assert fired[file] == []


def test_ruff_accepts_a_function_of_nine_in_a_listed_file(tmp_path: Path) -> None:
    on_the_list = listed()
    assert on_the_list, "the baseline list is empty: delete this case with it"

    fired = rules_fired_over(
        tmp_path, WORKER_CONFIG, {on_the_list[0]: of_complexity(9)}
    )

    assert fired[on_the_list[0]] == []


def test_the_list_names_only_files_the_tree_still_has() -> None:
    gone = [file for file in listed() if not (WORKER_ROOT / file).is_file()]

    assert gone == [], "a listed file was moved or deleted: drop it from the list"


def test_the_list_names_only_files_still_over_the_cap(tmp_path: Path) -> None:
    kept = [file for file in listed() if (WORKER_ROOT / file).is_file()]
    moved = {
        f"unlisted/{file}": (WORKER_ROOT / file).read_text(encoding="utf-8")
        for file in kept
    }

    fired = rules_fired_over(tmp_path, WORKER_CONFIG, moved)

    under_the_cap = [file for file, codes in fired.items() if RULE not in codes]
    assert under_the_cap == [], (
        "a listed file is under the cap now: drop it from the list"
    )
