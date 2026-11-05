---
title: "A second BuildKit build is not promised the first build's cache, so push the image that was probed"
date: 2026-11-05
category: integration-issues
module: .github/workflows
problem_type: integration_issue
component: development-workflow
severity: high
applies_when:
  - "A workflow builds an image twice, once to test and once to push, and expects the two digests to be equal"
  - "build.yml's image job fails with a probed digest that differs from the pushed digest"
  - "Changing how build.yml's image job builds, loads, probes or pushes an image"
symptoms:
  - "worker probed sha256:52aad… and pushed sha256:3e55…: the two exports have stopped being one manifest"
  - "In the second build's log, a step that the first build ran on the same builder shows DONE, not CACHED, and every runtime step after it runs again"
root_cause: wrong_api
resolution_type: config_change
framework_version: "BuildKit v0.34.2, buildx v0.38.0, Docker Engine 29.4.2 with the containerd image store"
tags:
  - buildkit
  - buildx
  - build-yml
  - image
  - digest
  - cache
  - containerd
retire_when: "build.yml's image job runs one build per leg and pushes it with docker push. While it does, no second build exists to miss the cache."
---

# A second BuildKit build is not promised the first build's cache, so push the image that was probed

## Problem

Until 05/11/2026, each leg of `build.yml`'s image job built its image twice. The first build loaded the image into the runner's daemon for the probe. The second build pushed it, and it was to take every layer from the first build's cache on the same builder. The job then failed when the two digests differed.

BuildKit does not promise that cache hit. On runs 41939005250 (#985) and 41939407450 (#986), the worker's second build ran steps again that the first build had run minutes earlier. Those were `build 9/9` in the first run and `build 5/9` to `9/9` in the second. The weights step and the suffix list step fetch from the network, so a step that runs again gives other bytes. The runtime stage copies those bytes, so the pushed manifest was not the probed one.

The two builds can also differ when no step runs again. Each build imports `buildcache` when it starts, and another run can move the tag in between. On run 41946705666 (5feebe7f5, a web-test-only change), every step of both builds showed `CACHED`, and the digests still differed. Between the load's import at 01:21:31 and the push's import at 01:23:07, a diagnostic run that had rebuilt the worker's build stage wrote the tag. It put other layers under the same cache keys, and the push build took them.

## Symptoms

- The `digest to the job summary` step fails with `the two exports have stopped being one manifest`.
- The push build's log shows `CACHED` for every build step up to one that shows `DONE`. Every `runtime` copy after it shows `DONE` too.
- The failure follows no input. #986 changed only docs, and the next docs-only run passed.
- Every step of both builds shows `CACHED`, the digests still differ, and the package's version list shows a `buildcache` write between the two builds' `importing cache manifest` lines.

## What Didn't Work

Each of these was tested on CI and ruled out:

- **The builder's garbage collection under disk pressure.** The runner has a 145 GB disk with 74 GB free. The lowest free reading across both builds was 75,027 MB, far above the 13.97 GiB at which the GC policy prunes (run 41941791292).
- **A build context the probe changed.** The probe runs pytest in `apps/worker`, but `apps/worker/.dockerignore` excludes `tests`, `__pycache__` and `.pytest_cache`.
- **A cache tag that moved between the two builds.** The worker package's version list shows no write to `buildcache` between 00:03:15 and 00:16 on 05/11/2026. Both builds of #985 read the manifest that #982 exported.
- **Replaying #985's exact cache state.** Two runs read #982's cache manifest by digest, so the build stage missed from `COPY pyproject.toml` on, as in #985 (runs 41942665646 and 41942668810). Both second builds hit the cache on every step, and both digests matched. The miss is not reproducible on demand, so a fix that tunes the cache cannot be shown to work.

## Solution

Build once and push the image that was probed. The load step is the leg's one build, and it also exports the cache. After the probe, `docker push` sends the loaded image. The runner's daemon keeps images in containerd (`driver-type: io.containerd.snapshotter.v1` in `docker info`), and that store pushes the manifest the build wrote byte for byte. The job reads the pushed tag's digest back from the registry with `docker buildx imagetools inspect`, and it still fails when that digest differs from the probed one.

A local check of the premise, with the same exporter options: the build's digest, the loaded image's id, `docker push`'s digest and the registry's `Docker-Content-Digest` were one value, for an image whose layer held a timestamp.

## Why This Works

Two builds can give two manifests whenever a step is not reproducible and BuildKit runs it again, or whenever the cache tag moves between their imports. One build imports the cache once and gives one manifest, and a push from the containerd store does not rebuild or recompress it. So the digest the probe read and the digest the registry holds are the same by construction, and the comparison is now a guard on the push.

## Prevention

- Do not test one build and ship another, even on the same builder with the same cache.
- Keep the digest comparison after the push. It costs one registry read and fails loudly if a later Docker change makes the push rewrite the manifest.
