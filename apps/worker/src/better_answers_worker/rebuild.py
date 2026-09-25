from dataclasses import dataclass
from typing import Any

import psycopg

from .audit import ParseFindings
from .bundle import NoSuchBundleError, concepts_at_head
from .concept_file import MalformedConceptFileError, content_hash_of, parse_concept_file
from .links import CONCEPT_NODE_LABEL, LINKS_TO_LABEL, ResolvedTarget, outgoing_edges


@dataclass(frozen=True, slots=True)
class ConceptRecord:
    iri: str
    path: str
    kind: str
    status: str
    published_at: object
    sensitivity: str
    audience: str
    audience_groups: list[str] | None
    content_hash: str


@dataclass
class RebuildOutcome(ParseFindings):
    generation: int = 0
    nodes: int = 0
    edges: int = 0

    def as_row(self) -> dict[str, Any]:
        return {
            **super().as_row(),
            "generation": self.generation,
            "nodes": self.nodes,
            "edges": self.edges,
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
    """The workspace's live graph generation, first created at 1 when it has none."""
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
    """Writes the whole graph as the generation after the live one and makes it live,
    leaving older generations for the api's sweep. Nodes come from `concept_index` rows
    and edges from the files at head, each hash checked as `run_audit` checks it."""
    outcome = RebuildOutcome()

    live = live_generation(cursor, workspace_id)
    outcome.generation = live + 1

    try:
        blobs = concepts_at_head(git_store_dir, workspace_id)
    except NoSuchBundleError:
        blobs = []
    files = {blob.path: blob.content for blob in blobs}
    records = _records(cursor, workspace_id)

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
            outcome.missing_file.append(record.path)
            continue
        try:
            frontmatter, body = parse_concept_file(content)
        except MalformedConceptFileError:
            outcome.unparsed.append(record.path)
            continue
        outcome.checked += 1
        actual = content_hash_of(frontmatter, body, record.path)
        if actual != record.content_hash:
            outcome.note_mismatch(record.path, record.content_hash, actual)

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

    cursor.execute(
        "UPDATE graph_generation SET live_gen = %s WHERE workspace_id = %s",
        (outcome.generation, workspace_id),
    )
    return outcome
