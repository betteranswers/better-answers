from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
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
        Column(name="published_at", pg_type="timestamp with time zone"),
        Column(name="sensitivity", pg_type="text", nullable=False),
        Column(name="audience", pg_type="text", nullable=False),
        Column(name="audience_groups", pg_type="text[]"),
        Column(name="binding_id", pg_type="text", nullable=False),
        Column(name="source_document_id", pg_type="text"),
        Column(name="locator", pg_type="text"),
        Column(name="ordinal", pg_type="integer"),
        Column(name="char_start", pg_type="integer"),
        Column(name="char_end", pg_type="integer"),
    ),
    primary_key=("workspace_id", "id"),
)


SENSITIVITY_ORDER = ("Restricted", "Internal", "Public")


@dataclass(frozen=True, slots=True)
class Visibility:
    published_at: datetime | None
    sensitivity: str
    audience: str
    audience_groups: tuple[str, ...] | None

    def narrowed_by(self, own_class: str | None) -> "Visibility":
        if own_class is None or own_class not in SENSITIVITY_ORDER:
            return self
        if SENSITIVITY_ORDER.index(own_class) >= SENSITIVITY_ORDER.index(
            self.sensitivity
        ):
            return self
        return Visibility(
            published_at=self.published_at,
            sensitivity=own_class,
            audience=self.audience,
            audience_groups=self.audience_groups,
        )

    def as_columns(self) -> Mapping[str, Any]:
        return {
            "published_at": self.published_at,
            "sensitivity": self.sensitivity,
            "audience": self.audience,
            "audience_groups": (
                None if self.audience_groups is None else list(self.audience_groups)
            ),
        }


def chunk_rows(
    run: IndexRun, document: ReadDocument, visibility: Visibility
) -> tuple[Mapping[str, Any], ...]:
    columns = visibility.as_columns()
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
            **columns,
        }
        for chunk in document.chunks
    )


def rows_of(
    run: IndexRun,
    documents: Sequence[ReadDocument],
    visibility_of: Callable[[str], Visibility],
) -> tuple[Mapping[str, Any], ...]:
    return tuple(
        row
        for document in documents
        for row in chunk_rows(run, document, visibility_of(document.source_document_id))
    )
