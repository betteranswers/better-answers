"""The worker suite's test-data factory (`[TEST4]`).

Tests state what their scenario needs and get domain rows back as dicts read from
``RETURNING *``; the SQL and the defaults live here. Inserts run as whatever role and
scope the cursor currently holds — seeding as the superuser and asserting as
``app_rt`` is the suites' pattern, not this module's concern.
"""

import secrets
from typing import Any

from psycopg import Cursor

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
    cursor.execute(
        "INSERT INTO workspace (id, name) VALUES (%s, %s) RETURNING *",
        (workspace_id or _ulid(), name),
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
    dimensions: int | None = 1024,
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
