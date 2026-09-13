"""What the build carries out of a warmed suffix-list cache, and what it leaves behind.

The cheap half of the suffix fence (`T-152`), and the half that runs on every `check`
whether or not a Docker daemon answered. Three things a change could otherwise break in
silence: a copy that carried the lock files a read takes rather than the entries a read
wants, a build that warmed nothing and shipped an image that would quietly fetch
instead, and a Dockerfile that warms the list at build without pointing the container at
it — an image that pays for the warm and then never reads what it paid for.

The expensive half is `tests/test_image.py`: a container with its network refused,
redacting a page with an email address on it while nothing from `tldextract` reaches a
log. That is the only place the fence is proved rather than described, and it is why
this file asserts none of the same things.

The cache directory arrives by environment variable in both tests below, because that is
how `tldextract` resolves it and how the module under test asks it where the cache is.
Nothing here calls `fetch`: warming the list means reaching the network, which is the
build's job and no test's.
"""

from pathlib import Path

import pytest

from better_answers_worker.redaction.suffixes import (
    CACHE_ENTRY_SUFFIX,
    copy_out,
    warmed_entries,
)

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"

#: The directory `tldextract` caches the parsed Public Suffix List under, and a file
#: name in the shape it writes: the namespace and a hash of what it was asked. Written
#: out here rather than warmed, so this file needs neither a network nor a daemon.
A_NAMESPACE = "publicsuffix.org-tlds"
AN_ENTRY = f"de84b5ca2167d4c83e38fb162f2e8738{CACHE_ENTRY_SUFFIX}"
WHAT_IT_HELD = '[["co.uk"], []]'


def _a_warmed_cache(at: Path) -> Path:
    """A cache in the state a warm leaves it: one entry, its lock, and somebody else."""
    entry = at / A_NAMESPACE / AN_ENTRY
    entry.parent.mkdir(parents=True)
    entry.write_text(WHAT_IT_HELD, "utf-8")
    # The lock `DiskCache` takes beside an entry each time it reads one, and a file some
    # other build on the same machine left in the mount this one shares with it.
    Path(f"{entry}.lock").write_text("", "utf-8")
    (at / "another-build-was-here").write_text("", "utf-8")
    return entry


def test_the_copy_carries_what_the_library_cached_and_not_the_locks_it_took(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Both ways round, because one of them alone proves nothing: the entry reaches the
    # image at the path it was cached under, since that path is the key a lookup is made
    # of, and nothing else in the mount reaches the image at all. A copy of the whole
    # directory would satisfy the first and ship another build's leavings with it.
    cache = tmp_path / "mount"
    _a_warmed_cache(cache)
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(cache))
    carried_to = tmp_path / "image"

    copy_out(carried_to)

    landed = sorted(
        found.relative_to(carried_to).as_posix()
        for found in carried_to.rglob("*")
        if found.is_file()
    )
    assert landed == [f"{A_NAMESPACE}/{AN_ENTRY}"]
    assert (carried_to / A_NAMESPACE / AN_ENTRY).read_text("utf-8") == WHAT_IT_HELD
    assert [found.name for found in warmed_entries()] == [AN_ENTRY]


def test_a_build_that_warmed_nothing_refuses_rather_than_shipping_a_fetch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The direction this has to fail in. An image built from an empty cache starts, runs
    # and redacts correctly, and pays a connection attempt in every process it starts to
    # do it — a failure with no symptom anyone is watching for, so it is made a failure
    # of the build instead.
    cache = tmp_path / "mount"
    cache.mkdir()
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(cache))
    carried_to = tmp_path / "image"

    with pytest.raises(RuntimeError):
        copy_out(carried_to)

    assert not carried_to.exists()


def test_the_build_warms_the_suffix_list_by_running_the_module_that_fences_it() -> None:
    # Two lines and neither works alone: the build step warms a cache under one path and
    # the runtime stage points the container at another, where the copy of it landed. A
    # Dockerfile carrying only the first warms a list nothing reads; one carrying only
    # the second reads a directory nothing filled. Both build, both start, and only the
    # container in `test_image.py` can tell the difference.
    dockerfile = DOCKERFILE.read_text("utf-8")

    assert "better_answers_worker.redaction.suffixes" in dockerfile
    assert "TLDEXTRACT_CACHE=/tldextract-cache" in dockerfile
    assert "TLDEXTRACT_CACHE=/data/worker/tldextract-cache" in dockerfile
