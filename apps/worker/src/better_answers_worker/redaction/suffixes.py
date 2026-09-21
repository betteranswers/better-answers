import shutil
import sys
from pathlib import Path
from typing import Final

import tldextract
from tldextract.cache import get_cache_dir

A_NAME_TO_WARM_IT_WITH: Final = "warm.example.co.uk"


CACHE_ENTRY_SUFFIX: Final = ".tldextract.json"


def fetch() -> None:
    tldextract.extract(A_NAME_TO_WARM_IT_WITH)


def warmed_entries() -> tuple[Path, ...]:
    cache = Path(get_cache_dir())
    return tuple(sorted(cache.rglob(f"*{CACHE_ENTRY_SUFFIX}")))


def copy_out(target: Path) -> None:
    cache = Path(get_cache_dir())
    entries = warmed_entries()
    if not entries:
        message = f"nothing was warmed in {cache}, so there is no suffix list to carry"
        raise RuntimeError(message)
    for entry in entries:
        landing = target / entry.relative_to(cache)
        landing.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(entry, landing)


if __name__ == "__main__":
    fetch()
    copy_out(Path(sys.argv[1]))
