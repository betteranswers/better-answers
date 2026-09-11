"""The seam: one index run in, one outcome out, plain types both ways.

This is the line the rest of the tier is allowed to see. What a document is converted
into, what the detector found, how the redacted text is split and which columns a chunk
row carries all live beneath it, and none of the engine's types reach past it — which is
what makes the exit cost of the engine one directory rather than a rewrite (ADR 0036).

The outcome carries three figures and no content: how many documents the run saw, how
many chunks it landed, and how much disk the binding's store is using. The third is the
signal the cap is read against (ADR 0025), and the job row is where all three go.
"""

from dataclasses import dataclass
from typing import Any

from ..config import Bootstrap
from ..log import logger
from .host import Host, IndexRun


@dataclass(frozen=True, slots=True)
class IndexOutcome:
    """What one index run found, in the shape the job row carries."""

    documents: int
    chunks: int
    lmdb_bytes: int

    def as_row(self) -> dict[str, Any]:
        """The outcome as the job row holds it: counts and sizes, never content."""
        return {
            "documents": self.documents,
            "chunks": self.chunks,
            "lmdb_bytes": self.lmdb_bytes,
        }


def index_binding(bootstrap: Bootstrap, run: IndexRun) -> IndexOutcome:
    """Index one binding's landed copies, and say what the run did.

    The documents, the conversion, the detector and the chunk rows are the waves after
    this one; what is settled here is the shape every caller and every later step binds
    to — the run that goes in, the outcome that comes back, and the host that holds the
    stores between runs.
    """
    with Host(bootstrap) as host:
        host.open_binding(run)
        outcome = IndexOutcome(documents=0, chunks=0, lmdb_bytes=host.lmdb_bytes(run))
    logger.info(
        "the index run finished",
        binding_id=run.binding_id,
        reason=run.reason,
        **outcome.as_row(),
    )
    return outcome
