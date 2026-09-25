import unicodedata
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass

from .engine import Finding
from .pseudonyms import normalised

EMAILS = "emails"
NAMES = "names"


# A match is case-folded and runs over the whole workspace, so anything shorter would
# withhold ordinary words in every document.
IDENTIFIER_FLOOR = 3
NAME_WORDS_FLOOR = 2


WORD_CATEGORIES = frozenset("LMN")


ADDRESS_JOINERS = frozenset("._+-")


@dataclass(frozen=True, slots=True)
class ErasureMatch:
    start: int
    end: int


def suppressed_among(
    findings: Sequence[Finding],
    text: str,
    suppressions: Sequence[Mapping[str, Sequence[str]]],
) -> frozenset[Finding]:
    """Findings whose whole text, `normalised`, is an identifier an
    erasure named. Unlike `erasure_matches_in`, no length floor applies."""
    named = _identifiers_in(suppressions)
    return frozenset(
        finding
        for finding in findings
        if normalised(text[finding.start : finding.end]) in named
    )


def clears_the_floor(kind: str, identifier: str) -> bool:
    """Whether an identifier is long enough to search a whole workspace for:
    `IDENTIFIER_FLOOR` characters, and `NAME_WORDS_FLOOR` words for a name."""
    folded = normalised(identifier)
    if len(folded) < IDENTIFIER_FLOOR:
        return False
    return kind != NAMES or len(folded.split(" ")) >= NAME_WORDS_FLOOR


def erasure_matches_in(
    text: str, suppressions: Sequence[Mapping[str, Sequence[str]]]
) -> tuple[ErasureMatch, ...]:
    """Each whole-word, case-folded occurrence of an erased
    identifier that clears the floor, in the text's own offsets.
    An email address must not run on into a longer one."""
    sought = {
        (normalised(identifier), kind == EMAILS)
        for suppression in suppressions
        for kind, identifiers in suppression.items()
        for identifier in identifiers
        if clears_the_floor(kind, identifier)
    }
    if not sought:
        return ()
    folded = _Folded.of(text)
    found = {
        match
        for needle, an_address in sought
        for match in folded.occurrences_of(needle)
        if _bounded(text, match, an_address)
    }
    return tuple(sorted(found, key=lambda match: (match.start, match.end)))


@dataclass(frozen=True, slots=True)
class _Folded:
    """Each folded character keeps the offset it came from, because ß folds to two
    and an occurrence is answered in the text's own offsets."""

    text: str
    origins: tuple[int, ...]

    @classmethod
    def of(cls, text: str) -> "_Folded":
        pieces: list[str] = []
        origins: list[int] = []
        for at, character in enumerate(text):
            if character.isspace():
                if not pieces or pieces[-1] != " ":
                    pieces.append(" ")
                    origins.append(at)
                continue
            for piece in character.casefold():
                pieces.append(piece)
                origins.append(at)
        return cls("".join(pieces), tuple(origins))

    def occurrences_of(self, needle: str) -> Iterator[ErasureMatch]:
        at = self.text.find(needle)
        while at != -1:
            last = at + len(needle) - 1
            if self._opens_a_character(at) and self._closes_a_character(last):
                yield ErasureMatch(self.origins[at], self.origins[last] + 1)
            at = self.text.find(needle, at + 1)

    def _opens_a_character(self, at: int) -> bool:
        return at == 0 or self.origins[at - 1] != self.origins[at]

    def _closes_a_character(self, last: int) -> bool:
        return (
            last + 1 == len(self.origins)
            or self.origins[last + 1] != self.origins[last]
        )


def _bounded(text: str, match: ErasureMatch, an_address: bool) -> bool:
    before, after = _at(text, match.start - 1), _at(text, match.end)
    if _a_word_character(before) or _a_word_character(after):
        return False
    if not an_address:
        return True
    return not (
        _carries_on(before, _at(text, match.start - 2))
        or _carries_on(after, _at(text, match.end + 1))
    )


def _carries_on(joiner: str, beyond: str) -> bool:
    return joiner in ADDRESS_JOINERS and _a_word_character(beyond)


def _at(text: str, index: int) -> str:
    return text[index] if 0 <= index < len(text) else ""


def _a_word_character(character: str) -> bool:
    return character != "" and unicodedata.category(character)[0] in WORD_CATEGORIES


def _identifiers_in(
    suppressions: Sequence[Mapping[str, Sequence[str]]],
) -> frozenset[str]:
    return frozenset(
        normalised(value)
        for suppression in suppressions
        for values in suppression.values()
        for value in values
    )
