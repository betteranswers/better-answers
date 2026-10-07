from collections.abc import Mapping, Sequence
from typing import Any

from .host import Sync
from .landed import ReadDocument
from .tables import Column, Table

PASSAGE_TABLE = Table(
    schema="index",
    name="passage",
    columns=(
        Column(name="id", pg_type="text", nullable=False),
        Column(name="workspace_id", pg_type="text", nullable=False),
        Column(name="content", pg_type="text", nullable=False),
        Column(name="connected_source_id", pg_type="text", nullable=False),
        Column(name="source_document_id", pg_type="text"),
        Column(name="locator", pg_type="text"),
        Column(name="ordinal", pg_type="integer"),
        Column(name="char_start", pg_type="integer"),
        Column(name="char_end", pg_type="integer"),
    ),
    primary_key=("workspace_id", "id"),
)


def passage_rows(sync: Sync, document: ReadDocument) -> tuple[Mapping[str, Any], ...]:
    return tuple(
        {
            "id": passage.id,
            "workspace_id": sync.workspace_id,
            "content": passage.content,
            "connected_source_id": sync.connected_source_id,
            "source_document_id": document.source_document_id,
            "locator": passage.locator,
            "ordinal": passage.ordinal,
            "char_start": passage.char_start,
            "char_end": passage.char_end,
        }
        for passage in document.passages
    )


def rows_of(
    sync: Sync, documents: Sequence[ReadDocument]
) -> tuple[Mapping[str, Any], ...]:
    return tuple(row for document in documents for row in passage_rows(sync, document))
