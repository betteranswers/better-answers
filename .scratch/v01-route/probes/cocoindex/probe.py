"""
PROBE — THROWAWAY (T-113, probe 4 of 4; route spec, Further Notes). Never merged.

Against cocoindex 1.0.20 (the clone at aee7b27d is v1.0.20-1-g), run:

  (a) a `managed_by="user"` Postgres table under `app.drop()` keeps its table and its
      index, and what happens to its rows (ADR 0036 relies on this; worker-host F4);
  (b) a cp313 manylinux wheel exists — answered by the resolver, printed here;
  (c) asyncpg's default pool size — read off the signature, printed here.

Run: `.venv/bin/python -u probe.py` with the throwaway container `probe-t113-pg` up.
Synchronous on purpose: `update_blocking()` blocks the thread whose loop the Environment
runs on, so the driver holds no loop of its own and reads the catalogue on a fresh one.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import pathlib
import shutil
import tempfile
from dataclasses import dataclass
from typing import AsyncIterator

# The default environment's LMDB directory, read at import (`COCOINDEX_DB`); the
# `@coco.lifespan` decorator binds to that default environment and no other.
LMDB_DIR = tempfile.mkdtemp(prefix="probe-t113-lmdb-")
os.environ["COCOINDEX_DB"] = LMDB_DIR

import asyncpg
import cocoindex as coco
from cocoindex.connectors import localfs, postgres
from cocoindex.connectorkits.target import ManagedBy
from cocoindex.resources.file import FileLike, PatternFilePathMatcher

DATABASE_URL = os.getenv("PROBE_PG", "postgres://probe:probe@localhost:55432/probe")
TABLE = "probe_rows"
PG_DB = coco.ContextKey[asyncpg.Pool]("probe_db")


@coco.lifespan
async def coco_lifespan(builder: coco.EnvironmentBuilder) -> AsyncIterator[None]:
    async with asyncpg.create_pool(DATABASE_URL) as pool:
        print("[probe-4] lifespan pool (min,max) with no sizes given:", pool.get_min_size(), pool.get_max_size(), flush=True)
        builder.provide(PG_DB, pool)
        yield


@dataclass
class ProbeRow:
    id: str
    text: str


@coco.fn(memo=True)
async def process_file(file: FileLike, table: postgres.TableTarget[ProbeRow]) -> None:
    text = await file.read_text()
    table.declare_row(row=ProbeRow(id=str(file.file_path.path), text=text))


@coco.fn
async def app_main(sourcedir: pathlib.Path, managed_by: ManagedBy) -> None:
    target = await postgres.mount_table_target(
        PG_DB,
        table_name=TABLE,
        table_schema=await postgres.TableSchema.from_class(ProbeRow, primary_key=["id"]),  # type: ignore[arg-type]
        managed_by=managed_by,
    )
    files = localfs.walk_dir(
        sourcedir,
        recursive=False,
        path_matcher=PatternFilePathMatcher(included_patterns=["*.txt"]),
    )
    await coco.mount_each(process_file, files.items(), target)  # type: ignore[call-overload]


async def _catalogue() -> dict:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        table = await conn.fetchval("SELECT to_regclass($1)::text", TABLE)
        indexes = await conn.fetch(
            "SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname", TABLE
        )
        rows = await conn.fetch(f"SELECT id FROM {TABLE} ORDER BY id") if table else None
        return {
            "table": table,
            "indexes": [r["indexname"] for r in indexes],
            "rows": None if rows is None else [r["id"] for r in rows],
        }
    finally:
        await conn.close()


async def _sql(statement: str) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(statement)
    finally:
        await conn.close()


def catalogue(label: str) -> None:
    print(f"[probe-4] {label}:", json.dumps(asyncio.run(_catalogue())), flush=True)


def main() -> None:
    print("[probe-4] cocoindex", coco.__version__, "asyncpg", asyncpg.__version__, flush=True)
    sig = inspect.signature(asyncpg.create_pool)
    print(
        "[probe-4] (c) asyncpg.create_pool defaults:",
        {k: v.default for k, v in sig.parameters.items() if k in ("min_size", "max_size")},
        flush=True,
    )

    sourcedir = pathlib.Path(tempfile.mkdtemp(prefix="probe-t113-src-"))
    for i in range(3):
        (sourcedir / f"doc-{i}.txt").write_text(f"document {i} about receipts")

    # The table and an index of our own, made by hand — what ADR 0007 says the app owns.
    asyncio.run(_sql(f"DROP TABLE IF EXISTS {TABLE}"))
    asyncio.run(_sql(f"CREATE TABLE {TABLE} (id text PRIMARY KEY, text text NOT NULL)"))
    asyncio.run(_sql(f"CREATE INDEX {TABLE}_text_idx ON {TABLE} (text)"))
    catalogue("before update (user-managed)")

    app = coco.App(
        coco.AppConfig(name="ProbeUserManaged"),
        app_main,
        sourcedir=sourcedir,
        managed_by=ManagedBy.USER,
    )
    app.update_blocking()
    catalogue("after update (user-managed)")

    # A source document withdrawn, then an update: the LMDB target-state tracking issues the
    # delete — the reason ADR 0036's amendment pairs a wipe with deleting the binding's rows.
    (sourcedir / "doc-1.txt").unlink()
    app.update_blocking()
    catalogue("after doc-1 withdrawn + update (user-managed)")

    app.drop_blocking()
    catalogue("(a) after app.drop() (user-managed)")

    # Control: the same flow with managed_by=SYSTEM on a table cocoindex creates itself.
    asyncio.run(_sql(f"DROP TABLE IF EXISTS {TABLE}"))
    app2 = coco.App(
        coco.AppConfig(name="ProbeSystemManaged"),
        app_main,
        sourcedir=sourcedir,
        managed_by=ManagedBy.SYSTEM,
    )
    app2.update_blocking()
    catalogue("control: after update (system-managed)")
    app2.drop_blocking()
    catalogue("control: after app.drop() (system-managed)")

    lmdb = pathlib.Path(LMDB_DIR)
    print(
        "[probe-4] LMDB dir:",
        {f.name: f.stat().st_size for f in lmdb.rglob("*") if f.is_file()},
        flush=True,
    )
    shutil.rmtree(sourcedir, ignore_errors=True)


if __name__ == "__main__":
    main()
