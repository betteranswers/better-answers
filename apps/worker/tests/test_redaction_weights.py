from pathlib import Path

from better_answers_worker.redaction.pins import (
    GLINER_MODEL_ID,
    GLINER_MODEL_ID_MEASURED,
)
from better_answers_worker.redaction.weights import WEIGHTS

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


def test_the_table_fetches_the_model_the_seam_runs_and_nothing_beside_it() -> None:

    assert WEIGHTS == (GLINER_MODEL_ID,)
    assert GLINER_MODEL_ID_MEASURED not in WEIGHTS
    assert len(WEIGHTS) == 1


def test_the_two_models_are_two_models() -> None:

    assert GLINER_MODEL_ID != GLINER_MODEL_ID_MEASURED


def test_the_build_fetches_the_weights_by_running_the_module_that_declares_them() -> (
    None
):

    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.weights" in dockerfile
    assert GLINER_MODEL_ID not in dockerfile
    assert GLINER_MODEL_ID_MEASURED not in dockerfile
