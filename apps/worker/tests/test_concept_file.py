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
        ("a key written twice", '---\n"t": "one"\n"t": "two"\n---\n\nbody'),
        ("a number that is not a number", '---\n"n": NaN\n---\n\nbody'),
        ("an infinity", '---\n"n": -Infinity\n---\n\nbody'),
        ("a key with no value and no items", '---\n"tags":\n"t": "x"\n---\n\nbody'),
        (
            "a bare key at the end of the frontmatter",
            '---\n"t": "x"\n"tags":\n---\n\nbody',
        ),
    ],
)
def test_refuses_a_file_the_renderer_never_wrote(why: str, content: str) -> None:

    with pytest.raises(MalformedConceptFileError):
        parse_concept_file(content)
    assert why


def test_leaves_the_trust_and_identity_keys_out_of_the_hash() -> None:

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


def test_writes_a_numeric_locator_as_the_other_tier_does() -> None:

    page_four: list[SourceEntry] = [{"resource": "/a.md", "locator": 4}]
    numeric: Frontmatter = {"sources": page_four}

    assert canonical_frontmatter(numeric, "knowledge/x.md") == (
        '{"sources":[["/a.md","4"]]}'
    )


def test_hashes_listed_objects_whatever_their_key_order() -> None:

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

    assert content_hash_of(reordered, body, "knowledge/policies/expenses.md") == (
        content_hash_of(written, body, "knowledge/policies/expenses.md")
    )


def test_sorts_keys_and_writes_them_without_insignificant_whitespace() -> None:

    unsorted: Frontmatter = {"b": 1, "a": "two", "C": True}

    assert (
        canonical_frontmatter(unsorted, "knowledge/x.md")
        == '{"C":true,"a":"two","b":1}'
    )


def test_normalises_the_body_the_way_the_hash_reads_it() -> None:
    assert normalised_body("one \r\ntwo\t\n\n\n") == "one\ntwo\n"
