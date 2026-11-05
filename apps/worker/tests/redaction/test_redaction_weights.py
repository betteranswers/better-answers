import json
from pathlib import Path

import pytest
from huggingface_hub import constants

from better_answers_worker.redaction.pins import (
    GLINER_MODEL_ID,
    GLINER_MODEL_ID_MEASURED,
)
from better_answers_worker.redaction.weights import WEIGHTS, copy_out
from support.roots import WORKER_ROOT

DOCKERFILE = WORKER_ROOT / "Dockerfile"


AN_ENCODER = "an-org/an-encoder"
A_COMMIT = "1fcf13e85f4eef5394e1fcd406cf2ca9ea82351d"
WEIGHTS_BYTES = b"the weights, stored once for every repository"


def _write_hub_repository(
    hub: Path, model_id: str, files: dict[str, bytes], shared: dict[str, str]
) -> None:
    repository = hub / f"models--{model_id.replace('/', '--')}"
    (repository / "refs").mkdir(parents=True)
    (repository / "refs" / "main").write_text(A_COMMIT, "utf-8")
    (repository / "blobs").mkdir()
    (repository / "snapshots" / A_COMMIT).mkdir(parents=True)
    for name, content in files.items():
        blob = repository / "blobs" / f"{name}-blob"
        if name in shared:
            blob.symlink_to(f"../../blobs/{shared[name]}")
        else:
            blob.write_bytes(content)
        (repository / "snapshots" / A_COMMIT / name).symlink_to(
            f"../../blobs/{name}-blob"
        )


def _write_cache_with_a_shared_blob(hub: Path) -> None:
    store = hub / "blobs" / "ae"
    store.mkdir(parents=True)
    (store / "ae65").write_bytes(WEIGHTS_BYTES)
    (store / "ff01").write_bytes(b"a file some other repository fetched")
    _write_hub_repository(
        hub,
        GLINER_MODEL_ID,
        {
            "gliner_config.json": json.dumps({"model_name": AN_ENCODER}).encode(),
            "pytorch_model.bin": WEIGHTS_BYTES,
        },
        {"pytorch_model.bin": "ae/ae65"},
    )
    _write_hub_repository(hub, AN_ENCODER, {"spm.model": b"the tokenizer"}, {})


def test_weights_lists_only_the_gliner_model_the_detector_runs() -> None:

    assert WEIGHTS == (GLINER_MODEL_ID,)
    assert GLINER_MODEL_ID_MEASURED not in WEIGHTS
    assert len(WEIGHTS) == 1


def test_the_runtime_and_measured_gliner_model_ids_differ() -> None:

    assert GLINER_MODEL_ID != GLINER_MODEL_ID_MEASURED


def test_copy_out_copies_a_blob_shared_across_repositories(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:

    hub = tmp_path / "mount" / "hub"
    _write_cache_with_a_shared_blob(hub)
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(hub))
    destination = tmp_path / "image"

    copy_out(destination)

    copied_hub = destination / "hub"
    snapshot = copied_hub / f"models--{GLINER_MODEL_ID.replace('/', '--')}"
    assert sorted(found.name for found in copied_hub.iterdir()) == [
        f"models--{AN_ENCODER.replace('/', '--')}",
        snapshot.name,
    ]
    weights = snapshot / "snapshots" / A_COMMIT / "pytorch_model.bin"
    assert weights.read_bytes() == WEIGHTS_BYTES
    links_outside_their_repository = [
        link.relative_to(copied_hub).as_posix()
        for repository in copied_hub.iterdir()
        for link in repository.rglob("*")
        if link.is_symlink() and not link.resolve().is_relative_to(repository.resolve())
    ]
    assert links_outside_their_repository == []


def test_the_dockerfile_fetches_weights_through_the_weights_module() -> None:

    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.weights" in dockerfile
    assert GLINER_MODEL_ID not in dockerfile
    assert GLINER_MODEL_ID_MEASURED not in dockerfile
