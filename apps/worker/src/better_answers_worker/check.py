import subprocess
import sys

type Step = tuple[str, tuple[str, ...]]

# They run beside the suite, their output held until it ends, so the log reads one step
# at a time.
BESIDE_THE_SUITE: tuple[Step, ...] = (
    ("ruff lint", ("ruff", "check", "src", "tests")),
    ("ruff format", ("ruff", "format", "--check", "src", "tests")),
    ("mypy", ("mypy",)),
)

# Four, the runner's vCPUs: `auto` ran slower on a larger machine. `loadgroup` keeps
# each `xdist_group` on one worker, so the image builds once.
SUITE: Step = ("pytest", ("pytest", "-n", "4", "--dist", "loadgroup"))


def main() -> int:
    beside = [
        (
            name,
            subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            ),
        )
        for name, command in BESIDE_THE_SUITE
    ]

    suite_name, suite_command = SUITE
    print(f"\n== {suite_name} ==", flush=True)
    returncodes = {suite_name: subprocess.run(suite_command, check=False).returncode}

    for name, process in beside:
        output, _ = process.communicate()
        print(f"\n== {name} ==\n{output}", end="", flush=True)
        returncodes[name] = process.returncode

    failed = [name for name, _ in (*BESIDE_THE_SUITE, SUITE) if returncodes[name] != 0]
    if failed:
        print(f"\ncheck failed: {', '.join(failed)}", file=sys.stderr)
        return 1

    print("\ncheck passed")
    return 0
