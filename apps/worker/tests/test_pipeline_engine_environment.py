import json
import os
import subprocess
import sys

import pytest

from deploy_unit import worker_environment

USAGE_TRACKING = "COCOINDEX_DISABLE_USAGE_TRACKING"
CORE_LOG_LEVEL = "RUST_LOG"


WATCH_THE_ENGINES_IMPORT = f"""
import importlib.abc
import json
import os
import sys

watched = ("{USAGE_TRACKING}", "{CORE_LOG_LEVEL}")
held = []


class Watch(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "cocoindex":
            held.append({{v: os.environ.get(v) for v in watched}})
        return None


sys.meta_path.insert(0, Watch())

import better_answers_worker.pipeline

print(json.dumps(held[:1]))
"""


def held_when_the_engine_was_imported(box: dict[str, str]) -> list[dict[str, str]]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if name not in (USAGE_TRACKING, CORE_LOG_LEVEL)
    } | box
    completed = subprocess.run(
        (sys.executable, "-c", WATCH_THE_ENGINES_IMPORT),
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )

    return [
        {str(name): str(value) for name, value in seen.items() if value is not None}
        for seen in json.loads(completed.stdout.strip().splitlines()[-1])
    ]


@pytest.mark.parametrize(
    ("why", "box"),
    [
        ("a process nothing configured, which is the laptop's", {}),
        ("a box that set the level to nothing", {CORE_LOG_LEVEL: ""}),
    ],
)
def test_a_process_nothing_configured_imports_the_engine_as_the_deploy_unit_would(
    why: str, box: dict[str, str]
) -> None:
    assert held_when_the_engine_was_imported(box) == [
        {
            USAGE_TRACKING: worker_environment(USAGE_TRACKING),
            CORE_LOG_LEVEL: worker_environment(CORE_LOG_LEVEL),
        }
    ], why


def test_a_box_that_says_otherwise_wins_on_the_level_and_never_on_the_gateway() -> None:
    assert held_when_the_engine_was_imported(
        {USAGE_TRACKING: "0", CORE_LOG_LEVEL: "debug"}
    ) == [{USAGE_TRACKING: worker_environment(USAGE_TRACKING), CORE_LOG_LEVEL: "debug"}]
