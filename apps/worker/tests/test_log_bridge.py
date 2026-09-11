"""One JSON shape leaves this process, whoever wrote the line (`[TEST1]`, `[TEST9]`).

Driven in a child process rather than with a captured stream, because logging is global
state: pytest installs handlers of its own on the root logger and a case that asserted
against a captured buffer would be reading pytest's arrangement instead of the tier's.
A child that imports the module and writes two lines is the process a deploy unit runs.
"""

import json
import subprocess
import sys
from typing import Any

#: Two lines, written the two ways a line reaches stdout in this tier: through the
#: tier's own logger, and through the standard library, which is how the libraries this
#: tier hosts log — the indexing engine's Postgres connector among them.
WRITES_BOTH_WAYS = """
import logging
from better_answers_worker.log import logger

logger.info("the tier wrote this", binding_id="binding-one")
logging.getLogger("cocoindex.connectors.postgres").warning("a library wrote this")
"""


def lines_of(script: str) -> list[dict[str, Any]]:
    # The interpreter running this suite, given a script this module spelled out.
    finished = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    assert finished.stderr == "", finished.stderr
    return [json.loads(line) for line in finished.stdout.splitlines() if line.strip()]


def test_a_library_line_and_a_worker_line_leave_as_the_same_json_object() -> None:
    """Both carry the tier's keys — the message under `event`, the level as a word and
    an ISO timestamp — so one parser reads the stream and an operator greps one shape.
    """
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
    """`basicConfig` is what a library calls when it wants a handler, and a root logger
    carrying two would print every record twice — once as this tier's JSON and once as
    somebody's plain text. The bridge replaces the root's handlers rather than joining
    them, so the stream stays one shape and one line per record.
    """
    written = lines_of(
        "import logging\n"
        "logging.basicConfig(level=logging.INFO)\n"
        "import better_answers_worker.log\n"
        'logging.getLogger("cocoindex").warning("a library wrote this")\n'
    )

    assert len(written) == 1
    assert written[0]["event"] == "a library wrote this"
