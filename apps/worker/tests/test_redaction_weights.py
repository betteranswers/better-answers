"""The weight table and the build step that runs it, held to each other (`T-122`).

The cheap half of the image's promise, and the half that runs on every `check` whether
or not a Docker daemon answered. Two things a change could otherwise break in silence:
the table naming a model the pins do not — an image whose network-refused container
cannot load what it was asked to load — or the table quietly regaining the model the pin
was measured against, which is a second repository of weights in every layer a deploy
pulls, for a comparison made once and written down. And the Dockerfile naming the model
ids a second time, which is the drift `[DEPS2]` exists to stop.

`pins.py` declares one id the table deliberately does not fetch. That is not the drift
above: `GLINER_MODEL_ID_MEASURED` is the id the 11 September 2026 comparison was taken
against, kept as a pinned constant because the version-string guard in
`tests/test_image.py` has to name it to assert its absence from a finding.

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


def test_the_table_fetches_the_model_the_seam_runs_and_nothing_beside_it() -> None:
    # Both ways (`[TEST7]`): the one model the seam runs is fetched, and the one it was
    # measured against is not. A table that merely contained the pin would pass the
    # first direction while pulling a second model no container ever loads — which is
    # what this table did until the comparison it carried that model for was made,
    # recorded in `tests/test_image.py`'s docblock, and the model dropped.
    assert WEIGHTS == (GLINER_MODEL_ID,)
    assert GLINER_MODEL_ID_MEASURED not in WEIGHTS
    assert len(WEIGHTS) == 1


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
