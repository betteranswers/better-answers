from collections.abc import Mapping, Sequence
from typing import Any

from .host import IndexRun
from .landed import ReadDocument
from .tables import Column, Table

CHUNK_TABLE = Table(
    schema="index",
    name="chunk",
    columns=(
        Column(name="id", pg_type="text", nullable=False),
        Column(name="workspace_id", pg_type="text", nullable=False),
        Column(name="content", pg_type="text", nullable=False),
        Column(name="binding_id", pg_type="text", nullable=False),
        Column(name="source_document_id", pg_type="text"),
        Column(name="locator", pg_type="text"),
        Column(name="ordinal", pg_type="integer"),
        Column(name="char_start", pg_type="integer"),
        Column(name="char_end", pg_type="integer"),
    ),
    primary_key=("workspace_id", "id"),
)


def chunk_rows(run: IndexRun, document: ReadDocument) -> tuple[Mapping[str, Any], ...]:
    return tuple(
        {
            "id": chunk.id,
            "workspace_id": run.workspace_id,
            "content": chunk.content,
            "binding_id": run.binding_id,
            "source_document_id": document.source_document_id,
            "locator": chunk.locator,
            "ordinal": chunk.ordinal,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
        }
        for chunk in document.chunks
    )


def rows_of(
    run: IndexRun, documents: Sequence[ReadDocument]
) -> tuple[Mapping[str, Any], ...]:
    return tuple(row for document in documents for row in chunk_rows(run, document))
