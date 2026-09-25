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


LMDB_MAP_BYTES = 4_294_967_296


MAX_INFLIGHT_COMPONENTS = 4


CONCURRENT_RUNS = 1


class BootstrapError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ObjectStore:
    endpoint: str
    access_key: str
    secret_key: str
    bucket: str
    region: str


@dataclass(frozen=True, slots=True)
class Engine:
    """`lmdb_map_bytes` is one binding's cap across
    both its stores; `concurrent_runs` is always one."""

    lmdb_dir: str
    lmdb_map_bytes: int = LMDB_MAP_BYTES
    max_inflight_components: int = MAX_INFLIGHT_COMPONENTS
    concurrent_runs: int = CONCURRENT_RUNS


@dataclass(frozen=True, slots=True)
class Bootstrap:
    database_url: str

    git_store_dir: str

    worker_id: str
    object_store: ObjectStore
    engine: Engine


def _one_run_only(source: Mapping[str, str]) -> int:
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
    """Reads `os.environ` when `environment` is None; `WORKER_ID` falls back to
    the host name. Raises `BootstrapError` naming every missing variable, or for
    a size that is not a positive number or `MAX_CONCURRENT_RUNS` other than one."""
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
        ),
    )
