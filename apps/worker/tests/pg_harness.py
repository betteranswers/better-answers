"""The worker's Testcontainers harness (`[TEST2]`): the pinned image, the whole journal.

The worker never migrates (`[WRK1]`), so this harness applies the app's journal the
way the app's migrator does — every ``.sql`` file the journal lists, in order, each
split on drizzle's ``--> statement-breakpoint`` marker — against a throwaway Postgres
on the same pinned image the estate runs. RLS assertions run ``SET LOCAL ROLE app_rt``
inside a transaction, because the container's superuser bypasses RLS by design.
"""

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


def journal_migrations() -> list[Path]:
    journal = json.loads((MIGRATIONS_DIR / "meta" / "_journal.json").read_text("utf-8"))
    return [MIGRATIONS_DIR / f"{entry['tag']}.sql" for entry in journal["entries"]]


def apply_journal(conninfo: str) -> None:
    with psycopg.connect(conninfo) as connection:
        for migration in journal_migrations():
            for statement in migration.read_text("utf-8").split(
                "--> statement-breakpoint"
            ):
                if statement.strip():
                    connection.execute(statement)
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
