import json
import os
import subprocess
import sys

import pytest

from support.import_watch import held_when_imported

TELEMETRY = "ORT_DISABLE_TELEMETRY"


def telemetry_setting_when_onnxruntime_is_imported(
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
        (
            "a module outside the detector's package that loads onnxruntime itself",
            "import better_answers_worker.ids\nimport onnxruntime",
        ),
    ],
)
def test_onnxruntime_is_imported_with_its_telemetry_switched_off(
    why: str, ran: str
) -> None:
    assert telemetry_setting_when_onnxruntime_is_imported(ran, {}) == [
        {TELEMETRY: "1"}
    ], why


def test_onnxruntime_telemetry_stays_off_when_the_environment_enables_it() -> None:
    assert telemetry_setting_when_onnxruntime_is_imported(
        "import better_answers_worker.redaction.detector", {TELEMETRY: "0"}
    ) == [{TELEMETRY: "1"}]


IMPORT_ONLY_THE_ROOT_PACKAGE = f"""
import json
import os
import sys

import better_answers_worker

print(json.dumps([os.environ.get({TELEMETRY!r}), "onnxruntime" in sys.modules]))
"""


def test_importing_the_root_package_disables_telemetry_and_skips_onnxruntime() -> None:
    finished = subprocess.run(
        [sys.executable, "-c", IMPORT_ONLY_THE_ROOT_PACKAGE],
        env={name: value for name, value in os.environ.items() if name != TELEMETRY},
        capture_output=True,
        text=True,
        check=True,
    )

    assert json.loads(finished.stdout.splitlines()[-1]) == ["1", False]
