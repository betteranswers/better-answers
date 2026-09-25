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


def test_the_cipher_version_and_widths_match_the_agreement() -> None:
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


def test_opens_with_the_agreements_test_key() -> None:
    assert len(KEY) == read_credential_envelope()["frame"]["key_bytes"]


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_opens_every_agreed_frame_to_its_exact_plaintext(
    vector: dict[str, str],
) -> None:
    assert opened(KEY, bytes.fromhex(vector["frame"])) == bytes.fromhex(
        vector["plaintext"]
    )


@pytest.mark.parametrize(
    "vector", FIXTURE["refuses"], ids=lambda vector: vector["name"]
)
def test_refuses_each_bad_frame_in_the_word_the_agreement_names(
    vector: dict[str, str],
) -> None:
    with pytest.raises(UnopenableError) as refused:
        opened(KEY, bytes.fromhex(vector["frame"]))

    assert refused.value.name == vector["refusal"]


def test_the_agreement_carries_a_frame_for_every_refusal_word() -> None:
    fixture = read_credential_envelope()

    assert fixture["opens"]
    assert {vector["refusal"] for vector in fixture["refuses"]} == {
        "envelope-version-unknown",
        "envelope-malformed",
        "envelope-not-authentic",
    }


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_writes_a_frame_with_the_agreed_widths_and_version_first(
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
def test_opens_its_own_sealed_plaintext_byte_for_byte(
    vector: dict[str, str],
) -> None:
    plaintext = bytes.fromhex(vector["plaintext"])

    assert opened(KEY, sealed(KEY, plaintext)) == plaintext


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_a_fresh_nonce_makes_each_seal_a_different_frame(
    vector: dict[str, str],
) -> None:
    plaintext = bytes.fromhex(vector["plaintext"])

    assert len({sealed(KEY, plaintext) for _ in range(16)}) == 16


def test_a_wrong_length_key_raises_a_defect_not_a_refusal() -> None:
    short = KEY[1:]

    with pytest.raises(ValueError, match="envelope: a key is"):
        sealed(short, KEY)
    for vector in read_credential_envelope()["opens"]:
        with pytest.raises(ValueError, match="envelope: a key is"):
            opened(short, bytes.fromhex(vector["frame"]))
