"""What the engine finds in the process environment as it is imported (`T-204`).

The engine's core reads two variables from the process environment and offers no
setting on its API for either, and it reads both **once, as it is imported**. Probed on
20/09/2026 against cocoindex 1.0.22, one interpreter per arm.

`COCOINDEX_DISABLE_USAGE_TRACKING`: unset, the core calls `cocoindex.gateway.scarf.sh`
as it is imported and once per update after that. Through a proxy that logged every
host it was asked for and reached none: the variable set before the import, no call;
set straight after the import, after the Environment was opened or between two updates,
every call the arm with nothing set made.

`RUST_LOG`: what the core's own subscriber prints, in a shape that is not this tier's
JSON. Set to `trace` before the import, 135 lines from one update of an app that
declares nothing; set to `trace` after the import and before the Environment, none;
never set, none either — which is why the arms are `trace` and not `warn`, since an app
that writes nothing at the core's own level could not show a quieter one being read.

So a line anywhere downstream of the import sets a variable nothing will read again —
the host's constructor was the first seat tried for the gateway and the seat `RUST_LOG`
had always had. With the gateway's line there, the three pipeline suites run through
that proxy with nothing set reached for the gateway 93 times, the count `T-163`
recorded with no line at all. With both lines where they are now: 32 passed — `T-163`'s
33 less the host suite's case for the seat `RUST_LOG` no longer has — and nothing
reached for.

The deploy unit sets both for the worker it starts, and the image and the CI runner set
the gateway's for the processes they start (`T-163`). What is held here is the process
none of them started: this tier's gate on a laptop, one suite run by file, a mutation
run. The pipeline package sets both ahead of its own imports, and that is ahead of the
engine's by construction — a package runs before any module beneath it, and the
tier-wide ban keeps every import of the engine beneath that one package
(`tests/test_cocoindex_ban.py`).

The question is what a variable held at the moment the engine was first imported, and
this process imported it long ago, so each case asks an interpreter of its own.
"""

import json
import os
import subprocess
import sys

import pytest

from deploy_unit import worker_environment

USAGE_TRACKING = "COCOINDEX_DISABLE_USAGE_TRACKING"
CORE_LOG_LEVEL = "RUST_LOG"

#: A finder at the head of `sys.meta_path` is asked about every import before the real
#: finders are. This one answers none of them, and writes down what the two variables
#: held when the name it was asked about was the engine's.
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
    """What the two variables held when a fresh interpreter first imported the engine.

    The interpreter is given this process's environment without either variable, and
    then whatever the box under test says. An empty answer is an interpreter that
    imported the pipeline package and never reached for the engine at all; a variable
    nothing had set by then is absent from its answer.
    """
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
    # `json.loads` answers `Any`, so each value is narrowed as it is read.
    return [
        {str(name): str(value) for name, value in seen.items() if value is not None}
        for seen in json.loads(completed.stdout.strip().splitlines()[-1])
    ]


@pytest.mark.parametrize(
    ("why", "box"),
    [
        ("a process nothing configured, which is the laptop's", {}),
        # What the config module's own read of it did before the seat moved here: a
        # level set to nothing is a box that has said nothing, not one asking for none.
        ("a box that set the level to nothing", {CORE_LOG_LEVEL: ""}),
    ],
)
def test_a_process_nothing_configured_imports_the_engine_as_the_deploy_unit_would(
    why: str, box: dict[str, str]
) -> None:
    """Both values are the deploy unit's, read off the compose file rather than written
    here, so the package cannot come to disagree with what ships."""
    assert held_when_the_engine_was_imported(box) == [
        {
            USAGE_TRACKING: worker_environment(USAGE_TRACKING),
            CORE_LOG_LEVEL: worker_environment(CORE_LOG_LEVEL),
        }
    ], why


def test_a_box_that_says_otherwise_wins_on_the_level_and_never_on_the_gateway() -> None:
    """A louder `RUST_LOG` on the box is an operator reading the engine's own lines, and
    it reaches the engine because it was in the environment before anything ran. The
    gateway is not a level: one this tier calls is a sub-processor nobody named
    (ADR 0020), and that is no operator's to turn up.
    """
    assert held_when_the_engine_was_imported(
        {USAGE_TRACKING: "0", CORE_LOG_LEVEL: "debug"}
    ) == [{USAGE_TRACKING: worker_environment(USAGE_TRACKING), CORE_LOG_LEVEL: "debug"}]
