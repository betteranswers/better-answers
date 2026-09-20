"""The deploy unit's compose file, read as the plain text it is.

Three suites ask the same question of `deploy/platform.compose.yaml`. The config suite
holds every variable this module reads against the box that fills it, because a variable
read by a module no box sets is a worker that refuses to start on the estate and passes
every test. The image suite holds what the image itself carries against what the unit
puts around it — the caches, the mounts and the uid the volumes are chowned to. The
usage-tracking suite holds what the pipeline package writes into its own process
against what the unit would have put there.

Read with a reader rather than a YAML parser: this tier has no YAML dependency and wants
none for a test, and what is being read is a run of plain `key: value` lines under one
service's key. Written once here and imported by each, because two copies of a reader
drift a word at a time and the drift shows up as a message, never as a failure.
"""

import re
from pathlib import Path

#: `apps/worker/tests/` → the repository root.
PLATFORM_COMPOSE = (
    Path(__file__).resolve().parents[3] / "deploy" / "platform.compose.yaml"
)


def worker_service() -> str:
    """The ``worker`` service of the platform compose file, as its own text.

    The block runs from the service's own key to the next key at that indentation, or to
    the end of the file.
    """
    lines = PLATFORM_COMPOSE.read_text("utf-8").splitlines()
    starts = [index for index, line in enumerate(lines) if line == "  worker:"]
    if len(starts) != 1:
        message = (
            f"expected one `worker` service in {PLATFORM_COMPOSE}, found {len(starts)}"
        )
        raise RuntimeError(message)
    block: list[str] = []
    for line in lines[starts[0] + 1 :]:
        if line.strip() and not line.startswith("    "):
            break
        block.append(line)
    return "\n".join(block)


def worker_environment(name: str) -> str:
    """One value the worker's deploy unit puts in its environment, by that name.

    The location of this tier's caches and stores is the deploy unit's to state — the
    same reason ``check.yml`` sets ``HF_HOME`` for its own job — so what the image sets
    is held against this rather than against a literal written here twice.
    """
    # `re.findall` answers `list[Any]`, so the value is narrowed on the statement it is
    # returned from and never carried as `Any` (§ TYPES (Python)).
    found = re.findall(rf"^\s+{name}:\s+(\S+)", worker_service(), re.M)
    if len(found) != 1:
        message = (
            f"expected one {name} in the worker service of {PLATFORM_COMPOSE},"
            f" found {len(found)}"
        )
        raise RuntimeError(message)
    return str(found[0]).strip('"')
