from pathlib import Path


def _above(marker: str) -> Path:
    return next(
        directory
        for directory in Path(__file__).resolve().parents
        if (directory / marker).is_file()
    )


REPOSITORY_ROOT = _above("pnpm-workspace.yaml")

WORKER_ROOT = _above("pyproject.toml")
