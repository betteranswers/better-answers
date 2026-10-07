from dataclasses import dataclass
from typing import Any

from .. import queue
from ..config import Bootstrap
from ..log import logger
from ..redaction.withholdings import overridden_in
from .catalogue import (
    read_connected_source,
    reconcile_catalogue,
    record_findings,
    unreadable_catalogue,
)
from .host import Host, Sync
from .landed import SEAM_MS_PER_PAGE, TIMEOUT_MARGIN_MS, redact_landed_copies
from .objects import Bucket, LandedCopies
from .rows import PASSAGE_TABLE, rows_of

WIPED_REASON = "wiped"

RULE_CHANGE_REASON = "rule-change"

# The store is the target-state tracking: rows the api deleted beside a store
# left standing are re-upserted by nothing, the engine believing them landed.
REASONS_EMPTYING_THE_CONNECTED_SOURCE = frozenset({WIPED_REASON, RULE_CHANGE_REASON})


@dataclass(frozen=True, slots=True)
class OverriddenRestore:
    document_id: str
    rule_id: str
    char_start: int
    char_end: int


@dataclass(frozen=True, slots=True)
class IndexOutcome:
    """`lmdb_bytes` is what the connected source's stores hold on disk after the sync;
    `restores_overridden_by_erasure` names restored spans an erasure withholds again."""

    documents: int
    passages: int
    lmdb_bytes: int

    restores_overridden_by_erasure: tuple[OverriddenRestore, ...] = ()

    def as_row(self) -> dict[str, Any]:
        return {
            "documents": self.documents,
            "passages": self.passages,
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


def index_connected_source(
    bootstrap: Bootstrap,
    sync: Sync,
    *,
    copies: LandedCopies | None = None,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> IndexOutcome:
    """Redacts the connected source's live documents, splits them into passages and
    lands the passage rows. A `wiped` or `rule-change` sync first empties the source's
    store; a source that is gone lands nothing. `copies` defaults to the workspace's
    bucket."""
    with Host(bootstrap) as host:
        if sync.reason in REASONS_EMPTYING_THE_CONNECTED_SOURCE:
            host.remove_connected_source_store(sync)
        store = copies or Bucket(bootstrap.object_store, sync.workspace_id)
        with queue.connected(bootstrap.database_url) as connection:
            with queue.scoped(connection, sync.workspace_id) as cursor:
                connected_source = read_connected_source(cursor, sync)
            if connected_source is None:
                logger.info(
                    "the sync found no connected source to index",
                    connected_source_id=sync.connected_source_id,
                    reason=sync.reason,
                )
                host.open_connected_source(sync)
                return _finished(IndexOutcome(0, 0, host.lmdb_bytes(sync)), sync)

            landed = redact_landed_copies(
                host,
                sync,
                connected_source.documents,
                store,
                connected_source.rules_in_force,
                sync.connected_source_id,
                ms_per_page=ms_per_page,
                margin_ms=margin_ms,
            )
            # A document's class must be on its row before any of its passages is read.
            with queue.scoped(connection, sync.workspace_id) as cursor:
                record_findings(cursor, sync, landed.documents)
                reconcile_catalogue(cursor, landed.documents)
                unreadable_catalogue(cursor, landed.unreadable)

            passages = host.land_rows(
                sync, PASSAGE_TABLE, rows_of(sync, landed.documents)
            )

        outcome = IndexOutcome(
            documents=len(landed.documents),
            passages=passages,
            lmdb_bytes=host.lmdb_bytes(sync),
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
    return _finished(outcome, sync)


def _finished(outcome: IndexOutcome, sync: Sync) -> IndexOutcome:
    logger.info(
        "the sync finished",
        connected_source_id=sync.connected_source_id,
        reason=sync.reason,
        **outcome.as_row(),
    )
    return outcome
