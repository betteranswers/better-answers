"""The chunk index as a run writes it: the table, and the row cut from each span.

**The table is one the app created and this tier never touches the shape of.** Every
column below is a column `packages/schema/src/index-tables.ts` declares and the journal
built (ADR 0007); the engine is told the shape so it can write rows into it and for no
other reason, and the transition it resolves for a user-managed target is nothing at
all.
Two columns of the table are deliberately absent from the list: the full-text vector,
which the database computes from the content and a writer must never set, and the
embedding with the route that made it, which is the reserve block's and stays null
until then (ADR 0020, amended 2026-09-09).

**A chunk's address is not derived here.** The id, the ordinal, the span and the wire
locator all come off `chunks.py`, which is this tier's half of the `document-chunk`
agreement; what this module adds is the four columns that say *where the row came from
and who may read it* — the workspace, the binding, the document, and the three
permission fields.

**The class is a fold and the audience is a copy** (ADR 0031's visibility-columns
agreement, ADR 0023, ADR 0039). A document may carry a class of its own: null is the
ordinary case and means *the binding's*, and a word there is the seam's special-category
verdict or an Admin's narrowing. The fold takes the narrower of the two, so the column
can only ever take visibility away — a document's own class never widens its binding's.
The audience word, its group ids and the publish stamp travel from the binding
unchanged, because a document has no audience of its own.

The copy is not a cache: the read predicate runs in SQL against the row, so the row has
to carry the answer. Which is also why the run's last statement re-copies these four
from the rows as they stand at the end (`catalogue.py`) — a narrowing that landed
mid-run wins.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .host import IndexRun
from .landed import ReadDocument
from .tables import Column, Table

#: The chunk index, as a run declares it. The types are the ones the worker's generated
#: schema view reads back off the migrated database, so a column that changed type there
#: and not here is a disagreement the drift test sees before a run does.
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

#: The class words from the narrowest outwards — the order the fold reads and the order
#: `contracts/visibility-columns/cases.json` writes down as its own rank. Stated here
#: because SQL cannot import a constant and the re-copy's statement takes this list as a
#: parameter, so the one place the order is written is the one place it can be changed;
#: the agreement's Python half holds the two equal.
SENSITIVITY_ORDER = ("Restricted", "Internal", "Public")


@dataclass(frozen=True, slots=True)
class Visibility:
    """The four fields that decide who may read a row, as a binding holds them."""

    published_at: datetime | None
    sensitivity: str
    audience: str
    audience_groups: tuple[str, ...] | None

    def narrowed_by(self, own_class: str | None) -> "Visibility":
        """The same fields with the document's own class folded into the class.

        Null is a fact and not a gap: it says the binding decides, which is what lets a
        binding's narrowing reach every document under it without touching one of them.
        A word wider than the binding's is ignored rather than refused — this column is
        the *narrowing* one, and an Admin who wants a wider document widens the binding.
        """
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
        """The four as a chunk row carries them, the group ids as the array wants."""
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
    """Every row one document's redacted text becomes, ready for the engine.

    The rows of one document and not of the run, because the visibility is folded per
    document and a run that folded once for a binding would give a narrowed document's
    spans its binding's word.
    """
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
    """Every row this run lands, in the order its documents were read.

    The fold is asked for per document rather than handed in as a mapping, because what
    the caller holds is the binding's fields and each document's own class, and the fold
    between the two belongs to this module.
    """
    return tuple(
        row
        for document in documents
        for row in chunk_rows(run, document, visibility_of(document.source_document_id))
    )
