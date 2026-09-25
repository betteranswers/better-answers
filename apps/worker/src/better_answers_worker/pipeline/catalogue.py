from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from psycopg import Cursor

from ..ids import ulid
from ..redaction import Dismissal, Restore
from .host import IndexRun
from .landed import (
    LandedDocument,
    QuarantinedDocument,
    ReadDocument,
    Suppression,
    suppression_of,
)

CONVERTED_OUTCOME = "converted"
QUARANTINED_OUTCOME = "quarantined"


NORMALISED_KEY_SUFFIX = "normalised"


@dataclass(frozen=True, slots=True)
class BindingRun:
    rules_in_force: Mapping[str, bool]
    documents: tuple[LandedDocument, ...]


def read_binding(cursor: Cursor[Any], run: IndexRun) -> BindingRun | None:
    """None when the binding is gone. Only live documents are read, each carrying
    the workspace's suppressions and its own restored and dismissed findings."""
    cursor.execute(
        "SELECT rules_in_force FROM source_binding WHERE id = %s",
        (run.binding_id,),
    )
    binding = cursor.fetchone()
    if binding is None:
        return None

    cursor.execute(
        "SELECT id, media_type, original_key, normalised_key"
        " FROM source_document WHERE binding_id = %s AND gone_at IS NULL ORDER BY id",
        (run.binding_id,),
    )
    catalogued = cursor.fetchall()
    document_ids = [str(row[0]) for row in catalogued]
    suppressions = _suppressions_of_the_workspace(cursor, run.workspace_id)
    restores = _spans_by_document(cursor, document_ids, _RESTORED, Restore)
    dismissals = _spans_by_document(cursor, document_ids, _DISMISSED, Dismissal)

    return BindingRun(
        rules_in_force={str(tier): bool(state) for tier, state in binding[0].items()},
        documents=tuple(
            LandedDocument(
                source_document_id=str(row[0]),
                media_type=str(row[1]),
                original_key=str(row[2]),
                normalised_key=(
                    normalised_key_of(str(row[0])) if row[3] is None else str(row[3])
                ),
                suppressions=suppressions,
                restores=restores.get(str(row[0]), ()),
                dismissals=dismissals.get(str(row[0]), ()),
            )
            for row in catalogued
        ),
    )


def normalised_key_of(document_id: str) -> str:
    return f"documents/{document_id.lower()}/{NORMALISED_KEY_SUFFIX}"


def _suppressions_of_the_workspace(
    cursor: Cursor[Any], workspace_id: str
) -> tuple[Suppression, ...]:
    cursor.execute(
        "SELECT identifiers FROM suppression WHERE workspace_id = %s"
        " ORDER BY erasure_request_id",
        (workspace_id,),
    )
    return tuple(
        suppression_of(
            {
                str(kind): [str(value) for value in values]
                for kind, values in dict(identifiers).items()
            }
        )
        for (identifiers,) in cursor.fetchall()
    )


DISMISSED_REVIEW_STATE = "dismissed"

_RESTORED = "restored_at IS NOT NULL"
_DISMISSED = f"review_state = '{DISMISSED_REVIEW_STATE}'"


def _spans_by_document[Marked](
    cursor: Cursor[Any],
    document_ids: Sequence[str],
    marked: str,
    span: Callable[[str, int, int], Marked],
) -> Mapping[str, tuple[Marked, ...]]:
    if not document_ids:
        return {}
    cursor.execute(
        "SELECT document_id, rule_id, char_start, char_end FROM finding"
        f" WHERE document_id = ANY(%s) AND {marked}"
        " ORDER BY document_id, char_start, char_end, rule_id",
        (list(document_ids),),
    )
    gathered: dict[str, tuple[Marked, ...]] = {}
    for document_id, rule_id, char_start, char_end in cursor.fetchall():
        named = span(str(rule_id), int(char_start), int(char_end))
        gathered[str(document_id)] = (*gathered.get(str(document_id), ()), named)
    return gathered


def record_findings(
    cursor: Cursor[Any],
    run: IndexRun,
    documents: Sequence[ReadDocument],
    *,
    mint: Callable[[], str] = ulid,
) -> int:
    """Upserts a row per withholding and answers how many rows changed;
    a restored finding keeps its tier. `mint` makes each new row's id."""
    rows = [
        (
            run.workspace_id,
            mint(),
            document.source_document_id,
            withholding.finding.category,
            withholding.tier,
            withholding.finding.rule_id,
            withholding.finding.start,
            withholding.finding.end,
            withholding.finding.score,
            *_version_halves(document.redacted.version),
        )
        for document in documents
        for withholding in document.redacted.withholdings
    ]
    if not rows:
        return 0
    cursor.executemany(
        "INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,"
        " char_start, char_end, score, rule_version, detector_pin)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end)"
        " DO UPDATE SET category = EXCLUDED.category,"
        "   tier = CASE WHEN finding.restored_at IS NULL"
        "               THEN EXCLUDED.tier ELSE finding.tier END,"
        "   score = EXCLUDED.score,"
        "   rule_version = EXCLUDED.rule_version,"
        "   detector_pin = EXCLUDED.detector_pin"
        " WHERE (finding.category, finding.score,"
        "        finding.rule_version, finding.detector_pin)"
        "       IS DISTINCT FROM"
        "       (EXCLUDED.category, EXCLUDED.score,"
        "        EXCLUDED.rule_version, EXCLUDED.detector_pin)"
        "    OR (finding.restored_at IS NULL"
        "        AND finding.tier IS DISTINCT FROM EXCLUDED.tier)",
        rows,
    )
    return cursor.rowcount


def _version_halves(version: str) -> tuple[str, str]:
    rule_version, _, detector_pin = version.partition(":")
    return rule_version, detector_pin


def quarantine_catalogue(
    cursor: Cursor[Any], documents: Sequence[QuarantinedDocument]
) -> None:
    for document in documents:
        cursor.execute(
            "UPDATE source_document SET outcome = %(outcome)s,"
            " quarantine_error = %(error)s, last_seen = now() WHERE id = %(id)s",
            {
                "outcome": QUARANTINED_OUTCOME,
                "error": document.error,
                "id": document.source_document_id,
            },
        )


def reconcile_catalogue(cursor: Cursor[Any], documents: Sequence[ReadDocument]) -> None:
    """Marks each document converted with its hash, key and
    version. Its sensitivity only narrows, except that a
    lifted verdict returns it to the Admin's own narrowing."""
    for document in documents:
        cursor.execute(
            "UPDATE source_document SET content_hash = %(content_hash)s,"
            " normalised_key = %(normalised_key)s,"
            " redaction_version = %(version)s, outcome = %(outcome)s,"
            " quarantine_error = NULL,"
            " last_seen = now(),"
            # A verdict only narrows, by the database's ranking; a lifted one keeps the
            # Admin's own word, which the seam never made.
            " sensitivity = CASE"
            "   WHEN %(lifted)s THEN narrowed_to"
            "   WHEN sensitivity IS NULL THEN %(verdict)s::text"
            "   ELSE public.narrower_class(sensitivity, %(verdict)s::text) END"
            " WHERE id = %(id)s",
            {
                "content_hash": document.redacted.content_hash,
                "normalised_key": document.normalised_key,
                "version": document.redacted.version,
                "outcome": CONVERTED_OUTCOME,
                "verdict": document.redacted.verdict,
                "lifted": document.redacted.lifted,
                "id": document.source_document_id,
            },
        )
