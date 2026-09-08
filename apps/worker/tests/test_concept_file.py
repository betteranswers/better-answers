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
        # The renderer writes each key once; a second `iri` or `type` would otherwise be
        # the one a hand-forged commit chose, quietly winning over the first.
        ("a key written twice", '---\n"t": "one"\n"t": "two"\n---\n\nbody'),
        # JSON has no such values and the app's parser refuses the text; a reader that
        # took them would read a file the app could never have written.
        ("a number that is not a number", '---\n"n": NaN\n---\n\nbody'),
        ("an infinity", '---\n"n": -Infinity\n---\n\nbody'),
        # The renderer writes an empty list as ` []` on the key's line: a bare key is a
        # field the file says nothing about, not one it says is empty.
        ("a key with no value and no items", '---\n"tags":\n"t": "x"\n---\n\nbody'),
        (
            "a bare key at the end of the frontmatter",
            '---\n"t": "x"\n"tags":\n---\n\nbody',
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


@pytest.mark.parametrize(
    ("value", "javascript"),
    [
        # Read from `JSON.stringify` in Node 24 on 8 September 2026 — the other tier's
        # number rule, which this one reproduces rather than guesses at.
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (0.000001, "0.000001"),
        (0.00001, "0.00001"),
        (0.5e-6, "5e-7"),
        (0.1, "0.1"),
        (-0.0, "0"),
        (100.0, "100"),
        (123.456, "123.456"),
        (1e16, "10000000000000000"),
        (1.5e300, "1.5e+300"),
        (-1.5e-10, "-1.5e-10"),
        (4, "4"),
        (-42, "-42"),
        (2**53, "9007199254740992"),
        (12345678901234567890, "12345678901234567000"),
        (123456789012345680000, "123456789012345680000"),
    ],
)
def test_writes_every_number_the_way_javascript_writes_it(
    value: float, javascript: str
) -> None:
    # Python's own repr and JavaScript's Number::toString choose the same shortest
    # digits and then lay them out differently — `1e-07` against `1e-7`, a twenty-two-
    # digit integer against `1e+21` — and an integer past 2^53 is a double over there.
    # Each is a false mismatch the nightly audit would report over a file the app wrote.
    cited: list[SourceEntry] = [{"resource": "/a.md", "locator": value}]
    numeric: Frontmatter = {"n": value, "sources": cited}

    assert canonical_frontmatter(numeric, "knowledge/x.md") == (
        f'{{"n":{javascript},"sources":[["/a.md","{javascript}"]]}}'
    )


def test_hashes_what_the_other_tier_hashes_over_every_number_shape() -> None:
    # The number the app's own `contentHashOf` produced for this frontmatter, written
    # down (the `contentHashOf` probe of 8 September 2026): a disagreement here is the
    # nightly audit reporting a mismatch over a file the app wrote.
    page: list[SourceEntry] = [{"resource": "/a.md", "locator": 1e21}]
    frontmatter: Frontmatter = {
        "count": 1e21,
        "ratio": 1e-7,
        "tiny": 0.000001,
        "half": 0.5,
        "big": 12345678901234567890,
        "exact": 9007199254740992,
        "sources": page,
    }
    body = "Expenses are claimed within thirty days."

    assert content_hash_of(frontmatter, body, "knowledge/policies/expenses.md") == (
        "33dce930674c2fd989f1c8ab9507a7ece82a60a7f0e7b23ee5b3ec548dbfdf70"
    )


def test_hashes_a_list_of_objects_whichever_order_their_keys_came_in() -> None:
    # A vendor's list, preserved verbatim in the file and canonicalised for the hash
    # (RFC 8785): the order a producer wrote an object's keys in is not content. The
    # number is the app's own `contentHashOf` over the same file, written down.
    body = "Expenses are claimed within thirty days."
    as_written: list[SourceEntry] = [
        {"name": "Ada", "role": "finance"},
        {"role": "legal", "name": "Blake"},
    ]
    as_reordered: list[SourceEntry] = [
        {"role": "finance", "name": "Ada"},
        {"name": "Blake", "role": "legal"},
    ]
    written: Frontmatter = {"reviewers": as_written}
    reordered: Frontmatter = {"reviewers": as_reordered}

    assert content_hash_of(written, body, "knowledge/policies/expenses.md") == (
        "39d526207876ae89b4473f7f3a46bf95f320a954f98c0183a6d08d22ceedce47"
    )
    assert content_hash_of(reordered, body, "knowledge/policies/expenses.md") == (
        content_hash_of(written, body, "knowledge/policies/expenses.md")
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
