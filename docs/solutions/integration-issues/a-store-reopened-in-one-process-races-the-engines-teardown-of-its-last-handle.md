---
title: "A store reopened in one process races the engine's teardown of its last handle"
date: 2026-10-02
last_updated: 2026-10-20
category: integration-issues
module: apps/worker
problem_type: integration_issue
component: worker
severity: high
applies_when:
  - "Opening a connected source's store from a worker `Host` soon after another `Host` closed it"
  - "Changing how the worker's `Host` closes, evicts or reopens its cocoindex environments"
  - "Chasing `environment already open in this program` from a worker test or job"
symptoms:
  - "apps/worker/tests/pipeline/test_pipeline_landed.py failed intermittently in CI merge groups with RuntimeError: environment already open in this program; close it to be able to open it again with different options"
  - "Merge-group runs 36358367778, 36358640405, 36992793999 and 37061772234 (4 of 78 since PR #448) each dropped an unrelated PR (#472, #470, #506, #514) from the merge queue"
  - "It never reproduced in 120 local rounds"
  - "An earlier failure, run 36336846608, was the same lifecycle race on cocoindex's app-name slot, which refused the landed app a second registration when two reads shared one Host"
root_cause: concurrency
resolution_type: code_fix
framework_version: "cocoindex 1.0.25 (heed 0.22.1)"
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
  - environment-close
---

# A store reopened in one process races the engine's teardown of its last handle

## Problem

A worker `Host` that opens a connected source's LMDB store after the same process let go of it can fail. If any reference to the old environment survives, the engine still holds the old handle, and heed refuses a second open of a path it holds. Dropping the `Host`'s own references is not enough. The `Host` must close each environment it lets go with `Environment.close()`.

## Symptoms

- `coco.Environment(...)` raises a plain `RuntimeError` whose text is exactly `environment already open in this program; close it to be able to open it again with different options`.
- Merge-group runs 36358367778, 36358640405, 36992793999 and 37061772234 failed this way: 4 of 78 merge groups since PR #448. Each dropped an unrelated PR (#472, #470, #506, #514) that touched no worker file.
- Every failure was a test in `apps/worker/tests/pipeline/test_pipeline_landed.py` that calls `read_the_copies` twice, each read through its own `Host`.
- A two-read race script never reproduced it locally in 120 rounds.

## What Didn't Work

- **One `Host` for both reads.** Run 36336846608 failed when cocoindex's per-environment app-name slot refused the landed app a second registration.
- **A `Host` per read, with no close.** PR #448 gave each read its own `Host`. That moved the symptom from cocoindex's app-name slot to heed's store-path slot.
- **Clearing the `Host`'s dict of environments.** It drops the `Host`'s own references and nothing else.
- **A retry on the open.** BA-45 caught heed's message, ran one `gc.collect()` and retried with doubling pauses for up to 5 s. It absorbed the release on a starved runner, but it waited on the garbage collector instead of releasing the store. cocoindex 1.0.24 had no close, so it was the only choice then. The retry was deleted when `Host` adopted `Environment.close()` (BA-189).

## Solution

`apps/worker/src/better_answers_worker/pipeline/host.py` calls `close()` on each environment at the three places the `Host` lets one go:

- `Host.close()` closes every environment it holds, before it closes the pools and its event loop. The environments run on that loop, and a close waits for the store's open LMDB transactions.
- The cache bound closes each store of the connected source it sheds.
- `remove_connected_source_store` closes the passage store before it deletes the store's directory.

## Why This Works

heed keeps one process-wide map of open environments, keyed by canonical path. An open returns `EnvAlreadyOpened` when the path is already in the map. The entry leaves the map only when the last clone of the `Env` drops. cocoindex clones the `Env` into its batcher's runner, and a live `coco.AppConfig` keeps the environment alive, so a handle can outlive both the update and the `Host`.

cocoindex 1.0.25's `Environment.close()` (`cocoindex/_internal/environment.py`) waits for the store's open LMDB transactions, then releases the database at `db_path`, whatever references remain. It does not wait for an app's update to finish. A probe on 20/10/2026 updated an app, held its `AppConfig`, and reopened the same path in the same process. With `close()`, 0 of 200 reopens were refused. Without it, 200 of 200 were refused.

After `close()`, every later operation on that environment fails, and an update still running on it fails with `The CocoIndex environment is closed`. A `Host` runs one job on one connected source, and the cache bound always keeps that source's two stores, so no live app reads an environment that the `Host` closed.

## Prevention

- **Close what you let go.** Any new place where `Host` drops an environment must call `close()` on it, or a reopen in the same process can fail.
- **Never close a store an app still runs on.** If a `Host` ever holds more than one connected source at a time, the cache bound could shed a store that an update is using, and that update would fail.
- **Hold a reference across the reopen in the test.** CPython frees an environment with no references at once, so a test that keeps none passes without the close. Each of the three tests in `apps/worker/tests/pipeline/test_pipeline_host.py` holds an `AppConfig` of the environment across the reopen:
  - `test_a_closed_hosts_store_reopens_while_its_config_is_held`
  - `test_a_store_closed_for_the_cache_bound_reopens_while_held`
  - `test_a_removed_store_reopens_while_its_config_is_held`

  Each fails with heed's still-open message when its own `close()` call is removed.
