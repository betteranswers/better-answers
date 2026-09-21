from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import asyncpg
import cocoindex as coco
from cocoindex.connectorkits.target import ManagedBy
from cocoindex.connectors import postgres


@dataclass(frozen=True, slots=True)
class Column:
    name: str
    pg_type: str
    nullable: bool = True


@dataclass(frozen=True, slots=True)
class Table:
    schema: str
    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]


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
    return None
