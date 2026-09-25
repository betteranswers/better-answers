import asyncio
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

# Sized for four bindings with both stores open; the bound counts handles.
ENVIRONMENTS_HELD = 8


POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 2


LANDED_APP = "landed"
CHUNKS_APP = "chunks"


# The binding's own store: the chunk rows and the target-state tracking that says which
# of them have gone. A wipe removes it.
BINDING_STORE = "binding"


# The second store: the landed app and the findings memo, no target declared and so no
# target-state tracking and no text. A wipe spares it.
FINDINGS_STORE = "findings"


STORES_A_BINDING_HOLDS: tuple[str, ...] = (BINDING_STORE, FINDINGS_STORE)


STORE_OF: Mapping[str, str] = MappingProxyType(
    {CHUNKS_APP: BINDING_STORE, LANDED_APP: FINDINGS_STORE}
)


@dataclass(frozen=True, slots=True)
class IndexRun:
    workspace_id: str
    binding_id: str

    reason: str


async def open_pool(
    database_url: str, workspace_id: str, *, max_size: int = POOL_MAX_SIZE
) -> asyncpg.Pool:
    """Every connection is scoped to the workspace for its
    whole life, since the setting is made per session."""

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
    """One pool per workspace and each binding's two engine stores, closing the least
    recently used binding's once more than `environments_held` handles are open."""

    def __init__(
        self, bootstrap: Bootstrap, *, environments_held: int = ENVIRONMENTS_HELD
    ) -> None:
        # Under one binding's handles, the binding in use would be the one shed.
        if environments_held < len(STORES_A_BINDING_HOLDS):
            message = (
                f"the Environment cache must hold a binding's"
                f" {len(STORES_A_BINDING_HOLDS)} handles and was bounded at"
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

    def binding_directory(self, run: IndexRun) -> Path:
        return Path(self._engine.lmdb_dir) / run.workspace_id / run.binding_id

    def store_directory(self, run: IndexRun, store: str) -> Path:
        return self.binding_directory(run) / store

    def store_map_bytes(self) -> int:
        # Split across the binding's stores: a whole cap each would let a binding hold
        # twice the operator's number.
        return self._engine.lmdb_map_bytes // len(STORES_A_BINDING_HOLDS)

    def lmdb_bytes(self, run: IndexRun) -> int:
        # The whole directory, both stores: the operator sizes a volume against what a
        # binding holds and the split must not halve the number.
        directory = self.binding_directory(run)
        if not directory.is_dir():
            return 0
        return sum(
            item.stat().st_size for item in directory.rglob("*") if item.is_file()
        )

    def remove_binding_store(self, run: IndexRun) -> None:
        # Evicted before the directory goes: removing it under an open handle would
        # leave the engine writing into a store nothing can read.
        self._evict(run, BINDING_STORE)
        shutil.rmtree(self.store_directory(run, BINDING_STORE), ignore_errors=True)

    def pool(self, workspace_id: str) -> asyncpg.Pool:
        held = self._pools.get(workspace_id)
        if held is not None:
            return held
        opened = self._loop.run(open_pool(self._bootstrap.database_url, workspace_id))
        self._pools[workspace_id] = opened
        return opened

    def open_binding(self, run: IndexRun) -> None:
        for store in STORES_A_BINDING_HOLDS:
            self._environment(run, store)

    def held_bindings(self) -> tuple[str, ...]:
        """Binding ids with a store open, least recently used first."""
        return tuple(self._environments)

    def _evict(self, run: IndexRun, store: str) -> None:
        stores = self._environments.get(run.binding_id, {})
        stores.pop(store, None)
        if not stores:
            self._environments.pop(run.binding_id, None)

    def _handles(self) -> int:
        return sum(len(stores) for stores in self._environments.values())

    def _environment(self, run: IndexRun, store: str) -> coco.Environment:
        stores = self._environments.get(run.binding_id, {})
        held = stores.get(store)
        if held is not None:
            self._environments.move_to_end(run.binding_id)
            return held

        directory = self.store_directory(run, store)
        directory.mkdir(parents=True, exist_ok=True)
        provider = coco.ContextProvider()
        provider.provide(POOL, self.pool(run.workspace_id))
        opened = coco.Environment(
            coco.Settings(
                db_path=directory,
                db_settings=coco.LmdbSettings(map_size=self.store_map_bytes()),
            ),
            name=f"binding:{run.binding_id}:{store}",
            context_provider=provider,
            event_loop=self._loop.loop,
        )
        self._environments.setdefault(run.binding_id, {})[store] = opened
        self._environments.move_to_end(run.binding_id)
        while self._handles() > self._held:
            oldest, closed = self._environments.popitem(last=False)
            logger.info(
                "the binding's stores were closed to stay within the cache",
                binding_id=oldest,
                stores=list(closed),
                held=self._held,
            )
        return opened

    def app_config(self, run: IndexRun, name: str) -> coco.AppConfig:
        return coco.AppConfig(
            name=name,
            environment=self._environment(run, STORE_OF[name]),
            max_inflight_components=self._engine.max_inflight_components,
        )

    def land_rows(
        self, run: IndexRun, table: Table, rows: Sequence[Mapping[str, Any]]
    ) -> int:
        """A row the store tracks as landed is not written
        again, and one it tracked that `rows` omits is deleted."""
        declared = tuple(rows)
        app = coco.App(self.app_config(run, CHUNKS_APP), declare_rows, table, declared)
        # From the caller's thread, never the host's loop: the blocking form of an
        # update never returns when it is called from inside that loop.
        landed = app.update_blocking()
        return int(landed) if isinstance(landed, int) else len(declared)

    def drop_binding(self, run: IndexRun) -> None:
        """Drops the engine's record of the binding's chunks,
        leaving the table, its indexes and every row it landed."""
        coco.App(self.app_config(run, CHUNKS_APP), declare_nothing).drop_blocking()

    def close(self) -> None:
        self._environments.clear()
        pools = list(self._pools.values())
        self._pools.clear()
        for pool in pools:
            self._loop.run(pool.close())
        self._loop.close()
