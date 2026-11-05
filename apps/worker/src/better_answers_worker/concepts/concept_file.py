import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any, NoReturn

type Scalar = str | int | float | bool | None
type SourceEntry = Mapping[str, Scalar]
type FrontmatterValue = Scalar | Sequence[str] | Sequence[SourceEntry]
type Frontmatter = Mapping[str, FrontmatterValue]


class MalformedConceptFileError(ValueError):
    pass


_FRONTMATTER_LINE = re.compile(r'^("(?:[^"\\]|\\.)*"):(?: (.*))?$')


UNHASHED_KEYS = frozenset({"generated", "verified", "stale_after", "status", "iri"})


PORT_OF = ("packages/core/src/concepts/file.ts",)
AGREEMENT = "concept-file"


def _not_a_number(constant: str) -> NoReturn:
    raise MalformedConceptFileError(
        f"frontmatter value {constant} is not allowed in JSON"
    )


def _scalar_of(text: str) -> Scalar:
    try:
        value: Any = json.loads(text, parse_constant=_not_a_number)
    except ValueError as cause:
        raise MalformedConceptFileError(
            f"frontmatter value {text!r} is not valid JSON"
        ) from cause

    if value is None or isinstance(value, str | bool | int | float):
        return value
    raise MalformedConceptFileError(
        f"frontmatter value {text!r} is a JSON array or object. A value here is a"
        " string, a number, a boolean or null"
    )


def _pair_of(line: str) -> tuple[str, str | None]:
    match = _FRONTMATTER_LINE.match(line)
    if match is None:
        raise MalformedConceptFileError(
            f"frontmatter line {line!r} is not a quoted key followed by a colon"
        )
    key = _scalar_of(match.group(1))
    if not isinstance(key, str):
        raise MalformedConceptFileError(
            f"the key in frontmatter line {line!r} is not a string"
        )
    return key, match.group(2)


def _opener_of(line: str) -> str | tuple[str, str | None]:
    try:
        return _pair_of(line)
    except MalformedConceptFileError:
        item = _scalar_of(line)
        if not isinstance(item, str):
            raise MalformedConceptFileError(
                f"list item {line!r} is neither a string nor a key-value pair"
            ) from None
        return item


def _object_item_of(
    lines: list[str], first: tuple[str, str | None], at: int, close: int
) -> tuple[dict[str, Scalar], int]:
    key, rest = first
    entry: dict[str, Scalar] = {}
    while True:
        if rest is None:
            raise MalformedConceptFileError(
                f"key {key!r} in a list item has no value. A list item cannot hold a"
                " nested list"
            )
        if key in entry:
            raise MalformedConceptFileError(
                f"key {key!r} appears twice in one list item"
            )
        entry[key] = _scalar_of(rest)
        if at >= close or not lines[at].startswith("    "):
            return entry, at
        key, rest = _pair_of(lines[at][4:])
        at += 1


def _list_items_of(
    lines: list[str], start: int, close: int
) -> tuple[Sequence[str] | Sequence[SourceEntry], int]:
    strings: list[str] = []
    entries: list[dict[str, Scalar]] = []
    at = start
    while at < close and lines[at].startswith("  - "):
        opener = _opener_of(lines[at][4:])
        at += 1
        if isinstance(opener, str):
            strings.append(opener)
            continue
        entry, at = _object_item_of(lines, opener, at, close)
        entries.append(entry)
    if at == start:
        raise MalformedConceptFileError(
            f"the key on line {start} has no value and no list items"
        )
    if strings and entries:
        raise MalformedConceptFileError(
            f"the list under the key on line {start} mixes strings and key-value"
            " items. A list holds only one of the two"
        )
    return (entries if entries else strings), at


def parse_concept_file(content: str) -> tuple[Frontmatter, str]:
    lines = content.split("\n")
    if not lines or lines[0] != "---":
        raise MalformedConceptFileError(
            "the file does not start with a '---' frontmatter fence"
        )
    try:
        close = lines.index("---", 1)
    except ValueError:
        raise MalformedConceptFileError(
            "the frontmatter has no closing '---' line"
        ) from None
    if close + 1 >= len(lines) or lines[close + 1] != "":
        raise MalformedConceptFileError(
            "the closing '---' line of the frontmatter is not followed by a blank line"
        )

    frontmatter: dict[str, FrontmatterValue] = {}
    at = 1
    while at < close:
        key, rest = _pair_of(lines[at])

        if key in frontmatter:
            raise MalformedConceptFileError(f"frontmatter key {key!r} appears twice")
        at += 1
        if rest is not None:
            frontmatter[key] = [] if rest == "[]" else _scalar_of(rest)
            continue
        frontmatter[key], at = _list_items_of(lines, at, close)
    return frontmatter, "\n".join(lines[close + 2 :])


def normalised_body(body: str) -> str:
    without_returns = body.replace("\r\n", "\n")
    trimmed = "\n".join(line.rstrip(" \t") for line in without_returns.split("\n"))
    return trimmed.rstrip("\n") + "\n"


SCHEMED = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def resolved_resource(resource: str, from_path: str) -> str:
    if resource.startswith("//") or SCHEMED.match(resource):
        return resource
    directory = "" if resource.startswith("/") else from_path[: from_path.rfind("/")]
    segments: list[str] = []
    for segment in f"{directory}/{resource}".split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            if segments:
                segments.pop()
        else:
            segments.append(segment)
    return "/" + "/".join(segments)


TIER_SHARED_WHITESPACE = " \t\n\r\f\v"


def trimmed_whitespace(text: str) -> str:
    return text.strip(TIER_SHARED_WHITESPACE)


def cited_source(entry: SourceEntry | str) -> tuple[str, str | None] | None:
    if isinstance(entry, str):
        hash_at = entry.rfind("#")
        resource = trimmed_whitespace(entry if hash_at == -1 else entry[:hash_at])
        if resource == "":
            return None
        return resource, None if hash_at == -1 else entry[hash_at + 1 :]
    resource_value = entry.get("resource")
    if not isinstance(resource_value, str):
        return None
    resource = trimmed_whitespace(resource_value)
    if resource == "":
        return None
    locator = entry.get("locator")

    return resource, None if locator is None else as_javascript(locator)


def as_javascript(value: Scalar) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return _number_text(value)
    return "" if value is None else value


_EXACT_INTEGER = 2**53


def _number_text(value: int | float) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and abs(value) < _EXACT_INTEGER:
        return str(value)
    number = float(value)
    if number == 0:
        return "0"
    sign, digits, exponent = Decimal(repr(number)).normalize().as_tuple()
    if not isinstance(exponent, int):
        raise MalformedConceptFileError(f"frontmatter number {value!r} is not finite")
    figures = "".join(str(digit) for digit in digits)
    k = len(figures)
    n = exponent + k
    if k <= n <= 21:
        text = figures + "0" * (n - k)
    elif 0 < n <= 21:
        text = f"{figures[:n]}.{figures[n:]}"
    elif -6 < n <= 0:
        text = "0." + "0" * (-n) + figures
    else:
        power = n - 1
        mantissa = figures if k == 1 else f"{figures[0]}.{figures[1:]}"
        text = f"{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"
    return f"-{text}" if sign else text


def _json_text(value: object) -> str:
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, int | float):
        return _number_text(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_json_text(item) for item in value) + "]"
    if isinstance(value, tuple):
        return "[" + ",".join(_json_text(item) for item in value) + "]"
    if isinstance(value, dict):
        pairs = (
            f"{json.dumps(key, ensure_ascii=False)}:{_json_text(value[key])}"
            for key in sorted(value, key=_utf16_order)
        )
        return "{" + ",".join(pairs) + "}"
    raise MalformedConceptFileError(
        f"the content hash cannot encode a {type(value).__name__}: {value!r}"
    )


def _reduced_sources(value: FrontmatterValue, path: str) -> list[list[str | None]]:
    if not isinstance(value, list):
        return []
    reduced: list[list[str | None]] = []
    for entry in value:
        if not isinstance(entry, Mapping | str):
            continue
        cited = cited_source(entry)
        if cited is None:
            continue
        resource, locator = cited
        reduced.append([resolved_resource(resource, path), locator])
    return reduced


def canonical_frontmatter(frontmatter: Frontmatter, path: str) -> str:
    pairs = []
    for key in sorted(frontmatter, key=_utf16_order):
        if key in UNHASHED_KEYS:
            continue
        value = frontmatter[key]
        reduced = _reduced_sources(value, path) if key == "sources" else value
        pairs.append(f"{json.dumps(key, ensure_ascii=False)}:{_json_text(reduced)}")
    return "{" + ",".join(pairs) + "}"


def _utf16_order(key: str) -> tuple[int, ...]:
    return tuple(key.encode("utf-16-be"))


def content_hash_of(frontmatter: Frontmatter, body: str, path: str) -> str:
    canonical = f"{canonical_frontmatter(frontmatter, path)}\n{normalised_body(body)}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
