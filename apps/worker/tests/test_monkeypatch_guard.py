"""The `monkeypatch` guard, proved where it fires and where it stays quiet (`[TEST3]`).

A guard nobody has run is a convention, not a rule, so both readings are held: a patch
of this tier's own code is refused, and a patch of a third-party attribute — how an
external service is kept out of a test — still works.
"""

import os

import pytest

from better_answers_worker import config


def test_refuses_a_patch_of_this_tiers_own_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(RuntimeError, match="TEST3"):
        monkeypatch.setattr(config, "read_bootstrap", lambda: None)


def test_refuses_a_patch_named_by_its_dotted_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(RuntimeError, match="TEST3"):
        monkeypatch.setattr("better_answers_worker.config.read_bootstrap", lambda: None)


def test_refuses_a_patch_of_a_table_this_tier_owns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(RuntimeError, match="TEST3"):
        monkeypatch.setitem(vars(config), "REQUIRED", ())


def test_refuses_deleting_an_attribute_of_this_tiers_own_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(RuntimeError, match="TEST3"):
        monkeypatch.delattr(config, "REQUIRED")


def test_patches_a_third_party_attribute(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(os, "sep", "|")

    assert os.sep == "|"


def test_patches_a_third_party_table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(os.environ, "BETTER_ANSWERS_GUARD_PROBE", "set")

    assert os.environ["BETTER_ANSWERS_GUARD_PROBE"] == "set"
