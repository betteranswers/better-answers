"""The worker suite's test-data factory (`[TEST4]`).

Tests state what their scenario needs and get domain rows back as dicts read from
``RETURNING *``; the SQL and the defaults live here. Inserts run as whatever role and
scope the cursor currently holds — seeding as the superuser and asserting as
``app_rt`` is the suites' pattern, not this module's concern.
"""

import re
import secrets
import time
from typing import Any

from psycopg import Cursor

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

_ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def ulid() -> str:
    """One id in the shape both tiers agreed (``contracts/id-shape``, ADR 0035).

    Ten characters of milliseconds then sixteen of randomness, so an id seeded here
    sorts by when it was made and parses at the other tier's boundary — the same
    promise ``packages/schema/src/ulid.ts`` makes. This tier mints no id in
    production; the helper exists so a seeded row is indistinguishable from one the
    app wrote, and so the conformance suite has something of its own to hold to the
    fixture.
    """
    milliseconds = time.time_ns() // 1_000_000
    stamp = "".join(
        _ULID_ALPHABET[(milliseconds >> shift) & 0b11111] for shift in range(45, -1, -5)
    )
    return stamp + "".join(secrets.choice(_ULID_ALPHABET) for _ in range(16))


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
