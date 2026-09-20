# The build cache — bounded by a policy, never by a prune

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

This is about a **development machine**, not the estate. Nothing in the deployed estate builds images — `RELEASES.md` promotes digests a runner built — so the only build cache anyone has to bound is the one on the machine that runs `check`, and it is bounded where the builder reads its policy. No page here names a prune to run by hand; `docs/agents/workflow.md` § Environment names none either, and that is deliberate (T-175 → T-188 → T-197).

## Where the policy lives

Docker Desktop's **Settings → Docker Engine** pane, which writes `~/.docker/daemon.json`. Both builders on this machine (`default` and `desktop-linux`, the selected one) use the **`docker` driver**, so their BuildKit is the one embedded in the daemon, and `~/.docker/daemon.json` is the only surface it reads. A `buildkitd.toml` would be read by a `docker-container` builder; there is none, and one placed on disk today would bind nothing.

The key is `builder.gc.policy`. It replaced `builder.gc.defaultKeepStorage`, which is **deprecated on Docker Engine 29.7.2** and is the likeliest reason three earlier readings — 34.42 GB (11/09), 56.67 GB and 62.31 GB (12/09) — ignored the 20 GB it asked for.

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "policy": [
        {
          "filter": ["type=source.local,type=exec.cachemount,type=source.git.checkout"],
          "keepDuration": "48h",
          "reservedSpace": "5GB"
        },
        { "keepDuration": "1440h", "reservedSpace": "10GB" },
        { "all": true, "reservedSpace": "10GB" }
      ]
    }
  }
}
```

Read as three rules, each a threshold and a floor:

1. Above **5 GB** of cache, drop local contexts, cache mounts and git checkouts unused for 48 hours — the ephemeral kinds a `check` run churns.
2. Above **10 GB**, drop unshared cache older than 60 days.
3. Above **10 GB**, drop everything, shared and internal records included.

`reservedSpace` is both the threshold that fires a rule and the floor a sweep will not go below. There is **no `maxUsedSpace`**, so there is no hard ceiling: between sweeps the cache floats above 10 GB, and a sweep brings it back towards 10 GB rather than to it. That is the intended shape — a ceiling costs rebuild time on every overshoot — but it is why a single reading above the floor is not by itself a failure. Two readings a week apart, both climbing, are.

## How to read it

```
docker buildx du                  # Shared / Private / Reclaimable / Total, and the entries
docker system df                  # Build Cache as one row, beside images and volumes
docker buildx inspect desktop-linux   # the GC Policy rules the builder actually holds
```

The third command is the one that proves the policy *binds*: it prints the rules read from `daemon.json` back out of the running builder. A settings change that the engine has not restarted into shows up here as the old rules, or none.

## Baseline

| When | Total | Reclaimable | Entries | Note |
| --- | --- | --- | --- | --- |
| 12/09/2026 | 54.18 GB | 54.18 GB | — | `docker buildx prune -a` reclaimed **0 B** of it (T-188). The prune was the thing T-175 landed, and it did not work |
| 19/09/2026 | 12 GB | 11.83 GB | 91 | **The baseline.** After the owner's own prune, before the policy |
| 20/09/2026 | 15.74 GB | 15.57 GB | 151 | First reading under the policy. `buildx inspect` shows all three rules live on `desktop-linux` |

## A known gap in rule 1

Rule 1's first predicate reads `type==source.local`. In `daemon.json` the equality operator is a **single `=`**; `==` belongs to `buildkitd.toml`, and the two files are not interchangeable on this point. The daemon splits a predicate on its first `=`, so `type==source.local` becomes the key `type` with the value `=source.local`, which matches no record. Rule 1 therefore covers cache mounts and git checkouts but **not local build contexts**. The fix is one character, in the same settings pane:

```json
"filter": ["type=source.local,type=exec.cachemount,type=source.git.checkout"]
```

Rules 2 and 3 carry no filter and are unaffected, so the 10 GB floor still holds while this stands.

## If it spikes again

Migrate the build to a **`docker-container` builder**, which reads a `buildkitd.toml` and accepts `maxUsedSpace` — the hard ceiling the `docker` driver's embedded BuildKit will not take:

```toml
[worker.oci]
gc = true
reservedSpace = "10GB"
maxUsedSpace = "25GB"
minFreeSpace = "10GB"

[[worker.oci.gcpolicy]]
filters = ["type==source.local", "type==exec.cachemount", "type==source.git.checkout"]
keepDuration = "48h"
maxUsedSpace = "3GB"

[[worker.oci.gcpolicy]]
keepDuration = "1440h"
maxUsedSpace = "20GB"

[[worker.oci.gcpolicy]]
all = true
maxUsedSpace = "25GB"
```

That is Docker's own recommendation for this case, and the `==` above is correct there — it is the `buildkitd.toml` spelling.

**Do not make it the selected builder without changing the probes first.** A `docker-container` builder leaves nothing in the local image store without `--load`, and the image-contents suites only pass `--load` on the arm they take when the builder can export a cache — a runner's, never a laptop's (`apps/api/tests/image-probe.ts`, `apps/worker/tests/test_image.py`). On a laptop the suites run a plain `docker build --quiet` and start a container from the id it prints; with a container builder selected there is no such image. Create the builder and name it with `--builder` on the builds you want bounded, or teach the laptop arm `--load` as part of the move. That is why this is the escalation and not the first thing to try.
