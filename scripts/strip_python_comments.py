import argparse
import re
import sys
from pathlib import Path

import libcst as cst


def _transformer(kept: re.Pattern[str]) -> cst.CSTTransformer:
    class Strip(cst.CSTTransformer):
        def leave_Comment(
            self, original_node: cst.Comment, updated_node: cst.Comment
        ) -> cst.Comment | cst.RemovalSentinel:
            if kept.search(updated_node.value):
                return updated_node
            return cst.RemoveFromParent()

        # A bare string statement is a docstring wherever it stands, and libcst puts the
        # placeholder in itself when taking one empties a body.
        def leave_SimpleStatementLine(
            self, original_node: cst.SimpleStatementLine, updated_node: cst.SimpleStatementLine
        ) -> cst.SimpleStatementLine | cst.RemovalSentinel:
            body = updated_node.body
            if (
                len(body) == 1
                and isinstance(body[0], cst.Expr)
                and isinstance(body[0].value, cst.SimpleString)
            ):
                return cst.RemoveFromParent()
            return updated_node

    return Strip()


def strip(source: str, kept: re.Pattern[str]) -> str:
    return cst.parse_module(source).visit(_transformer(kept)).code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", required=True)
    parser.add_argument("paths", nargs="+")
    arguments = parser.parse_args()

    kept = re.compile(arguments.keep)
    changed = 0
    for name in arguments.paths:
        path = Path(name)
        source = path.read_text(encoding="utf-8")
        stripped = strip(source, kept)
        if stripped != source:
            path.write_text(stripped, encoding="utf-8")
            changed += 1

    print(f"libcst: {changed} of {len(arguments.paths)} Python files changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
