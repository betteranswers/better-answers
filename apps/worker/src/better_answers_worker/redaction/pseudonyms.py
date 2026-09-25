from collections.abc import Iterable, Mapping
from random import Random
from string import ascii_uppercase
from types import MappingProxyType

LETTERS = ascii_uppercase


def normalised(value: str) -> str:
    """Whitespace collapsed to single spaces and case
    folded: the form names and identifiers are compared in."""
    return " ".join(value.split()).casefold()


def letters_from(seed: str) -> tuple[str, ...]:
    shuffled = list(LETTERS)
    Random(seed).shuffle(shuffled)
    return tuple(shuffled)


def pseudonyms_for(names: Iterable[str], seed: str) -> Mapping[str, str]:
    """A letter per distinct name, keyed by its `normalised` form, in order of first
    appearance from the seed's shuffle of A to Z; past 26 names, letters double."""
    letters = letters_from(seed)
    taken: dict[str, str] = {}
    for name in names:
        key = normalised(name)
        if key not in taken:
            taken[key] = _letter_at(len(taken), letters)
    return MappingProxyType(taken)


def written_as(letter: str, placeholder: str) -> str:
    head, _, _ = placeholder.rstrip("]").rpartition(" ")
    return f"{head} {letter}]"


def _letter_at(index: int, letters: tuple[str, ...]) -> str:
    return letters[index % len(letters)] * (index // len(letters) + 1)
