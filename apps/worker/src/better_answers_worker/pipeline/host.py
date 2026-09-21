import asyncio
import shutil
import threading
from collections import OrderedDict
from collections.abc import Coroutine, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any

import asyncpg
import cocoindex as coco

from ..config import Bootstrap
from ..log import logger
from .tables import POOL, Table, declare_nothing, declare_rows

ENVIRONMENTS_HELD = 4


POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 2


LANDED_APP = "landed"
CHUNKS_APP = "chunks"


@dataclass(frozen=True, slots=True)
class IndexRun:
    workspace_id: str
    binding_id: str

    reason: str


async def open_pool(
    database_url: str, workspace_id: str, *, max_size: int = POOL_MAX_SIZE
) -> asyncpg.Pool:

    async def scope(connection: asyncpg.Connection) -> None:
        await connection.execute(
            "SELECT set_config('app.workspace_id', $1, false)", workspace_id
        )

    pool = await asyncpg.create_pool(
        database_url, min_size=POOL_MIN_SIZE, max_size=max_size, setup=scope
    )
    if pool is None:  # pragma: no cover - asyncpg only answers None when it is told to
        message = f"no pool was opened for workspace {workspace_id}"
        raise RuntimeError(message)
    return pool


class _Loop:
    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._serve, name="pipeline-loop", daemon=True
        )
        self._thread.start()

    def _serve(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    @property
    def loop(self) -> asyncio.AbstractEventLoop:
        return self._loop

    def run[T](self, work: Coroutine[Any, Any, T]) -> T:
        return asyncio.run_coroutine_threadsafe(work, self._loop).result()

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)
        self._loop.close()


class Host:
    def __init__(
        self, bootstrap: Bootstrap, *, environments_held: int = ENVIRONMENTS_HELD
    ) -> None:
        self._bootstrap = bootstrap
        self._engine = bootstrap.engine
        self._held = environments_held
        self._loop = _Loop()
        self._pools: dict[str, asyncpg.Pool] = {}
        self._environments: OrderedDict[str, coco.Environment] = OrderedDict()
        self._providers: dict[str, coco.ContextProvider] = {}

    def __enter__(self) -> "Host":
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def binding_directory(self, run: IndexRun) -> Path:
        return Path(self._engine.lmdb_dir) / run.workspace_id / run.binding_id

    def lmdb_bytes(self, run: IndexRun) -> int:
        directory = self.binding_directory(run)
        if not directory.is_dir():
            return 0
        return sum(
            item.stat().st_size for item in directory.rglob("*") if item.is_file()
        )

    def remove_binding_directory(self, run: IndexRun) -> None:
        # Evicted before the directory goes: removing it under an open handle would
        # leave the engine writing into a store nothing can read.
        self.evict(run)
        shutil.rmtree(self.binding_directory(run), ignore_errors=True)

    def pool(self, workspace_id: str) -> asyncpg.Pool:
        held = self._pools.get(workspace_id)
        if held is not None:
            return held
        opened = self._loop.run(open_pool(self._bootstrap.database_url, workspace_id))
        self._pools[workspace_id] = opened
        return opened

    def open_binding(self, run: IndexRun) -> None:
        self._environment(run)

    def held_bindings(self) -> tuple[str, ...]:
        return tuple(self._environments)

    def evict(self, run: IndexRun) -> None:
        self._environments.pop(run.binding_id, None)
        self._providers.pop(run.binding_id, None)

    def _environment(self, run: IndexRun) -> coco.Environment:
        held = self._environments.get(run.binding_id)
        if held is not None:
            self._environments.move_to_end(run.binding_id)
            return held

        directory = self.binding_directory(run)
        directory.mkdir(parents=True, exist_ok=True)
        provider = coco.ContextProvider()
        provider.provide(POOL, self.pool(run.workspace_id))
        opened = coco.Environment(
            coco.Settings(
                db_path=directory,
                db_settings=coco.LmdbSettings(map_size=self._engine.lmdb_map_bytes),
            ),
            name=f"binding:{run.binding_id}",
            context_provider=provider,
            event_loop=self._loop.loop,
        )
        self._environments[run.binding_id] = opened
        self._providers[run.binding_id] = provider
        while len(self._environments) > self._held:
            dropped, _ = self._environments.popitem(last=False)
            self._providers.pop(dropped, None)
            logger.info(
                "the binding's store was closed to stay within the cache",
                binding_id=dropped,
                held=self._held,
            )
        return opened

    def app_config(self, run: IndexRun, name: str) -> coco.AppConfig:
        return coco.AppConfig(
            name=name,
            environment=self._environment(run),
            max_inflight_components=self._engine.max_inflight_components,
        )

    def land_rows(
        self, run: IndexRun, table: Table, rows: Sequence[Mapping[str, Any]]
    ) -> int:
        declared = tuple(rows)
        app = coco.App(self.app_config(run, CHUNKS_APP), declare_rows, table, declared)
        # From the caller's thread, never the host's loop: the blocking form of an
        # update never returns when it is called from inside that loop.
        landed = app.update_blocking()
        return int(landed) if isinstance(landed, int) else len(declared)

    def drop_binding(self, run: IndexRun) -> None:
        coco.App(self.app_config(run, CHUNKS_APP), declare_nothing).drop_blocking()

    def close(self) -> None:
        self._environments.clear()
        self._providers.clear()
        pools = list(self._pools.values())
        self._pools.clear()
        for pool in pools:
            self._loop.run(pool.close())
        self._loop.close()
