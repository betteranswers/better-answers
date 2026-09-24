import json
import shutil
import sys
from pathlib import Path
from typing import Final

from huggingface_hub import constants, snapshot_download

from .engine import build_analyzer
from .pins import GLINER_MODEL_ID

WEIGHTS: Final = (GLINER_MODEL_ID,)


_ENCODER_DECLARATION: Final = "gliner_config.json"
_ENCODER_KEY: Final = "model_name"


def fetch() -> None:
    for model_id in WEIGHTS:
        build_analyzer(model_id)


def carried_repositories() -> tuple[Path, ...]:
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
    cache = Path(constants.HF_HUB_CACHE)
    for repository in carried_repositories():
        carried = target / cache.name / repository.name
        shutil.copytree(repository, carried, symlinks=True)
        # huggingface_hub 1.32 links a repository's Xet files into a store beside it,
        # and the image carries no store.
        for blob in carried.glob("blobs/*"):
            if blob.is_symlink():
                shared = (repository / "blobs" / blob.name).resolve()
                blob.unlink()
                shutil.copy2(shared, blob)


if __name__ == "__main__":
    fetch()
    copy_out(Path(sys.argv[1]))
