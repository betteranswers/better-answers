import hashlib
import json
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest

from better_answers_worker.redaction.pseudonyms import normalised
from better_answers_worker.redaction.suppressions import (
    ADDRESS_JOINERS,
    IDENTIFIER_FLOOR,
    NAME_WORDS_FLOOR,
    WORD_CATEGORIES,
    clears_the_floor,
    erasure_matches_in,
)

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_erasure_match() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "erasure-match" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


CASES: list[dict[str, Any]] = read_erasure_match()["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["why"][:60] for case in CASES])
def test_the_seam_raises_a_match_at_every_occurrence_the_agreement_answers(
    case: dict[str, Any],
) -> None:
    raised = erasure_matches_in(case["text"], ({case["kind"]: (case["identifier"],)},))

    assert [(match.start, match.end) for match in raised] == [
        (occurrence["start"], occurrence["end"]) for occurrence in case["occurrences"]
    ], case["why"]
    for occurrence in case["occurrences"]:
        assert (
            case["text"][occurrence["start"] : occurrence["end"]] == occurrence["reads"]
        )


@pytest.mark.parametrize("case", CASES, ids=[case["why"][:60] for case in CASES])
def test_an_identifier_clears_the_floor_where_the_agreement_says_it_does(
    case: dict[str, Any],
) -> None:
    assert (
        clears_the_floor(case["kind"], case["identifier"]) is case["clears_the_floor"]
    ), case["why"]


def test_the_floor_is_the_one_the_agreement_states() -> None:
    floor = read_erasure_match()["floor"]

    assert (
        floor["characters"],
        floor["name_words"],
    ) == (IDENTIFIER_FLOOR, NAME_WORDS_FLOOR)


def test_an_identifier_is_normalised_as_the_agreement_normalises_it() -> None:
    for case in read_erasure_match()["normalisation"]["cases"]:
        assert normalised(case["identifier"]) == case["normalised"], case["why"]


def test_whitespace_is_every_code_point_the_agreement_lists_and_no_other() -> None:
    listed = set(read_erasure_match()["normalisation"]["whitespace"])
    surrogates = range(0xD800, 0xE000)

    spaced = {
        chr(point)
        for point in range(sys.maxunicode + 1)
        if point not in surrogates and normalised(f"a{chr(point)}b") == "a b"
    }

    assert spaced == listed


def test_an_occurrence_is_bounded_by_the_characters_the_agreement_names() -> None:
    boundary = read_erasure_match()["boundary"]

    assert sorted(WORD_CATEGORIES) == sorted(boundary["word_categories"])
    assert sorted(ADDRESS_JOINERS) == sorted(boundary["address_joiners"])


def code_points_the_digests_read() -> Iterator[tuple[int, str]]:
    whitespace = set(read_erasure_match()["normalisation"]["whitespace"])
    surrogates = range(0xD800, 0xE000)
    for point in range(sys.maxunicode + 1):
        if point not in surrogates and chr(point) not in whitespace:
            yield point, chr(point)


def digest_of(lines: Iterable[str]) -> str:
    return hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()


def hex_of(text: str) -> str:
    return " ".join(f"{ord(character):04X}" for character in text)


def test_every_code_point_folds_as_the_agreement_digests_it() -> None:
    lines = (
        f"{point:04X} {hex_of(normalised(character))}\n"
        for point, character in code_points_the_digests_read()
        if normalised(character) != character
    )

    assert digest_of(lines) == read_erasure_match()["digests"]["folding"]["sha256"]


def test_every_digested_word_character_and_no_other_unbounds_an_identifier() -> None:
    suppressing_abc = ({"other": ("abc",)},)
    lines = (
        f"{point:04X}\n"
        for point, character in code_points_the_digests_read()
        if not erasure_matches_in(f"abc{character}", suppressing_abc)
    )
    word_characters = read_erasure_match()["digests"]["word_characters"]

    assert digest_of(lines) == word_characters["sha256"]
