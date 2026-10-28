import json
import os
import subprocess
import sys
from collections.abc import Mapping

THE_DETECTORS_DOOR = "presidio_analyzer"


THE_DETECTORS_STACK = (THE_DETECTORS_DOOR, "spacy", "torch")


ANSWERS_WHAT_IS_LOADED = """
import json
import sys

{ran}

print(json.dumps(sorted(n for n in {stack!r} if n in sys.modules)))
"""


def stack_loaded_by(
    ran: str, environment: Mapping[str, str] | None = None
) -> list[str]:
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
        env=environment,
    )
    answered: list[str] = json.loads(finished.stdout.splitlines()[-1])
    return answered


def test_importing_the_work_loop_loads_none_of_the_detectors_stack() -> None:
    assert stack_loaded_by("import better_answers_worker.loop") == []


def test_reading_the_detection_key_loads_the_stack() -> None:
    loaded = stack_loaded_by(
        "import better_answers_worker.loop\n"
        "from better_answers_worker.redaction.detection_key import detection_key\n"
        "detection_key()"
    )

    assert THE_DETECTORS_DOOR in loaded


BOOT_THAT_CANNOT_CONNECT = """
import psycopg
from better_answers_worker.loop import serve

try:
    serve(once={once})
except psycopg.OperationalError:
    pass
"""

UNREACHABLE_DATABASE = {
    **os.environ,
    "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/unreachable",
    "GIT_STORE_DIR": "unused",
    "LMDB_DIR": "unused",
    "S3_ENDPOINT": "unused",
    "S3_ACCESS_KEY": "unused",
    "S3_SECRET_KEY": "unused",
    "S3_BUCKET": "unused",
    "S3_REGION": "unused",
    "WORKER_ID": "worker-under-test",
}


def test_the_daemons_boot_warm_up_loads_the_detectors_stack() -> None:
    loaded = stack_loaded_by(
        BOOT_THAT_CANNOT_CONNECT.format(once=False), UNREACHABLE_DATABASE
    )

    assert THE_DETECTORS_DOOR in loaded


def test_a_once_pass_loads_none_of_the_detectors_stack() -> None:
    assert (
        stack_loaded_by(
            BOOT_THAT_CANNOT_CONNECT.format(once=True), UNREACHABLE_DATABASE
        )
        == []
    )
