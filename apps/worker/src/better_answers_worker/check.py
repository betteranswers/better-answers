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
        returncode = subprocess.run(command, check=False).returncode
        if returncode != 0:
            failed.append(name)

    if failed:
        print(f"\ncheck failed: {', '.join(failed)}", file=sys.stderr)
        return 1

    print("\ncheck passed")
    return 0
