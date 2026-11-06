import os
import sys

from .config import environment_of

PROCESSES = {
    "worker": ("better-answers-worker",),
    "health": ("python", "-m", "better_answers_worker.health"),
}

# Docker's `init` would hold every container variable at PID 1, readable by the app's
# uid. tini at PID 1 holds the kept keys.
INIT = ("/usr/bin/tini", "--")


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
    if os.getpid() == 1:
        argv = (*INIT, *argv)
    os.execvpe(argv[0], argv, environment_of())  # noqa: S606  # argv comes from PROCESSES, not input


if __name__ == "__main__":
    main()
