"""The bootstrap credential class, and the only place in the tier that reads the
environment.

The bootstrap class is what the deploy unit must give the process before it can reach
anything. Every other credential class — ingestion, acting, agent, LLM provider,
repository — is a row under the envelope, decrypted by the app and injected per run
through the control plane, and never mixed into this scope (ADR 0005).

**The platform's own object store is bootstrap class**, which is why it is here and its
address is not a row: the compose file hands the same four values to both tiers, and a
client's own store as a *source* is the envelope's business and S4's. The embedding host
joins this module the day a step in this tier reads one.

**The engine's defaults are read here too, and they are read here because this is where
the tier reads the environment at all.** cocoindex ships defaults sized for a machine
this estate does not have — an initial LMDB map of 4 GiB that doubles on demand, and a
thousand components in flight at once — so the box states them instead, and the pipeline
takes them from this class rather than from the engine's own fallbacks. A variable no
step in this tier reads yet does not belong in this module, which is why each of these
arrived with the code that first read it.
"""

import socket
from collections.abc import Mapping
from dataclasses import dataclass
from os import environ

REQUIRED = (
    "DATABASE_URL",
    "GIT_STORE_DIR",
    "LMDB_DIR",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
    "S3_REGION",
)

#: The initial size of a binding's LMDB memory map, and the size the compose file caps a
#: binding at. The engine treats its own value as a floor rather than a ceiling — it
#: doubles the map and retries whenever a write runs out of room — so this number is
#: what the map starts at, and a binding whose store outgrows the cap is wiped and
#: reprocessed because the store is disposable (ADR 0005, ADR 0036).
LMDB_MAP_BYTES = 4_294_967_296

#: How many of a run's components the engine may have in flight at once. Its own default
#: is a thousand, which is sized for a machine with a thousand documents' worth of
#: memory to spare; this tier runs one index at a time inside a 1.5 GB limit (ADR 0024)
#: and the detector's model is what costs, so a run fans a handful of documents
#: and not a crowd.
MAX_INFLIGHT_COMPONENTS = 4

#: How many index runs one worker process may have open. The loop claims and runs one
#: job at a time, so anything above one would be a number describing something that
#: cannot happen; a higher value waits on S4's own measurement.
CONCURRENT_RUNS = 1

#: What the engine's Rust core is told to print. It installs a global tracing subscriber
#: at `info` on first use of its runtime and writes its own non-JSON shape to stdout,
#: and `RUST_LOG` is the only thing that quiets it — so the tier that has one logger
#: states the level here as well as in the deploy file, and one JSON shape leaves
#: the process.
RUST_LOG = "warn"


class BootstrapError(ValueError):
    """The worker was started without the environment the deploy unit owes it."""


@dataclass(frozen=True, slots=True)
class ObjectStore:
    """The platform's own object store, where a landed copy and its normalised copy sit.

    Path-style against Garage in the first estate, which is why the endpoint is a plain
    address and the region is a word that estate chose rather than an AWS one.
    """

    endpoint: str
    access_key: str
    secret_key: str
    bucket: str
    region: str


@dataclass(frozen=True, slots=True)
class Engine:
    """What the box tells the indexing engine, instead of the engine's own defaults."""

    #: The root the per-binding stores live under, one directory per binding beneath it.
    #: On the worker's own volume and never backed up: it holds personal data and it is
    #: disposable (ADR 0005).
    lmdb_dir: str
    lmdb_map_bytes: int = LMDB_MAP_BYTES
    max_inflight_components: int = MAX_INFLIGHT_COMPONENTS
    concurrent_runs: int = CONCURRENT_RUNS
    rust_log: str = RUST_LOG


@dataclass(frozen=True, slots=True)
class Bootstrap:
    database_url: str
    #: Where the bare repositories live, one per workspace (ADR 0024). Mounted
    #: read-only: the app is the only writer of a bundle, and this tier reads one at a
    #: commit.
    git_store_dir: str
    #: Which worker this is, on every claim and every lease it holds. The container's
    #: hostname unless the deploy unit says otherwise, which is what makes two replicas
    #: of one image tell themselves apart with nothing to configure.
    worker_id: str
    object_store: ObjectStore
    engine: Engine


def _one_run_only(source: Mapping[str, str]) -> int:
    """`MAX_CONCURRENT_RUNS`, read and held to one.

    A box that asked for two would get one silently if this only read the variable, and
    an operator who raised it would believe something that is not true: the loop claims
    one job at a time per process, so the number is a statement about the deploy unit
    and the process disagreeing, which is worth refusing to start over.
    """
    stated = source.get("MAX_CONCURRENT_RUNS")
    if stated is None or stated == "":
        return CONCURRENT_RUNS
    try:
        runs = int(stated)
    except ValueError:
        raise BootstrapError(
            f"MAX_CONCURRENT_RUNS is not a number: {stated!r}"
        ) from None
    if runs != CONCURRENT_RUNS:
        raise BootstrapError(
            "MAX_CONCURRENT_RUNS is one: this worker runs a single job at a time,"
            f" and the environment asks for {runs}"
        )
    return runs


def _positive_bytes(source: Mapping[str, str], name: str, fallback: int) -> int:
    stated = source.get(name)
    if stated is None or stated == "":
        return fallback
    try:
        value = int(stated)
    except ValueError:
        raise BootstrapError(f"{name} is not a number: {stated!r}") from None
    if value <= 0:
        raise BootstrapError(f"{name} is not a size: {value}")
    return value


def read_bootstrap(environment: Mapping[str, str] | None = None) -> Bootstrap:
    """Read and validate the bootstrap environment, or say exactly what is missing."""
    source = environ if environment is None else environment

    missing = [name for name in REQUIRED if not source.get(name)]
    if missing:
        raise BootstrapError(
            "bootstrap configuration is incomplete: " + ", ".join(missing)
        )

    return Bootstrap(
        database_url=source["DATABASE_URL"],
        git_store_dir=source["GIT_STORE_DIR"],
        worker_id=source.get("WORKER_ID") or socket.gethostname(),
        object_store=ObjectStore(
            endpoint=source["S3_ENDPOINT"],
            access_key=source["S3_ACCESS_KEY"],
            secret_key=source["S3_SECRET_KEY"],
            bucket=source["S3_BUCKET"],
            region=source["S3_REGION"],
        ),
        engine=Engine(
            lmdb_dir=source["LMDB_DIR"],
            lmdb_map_bytes=_positive_bytes(
                source, "LMDB_MAX_BYTES_PER_BINDING", LMDB_MAP_BYTES
            ),
            concurrent_runs=_one_run_only(source),
            rust_log=source.get("RUST_LOG") or RUST_LOG,
        ),
    )
