import re
from pathlib import Path

PLATFORM_COMPOSE = (
    Path(__file__).resolve().parents[3] / "deploy" / "platform.compose.yaml"
)


def worker_service() -> str:
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

    found = re.findall(rf"^\s+{name}:\s+(\S+)", worker_service(), re.M)
    if len(found) != 1:
        message = (
            f"expected one {name} in the worker service of {PLATFORM_COMPOSE},"
            f" found {len(found)}"
        )
        raise RuntimeError(message)
    return str(found[0]).strip('"')
