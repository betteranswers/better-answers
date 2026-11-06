import os
import sys

from .config import environment_of

PROCESSES = {
    "worker": ("better-answers-worker",),
    "health": ("python", "-m", "better_answers_worker.health"),
}


def main() -> None:
    named = sys.argv[1] if len(sys.argv) == 2 else ""
    argv = PROCESSES.get(named)
    if argv is None:
        sys.stderr.write(
            "environment_gate: name the process to start, one of "
            + ", ".join(PROCESSES)
            + "\n"
        )
        sys.exit(2)
    os.execvpe(argv[0], argv, environment_of())  # noqa: S606  # argv comes from PROCESSES, not input


if __name__ == "__main__":
    main()
