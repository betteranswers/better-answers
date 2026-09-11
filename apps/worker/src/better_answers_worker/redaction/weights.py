"""Every model weight the image carries, warmed at build and never fetched at run time.

The worker's Dockerfile runs this module once, under an ``HF_HOME`` the build then
copies into the runtime stage, and the shipped image sets ``HF_HUB_OFFLINE`` over it. So
a weight nobody fetched here fails loudly the first time a job asks for it, rather than
reaching for a registry from a box that may have no route to one — and a pin that moved
without a rebuild is an image that cannot start the seam, which is the direction this
has to fail in.

**It fetches by loading, not by snapshotting.** A snapshot of a model's own repository
is both too much and too little. Too much: one of the two pinned repositories carries
over a gigabyte of ONNX variants no PyTorch load ever reads. Too little: the base
encoder's tokenizer lives in a *second* repository — four megabytes, a separate cache
entry — so a container given only the model's own repository is one small fetch short of
working, and would discover that on its first document rather than here. Building the
seam's own analyzer is what makes the set of warmed entries exactly the set a run-time
load touches, because it is the same load.

The analyzer it builds also brings up the spaCy pipeline the context enhancer reads its
lemmas from. That one is a pinned wheel in ``uv.lock`` rather than an entry under
``HF_HOME``, so ``uv sync`` has already installed it and there is nothing here to fetch;
loading it anyway is how the build finds out, at build, that it cannot.

This module reads no environment variable. ``config.py`` is the only module in the tier
that reads one (`[WRK2]`), and it has no business knowing about a cache the image bakes:
``HF_HOME`` is set by the Dockerfile for this process and by the image for the
container's, and it is ``huggingface_hub`` that reads it, never anything of ours.
"""

from typing import Final

from .engine import build_analyzer
from .pins import GLINER_MODEL_ID, GLINER_MODEL_ID_MEASURED

#: Every model the image carries, declared once: the model the seam runs, and the one S0
#: measures it against on the fixture's page (`T-122`). A test holds this against the
#: pins both ways, so neither can gain a model the other does not have.
WEIGHTS: Final = (GLINER_MODEL_ID, GLINER_MODEL_ID_MEASURED)


def fetch() -> None:
    """Warm every cache entry a run-time load will read, by doing the load.

    Each analyzer is discarded as soon as it is built: what is wanted is the bytes it
    left on disk, and holding two of them alive at once would be twice the weights in
    one build step's memory for no reason.
    """
    for model_id in WEIGHTS:
        build_analyzer(model_id)


if __name__ == "__main__":
    fetch()
