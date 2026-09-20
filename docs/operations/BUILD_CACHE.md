# The build cache — bounded by a policy, never by a prune

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

This is about a **development machine**, not the estate. Nothing in the deployed estate builds images — `RELEASES.md` promotes digests a runner built — so the only build cache anyone has to bound is the one on the machine that runs `check`, and it is bounded where the builder reads its policy. No page here names a prune to run by hand; `docs/agents/workflow.md` § Environment names none either, and that is deliberate (T-175 → T-188 → T-197).

**As of 20/09/2026 the policy on this machine does not parse, and nothing is being collected.** The section *The policy is dead* below carries the daemon's own words and the correction. Read it before reading the rest as a description of a working thing.

## Where the policy lives

Docker Desktop's **Settings → Docker Engine** pane, which writes `~/.docker/daemon.json`. Both builders on this machine (`default` and `desktop-linux`, the selected one) use the **`docker` driver**, so their BuildKit is the one embedded in the daemon, and `~/.docker/daemon.json` is the only surface it reads. A `buildkitd.toml` would be read by a `docker-container` builder; there is none, and one placed on disk today would bind nothing.

The key is `builder.gc.policy`. It replaced `builder.gc.defaultKeepStorage`, which is **deprecated on Docker Engine 29.7.2** and is the likeliest reason three earlier readings — 34.42 GB (11/09), 56.67 GB and 62.31 GB (12/09) — ignored the 20 GB it asked for.

## How a filter is actually read

Four mechanics, and every defect below is one of them:

1. **The daemon cuts a filter element at its first `=` and nowhere else.** Commas are not separators. `"type=a,type=b"` is one predicate: the key `type` with the value `a,type=b`.
2. **The daemon then rebuilds it for BuildKit as key + `==` + value.** That is why `daemon.json` takes a single `=` where `buildkitd.toml` takes `==` — the daemon supplies the second one. Writing `==` yourself yields `type===…`.
3. **BuildKit's filter grammar accepts `==`, `!=` and `~=`, and nothing else.** A bare `=` reaching it is `unsupported operator "="`.
4. **The whole policy runs in one call, and the first rule that fails to parse ends it.** `cacheManager.Prune` returns on that error and `Controller.gc` logs it. One malformed rule stops every later rule too — there is no partial collection.

So: **one predicate per array element, never a comma**, and **distinct keys within a rule** (a repeated key is the startup error `could not get builder GC policy: filters expect only one value`; different keys AND together). A single rule can therefore name one cache type, and a three-type sweep needs three sibling rules. `daemon.json` cannot express "type A *or* type B" inside one rule at all — moby/moby#46864, open since 2023.

## The policy is dead

The policy the running daemon holds is the comma-joined form, and it has never parsed. From this machine's own log — `~/Library/Containers/com.docker.docker/Data/log/vm/init.log`, three ticks on 20/09/2026 at 10:22, 11:03 and 11:24, one per GC attempt:

```
gc error: filters: parse error: [type==source.local,type >|=|< exec.cachemount,type=source.git.checkout]:
  unsupported operator "=": invalid argument
failed to parse prune filters [type==source.local,type=exec.cachemount,type=source.git.checkout]
  github.com/moby/buildkit/cache.(*cacheManager).prune   cache/manager.go:1039
  github.com/moby/buildkit/cache.(*cacheManager).Prune   cache/manager.go:1019
  github.com/moby/buildkit/worker/base.(*Worker).Prune   worker/base/worker.go:600
  github.com/moby/buildkit/control.(*Controller).gc.func2
```

Read it against the four mechanics. The daemon cut the element at its first `=`, rebuilt it with `==`, and handed BuildKit one string whose *second* predicate still carries a bare `=`. The parse fails there, `Prune` returns, and the 10 GB rules behind it never run. **That is the cause of the climb from 12 GB to 15.74 GB in a day, and it is a better explanation than any reading of the rules' thresholds.**

Two further defects in the same policy:

- **`keepDuration` is not a `daemon.json` key.** `BuilderGCRule` carries `all`, `filter`, `reservedSpace`, `maxUsedSpace`, `minFreeSpace` and the deprecated `keepStorage` — no age field. The `48h` and `1440h` are read by nothing and dropped in silence. `docker buildx inspect` confirms it: it prints a `Keep Duration:` line whenever one is set, and prints none. Age belongs in the filter, as `unused-for=48h`.
- **The `==` now in the file is not what the daemon is running.** The log's error names `"="`, not `"==="`, so the loaded policy is a single-`=` one and the `==` edit has not been through an engine restart. Restarting as things stand swaps one dead policy for another.

### The correction

The smallest thing that works is to **delete `builder.gc.policy`** and set only the defaults, which need no filter and therefore cannot be malformed:

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultReservedSpace": "10GB",
      "defaultMaxUsedSpace": "25GB",
      "defaultMinFreeSpace": "10GB"
    }
  }
}
```

Engine 29.6.0 fixed its own compiled default policy (moby/moby#52814 split the comma form into sibling rules), so the built-in shape this falls back to is the one that expresses the three-type sweep correctly. If the explicit policy is wanted anyway, it is one predicate per element and one type per rule:

```json
"policy": [
  { "filter": ["type=source.local",        "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["type=exec.cachemount",     "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["type=source.git.checkout", "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["unused-for=1440h"], "reservedSpace": "10GB", "maxUsedSpace": "25GB" },
  { "all": true, "reservedSpace": "10GB", "maxUsedSpace": "25GB" }
]
```

**Then prove it**, because a policy that fails to parse looks exactly like a policy that is working until the cache climbs: restart the engine, and check both places.

- `docker buildx inspect desktop-linux` — rule#0 should read `Filters: type==source.local` with no comma in it, and `Keep Duration: 48h0m0s` on the line below. A rule still showing commas is still one predicate.
- `grep "gc error" ~/Library/Containers/com.docker.docker/Data/log/vm/init.log` — silent from the restart onwards.

## How to read it

```
docker buildx du                      # Shared / Private / Reclaimable / Total, and the entries
docker system df                      # Build Cache as one row, beside images and volumes
docker buildx inspect desktop-linux   # the GC Policy rules the builder holds
grep "gc error" ~/Library/Containers/com.docker.docker/Data/log/vm/init.log
```

The third command shows what the builder was *given*. It prints `PruneInfo.Filter` as reported over ListWorkers — the string after the daemon's `==` rebuild — and buildx never runs the parser, so a string that cannot parse prints just as happily as one that can. It proves the policy reached the builder; it does not prove the policy works.

The fourth is the one that proves it works, and it is the only place a malformed policy confesses. Nothing surfaces in `docker buildx du`, in `docker system df` or at the CLI at all — the cache simply grows.

## Baseline

| When | Total | Reclaimable | Entries | Note |
| --- | --- | --- | --- | --- |
| 12/09/2026 | 54.18 GB | 54.18 GB | — | `docker buildx prune -a` reclaimed **0 B** of it (T-188). The prune was the thing T-175 landed, and it did not work |
| 19/09/2026 | 12 GB | 11.83 GB | 91 | **The baseline.** After the owner's own prune, by hand |
| 20/09/2026 | 15.74 GB | 15.57 GB | 151 | +3.74 GB in a day, with the policy in place — because the policy does not parse and nothing has collected |

Once the policy parses, expect the cache to float *above* its floor between sweeps and be brought back towards it, rather than held at a line: `reservedSpace` is both the threshold that fires a rule and the floor a sweep stops at, and `maxUsedSpace` is the ceiling a sweep brings it under. A single reading above the floor is not a failure. Two climbing readings a week apart, with `gc error` in the log, is the shape of this one.

## On moving to a `docker-container` builder

Not needed for a ceiling. `maxUsedSpace` is supported in `daemon.json` on Engine 29.7.2, both per-rule and as `defaultMaxUsedSpace`, so the `docker` driver's embedded BuildKit takes the hard limit that once required `buildkitd.toml`.

If a container builder is ever wanted for another reason, the thing to know first: **it leaves nothing in the local image store without `--load`**, and the image-contents suites only pass `--load` on the arm they take when the builder can export a cache — a runner's, never a laptop's (`apps/api/tests/image-probe.ts`, `apps/worker/tests/test_image.py`). On a laptop the suites run a plain `docker build --quiet` and start a container from the id it prints; with a container builder *selected* there is no such image. Create it and name it with `--builder` on the builds that want it, or teach the laptop arm `--load` as part of the move.
