import re
import secrets
import time

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


ID_SHAPE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

_TIME_CHARACTERS = 10
_RANDOM_CHARACTERS = 16


def ulid() -> str:
    # The time half is public by design: an id from here is unique and sortable, never
    # confidential.
    milliseconds = time.time_ns() // 1_000_000
    stamp = "".join(
        _ALPHABET[(milliseconds >> shift) & 0b11111]
        for shift in range(5 * (_TIME_CHARACTERS - 1), -1, -5)
    )
    return stamp + "".join(secrets.choice(_ALPHABET) for _ in range(_RANDOM_CHARACTERS))
