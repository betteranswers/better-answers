import json
import subprocess
import sys
from typing import Any

WRITES_BOTH_WAYS = """
import logging
from better_answers_worker.log import logger

logger.info("the tier wrote this", binding_id="binding-one")
logging.getLogger("cocoindex.connectors.postgres").warning("a library wrote this")
"""


def lines_of(script: str) -> list[dict[str, Any]]:
    # A child process and not a captured stream: logging is global, so a captured buffer
    # would read pytest's own handlers rather than the tier's.
    finished = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    assert finished.stderr == "", finished.stderr
    return [json.loads(line) for line in finished.stdout.splitlines() if line.strip()]


def test_a_library_line_and_a_worker_line_leave_as_the_same_json_object() -> None:
    written = lines_of(WRITES_BOTH_WAYS)

    assert len(written) == 2
    ours, theirs = written

    assert ours["event"] == "the tier wrote this"
    assert ours["level"] == "info"
    assert ours["binding_id"] == "binding-one"

    assert theirs["event"] == "a library wrote this"
    assert theirs["level"] == "warning"

    assert sorted(theirs) == ["event", "level", "timestamp"]
    assert ours["timestamp"].endswith("Z")
    assert theirs["timestamp"].endswith("Z")


def test_a_library_that_configured_its_own_handler_first_still_prints_once() -> None:
    written = lines_of(
        "import logging\n"
        "logging.basicConfig(level=logging.INFO)\n"
        "import better_answers_worker.log\n"
        'logging.getLogger("cocoindex").warning("a library wrote this")\n'
    )

    assert len(written) == 1
    assert written[0]["event"] == "a library wrote this"
