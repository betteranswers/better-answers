"""Real bare repositories for the suites that read one (`[TEST2]`, `[TEST3]`).

The worker reads a bundle at its head and never writes one, so what a test needs is a
repository that looks like the one the app wrote: bare, on ``refs/heads/main``, with
concept files under ``knowledge/``. Made through dulwich's own plumbing rather than a
fake, because the thing under test is reading a real git tree — a stand-in would prove
the stand-in.

The file text is written the way the app's renderer writes one (`renderConceptFile` in
`packages/core/src/concepts/index.ts`): quoted keys, JSON values, ``  - `` list items, a
blank line, then the body. That is the grammar the second parser reads, and a fixture
written any other way would be testing a file the platform never produces.
"""

import json
from pathlib import Path

from dulwich.objects import Blob, Commit, Tree
from dulwich.repo import Repo

from better_answers_worker.bundle import BUNDLE_REF
from better_answers_worker.concept_file import (
    Frontmatter,
    FrontmatterValue,
    normalised_body,
)

_AUTHOR = b"Better Answers <bot@better-answers.invalid>"


def _yaml_value(value: FrontmatterValue) -> str:
    if not isinstance(value, list):
        return " " + json.dumps(value, ensure_ascii=False)
    if not value:
        return " []"
    lines: list[str] = []
    for item in value:
        if isinstance(item, dict):
            for index, (key, held) in enumerate(item.items()):
                lead = "  - " if index == 0 else "    "
                lines.append(
                    f"{lead}{json.dumps(key, ensure_ascii=False)}:"
                    f" {json.dumps(held, ensure_ascii=False)}"
                )
        else:
            lines.append(f"  - {json.dumps(item, ensure_ascii=False)}")
    return "\n" + "\n".join(lines)


def render_concept_file(frontmatter: Frontmatter, body: str) -> str:
    """The file as the app writes it into the bundle."""
    lines = [
        f"{json.dumps(key, ensure_ascii=False)}:{_yaml_value(value)}"
        for key, value in frontmatter.items()
    ]
    return "---\n" + "\n".join(lines) + "\n---\n\n" + normalised_body(body)


def write_bundle(root: Path, workspace_id: str, files: dict[str, str]) -> str:
    """A bare repository for one workspace holding exactly these paths, and its head
    sha.

    One commit, whatever the file count, because what the worker reads is a tree at a
    head and never a history.
    """
    path = root / f"{workspace_id}.git"
    repository = Repo.init_bare(str(path), mkdir=True)
    try:
        store = repository.object_store
        trees: dict[str, Tree] = {"": Tree()}
        for bundle_path, content in sorted(files.items()):
            blob = Blob.from_string(content.encode("utf-8"))
            store.add_object(blob)
            parts = bundle_path.split("/")
            for depth in range(1, len(parts)):
                trees.setdefault("/".join(parts[:depth]), Tree())
            trees["/".join(parts[:-1])].add(
                parts[-1].encode("utf-8"), 0o100644, blob.id
            )
        for prefix in sorted(trees, key=len, reverse=True):
            tree = trees[prefix]
            store.add_object(tree)
            if prefix == "":
                continue
            parent, _, name = prefix.rpartition("/")
            trees[parent].add(name.encode("utf-8"), 0o040000, tree.id)
            store.add_object(trees[parent])

        commit = Commit()
        commit.tree = trees[""].id
        commit.author = commit.committer = _AUTHOR
        commit.commit_time = commit.author_time = 1_788_000_000
        commit.commit_timezone = commit.author_timezone = 0
        commit.encoding = b"UTF-8"
        commit.message = b"a bundle for one test\n"
        store.add_object(commit)
        repository.refs[BUNDLE_REF] = commit.id
        return commit.id.decode("ascii")
    finally:
        repository.close()
