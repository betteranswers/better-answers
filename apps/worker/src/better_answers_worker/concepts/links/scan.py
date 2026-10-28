import re
from collections.abc import Callable
from typing import NamedTuple

_TIER_SHARED_WHITESPACE = " \t\n\r\f\v"


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


def _link_matches(prose: str, bracketed_target_spans: dict[int, int]) -> list[_Found]:
    close = _next_of(prose, "]")
    ending = _next_of(prose, ")")
    ends = _autolink_ends_of(prose)
    found: list[_Found] = []
    at = 0
    while at < len(prose):
        if at in bracketed_target_spans:
            at = bracketed_target_spans[at]
            continue
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


_WHITESPACE_RUN = re.compile(r"[ \t\n\r\f\v]+")


def _collapsed_whitespace(text: str) -> str:
    return " ".join(word for word in _WHITESPACE_RUN.split(text) if word)
