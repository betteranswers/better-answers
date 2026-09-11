"""A Postgres table the engine writes rows into, said in plain types.

Every target this tier declares is **user-managed**: the app owns all DDL (ADR 0007), so
the engine is told the shape of a table it must never create, alter or drop, and its
whole job is the rows. The library's own transition resolver returns nothing at all
for a user-managed desired state, which is why no `CREATE TABLE`, no `ALTER TABLE`
and no `DROP TABLE` is ever reached for one of these — and why dropping an app's state
leaves the table, its indexes and its rows exactly where they were.

**Nothing of the library's appears in this module's interface.** A caller says which
table, which columns and which rows in `str`, `int` and `dict`, and the translation into
the engine's own types happens on the other side of that line (ADR 0036). The columns a
chunk row carries, and the derivation that fills them, belong to the module that knows
what a chunk is — not to this one, which knows only how to hand rows to the engine.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import asyncpg
import cocoindex as coco
from cocoindex.connectorkits.target import ManagedBy
from cocoindex.connectors import postgres


@dataclass(frozen=True, slots=True)
class Column:
    """One column the engine writes: its name and the Postgres type it binds against.

    A column the table has and this list does not is a column the engine never touches —
    the generated full-text vector is the reason that matters, because it is the
    database's own work and a write to it is an error rather than a redundancy.
    """

    name: str
    pg_type: str
    nullable: bool = True


@dataclass(frozen=True, slots=True)
class Table:
    """A table the app created, addressed the way Postgres addresses it."""

    schema: str
    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]


#: The one identity a workspace's connection pool is known by inside every Environment
#: of that workspace. It is module-level because it *is* the identity: the engine
#: looks a context value up by this key, so a key minted per call would be a different
#: pool to the engine every time, and the memo fingerprints naming it would move too.
POOL = coco.ContextKey[asyncpg.Pool]("better-answers/chunk-store")


def _schema_of(table: Table) -> postgres.TableSchema[dict[str, Any]]:
    return postgres.TableSchema(
        columns={
            column.name: postgres.ColumnDef(
                type=column.pg_type, nullable=column.nullable
            )
            for column in table.columns
        },
        primary_key=list(table.primary_key),
    )


@coco.fn
async def declare_rows(table: Table, rows: tuple[Mapping[str, Any], ...]) -> int:
    """Declare each row against the table, and answer how many were declared.

    The engine takes its own connections out of the pool for these, one batch at a time
    under a task group and outside any transaction this tier opened — which is the whole
    reason the pool's connections carry the workspace scope as a session setting.
    """
    target = await postgres.mount_table_target(
        POOL,
        table_name=table.name,
        pg_schema_name=table.schema,
        table_schema=_schema_of(table),
        managed_by=ManagedBy.USER,
    )
    for row in rows:
        target.declare_row(row=dict(row))
    return len(rows)


@coco.fn
async def declare_nothing() -> None:
    """The main an app is named by when it is only being dropped.

    A drop reverts what the app's own state record says it declared, and never what a
    main function would declare if it ran — the library builds no processor for one.
    So this exists to name the app rather than to do anything, and a drop that had to
    invent a table and a row's worth of arguments to reach the app it meant would be
    saying something untrue about what a drop reads.
    """
    return None
