import pytest

from import_watch import held_when_imported

TELEMETRY = "ORT_DISABLE_TELEMETRY"


def held_when_onnxruntime_was_imported(
    ran: str, box: dict[str, str]
) -> list[dict[str, str]]:
    return held_when_imported("onnxruntime", (TELEMETRY,), ran, box)


@pytest.mark.parametrize(
    ("why", "ran"),
    [
        (
            "the detector's own module, which a pass that detects loads",
            "import better_answers_worker.redaction.detector",
        ),
        (
            "the daemon's warm-up at boot",
            "from better_answers_worker.loop import warm_the_detectors_stack\n"
            "warm_the_detectors_stack('worker-under-test')",
        ),
    ],
)
def test_onnxruntime_is_imported_with_its_telemetry_switched_off(
    why: str, ran: str
) -> None:
    assert held_when_onnxruntime_was_imported(ran, {}) == [{TELEMETRY: "1"}], why


def test_a_box_that_switches_the_telemetry_on_is_overruled() -> None:
    assert held_when_onnxruntime_was_imported(
        "import better_answers_worker.redaction.detector", {TELEMETRY: "0"}
    ) == [{TELEMETRY: "1"}]
