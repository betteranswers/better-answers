"""The derivation, ported: a concept's outgoing edges, read off its file.

**The contract this reproduces is the docblock over `LINK_DEFINITION` in
`packages/core/src/store/graph/index.ts`**, and reproducing it exactly is the whole job.
An ordinary edit's map change is written by the app inside its own commit transaction
(ADR 0023); a full rebuild is this tier writing the same edges again from the bundle and
the records, and the two are held equal, column by column, by the cross-tier
rebuild-equivalence test (`packages/core/test/rebuild-equivalence.test.ts`). That test
is the only enforceable meaning of *derived, never a source of truth*, so it is the
fence under every constant, every regular expression and every off-by-one below: a
difference here is a failing test over there, never a quietly different map.

This module is pure — text and rows in, edges out. Nothing here reads a database or a
file.

**Where the two languages could disagree, and what was done about it.** JavaScript's `m`
flag treats a lone carriage return as a line terminator and Python's `re.M` does not;
the body a concept file carries has had its `\\r\\n` pairs normalised away before it is
written (ADR 0014's normalisation), so the case cannot arise for a file the app wrote,
and a file it did not write is `malformed` before it reaches here. `[\\s\\S]` and the
`(?![\\s\\S])` end-of-input alternative behave the same in both engines. Case folding
uses Python's `str.lower()` against JavaScript's `toLowerCase()`, which agree on every
character either tier has seen in a reference label.
"""

import re
from collections.abc import Mapping

from .concept_file import Frontmatter, Scalar, cited_source, resolved_resource

#: The node label every concept wears, and the three edge labels a concept's own file
#: derives — `CONCEPT_NODE_LABEL`, `LINKS_TO_LABEL`, `SUPERSEDES_LABEL` and
#: `DERIVED_FROM_LABEL` in `packages/schema/src/graph-tables.ts`. Copied rather than
#: shared, because the two tiers share stores and never code (ADR 0005); the rebuild-
#: equivalence test is what holds the copies equal.
CONCEPT_NODE_LABEL = "Concept"
LINKS_TO_LABEL = "LINKS_TO"
SUPERSEDES_LABEL = "SUPERSEDES"
DERIVED_FROM_LABEL = "DERIVED_FROM"

#: `CONCEPT_DEPRECATED_STATUS` in `packages/schema/src/concept-tables.ts`: the status
#: that makes a lineage citation a succession rather than a derivation (ADR 0019).
CONCEPT_DEPRECATED_STATUS = "deprecated"

#: `CONCEPT_IRI_PREFIX` and `ULID_CHARACTERS`, likewise (ADR 0002, ADR 0035): the one
#: form a concept IRI has, and nothing else is one.
_IRI = re.compile(r"^https://better-answers\.com/c/[0-9A-HJKMNP-TV-Z]{26}$")

#: A `[label]: target` definition line.
_LINK_DEFINITION = re.compile(r"^ {0,3}\[([^\]]+)\]:\s*(\S+)", re.M)

#: Every link-reference form, one alternation so document order is one scan: inline,
#: then full/collapsed reference, then shortcut, then autolink — the order is what lets
#: the longer form win where two could start at one bracket.
_LINK = re.compile(
    r"\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\[[^\]]*\]|\[[^\]]*\]|<[a-z][a-z0-9+.-]*:[^>\s]*>",
    re.I,
)

#: A fenced code block: the fence line, everything to the first closing fence of its own
#: character **at least the opener's length** (CommonMark allows a longer closer), or
#: the file's end.
_FENCED_BLOCK = re.compile(
    r"^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|(?![\s\S]))", re.M
)

_BACKTICK_RUN = re.compile(r"`+")
_HEADING = re.compile(r"^\#{1,6}\s+(.*)$")
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?=\s|$)")
_SCHEMED = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
_WHITESPACE = re.compile(r"\s+")


def _blank(text: str) -> str:
    """Everything but the newlines blanked, so an index into the prose is an index into
    the file.
    """
    return re.sub(r"[^\n]", " ", text)


def _blanked_spans(body: str) -> str:
    """Inline code spans blanked by one left-to-right pass over the backtick runs.

    A run closes with the next run of exactly its length, an unpaired run is literal
    text (CommonMark). A scanner rather than a backtracking regular expression, for the
    reason the other tier gives: the body is tenant input, and a long unmatched run
    would cost a regular expression quadratic time.
    """
    runs = list(_BACKTICK_RUN.finditer(body))
    # Every run's place in the list, queued per length in document order: an opener
    # reads the head of its own length's queue, discarding entries at or before itself —
    # a run a blanked span already consumed included — so no run is scanned twice.
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
    """The body's prose: code blanked before any scan — fences first, so a span cannot
    eat a fence.
    """
    return _blanked_spans(_FENCED_BLOCK.sub(lambda found: _blank(found.group(0)), body))


def _normalised_label(label: str) -> str:
    """A reference label as definitions key it: trimmed, collapsed, case folded."""
    return _WHITESPACE.sub(" ", label.strip()).lower()


def _definitions_of(body: str) -> dict[str, str]:
    """The body's ``[label]: target`` definitions; a label's first one wins."""
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
    """One matched reference's target as written, or nothing — an undefined label."""
    text = found.group(0)
    if text.startswith("<"):
        return text[1:-1]
    if "](" in text:
        inline = _INLINE_TARGET.search(text)
        return None if inline is None else inline.group(1)
    reference = _REFERENCE.match(text)
    if reference is not None:
        # The collapsed form `[label][]` names itself; the full form names its second
        # pair.
        label = reference.group(1) if reference.group(2) == "" else reference.group(2)
        return definitions.get(_normalised_label(label or ""))
    # A shortcut reference — unless the bracket is a definition's own label, which the
    # colon after it says, and unless nothing defines it, in which case it is plain
    # text.
    after = found.start() + len(text)
    if after < len(body) and body[after] == ":":
        return None
    return definitions.get(_normalised_label(text[1:-1]))


def _target_of(raw: str, from_path: str) -> tuple[str, str] | None:
    """A target as written, read as the concept it names: ``("iri", …)``, ``("path",
    …)`` or nothing.
    """
    bare = raw.split("#")[0]
    if bare == "":
        return None
    if _IRI.match(bare):
        return "iri", bare
    # Any other scheme'd target — and the protocol-relative `//host/…` form — is an
    # external resource, never a concept.
    if _SCHEMED.match(bare) or bare.startswith("//"):
        return None
    return "path", resolved_resource(bare, from_path)[1:]


def _section_at(body: str, index: int) -> str | None:
    """The nearest preceding ATX heading's text — the *section* a link sits under."""
    for line in reversed(body[:index].split("\n")):
        heading = _HEADING.match(line)
        if heading is not None:
            return (heading.group(1) or "").strip()
    return None


def _flattened_links(text: str) -> str:
    """Link syntax flattened to its text, as the sentence's reader would say it."""
    flattened = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    flattened = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", flattened)
    flattened = re.sub(r"\[([^\]]*)\]", r"\1", flattened)
    return re.sub(r"<([a-z][a-z0-9+.-]*:[^>\s]*)>", r"\1", flattened, flags=re.I)


def _sentence_at(body: str, index: int) -> str:
    """The sentence around one position: the enclosing paragraph cut at the sentence
    terminators either side, links flattened, whitespace collapsed.
    """
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
    """A reference before resolution: where it points, and what the edge will carry."""

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
    """Every outgoing reference a concept's file makes, in the rule's own order."""
    prose = prose_of(body)
    definitions = _definitions_of(prose)

    links: list[OutgoingReference] = []
    for ordinal, found in enumerate(_LINK.finditer(prose)):
        # An image: matched, holding its ordinal, deriving nothing.
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
                # The prose, as the section reads it: a quoted code link never enters a
                # sentence.
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
    """A cited concept as the label rule reads it; kind and status ``None`` while it is
    unlanded.
    """

    __slots__ = ("iri", "kind", "status")

    def __init__(self, iri: str, kind: str | None, status: str | None) -> None:
        self.iri = iri
        self.kind = kind
        self.status = status


class OutgoingEdge:
    """The link and lineage columns of one derived edge; named edges carry the four as
    ``None``.
    """

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
    """The references resolved against the index and reduced to the edges the file
    makes.

    An **IRI** target makes its edge whether or not the target has landed — a link to
    not-yet-written knowledge is legal and the edge dangles — while a **path** target
    makes its edge only once the index resolves it. Lineage to one concept is one edge
    however many ``sources[]`` entries repeat it, and its label is ADR 0019's rule:
    `SUPERSEDES` when the cited concept is deprecated and of the citing concept's kind,
    else `DERIVED_FROM`.
    """
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
