from __future__ import annotations

import json
import re
from typing import Any

from roots import REPOSITORY_ROOT

CASES = REPOSITORY_ROOT / "contracts" / "citation" / "cases.json"


def _compiled() -> tuple[tuple[str, re.Pattern[str]], ...]:
    fixture: Any = json.loads(CASES.read_text(encoding="utf8"))
    read: list[tuple[str, re.Pattern[str]]] = []
    for one in fixture["patterns"]:
        what: str = one["name"]
        pattern: str = one["pattern"]
        read.append((what, re.compile(pattern)))
    return tuple(read)


_PATTERNS = _compiled()


def citation_in(prose: str) -> tuple[str, str] | None:
    """The first pattern in `contracts/citation/cases.json` the prose
    matches, as its name and the matched text; None when it cites nothing."""
    for what, pattern in _PATTERNS:
        found = pattern.search(prose)
        if found is not None:
            return what, found.group(0)
    return None
