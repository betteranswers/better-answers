import json
from pathlib import Path
from typing import Any, cast

import pytest

from better_answers_worker.envelope import (
    ENVELOPE_AEAD,
    ENVELOPE_KEY_BYTES,
    ENVELOPE_NONCE_BYTES,
    ENVELOPE_TAG_BYTES,
    ENVELOPE_VERSION,
    ENVELOPE_VERSION_BYTES,
    UnopenableError,
    opened,
    sealed,
)

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_credential_envelope() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "credential-envelope" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


FIXTURE = read_credential_envelope()
KEY = bytes.fromhex(FIXTURE["key"])


def test_the_cipher_the_version_and_the_widths_are_the_agreements_own() -> None:
    fixture = read_credential_envelope()

    spoken = {
        "aead": ENVELOPE_AEAD,
        "version": ENVELOPE_VERSION,
        "key_bytes": ENVELOPE_KEY_BYTES,
        "version_bytes": ENVELOPE_VERSION_BYTES,
        "nonce_bytes": ENVELOPE_NONCE_BYTES,
        "tag_bytes": ENVELOPE_TAG_BYTES,
    }

    assert spoken == {
        "aead": fixture["aead"],
        "version": fixture["version"],
        **fixture["frame"],
    }


def test_the_key_this_tier_opens_with_is_the_agreements_own_test_key() -> None:
    assert len(KEY) == read_credential_envelope()["frame"]["key_bytes"]


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_every_frame_the_agreement_carries_opens_to_its_plaintext_byte_for_byte(
    vector: dict[str, str],
) -> None:
    assert opened(KEY, bytes.fromhex(vector["frame"])) == bytes.fromhex(
        vector["plaintext"]
    )


@pytest.mark.parametrize(
    "vector", FIXTURE["refuses"], ids=lambda vector: vector["name"]
)
def test_every_frame_the_agreement_refuses_is_refused_in_the_word_it_names(
    vector: dict[str, str],
) -> None:
    with pytest.raises(UnopenableError) as refused:
        opened(KEY, bytes.fromhex(vector["frame"]))

    assert refused.value.name == vector["refusal"]


def test_a_frame_is_carried_for_every_word_this_tier_can_answer() -> None:
    fixture = read_credential_envelope()

    assert fixture["opens"]
    assert {vector["refusal"] for vector in fixture["refuses"]} == {
        "envelope-version-unknown",
        "envelope-malformed",
        "envelope-not-authentic",
    }


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_a_frame_this_tier_writes_has_the_agreements_widths_and_its_version_first(
    vector: dict[str, str],
) -> None:
    fixture = read_credential_envelope()
    plaintext = bytes.fromhex(vector["plaintext"])

    frame = sealed(KEY, plaintext)

    assert frame[0] == fixture["version"]
    assert len(frame) == (
        fixture["frame"]["version_bytes"]
        + fixture["frame"]["nonce_bytes"]
        + len(plaintext)
        + fixture["frame"]["tag_bytes"]
    )


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_a_plaintext_this_tier_sealed_itself_comes_back_byte_for_byte(
    vector: dict[str, str],
) -> None:
    plaintext = bytes.fromhex(vector["plaintext"])

    assert opened(KEY, sealed(KEY, plaintext)) == plaintext


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_a_fresh_nonce_per_seal_makes_one_plaintext_two_different_frames(
    vector: dict[str, str],
) -> None:
    plaintext = bytes.fromhex(vector["plaintext"])

    assert len({sealed(KEY, plaintext) for _ in range(16)}) == 16


def test_a_key_of_another_length_is_the_callers_defect_not_a_refusal() -> None:
    short = KEY[1:]

    with pytest.raises(ValueError, match="envelope: a key is"):
        sealed(short, KEY)
    for vector in read_credential_envelope()["opens"]:
        with pytest.raises(ValueError, match="envelope: a key is"):
            opened(short, bytes.fromhex(vector["frame"]))
