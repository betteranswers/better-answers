"""The worker suite's test-data factory (`[TEST4]`).

Tests state what their scenario needs and get domain rows back as dicts read from
``RETURNING *``; the SQL and the defaults live here. Inserts run as whatever role and
scope the cursor currently holds — seeding as the superuser and asserting as
``app_rt`` is the suites' pattern, not this module's concern.
"""

import re
import secrets
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


def _ulid() -> str:
    return "".join(secrets.choice(_ULID_ALPHABET) for _ in range(26))


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
    identifier = workspace_id or _ulid()
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
            route_id or f"route-{_ulid()}",
            workspace_id,
            purpose,
            provider,
            model,
            dimensions,
        ),
    )
    return _returning_row(cursor)
