"""`pytest_terminal_summary`'s loud line when a run skipped every daemon case.

`test_image.py`'s `image` fixture skips off CI when no Docker daemon answered
(`DAEMON_SKIP_REASON`, `conftest.py`), and those skipped cases are the only proof the
worker image holds what it claims. A run that skipped all of them and said nothing
would report green having shown nothing, so the hook writes one line naming how many
skipped and why — and only that.

Driven directly against a stub reporter and stub reports, in both directions: with
the reason recorded the line is written, and with no such reason the reporter is left
exactly as it was. No Docker daemon needed either way, because nothing here starts a
container — the hook is a pure read of `terminalreporter.stats`.
"""

from dataclasses import dataclass, field

from conftest import DAEMON_SKIP_REASON, pytest_terminal_summary


@dataclass
class _StubReport:
    """The one field the hook reads off a real `pytest.TestReport`."""

    longreprtext: str = ""


@dataclass
class _StubReporter:
    """The two things the hook touches on a real `pytest.TerminalReporter`."""

    stats: dict[str, list[_StubReport]] = field(default_factory=dict)
    lines: list[str] = field(default_factory=list)

    def write_line(self, line: str, **markup: bool) -> None:
        self.lines.append(line)


def test_a_run_that_skipped_every_daemon_case_says_so_once() -> None:
    reporter = _StubReporter(
        stats={
            "skipped": [
                _StubReport(longreprtext=f"Skipped: {DAEMON_SKIP_REASON}"),
                _StubReport(longreprtext=f"Skipped: {DAEMON_SKIP_REASON}"),
                _StubReport(longreprtext="Skipped: an unrelated reason entirely"),
            ]
        }
    )

    pytest_terminal_summary(reporter)  # type: ignore[arg-type]

    assert len(reporter.lines) == 1
    line = reporter.lines[0]
    assert "2" in line
    assert DAEMON_SKIP_REASON in line
    assert "only proof the worker image is what it claims" in line
    assert "CI fails rather than skips" in line


def test_a_run_with_no_daemon_skip_leaves_the_reporter_untouched() -> None:
    reporter = _StubReporter(
        stats={"skipped": [_StubReport(longreprtext="Skipped: an unrelated reason")]}
    )

    pytest_terminal_summary(reporter)  # type: ignore[arg-type]

    assert reporter.lines == []


def test_a_run_with_no_skips_at_all_leaves_the_reporter_untouched() -> None:
    reporter = _StubReporter()

    pytest_terminal_summary(reporter)  # type: ignore[arg-type]

    assert reporter.lines == []
