"""The worker suite's test-data factory (`[TEST4]`).

Tests state what their scenario needs and get domain rows back as dicts read from
``RETURNING *``; the SQL and the defaults live here. Inserts run as whatever role and
scope the cursor currently holds — seeding as the superuser and asserting as
``app_rt`` is the suites' pattern, not this module's concern.
"""

import json
import re
import secrets
from typing import Any

from psycopg import Cursor

# The tier's own minter, imported rather than copied: the conformance suite holds this
# very function to `contracts/id-shape/cases.json`, and a second implementation here
# would prove the copy instead of the code the nightly audit's self-scheduling uses.
from better_answers_worker.ids import ulid
from pg_harness import REPO_ROOT

# The vector width (`[DEPS2]`) — the one packages/schema/src/index-tables.ts exports,
# read from that file so the two tiers cannot drift; one match or refuse, as
# pg_harness reads the image pin.
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
    # `slug` is Better Auth's organisation column (ADR 0009, 2026-09-01): unique, never
    # read by the worker, so the id itself is the slug here.
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
    """A binding an Admin made, with the three permission fields a run copies onto rows.

    Internal and unpublished rather than the column's own Restricted default, because
    the ordinary binding a suite wants is one whose class a document can narrow — a
    seeded Restricted binding would make every narrowing case a no-op and prove nothing.
    """
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
    """One item the bind act catalogued, before any run has been over it.

    The four columns a run reconciles — the hash, the normalised copy's key, the
    redaction version and the outcome — are left as the bind act leaves them, which is
    null, because a suite about the reconcile has to be able to see them move.
    """
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
    """What one erasure request said this document must keep out.

    The row's two keys are real, so the request the routine ran and the subject request
    it answers are written first rather than left to a deferral the caller would have to
    remember — the same shape `seed_concept_index` takes with its bundle commit.
    """
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


def seed_concept_identity(
    cursor: Cursor[Any],
    *,
    workspace_id: str,
    iri: str,
    merge_key: str,
) -> dict[str, Any]:
    """A concept's identity: the IRI the platform minted, and the merge key it holds.

    What an acceptance resolves a suggestion's target against (ADR 0002, ADR 0012), so
    the inbox conformance suite needs one before a merge key can resolve to anything.
    """
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
    """A concept's derived row, with the bundle commit it names.

    The index row's key to its commit is real, so the commit is written first here
    rather than left to a deferral the caller would have to remember.
    """
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
    """One job on the worker's queue, at whatever point of its life a caller needs.

    The two instants are given as offsets in seconds and become absolute here, so a
    suite can arrange a lapsed lease or an old enqueue without waiting for either to
    happen. A job that names a claimant is given a claim instant and a heartbeat too,
    because the row's own CHECK ties `claimed_by` to `claimed_at`.

    `subject_id` is what the job is about — the binding an index run is for — under a
    biconditional CHECK: a kind whose descriptor names a subject must be given one,
    and a kind whose descriptor names none must not.
    """
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
