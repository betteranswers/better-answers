import hashlib
from pathlib import Path

CONTRACTS_ROOT = Path(__file__).resolve().parents[4] / "contracts"

CONTRACT_STAMP_MODULE = Path(__file__).resolve().parent / "contract_stamp.py"

OUTSIDE_THE_DIGEST = "README.md"

GENERATE = "cd apps/worker && uv run --frozen generate-contract-stamp"


def contract_files(root: Path) -> list[str]:
    found: list[str] = []
    for file in root.rglob("*"):
        if file.is_symlink() or not file.is_file():
            continue
        relative = file.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        written = "/".join(relative.parts)
        if written != OUTSIDE_THE_DIGEST:
            found.append(written)
    return sorted(found, key=lambda relative: relative.encode("utf-8"))


def contract_digest(root: Path) -> str:
    stream = hashlib.sha256()
    for relative in contract_files(root):
        content = (root / relative).read_bytes()
        stream.update(relative.encode("utf-8"))
        stream.update(b"\n")
        stream.update(str(len(content)).encode("ascii"))
        stream.update(b"\n")
        stream.update(content)
    return stream.hexdigest()


def render_contract_stamp(digest: str) -> str:
    return f'# Generated, never edited: {GENERATE}\n\nCONTRACT_DIGEST = "{digest}"\n'
