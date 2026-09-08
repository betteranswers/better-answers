"""The nightly parser audit: the two parsers, checked against each other, hash by hash.

Two parsers exist by decision — TypeScript for the write path, Python for everything
this tier derives — and ADR 0012 turned that into a rule: they police each other,
nightly, for good. "Nightly is fine; deleted is not" (ADR 0023) is the whole of the
reasoning: the app's parse is what every row rests on, and nothing else would ever
notice if it drifted.

So this reads every concept file in the workspace's bundle at its head, parses it with
`concept_file`'s port of the renderer's grammar, hashes it with the port of ADR 0014's
content hash, and compares that number to the `content_hash` the app wrote on the row
for the same path.

**It refuses nothing and fixes nothing.** A mismatch is a state, not a failure: the
outcome row carries what was found and the job is *done*. `bundle_health` is a signal in
ADR 0025's sense — a query over rows the platform already keeps — and the rows it
queries are these (`bundleHealth` in `packages/core/src/runs/index.ts`); there is no
metric and no table of its own.

What an outcome may hold is hashes, counts and paths. A hash is not content, and a path
is the name of a file in a company's own bundle; a body, a title, an address or a name
would be content in a record that would then have to be rewritten on erasure, and a
record of what a run found is never rewritten. So none of them is here.
"""

from dataclasses import dataclass, field
from typing import Any

import psycopg

from .bundle import NoSuchBundleError, concepts_at_head
from .concept_file import MalformedConceptFileError, content_hash_of, parse_concept_file


@dataclass(frozen=True, slots=True)
class IndexedConcept:
    """One row of the app's own parse: what it says the file at this path hashes to."""

    iri: str
    path: str
    content_hash: str


@dataclass
class ParseFindings:
    """What a pass over one workspace's bundle noticed about the two parsers.

    The audit's whole outcome, and the part of a rebuild's that says the same things: a
    rebuild reads every file the audit reads and can disagree with the index in the
    same four ways, so it counts them the same way and an operator reads one shape from
    either job (ADR 0023: a mismatch stamps anyway and raises bundle health as a state).
    """

    checked: int = 0
    mismatched: list[dict[str, str]] = field(default_factory=list)
    unparsed: list[str] = field(default_factory=list)
    missing_row: list[str] = field(default_factory=list)
    missing_file: list[str] = field(default_factory=list)

    def as_row(self) -> dict[str, Any]:
        """The findings as the job row carries them: counts, hashes and paths."""
        return {
            "checked": self.checked,
            "mismatched": self.mismatched,
            "unparsed": self.unparsed,
            "missing_row": self.missing_row,
            "missing_file": self.missing_file,
        }

    def note_mismatch(self, path: str, expected: str, actual: str) -> None:
        """A file whose hash is not the row's; a hash is not content, so it is kept."""
        found = {"path": path, "expected": expected, "actual": actual}
        self.mismatched.append(found)


@dataclass
class AuditOutcome(ParseFindings):
    """What the nightly audit found, which is the findings and nothing else: the audit
    exists to look, so looking is all it reports."""


def indexed_concepts(cursor: psycopg.Cursor) -> list[IndexedConcept]:
    """The app's rows for this transaction's workspace, which the scope selects."""
    cursor.execute("SELECT iri, path, content_hash FROM concept_index ORDER BY path")
    return [
        IndexedConcept(iri=str(row[0]), path=str(row[1]), content_hash=str(row[2]))
        for row in cursor.fetchall()
    ]


def run_audit(
    cursor: psycopg.Cursor, git_store_dir: str, workspace_id: str
) -> AuditOutcome:
    """Cross-check every concept in one workspace, and answer what was found.

    A bundle that does not exist yet is an empty audit rather than a failure: a
    workspace provisioned a moment ago has no repository and no rows, and a job over it
    has nothing to check.
    """
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
            # A file the index does not know: the write path writes both in one
            # transaction, so this is the crash window the reconciler exists for, seen
            # from the other side.
            outcome.missing_row.append(path)
            continue
        try:
            frontmatter, body = parse_concept_file(content)
        except MalformedConceptFileError:
            # A file this grammar does not cover is not a file whose hash is wrong, and
            # calling it a mismatch would send a reader looking at the wrong thing.
            outcome.unparsed.append(path)
            continue
        outcome.checked += 1
        actual = content_hash_of(frontmatter, body, path)
        if actual != row.content_hash:
            outcome.note_mismatch(path, row.content_hash, actual)

    for path in rows:
        if path not in files:
            # A row whose file is gone: a discard that took the file and left the row,
            # or a bundle restored behind its database.
            outcome.missing_file.append(path)

    return outcome
