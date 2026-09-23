import hashlib
from pathlib import Path

CONTRACTS_ROOT = Path(__file__).resolve().parents[4] / "contracts"

CONTRACT_STAMP_MODULE = Path(__file__).resolve().parent / "contract_stamp.py"

# It carries no agreement, and a typo fix in prose must not idle this worker.
OUTSIDE_THE_DIGEST = "README.md"

GENERATE = "cd apps/worker && uv run --frozen generate-contract-stamp"


def contract_files(root: Path) -> list[str]:
    found: list[str] = []
    for file in root.rglob("*"):
        # A link is a path, not content. Said here because `is_file` follows one.
        if file.is_symlink() or not file.is_file():
            continue
        relative = file.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        written = "/".join(relative.parts)
        if written != OUTSIDE_THE_DIGEST:
            found.append(written)
    return sorted(found, key=lambda relative: relative.encode("utf-8"))


# Length-prefixed so a boundary cannot be forged: without it, content holding a
# newline and a plausible path could pose as a second file.
def contract_digest(root: Path) -> str:
    stream = hashlib.sha256()
    for relative in contract_files(root):
        # Bytes, never decoded or newline-normalised: a CRLF checkout is a different
        # digest, and that is right — the tiers would be reading different bytes.
        content = (root / relative).read_bytes()
        stream.update(relative.encode("utf-8"))
        stream.update(b"\n")
        stream.update(str(len(content)).encode("ascii"))
        stream.update(b"\n")
        stream.update(content)
    return stream.hexdigest()


def render_contract_stamp(digest: str) -> str:
    return f'# Generated, never edited: {GENERATE}\n\nCONTRACT_DIGEST = "{digest}"\n'
