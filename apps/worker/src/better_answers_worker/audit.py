from dataclasses import dataclass, field
from typing import Any

import psycopg

from .bundle import NoSuchBundleError, concepts_at_head
from .concept_file import MalformedConceptFileError, content_hash_of, parse_concept_file


@dataclass(frozen=True, slots=True)
class IndexedConcept:
    iri: str
    path: str
    content_hash: str


@dataclass
class ParseFindings:
    """`missing_row` holds files at head with no `concept_index` row; `missing_file`
    holds rows whose file is gone; `unparsed` holds files that would not parse."""

    checked: int = 0
    mismatched: list[dict[str, str]] = field(default_factory=list)
    unparsed: list[str] = field(default_factory=list)
    missing_row: list[str] = field(default_factory=list)
    missing_file: list[str] = field(default_factory=list)

    def as_row(self) -> dict[str, Any]:
        return {
            "checked": self.checked,
            "mismatched": self.mismatched,
            "unparsed": self.unparsed,
            "missing_row": self.missing_row,
            "missing_file": self.missing_file,
        }

    def note_mismatch(self, path: str, expected: str, actual: str) -> None:
        found = {"path": path, "expected": expected, "actual": actual}
        self.mismatched.append(found)


@dataclass
class AuditOutcome(ParseFindings):
    pass


def indexed_concepts(cursor: psycopg.Cursor) -> list[IndexedConcept]:
    cursor.execute("SELECT iri, path, content_hash FROM concept_index ORDER BY path")
    return [
        IndexedConcept(iri=str(row[0]), path=str(row[1]), content_hash=str(row[2]))
        for row in cursor.fetchall()
    ]


def run_audit(
    cursor: psycopg.Cursor, git_store_dir: str, workspace_id: str
) -> AuditOutcome:
    """Checks each concept file at the bundle's head against its
    `concept_index` row by content hash, and writes nothing. A workspace with
    no bundle audits as one with no files, so every row is `missing_file`."""
    outcome = AuditOutcome()
    try:
        blobs = concepts_at_head(git_store_dir, workspace_id)
    except NoSuchBundleError:
        blobs = []
    files = {blob.path: blob.content for blob in blobs}
    rows = {row.path: row for row in indexed_concepts(cursor)}

    for path, content in files.items():
        row = rows.get(path)
        if row is None:
            outcome.missing_row.append(path)
            continue
        try:
            frontmatter, body = parse_concept_file(content)
        except MalformedConceptFileError:
            outcome.unparsed.append(path)
            continue
        outcome.checked += 1
        actual = content_hash_of(frontmatter, body, path)
        if actual != row.content_hash:
            outcome.note_mismatch(path, row.content_hash, actual)

    for path in rows:
        if path not in files:
            outcome.missing_file.append(path)

    return outcome
