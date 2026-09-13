"""The letter a name is written as, and why it is drawn rather than counted out.

A name on the default-off tier is replaced by a stable pseudonym rather than a blank,
so that a meeting note still reads as a meeting note and the reader can tell one person
from another. Two things have to be true of that letter at once: the same name is the
same letter everywhere in one binding, and the same name is a different letter in
another binding. The second is the reason the seed is per binding — two bindings holding
the same document must not be joinable on the letter — and it is what rules out handing
out A, B, C in the order the names are met. That order is a property of the document,
so it would give the same person the same letter in every binding that held it.

So the seed draws a permutation of the alphabet, and a name takes the letter at the
index its **first appearance** falls on: first name met takes the permutation's first
letter, second the second. Within one binding the order is the document's and the
permutation is fixed, so the letter is stable; across bindings the permutation differs,
so the letter does. `[person A]` is the shape every pseudonym is written in, taken from
the category's own declared placeholder rather than spelled a second time here, and not
a promise about who is met first.

Past the twenty-sixth name the letter doubles — `[person AA]` — which keeps the
placeholder inside the shape the agreement declares and keeps the mapping one-to-one.
"""

from collections.abc import Iterable, Mapping
from random import Random
from string import ascii_uppercase
from types import MappingProxyType

#: The letters a binding's permutation is drawn from, in the order they are shuffled out
#: of. Upper case because the declared placeholder is, and Latin because the placeholder
#: shape the agreement pins admits nothing else.
LETTERS = ascii_uppercase


def normalised(value: str) -> str:
    """One value written two ways is one value: case and spacing do not divide them.

    A name met as `Rosalind  Petheridge` across a line break is the same person as the
    one met as `Rosalind Petheridge`, and an identifier an erasure request was given in
    one case is the same identifier the document spells in another. This is the only
    place either comparison is made, so the two cannot drift apart.
    """
    return " ".join(value.split()).casefold()


def letters_from(seed: str) -> tuple[str, ...]:
    """The permutation of the alphabet one binding's seed hands its names, in order.

    `Random(seed)` is seeded from a digest of the string rather than from its hash, so
    the permutation is the same in every process and on every run, which is what makes
    two runs of the seam over one document agree.
    """
    shuffled = list(LETTERS)
    Random(seed).shuffle(shuffled)
    return tuple(shuffled)


def pseudonyms_for(names: Iterable[str], seed: str) -> Mapping[str, str]:
    """A letter per name, by the order each name is first met in the document.

    The names are given in reading order and every one of them is counted, whatever tier
    its finding was raised at — an officer's name inside a block takes its letter and
    then loses it to the block rule, and a suppressed name takes its letter and then
    loses it to the suppression. That is deliberate: if a name that is withheld for some
    other reason gave up its place in the queue, suppressing one person would move
    everybody met after them onto a different letter, and a suppression has to change
    the output for the person it names and for nobody else.
    """
    letters = letters_from(seed)
    taken: dict[str, str] = {}
    for name in names:
        key = normalised(name)
        if key not in taken:
            taken[key] = _letter_at(len(taken), letters)
    return MappingProxyType(taken)


def written_as(letter: str, placeholder: str) -> str:
    """The category's declared placeholder with this name's letter in place of its own.

    `[person A]` is the declaration; the letter is the last word of it, so the shape is
    read off the table rather than written out again here. A table that declared a
    different shape would carry the seam with it.
    """
    head, _, _ = placeholder.rstrip("]").rpartition(" ")
    return f"{head} {letter}]"


def _letter_at(index: int, letters: tuple[str, ...]) -> str:
    return letters[index % len(letters)] * (index // len(letters) + 1)
