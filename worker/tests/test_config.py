"""The worker's bootstrap configuration, through the module's entry point."""

import pytest

from better_answers_worker.config import Bootstrap, BootstrapError, read_bootstrap


def test_reads_the_platform_database_the_deploy_unit_gives_the_worker() -> None:
    given = {"DATABASE_URL": "postgresql://worker@platform:5432/better_answers"}

    assert read_bootstrap(given) == Bootstrap(
        database_url="postgresql://worker@platform:5432/better_answers"
    )


def test_ignores_an_environment_variable_no_step_in_this_tier_reads_yet() -> None:
    given = {
        "DATABASE_URL": "postgresql://worker@platform:5432/better_answers",
        "S3_ENDPOINT": "http://objectstore:3900",
    }

    assert read_bootstrap(given).database_url.endswith("better_answers")


def test_refuses_to_start_rather_than_run_without_the_platform_database() -> None:
    with pytest.raises(BootstrapError, match="DATABASE_URL"):
        read_bootstrap({})


def test_refuses_to_start_when_the_platform_database_is_set_but_empty() -> None:
    with pytest.raises(BootstrapError, match="DATABASE_URL"):
        read_bootstrap({"DATABASE_URL": ""})
