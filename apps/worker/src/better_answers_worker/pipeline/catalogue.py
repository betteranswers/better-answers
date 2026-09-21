from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from psycopg import Cursor

from ..ids import ulid
from ..redaction import Restore
from .host import IndexRun
from .landed import (
    LandedDocument,
    QuarantinedDocument,
    ReadDocument,
    Suppression,
    suppression_of,
)
from .rows import SENSITIVITY_ORDER, Visibility

CONVERTED_OUTCOME = "converted"
QUARANTINED_OUTCOME = "quarantined"


NORMALISED_KEY_SUFFIX = "normalised"


@dataclass(frozen=True, slots=True)
class BindingRun:
    visibility: Visibility

    rules_in_force: Mapping[str, bool]
    documents: tuple[LandedDocument, ...]

    own_class: Mapping[str, str | None]

    def visibility_of(self, document_id: str) -> Visibility:
        return self.visibility.narrowed_by(self.own_class.get(document_id))


def read_binding(cursor: Cursor[Any], run: IndexRun) -> BindingRun | None:
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
    document_ids = [str(row[0]) for row in catalogued]
    suppressions = _suppressions_by_document(cursor, document_ids)
    restores = _restores_by_document(cursor, document_ids)

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
                restores=restores.get(str(row[0]), ()),
            )
            for row in catalogued
        ),
        own_class={
            str(row[0]): None if row[4] is None else str(row[4]) for row in catalogued
        },
    )


def normalised_key_of(document_id: str) -> str:
    return f"documents/{document_id.lower()}/{NORMALISED_KEY_SUFFIX}"


def _suppressions_by_document(
    cursor: Cursor[Any], document_ids: Sequence[str]
) -> Mapping[str, tuple[Suppression, ...]]:
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


def _restores_by_document(
    cursor: Cursor[Any], document_ids: Sequence[str]
) -> Mapping[str, tuple[Restore, ...]]:
    if not document_ids:
        return {}
    cursor.execute(
        "SELECT document_id, rule_id, char_start, char_end FROM finding"
        " WHERE document_id = ANY(%s) AND restored_at IS NOT NULL"
        " ORDER BY document_id, char_start, char_end, rule_id",
        (list(document_ids),),
    )
    gathered: dict[str, tuple[Restore, ...]] = {}
    for document_id, rule_id, char_start, char_end in cursor.fetchall():
        named = Restore(rule_id=str(rule_id), start=int(char_start), end=int(char_end))
        gathered[str(document_id)] = (*gathered.get(str(document_id), ()), named)
    return gathered


def record_findings(
    cursor: Cursor[Any],
    run: IndexRun,
    documents: Sequence[ReadDocument],
    *,
    mint: Callable[[], str] = ulid,
) -> int:
    rows = [
        (
            run.workspace_id,
            mint(),
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
    for document in documents:
        cursor.execute(
            "UPDATE source_document SET content_hash = %(content_hash)s,"
            " normalised_key = %(normalised_key)s,"
            " redaction_version = %(version)s, outcome = %(outcome)s,"
            " quarantine_error = NULL,"
            " last_seen = now(),"
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
    if not chunk_ids:
        return 0
    # One statement, not read-then-write: the binding and document must be seen at this
    # instant; reading them into Python moves the race one statement on.
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
