from dataclasses import dataclass
from pathlib import Path

from dulwich.objects import Blob, Commit, Tree
from dulwich.refs import Ref
from dulwich.repo import Repo

from .ids import ID_SHAPE

BUNDLE_REF = Ref(b"refs/heads/main")


BUNDLE_ROOT = "knowledge"


class NoSuchBundleError(FileNotFoundError):
    pass


@dataclass(frozen=True, slots=True)
class ConceptBlob:
    path: str
    content: str


class NotAWorkspaceIdError(ValueError):
    pass


def repository_path(git_store_dir: str, workspace_id: str) -> Path:
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
            return []
        knowledge = repository.get_object(knowledge_sha)
        if not isinstance(knowledge, Tree):
            return []
        return sorted(
            _walk(repository, knowledge, BUNDLE_ROOT), key=lambda blob: blob.path
        )
