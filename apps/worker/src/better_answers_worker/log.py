"""The tier's one structured logger: JSON to stdout, `print` banned.

**And the bridge that keeps it one.** The libraries this tier hosts log through the
standard library — the indexing engine's Postgres connector does, and so does anything
beneath it — and a standard-library record goes to stdout in its own plain-text shape
with no timestamp this tier chose and no level word it uses. Two shapes on one stream is
a log an operator has to parse twice, so every record that reaches the root logger is
rendered through the same processors this module's own lines take and leaves as the same
JSON object.

The tier's own logger keeps writing directly rather than being routed through the
standard library: what the bridge is for is the records this tier did not write, and
sending ours the long way round would put a second set of defaults between a line and
stdout for no gain.

The engine's *core* is a third case and is not a Python logger at all: it installs its
own subscriber inside its Rust runtime and reads `RUST_LOG` to decide what to print. The
deploy unit sets that variable and the pipeline's host sets it too.
"""

import logging
import sys

import structlog

#: What every record carries before it is rendered, whoever wrote it. The bridge below
#: runs these over a standard-library record so that a line from a library and a line
#: from this tier are the same object with the same keys.
SHARED = (
    structlog.contextvars.merge_contextvars,
    structlog.processors.add_log_level,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
)

structlog.configure(
    processors=[*SHARED, structlog.processors.JSONRenderer()],
)


def bridge_standard_library() -> None:
    """Send every standard-library record out as this tier's own JSON.

    The root logger's handlers are replaced rather than added to: the point is that one
    shape leaves the process, and a library that called `basicConfig` first would
    otherwise keep its own handler beside this one and print every record twice.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=list(SHARED),
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.JSONRenderer(),
            ],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


bridge_standard_library()

logger = structlog.get_logger()
