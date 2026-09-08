"""The second parser: a concept file read back, and the content hash over it.

**Two parsers exist by decision and now police each other** (ADR 0012). The app writes
every file in the bundle (`renderConceptFile` in `packages/core/src/concepts/index.ts`)
and reads it back with a parser that accepts exactly that grammar and nothing else; this
module is the other half of the pair, and the nightly audit is where they meet. So this
reads the renderer's grammar and refuses everything else, rather than being a general
YAML reader: a reader that accepted more would agree with the app about files the app
never wrote and disagree about files it did, which is the one outcome that makes the
cross-check worthless.

The grammar, exactly as the renderer writes it:

- ``---``, the frontmatter lines, ``---``, a blank line, then the body.
- every key is a JSON string, then ``:``.
- a scalar value is one space then its JSON; an empty list is ``[]``.
- a list is the lines beneath its key: ``  - `` opens an item, and an entry's later
  fields sit four spaces in. A list is strings or objects and never a mix.

The hash is ADR 0014's, ported term for term from `contentHashOf`: SHA-256 over the
canonical JSON of the frontmatter — keys sorted, the trust and identity keys dropped,
``sources[]`` reduced to its ordered ``(resolved resource, locator)`` pairs — then a
newline, then the normalised body. Every place the two tiers could disagree about bytes
is called out where it happens below, because a disagreement here reads as a mismatched
concept and sends somebody looking at the bundle instead of at this file.
"""

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

#: A frontmatter value, in the shapes the renderer writes: a scalar, a list of strings,
#: or OKF's one list of objects (``sources[]``). Written as `Sequence` and `Mapping`
#: rather than `list` and `dict` because those two are invariant in what they hold: a
#: caller with a perfectly good `list[dict[str, str]]` could not otherwise hand it to a
#: reader that accepts every scalar, and every call site would carry a cast instead.
type Scalar = str | int | float | bool | None
type SourceEntry = Mapping[str, Scalar]
type FrontmatterValue = Scalar | Sequence[str] | Sequence[SourceEntry]
type Frontmatter = Mapping[str, FrontmatterValue]


class MalformedConceptFileError(ValueError):
    """A file this grammar does not cover — which the app's parser answers `malformed`
    to.

    The reconciler stops at such a commit rather than guessing what it meant, and the
    nightly audit counts the path rather than deciding the hash disagrees: a file nobody
    can read is not a file whose hash is wrong.
    """


#: One frontmatter line as the renderer writes it: a JSON-quoted key, a colon, then a
#: value or nothing (a list follows on the lines beneath).
_FRONTMATTER_LINE = re.compile(r'^("(?:[^"\\]|\\.)*"):(?: (.*))?$')

#: The frontmatter keys ADR 0014's content hash leaves out: the trust the platform
#: derives and the identity it minted. Hashing them would make a check of its own
#: recording move the hash and turn *Checked* into *Changed since checked* on the next
#: read.
UNHASHED_KEYS = frozenset({"generated", "verified", "stale_after", "status", "iri"})


def _scalar_of(text: str) -> Scalar:
    """A JSON text read as one scalar the frontmatter may hold, or a refusal."""
    try:
        value: Any = json.loads(text)
    except ValueError as cause:
        raise MalformedConceptFileError(f"not a JSON value: {text!r}") from cause
    # `bool` before `int`, because Python's bool is an int and the two are different
    # values on the wire; JSON's null is None, which the renderer writes for a null
    # scalar.
    if value is None or isinstance(value, str | bool | int | float):
        return value
    raise MalformedConceptFileError(f"not a scalar the renderer writes: {text!r}")


def _pair_of(line: str) -> tuple[str, str | None]:
    """A frontmatter line split into its key and what followed the colon."""
    match = _FRONTMATTER_LINE.match(line)
    if match is None:
        raise MalformedConceptFileError(f"not a frontmatter line: {line!r}")
    key = _scalar_of(match.group(1))
    if not isinstance(key, str):
        raise MalformedConceptFileError(f"not a frontmatter key: {line!r}")
    return key, match.group(2)


def _list_items_of(
    lines: list[str], start: int, close: int
) -> tuple[Sequence[str] | Sequence[SourceEntry], int]:
    """The items of one list, from the line after its key, and where the list ended."""
    strings: list[str] = []
    entries: list[dict[str, Scalar]] = []
    at = start
    while at < close and lines[at].startswith("  - "):
        opener = lines[at][4:]
        at += 1
        try:
            key, rest = _pair_of(opener)
        except MalformedConceptFileError:
            item = _scalar_of(opener)
            if not isinstance(item, str):
                raise MalformedConceptFileError(
                    f"not a list item: {opener!r}"
                ) from None
            strings.append(item)
            continue
        entry: dict[str, Scalar] = {}
        while True:
            if rest is None:
                raise MalformedConceptFileError(
                    f"a nested list is not written here: {key!r}"
                )
            entry[key] = _scalar_of(rest)
            if at >= close or not lines[at].startswith("    "):
                break
            key, rest = _pair_of(lines[at][4:])
            at += 1
        entries.append(entry)
    if strings and entries:
        raise MalformedConceptFileError("a list is strings or objects, never a mix")
    return (entries if entries else strings), at


def parse_concept_file(content: str) -> tuple[Frontmatter, str]:
    """The file read back: its frontmatter, and its body as the renderer normalised it.

    The inverse of `renderConceptFile` and deliberately no more than that.
    """
    lines = content.split("\n")
    if not lines or lines[0] != "---":
        raise MalformedConceptFileError("no frontmatter fence")
    try:
        close = lines.index("---", 1)
    except ValueError:
        raise MalformedConceptFileError(
            "the frontmatter fence does not close"
        ) from None
    if close + 1 >= len(lines) or lines[close + 1] != "":
        raise MalformedConceptFileError(
            "no blank line between the frontmatter and the body"
        )

    frontmatter: dict[str, FrontmatterValue] = {}
    at = 1
    while at < close:
        key, rest = _pair_of(lines[at])
        at += 1
        if rest is not None:
            frontmatter[key] = [] if rest == "[]" else _scalar_of(rest)
            continue
        frontmatter[key], at = _list_items_of(lines, at, close)
    return frontmatter, "\n".join(lines[close + 2 :])


def normalised_body(body: str) -> str:
    """The body as ADR 0014 normalises it: CRLF to LF, no trailing whitespace, one final
    newline.
    """
    without_returns = body.replace("\r\n", "\n")
    trimmed = "\n".join(line.rstrip(" \t") for line in without_returns.split("\n"))
    return trimmed.rstrip("\n") + "\n"


def resolved_resource(resource: str, from_path: str) -> str:
    """A resource or a link target as ADR 0019 resolves it: paths resolved to
    ``/abs.md``.

    The port of `resolvedResource` (`packages/schema/src/concept-tables.ts`). A URL —
    scheme'd or protocol-relative — is left as it stands: it is already absolute and is
    not a path in this bundle, so folding it into one would let an external reference
    collide with a local concept's citation.
    """
    if resource.startswith("//") or re.match(r"^[a-z][a-z0-9+.-]*:", resource, re.I):
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


def cited_source(entry: SourceEntry | str) -> tuple[str, str | None] | None:
    """One ``sources[]`` entry as everything that reads one reads it: the resource, and
    the locator into it when it names one.

    The port of `citedSourceOf` (`packages/schema/src/concept-tables.ts`), including its
    two forms — OKF's provenance object and the legacy ``<resource>#<locator>`` string,
    whose locator is everything after the **last** ``#`` — and its trimming of the
    resource in both, since padding is not part of what a file cites.
    """
    if isinstance(entry, str):
        hash_at = entry.rfind("#")
        resource = (entry if hash_at == -1 else entry[:hash_at]).strip()
        if resource == "":
            return None
        return resource, None if hash_at == -1 else entry[hash_at + 1 :]
    resource_value = entry.get("resource")
    if not isinstance(resource_value, str) or resource_value.strip() == "":
        return None
    locator = entry.get("locator")
    # Whatever scalar carried the locator is kept as its string: YAML renders a bare
    # page number as a number, and dropping it would be the platform deciding a citation
    # points at a whole document when the file said page four.
    return resource_value.strip(), None if locator is None else _as_javascript(locator)


def _as_javascript(value: Scalar) -> str:
    """A scalar as JavaScript's `String()` writes it — which is what the other tier's
    reducer does to a locator before it hashes.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return _number_text(value)
    return "" if value is None else value


def _number_text(value: int | float) -> str:
    """A number as `JSON.stringify` writes it.

    The one place the two languages disagree by default: Python writes an integral float
    as ``4.0`` and JavaScript writes ``4``, because JavaScript has one number type. A
    locator of ``4`` read out of a file must hash the same whichever tier read it, so an
    integral float is written without its fraction here.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return json.dumps(value)


def _json_text(value: object) -> str:
    """A value as `JSON.stringify` writes it: no insignificant whitespace, non-ASCII
    kept as itself, and an integral float written as an integer (`_number_text`).
    """
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
            f"{json.dumps(key, ensure_ascii=False)}:{_json_text(item)}"
            for key, item in value.items()
        )
        return "{" + ",".join(pairs) + "}"
    raise MalformedConceptFileError(f"not a value the hash can carry: {value!r}")


def _reduced_sources(value: FrontmatterValue, path: str) -> list[list[str | None]]:
    """``sources[]`` reduced to ordered ``(resource, locator)`` pairs with paths
    resolved — ADR 0019's own reduction, and what makes a source-title fix leave a
    check standing while a swapped source un-checks it.
    """
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
    """The frontmatter as ADR 0014's hash reads it, written straight as canonical JSON.

    Keys are sorted the way JavaScript's `toSorted()` sorts them — by UTF-16 code unit,
    which is Python's own ordering for every key below the astral plane and differs
    above it. The sort key below is the UTF-16 encoding, so the two tiers agree on a key
    nobody has written yet as well as on every key anybody has.
    """
    pairs = []
    for key in sorted(frontmatter, key=_utf16_order):
        if key in UNHASHED_KEYS:
            continue
        value = frontmatter[key]
        reduced = _reduced_sources(value, path) if key == "sources" else value
        pairs.append(f"{json.dumps(key, ensure_ascii=False)}:{_json_text(reduced)}")
    return "{" + ",".join(pairs) + "}"


def _utf16_order(key: str) -> tuple[int, ...]:
    """A string's UTF-16 code units — the order JavaScript compares strings in."""
    return tuple(key.encode("utf-16-be"))


def content_hash_of(frontmatter: Frontmatter, body: str, path: str) -> str:
    """The content hash a check confirms (ADR 0014, ADR 0019), and the number the
    nightly audit compares against ``concept_index.content_hash``.
    """
    canonical = f"{canonical_frontmatter(frontmatter, path)}\n{normalised_body(body)}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
