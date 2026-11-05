import re

import pytest

from better_answers_worker.config import (
    CONCURRENT_RUNS,
    LMDB_MAP_BYTES,
    MAX_INFLIGHT_COMPONENTS,
    BootstrapError,
    read_bootstrap,
)
from support.deploy_unit import worker_service

COMPLETE = {
    "DATABASE_URL": "postgresql://worker_rt@db/better_answers",
    "GIT_STORE_DIR": "/data/git",
    "LMDB_DIR": "/data/worker/lmdb",
    "S3_ENDPOINT": "http://objectstore:3900",
    "S3_ACCESS_KEY": "key",
    "S3_SECRET_KEY": "secret",
    "S3_BUCKET": "better-answers",
    "S3_REGION": "garage",
    "WORKER_ID": "worker-under-test",
}


def test_bootstrap_reads_the_object_store_settings() -> None:
    read = read_bootstrap(COMPLETE)

    assert read.object_store.endpoint == "http://objectstore:3900"
    assert read.object_store.access_key == "key"
    assert read.object_store.secret_key == "secret"
    assert read.object_store.bucket == "better-answers"
    assert read.object_store.region == "garage"


def test_bootstrap_reads_the_engine_settings_with_the_worker_defaults() -> None:
    read = read_bootstrap(
        {**COMPLETE, "LMDB_MAX_BYTES_PER_CONNECTED_SOURCE": "4294967296"}
    )

    assert read.engine.lmdb_dir == "/data/worker/lmdb"
    assert read.engine.lmdb_map_bytes == 4_294_967_296
    assert read.engine.max_inflight_components == 4
    assert read.engine.concurrent_runs == 1


def test_the_engine_limit_constants_have_their_chosen_values() -> None:
    assert LMDB_MAP_BYTES == 4_294_967_296
    assert MAX_INFLIGHT_COMPONENTS == 4
    assert CONCURRENT_RUNS == 1


def test_bootstrap_refuses_max_concurrent_runs_above_one() -> None:
    with pytest.raises(BootstrapError) as refusal:
        read_bootstrap({**COMPLETE, "MAX_CONCURRENT_RUNS": "2"})

    assert "MAX_CONCURRENT_RUNS is 2" in str(refusal.value)
    assert (
        read_bootstrap({**COMPLETE, "MAX_CONCURRENT_RUNS": "1"}).engine.concurrent_runs
        == 1
    )


def test_the_bootstrap_error_names_each_missing_variable() -> None:
    with pytest.raises(BootstrapError) as refusal:
        read_bootstrap({"DATABASE_URL": "postgresql://worker_rt@db/better_answers"})

    message = str(refusal.value)
    for variable in (
        "GIT_STORE_DIR",
        "LMDB_DIR",
        "S3_ENDPOINT",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "S3_BUCKET",
        "S3_REGION",
    ):
        assert variable in message


def test_the_compose_file_gives_the_worker_its_lmdb_directory() -> None:
    worker = worker_service()

    assert re.search(r"^\s+LMDB_DIR:\s+/data/worker/lmdb\s", worker, re.M) is not None
