"""The weight table and the build step that runs it, held to each other (`T-122`).

The cheap half of the image's promise, and the half that runs on every `check` whether
or not a Docker daemon answered. Two things a change could otherwise break in silence:
the table naming a model the pins do not, or the pins naming a model the table never
fetches — either of which ships an image whose network-refused container cannot load
what it was asked to load — and the Dockerfile naming the model ids a second time,
which is the drift `[DEPS2]` exists to stop.

The expensive half is `tests/test_image.py`: a container started from the built image
with its network refused, which is the only place the weights are proved present rather
than declared.
"""

from pathlib import Path

from better_answers_worker.redaction.pins import (
    GLINER_MODEL_ID,
    GLINER_MODEL_ID_MEASURED,
)
from better_answers_worker.redaction.weights import WEIGHTS

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


def test_the_table_fetches_both_pinned_models_and_nothing_else() -> None:
    # Both ways (`[TEST7]`): every pin is fetched, and nothing is fetched that no pin
    # names. A table that merely contained the two would pass the first direction while
    # pulling a third model nobody read a version for.
    assert WEIGHTS == (GLINER_MODEL_ID, GLINER_MODEL_ID_MEASURED)
    assert set(WEIGHTS) == {GLINER_MODEL_ID, GLINER_MODEL_ID_MEASURED}
    assert len(WEIGHTS) == 2


def test_the_two_models_are_two_models() -> None:
    # The pin and the one measured against it. Were they to become the same string the
    # measurement would compare a model with itself and report a difference of nothing.
    assert GLINER_MODEL_ID != GLINER_MODEL_ID_MEASURED


def test_the_build_fetches_the_weights_by_running_the_module_that_declares_them() -> (
    None
):
    # The ids live in `pins.py` and reach the build by being imported there, so the
    # Dockerfile names a module and never a model. A `RUN` that spelled an id would be a
    # second pin, ageing on its own the first time one of these moves.
    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.weights" in dockerfile
    assert GLINER_MODEL_ID not in dockerfile
    assert GLINER_MODEL_ID_MEASURED not in dockerfile
