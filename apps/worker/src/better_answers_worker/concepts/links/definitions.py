import re
from collections.abc import Mapping, Sequence
from typing import NamedTuple

from ..concept_file import Frontmatter, SourceEntry, as_javascript, cited_source
from .scan import (
    _TIER_SHARED_WHITESPACE,
    _collapsed_whitespace,
    _Found,
    _leading_spaces,
    _line_start_from,
    _next_of,
)


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


class _Definition(NamedTuple):
    key: str
    start: int
    end: int


def _definition_at(prose: str, at: int, close: list[int]) -> _Definition | None:
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
    return _Definition(_label_key(prose[opened + 1 : bracket]), *target)


def _definitions_of(prose: str) -> tuple[dict[str, str], dict[int, int]]:
    definitions: dict[str, str] = {}
    bracketed_target_spans: dict[int, int] = {}
    close = _next_of(prose, "]")
    at = 0
    while at < len(prose):
        found = _definition_at(prose, at, close)
        if found is None:
            at = _line_start_from(prose, at + 1)
            continue
        key, start, end = found
        target = prose[start:end]
        if target.startswith("<"):
            bracketed_target_spans[start] = end
        if key not in definitions:
            definitions[key] = target.removeprefix("<").removesuffix(">")
        at = _line_start_from(prose, end)
    return definitions, bracketed_target_spans


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
