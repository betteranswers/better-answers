"""The worker's gate: `uv run --frozen check`, which the root `check` runs (AGENTS.md).

Run from `worker/`. Every step runs even when an earlier one fails, so one command
reports every problem rather than the first.
"""

import subprocess
import sys

STEPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ruff lint", ("ruff", "check", "src", "tests")),
    ("ruff format", ("ruff", "format", "--check", "src", "tests")),
    ("mypy", ("mypy",)),
    ("pytest", ("pytest",)),
)

# pytest exits 5 when it collects nothing. `worker/tests/` is deliberately empty —
# the bootstrap tests were removed as trivial and the first real one arrives with the
# first connector — so an empty run is a pass, not a failure. Every other non-zero
# exit still fails the gate. Delete this the day the directory has tests in it.
NO_TESTS_COLLECTED = 5
TOLERATED_EXIT_CODES: dict[str, int] = {"pytest": NO_TESTS_COLLECTED}


def main() -> int:
    failed: list[str] = []

    for name, command in STEPS:
        print(f"\n== {name} ==", flush=True)
        returncode = subprocess.run(command, check=False).returncode
        if returncode != 0 and returncode != TOLERATED_EXIT_CODES.get(name):
            failed.append(name)

    if failed:
        print(f"\ncheck failed: {', '.join(failed)}", file=sys.stderr)
        return 1

    print("\ncheck passed")
    return 0
