import re
from collections.abc import Callable

from .scan import (
    _autolink_closes_at,
    _autolink_ends_of,
    _collapsed_whitespace,
    _next_of,
)

_HEADING = re.compile(r"^\#{1,6}[ \t\n\r\f\v]+([^\n]*)")


_BLANK = re.compile(r"[ \t\r\f\v]*")


_SENTENCE_BOUNDARY = re.compile(r"[.!?](?:\[\^[^\[\]]*\])*(?=[ \t\n\r\f\v]|$)")


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
        if boundary.end() <= at:
            start = boundary.end()
        else:
            end = boundary.end()
            break
    return _collapsed_whitespace(_flattened_links(paragraph[start:end]))
