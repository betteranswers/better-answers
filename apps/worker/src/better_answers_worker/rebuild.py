"""The full rebuild: the whole map derived again, beside the live one, and flipped.

A generation exists **for full rebuilds only** (ADR 0023): an ordinary edit's delta
lands in the app's own commit transaction and mints nothing. A rebuild happens for one
of six reasons — first sync, route change, reconciler, erasure, upgrade, drill — and
writes generation ``N+1`` beside the live ``N``, invisible to every read, until one row
update makes it live. Nothing here deletes the old generation: sweeping it is the app's
(`graph-sweep`, T-058), and the worker holds no DELETE on either row table to do it
with.

**From bundle plus records, and the split is the point.** The body and the frontmatter
come from the file at the bundle's head — that is what makes this a derivation from the
bundle rather than a copy of the app's own rows. The identity, the path, the folded
kind, the status, the published instant and the three visibility columns come from the
`concept_index` row: the records' derived visibility is the app's, derived in the act's
own transaction from the bindings a concept's evidence came from (ADR 0039), and a
worker that re-derived it would be a second opinion about who may read a concept. So
this copies those columns exactly and re-derives nothing.

**A mismatch stamps anyway** (ADR 0023): a file whose hash disagrees with its row is
rebuilt from the file it is, and counted in the outcome exactly as the nightly audit
counts it. A rebuild that refused would leave the map at the last generation and the
workspace with no way forward; a rebuild that stamped silently would lose the one signal
that says the two parsers have parted.

The whole thing is one transaction, so a rebuild that dies halfway leaves the live
generation exactly where it was.
"""

from dataclasses import dataclass, field
from typing import Any

import psycopg

from .bundle import NoSuchBundleError, concepts_at_head
from .concept_file import MalformedConceptFileError, content_hash_of, parse_concept_file
from .links import CONCEPT_NODE_LABEL, LINKS_TO_LABEL, ResolvedTarget, outgoing_edges


@dataclass(frozen=True, slots=True)
class ConceptRecord:
    """One concept as the records hold it — every column the rebuild copies rather than
    derives.
    """

    iri: str
    path: str
    kind: str
    status: str
    published_at: object
    sensitivity: str
    audience: str
    audience_groups: list[str] | None
    content_hash: str


@dataclass(slots=True)
class RebuildOutcome:
    """What the rebuild wrote, and what it noticed on the way."""

    generation: int = 0
    nodes: int = 0
    edges: int = 0
    mismatched: list[dict[str, str]] = field(default_factory=list)
    unparsed: list[str] = field(default_factory=list)
    missing_row: list[str] = field(default_factory=list)
    missing_file: list[str] = field(default_factory=list)

    def as_row(self) -> dict[str, Any]:
        return {
            "generation": self.generation,
            "nodes": self.nodes,
            "edges": self.edges,
            "mismatched": self.mismatched,
            "unparsed": self.unparsed,
            "missing_row": self.missing_row,
            "missing_file": self.missing_file,
        }


def _records(cursor: psycopg.Cursor, workspace_id: str) -> list[ConceptRecord]:
    cursor.execute(
        "SELECT iri, path, kind, status, published_at, sensitivity, audience,"
        " audience_groups, content_hash FROM concept_index"
        " WHERE workspace_id = %s ORDER BY iri",
        (workspace_id,),
    )
    return [
        ConceptRecord(
            iri=str(row[0]),
            path=str(row[1]),
            kind=str(row[2]),
            status=str(row[3]),
            published_at=row[4],
            sensitivity=str(row[5]),
            audience=str(row[6]),
            audience_groups=None if row[7] is None else list(row[7]),
            content_hash=str(row[8]),
        )
        for row in cursor.fetchall()
    ]


def live_generation(cursor: psycopg.Cursor, workspace_id: str) -> int:
    """The workspace's live generation, created at 1 if absent.

    The same statement the app's delta builder uses (`liveGeneration` in the graph
    door): the no-op ``DO UPDATE`` is what makes one statement both the create and the
    read. A workspace whose map has never been written gets its generation row here, and
    the rebuild then writes generation 2 beside an empty generation 1 — which is right,
    because an empty live generation is what "no map yet" is.
    """
    cursor.execute(
        "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, 1)"
        " ON CONFLICT (workspace_id) DO UPDATE SET live_gen = graph_generation.live_gen"
        " RETURNING live_gen",
        (workspace_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("the live generation could not be read")
    return int(row[0])


def run_rebuild(
    cursor: psycopg.Cursor, git_store_dir: str, workspace_id: str
) -> RebuildOutcome:
    """Write the next generation from the bundle and the records, then flip it live."""
    outcome = RebuildOutcome()
    try:
        blobs = concepts_at_head(git_store_dir, workspace_id)
    except NoSuchBundleError:
        blobs = []
    files = {blob.path: blob.content for blob in blobs}
    records = _records(cursor, workspace_id)

    live = live_generation(cursor, workspace_id)
    outcome.generation = live + 1

    by_path = {
        record.path: ResolvedTarget(record.iri, record.kind, record.status)
        for record in records
    }
    by_iri = {
        record.iri: ResolvedTarget(record.iri, record.kind, record.status)
        for record in records
    }

    known = {record.path for record in records}
    outcome.missing_row = sorted(path for path in files if path not in known)

    for record in records:
        cursor.execute(
            "INSERT INTO graph_node (workspace_id, gen, uid, label, kind, published_at,"
            " sensitivity, audience, audience_groups)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                workspace_id,
                outcome.generation,
                record.iri,
                CONCEPT_NODE_LABEL,
                record.kind,
                record.published_at,
                record.sensitivity,
                record.audience,
                record.audience_groups,
            ),
        )
        outcome.nodes += 1

        content = files.get(record.path)
        if content is None:
            # The record stands and its node is written from it; there is no file to
            # derive an edge from, which is a fact about the bundle and is counted as
            # one.
            outcome.missing_file.append(record.path)
            continue
        try:
            frontmatter, body = parse_concept_file(content)
        except MalformedConceptFileError:
            outcome.unparsed.append(record.path)
            continue
        if content_hash_of(frontmatter, body, record.path) != record.content_hash:
            outcome.mismatched.append(
                {
                    "path": record.path,
                    "expected": record.content_hash,
                    "actual": content_hash_of(frontmatter, body, record.path),
                }
            )

        for edge in outgoing_edges(
            iri=record.iri,
            kind=record.kind,
            path=record.path,
            body=body,
            frontmatter=frontmatter,
            by_path=by_path,
            by_iri=by_iri,
        ):
            cursor.execute(
                "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid,"
                " to_uid, from_kind, to_kind, section, sentence, published_at,"
                " sensitivity, audience, audience_groups)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    workspace_id,
                    outcome.generation,
                    edge.uid,
                    edge.label,
                    record.iri,
                    edge.to_uid,
                    record.kind if edge.label == LINKS_TO_LABEL else None,
                    edge.to_kind,
                    edge.section,
                    edge.sentence,
                    record.published_at,
                    record.sensitivity,
                    record.audience,
                    record.audience_groups,
                ),
            )
            outcome.edges += 1

    # The flip: one row update, at the end, in the same transaction as everything above
    # — so every read moves to the rebuilt map at one instant, and a rebuild that died
    # halfway moved nothing.
    cursor.execute(
        "UPDATE graph_generation SET live_gen = %s WHERE workspace_id = %s",
        (outcome.generation, workspace_id),
    )
    return outcome
