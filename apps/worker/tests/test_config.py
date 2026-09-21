import re

import pytest

from better_answers_worker.config import (
    CONCURRENT_RUNS,
    LMDB_MAP_BYTES,
    MAX_INFLIGHT_COMPONENTS,
    BootstrapError,
    read_bootstrap,
)
from deploy_unit import worker_service

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


def test_the_bootstrap_carries_the_object_store_the_compose_file_hands_both_tiers() -> (
    None
):
    read = read_bootstrap(COMPLETE)

    assert read.object_store.endpoint == "http://objectstore:3900"
    assert read.object_store.access_key == "key"
    assert read.object_store.secret_key == "secret"
    assert read.object_store.bucket == "better-answers"
    assert read.object_store.region == "garage"


def test_the_engines_defaults_come_from_the_box_and_not_from_the_engine() -> None:
    read = read_bootstrap({**COMPLETE, "LMDB_MAX_BYTES_PER_BINDING": "4294967296"})

    assert read.engine.lmdb_dir == "/data/worker/lmdb"
    assert read.engine.lmdb_map_bytes == 4_294_967_296
    assert read.engine.max_inflight_components == 4
    assert read.engine.concurrent_runs == 1


def test_the_constants_are_the_numbers_this_tier_settled_on() -> None:
    assert LMDB_MAP_BYTES == 4_294_967_296
    assert MAX_INFLIGHT_COMPONENTS == 4
    assert CONCURRENT_RUNS == 1


def test_more_than_one_concurrent_run_is_refused_rather_than_quietly_reduced() -> None:
    with pytest.raises(BootstrapError) as refusal:
        read_bootstrap({**COMPLETE, "MAX_CONCURRENT_RUNS": "2"})

    assert "MAX_CONCURRENT_RUNS is one" in str(refusal.value)
    assert (
        read_bootstrap({**COMPLETE, "MAX_CONCURRENT_RUNS": "1"}).engine.concurrent_runs
        == 1
    )


def test_a_missing_bootstrap_value_is_named_rather_than_implied() -> None:
    with pytest.raises(BootstrapError) as refusal:
        read_bootstrap({"DATABASE_URL": "postgresql://worker_rt@db/better_answers"})

    named = str(refusal.value)
    for owed in (
        "GIT_STORE_DIR",
        "LMDB_DIR",
        "S3_ENDPOINT",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "S3_BUCKET",
        "S3_REGION",
    ):
        assert owed in named


def test_the_compose_file_gives_the_worker_the_variable_this_wave_reads() -> None:
    worker = worker_service()

    assert re.search(r"^\s+LMDB_DIR:\s+/data/worker/lmdb\s", worker, re.M) is not None
