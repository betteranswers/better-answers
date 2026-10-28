import re
from typing import Literal

from ..concept_file import SCHEMED, resolved_resource

_IRI = re.compile(r"^https://better-answers\.com/c/[0-9A-HJKMNP-TV-Z]{26}$")


_URI_RESERVED = frozenset(";/?:@&=+$,#")


_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")


def _escaped_byte(address: str, at: int) -> int | None:
    digits = address[at + 1 : at + 3]
    if (
        address[at : at + 1] != "%"
        or len(digits) != 2
        or not set(digits) <= _HEX_DIGITS
    ):
        return None
    return int(digits, 16)


def _utf8_width(lead: int) -> int | None:
    if lead < 0x80:
        return 1
    if 0xC0 <= lead < 0xE0:
        return 2
    if 0xE0 <= lead < 0xF0:
        return 3
    if 0xF0 <= lead < 0xF8:
        return 4
    return None


def _uri_decoded(address: str) -> str:
    pieces: list[str] = []
    at = 0
    while at < len(address):
        if address[at] != "%":
            pieces.append(address[at])
            at += 1
            continue
        lead = _escaped_byte(address, at)
        width = None if lead is None else _utf8_width(lead)
        if lead is None or width is None:
            return address
        escaped = bytearray([lead])
        for step in range(1, width):
            byte = _escaped_byte(address, at + 3 * step)
            if byte is None:
                return address
            escaped.append(byte)
        try:
            decoded = escaped.decode("utf-8")
        except UnicodeDecodeError:
            return address
        pieces.append(address[at : at + 3] if decoded in _URI_RESERVED else decoded)
        at += 3 * width
    return "".join(pieces)


type _TargetShape = Literal["iri", "path"]


def _target_of(raw: str, from_path: str) -> tuple[_TargetShape, str] | None:
    bare = raw.split("#")[0]
    if bare == "":
        return None
    if _IRI.match(bare):
        return "iri", bare

    if SCHEMED.match(bare) or bare.startswith("//"):
        return None
    decoded = _uri_decoded(bare)
    if "\0" in decoded:
        return None
    path = resolved_resource(decoded, from_path)[1:]
    return None if path == "" else ("path", path)
