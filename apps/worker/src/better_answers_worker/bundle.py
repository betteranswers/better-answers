"""Reading one workspace's bundle at its head — the only place this tier touches git.

The bundle is a bare repository per workspace at ``<GIT_STORE_DIR>/<workspace>.git``, on
one branch, ``refs/heads/main`` (ADR 0024; the git door in
`packages/core/src/store/git/index.ts`). This tier **reads** it and never writes it: the
app is the only OKF writer, the mount is read-only, and nothing here holds a
git credential because there is nothing to push to.

It is read through **dulwich**, a pure-Python git implementation, rather than by
shelling out: the image is `python:3.13-slim` with no git binary in it, and adding
one to read a tree would be a second thing to pin and patch for work a library does
in-process.

The concepts are the ``.md`` files under ``knowledge/``, which is the bundle root ADR
0002 fixes; the manifest at that root is not a concept and is excluded by the ``.md``
ending rather than by name, exactly as `CONCEPT_PATH` in
`packages/schema/src/concept-tables.ts` excludes it — so a second reserved file of any
other kind is excluded the same way and this does not become a list to keep.
"""

from dataclasses import dataclass
from pathlib import Path

from dulwich.objects import Blob, Commit, Tree
from dulwich.refs import Ref
from dulwich.repo import Repo

from .ids import ID_SHAPE

#: The one ref a bundle's history hangs off. One branch per repository and no other: the
#: bundle is written only by the app, one commit per act (ADR 0012).
BUNDLE_REF = Ref(b"refs/heads/main")

#: Where a bundle's concepts live (ADR 0002).
BUNDLE_ROOT = "knowledge"


class NoSuchBundleError(FileNotFoundError):
    """The workspace has no bare repository, or its branch has no commit yet.

    Not an error the loop dies of: a workspace provisioned a moment ago has an empty
    bundle, and a job over one has nothing to audit and nothing to rebuild.
    """


@dataclass(frozen=True, slots=True)
class ConceptBlob:
    """One concept file at the head: its bundle path, and its bytes as text."""

    path: str
    content: str


class NotAWorkspaceIdError(ValueError):
    """A workspace id that is not one — refused before it reaches a path.

    Every id this tier is handed comes off a row the app wrote, so this is never met by
    the loop; it is what keeps the arithmetic below an arithmetic, whatever hands it a
    string.
    """


def repository_path(git_store_dir: str, workspace_id: str) -> Path:
    """Which repository a workspace's bundle is, which is this module's arithmetic and
    never a caller's string.

    Two guards, because a path built from a string is a path a string can steer: the id
    is held to the one shape an id has (`ID_SHAPE`, the tier contract's), and the path
    it makes is held to lie beneath the git store — the second refusing what the first
    cannot see, such as a repository directory that is a link out of the store.
    """
    if not ID_SHAPE.fullmatch(workspace_id):
        raise NotAWorkspaceIdError(f"not a workspace id: {workspace_id!r}")
    store = Path(git_store_dir).resolve()
    path = (store / f"{workspace_id}.git").resolve()
    if not path.is_relative_to(store):
        raise NotAWorkspaceIdError(
            f"the bundle for {workspace_id} is not under the store"
        )
    return path


def _walk(repository: Repo, tree: Tree, prefix: str) -> list[ConceptBlob]:
    found: list[ConceptBlob] = []
    for entry in tree.items():
        name = entry.path.decode("utf-8")
        path = f"{prefix}/{name}" if prefix else name
        object_ = repository.get_object(entry.sha)
        if isinstance(object_, Tree):
            found.extend(_walk(repository, object_, path))
            continue
        if isinstance(object_, Blob) and name.endswith(".md"):
            found.append(ConceptBlob(path, object_.data.decode("utf-8")))
    return found


def concepts_at_head(git_store_dir: str, workspace_id: str) -> list[ConceptBlob]:
    """Every concept file the workspace's bundle holds at its head, path in hand.

    Sorted by path, so a job's outcome lists what it found in an order a reader can
    compare between two runs.
    """
    path = repository_path(git_store_dir, workspace_id)
    if not path.exists():
        raise NoSuchBundleError(f"no bundle for workspace {workspace_id}")
    with Repo(str(path)) as repository:
        try:
            head = repository.refs[BUNDLE_REF]
        except KeyError as cause:
            raise NoSuchBundleError(
                f"the bundle for {workspace_id} has no commits"
            ) from cause
        commit = repository.get_object(head)
        if not isinstance(commit, Commit):
            raise NoSuchBundleError(f"the bundle for {workspace_id} has no commit")
        root = repository.get_object(commit.tree)
        if not isinstance(root, Tree):
            raise NoSuchBundleError(f"the bundle for {workspace_id} has no tree")
        try:
            _, knowledge_sha = root.lookup_path(
                repository.get_object, BUNDLE_ROOT.encode("utf-8")
            )
        except KeyError:
            # A bundle whose head carries no `knowledge/` yet: a workspace nobody has
            # written a concept in. Nothing to audit and nothing to rebuild, which is an
            # empty answer and not a failure.
            return []
        knowledge = repository.get_object(knowledge_sha)
        if not isinstance(knowledge, Tree):
            return []
        return sorted(
            _walk(repository, knowledge, BUNDLE_ROOT), key=lambda blob: blob.path
        )
