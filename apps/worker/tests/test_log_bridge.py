import json
import subprocess
import sys
from typing import Any

LOGS_FROM_THE_WORKER_AND_A_LIBRARY = """
import logging
from better_answers_worker.log import logger

logger.info("the tier wrote this", connected_source_id="connected-source-one")
logging.getLogger("cocoindex.connectors.postgres").warning("a library wrote this")
"""


def json_lines_logged_by(script: str) -> list[dict[str, Any]]:
    # Run in a child process because logging is global, and a captured stream would
    # read pytest's handlers instead of the worker's.
    finished = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    assert finished.stderr == "", finished.stderr
    return [json.loads(line) for line in finished.stdout.splitlines() if line.strip()]


def test_library_and_worker_logs_use_the_same_json_format() -> None:
    written = json_lines_logged_by(LOGS_FROM_THE_WORKER_AND_A_LIBRARY)

    assert len(written) == 2
    worker_line, library_line = written

    assert worker_line["event"] == "the tier wrote this"
    assert worker_line["level"] == "info"
    assert worker_line["connected_source_id"] == "connected-source-one"

    assert library_line["event"] == "a library wrote this"
    assert library_line["level"] == "warning"

    assert sorted(library_line) == ["event", "level", "timestamp"]
    assert worker_line["timestamp"].endswith("Z")
    assert library_line["timestamp"].endswith("Z")


def test_a_library_log_prints_once_after_logging_basicconfig_runs() -> None:
    written = json_lines_logged_by(
        "import logging\n"
        "logging.basicConfig(level=logging.INFO)\n"
        "import better_answers_worker.log\n"
        'logging.getLogger("cocoindex").warning("a library wrote this")\n'
    )

    assert len(written) == 1
    assert written[0]["event"] == "a library wrote this"
