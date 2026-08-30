"""The worker's bootstrap configuration, through the module's entry point."""

import pytest

from better_answers_worker.config import Bootstrap, BootstrapError, read_bootstrap

ESTATE = {
    "DATABASE_URL": "postgresql://worker@platform:5432/better_answers",
    "S3_ENDPOINT": "http://objectstore:3900",
    "S3_ACCESS_KEY": "key",
    "S3_SECRET_KEY": "secret",
}


def test_reads_the_stores_the_deploy_unit_gives_the_worker() -> None:
    assert read_bootstrap(ESTATE) == Bootstrap(
        database_url="postgresql://worker@platform:5432/better_answers",
        object_store_endpoint="http://objectstore:3900",
        object_store_access_key="key",
        object_store_secret_key="secret",
        embeddings_url=None,
    )


def test_reads_no_embedding_host_in_an_estate_that_runs_none() -> None:
    assert read_bootstrap({**ESTATE, "EMBEDDINGS_URL": ""}).embeddings_url is None


def test_reads_the_embedding_host_once_an_estate_runs_one() -> None:
    started = read_bootstrap({**ESTATE, "EMBEDDINGS_URL": "http://embeddings:8080"})

    assert started.embeddings_url == "http://embeddings:8080"


def test_refuses_to_start_rather_than_run_without_the_platform_database() -> None:
    incomplete = {
        name: value for name, value in ESTATE.items() if name != "DATABASE_URL"
    }

    with pytest.raises(BootstrapError, match="DATABASE_URL"):
        read_bootstrap(incomplete)
