import pytest

from deploy_unit import worker_environment
from import_watch import held_when_imported

USAGE_TRACKING = "COCOINDEX_DISABLE_USAGE_TRACKING"
CORE_LOG_LEVEL = "RUST_LOG"


def held_when_the_engine_was_imported(box: dict[str, str]) -> list[dict[str, str]]:
    return held_when_imported(
        "cocoindex",
        (USAGE_TRACKING, CORE_LOG_LEVEL),
        "import better_answers_worker.pipeline",
        box,
    )


@pytest.mark.parametrize(
    ("why", "box"),
    [
        ("a process nothing configured, which is the laptop's", {}),
        ("a box that set the level to nothing", {CORE_LOG_LEVEL: ""}),
    ],
)
def test_a_process_nothing_configured_imports_the_engine_as_the_deploy_unit_would(
    why: str, box: dict[str, str]
) -> None:
    assert held_when_the_engine_was_imported(box) == [
        {
            USAGE_TRACKING: worker_environment(USAGE_TRACKING),
            CORE_LOG_LEVEL: worker_environment(CORE_LOG_LEVEL),
        }
    ], why


def test_a_box_that_says_otherwise_wins_on_the_level_and_never_on_the_gateway() -> None:
    assert held_when_the_engine_was_imported(
        {USAGE_TRACKING: "0", CORE_LOG_LEVEL: "debug"}
    ) == [{USAGE_TRACKING: worker_environment(USAGE_TRACKING), CORE_LOG_LEVEL: "debug"}]
