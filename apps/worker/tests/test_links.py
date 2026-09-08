"""The derivation, branch by branch (`[TEST1]`: the module entry point).

Every case here is a sentence of the docblock over `LINK_DEFINITION` in
`packages/core/src/store/graph/index.ts`, asserted on this side of the seam. That the
two sides *agree* is the cross-tier rebuild-equivalence test's to prove; what this file
does is say, in one place, what each branch is supposed to do — so a failure names the
rule that broke rather than reporting that two generations differ.
"""

from better_answers_worker.concept_file import Frontmatter
from better_answers_worker.links import (
    DERIVED_FROM_LABEL,
    LINKS_TO_LABEL,
    SUPERSEDES_LABEL,
    OutgoingEdge,
    ResolvedTarget,
    outgoing_edges,
    prose_of,
    references_of,
)

IRI = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM"
OTHER_IRI = "https://better-answers.com/c/01J6NNNNNNNNNNNNNNNNNNNNNN"
UNLANDED_IRI = "https://better-answers.com/c/01J6PPPPPPPPPPPPPPPPPPPPPP"
PATH = "knowledge/expenses.md"


def edges(
    body: str,
    frontmatter: Frontmatter | None = None,
    *,
    kind: str = "Policy",
    by_path: dict[str, ResolvedTarget] | None = None,
    by_iri: dict[str, ResolvedTarget] | None = None,
) -> list[OutgoingEdge]:
    """The derivation, as the rebuild calls it: a file and the index rows it resolves
    against.
    """
    return outgoing_edges(
        iri=IRI,
        kind=kind,
        path=PATH,
        body=body,
        frontmatter=frontmatter or {},
        by_path=by_path or {},
        by_iri=by_iri or {},
    )


def test_derives_one_edge_from_every_link_form_and_none_from_an_undefined_label() -> (
    None
):
    body = (
        f"Inline [one]({OTHER_IRI}) and full [two][full] and collapsed [three][] "
        f"and shortcut [four] and an autolink <{OTHER_IRI}> and [nowhere][absent].\n\n"
        f"[full]: {OTHER_IRI}\n[three]: {OTHER_IRI}\n[four]: {OTHER_IRI}\n"
    )

    derived = edges(
        body, by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Product", "stable")}
    )

    assert [edge.label for edge in derived] == [LINKS_TO_LABEL] * 5
    assert [edge.to_kind for edge in derived] == ["Product"] * 5


def test_an_image_holds_its_ordinal_and_derives_nothing() -> None:
    # A transclusion shows a resource; it does not assert between concepts. Its ordinal
    # stands so that removing the `!` later renumbers no neighbour.
    body = f"![a picture]({OTHER_IRI}) then [a link]({OTHER_IRI})."

    derived = edges(
        body, by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Product", "stable")}
    )

    assert [edge.uid for edge in derived] == [f"links_to:{IRI}:1"]


def test_a_link_inside_a_code_span_or_a_fence_derives_nothing() -> None:
    # Quotation, not assertion: code derives no edge, defines no label, names no section
    # and enters no sentence.
    body = (
        f"A span `[quoted]({OTHER_IRI})` and a real [one]({OTHER_IRI}).\n\n"
        f"```\n[fenced]({OTHER_IRI})\n```\n"
    )

    derived = edges(
        body, by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Product", "stable")}
    )

    assert len(derived) == 1
    # The blanked span leaves spaces, and the sentence collapses them.
    assert derived[0].sentence == "A span and a real one."


def test_a_heading_names_the_section_and_the_sentence_is_cut_around_the_link() -> None:
    body = (
        "# Top\n\n## Details\n\n"
        f"One sentence stands alone. Another names [the product]({OTHER_IRI}) here. "
        "A third follows.\n"
    )

    derived = edges(
        body, by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Product", "stable")}
    )

    assert derived[0].section == "Details"
    assert derived[0].sentence == "Another names the product here."


def test_an_iri_target_makes_its_edge_whether_or_not_the_concept_has_landed() -> None:
    # A link to not-yet-written knowledge is legal; the edge dangles and the walk's node
    # join keeps it off every path.
    derived = edges(f"Pointing at [nothing yet]({UNLANDED_IRI}).")

    assert [(edge.to_uid, edge.to_kind) for edge in derived] == [(UNLANDED_IRI, None)]


def test_a_path_target_makes_its_edge_only_once_the_index_resolves_it() -> None:
    body = "Against [the receipts](./receipts.md)."

    assert edges(body) == []
    landed = edges(
        body,
        by_path={
            "knowledge/receipts.md": ResolvedTarget(OTHER_IRI, "Evidence", "stable")
        },
    )
    assert [(edge.to_uid, edge.to_kind) for edge in landed] == [(OTHER_IRI, "Evidence")]


def test_a_scheme_or_a_protocol_relative_target_is_external_and_never_a_concept() -> (
    None
):
    body = "See [the web](https://example.invalid/x) and [a host](//example.invalid/y)."

    assert edges(body) == []


def test_lineage_supersedes_a_deprecated_same_kind_and_derives_from_the_rest() -> None:
    frontmatter: Frontmatter = {
        "sources": [
            {"resource": OTHER_IRI},
            {"resource": UNLANDED_IRI},
        ]
    }

    derived = edges(
        "A body with no links.",
        frontmatter,
        by_iri={
            OTHER_IRI: ResolvedTarget(OTHER_IRI, "Policy", "deprecated"),
            UNLANDED_IRI: ResolvedTarget(UNLANDED_IRI, "Policy", "stable"),
        },
    )

    assert [(edge.uid, edge.label) for edge in derived] == [
        (f"lineage:{IRI}:0", SUPERSEDES_LABEL),
        (f"lineage:{IRI}:1", DERIVED_FROM_LABEL),
    ]


def test_a_deprecated_concept_of_another_kind_derives_and_never_succeeds() -> None:
    frontmatter = {"sources": [{"resource": OTHER_IRI}]}

    derived = edges(
        "A body.",
        frontmatter,
        by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Evidence", "deprecated")},
    )

    assert [edge.label for edge in derived] == [DERIVED_FROM_LABEL]


def test_lineage_to_one_concept_is_one_edge_however_often_it_is_cited() -> None:
    frontmatter: Frontmatter = {
        "sources": [
            {"resource": OTHER_IRI, "locator": "p.1"},
            {"resource": OTHER_IRI, "locator": "p.2"},
        ]
    }

    derived = edges(
        "A body.",
        frontmatter,
        by_iri={OTHER_IRI: ResolvedTarget(OTHER_IRI, "Policy", "stable")},
    )

    assert [edge.uid for edge in derived] == [f"lineage:{IRI}:0"]


def test_a_fence_closes_only_on_its_own_character_at_least_its_own_length() -> None:
    body = "````\n~~~\n```\nstill inside\n````\n\nOut here.\n"

    assert "still inside" not in prose_of(body)
    assert "Out here." in prose_of(body)


def test_an_ordinal_counts_every_reference_whether_or_not_it_resolves() -> None:
    body = f"[external](https://example.invalid) then [real]({OTHER_IRI})."

    found = references_of(body, {}, PATH)

    assert [reference.ordinal for reference in found] == [1]
