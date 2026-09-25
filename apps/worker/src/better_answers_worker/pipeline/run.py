from dataclasses import dataclass
from typing import Any

from .. import queue
from ..config import Bootstrap
from ..log import logger
from ..redaction.withholdings import overridden_in
from .catalogue import (
    quarantine_catalogue,
    read_binding,
    reconcile_catalogue,
    record_findings,
)
from .host import Host, IndexRun
from .landed import SEAM_MS_PER_PAGE, TIMEOUT_MARGIN_MS, redact_landed_copies
from .objects import Bucket, LandedCopies
from .rows import CHUNK_TABLE, rows_of

WIPED_REASON = "wiped"

RULE_CHANGE_REASON = "rule-change"

# The store is the target-state tracking: rows the api deleted beside a store
# left standing are re-upserted by nothing, the engine believing them landed.
REASONS_EMPTYING_THE_BINDING = frozenset({WIPED_REASON, RULE_CHANGE_REASON})


@dataclass(frozen=True, slots=True)
class OverriddenRestore:
    document_id: str
    rule_id: str
    char_start: int
    char_end: int


@dataclass(frozen=True, slots=True)
class IndexOutcome:
    """`lmdb_bytes` is what the binding's stores hold on disk after the run;
    `restores_overridden_by_erasure` names restored spans an erasure withholds again."""

    documents: int
    chunks: int
    lmdb_bytes: int

    restores_overridden_by_erasure: tuple[OverriddenRestore, ...] = ()

    def as_row(self) -> dict[str, Any]:
        return {
            "documents": self.documents,
            "chunks": self.chunks,
            "lmdb_bytes": self.lmdb_bytes,
            "restores_overridden_by_erasure": [
                {
                    "document_id": span.document_id,
                    "rule_id": span.rule_id,
                    "char_start": span.char_start,
                    "char_end": span.char_end,
                }
                for span in self.restores_overridden_by_erasure
            ],
        }


def index_binding(
    bootstrap: Bootstrap,
    run: IndexRun,
    *,
    copies: LandedCopies | None = None,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> IndexOutcome:
    """Redacts and chunks the binding's live documents and lands their chunk rows.
    A `wiped` or `rule-change` run first empties the binding's store; a binding
    that is gone lands nothing. `copies` defaults to the workspace's bucket."""
    with Host(bootstrap) as host:
        if run.reason in REASONS_EMPTYING_THE_BINDING:
            host.remove_binding_store(run)
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
                ms_per_page=ms_per_page,
                margin_ms=margin_ms,
            )
            # A document's class must be on its row before any chunk of it can be read.
            with queue.scoped(connection, run.workspace_id) as cursor:
                record_findings(cursor, run, landed.documents)
                reconcile_catalogue(cursor, landed.documents)
                quarantine_catalogue(cursor, landed.quarantined)

            chunks = host.land_rows(run, CHUNK_TABLE, rows_of(run, landed.documents))

        outcome = IndexOutcome(
            documents=len(landed.documents),
            chunks=chunks,
            lmdb_bytes=host.lmdb_bytes(run),
            restores_overridden_by_erasure=tuple(
                OverriddenRestore(
                    document_id=document.source_document_id,
                    rule_id=finding.rule_id,
                    char_start=finding.start,
                    char_end=finding.end,
                )
                for document in landed.documents
                for finding in overridden_in(document.redacted.withholdings)
            ),
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
