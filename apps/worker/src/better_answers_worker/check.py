import subprocess
import sys

type Step = tuple[str, tuple[str, ...]]

BESIDE_THE_SUITE: tuple[Step, ...] = (
    ("ruff lint", ("ruff", "check", "src", "tests")),
    ("ruff format", ("ruff", "format", "--check", "src", "tests")),
    ("mypy", ("mypy",)),
)

CI_RUNNER_VCPUS = 4

SUITE: Step = (
    "pytest",
    ("pytest", "-n", str(CI_RUNNER_VCPUS), "--dist", "loadgroup", "-m", "not image"),
)

IMAGES: Step = ("pytest image", ("pytest", "-m", "image"))


def images() -> int:
    name, command = IMAGES
    print(f"\n== {name} ==", flush=True)
    return subprocess.run(command, check=False).returncode


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
