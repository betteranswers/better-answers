import sys
from collections.abc import Callable, Iterator

import pytest

OWN_PACKAGE = "better_answers_worker"

REFUSAL = (
    "Our own code is never mocked (the root `CODING_STANDARDS.md`), and `{action}` "
    "targets {where}. Exercise the module through its entry point, or replace the "
    "external service behind its adapter with an in-memory implementation."
)


type Replace = Callable[..., None]


GUARDED_ACTIONS = ("setattr", "setitem", "delattr")


def _owner_of(target: object) -> str | None:
    if isinstance(target, str):
        return target
    name = getattr(target, "__name__", None)
    if isinstance(name, str) and getattr(target, "__file__", None) is not None:
        return name
    module = getattr(target, "__module__", None)
    return module if isinstance(module, str) else None


def _belongs_to_this_tier(module: str | None) -> bool:
    return module is not None and (
        module == OWN_PACKAGE or module.startswith(f"{OWN_PACKAGE}.")
    )


def _is_a_table_of_this_tier(container: object) -> bool:

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


def _refuse_if_ours(action: str, target: object) -> None:
    if action == "setitem":
        if _is_a_table_of_this_tier(target):
            raise RuntimeError(
                REFUSAL.format(action=action, where="a table this tier owns")
            )
        return
    module = _owner_of(target)
    if _belongs_to_this_tier(module):
        raise RuntimeError(REFUSAL.format(action=action, where=f"`{module}`"))


def _guarded(action: str, replaced: Replace) -> Replace:
    def guard(*args: object, **kwargs: object) -> None:
        target = args[0] if args else kwargs.get("target")
        _refuse_if_ours(action, target)
        replaced(*args, **kwargs)

    return guard


@pytest.fixture(name="monkeypatch")
def guarded_monkeypatch() -> Iterator[pytest.MonkeyPatch]:
    with pytest.MonkeyPatch.context() as patcher:
        for action in GUARDED_ACTIONS:
            setattr(patcher, action, _guarded(action, getattr(patcher, action)))
        yield patcher


MOST_TITLE_WORDS = 10

TITLE_REFUSAL = (
    "A test name is a present-tense phrase of 10 words at most, never "
    '"should" (the root `CODING_STANDARDS.md`): `{name}` runs to {words}'
)


def pytest_runtest_setup(item: pytest.Item) -> None:
    name = getattr(item, "originalname", item.name)
    words = [word for word in name.removeprefix("test_").split("_") if word]
    if len(words) > MOST_TITLE_WORDS or "should" in (word.lower() for word in words):
        pytest.fail(TITLE_REFUSAL.format(name=name, words=len(words)), pytrace=False)


DAEMON_SKIP_REASON = "no Docker daemon answered"


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    skipped = [
        report
        for report in terminalreporter.stats.get("skipped", [])
        if DAEMON_SKIP_REASON in report.longreprtext
    ]
    if not skipped:
        return
    terminalreporter.write_line(
        f"{len(skipped)} case(s) skipped because {DAEMON_SKIP_REASON}: these are the "
        "only proof the worker image is what it claims, and CI fails rather than "
        "skips them.",
        red=True,
        bold=True,
    )
