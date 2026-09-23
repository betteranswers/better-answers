import hashlib
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from testcontainers.community.postgres import PostgresContainer

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "packages" / "schema" / "migrations"


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


_STAMP_TABLE = """
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
)
"""


def stamp_migration(cursor: psycopg.Cursor[Any], *, digest: str, when: object) -> None:
    cursor.execute(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")'
        " VALUES (%s, %s)",
        (digest, when),
    )


# What `migrate` writes after the journal, which on its own leaves the table empty.
def stamp_contract(cursor: psycopg.Cursor[Any], *, digest: str) -> None:
    cursor.execute(
        "INSERT INTO contract_stamp (only_row, digest) VALUES (true, %s)"
        " ON CONFLICT (only_row) DO UPDATE SET digest = excluded.digest",
        (digest,),
    )


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
            with connection.cursor() as cursor:
                stamp_migration(
                    cursor,
                    digest=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                    when=entry["when"],
                )
        connection.commit()


@contextmanager
def migrated_postgres() -> Iterator[psycopg.Connection]:
    with migrated_postgres_at() as (connection, _conninfo):
        yield connection


@contextmanager
def migrated_postgres_at() -> Iterator[tuple[psycopg.Connection, str]]:
    with PostgresContainer(pinned_postgres_image()) as container:
        conninfo = container.get_connection_url().replace(
            "postgresql+psycopg2", "postgresql"
        )
        apply_journal(conninfo)
        with psycopg.connect(conninfo) as connection:
            yield connection, conninfo
