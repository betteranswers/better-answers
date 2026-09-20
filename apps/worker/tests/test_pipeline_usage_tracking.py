"""The engine's usage gateway, refused before the engine is imported (`T-204`).

The engine's core calls `cocoindex.gateway.scarf.sh` as it is imported and once per
update after that, unless it found `COCOINDEX_DISABLE_USAGE_TRACKING` in the process
environment — and it looks **once, as it is imported**. Probed on 20/09/2026 against
cocoindex 1.0.22, one interpreter per arm through a proxy that logged every host it was
asked for and reached none: the variable set before the import, no call; set straight
after the import, after the Environment was opened or between two updates, every call
the arm with nothing set made. So a line anywhere downstream of the import sets a
variable nothing will read again — the host's constructor was the first seat tried, and
the three pipeline suites run through that proxy with nothing set reached for the
gateway 93 times with the line there, the count `T-163` recorded with no line at all.
With the line where it is now: 33 passed, and nothing reached for.

The image, the deploy unit and the CI runner each set it for the processes they start
(`T-163`). What is held here is the process none of them started: this tier's gate on a
laptop, one suite run by file, a mutation run. The pipeline package sets the variable
ahead of its own imports, and that is ahead of the engine's by construction — a package
runs before any module beneath it, and the tier-wide ban keeps every import of the
engine beneath that one package (`tests/test_cocoindex_ban.py`).

The question is what the variable held at the moment the engine was first imported, and
this process imported it long ago, so each case asks an interpreter of its own.
"""

import json
import os
import subprocess
import sys

import pytest

from deploy_unit import worker_environment

VARIABLE = "COCOINDEX_DISABLE_USAGE_TRACKING"

#: A finder at the head of `sys.meta_path` is asked about every import before the real
#: finders are. This one answers none of them, and writes down what the variable held
#: when the name it was asked about was the engine's.
WATCH_THE_ENGINES_IMPORT = f"""
import importlib.abc
import json
import os
import sys

held = []


class Watch(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "cocoindex":
            held.append(os.environ.get("{VARIABLE}"))
        return None


sys.meta_path.insert(0, Watch())

import better_answers_worker.pipeline

print(json.dumps(held[:1]))
"""


def held_when_the_engine_was_imported(box: dict[str, str]) -> list[str | None]:
    """What the variable held when a fresh interpreter first imported the engine.

    The interpreter is given this process's environment without the variable, and then
    whatever the box under test says. An empty answer is an interpreter that imported
    the pipeline package and never reached for the engine at all.
    """
    environment = {
        name: value for name, value in os.environ.items() if name != VARIABLE
    } | box
    completed = subprocess.run(
        (sys.executable, "-c", WATCH_THE_ENGINES_IMPORT),
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    # `json.loads` answers `Any`, so each item is narrowed as it is read.
    return [
        None if item is None else str(item)
        for item in json.loads(completed.stdout.strip().splitlines()[-1])
    ]


@pytest.mark.parametrize(
    ("why", "box"),
    [
        ("a process nothing configured, which is the laptop's", {}),
        # Unlike `RUST_LOG` a box that says otherwise does not win: a gateway this tier
        # calls is a sub-processor nobody named (ADR 0020), and that is no operator's
        # level to turn up.
        ("a box that said otherwise", {VARIABLE: "0"}),
    ],
)
def test_the_engine_is_imported_with_its_gateway_already_refused(
    why: str, box: dict[str, str]
) -> None:
    """The value is the deploy unit's, read off the compose file rather than written
    here, so the package cannot come to disagree with what ships."""
    assert held_when_the_engine_was_imported(box) == [worker_environment(VARIABLE)], why
