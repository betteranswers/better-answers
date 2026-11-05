import json
import os
import subprocess
import sys
from collections.abc import Mapping

PRESIDIO_ANALYZER = "presidio_analyzer"


DETECTOR_MODULES = (PRESIDIO_ANALYZER, "spacy", "torch")


PRINT_LOADED_DETECTOR_MODULES = """
import json
import sys

{ran}

print(json.dumps(sorted(n for n in {stack!r} if n in sys.modules)))
"""


def detector_modules_loaded_by(
    ran: str, environment: Mapping[str, str] | None = None
) -> list[str]:
    # Runs in a child process because pytest loads presidio, spacy and torch before
    # the first test, so `sys.modules` here would always contain them.
    finished = subprocess.run(
        [
            sys.executable,
            "-c",
            PRINT_LOADED_DETECTOR_MODULES.format(ran=ran, stack=DETECTOR_MODULES),
        ],
        capture_output=True,
        text=True,
        check=True,
        env=environment,
    )
    loaded: list[str] = json.loads(finished.stdout.splitlines()[-1])
    return loaded


def test_importing_the_work_loop_loads_no_detector_modules() -> None:
    assert detector_modules_loaded_by("import better_answers_worker.loop") == []


def test_reading_the_detection_key_loads_presidio() -> None:
    loaded = detector_modules_loaded_by(
        "import better_answers_worker.loop\n"
        "from better_answers_worker.redaction.detection_key import detection_key\n"
        "detection_key()"
    )

    assert PRESIDIO_ANALYZER in loaded


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


def test_the_daemons_boot_warm_up_loads_presidio() -> None:
    loaded = detector_modules_loaded_by(
        BOOT_THAT_CANNOT_CONNECT.format(once=False), UNREACHABLE_DATABASE
    )

    assert PRESIDIO_ANALYZER in loaded


def test_serve_once_loads_no_detector_modules() -> None:
    assert (
        detector_modules_loaded_by(
            BOOT_THAT_CANNOT_CONNECT.format(once=True), UNREACHABLE_DATABASE
        )
        == []
    )
