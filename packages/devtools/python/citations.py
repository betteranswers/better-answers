from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CASES = Path(__file__).resolve().parents[3] / "contracts" / "citation" / "cases.json"


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
    for what, pattern in _PATTERNS:
        found = pattern.search(prose)
        if found is not None:
            return what, found.group(0)
    return None
