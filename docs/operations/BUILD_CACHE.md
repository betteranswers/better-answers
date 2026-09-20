# The build cache

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

A development machine's cache, not the estate's. Nothing deployed builds images — `RELEASES.md` promotes digests a runner built — so the only build cache to bound is on the machine that runs `check`. It is bounded by a garbage-collection policy the builder reads at startup, and by nothing a person runs.

## Where the policy lives

Docker Desktop's **Settings → Docker Engine**, which writes `~/.docker/daemon.json` under `builder.gc`. Both builders here use the `docker` driver, so their BuildKit is the daemon's own and that file is the only surface it reads. A `buildkitd.toml` binds a `docker-container` builder; there is none.

## Prove the policy parses

A malformed policy is invisible. `docker buildx du`, `docker system df` and the CLI all look normal while nothing is collected and the cache climbs — `buildx inspect` prints the rules the builder was *given*, and never runs the parser. Two commands tell the truth, and both are worth running after any edit to the policy:

```
docker buildx inspect desktop-linux
grep "gc error" ~/Library/Containers/com.docker.docker/Data/log/vm/init.log
```

The inspect should show, per rule, **one predicate and no comma** in its `Filters` line, and a `Keep Duration` wherever an age was asked for. The grep should be silent across at least two GC ticks. A policy that fails to parse logs one line per tick:

```
gc error: filters: parse error: […]: unsupported operator "=": invalid argument
```

## How a filter is read

Four mechanics no config file confesses, and every way to write a broken policy is one of them:

1. **The daemon cuts a filter element at its first `=`, and nowhere else.** Commas do not separate predicates. `"type=a,type=b"` is one key, `type`, with the value `a,type=b`.
2. **The daemon rebuilds each predicate for BuildKit as key + `==` + value.** This is why `daemon.json` takes one `=` where `buildkitd.toml` takes two — the daemon supplies the second.
3. **BuildKit accepts `==`, `!=` and `~=`.** Anything else, including a bare `=` left inside a value by mechanic 1, is `unsupported operator`.
4. **The whole policy runs in one call, and the first rule that fails to parse ends it.** One malformed rule stops every later rule. There is no partial collection.

So: **one predicate per array element**, and **distinct keys within a rule** — a repeated key is the startup error `filters expect only one value`, while different keys AND together. A rule therefore names one cache type, and a three-type sweep is three sibling rules. `daemon.json` has no way to say "type A *or* type B" within one rule (moby/moby#46864).

Age is a filter, `unused-for=48h`. The `keepDuration` key of `buildkitd.toml` does not exist here and is dropped in silence — `buildx inspect` shows this by printing no `Keep Duration` line.

## The policy

```json
"policy": [
  { "filter": ["type=source.local",        "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["type=exec.cachemount",     "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["type=source.git.checkout", "unused-for=48h"], "reservedSpace": "5GB" },
  { "filter": ["unused-for=1440h"], "reservedSpace": "10GB", "maxUsedSpace": "25GB" },
  { "all": true, "reservedSpace": "10GB", "maxUsedSpace": "25GB" }
]
```

Three thresholds, and they read differently:

- **`reservedSpace`** fires the rule and floors the sweep. Above it the rule runs; below it the sweep stops.
- **`maxUsedSpace`** is the ceiling a sweep brings the cache under.
- **`minFreeSpace`** is disk headroom to leave, unused here.

A sweep therefore lands the cache **between 10 GB and 25 GB**, not at either. A reading of 15 GB is the policy working. Read it with `docker buildx du`, or `docker system df` for the one-row version.

Setting `builder.gc`'s `defaultReservedSpace`, `defaultMaxUsedSpace` and `defaultMinFreeSpace` and deleting `policy` altogether is the alternative: no filters, so nothing to malform, and Engine 29.6.0 onwards compiles a correct three-type default.

## On a `docker-container` builder

Unnecessary for a ceiling — `maxUsedSpace` works in `daemon.json` on Engine 29.7.2, per-rule and as a default.

If one is ever wanted for another reason: it leaves nothing in the local image store without `--load`, and the image-contents suites pass `--load` only on the arm they take when the builder can export a cache — a runner's, never a laptop's (`apps/api/tests/image-probe.ts`, `apps/worker/tests/test_image.py`). On a laptop they run `docker build --quiet` and start a container from the id it prints, and a *selected* container builder leaves no such image. Create it, and name it with `--builder` on the builds that want it.
