import asyncio
import contextlib
import gc
import shutil
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Coroutine, Iterator, Mapping, Sequence
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


# heed's message for an environment this process still holds open.
STILL_OPEN = (
    "environment already open in this program;"
    " close it to be able to open it again with different options"
)


STARVED_RUNNER_RELEASE_WAIT_SECONDS = 5.0
FIRST_PAUSE_SECONDS = 0.05
LONGEST_PAUSE_SECONDS = 0.5


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


def _pauses_within(cap_seconds: float) -> Iterator[float]:
    pause = FIRST_PAUSE_SECONDS
    left = cap_seconds
    while pause < left:
        yield pause
        left -= pause
        pause = min(pause * 2, LONGEST_PAUSE_SECONDS)
    if left > 0:
        yield left


def _open_unless_held(
    open_store: Callable[[], coco.Environment],
) -> coco.Environment | None:
    try:
        return open_store()
    except RuntimeError as error:
        if str(error) != STILL_OPEN:
            raise
        return None


def _opened_once_let_go(
    sync: Sync,
    store: str,
    open_store: Callable[[], coco.Environment],
    wait_seconds: float,
) -> coco.Environment:
    opened = _open_unless_held(open_store)
    if opened is not None:
        return opened
    logger.info(
        "the engine still holds the store, so its open waits for it to let go",
        connected_source_id=sync.connected_source_id,
        store=store,
        wait_seconds=wait_seconds,
    )
    # A handle caught in a reference cycle drops only when the collector runs.
    gc.collect()
    for pause in _pauses_within(wait_seconds):
        opened = _open_unless_held(open_store)
        if opened is not None:
            return opened
        time.sleep(pause)
    return open_store()


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
        release_wait_seconds: float = STARVED_RUNNER_RELEASE_WAIT_SECONDS,
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
        self._release_wait = release_wait_seconds
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
        stores.pop(store, None)
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
        opened = _opened_once_let_go(
            sync,
            store,
            lambda: coco.Environment(
                settings,
                name=f"connected_source:{sync.connected_source_id}:{store}",
                context_provider=provider,
                event_loop=self._loop.loop,
            ),
            self._release_wait,
        )
        self._environments.setdefault(sync.connected_source_id, {})[store] = opened
        self._environments.move_to_end(sync.connected_source_id)
        while self._handles() > self._held:
            oldest, closed = self._environments.popitem(last=False)
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
        self._environments.clear()
        pools = list(self._pools.values())
        self._pools.clear()
        for pool in pools:
            self._loop.run(pool.close())
        self._loop.close()
