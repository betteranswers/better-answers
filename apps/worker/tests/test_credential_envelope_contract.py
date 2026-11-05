import json
import subprocess
import sys
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
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"


def read_credential_envelope() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "credential-envelope" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


FIXTURE = read_credential_envelope()
KEY = bytes.fromhex(FIXTURE["key"])


def test_the_cipher_version_and_byte_widths_match_the_cases_file() -> None:
    fixture = read_credential_envelope()

    declared = {
        "aead": ENVELOPE_AEAD,
        "version": ENVELOPE_VERSION,
        "key_bytes": ENVELOPE_KEY_BYTES,
        "version_bytes": ENVELOPE_VERSION_BYTES,
        "nonce_bytes": ENVELOPE_NONCE_BYTES,
        "tag_bytes": ENVELOPE_TAG_BYTES,
    }

    assert declared == {
        "aead": fixture["aead"],
        "version": fixture["version"],
        **fixture["frame"],
    }


def test_the_cases_file_key_has_the_expected_length() -> None:
    assert len(KEY) == read_credential_envelope()["frame"]["key_bytes"]


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_opens_every_cases_file_frame_to_its_plaintext(
    vector: dict[str, str],
) -> None:
    assert opened(KEY, bytes.fromhex(vector["frame"])) == bytes.fromhex(
        vector["plaintext"]
    )


@pytest.mark.parametrize(
    "vector", FIXTURE["refuses"], ids=lambda vector: vector["name"]
)
def test_rejects_each_bad_frame_with_the_expected_error_name(
    vector: dict[str, str],
) -> None:
    with pytest.raises(UnopenableError) as raised:
        opened(KEY, bytes.fromhex(vector["frame"]))

    assert raised.value.name == vector["refusal"]


def test_the_cases_file_has_a_frame_for_every_error_name() -> None:
    fixture = read_credential_envelope()

    assert fixture["opens"]
    assert {vector["refusal"] for vector in fixture["refuses"]} == {
        "envelope-version-unknown",
        "envelope-malformed",
        "envelope-not-authentic",
    }


@pytest.mark.parametrize("vector", FIXTURE["opens"], ids=lambda vector: vector["name"])
def test_sealed_frame_has_the_version_first_and_expected_length(
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
def test_opens_its_own_sealed_plaintext(
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


PRINT_ONE_SEAL_NONCE = """
import sys
from better_answers_worker.envelope import (
    ENVELOPE_NONCE_BYTES,
    ENVELOPE_VERSION_BYTES,
    sealed,
)

frame = sealed(bytes.fromhex(sys.argv[1]), b"one plaintext")
print(frame[ENVELOPE_VERSION_BYTES:][:ENVELOPE_NONCE_BYTES].hex())
"""


def nonce_sealed_in_a_new_process() -> str:
    finished = subprocess.run(
        [sys.executable, "-c", PRINT_ONE_SEAL_NONCE, KEY.hex()],
        capture_output=True,
        text=True,
        check=True,
    )
    return finished.stdout.strip()


def test_two_processes_sealing_with_one_key_use_different_nonces() -> None:
    first = nonce_sealed_in_a_new_process()
    second = nonce_sealed_in_a_new_process()

    assert first != second


def test_a_wrong_length_key_raises_value_error_not_unopenable_error() -> None:
    short = KEY[1:]

    with pytest.raises(ValueError, match="envelope: a key is"):
        sealed(short, KEY)
    for vector in read_credential_envelope()["opens"]:
        with pytest.raises(ValueError, match="envelope: a key is"):
            opened(short, bytes.fromhex(vector["frame"]))
