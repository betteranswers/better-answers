"""What a run reads out of Postgres before it starts, and writes back when it ends.

Every statement here runs on **this tier's own psycopg connection**, inside a
transaction scoped to one workspace (`queue.scoped`), and never on a connection the
engine holds. The two are deliberately different roads: the engine's target takes its
own pooled connections and runs bare upserts on them outside any transaction this tier
opened, which is why those carry the workspace scope as a session setting — and the rows
below are read and written in transactions of the run's own, where the scope is
transaction-local as it is everywhere else in this tier.

**The run reads three things and writes three.** It reads the binding's rules in force
and its three permission fields, the documents the binding yielded, and the suppressions
standing over each of them; it writes the findings the seam raised, the catalogue row
each document's run reconciled, and — last of all — the visibility of every row it
landed.

**The last statement is the one with a race in it.** The app rewrites a chunk row's
visibility on a publish and on either narrowing, in the act's own transaction, and the
run writes the same four columns when it lands the row. Both copy from one source — the
binding, narrowed by the document — so they disagree only in a race: a run that read the
binding before a narrowing committed and upserted its rows after it.
`recopy_visibility` settles that by re-reading both rows as they now stand, in one
statement, after the flow
has returned and before the job finishes; a narrowing that lands after it finds the rows
and rewrites them itself.

**What each grant is for.** The binding and the catalogue are SELECT and the catalogue
is also UPDATE, because the hash, the normalised copy's key, the version, the outcome
word and the last-seen stamp are a run's own findings (migration 0035). The suppression
is SELECT alone (migration 0036). The finding is INSERT alone (migration 0024): the
detector runs here and the review of what it found is an Admin's act, so a run records a
span it withheld and can neither read the table back nor mark one reviewed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from psycopg import Cursor

from ..ids import ulid
from .host import IndexRun
from .landed import LandedDocument, ReadDocument, Suppression, suppression_of
from .rows import SENSITIVITY_ORDER, Visibility

#: The word a run writes on a document it converted. The other word the column admits —
#: *quarantined* — is written by the ticket that can name which document failed and why;
#: a run has no way to learn either, so it writes nothing at all on a document it did
#: not read rather than a word it would be guessing at.
CONVERTED_OUTCOME = "converted"

#: How the normalised copy's key is derived when the catalogue row does not carry one
#: yet. The column is null until a run has converted the document, and the shape is the
#: bind act's — the original's key with its last segment replaced — so the two copies of
#: one document sit beside each other under the workspace's prefix.
NORMALISED_KEY_SUFFIX = "normalised"


@dataclass(frozen=True, slots=True)
class BindingRun:
    """Everything a run needs about its binding, read in one scoped transaction."""

    #: The binding's own three permission fields and its publish stamp, before any
    #: document's class is folded in.
    visibility: Visibility
    #: Which switchable tiers this binding withholds under — the column's value, taken
    #: as an argument by the seam, which never reads the binding itself.
    rules_in_force: Mapping[str, bool]
    documents: tuple[LandedDocument, ...]
    #: Each document's own class, or nothing where it has none. Held beside the
    #: documents rather than on them, because it is the fold's business and not the
    #: converter's.
    own_class: Mapping[str, str | None]

    def visibility_of(self, document_id: str) -> Visibility:
        """The binding's fields with this document's own class folded into the class."""
        return self.visibility.narrowed_by(self.own_class.get(document_id))


def read_binding(cursor: Cursor[Any], run: IndexRun) -> BindingRun | None:
    """The binding, its documents and the sets standing over them — or nothing.

    Nothing when the binding has gone: a withdrawal takes its documents with it and the
    job that was enqueued for it may still be on the queue, so a run that found no row
    answers an empty run rather than refusing. The documents a run reads are the ones
    the source still has — a row marked gone is one a later run found missing at the
    source, and its rows are removed by the act that marked it rather than re-cut here.
    """
    cursor.execute(
        "SELECT published_at, sensitivity, audience, audience_groups, rules_in_force"
        " FROM source_binding WHERE id = %s",
        (run.binding_id,),
    )
    binding = cursor.fetchone()
    if binding is None:
        return None
    groups = binding[3]

    cursor.execute(
        "SELECT id, media_type, original_key, normalised_key, sensitivity"
        " FROM source_document WHERE binding_id = %s AND gone_at IS NULL ORDER BY id",
        (run.binding_id,),
    )
    catalogued = cursor.fetchall()
    suppressions = _suppressions_by_document(
        cursor, [str(row[0]) for row in catalogued]
    )

    return BindingRun(
        visibility=Visibility(
            published_at=binding[0],
            sensitivity=str(binding[1]),
            audience=str(binding[2]),
            audience_groups=None
            if groups is None
            else tuple(str(one) for one in groups),
        ),
        rules_in_force={str(tier): bool(state) for tier, state in binding[4].items()},
        documents=tuple(
            LandedDocument(
                source_document_id=str(row[0]),
                media_type=str(row[1]),
                original_key=str(row[2]),
                normalised_key=(
                    normalised_key_of(str(row[0])) if row[3] is None else str(row[3])
                ),
                suppressions=suppressions.get(str(row[0]), ()),
            )
            for row in catalogued
        ),
        own_class={
            str(row[0]): None if row[4] is None else str(row[4]) for row in catalogued
        },
    )


def normalised_key_of(document_id: str) -> str:
    """Where a run writes one document's normalised redacted text.

    Derived rather than read, because the column holds nothing until a run has converted
    the document once — so the first run of a binding has to know where to put the copy,
    and every run after it finds the key it wrote.
    """
    return f"documents/{document_id.lower()}/{NORMALISED_KEY_SUFFIX}"


def _suppressions_by_document(
    cursor: Cursor[Any], document_ids: Sequence[str]
) -> Mapping[str, tuple[Suppression, ...]]:
    """Every set standing over each of these documents, oldest request first.

    Read from the table rather than carried on the job row: a set on the row would be an
    erased person's identifiers written into a queue row that outlives the run and
    readable by anything that may read a job. The order is the request's id, so two runs
    over an unchanged document build the same memo key.
    """
    if not document_ids:
        return {}
    cursor.execute(
        "SELECT document_id, identifiers FROM suppression WHERE document_id = ANY(%s)"
        " ORDER BY document_id, erasure_request_id",
        (list(document_ids),),
    )
    gathered: dict[str, tuple[Suppression, ...]] = {}
    for document_id, identifiers in cursor.fetchall():
        named = suppression_of(
            {
                str(kind): [str(value) for value in values]
                for kind, values in dict(identifiers).items()
            }
        )
        gathered[str(document_id)] = (*gathered.get(str(document_id), ()), named)
    return gathered


def record_findings(
    cursor: Cursor[Any], run: IndexRun, documents: Sequence[ReadDocument]
) -> int:
    """Write every span the seam withheld, as the rows an Admin will review.

    A finding is a location and never a quotation — the category, the tier, the rule
    that raised it, the span in code points into the text the seam was **given**, the
    score and the two halves of the version string — which is what makes it safe to keep
    for as long as the document lives and nothing an erasure has to rewrite.

    The id is minted here, as the self-scheduled audit's job id is: the app's own
    boundary holds this column to the shape the platform mints, so a derived id would be
    a row no restore act could ever name.
    """
    rows = [
        (
            run.workspace_id,
            ulid(),
            document.source_document_id,
            finding.category,
            finding.tier,
            finding.rule_id,
            finding.start,
            finding.end,
            finding.score,
            *_version_halves(document.redacted.version),
        )
        for document in documents
        for finding in document.redacted.findings
    ]
    if not rows:
        return 0
    cursor.executemany(
        "INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,"
        " char_start, char_end, score, rule_version, detector_pin)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
    )
    return len(rows)


def _version_halves(version: str) -> tuple[str, str]:
    """The version string as its two columns hold it, split at its one colon.

    Neither half may hold a colon or whitespace (`redaction/pins.py`), which is what
    lets either tier split it once from whichever end it likes and land in the same
    place.
    """
    rule_version, _, detector_pin = version.partition(":")
    return rule_version, detector_pin


def reconcile_catalogue(cursor: Cursor[Any], documents: Sequence[ReadDocument]) -> None:
    """Write back what the run found about each document it read.

    The hash is over the normalised text **before** the seam ran, which is the fact a
    later run compares against to answer *unchanged*; a hash holds no value, so it is
    safe on a row a screen opens. The class the seam's verdict names is folded rather
    than written: the column can only ever take visibility away, so a verdict wider than
    the class already standing leaves it where it is — the same rule the chunk row's
    fold takes, stated in the statement because the row it folds against is the one this
    statement is reading.

    A document the run did not read is not named here at all, and its row keeps every
    null the bind act left on it.
    """
    for document in documents:
        cursor.execute(
            "UPDATE source_document SET content_hash = %(content_hash)s,"
            " normalised_key = %(normalised_key)s,"
            " redaction_version = %(version)s, outcome = %(outcome)s,"
            " last_seen = now(),"
            # The verdict is cast at every mention because a run that narrowed nothing
            # binds null here, and a bare null parameter is a parameter Postgres has no
            # way to type.
            " sensitivity = CASE"
            "   WHEN %(verdict)s::text IS NULL THEN sensitivity"
            "   WHEN sensitivity IS NULL THEN %(verdict)s::text"
            "   WHEN array_position(%(order)s::text[], %(verdict)s::text)"
            "      < array_position(%(order)s::text[], sensitivity)"
            "     THEN %(verdict)s::text"
            "   ELSE sensitivity END"
            " WHERE id = %(id)s",
            {
                "content_hash": document.redacted.content_hash,
                "normalised_key": document.normalised_key,
                "version": document.redacted.version,
                "outcome": CONVERTED_OUTCOME,
                "verdict": document.redacted.verdict,
                "order": list(SENSITIVITY_ORDER),
                "id": document.source_document_id,
            },
        )


def recopy_visibility(
    cursor: Cursor[Any], run: IndexRun, chunk_ids: Sequence[str]
) -> int:
    """The run's last statement: the four permission fields, as they now stand.

    One statement and not a read then a write, because the whole point of it is to see
    the binding and the document at this instant — a run that read them into Python and
    wrote what it read would have the same race it is here to settle, one statement
    further on.

    Aimed at the rows this run wrote and at nothing else: a statement that took every
    row of the binding would rewrite rows another document's run had just landed, and
    one that took every row of the workspace would reach a neighbouring binding's.
    """
    if not chunk_ids:
        return 0
    cursor.execute(
        'UPDATE "index".chunk AS chunk SET published_at = binding.published_at,'
        " audience = binding.audience, audience_groups = binding.audience_groups,"
        " sensitivity = CASE"
        "   WHEN document.sensitivity IS NULL THEN binding.sensitivity"
        "   WHEN array_position(%(order)s::text[], document.sensitivity)"
        "      < array_position(%(order)s::text[], binding.sensitivity)"
        "     THEN document.sensitivity"
        "   ELSE binding.sensitivity END"
        " FROM source_binding AS binding, source_document AS document"
        " WHERE chunk.id = ANY(%(ids)s)"
        " AND binding.workspace_id = chunk.workspace_id"
        " AND binding.id = chunk.binding_id"
        " AND document.workspace_id = chunk.workspace_id"
        " AND document.id = chunk.source_document_id",
        {"order": list(SENSITIVITY_ORDER), "ids": list(chunk_ids)},
    )
    return cursor.rowcount
