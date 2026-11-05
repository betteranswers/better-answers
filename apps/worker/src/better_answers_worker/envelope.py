import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_AEAD = "aes-256-gcm"
ENVELOPE_VERSION = 1
ENVELOPE_KEY_BYTES = 32
ENVELOPE_NONCE_BYTES = 12
ENVELOPE_TAG_BYTES = 16
ENVELOPE_VERSION_BYTES = 1

_SHORTEST_FRAME = ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES + ENVELOPE_TAG_BYTES


PORT_OF = ("packages/core/src/kernel/envelope.ts",)
AGREEMENT = "credential-envelope"


class UnopenableError(Exception):
    def __init__(self, name: str, message: str) -> None:
        super().__init__(message)
        self.name = name


def _keyed(key: bytes) -> AESGCM:
    if len(key) != ENVELOPE_KEY_BYTES:
        message = f"envelope: a key is {ENVELOPE_KEY_BYTES} bytes, not {len(key)}"
        raise ValueError(message)
    return AESGCM(key)


def sealed(key: bytes, plaintext: bytes) -> bytes:
    cipher = _keyed(key)
    version = bytes([ENVELOPE_VERSION])
    # The nonce is random because a GCM nonce repeated under one key leaks the XOR of
    # the plaintexts and the authentication key.
    nonce = secrets.token_bytes(ENVELOPE_NONCE_BYTES)

    return version + nonce + cipher.encrypt(nonce, plaintext, version)


def opened(key: bytes, frame: bytes) -> bytes:
    cipher = _keyed(key)
    if not frame:
        message = "envelope: the frame is empty, so it has no version byte"
        raise UnopenableError("envelope-malformed", message)
    if frame[0] != ENVELOPE_VERSION:
        message = (
            f"envelope: the frame has version {frame[0]}, and this worker opens only"
            f" version {ENVELOPE_VERSION}"
        )
        raise UnopenableError("envelope-version-unknown", message)
    if len(frame) < _SHORTEST_FRAME:
        message = (
            f"envelope: the frame is {len(frame)} bytes, and a frame needs at least"
            f" {_SHORTEST_FRAME}"
        )
        raise UnopenableError("envelope-malformed", message)

    nonce = frame[
        ENVELOPE_VERSION_BYTES : ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES
    ]
    try:
        return cipher.decrypt(
            nonce,
            frame[ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES :],
            frame[:ENVELOPE_VERSION_BYTES],
        )
    except InvalidTag as refused:
        message = (
            "envelope: the frame failed authentication. It was sealed under a different"
            " key, or it was altered"
        )
        raise UnopenableError("envelope-not-authentic", message) from refused
