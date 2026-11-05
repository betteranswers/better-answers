from pathlib import Path

import pytest

from better_answers_worker.redaction.suffixes import (
    CACHE_ENTRY_SUFFIX,
    copy_out,
    warmed_entries,
)
from support.roots import WORKER_ROOT

DOCKERFILE = WORKER_ROOT / "Dockerfile"


A_NAMESPACE = "publicsuffix.org-tlds"
AN_ENTRY = f"de84b5ca2167d4c83e38fb162f2e8738{CACHE_ENTRY_SUFFIX}"
ENTRY_CONTENT = '[["co.uk"], []]'


def _write_a_warmed_cache(at: Path) -> Path:
    entry = at / A_NAMESPACE / AN_ENTRY
    entry.parent.mkdir(parents=True)
    entry.write_text(ENTRY_CONTENT, "utf-8")

    Path(f"{entry}.lock").write_text("", "utf-8")
    (at / "another-build-was-here").write_text("", "utf-8")
    return entry


def test_copies_the_cached_suffix_list_without_its_locks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:

    cache = tmp_path / "mount"
    _write_a_warmed_cache(cache)
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(cache))
    destination = tmp_path / "image"

    copy_out(destination)

    copied = sorted(
        found.relative_to(destination).as_posix()
        for found in destination.rglob("*")
        if found.is_file()
    )
    assert copied == [f"{A_NAMESPACE}/{AN_ENTRY}"]
    assert (destination / A_NAMESPACE / AN_ENTRY).read_text("utf-8") == ENTRY_CONTENT
    assert [found.name for found in warmed_entries()] == [AN_ENTRY]


def test_copy_out_raises_when_the_suffix_cache_is_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:

    cache = tmp_path / "mount"
    cache.mkdir()
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(cache))
    destination = tmp_path / "image"

    with pytest.raises(RuntimeError):
        copy_out(destination)

    assert not destination.exists()


def test_the_dockerfile_warms_the_suffix_list_with_the_suffixes_module() -> None:

    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.suffixes" in dockerfile
    assert "TLDEXTRACT_CACHE=/tldextract-cache" in dockerfile
    assert "TLDEXTRACT_CACHE=/data/worker/tldextract-cache" in dockerfile
