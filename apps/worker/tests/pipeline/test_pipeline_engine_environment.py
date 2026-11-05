import pytest

from support.deploy_unit import worker_environment
from support.import_watch import held_when_imported

USAGE_TRACKING = "COCOINDEX_DISABLE_USAGE_TRACKING"
CORE_LOG_LEVEL = "RUST_LOG"


def environment_seen_by_the_cocoindex_import(
    environment: dict[str, str],
) -> list[dict[str, str]]:
    return held_when_imported(
        "cocoindex",
        (USAGE_TRACKING, CORE_LOG_LEVEL),
        "import better_answers_worker.pipeline",
        environment,
    )


@pytest.mark.parametrize(
    ("why", "environment"),
    [
        ("a process nothing configured, which is the laptop's", {}),
        ("a box that set the level to nothing", {CORE_LOG_LEVEL: ""}),
    ],
)
def test_an_unconfigured_process_imports_cocoindex_with_the_deploy_settings(
    why: str, environment: dict[str, str]
) -> None:
    assert environment_seen_by_the_cocoindex_import(environment) == [
        {
            USAGE_TRACKING: worker_environment(USAGE_TRACKING),
            CORE_LOG_LEVEL: worker_environment(CORE_LOG_LEVEL),
        }
    ], why


def test_the_host_can_set_rust_log_but_not_usage_tracking() -> None:
    assert environment_seen_by_the_cocoindex_import(
        {USAGE_TRACKING: "0", CORE_LOG_LEVEL: "debug"}
    ) == [{USAGE_TRACKING: worker_environment(USAGE_TRACKING), CORE_LOG_LEVEL: "debug"}]
