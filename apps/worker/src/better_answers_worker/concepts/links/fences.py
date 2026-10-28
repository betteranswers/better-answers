import re
from typing import NamedTuple

from .scan import _leading_spaces, _line_start_from


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
