from dataclasses import dataclass, field

from conftest import DAEMON_SKIP_REASON, pytest_terminal_summary


@dataclass
class _StubReport:
    longreprtext: str = ""


@dataclass
class _StubReporter:
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


def test_a_run_with_no_skips_leaves_the_reporter_untouched() -> None:
    reporter = _StubReporter()

    pytest_terminal_summary(reporter)  # type: ignore[arg-type]

    assert reporter.lines == []
