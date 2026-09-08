"""The worker's Testcontainers harness (`[TEST2]`): the pinned image, the whole journal.

The worker never migrates (`[WRK1]`), so this harness applies the app's journal the
way the app's migrator does — every ``.sql`` file the journal lists, in order, each
split on drizzle's ``--> statement-breakpoint`` marker — against a throwaway Postgres
on the same pinned image the estate runs. RLS assertions run ``SET LOCAL ROLE app_rt``
inside a transaction, because the container's superuser bypasses RLS by design.

**The stamp is applied too**, in the migrator's own shape: the ``drizzle`` schema, its
``__drizzle_migrations`` table and one row per migration carrying the file's SHA-256 and
the journal's ``when``. Two reasons, and the second is the one that matters: a
migration may grant on that table (0022 does, for `[WRK1]`'s check), and the check
itself compares the committed schema view's ``MIGRATION_WHEN`` against the last row
here — a harness that skipped the stamp could not test the one thing standing between
the worker and a schema that has moved under it.
"""

import hashlib
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import psycopg
from testcontainers.community.postgres import PostgresContainer

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "packages" / "schema" / "migrations"

# The pinned database image (ADR 0032) — the one packages/schema/src/postgres-image.ts
# exports, read from that file so the two tiers cannot drift.
_IMAGE_SOURCE = REPO_ROOT / "packages" / "schema" / "src" / "postgres-image.ts"


def pinned_postgres_image() -> str:
    source = _IMAGE_SOURCE.read_text("utf-8")
    matches = re.findall(r'"(pgvector/pgvector:[^"]+)"', source)
    if len(matches) != 1:
        msg = f"expected one pinned image in {_IMAGE_SOURCE}, found {len(matches)}"
        raise RuntimeError(msg)
    return str(matches[0])


def journal_entries() -> list[dict[str, object]]:
    journal = json.loads((MIGRATIONS_DIR / "meta" / "_journal.json").read_text("utf-8"))
    return [dict(entry) for entry in journal["entries"]]


def journal_migrations() -> list[Path]:
    return [MIGRATIONS_DIR / f"{entry['tag']}.sql" for entry in journal_entries()]


#: The migrator's own stamp table, written out because the migrator is TypeScript and
#: this is the Python half of the same journal (drizzle-orm's `PgDialect.migrate`).
_STAMP_TABLE = """
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
)
"""


def apply_journal(conninfo: str) -> None:
    with psycopg.connect(conninfo) as connection:
        for statement in _STAMP_TABLE.split(";"):
            if statement.strip():
                connection.execute(statement)
        for entry in journal_entries():
            migration = MIGRATIONS_DIR / f"{entry['tag']}.sql"
            sql = migration.read_text("utf-8")
            for statement in sql.split("--> statement-breakpoint"):
                if statement.strip():
                    connection.execute(statement)
            connection.execute(
                'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")'
                " VALUES (%s, %s)",
                (hashlib.sha256(sql.encode("utf-8")).hexdigest(), entry["when"]),
            )
        connection.commit()


@contextmanager
def migrated_postgres() -> Iterator[psycopg.Connection]:
    """A migrated throwaway Postgres; yields one superuser connection."""
    with PostgresContainer(pinned_postgres_image()) as container:
        conninfo = container.get_connection_url().replace(
            "postgresql+psycopg2", "postgresql"
        )
        apply_journal(conninfo)
        with psycopg.connect(conninfo) as connection:
            yield connection
