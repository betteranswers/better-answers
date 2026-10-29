from __future__ import annotations

from pathlib import Path

REPOSITORY_ROOT = next(
    directory
    for directory in Path(__file__).resolve().parents
    if (directory / "pnpm-workspace.yaml").is_file()
)
