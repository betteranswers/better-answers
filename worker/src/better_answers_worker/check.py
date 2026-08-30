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


def main() -> int:
    failed: list[str] = []

    for name, command in STEPS:
        print(f"\n== {name} ==", flush=True)
        if subprocess.run(command, check=False).returncode != 0:
            failed.append(name)

    if failed:
        print(f"\ncheck failed: {', '.join(failed)}", file=sys.stderr)
        return 1

    print("\ncheck passed")
    return 0
