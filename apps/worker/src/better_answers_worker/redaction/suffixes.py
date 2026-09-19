"""The list of public suffixes the seam's email rule reads, warmed at build.

The weights next door fail loudly when they are missing. This does not, and that is the
only reason it needs a module of its own. Presidio's email recogniser validates every
address it matches by asking ``tldextract`` what the domain's public suffix is;
``tldextract`` wants the Public Suffix List for that, and if it has no cached copy it
tries two URLs, logs a warning for each one it cannot reach, falls back to the snapshot
bundled in its own wheel and answers correctly. So a worker with no route out redacts
exactly as well as one with — after paying a connection attempt and its timeout, inside
the first email match of every process the deploy unit starts, for ever, with nothing
but a log line nobody reads to say so.

The Dockerfile runs this module once, under a ``TLDEXTRACT_CACHE`` on a build cache
mount, and hands it the directory the runtime stage will read; the image sets that same
variable over the copy. A cache hit is the whole fence: ``tldextract`` never reaches for
a URL it already has an answer for.

**The fence has to be an ``ENV`` and cannot be a call.** ``tldextract`` resolves its
cache directory in a *default argument* — ``TLDExtract.__init__``'s ``cache_dir`` is
``get_cache_dir()``, evaluated when the library is imported — and the extractor Presidio
reaches is the process-wide singleton the library builds at import time from those
defaults. So the variable is read once, before any of our code runs, and a process that
sets it afterwards sets it for nobody.

**And it has to be the cache, not the setting that looks made for this.**
``TLDExtract(suffix_list_urls=())`` turns the fetch off at the source, and there is no
way to reach it: ``EmailRecognizer`` constructs no extractor and takes none, calling the
module-level ``tldextract.extract`` and so the singleton. Reaching that setting means
reassigning a third-party global at import time in our own process, which buys the same
silence for a much worse price.

What is copied out is every entry ``tldextract`` wrote and nothing else the mount holds.
A ``--mount=type=cache`` is shared by every build on a machine and ships in no layer, so
a copy of the whole of it would make the image whatever some other build left there —
the mistake `T-148` found in the weights fence and `T-149` fixed.

This module reads no environment variable. ``config.py`` is the only module in this tier
allowed to read one, and no module of ours reads this one at all: ``tldextract`` reads
it — when it warms the list, and again when this module asks it where the cache it just
warmed is — and the directory to copy into arrives on the command line.

The image bakes the path and the deploy unit declares the same one over it (`T-196`).
The second is not a second owner: it is what gives the image suite's mount guard a path
to ask about, since nothing can prove that no volume is mounted over a directory the
deploy unit never names. The two are held equal by the container case in
`apps/worker/tests/test_image.py`, so a compose line naming a directory this image does
not bake fails there rather than in a redaction nobody is watching.
"""

import shutil
import sys
from pathlib import Path
from typing import Final

import tldextract
from tldextract.cache import get_cache_dir

#: The name the warm is taken over. Any name would do: what loads the list is the first
#: extraction, not which domain it was asked about. This one is the shape the thing
#: being defended looks like — a mailbox at a two-label UK suffix, where naming the
#: suffix correctly is the whole of the library's job.
A_NAME_TO_WARM_IT_WITH: Final = "warm.example.co.uk"

#: The extension ``tldextract`` puts on every file it caches, and this module's whole
#: definition of what it is copying: its ``DiskCache`` writes these, takes a lock file
#: beside each one while it reads it, and touches nothing else in the directory. A lock
#: is a build's own and ships nowhere. If this ever stopped matching the library, the
#: copy would be empty rather than wrong, and the image test would fail on the silence
#: it asserts rather than on anything here.
CACHE_ENTRY_SUFFIX: Final = ".tldextract.json"


def fetch() -> None:
    """Warm the cache by asking for one extraction, which is what loads the list.

    Through the module-level function and so through the process-wide extractor, which
    is the one Presidio reaches: warming any other instance would write under a
    different key and leave the runtime's own lookup a miss.
    """
    tldextract.extract(A_NAME_TO_WARM_IT_WITH)


def warmed_entries() -> tuple[Path, ...]:
    """Every cache entry the warm left, as a file in the warmed cache."""
    cache = Path(get_cache_dir())
    return tuple(sorted(cache.rglob(f"*{CACHE_ENTRY_SUFFIX}")))


def copy_out(target: Path) -> None:
    """Put the warmed entries under ``target``, where the runtime stage reads them.

    Each keeps the path it had relative to the cache it was written in, because that
    path is the key: the directory is the namespace the library cached under and the
    file name is a hash of what it was asked. A copy that flattened them would ship a
    cache no lookup could hit.

    An empty cache raises rather than copying nothing. A build that warmed nothing has
    already failed; letting it produce an image would only move the failure to a
    fetch-per-process nobody is watching for, which is the failure this module exists to
    stop.
    """
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
