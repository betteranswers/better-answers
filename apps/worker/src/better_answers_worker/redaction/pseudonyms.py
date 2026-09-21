from collections.abc import Iterable, Mapping
from random import Random
from string import ascii_uppercase
from types import MappingProxyType

LETTERS = ascii_uppercase


def normalised(value: str) -> str:
    return " ".join(value.split()).casefold()


def letters_from(seed: str) -> tuple[str, ...]:
    shuffled = list(LETTERS)
    Random(seed).shuffle(shuffled)
    return tuple(shuffled)


def pseudonyms_for(names: Iterable[str], seed: str) -> Mapping[str, str]:
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
