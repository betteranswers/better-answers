import json
from pathlib import Path

import pytest
from huggingface_hub import constants

from better_answers_worker.redaction.pins import (
    GLINER_MODEL_ID,
    GLINER_MODEL_ID_MEASURED,
)
from better_answers_worker.redaction.weights import WEIGHTS, copy_out

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


AN_ENCODER = "an-org/an-encoder"
A_COMMIT = "1fcf13e85f4eef5394e1fcd406cf2ca9ea82351d"
THE_WEIGHTS = b"the weights, stored once for every repository"


def _a_repository(
    hub: Path, model_id: str, files: dict[str, bytes], shared: dict[str, str]
) -> None:
    repository = hub / f"models--{model_id.replace('/', '--')}"
    (repository / "refs").mkdir(parents=True)
    (repository / "refs" / "main").write_text(A_COMMIT, "utf-8")
    (repository / "blobs").mkdir()
    (repository / "snapshots" / A_COMMIT).mkdir(parents=True)
    for name, held in files.items():
        blob = repository / "blobs" / f"{name}-blob"
        if name in shared:
            blob.symlink_to(f"../../blobs/{shared[name]}")
        else:
            blob.write_bytes(held)
        (repository / "snapshots" / A_COMMIT / name).symlink_to(
            f"../../blobs/{name}-blob"
        )


def _a_cache_holding_a_shared_blob(hub: Path) -> None:
    store = hub / "blobs" / "ae"
    store.mkdir(parents=True)
    (store / "ae65").write_bytes(THE_WEIGHTS)
    (store / "ff01").write_bytes(b"a file some other repository fetched")
    _a_repository(
        hub,
        GLINER_MODEL_ID,
        {
            "gliner_config.json": json.dumps({"model_name": AN_ENCODER}).encode(),
            "pytorch_model.bin": THE_WEIGHTS,
        },
        {"pytorch_model.bin": "ae/ae65"},
    )
    _a_repository(hub, AN_ENCODER, {"spm.model": b"the tokenizer"}, {})


def test_the_table_fetches_the_model_the_seam_runs_and_nothing_beside_it() -> None:

    assert WEIGHTS == (GLINER_MODEL_ID,)
    assert GLINER_MODEL_ID_MEASURED not in WEIGHTS
    assert len(WEIGHTS) == 1


def test_the_two_models_are_two_models() -> None:

    assert GLINER_MODEL_ID != GLINER_MODEL_ID_MEASURED


def test_the_copy_carries_a_blob_the_cache_shares_across_repositories(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:

    hub = tmp_path / "mount" / "hub"
    _a_cache_holding_a_shared_blob(hub)
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(hub))
    carried_to = tmp_path / "image"

    copy_out(carried_to)

    carried = carried_to / "hub"
    snapshot = carried / f"models--{GLINER_MODEL_ID.replace('/', '--')}"
    assert sorted(found.name for found in carried.iterdir()) == [
        f"models--{AN_ENCODER.replace('/', '--')}",
        snapshot.name,
    ]
    weights = snapshot / "snapshots" / A_COMMIT / "pytorch_model.bin"
    assert weights.read_bytes() == THE_WEIGHTS
    leaving = [
        link.relative_to(carried).as_posix()
        for repository in carried.iterdir()
        for link in repository.rglob("*")
        if link.is_symlink() and not link.resolve().is_relative_to(repository.resolve())
    ]
    assert leaving == []


def test_the_build_fetches_the_weights_by_running_the_module_that_declares_them() -> (
    None
):

    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.weights" in dockerfile
    assert GLINER_MODEL_ID not in dockerfile
    assert GLINER_MODEL_ID_MEASURED not in dockerfile
