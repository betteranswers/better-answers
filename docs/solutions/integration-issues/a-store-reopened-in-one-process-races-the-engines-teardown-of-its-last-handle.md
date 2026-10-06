---
title: "A store reopened in one process races the engine's teardown of its last handle"
date: 2026-10-02
category: integration-issues
module: apps/worker
problem_type: integration_issue
component: worker
severity: high
symptoms:
  - "apps/worker/tests/test_pipeline_landed.py failed intermittently in CI merge groups with RuntimeError: environment already open in this program; close it to be able to open it again with different options"
  - "Merge-group runs 36358367778, 36358640405, 36992793999 and 37061772234 (4 of 78 since PR #448) each dropped an unrelated PR (#472, #470, #506, #514) from the merge queue"
  - "It never reproduced in 120 local rounds"
  - "An earlier failure, run 36336846608, was the same lifecycle race on cocoindex's app-name slot, which refused the landed app a second registration when two reads shared one Host"
root_cause: concurrency
resolution_type: code_fix
framework_version: "cocoindex 1.0.24 (heed 0.22.1)"
related_components:
  - testing-framework
tags:
  - cocoindex
  - heed
  - lmdb
  - host
  - flaky-test
  - merge-queue
  - teardown-race
  - reopen-retry
retire_when: "cocoindex ships an awaitable or explicit Environment close, or an equivalent contract for when a store is released, and Host adopts it in place of the wait; check the cocoindex release notes and cocoindex-io/cocoindex issue 2467"
---

# A store reopened in one process races the engine's teardown of its last handle

## Problem

A worker `Host` that opens a connected source's LMDB store soon after another `Host` in the same process closed it can fail. The engine may still hold the old handle, and heed refuses a second open of a path it holds. Closing the `Host` does not close the engine's handle, and cocoindex 1.0.24 (`apps/worker/pyproject.toml`) has no `Environment.close()`.

Upstream paths below are in the installed packages, heed 0.22.1 and cocoindex 1.0.24, and their line numbers are for those versions.

## Symptoms

- `coco.Environment(...)` raised a plain `RuntimeError` whose text is exactly `environment already open in this program; close it to be able to open it again with different options`.
- Merge-group runs 36358367778, 36358640405, 36992793999 and 37061772234 failed this way: 4 of 78 merge groups since PR #448. Each dropped an unrelated PR (#472, #470, #506, #514) that touched no worker file.
- Every failure was a test in `apps/worker/tests/test_pipeline_landed.py` that calls `read_the_copies` twice, each read through its own `Host`: `test_a_rule_switched_off_on_the_source_detects_nothing_afresh` (twice), `test_a_suppression_withholds_the_name_without_rerunning_the_detector` and `test_another_converter_over_the_same_normalised_text_detects_nothing_afresh`.
- A two-read race script never hit it locally in 120 rounds.

## What Didn't Work

- **One `Host` for both reads.** Run 36336846608 failed when cocoindex's per-environment app-name slot refused the landed app a second registration (cocoindex `rust/core/src/engine/environment.rs:169-173`).
- **A `Host` per read.** PR #448 gave each read its own `Host` and blamed the image build running alongside. That moved the symptom from cocoindex's app-name slot to heed's store-path slot. All four later failures ran with `IMAGE_PROBE_DEFERRED: true`, so the image build was not the cause.
- **Trusting `Host.close()`.** It clears the `Host`'s dict of environments, which drops the `Host`'s own references and nothing else.
- **Local repetition.** The race arrived with the parallel suite. PR #444 ran the worker's pytest over four xdist processes, and run 36336846608 was #444's own merge group. The clean local runs recorded on #444 and #448, plain and shuffled, did not catch it (session history). Later, 120 clean rounds of a race script proved nothing about a starved CI runner either.

## Solution

The fix on BA-45's pull request wraps the store open in `apps/worker/src/better_answers_worker/pipeline/host.py`. `STILL_OPEN` is heed's whole message, matched exactly, so any other error raises at once:

```python
def _open_unless_held(open_store):
    try:
        return open_store()
    except RuntimeError as error:
        if str(error) != STILL_OPEN:
            raise
        return None


def _opened_once_let_go(run, store, open_store, wait_seconds):
    opened = _open_unless_held(open_store)
    if opened is not None:
        return opened
    logger.info("the engine still holds the store, so its open waits for it to let go", ...)
    gc.collect()
    for pause in _pauses_within(wait_seconds):
        opened = _open_unless_held(open_store)
        if opened is not None:
            return opened
        time.sleep(pause)
    return open_store()
```

- The log line carries `binding_id`, `store` and `wait_seconds`. In production it reaches the worker's logs. In CI it usually does not: pytest captures a passing test's stdout, so a wait absorbed during a green test never reaches the log, and only a failing test prints what it captured. A green `full-worker` log without the line says nothing about whether the race fired.
- `gc.collect()` runs once.
- `_pauses_within` yields pauses doubling from 0.05 s to a 0.5 s ceiling that sum to the cap: 13 pauses for the default. The last open is not caught, so a store that stays held raises heed's own error.
- `RELEASE_WAIT_SECONDS = 5.0` is the default for the `Host` keyword `release_wait_seconds`. It is sized for a starved runner (pytest `-n 4` beside Docker Postgres), not the moment a release usually takes. Only the bug path pays it.
- The loop sleeps and never reads a clock, because the worker is handed no `Clock` ([the clock decision](../architecture-patterns/adr-0040-clock-is-a-kernel-value.md)).

## Why This Works

heed keeps one process-wide map of open environments, keyed by canonical path. An open takes its lock and returns `EnvAlreadyOpened` when the path is already in it (`src/envs/env_open_options.rs:403`, `419-420`). That variant displays as the exact text above (`src/lib.rs:173-175`, `185-188`). The entry leaves the map only in `EnvInner::drop`, when the last clone of the `Env` goes (`src/envs/env.rs:745-752`). The refusal is not heed's choice to relax: it enforces LMDB's own rule, which says not to open one database twice in a process at the same time (`libraries/liblmdb/lmdb.h:102-105` in heed's bundled LMDB). Only a close that waits for the release can retire the wait.

cocoindex clones the `Env` into its batcher's runner (`rust/core/src/state_store/storage.rs:278-294`). The batcher's spawned tasks hold an `Arc` of the data that owns that runner (`rust/utils/src/batching.rs:209-212`, `228-238`, `270-272`). On the Python side, this session's probe found that a live `coco.AppConfig` keeps the Rust environment alive; the engine's native core is a binary, so no source line says so. Either way, a handle can outlive both the update and `Host.close()`.

Which survivor outlived the first `Host` on the CI runner is not pinned. A probe showed any survivor is enough. Keep one reference to the first `Host`'s `AppConfig` past `close()`, and the second open raises this error every time. Drop it, and the open succeeds, even without `gc.collect()`. The usual release takes moments, so waiting for it works. A handle caught in a reference cycle is the exception: only the collector frees it, hence the one `gc.collect()`.

## Prevention

- **Treat a flake whose message changed as unexplained.** If a fix changes what a flake says but not its shape (a second open in one process, soon after a close), suspect the same lifecycle.
- **Expect the old handle to linger** wherever a process reopens a cocoindex store it opened before. This is not test-only: the daemon opens a `Host` per index job in one process (`index_connected_source` in `apps/worker/src/better_answers_worker/pipeline/run.py`), and a failed job is not retried.
- **Write the red run first, and release on the log line, not a sleep.** `test_a_held_store_opens_once_the_engine_lets_go` in `apps/worker/tests/test_pipeline_host.py` hands the first `Host`'s `AppConfig` to a holder thread:

  ```python
  holder = threading.Thread(
      target=hold_until_waited_on,
      args=(first.app_config(run, CHUNKS_APP), written),
  )
  ```

  `hold_until_waited_on` returns once the wait line shows in `capture_logs`. `Thread.run` deletes its args when the target returns, so the reference drops before `holder.join()`.

- **Pin every branch with its own test.** A code review found that removing `gc.collect()` left the other three tests green. Only `test_a_store_held_in_a_cycle_opens_after_a_collection` catches it, failing with the still-open error when the collect is a no-op:

  ```python
  gc.disable()
  try:
      with Host(bootstrap) as first:
          cycle: list[object] = [first.app_config(run, CHUNKS_APP)]
          cycle.append(cycle)
      del cycle
      ...
  finally:
      gc.enable()
  ```

  `test_a_store_never_let_go_raises_after_the_wait` checks the same message comes back after at least the wait. `test_an_unreadable_store_raises_without_waiting` checks that `MDB_INVALID` raises with no wait logged.

- **The upstream fix.** An `Environment.close()` in cocoindex, built on heed's `prepare_for_closing()` (`src/envs/env.rs:620-627`), would let `Host.close()` wait for the real release and retire the retry. The request is filed upstream as [cocoindex-io/cocoindex#2467](https://github.com/cocoindex-io/cocoindex/issues/2467), related to [cocoindex-io/cocoindex#2402](https://github.com/cocoindex-io/cocoindex/issues/2402).
