import json
import re
import secrets
from typing import Any

import asyncpg
from psycopg import Cursor

from better_answers_worker.concept_file import content_hash_of, parse_concept_file
from better_answers_worker.ids import ulid
from bundles import render_concept_file
from pg_harness import REPO_ROOT

_DIMENSIONS_SOURCE = REPO_ROOT / "packages" / "schema" / "src" / "index-tables.ts"


def embedding_dimensions() -> int:
    source = _DIMENSIONS_SOURCE.read_text("utf-8")
    matches = re.findall(r"export const EMBEDDING_DIMENSIONS = (\d+);", source)
    if len(matches) != 1:
        msg = (
            f"expected one EMBEDDING_DIMENSIONS in {_DIMENSIONS_SOURCE}, "
            f"found {len(matches)}"
        )
        raise RuntimeError(msg)
    return int(matches[0])


EMBEDDING_DIMENSIONS = embedding_dimensions()


def _returning_row(cursor: Cursor[Any]) -> dict[str, Any]:
    row = cursor.fetchone()
    assert row is not None
    assert cursor.description is not None
    columns = cursor.description
    return {column.name: value for column, value in zip(columns, row, strict=True)}


def seed_workspace(
    cursor: Cursor[Any],
    *,
    workspace_id: str | None = None,
    name: str = "Test workspace",
) -> dict[str, Any]:
    identifier = workspace_id or ulid()

    cursor.execute(
        "INSERT INTO workspace (id, name, slug) VALUES (%s, %s, %s) RETURNING *",
        (identifier, name, f"ws-{identifier.lower()}"),
    )
    return _returning_row(cursor)


def seed_llm_route(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    route_id: str | None = None,
    purpose: str = "embedding",
    provider: str = "mistral",
    model: str = "mistral-embed",
    dimensions: int | None = EMBEDDING_DIMENSIONS,
) -> dict[str, Any]:
    cursor.execute(
        "INSERT INTO llm_route (id, workspace_id, purpose, provider, model, dimensions)"
        " VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
        (
            route_id or f"route-{ulid()}",
            workspace_id,
            purpose,
            provider,
            model,
            dimensions,
        ),
    )
    return _returning_row(cursor)


def seed_source_binding(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    binding_id: str | None = None,
    name: str = "The bid library",
    connector: str = "upload",
    sensitivity: str = "Internal",
    audience: str = "everyone",
    audience_groups: list[str] | None = None,
    published_at: str | None = None,
    rules_in_force: dict[str, bool] | None = None,
) -> dict[str, Any]:
    cursor.execute(
        "INSERT INTO source_binding (workspace_id, id, name, connector, sensitivity,"
        " audience, audience_groups, published_at, rules_in_force)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) RETURNING *",
        (
            workspace_id,
            binding_id or ulid(),
            name,
            connector,
            sensitivity,
            audience,
            audience_groups,
            published_at,
            json.dumps(
                {"default_on": True, "default_off": False}
                if rules_in_force is None
                else rules_in_force
            ),
        ),
    )
    return _returning_row(cursor)


def seed_source_document(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    binding_id: str,
    document_id: str | None = None,
    source_system_id: str | None = None,
    title: str = "The handbook",
    media_type: str = "text/markdown",
    byte_size: int = 1024,
    original_key: str | None = None,
    normalised_key: str | None = None,
    sensitivity: str | None = None,
) -> dict[str, Any]:
    identifier = document_id or ulid()
    cursor.execute(
        "INSERT INTO source_document (workspace_id, id, binding_id, source_system_id,"
        " title, media_type, byte_size, original_key, normalised_key, sensitivity)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
        (
            workspace_id,
            identifier,
            binding_id,
            source_system_id or f"{identifier.lower()}.md",
            title,
            media_type,
            byte_size,
            original_key or f"documents/{identifier.lower()}/original",
            normalised_key,
            sensitivity,
        ),
    )
    return _returning_row(cursor)


def seed_suppression(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    document_id: str,
    identifiers: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    subject_request_id = ulid()
    erasure_request_id = ulid()
    cursor.execute(
        "INSERT INTO subject_request (workspace_id, id, identifiers, kind, received_at,"
        " clock_started_at, due_at) VALUES (%s, %s, %s::jsonb, 'erasure', now(), now(),"
        " now() + interval '1 month')",
        (
            workspace_id,
            subject_request_id,
            json.dumps(
                {"emails": ["subject@example.invalid"], "names": [], "other": []}
            ),
        ),
    )
    cursor.execute(
        "INSERT INTO erasure_request (workspace_id, id, subject_request_id, pseudonym,"
        " locked_at, anchored_at, beyond_use_hourly_at, beyond_use_daily_at,"
        " beyond_use_weekly_at, beyond_use_monthly_at)"
        " VALUES (%s, %s, %s, %s, now(), now(), now() + interval '48 hours',"
        " now() + interval '30 days', now() + interval '8 weeks',"
        " now() + interval '6 months')",
        (workspace_id, erasure_request_id, subject_request_id, ulid()),
    )
    cursor.execute(
        "INSERT INTO suppression (workspace_id, erasure_request_id, document_id,"
        " identifiers) VALUES (%s, %s, %s, %s::jsonb) RETURNING *",
        (
            workspace_id,
            erasure_request_id,
            document_id,
            json.dumps(
                {
                    "emails": ["priya.raman@example.test"],
                    "names": ["Priya Raman"],
                    "other": [],
                }
                if identifiers is None
                else identifiers
            ),
        ),
    )
    return _returning_row(cursor)


def seed_finding(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    document_id: str,
    category: str,
    tier: str,
    rule_id: str,
    char_start: int,
    char_end: int,
    score: float = 0.1,
    rule_version: str = "1",
    detector_pin: str = "an-older-pin",
) -> dict[str, Any]:
    cursor.execute(
        "INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,"
        " char_start, char_end, score, rule_version, detector_pin)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
        (
            workspace_id,
            ulid(),
            document_id,
            category,
            tier,
            rule_id,
            char_start,
            char_end,
            score,
            rule_version,
            detector_pin,
        ),
    )
    return _returning_row(cursor)


_THE_SPAN = (
    " WHERE workspace_id = %(workspace_id)s AND document_id = %(document_id)s"
    " AND rule_id = %(rule_id)s AND char_start = %(char_start)s"
    " AND char_end = %(char_end)s RETURNING *"
)


def seed_narrowed(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    document_id: str,
    rule_id: str,
    char_start: int,
    char_end: int,
) -> dict[str, Any]:
    cursor.execute(
        "UPDATE finding SET review_state = 'narrowed', reviewed_by = %(admin)s,"
        " reviewed_at = now()" + _THE_SPAN,
        {
            "admin": f"human:{ulid()}",
            "workspace_id": workspace_id,
            "document_id": document_id,
            "rule_id": rule_id,
            "char_start": char_start,
            "char_end": char_end,
        },
    )
    return _returning_row(cursor)


def seed_restore(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    document_id: str,
    rule_id: str,
    char_start: int,
    char_end: int,
) -> dict[str, Any]:
    cursor.execute(
        "UPDATE finding SET restored_at = now(), restored_by = %(admin)s,"
        " restore_reason = %(reason)s, review_state = 'kept-in-text',"
        " reviewed_by = %(admin)s, reviewed_at = now(), review_reason = %(reason)s"
        + _THE_SPAN,
        {
            "admin": f"human:{ulid()}",
            "reason": "The account is the company's own, printed on every invoice.",
            "workspace_id": workspace_id,
            "document_id": document_id,
            "rule_id": rule_id,
            "char_start": char_start,
            "char_end": char_end,
        },
    )
    return _returning_row(cursor)


def seed_dismissal(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    document_id: str,
    rule_id: str,
    char_start: int,
    char_end: int,
) -> dict[str, Any]:
    cursor.execute(
        "UPDATE finding SET review_state = 'dismissed', reviewed_by = %(admin)s,"
        " reviewed_at = now(), review_reason = %(reason)s" + _THE_SPAN,
        {
            "admin": f"human:{ulid()}",
            "reason": "Our engineers diagnose faults in pumps, never in people.",
            "workspace_id": workspace_id,
            "document_id": document_id,
            "rule_id": rule_id,
            "char_start": char_start,
            "char_end": char_end,
        },
    )
    return _returning_row(cursor)


def seed_admin_narrowing(
    cursor: Cursor[Any], *, document_id: str, sensitivity: str
) -> dict[str, Any]:
    cursor.execute(
        "UPDATE source_document SET sensitivity = %(sensitivity)s,"
        " narrowed_to = %(sensitivity)s WHERE id = %(document_id)s RETURNING *",
        {"sensitivity": sensitivity, "document_id": document_id},
    )
    return _returning_row(cursor)


def seed_concept_identity(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    iri: str,
    merge_key: str,
) -> dict[str, Any]:
    cursor.execute(
        "INSERT INTO concept_identity (workspace_id, iri, merge_key)"
        " VALUES (%s, %s, %s) RETURNING *",
        (workspace_id, iri, merge_key),
    )
    return _returning_row(cursor)


def seed_concept_index(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    iri: str,
    path: str,
    content_hash: str,
) -> dict[str, Any]:
    sha = secrets.token_hex(20)
    cursor.execute(
        "INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor)"
        " VALUES (%s, %s, %s, 'process:better-answers-test')",
        (workspace_id, sha, ulid()),
    )
    cursor.execute(
        "INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter,"
        " body, content_hash, commit_sha, status, published_at, sensitivity, audience)"
        " VALUES (%s, %s, %s, 'Policy', 'Expenses', '{}'::jsonb, 'body', %s, %s,"
        " 'stable', now(), 'Internal', 'everyone') RETURNING *",
        (workspace_id, iri, path, content_hash, sha),
    )
    return _returning_row(cursor)


def seed_concept(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    iri: str,
    path: str,
    frontmatter: dict[str, Any],
    body: str,
    kind: str = "Policy",
    status: str = "stable",
) -> str:
    seed_concept_identity(
        cursor, workspace_id=workspace_id, iri=iri, merge_key=f"{kind}:{path}".lower()
    )
    sha = f"{abs(hash(path)):040x}"[:40]
    cursor.execute(
        "INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor)"
        " VALUES (%s, %s, %s, 'process:better-answers-test')"
        " ON CONFLICT DO NOTHING",
        (workspace_id, sha, ulid()),
    )
    content = render_concept_file(frontmatter, body)
    parsed_frontmatter, parsed_body = parse_concept_file(content)
    cursor.execute(
        "INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter,"
        " body, content_hash, commit_sha, status, published_at, sensitivity, audience)"
        " VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, now(), 'Internal',"
        " 'everyone')",
        (
            workspace_id,
            iri,
            path,
            kind,
            str(frontmatter.get("title", "Untitled")),
            json.dumps(parsed_frontmatter),
            parsed_body,
            content_hash_of(parsed_frontmatter, parsed_body, path),
            sha,
            status,
        ),
    )
    return content


def seed_graph_generation(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    live_gen: int = 1,
) -> dict[str, Any]:
    cursor.execute(
        "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, %s)"
        " RETURNING *",
        (workspace_id, live_gen),
    )
    return _returning_row(cursor)


def hold_graph_generation(cursor: Cursor[Any], *, workspace_id: str) -> int:
    # The no-op update takes the row lock a rebuild beside it must wait on.
    cursor.execute(
        "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, 1)"
        " ON CONFLICT (workspace_id) DO UPDATE"
        " SET live_gen = graph_generation.live_gen RETURNING live_gen",
        (workspace_id,),
    )
    return int(_returning_row(cursor)["live_gen"])


def seed_chunk(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    binding_id: str,
    chunk_id: str,
    content: str = "body",
) -> dict[str, Any]:
    cursor.execute(
        'INSERT INTO "index".chunk (id, workspace_id, content, binding_id)'
        " VALUES (%s, %s, %s, %s)"
        " RETURNING id, workspace_id, content, binding_id",
        (chunk_id, workspace_id, content, binding_id),
    )
    return _returning_row(cursor)


async def land_chunk(connection: asyncpg.Connection, row: dict[str, Any]) -> None:
    # Placeholders are asyncpg's: the pools a row is landed through are asyncpg's.
    await connection.execute(
        'INSERT INTO "index".chunk (id, workspace_id, content, binding_id)'
        " VALUES ($1, $2, $3, $4)",
        row["id"],
        row["workspace_id"],
        row["content"],
        row["binding_id"],
    )


def enqueue_job(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    job_id: str,
    kind: str,
    reason: str | None,
    subject_id: str | None,
) -> None:
    # Only the columns an enqueue names, so a refusal is the contract's.
    cursor.execute(
        "INSERT INTO job (workspace_id, id, kind, reason, subject_id, status)"
        " VALUES (%s, %s, %s, %s, %s, 'queued')",
        (workspace_id, job_id, kind, reason, subject_id),
    )


def seed_job(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    job_id: str | None = None,
    kind: str = "nightly-audit",
    reason: str | None = None,
    subject_id: str | None = None,
    status: str = "queued",
    attempts: int = 0,
    max_attempts: int = 3,
    enqueued_ago_seconds: int = 0,
    claimed_by: str | None = None,
    lease_expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    held = None if claimed_by is None else "now() - interval '1 second'"
    lease = (
        "NULL"
        if lease_expires_in_seconds is None
        else f"now() + interval '{lease_expires_in_seconds} seconds'"
    )
    cursor.execute(
        "INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, attempts,"
        " max_attempts, enqueued_at, claimed_by, claimed_at, lease_expires_at,"
        " heartbeat_at)"
        f" VALUES (%s, %s, %s, %s, %s, %s, %s, %s,"
        f" now() - interval '{enqueued_ago_seconds} seconds', %s,"
        f" {held or 'NULL'}, {lease}, {held or 'NULL'}) RETURNING *",
        (
            workspace_id,
            job_id or ulid(),
            kind,
            reason,
            subject_id,
            status,
            attempts,
            max_attempts,
            claimed_by,
        ),
    )
    return _returning_row(cursor)
