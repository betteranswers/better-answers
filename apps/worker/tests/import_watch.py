import json
import os
import subprocess
import sys
from collections.abc import Sequence

WATCH_THE_IMPORT = """
import importlib.abc
import json
import os
import sys

held = []


class Watch(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == {library!r}:
            held.append({{v: os.environ.get(v) for v in {watched!r}}})
        return None


sys.meta_path.insert(0, Watch())

{ran}

print(json.dumps(held[:1]))
"""


def held_when_imported(
    library: str, watched: Sequence[str], ran: str, box: dict[str, str]
) -> list[dict[str, str]]:
    # A child process: pytest has every library loaded before the first test runs.
    environment = {
        name: value for name, value in os.environ.items() if name not in watched
    } | box
    completed = subprocess.run(
        (
            sys.executable,
            "-c",
            WATCH_THE_IMPORT.format(library=library, watched=tuple(watched), ran=ran),
        ),
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )

    return [
        {str(name): str(value) for name, value in seen.items() if value is not None}
        for seen in json.loads(completed.stdout.strip().splitlines()[-1])
    ]
