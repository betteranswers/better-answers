import re
from collections.abc import Mapping, Sequence
from typing import NamedTuple

from ..concept_file import Frontmatter, cited_source
from .definitions import (
    _cited_entries,
    _defines,
    _definitions_of,
    _link_target_of,
    _normalised_label,
    _sources_by_id,
)
from .fences import prose_of
from .scan import _Found, _link_matches
from .sentences import _section_at, _sentence_at
from .targets import _target_of, _TargetShape

CONCEPT_NODE_LABEL = "Concept"


LINKS_TO_LABEL = "LINKS_TO"


SUPERSEDES_LABEL = "SUPERSEDES"


DERIVED_FROM_LABEL = "DERIVED_FROM"


CONCEPT_DEPRECATED_STATUS = "deprecated"


_FOOTNOTE = re.compile(r"^\[\^([^\]]*)\]$")


class BodyLink:
    __slots__ = ("at", "ordinal", "target")

    def __init__(self, ordinal: int, at: int, target: str) -> None:
        self.ordinal = ordinal
        self.at = at
        self.target = target


class CitationMark:
    __slots__ = ("at", "mark", "source")

    def __init__(self, at: int, mark: str, source: int) -> None:
        self.at = at
        self.mark = mark
        self.source = source


_TEXT = ("text", None)


def _footnote_reading(
    found: _Found,
    prose: str,
    definitions: dict[str, str],
    sources_by_id: dict[str, int],
) -> tuple[str, str | int | None] | None:
    footnote = _FOOTNOTE.match(found.text)
    if footnote is None:
        return None
    if _defines(found, prose):
        return _TEXT
    key = _normalised_label(footnote.group(1) or "")
    if key in sources_by_id:
        return "mark", sources_by_id[key]
    target = definitions.get("^" + key)
    return _TEXT if target is None else ("link", target)


def _reading_of(
    found: _Found,
    prose: str,
    definitions: dict[str, str],
    sources_by_id: dict[str, int],
) -> tuple[str, str | int | None]:
    if found.at > 0 and prose[found.at - 1] == "!":
        return "link", None
    footnote = _footnote_reading(found, prose, definitions, sources_by_id)
    if footnote is not None:
        return footnote
    return "link", _link_target_of(found, prose, definitions)


def links_and_marks_of(
    body: str, frontmatter: Frontmatter
) -> tuple[list[BodyLink], list[CitationMark]]:
    prose = prose_of(body)
    definitions, bracketed_target_spans = _definitions_of(prose)
    sources_by_id = _sources_by_id(_cited_entries(frontmatter))
    links: list[BodyLink] = []
    marks: list[CitationMark] = []
    ordinal = 0
    for found in _link_matches(prose, bracketed_target_spans):
        reading, value = _reading_of(found, prose, definitions, sources_by_id)
        if reading == "mark" and isinstance(value, int):
            marks.append(CitationMark(found.at, found.text, value))
        if reading != "link":
            continue
        if isinstance(value, str):
            links.append(BodyLink(ordinal, found.at, value))
        ordinal += 1
    return links, marks


class OutgoingReference:
    __slots__ = ("ordinal", "relation", "section", "sentence", "target")

    def __init__(
        self,
        relation: str,
        ordinal: int,
        target: tuple[_TargetShape, str],
        section: str | None,
        sentence: str | None,
    ) -> None:
        self.relation = relation
        self.ordinal = ordinal
        self.target = target
        self.section = section
        self.sentence = sentence


def references_of(
    body: str, frontmatter: Frontmatter, path: str
) -> list[OutgoingReference]:
    prose = prose_of(body)

    links: list[OutgoingReference] = []
    for link in links_and_marks_of(body, frontmatter)[0]:
        target = _target_of(link.target, path)
        if target is None:
            continue
        links.append(
            OutgoingReference(
                "link",
                link.ordinal,
                target,
                _section_at(prose, link.at),
                _sentence_at(body, prose, link.at),
            )
        )

    sources = frontmatter.get("sources")
    lineage: list[OutgoingReference] = []
    if isinstance(sources, list):
        for ordinal, entry in enumerate(sources):
            if not isinstance(entry, Mapping | str):
                continue
            cited = cited_source(entry)
            target = None if cited is None else _target_of(cited[0], path)
            if target is None:
                continue
            lineage.append(OutgoingReference("lineage", ordinal, target, None, None))

    return links + lineage


class ResolvedTarget:
    __slots__ = ("iri", "kind", "status")

    def __init__(self, iri: str, kind: str | None, status: str | None) -> None:
        self.iri = iri
        self.kind = kind
        self.status = status


class UnresolvedReference(NamedTuple):
    relation: str
    ordinal: int
    target_path: str


def unresolved_references(
    references: Sequence[OutgoingReference],
    by_path: Mapping[str, ResolvedTarget],
) -> list[UnresolvedReference]:
    return [
        UnresolvedReference(reference.relation, reference.ordinal, reference.target[1])
        for reference in references
        if reference.target[0] == "path" and reference.target[1] not in by_path
    ]


class OutgoingEdge:
    __slots__ = ("label", "section", "sentence", "to_kind", "to_uid", "uid")

    def __init__(
        self,
        uid: str,
        label: str,
        to_uid: str,
        to_kind: str | None,
        section: str | None,
        sentence: str | None,
    ) -> None:
        self.uid = uid
        self.label = label
        self.to_uid = to_uid
        self.to_kind = to_kind
        self.section = section
        self.sentence = sentence


def outgoing_edges(
    *,
    iri: str,
    kind: str,
    references: Sequence[OutgoingReference],
    by_path: dict[str, ResolvedTarget],
    by_iri: dict[str, ResolvedTarget],
) -> list[OutgoingEdge]:
    edges: list[OutgoingEdge] = []
    cited: set[str] = set()
    for reference in references:
        shape, value = reference.target
        if shape == "iri":
            resolved = by_iri.get(value) or ResolvedTarget(value, None, None)
        else:
            found = by_path.get(value)
            if found is None:
                continue
            resolved = found
        if reference.relation == "lineage":
            if resolved.iri in cited:
                continue
            cited.add(resolved.iri)
            supersedes = (
                resolved.status == CONCEPT_DEPRECATED_STATUS and resolved.kind == kind
            )
            edges.append(
                OutgoingEdge(
                    f"lineage:{iri}:{reference.ordinal}",
                    SUPERSEDES_LABEL if supersedes else DERIVED_FROM_LABEL,
                    resolved.iri,
                    None,
                    None,
                    None,
                )
            )
            continue
        edges.append(
            OutgoingEdge(
                f"links_to:{iri}:{reference.ordinal}",
                LINKS_TO_LABEL,
                resolved.iri,
                resolved.kind,
                reference.section,
                reference.sentence,
            )
        )
    return edges
