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

GLINER_FALLBACK_WARNING = "low_cpu_mem_usage=True is not supported for this load"


WEIGHTS_FILENAME = "pytorch_model.bin"


PROC_MAPS = Path("/proc/self/maps")


@pytest.fixture(scope="module")
def recogniser() -> ModelRecogniser:
    # gliner only warns when it falls back to a load that copies the weights, so
    # the test turns that warning into an error.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "error", message=GLINER_FALLBACK_WARNING, category=UserWarning
        )
        analyzer = build_analyzer()
    [built] = [
        each
        for each in analyzer.registry.recognizers
        if isinstance(each, ModelRecogniser)
    ]
    return built


def gliner_weights_path() -> Path:
    snapshot = Path(snapshot_download(GLINER_MODEL_ID, local_files_only=True))
    return (snapshot / WEIGHTS_FILENAME).resolve()


def memory_mapped_files() -> set[Path]:
    if PROC_MAPS.exists():
        return {
            Path(fields[5])
            for fields in (
                line.split(maxsplit=5) for line in PROC_MAPS.read_text().splitlines()
            )
            if len(fields) == 6
        }
    # macOS has no /proc, so this asks lsof, which lists each file the process
    # has mapped with the descriptor `txt`.
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


def test_the_recogniser_asks_gliner_for_low_cpu_memory_usage(
    recogniser: ModelRecogniser,
) -> None:
    assert recogniser.gliner.model_kwargs == {"low_cpu_mem_usage": True}


def test_gliner_weights_are_memory_mapped_and_all_tensors_on_cpu(
    recogniser: ModelRecogniser,
) -> None:
    gliner_model = recogniser.gliner.gliner
    assert isinstance(gliner_model, torch.nn.Module)

    assert {
        tensor.device.type
        for tensor in chain(gliner_model.parameters(), gliner_model.buffers())
    } == {"cpu"}
    assert gliner_weights_path() in memory_mapped_files(), (
        "this process has not memory-mapped the gliner weights file"
    )


@pytest.mark.usefixtures("recogniser")
def test_torch_leaves_global_mmap_loading_off_after_building_the_detector() -> None:
    assert gliner_weights_path() in memory_mapped_files()
    assert torch.utils.serialization.config.load.mmap is False
