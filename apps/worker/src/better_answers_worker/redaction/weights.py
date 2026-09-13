"""Every model weight the image carries, warmed at build and never fetched at run time.

The worker's Dockerfile runs this module once, under an ``HF_HOME`` on a build cache
mount, and hands it the directory the runtime stage will read; it warms every entry a
load touches and then copies the warmed repositories to that directory itself. The
shipped image sets ``HF_HUB_OFFLINE`` over them. So a weight nobody fetched here fails
loudly the first time a job asks for it, rather than reaching for a registry from a box
that may have no route to one — and a pin that moved without a rebuild is an image that
cannot start the seam, which is the direction this has to fail in.

**It fetches by loading, not by snapshotting.** A snapshot of a model's own repository
is both too much and too little. Too much: a repository carries variants no PyTorch load
ever reads — ONNX above all, and by the gigabyte. Too little: the base encoder's
tokenizer lives in a *second* repository — four megabytes, a separate cache entry — so a
container given only the model's own repository is one small fetch short of working, and
would discover that on its first document rather than here. Building the seam's own
analyzer is what makes the set of warmed entries exactly the set a run-time load
touches, because it is the same load.

The analyzer it builds also brings up the spaCy pipeline the context enhancer reads its
lemmas from. That one is a pinned wheel in ``uv.lock`` rather than an entry under
``HF_HOME``, so ``uv sync`` has already installed it and there is nothing here to fetch;
loading it anyway is how the build finds out, at build, that it cannot.

**The copy out is this module's and not a shell's, because it has to be bounded by the
table.** A ``--mount=type=cache`` ships in no layer, so the weights reach the image only
by being copied off it; and that mount is shared by every build on a machine, so copying
the whole of it made the image whatever the mount happened to hold rather than what the
table declares. `T-148` dropped a model from the table and the next warm build still
shipped its 1.7 GB, because a build weeks earlier had fetched it. What is copied now is
the repositories this table names and the base encoder each of those names in its own
published configuration — so a repository nobody declared cannot reach a layer, however
it got into the cache.

This module reads no environment variable. ``config.py`` is the only module in this tier
allowed to read one, and it has no business knowing about a cache the image bakes: the
directory to copy into arrives on the command line, ``HF_HOME`` is set by the Dockerfile
for this process and by the image for the container's, and it is ``huggingface_hub``
that reads it — including when this module asks it where the cache it just warmed is.
"""

import json
import shutil
import sys
from pathlib import Path
from typing import Final

from huggingface_hub import constants, snapshot_download

from .engine import build_analyzer
from .pins import GLINER_MODEL_ID

#: Every model the image carries, declared once: the model the seam runs, and nothing
#: beside it. It carried a second until `T-148` — `GLINER_MODEL_ID_MEASURED`, there so
#: S0 could measure the pin against it on the fixture's own page. That comparison was
#: taken once, on 11 September 2026, and its figures are recorded in
#: `tests/test_image.py`'s docblock. Carrying the model on past it bought nothing and
#: cost every deploy the whole of its repository, over a gigabyte of which is the ONNX
#: variants no PyTorch load ever reads — so the id stays a pin in `pins.py`, where the
#: version string still has to name it to assert its absence, and leaves this table. A
#: test holds this against the pins both ways, so the table can neither lose the model
#: the seam runs nor regain the one it does not.
WEIGHTS: Final = (GLINER_MODEL_ID,)

#: Where a GLiNER repository names the encoder it was trained on, in the configuration
#: it publishes beside its weights — the same field GLiNER itself reads to build the
#: backbone. Reading it is what keeps the second repository derived from the model
#: rather than listed beside it: a list would be a second pin, ageing apart from the
#: table the day a pin moved to a model built on a different encoder.
_ENCODER_DECLARATION: Final = "gliner_config.json"
_ENCODER_KEY: Final = "model_name"


def fetch() -> None:
    """Warm every cache entry a run-time load will read, by doing the load.

    Each analyzer is discarded as soon as it is built: what is wanted is the bytes it
    left on disk, and holding every analyzer the table names alive at once would be that
    many copies of the weights in one build step's memory for no reason.
    """
    for model_id in WEIGHTS:
        build_analyzer(model_id)


def carried_repositories() -> tuple[Path, ...]:
    """Every repository a run-time load reads, as a directory in the warmed cache.

    Two per model and not one, for the reason the docblock gives: the model's own
    repository, and the repository its tokenizer comes from. Both are resolved with
    ``local_files_only``, so this answers only for a cache `fetch` has already warmed
    and raises rather than reaching the network to find out.
    """
    found: dict[str, Path] = {}
    for model_id in WEIGHTS:
        snapshot = Path(snapshot_download(model_id, local_files_only=True))
        found[model_id] = snapshot.parent.parent
        declared = json.loads((snapshot / _ENCODER_DECLARATION).read_text("utf-8"))
        encoder = declared[_ENCODER_KEY]
        if not isinstance(encoder, str):
            raise TypeError(
                f"{model_id} names no {_ENCODER_KEY} to fetch its tokenizer from"
            )
        found[encoder] = Path(
            snapshot_download(encoder, local_files_only=True)
        ).parent.parent
    return tuple(found.values())


def copy_out(target: Path) -> None:
    """Put the warmed repositories under ``target``, where the runtime stage reads them.

    ``target`` is an ``HF_HOME``, not a cache: the repositories go under the folder name
    ``huggingface_hub`` keeps its own cache in, so that the container's ``HF_HOME``
    finds them where the library looks rather than where this happened to put them.
    Everything else the build's cache accumulated — the download accelerator's chunks, a
    tag file, a repository some other build fetched — is left behind, which is the whole
    of what bounds the image to the table.
    """
    cache = Path(constants.HF_HUB_CACHE)
    for repository in carried_repositories():
        shutil.copytree(
            repository, target / cache.name / repository.name, symlinks=True
        )


if __name__ == "__main__":
    fetch()
    copy_out(Path(sys.argv[1]))
