"""The host: one event loop, one pool per workspace, one Environment per binding.

Three facts about the engine decide the whole shape of this module, and each of them was
measured on the pinned version rather than read off a document.

**The blocking form of an update deadlocks when it is called from inside the loop the
Environment was given.** So the loop this host owns runs on a thread of its own and
nothing is ever awaited on it from the outside: work is submitted to it, and the
engine's blocking calls are made from the caller's own thread, which is never that one.

**A named Environment takes its context through a standalone provider.** The decorator
the library documents registers against the *default* environment, so a key provided
through it is simply absent from a named one and the flow fails looking the pool up at
the moment it would have written a row. The provider is built here and handed in.

**A pool must be *built* on the loop, not merely awaited there.** `asyncpg.create_pool`
is not a coroutine function: it constructs a pool whose constructor reads the current
event loop, so handing the call's result to the loop raises before the loop ever sees
it. The call therefore happens inside a coroutine of this module's own, which is what
gets submitted.

**Why a pool exists at all**: `index`.`chunk` forces row-level security and checks the
workspace on every write, the engine takes its own connections out of the pool and runs
bare statements on them under a task group with no transaction around them, and this
tier's other door sets the workspace *transaction-locally*. A transaction-local setting
would be gone before the engine's statement ran, so the pool's connection init sets it
for the session. Two connections at most: the default is ten, and ten per workspace
exhausts Postgres long before the estate has ten busy workspaces.
"""

import asyncio
import os
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

#: How many bindings' Environments one process keeps open. A named Environment has no
#: close of its own and an open one is an open LMDB handle, so a host that kept every
#: binding it ever saw would grow handles for the life of the process. Small, because
#: the loop runs one job at a time: the cache is here so that a workspace working
#: through a handful of bindings does not reopen a store on every claim, not to
#: hold an estate.
ENVIRONMENTS_HELD = 4

#: At most two connections per workspace (see this module's docblock), and none held
#: open while nothing is running.
POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 2

#: The app name every index run takes inside its binding's Environment. One name,
#: because the Environment is already the binding: an app is identified within it, and a
#: second name would be a second state record for the same work.
APP_NAME = "index"


@dataclass(frozen=True, slots=True)
class IndexRun:
    """One index run: the binding it is for, in the workspace that holds it."""

    workspace_id: str
    binding_id: str
    #: Why this run is happening, as the job row carries it — `bound`, `restored`,
    #: `rule-change`, `wiped` or `narrowed`. The wipe's own order hangs off this word.
    reason: str


async def open_pool(
    database_url: str, workspace_id: str, *, max_size: int = POOL_MAX_SIZE
) -> asyncpg.Pool:
    """A pool that hands out no connection which is not scoped to this workspace.

    Two decisions, and the second is the one that is easy to get wrong.

    `set_config(..., false)` and not `true`: the third argument is whether the setting
    is local to the transaction, and the engine's writes land on connections outside any
    transaction this tier opened. The scope has to outlive a statement here, which is
    the opposite of what the worker's psycopg door wants and the reason the two differ.

    **And it is re-applied on every acquisition, not once when the connection opens.**
    asyncpg resets a connection when it goes back to the pool, and its reset is
    `RESET ALL` — which takes a session setting with it. A scope applied in the pool's
    `init` therefore holds for exactly as long as the first checkout and is gone from
    the second, so the first row of a run lands and a later one is refused by the
    policy. The hook that runs after the reset is `setup`, so that is where the
    scope goes.
    """

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
    """The one event loop the host owns, on a thread of its own.

    Every Environment is constructed against this loop, and every coroutine this module
    runs is submitted to it from outside. Nothing in this tier awaits on it, because the
    engine's blocking calls made from inside it never return.
    """

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
        """Run one coroutine on the host's loop and wait for it here."""
        return asyncio.run_coroutine_threadsafe(work, self._loop).result()

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)
        self._loop.close()


class Host:
    """What a process holds between index runs: the loop, the pools and the stores.

    Everything crossing this class's surface is a plain type. The Environments, the apps
    and the pool's identity to the engine stay inside it, which is what keeps the exit
    cost of the engine one directory (ADR 0036).
    """

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
        # The engine's core reads this once, from the process environment, when its
        # runtime first starts; there is no setting on the API for it. The deploy unit
        # sets it too, and this line is what makes a process started without it still
        # leave one shape on stdout rather than two.
        os.environ["RUST_LOG"] = self._engine.rust_log

    def __enter__(self) -> "Host":
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    # -- the stores on disk ----------------------------------------------------------

    def binding_directory(self, run: IndexRun) -> Path:
        """Where this binding's store lives — one directory per binding (ADR 0005).

        Under the workspace, so that what an operator sees on the volume is the shape
        the estate is in rather than a flat list of identifiers.
        """
        return Path(self._engine.lmdb_dir) / run.workspace_id / run.binding_id

    def lmdb_bytes(self, run: IndexRun) -> int:
        """How much disk the binding's store is using, or nothing when it has none.

        Read off the directory rather than asked of the engine: the number the compose
        file's per-binding cap is checked against is the one the filesystem reports, and
        a run that never opened a store answers zero rather than refusing.
        """
        directory = self.binding_directory(run)
        if not directory.is_dir():
            return 0
        return sum(
            item.stat().st_size for item in directory.rglob("*") if item.is_file()
        )

    def remove_binding_directory(self, run: IndexRun) -> None:
        """Forget this binding's store entirely, evicting it from the cache first.

        The order is not a preference: removing the directory under an open handle would
        leave the engine writing into a store nothing can read.
        """
        self.evict(run)
        shutil.rmtree(self.binding_directory(run), ignore_errors=True)

    # -- the pools -------------------------------------------------------------------

    def pool(self, workspace_id: str) -> asyncpg.Pool:
        """This workspace's pool, built on the host's loop the first time it is asked
        for. One per workspace and not one per binding: the scope a connection holds is
        the workspace's, so every Environment of one workspace shares these two
        connections rather than opening two of its own.
        """
        held = self._pools.get(workspace_id)
        if held is not None:
            return held
        opened = self._loop.run(open_pool(self._bootstrap.database_url, workspace_id))
        self._pools[workspace_id] = opened
        return opened

    # -- the Environments ------------------------------------------------------------

    def open_binding(self, run: IndexRun) -> None:
        """Make sure this binding's Environment is open and the most recently used."""
        self._environment(run)

    def held_bindings(self) -> tuple[str, ...]:
        """Which bindings the cache is holding, oldest touch first."""
        return tuple(self._environments)

    def evict(self, run: IndexRun) -> None:
        """Drop this binding's Environment, if the cache is holding one.

        Dropping the reference is the whole of it: a named Environment has no close, and
        what goes when the last reference does is the LMDB handle beneath it.
        """
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

    def _config(self, run: IndexRun) -> coco.AppConfig:
        return coco.AppConfig(
            name=APP_NAME,
            environment=self._environment(run),
            max_inflight_components=self._engine.max_inflight_components,
        )

    # -- the runs --------------------------------------------------------------------

    def land_rows(
        self, run: IndexRun, table: Table, rows: Sequence[Mapping[str, Any]]
    ) -> int:
        """Declare these rows against the table and let the engine converge it.

        Called from the caller's own thread, which is never the host's loop thread: the
        blocking form of an update never returns when it is called from inside the loop
        its Environment was given.
        """
        declared = tuple(rows)
        app = coco.App(self._config(run), declare_rows, table, declared)
        landed = app.update_blocking()
        return int(landed) if isinstance(landed, int) else len(declared)

    def drop_binding(self, run: IndexRun) -> None:
        """Revert everything this binding's app declared, and clear its store.

        For a user-managed target that reverts **nothing in Postgres** — not the table,
        not its indexes and not the rows this binding's own runs landed. The binding's
        chunk rows are deleted by the app, in its own transaction, before the job that
        removes this store is ever enqueued.
        """
        coco.App(self._config(run), declare_nothing).drop_blocking()

    def close(self) -> None:
        """Let every store go and close every pool, on the loop that opened them."""
        self._environments.clear()
        self._providers.clear()
        pools = list(self._pools.values())
        self._pools.clear()
        for pool in pools:
            self._loop.run(pool.close())
        self._loop.close()
