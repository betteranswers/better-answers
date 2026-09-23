import os
import subprocess
import warnings
from itertools import chain, pairwise
from pathlib import Path

import pytest
import torch.utils.serialization
from huggingface_hub import snapshot_download

from better_answers_worker.redaction.detector import ModelRecogniser
from better_answers_worker.redaction.engine import build_analyzer
from better_answers_worker.redaction.pins import GLINER_MODEL_ID

GLINER_FALLS_BACK = "low_cpu_mem_usage=True is not supported for this load"


THE_WEIGHTS_FILE = "pytorch_model.bin"


PROC_MAPS = Path("/proc/self/maps")


@pytest.fixture(scope="module")
def recogniser() -> ModelRecogniser:
    # gliner only warns when it falls back to the load that holds the weights twice;
    # as an error, the failure names that cause.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "error", message=GLINER_FALLS_BACK, category=UserWarning
        )
        analyzer = build_analyzer()
    [built] = [
        each
        for each in analyzer.registry.recognizers
        if isinstance(each, ModelRecogniser)
    ]
    return built


def the_weights_file() -> Path:
    snapshot = Path(snapshot_download(GLINER_MODEL_ID, local_files_only=True))
    return (snapshot / THE_WEIGHTS_FILE).resolve()


def files_this_process_maps() -> set[Path]:
    if PROC_MAPS.exists():
        return {
            Path(fields[5])
            for fields in (
                line.split(maxsplit=5) for line in PROC_MAPS.read_text().splitlines()
            )
            if len(fields) == 6
        }
    # macOS has no /proc: lsof names each file a process has mapped under the
    # descriptor `txt`.
    listed = subprocess.run(
        ["lsof", "-n", "-P", "-p", str(os.getpid()), "-F", "fn"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    return {
        Path(name.removeprefix("n"))
        for descriptor, name in pairwise(listed)
        if descriptor == "ftxt" and name.startswith("n")
    }


def test_the_detector_asks_gliner_for_the_load_that_holds_its_weights_once(
    recogniser: ModelRecogniser,
) -> None:
    assert recogniser.gliner.model_kwargs == {"low_cpu_mem_usage": True}


def test_the_detectors_weights_are_its_file_mapped_and_none_is_left_on_meta(
    recogniser: ModelRecogniser,
) -> None:
    gliner_model = recogniser.gliner.gliner
    assert isinstance(gliner_model, torch.nn.Module)

    assert {
        tensor.device.type
        for tensor in chain(gliner_model.parameters(), gliner_model.buffers())
    } == {"cpu"}
    assert the_weights_file() in files_this_process_maps()


@pytest.mark.usefixtures("recogniser")
def test_torch_maps_a_file_for_the_detectors_build_and_for_nothing_after_it() -> None:
    assert the_weights_file() in files_this_process_maps()
    assert torch.utils.serialization.config.load.mmap is False
