"""The suite's guard against mocking this tier's own code (`[TEST3]`).

`[TEST3]` bans module mocking in both tiers, and in TypeScript a lint rule
(`anti-slop/no-module-mocking`) refuses it. Python had no such fence: `monkeypatch`
would happily replace an attribute of `better_answers_worker`, and a test that patches
the module under test proves the patch rather than the behaviour.

So `monkeypatch` is handed to every test with its three replacing acts wrapped. A
target that belongs to this tier is refused — including an instance of one of its
classes, which carries its module through its type — and anything else is patched as
before,
because replacing a third-party attribute is how an external service is kept out of a
test.

**What it can see.** A target given as a dotted string, a module, a class or a function
carries the module it came from, so ownership is read off it directly. A dictionary
carries nothing, so a `setitem` is refused when the target is a plain `dict` one of this
tier's imported modules holds — the reading that catches patching a module's own table,
and the one that leaves `os.environ` alone.
"""

import sys
from collections.abc import Callable, Iterator

import pytest

OWN_PACKAGE = "better_answers_worker"

REFUSAL = (
    "[TEST3]: our own code is never mocked, and `{act}` targets {where}. "
    "Exercise the module through its entry point, or replace the external "
    "service behind its adapter with an in-memory implementation."
)

#: `monkeypatch.setattr` and friends are overloaded; a test only ever calls them, so
#: the wrapper forwards whatever it was given to the method it replaced.
type Replace = Callable[..., None]

#: The acts that put something of ours behind something else. `setenv`, `chdir`,
#: `syspath_prepend` and `delitem` reach nothing this tier defines.
GUARDED_ACTS = ("setattr", "setitem", "delattr")


def _owner_of(target: object) -> str | None:
    """The dotted name a `setattr` or `delattr` target carries: for a string target the
    path it was given, otherwise the module the object came from."""
    if isinstance(target, str):
        # `monkeypatch.setattr("better_answers_worker.config.read_bootstrap", value)`.
        return target
    name = getattr(target, "__name__", None)
    if isinstance(name, str) and getattr(target, "__file__", None) is not None:
        return name  # a module object
    module = getattr(target, "__module__", None)
    return module if isinstance(module, str) else None


def _belongs_to_this_tier(module: str | None) -> bool:
    return module is not None and (
        module == OWN_PACKAGE or module.startswith(f"{OWN_PACKAGE}.")
    )


def _is_a_table_of_this_tier(container: object) -> bool:
    """Whether a `setitem` target is a dictionary one of this tier's modules holds."""
    # A mapping that is not a plain dict belongs to somebody else's type — `os.environ`
    # is the one a test reaches for, and this tier's config module imports it by name,
    # so identity alone would read it as ours. A third-party plain dict imported by name
    # would still read as ours; no module does that today, and the day one does the fix
    # is to reach the table through its own module rather than ours.
    if type(container) is not dict:
        return False
    for name, module in list(sys.modules.items()):
        if not _belongs_to_this_tier(name):
            continue
        namespace = vars(module)
        if namespace is container or any(
            value is container for value in namespace.values()
        ):
            return True
    return False


def _refuse_if_ours(act: str, target: object) -> None:
    if act == "setitem":
        if _is_a_table_of_this_tier(target):
            raise RuntimeError(REFUSAL.format(act=act, where="a table this tier owns"))
        return
    module = _owner_of(target)
    if _belongs_to_this_tier(module):
        raise RuntimeError(REFUSAL.format(act=act, where=f"`{module}`"))


def _guarded(act: str, replaced: Replace) -> Replace:
    def guard(*args: object, **kwargs: object) -> None:
        target = args[0] if args else kwargs.get("target")
        _refuse_if_ours(act, target)
        replaced(*args, **kwargs)

    return guard


@pytest.fixture(name="monkeypatch")
def guarded_monkeypatch() -> Iterator[pytest.MonkeyPatch]:
    """`monkeypatch`, refusing a target that belongs to this tier (`[TEST3]`)."""
    with pytest.MonkeyPatch.context() as patcher:
        # The wrappers are instance attributes on a patcher this fixture owns and
        # discards, so nothing outside the test sees a changed MonkeyPatch.
        for act in GUARDED_ACTS:
            setattr(patcher, act, _guarded(act, getattr(patcher, act)))
        yield patcher
