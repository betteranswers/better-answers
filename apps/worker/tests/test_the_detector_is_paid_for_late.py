import json
import subprocess
import sys

THE_DETECTORS_DOOR = "presidio_analyzer"


THE_DETECTORS_STACK = (THE_DETECTORS_DOOR, "spacy", "torch")


ANSWERS_WHAT_IS_LOADED = """
import json
import sys

{ran}

print(json.dumps(sorted(n for n in {stack!r} if n in sys.modules)))
"""


def stack_loaded_by(ran: str) -> list[str]:
    # A child process: pytest has the whole stack loaded before the first test runs, so
    # a `sys.modules` read in this one proves nothing.
    finished = subprocess.run(
        [
            sys.executable,
            "-c",
            ANSWERS_WHAT_IS_LOADED.format(ran=ran, stack=THE_DETECTORS_STACK),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    answered: list[str] = json.loads(finished.stdout.splitlines()[-1])
    return answered


def test_importing_the_work_loop_loads_none_of_the_detectors_stack() -> None:
    assert stack_loaded_by("import better_answers_worker.loop") == []


def test_a_pass_that_reads_the_detection_key_loads_the_stack_then() -> None:
    loaded = stack_loaded_by(
        "import better_answers_worker.loop\n"
        "from better_answers_worker.redaction.detection_key import detection_key\n"
        "detection_key()"
    )

    assert THE_DETECTORS_DOOR in loaded


def test_the_daemons_boot_warm_up_loads_the_detectors_stack() -> None:
    loaded = stack_loaded_by(
        "from better_answers_worker.loop import warm_the_detectors_stack\n"
        "warm_the_detectors_stack('worker-under-test')"
    )

    assert THE_DETECTORS_DOOR in loaded
