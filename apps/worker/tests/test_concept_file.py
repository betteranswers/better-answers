"""The second parser, and the hash over what it reads (`[TEST1]`: the module entry
point).

What is asserted here is what this tier can know on its own: that the grammar the app's
renderer writes round-trips, that a file outside that grammar is refused rather than
guessed at, and that the hash carries exactly what ADR 0014 says it carries. That the
two tiers agree on a *number* is not something either tier can assert alone — it is the
nightly audit reporting zero mismatches over a bundle the app itself wrote, which is
`test_work_loop.py` here and the cross-tier rebuild-equivalence test in `packages/core`.
"""

import pytest

from better_answers_worker.concept_file import (
    Frontmatter,
    MalformedConceptFileError,
    SourceEntry,
    canonical_frontmatter,
    content_hash_of,
    normalised_body,
    parse_concept_file,
)
from bundles import render_concept_file

# A locator is whatever scalar the file wrote — a page reference as text, a bare page
# number as a number — and both have to survive the round trip.
SOURCES: list[SourceEntry] = [
    {"resource": "./receipts.md", "locator": "p.4"},
    {"resource": "https://example.invalid/handbook", "locator": 4},
]
FRONTMATTER: Frontmatter = {
    "title": "Expenses",
    "type": "Policy",
    "iri": "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
    "tags": ["finance", "uk"],
    "sources": SOURCES,
    "empty": [],
    "count": 3,
    "checked": True,
    "nothing": None,
}
BODY = "Expenses are claimed within sixty days.\n\nA second paragraph."


def test_reads_back_every_shape_the_renderer_writes() -> None:
    frontmatter, body = parse_concept_file(render_concept_file(FRONTMATTER, BODY))

    assert frontmatter == FRONTMATTER
    assert body == normalised_body(BODY)


@pytest.mark.parametrize(
    ("why", "content"),
    [
        ("a file with no frontmatter fence at all", "just a body\n"),
        ("a fence that never closes", '---\n"title": "x"\n'),
        (
            "no blank line between the frontmatter and the body",
            '---\n"t": "x"\n---\nbody',
        ),
        (
            "a bare YAML key the renderer would have quoted",
            "---\ntitle: x\n---\n\nbody",
        ),
        ("a value that is not JSON", '---\n"title": not-json\n---\n\nbody'),
        (
            "a list of strings and objects at once",
            '---\n"s":\n  - "a"\n  - "k": "v"\n---\n\nb',
        ),
    ],
)
def test_refuses_a_file_the_renderer_never_wrote(why: str, content: str) -> None:
    # The app's parser answers `malformed` to exactly these, and the reconciler stops at
    # such a commit rather than guessing; a reader that accepted more would agree with
    # the app about files the app never wrote, which is what makes the cross-check
    # worthless.
    with pytest.raises(MalformedConceptFileError):
        parse_concept_file(content)
    assert why


def test_leaves_the_trust_and_identity_keys_out_of_the_hash() -> None:
    # A check of its own recording must not move the hash, or *Checked* becomes *Changed
    # since checked* on the very next read (ADR 0014).
    plain: Frontmatter = {"title": "Expenses", "type": "Policy"}
    trusted: Frontmatter = {
        **plain,
        "iri": "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
        "status": "stable",
        "stale_after": "2027-01-01",
        "generated": "better-answers-extraction/1.2",
        "verified": ["human:ada@acme.invalid"],
    }

    assert content_hash_of(trusted, BODY, "knowledge/expenses.md") == content_hash_of(
        plain, BODY, "knowledge/expenses.md"
    )


def test_reduces_a_citation_to_its_resolved_resource_and_locator() -> None:
    # A source's title moving leaves a check standing; a swapped source un-checks it
    # (ADR 0019). Two spellings of one path are one citation, which is what the
    # resolution is for.
    relative: Frontmatter = {
        "sources": [{"resource": "./receipts.md", "locator": "p.4", "title": "A"}]
    }
    absolute: Frontmatter = {
        "sources": [{"resource": "/knowledge/receipts.md", "locator": "p.4"}]
    }

    assert canonical_frontmatter(relative, "knowledge/expenses.md") == (
        '{"sources":[["/knowledge/receipts.md","p.4"]]}'
    )
    assert canonical_frontmatter(
        absolute, "knowledge/expenses.md"
    ) == canonical_frontmatter(relative, "knowledge/expenses.md")


def test_writes_a_numeric_locator_the_way_the_other_tier_writes_it() -> None:
    # The one place the two languages disagree by default: JavaScript has one number
    # type and writes `4`, Python writes `4.0` for the same value read out of a file. A
    # disagreement here would read as a mismatched concept and send somebody looking at
    # the bundle instead of at the reducer.
    page_four: list[SourceEntry] = [{"resource": "/a.md", "locator": 4}]
    numeric: Frontmatter = {"sources": page_four}

    assert canonical_frontmatter(numeric, "knowledge/x.md") == (
        '{"sources":[["/a.md","4"]]}'
    )


def test_sorts_keys_and_writes_them_without_insignificant_whitespace() -> None:
    # RFC 8785's canonicalisation for the one shape a concept's frontmatter can hold —
    # sorted keys, no whitespace — because the hash needs an order nobody chose.
    unsorted: Frontmatter = {"b": 1, "a": "two", "C": True}

    assert (
        canonical_frontmatter(unsorted, "knowledge/x.md")
        == '{"C":true,"a":"two","b":1}'
    )


def test_normalises_the_body_the_way_the_hash_reads_it() -> None:
    assert normalised_body("one \r\ntwo\t\n\n\n") == "one\ntwo\n"
