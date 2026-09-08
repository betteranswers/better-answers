"""The one id shape either tier mints, on this side of the contract (ADR 0035).

A ULID — 48 bits of milliseconds then 80 bits of randomness, Crockford base32, 26
characters — so an id minted here sorts by when it was made and parses at the app's
boundary. The pattern, the ids that must parse and the ids that must not are
``contracts/id-shape/cases.json``, and this tier's conformance suite holds this function
to it (`apps/worker/tests/test_tier_contract.py`).

**Almost nothing in this tier mints an id.** Every row the worker writes is a row the
app put there, with one exception: the nightly audit is self-scheduled, so the worker
puts that job on the queue itself and has to name it (`loop.py`). Written here rather
than taken from a package, for the reason the app's own minter gives: the whole of it is
the lines below, and a dependency would be a pinned version and a supply-chain surface
for a function whose specification is fixed.

It mints ids, never secrets: the time half is public by design.
"""

import secrets
import time

#: Crockford base32, in value order: no I, L, O or U, so no digit is misread aloud.
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_TIME_CHARACTERS = 10
_RANDOM_CHARACTERS = 16


def ulid() -> str:
    """One id in the shape both tiers agreed."""
    milliseconds = time.time_ns() // 1_000_000
    stamp = "".join(
        _ALPHABET[(milliseconds >> shift) & 0b11111]
        for shift in range(5 * (_TIME_CHARACTERS - 1), -1, -5)
    )
    return stamp + "".join(secrets.choice(_ALPHABET) for _ in range(_RANDOM_CHARACTERS))
