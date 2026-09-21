import re
from collections.abc import Mapping

from .concept_file import Frontmatter, Scalar, cited_source, resolved_resource

CONCEPT_NODE_LABEL = "Concept"
LINKS_TO_LABEL = "LINKS_TO"
SUPERSEDES_LABEL = "SUPERSEDES"
DERIVED_FROM_LABEL = "DERIVED_FROM"


CONCEPT_DEPRECATED_STATUS = "deprecated"


_IRI = re.compile(r"^https://better-answers\.com/c/[0-9A-HJKMNP-TV-Z]{26}$")


_LINK_DEFINITION = re.compile(r"^ {0,3}\[([^\]]+)\]:\s*(\S+)", re.M)


_LINK = re.compile(
    r"\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\[[^\]]*\]|\[[^\]]*\]|<[a-z][a-z0-9+.-]*:[^>\s]*>",
    re.I,
)


_FENCED_BLOCK = re.compile(
    r"^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|(?![\s\S]))", re.M
)

_BACKTICK_RUN = re.compile(r"`+")
_HEADING = re.compile(r"^\#{1,6}\s+(.*)$")
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?=\s|$)")
_SCHEMED = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
_WHITESPACE = re.compile(r"\s+")


def _blank(text: str) -> str:
    return re.sub(r"[^\n]", " ", text)


def _blanked_spans(body: str) -> str:
    # A scanner, because the body is tenant input: a long unmatched run of backticks
    # would cost a backtracking regular expression quadratic time.
    runs = list(_BACKTICK_RUN.finditer(body))

    queued: dict[int, list[int]] = {}
    for position, run in enumerate(runs):
        queued.setdefault(len(run.group(0)), []).append(position)
    heads: dict[int, int] = {}

    pieces: list[str] = []
    cursor = 0
    at = 0
    while at < len(runs):
        opener = runs[at]
        length = len(opener.group(0))
        queue = queued.get(length, [])
        head = heads.get(length, 0)
        while head < len(queue) and queue[head] <= at:
            head += 1
        heads[length] = head
        if head >= len(queue):
            at += 1
            continue
        closer = runs[queue[head]]
        end = closer.start() + len(closer.group(0))
        pieces.append(body[cursor : opener.start()])
        pieces.append(_blank(body[opener.start() : end]))
        cursor = end
        at = queue[head] + 1
    pieces.append(body[cursor:])
    return "".join(pieces)


def prose_of(body: str) -> str:
    return _blanked_spans(_FENCED_BLOCK.sub(lambda found: _blank(found.group(0)), body))


def _normalised_label(label: str) -> str:
    return _WHITESPACE.sub(" ", label.strip()).lower()


def _definitions_of(body: str) -> dict[str, str]:
    definitions: dict[str, str] = {}
    for found in _LINK_DEFINITION.finditer(body):
        label = _normalised_label(found.group(1) or "")
        if label not in definitions:
            definitions[label] = (found.group(2) or "").lstrip("<").rstrip(">")
    return definitions


_INLINE_TARGET = re.compile(r"\]\(\s*<?([^)\s>]+)")
_REFERENCE = re.compile(r"^\[([^\]]*)\]\[([^\]]*)\]$")


def _link_target_of(
    found: re.Match[str], body: str, definitions: dict[str, str]
) -> str | None:
    text = found.group(0)
    if text.startswith("<"):
        return text[1:-1]
    if "](" in text:
        inline = _INLINE_TARGET.search(text)
        return None if inline is None else inline.group(1)
    reference = _REFERENCE.match(text)
    if reference is not None:
        label = reference.group(1) if reference.group(2) == "" else reference.group(2)
        return definitions.get(_normalised_label(label or ""))

    after = found.start() + len(text)
    if after < len(body) and body[after] == ":":
        return None
    return definitions.get(_normalised_label(text[1:-1]))


def _target_of(raw: str, from_path: str) -> tuple[str, str] | None:
    bare = raw.split("#")[0]
    if bare == "":
        return None
    if _IRI.match(bare):
        return "iri", bare

    if _SCHEMED.match(bare) or bare.startswith("//"):
        return None
    return "path", resolved_resource(bare, from_path)[1:]


def _section_at(body: str, index: int) -> str | None:
    for line in reversed(body[:index].split("\n")):
        heading = _HEADING.match(line)
        if heading is not None:
            return (heading.group(1) or "").strip()
    return None


def _flattened_links(text: str) -> str:
    flattened = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    flattened = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", flattened)
    flattened = re.sub(r"\[([^\]]*)\]", r"\1", flattened)
    return re.sub(r"<([a-z][a-z0-9+.-]*:[^>\s]*)>", r"\1", flattened, flags=re.I)


def _sentence_at(body: str, index: int) -> str:
    before = body.rfind("\n\n", 0, index + 2)
    paragraph_start = 0 if before == -1 else before + 2
    after = body.find("\n\n", index)
    paragraph = body[paragraph_start : len(body) if after == -1 else after]
    at = index - paragraph_start

    start = 0
    end = len(paragraph)
    for boundary in _SENTENCE_BOUNDARY.finditer(paragraph):
        if boundary.start() < at:
            start = boundary.start() + 1
        else:
            end = boundary.start() + 1
            break
    return _WHITESPACE.sub(" ", _flattened_links(paragraph[start:end])).strip()


class OutgoingReference:
    __slots__ = ("ordinal", "relation", "section", "sentence", "target")

    def __init__(
        self,
        relation: str,
        ordinal: int,
        target: tuple[str, str],
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
    definitions = _definitions_of(prose)

    links: list[OutgoingReference] = []
    for ordinal, found in enumerate(_LINK.finditer(prose)):
        if found.start() > 0 and prose[found.start() - 1] == "!":
            continue
        raw = _link_target_of(found, prose, definitions)
        target = None if raw is None else _target_of(raw, path)
        if target is None:
            continue
        links.append(
            OutgoingReference(
                "link",
                ordinal,
                target,
                _section_at(prose, found.start()),
                _sentence_at(prose, found.start()),
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
    path: str,
    body: str,
    frontmatter: Frontmatter,
    by_path: dict[str, ResolvedTarget],
    by_iri: dict[str, ResolvedTarget],
) -> list[OutgoingEdge]:
    edges: list[OutgoingEdge] = []
    cited: set[str] = set()
    for reference in references_of(body, frontmatter, path):
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


__all__ = [
    "CONCEPT_DEPRECATED_STATUS",
    "CONCEPT_NODE_LABEL",
    "DERIVED_FROM_LABEL",
    "LINKS_TO_LABEL",
    "SUPERSEDES_LABEL",
    "OutgoingEdge",
    "OutgoingReference",
    "ResolvedTarget",
    "Scalar",
    "outgoing_edges",
    "prose_of",
    "references_of",
]
