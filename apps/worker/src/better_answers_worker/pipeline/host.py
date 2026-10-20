import asyncio
import contextlib
import shutil
import threading
from collections import OrderedDict
from collections.abc import Coroutine, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType, TracebackType
from typing import Any

import asyncpg
import cocoindex as coco

from ..config import Bootstrap
from ..log import logger
from .tables import POOL, Table, declare_nothing, declare_rows

ENVIRONMENTS_HELD = 8


POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 2


LANDED_APP = "landed"
PASSAGES_APP = "passages"


CONNECTED_SOURCE_STORE = "connected_source"


STORES_NAMED_BEFORE_THE_PASSAGE_SWEEP: tuple[str, ...] = ("binding",)


FINDINGS_STORE = "findings"


STORES_A_CONNECTED_SOURCE_HOLDS: tuple[str, ...] = (
    CONNECTED_SOURCE_STORE,
    FINDINGS_STORE,
)


STORE_OF: Mapping[str, str] = MappingProxyType(
    {PASSAGES_APP: CONNECTED_SOURCE_STORE, LANDED_APP: FINDINGS_STORE}
)


@dataclass(frozen=True, slots=True)
class Sync:
    workspace_id: str
    connected_source_id: str

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
        self,
        bootstrap: Bootstrap,
        *,
        environments_held: int = ENVIRONMENTS_HELD,
    ) -> None:
        if environments_held < len(STORES_A_CONNECTED_SOURCE_HOLDS):
            message = (
                f"the Environment cache must hold a connected source's"
                f" {len(STORES_A_CONNECTED_SOURCE_HOLDS)} handles and was bounded at"
                f" {environments_held}"
            )
            raise ValueError(message)
        self._bootstrap = bootstrap
        self._engine = bootstrap.engine
        self._held = environments_held
        self._loop = _Loop()
        self._pools: dict[str, asyncpg.Pool] = {}
        self._environments: OrderedDict[str, dict[str, coco.Environment]] = (
            OrderedDict()
        )

    def __enter__(self) -> "Host":
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def connected_source_directory(self, sync: Sync) -> Path:
        return (
            Path(self._engine.lmdb_dir) / sync.workspace_id / sync.connected_source_id
        )

    def store_directory(self, sync: Sync, store: str) -> Path:
        return self.connected_source_directory(sync) / store

    def store_map_bytes(self) -> int:
        return self._engine.lmdb_map_bytes // len(STORES_A_CONNECTED_SOURCE_HOLDS)

    def lmdb_bytes(self, sync: Sync) -> int:
        directory = self.connected_source_directory(sync)
        if not directory.is_dir():
            return 0
        return sum(
            item.stat().st_size for item in directory.rglob("*") if item.is_file()
        )

    def remove_connected_source_store(self, sync: Sync) -> None:
        self._evict(sync, CONNECTED_SOURCE_STORE)
        for store in (CONNECTED_SOURCE_STORE, *STORES_NAMED_BEFORE_THE_PASSAGE_SWEEP):
            with contextlib.suppress(FileNotFoundError):
                shutil.rmtree(self.store_directory(sync, store))

    def pool(self, workspace_id: str) -> asyncpg.Pool:
        held = self._pools.get(workspace_id)
        if held is not None:
            return held
        opened = self._loop.run(open_pool(self._bootstrap.database_url, workspace_id))
        self._pools[workspace_id] = opened
        return opened

    def open_connected_source(self, sync: Sync) -> None:
        for store in STORES_A_CONNECTED_SOURCE_HOLDS:
            self._environment(sync, store)

    def held_connected_sources(self) -> tuple[str, ...]:
        return tuple(self._environments)

    def _evict(self, sync: Sync, store: str) -> None:
        stores = self._environments.get(sync.connected_source_id, {})
        evicted = stores.pop(store, None)
        if evicted is not None:
            evicted.close()
        if not stores:
            self._environments.pop(sync.connected_source_id, None)

    def _handles(self) -> int:
        return sum(len(stores) for stores in self._environments.values())

    def _environment(self, sync: Sync, store: str) -> coco.Environment:
        stores = self._environments.get(sync.connected_source_id, {})
        held = stores.get(store)
        if held is not None:
            self._environments.move_to_end(sync.connected_source_id)
            return held

        directory = self.store_directory(sync, store)
        directory.mkdir(parents=True, exist_ok=True)
        provider = coco.ContextProvider()
        provider.provide(POOL, self.pool(sync.workspace_id))
        settings = coco.Settings(
            db_path=directory,
            db_settings=coco.LmdbSettings(map_size=self.store_map_bytes()),
        )
        opened = coco.Environment(
            settings,
            name=f"connected_source:{sync.connected_source_id}:{store}",
            context_provider=provider,
            event_loop=self._loop.loop,
        )
        self._environments.setdefault(sync.connected_source_id, {})[store] = opened
        self._environments.move_to_end(sync.connected_source_id)
        while self._handles() > self._held:
            oldest, closed = self._environments.popitem(last=False)
            for environment in closed.values():
                environment.close()
            logger.info(
                "the connected source's stores were closed to stay within the cache",
                connected_source_id=oldest,
                stores=list(closed),
                held=self._held,
            )
        return opened

    def app_config(self, sync: Sync, name: str) -> coco.AppConfig:
        return coco.AppConfig(
            name=name,
            environment=self._environment(sync, STORE_OF[name]),
            max_inflight_components=self._engine.max_inflight_components,
        )

    def land_rows(
        self, sync: Sync, table: Table, rows: Sequence[Mapping[str, Any]]
    ) -> int:
        declared = tuple(rows)
        app = coco.App(
            self.app_config(sync, PASSAGES_APP), declare_rows, table, declared
        )
        # cocoindex's `update_blocking` never returns when called from inside the
        # environment's event loop, so it runs on the caller's thread.
        landed = app.update_blocking()
        return int(landed) if isinstance(landed, int) else len(declared)

    def drop_connected_source(self, sync: Sync) -> None:
        coco.App(self.app_config(sync, PASSAGES_APP), declare_nothing).drop_blocking()

    def close(self) -> None:
        for stores in self._environments.values():
            for environment in stores.values():
                environment.close()
        self._environments.clear()
        pools = list(self._pools.values())
        self._pools.clear()
        for pool in pools:
            self._loop.run(pool.close())
        self._loop.close()
