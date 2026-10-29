import json
from typing import Any, cast

from better_answers_worker.concepts.links import (
    LINKS_TO_LABEL,
    ResolvedTarget,
    links_and_marks_of,
    outgoing_edges,
    references_of,
    unresolved_references,
)
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"


def read_links() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "links" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_makes_exactly_the_links_each_case_names_by_ordinal() -> None:
    fixture = read_links()
    citing = fixture["citing"]

    made = [
        {
            "case": case["case"],
            "links": [
                {
                    "uid": edge.uid,
                    "to": edge.to_uid,
                    "section": edge.section,
                    "sentence": edge.sentence,
                }
                for edge in outgoing_edges(
                    iri=citing["iri"],
                    kind=citing["kind"],
                    references=references_of(
                        case["body"], {"sources": case["sources"]}, citing["path"]
                    ),
                    by_path={
                        held["path"]: ResolvedTarget(held["iri"], "Policy", "stable")
                        for held in case.get("held", [])
                    },
                    by_iri={},
                )
                if edge.label == LINKS_TO_LABEL
            ],
        }
        for case in fixture["cases"]
    ]

    assert made == [
        {
            "case": case["case"],
            "links": [
                {
                    "uid": f"links_to:{citing['iri']}:{link['ordinal']}",
                    "to": link["to"],
                    "section": link["section"],
                    "sentence": link["sentence"],
                }
                for link in case["links"]
            ],
        }
        for case in fixture["cases"]
    ]


def test_leaves_unresolved_exactly_the_paths_each_case_names() -> None:
    fixture = read_links()
    citing = fixture["citing"]

    made = [
        {
            "case": case["case"],
            "unresolved": [
                {
                    "relation": reference.relation,
                    "ordinal": reference.ordinal,
                    "path": reference.target_path,
                }
                for reference in unresolved_references(
                    references_of(
                        case["body"], {"sources": case["sources"]}, citing["path"]
                    ),
                    {
                        held["path"]: ResolvedTarget(held["iri"], "Policy", "stable")
                        for held in case.get("held", [])
                    },
                )
            ],
        }
        for case in fixture["cases"]
    ]

    assert made == [
        {"case": case["case"], "unresolved": case["unresolved"]}
        for case in fixture["cases"]
    ]


def test_resolves_each_mark_to_the_source_each_case_names() -> None:
    fixture = read_links()

    read = [
        {
            "case": case["case"],
            "marks": [
                {"mark": mark.mark, "source": mark.source}
                for mark in links_and_marks_of(
                    case["body"], {"sources": case["sources"]}
                )[1]
            ],
        }
        for case in fixture["cases"]
    ]

    assert read == [
        {"case": case["case"], "marks": case["marks"]} for case in fixture["cases"]
    ]


def test_places_each_mark_where_the_body_writes_it() -> None:
    fixture = read_links()

    for case in fixture["cases"]:
        _links, marks = links_and_marks_of(case["body"], {"sources": case["sources"]})
        for mark in marks:
            assert case["body"][mark.at : mark.at + len(mark.mark)] == mark.mark, case[
                "case"
            ]
