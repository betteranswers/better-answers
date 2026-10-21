import re
from collections.abc import Callable, Mapping, Sequence
from typing import Literal, NamedTuple

from .concept_file import (
    SCHEMED,
    Frontmatter,
    Scalar,
    SourceEntry,
    as_javascript,
    cited_source,
    resolved_resource,
)

CONCEPT_NODE_LABEL = "Concept"
LINKS_TO_LABEL = "LINKS_TO"
SUPERSEDES_LABEL = "SUPERSEDES"
DERIVED_FROM_LABEL = "DERIVED_FROM"


CONCEPT_DEPRECATED_STATUS = "deprecated"


PORT_OF = (
    "packages/schema/src/concept-file.ts",
    "packages/core/src/store/map/index.ts",
)
AGREEMENT = "links"


_IRI = re.compile(r"^https://better-answers\.com/c/[0-9A-HJKMNP-TV-Z]{26}$")


_TIER_SHARED_WHITESPACE = " \t\n\r\f\v"

_FOOTNOTE = re.compile(r"^\[\^([^\]]*)\]$")


class _Found(NamedTuple):
    at: int
    text: str


def _line_start_from(text: str, from_: int) -> int:
    if from_ <= 0:
        return 0
    if from_ > len(text):
        return len(text)
    if text[from_ - 1] == "\n":
        return from_
    found = text.find("\n", from_)
    return len(text) if found == -1 else found + 1


def _next_of(text: str, close: str) -> list[int]:
    next_: list[int] = [-1] * (len(text) + 1)
    for at in range(len(text) - 1, -1, -1):
        next_[at] = at if text[at] == close else next_[at + 1]
    return next_


def _next_stops(text: str, stops: Callable[[str], bool]) -> list[int]:
    next_: list[int] = [-1] * (len(text) + 1)
    for at in range(len(text) - 1, -1, -1):
        next_[at] = at if stops(text[at]) else next_[at + 1]
    return next_


def _autolink_ends_of(text: str) -> list[int]:
    def stops(char: str) -> bool:
        return char == ">" or char in _TIER_SHARED_WHITESPACE

    return _next_stops(text, stops)


_SCHEME = re.compile(r"[A-Za-z0-9+.-]")


def _colon_after(text: str, at: int) -> int | None:
    if at + 1 >= len(text) or not re.match(r"[A-Za-z]", text[at + 1]):
        return None
    scheme = at + 2
    while scheme < len(text) and _SCHEME.match(text[scheme]):
        scheme += 1
    return scheme if scheme < len(text) and text[scheme] == ":" else None


def _autolink_closes_at(text: str, at: int, ends: list[int]) -> int | None:
    colon = _colon_after(text, at)
    if colon is None:
        return None
    end = ends[colon + 1]
    return end if end != -1 and text[end] == ">" else None


def _inline_form_at(prose: str, bracket: int, ending: list[int]) -> int | None:
    if prose[bracket + 1 : bracket + 2] != "(":
        return None
    closed = ending[bracket + 2]
    return None if closed == -1 else closed + 1


def _reference_form_at(
    prose: str, at: int, bracket: int, close: list[int]
) -> int | None:
    if prose[bracket + 1 : bracket + 2] != "[" or prose[at + 1 : at + 2] == "^":
        return None
    reference = close[bracket + 2]
    return None if reference == -1 else reference + 1


def _bracket_form_at(
    prose: str, at: int, close: list[int], ending: list[int]
) -> int | None:
    bracket = close[at + 1]
    if bracket == -1:
        return None
    found = _inline_form_at(prose, bracket, ending)
    if found is None:
        found = _reference_form_at(prose, at, bracket, close)
    return bracket + 1 if found is None else found


def _link_matches(prose: str) -> list[_Found]:
    close = _next_of(prose, "]")
    ending = _next_of(prose, ")")
    ends = _autolink_ends_of(prose)
    found: list[_Found] = []
    at = 0
    while at < len(prose):
        if prose[at] == "[":
            end = _bracket_form_at(prose, at, close, ending)
            if end is not None:
                found.append(_Found(at, prose[at:end]))
                at = end
                continue
        elif prose[at] == "<":
            end = _autolink_closes_at(prose, at, ends)
            if end is not None:
                found.append(_Found(at, prose[at : end + 1]))
                at = end + 1
                continue
        at += 1
    return found


def _leading_spaces(text: str, at: int) -> int:
    spaces = 0
    while spaces < 4 and text[at + spaces : at + spaces + 1] == " ":
        spaces += 1
    return spaces


def _mark_run(text: str, at: int, mark: str) -> int:
    marker = at
    while text[marker : marker + 1] == mark:
        marker += 1
    return marker


class _OpenedFence(NamedTuple):
    mark: str
    marks: int
    line_end: int


def _opened_fence_at(body: str, at: int) -> _OpenedFence | None:
    spaces = _leading_spaces(body, at)
    opened = at + spaces
    mark = body[opened : opened + 1]
    if spaces > 3 or mark not in ("`", "~"):
        return None
    run = _mark_run(body, opened, mark)
    if run - opened < 3:
        return None
    line_end = body.find("\n", run)
    return None if line_end == -1 else _OpenedFence(mark, run - opened, line_end)


def _closing_at(body: str, at: int, mark: str, marks: int) -> int:
    spaces = _leading_spaces(body, at)
    if spaces > 3:
        return -1
    run = _mark_run(body, at + spaces, mark)
    if run - (at + spaces) < marks:
        return -1
    tail = run
    while body[tail : tail + 1] in (" ", "\t"):
        tail += 1
    if tail == len(body) or body[tail] == "\n":
        return tail
    return -1


def _closing_line_end(body: str, from_: int, mark: str, marks: int) -> int:
    at = from_
    while at < len(body):
        end = _closing_at(body, at, mark, marks)
        if end != -1:
            return end
        at = _line_start_from(body, at + 1)
    return -1


def _fenced_blocks(body: str) -> list[tuple[int, int]]:
    blocks: list[tuple[int, int]] = []
    at = 0
    while at < len(body):
        opened = _opened_fence_at(body, at)
        if opened is None:
            at = _line_start_from(body, at + 1)
            continue
        end = _closing_line_end(body, opened.line_end + 1, opened.mark, opened.marks)
        close = len(body) if end == -1 else end
        blocks.append((at, close))
        at = _line_start_from(body, close + 1)
    return blocks


_BACKTICK_RUN = re.compile(r"`+")
_HEADING = re.compile(r"^\#{1,6}[ \t\n\r\f\v]+([^\n]*)")
_BLANK = re.compile(r"[ \t\r\f\v]*")
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?=[ \t\n\r\f\v]|$)")
_WHITESPACE_RUN = re.compile(r"[ \t\n\r\f\v]+")


def _blank(text: str) -> str:
    return re.sub(r"[^\n]", " ", text)


def _blanked_spans(body: str) -> str:
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
    pieces: list[str] = []
    cursor = 0
    for start, end in _fenced_blocks(body):
        pieces.append(body[cursor:start])
        pieces.append(_blank(body[start:end]))
        cursor = end
    pieces.append(body[cursor:])
    return _blanked_spans("".join(pieces))


def _collapsed_whitespace(text: str) -> str:
    return " ".join(word for word in _WHITESPACE_RUN.split(text) if word)


def _normalised_label(label: str) -> str:
    return _collapsed_whitespace(label).lower()


def _label_key(label: str) -> str:
    if label.startswith("^"):
        return "^" + _normalised_label(label[1:])
    return _normalised_label(label)


def _target_after(prose: str, from_: int) -> tuple[int, int] | None:
    start = from_
    while start < len(prose) and prose[start] in _TIER_SHARED_WHITESPACE:
        start += 1
    if start == len(prose):
        return None
    end = start
    while end < len(prose) and prose[end] not in _TIER_SHARED_WHITESPACE:
        end += 1
    return start, end


def _definition_at(
    prose: str, at: int, close: list[int]
) -> tuple[str, str, int] | None:
    spaces = _leading_spaces(prose, at)
    opened = at + spaces
    if spaces > 3 or prose[opened : opened + 1] != "[":
        return None
    bracket = close[opened + 1]
    if (
        bracket == -1
        or bracket == opened + 1
        or prose[bracket + 1 : bracket + 2] != ":"
    ):
        return None
    target = _target_after(prose, bracket + 2)
    if target is None:
        return None
    start, end = target
    return _label_key(prose[opened + 1 : bracket]), prose[start:end], end


def _definitions_of(prose: str) -> dict[str, str]:
    definitions: dict[str, str] = {}
    close = _next_of(prose, "]")
    at = 0
    while at < len(prose):
        found = _definition_at(prose, at, close)
        if found is None:
            at = _line_start_from(prose, at + 1)
            continue
        key, target, end = found
        if key not in definitions:
            definitions[key] = target.lstrip("<").rstrip(">")
        at = _line_start_from(prose, end)
    return definitions


def _cited_entries(frontmatter: Frontmatter) -> list[SourceEntry | str]:
    sources = frontmatter.get("sources")
    if not isinstance(sources, list):
        return []
    return [
        entry
        for entry in sources
        if isinstance(entry, Mapping | str) and cited_source(entry) is not None
    ]


def _sources_by_id(entries: Sequence[SourceEntry | str]) -> dict[str, int]:
    by_id: dict[str, int] = {}
    for index, entry in enumerate(entries):
        if isinstance(entry, str) or entry.get("id") is None:
            continue
        key = _normalised_label(as_javascript(entry.get("id")))
        if key != "" and key not in by_id:
            by_id[key] = index
    return by_id


_INLINE_TARGET = re.compile(r"\]\([ \t\n\r\f\v]*<?([^) \t\n\r\f\v>]+)")
_REFERENCE = re.compile(r"^\[([^\]]*)\]\[([^\]]*)\]$")


def _defines(found: _Found, body: str) -> bool:
    end = found.at + len(found.text)
    return end < len(body) and body[end] == ":"


def _link_target_of(
    found: _Found, body: str, definitions: dict[str, str]
) -> str | None:
    text = found.text
    if text.startswith("<"):
        return text[1:-1]
    if "](" in text:
        inline = _INLINE_TARGET.search(text)
        return None if inline is None else inline.group(1)
    reference = _REFERENCE.match(text)
    if reference is not None:
        label = reference.group(1) if reference.group(2) == "" else reference.group(2)
        return definitions.get(_label_key(label or ""))

    if _defines(found, body):
        return None
    return definitions.get(_label_key(text[1:-1]))


type _TargetShape = Literal["iri", "path"]


def _target_of(raw: str, from_path: str) -> tuple[_TargetShape, str] | None:
    bare = raw.split("#")[0]
    if bare == "":
        return None
    if _IRI.match(bare):
        return "iri", bare

    if SCHEMED.match(bare) or bare.startswith("//"):
        return None
    return "path", resolved_resource(bare, from_path)[1:]


def _section_at(body: str, index: int) -> str | None:
    for line in reversed(body[:index].split("\n")):
        heading = _HEADING.match(line)
        if heading is not None:
            return _collapsed_whitespace(heading.group(1))
    return None


type _SpanOf = Callable[[str, int, list[int], list[int]], int | None]


def _labels_of(text: str, span_of: _SpanOf) -> str:
    close = _next_of(text, "]")
    ending = _next_of(text, ")")
    pieces: list[str] = []
    cursor = 0
    at = 0
    while at < len(text):
        if text[at] != "[":
            at += 1
            continue
        bracket = close[at + 1]
        if bracket == -1:
            at += 1
            continue
        end = span_of(text, bracket, ending, close)
        if end is None:
            at += 1
            continue
        pieces.append(text[cursor:at])
        pieces.append(text[at + 1 : bracket])
        cursor = end
        at = end
    pieces.append(text[cursor:])
    return "".join(pieces)


def _inline_span(
    text: str, bracket: int, ending: list[int], _close: list[int]
) -> int | None:
    if text[bracket + 1 : bracket + 2] != "(":
        return None
    closed = ending[bracket + 2]
    return None if closed == -1 else closed + 1


def _reference_span(
    text: str, bracket: int, _ending: list[int], close: list[int]
) -> int | None:
    if text[bracket + 1 : bracket + 2] != "[":
        return None
    reference = close[bracket + 2]
    return None if reference == -1 else reference + 1


def _bare_span(
    _text: str, bracket: int, _ending: list[int], _close: list[int]
) -> int | None:
    return bracket + 1


def _flattened_autolinks(text: str) -> str:
    ends = _autolink_ends_of(text)
    pieces: list[str] = []
    cursor = 0
    at = 0
    while at < len(text):
        if text[at] != "<":
            at += 1
            continue
        end = _autolink_closes_at(text, at, ends)
        if end is None:
            at += 1
            continue
        pieces.append(text[cursor:at])
        pieces.append(text[at + 1 : end])
        cursor = end + 1
        at = end + 1
    pieces.append(text[cursor:])
    return "".join(pieces)


def _flattened_links(text: str) -> str:
    flattened = _labels_of(text, _inline_span)
    flattened = _labels_of(flattened, _reference_span)
    flattened = _labels_of(flattened, _bare_span)
    return _flattened_autolinks(flattened)


def _paragraph_around(body: str, index: int) -> tuple[int, int]:
    above = body.rfind("\n", 0, index + 1)
    while above != -1:
        line = body.rfind("\n", 0, above)
        if _BLANK.fullmatch(body, line + 1, above):
            break
        above = line
    below = body.find("\n", index)
    while below != -1:
        line = body.find("\n", below + 1)
        if _BLANK.fullmatch(body, below + 1, len(body) if line == -1 else line):
            break
        below = line
    return above + 1, len(body) if below == -1 else below


def _sentence_at(body: str, prose: str, index: int) -> str:
    paragraph_start, paragraph_end = _paragraph_around(body, index)
    paragraph = prose[paragraph_start:paragraph_end]
    at = index - paragraph_start

    start = 0
    end = len(paragraph)
    for boundary in _SENTENCE_BOUNDARY.finditer(paragraph):
        if boundary.start() < at:
            start = boundary.start() + 1
        else:
            end = boundary.start() + 1
            break
    return _collapsed_whitespace(_flattened_links(paragraph[start:end]))


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
    definitions = _definitions_of(prose)
    sources_by_id = _sources_by_id(_cited_entries(frontmatter))
    links: list[BodyLink] = []
    marks: list[CitationMark] = []
    ordinal = 0
    for found in _link_matches(prose):
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
    "BodyLink",
    "CitationMark",
    "OutgoingEdge",
    "OutgoingReference",
    "ResolvedTarget",
    "Scalar",
    "links_and_marks_of",
    "outgoing_edges",
    "prose_of",
    "references_of",
]
