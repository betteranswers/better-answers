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


class UnopenableError(Exception):
    def __init__(self, name: str, message: str) -> None:
        super().__init__(message)
        self.name = name


# A wrong key length is the caller's defect: a refusal word here would let a
# mis-provisioned key read as somebody's bad envelope.
def _keyed(key: bytes) -> AESGCM:
    if len(key) != ENVELOPE_KEY_BYTES:
        message = f"envelope: a key is {ENVELOPE_KEY_BYTES} bytes, not {len(key)}"
        raise ValueError(message)
    return AESGCM(key)


def sealed(key: bytes, plaintext: bytes) -> bytes:
    cipher = _keyed(key)
    version = bytes([ENVELOPE_VERSION])
    # Never a counter: two processes share the key and would hand out one number
    # twice, which under GCM hands out the plaintexts.
    nonce = secrets.token_bytes(ENVELOPE_NONCE_BYTES)

    return version + nonce + cipher.encrypt(nonce, plaintext, version)


def opened(key: bytes, frame: bytes) -> bytes:
    cipher = _keyed(key)
    if not frame:
        raise UnopenableError("envelope-malformed", "envelope: a frame has no version")
    # Before anything is decrypted, so a version this tier cannot read answers what
    # is wrong rather than what the tag made of it.
    if frame[0] != ENVELOPE_VERSION:
        message = f"envelope: this tier opens no version {frame[0]}"
        raise UnopenableError("envelope-version-unknown", message)
    if len(frame) < _SHORTEST_FRAME:
        message = f"envelope: a frame is {_SHORTEST_FRAME} bytes or more"
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
    # The library says a tag did not verify by raising, and tells nobody whether a
    # byte moved or the key was wrong.
    except InvalidTag as refused:
        message = "envelope: this frame did not open"
        raise UnopenableError("envelope-not-authentic", message) from refused
