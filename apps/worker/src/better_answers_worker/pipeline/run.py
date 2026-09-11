"""The seam: one index run in, one outcome out, plain types both ways.

This is the line the rest of the tier is allowed to see. What a document is converted
into, what the detector found, how the redacted text is split and which columns a chunk
row carries all live beneath it, and none of the engine's types reach past it — which is
what makes the exit cost of the engine one directory rather than a rewrite (ADR 0036).

The outcome carries three figures and no content: how many documents the run saw, how
many chunks it landed, and how much disk the binding's store is using. The third is the
signal the cap is read against (ADR 0025), and the job row is where all three go.

**The order of a run, and why it is that order.**

1. *The wipe, if this run is one.* The app deletes the binding's chunk rows in its own
   transaction and enqueues the job; the worker removes the binding's directory, and it
   does so **before anything opens it** — a directory removed under an open handle
   leaves the engine writing into a store nothing can read. So this is the first
   statement of the run and not a step inside it (ADR 0036's amendment).
2. *The read.* The binding's rules in force and permission fields, the documents it
   yielded, and the suppressions standing over each of them, in one scoped transaction
   of this tier's own. The seam takes all three as arguments and reads no row itself.
3. *The conversion.* One component per document, the memoised function beneath each, the
   original read before it and the normalised copy written after it.
4. *The rows.* Every span of every document read, with the visibility folded per
   document, declared against the chunk index — which is also how a span that no longer
   exists leaves it, because the engine converges the table to what this run declared.
5. *The records and the re-copy*, in a second scoped transaction: the findings, the
   catalogue rows, and last of all the visibility of every row the run wrote, re-read
   from the binding and the document as they now stand.

**Two connections and neither is the other's.** The reads and the records run on this
tier's psycopg connection inside transactions scoped to the workspace; the engine's rows
land on its own pooled connections, outside any transaction this tier opened, carrying
the workspace as a session setting. Mixing them is the failure mode the host's docblock
is about.
"""

from dataclasses import dataclass
from typing import Any

from .. import queue
from ..config import Bootstrap
from ..log import logger
from .catalogue import (
    read_binding,
    reconcile_catalogue,
    recopy_visibility,
    record_findings,
)
from .host import Host, IndexRun
from .landed import redact_landed_copies
from .objects import Bucket, LandedCopies
from .rows import CHUNK_TABLE, rows_of

#: The one reason that empties the binding's store before the run reads anything. The
#: five words a job may carry are the queue's, declared on the job kind's descriptor;
#: this is the only one this module has to behave differently for.
WIPED_REASON = "wiped"


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


def index_binding(
    bootstrap: Bootstrap, run: IndexRun, *, copies: LandedCopies | None = None
) -> IndexOutcome:
    """Index one binding's landed copies, and say what the run did.

    `copies` is the estate's object store, and it is a parameter because it is the one
    external service this run reaches: a suite replaces it behind this interface and
    everything else it drives is the code that ships. Left unsaid, the run opens the
    platform's own bucket from the bootstrap the deploy unit gave the process.

    **The seed a name's pseudonym is drawn from is the binding's id.** The seam takes a
    per-binding seed so that one person is written as the same letter throughout a
    binding and as a different letter in the next one, and the binding's own id is
    exactly that: a value the run already holds, stable for the binding's life, and
    different for every other binding in the estate.
    """
    with Host(bootstrap) as host:
        if run.reason == WIPED_REASON:
            host.remove_binding_directory(run)
        store = copies or Bucket(bootstrap.object_store, run.workspace_id)
        with queue.connected(bootstrap.database_url) as connection:
            with queue.scoped(connection, run.workspace_id) as cursor:
                binding = read_binding(cursor, run)
            if binding is None:
                logger.info(
                    "the index run found no binding to index",
                    binding_id=run.binding_id,
                    reason=run.reason,
                )
                host.open_binding(run)
                return _finished(IndexOutcome(0, 0, host.lmdb_bytes(run)), run)

            landed = redact_landed_copies(
                host,
                run,
                binding.documents,
                store,
                binding.rules_in_force,
                run.binding_id,
            )
            rows = rows_of(run, landed.documents, binding.visibility_of)
            chunks = host.land_rows(run, CHUNK_TABLE, rows)

            with queue.scoped(connection, run.workspace_id) as cursor:
                record_findings(cursor, run, landed.documents)
                reconcile_catalogue(cursor, landed.documents)
                recopy_visibility(cursor, run, [str(row["id"]) for row in rows])

        outcome = IndexOutcome(
            documents=len(landed.documents),
            chunks=chunks,
            lmdb_bytes=host.lmdb_bytes(run),
        )
    return _finished(outcome, run)


def _finished(outcome: IndexOutcome, run: IndexRun) -> IndexOutcome:
    logger.info(
        "the index run finished",
        binding_id=run.binding_id,
        reason=run.reason,
        **outcome.as_row(),
    )
    return outcome
