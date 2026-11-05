import subprocess
import sys

# A child process bounds a hang and keeps the signal handlers out of the test process.
SIGNAL_STORM_SOURCE = """
import signal
from better_answers_worker import loop

for _ in range(20):
    loop.STOP = loop._Stop()
    loop.STOP.install(60)
    signal.signal(signal.SIGALRM, loop.STOP._request)
    signal.setitimer(signal.ITIMER_REAL, 1e-5, 1e-5)
    for _ in range(250):
        loop.sleep_until_stopped(0)
    signal.setitimer(signal.ITIMER_REAL, 0)
    assert loop.STOP.requested, "no stop was requested"
"""

STORM_ENDS_WITHIN_SECONDS = 30


def test_idle_sleep_takes_a_stop_signal_at_any_moment() -> None:
    try:
        storm = subprocess.run(
            [sys.executable, "-c", SIGNAL_STORM_SOURCE],
            capture_output=True,
            text=True,
            timeout=STORM_ENDS_WITHIN_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise AssertionError("the stop signal hung the idle sleep") from None

    assert storm.returncode == 0, storm.stderr
