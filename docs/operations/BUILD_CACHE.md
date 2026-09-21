# The build cache

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

Two caches, neither the estate's. Nothing deployed builds images — `RELEASES.md` promotes digests a runner built — so the build caches to bound are the two that build: a development machine's, bounded by a garbage-collection policy the builder reads at startup and by nothing a person runs, and the runner's, bounded by GitHub's quota and read in *The runner's cache* at the foot of this file. Every section between is the development machine's.

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

If one is ever wanted for another reason: it leaves nothing in the local image store without `--load`, and the image-contents suites pass `--load` only on the arm they take when the builder can reach the runner's cache — a runner's, never a laptop's (`apps/api/tests/image-probe.ts`, `apps/worker/tests/test_image.py`). On a laptop they run `docker build --quiet` and start a container from the id it prints, and a *selected* container builder leaves no such image. Create it, and name it with `--builder` on the builds that want it.

## The runner's cache

BuildKit's `type=gha` backend, kept in the repository's Actions cache beside the pnpm store, uv's cache and the detector's weights. No policy bounds it: GitHub holds **10 GB per repository** and, once past it, evicts least-recently-used entries of every kind until the total is back under — so a build cache over its share evicts `check.yml`'s weights entry along with its own layers.

**One scope per image, and the scope is the leg's name: `api`, `worker`, `backup`.** A scope holds one manifest, and a `type=gha` line with no `scope=` writes under `buildkit` for everyone — every writer then overwrites the one index, and each run builds cold whichever images wrote before the last. The writers are `build.yml`'s three legs and nothing else. The two image-contents suites `check.yml` runs on a pull request are readers (`apps/api/tests/image-probe.ts`, which builds `api` and `backup`; `apps/worker/tests/test_image.py`, which builds `worker`), each passing the leg's name out of `build.yml`'s matrix. `apps/api/tests/image-job.test.ts` refuses a bare `type=gha` in the workflow, and each suite holds its own argv as a literal.

An Actions cache is readable from the ref that wrote it and from the base branch, never from a sibling. A pull request therefore reads what `main`'s legs wrote and `main` never reads a pull request's — so **a pull request's probes pass `--cache-from` and no `--cache-to`** (`T-223`). What they exported warmed only the same pull request's later pushes and was paid for out of the one quota: a worker source change wrote its layers twice, once on the pull request's ref and once on `main` (#85, 2.37 GB each time; #89, 2.38 GB in 13 blobs of which three were 951.6, 949.6 and 477.7 MB). The price of reading only is that a pull request which changes a layer rebuilds it on every push, since nothing it built is kept.

**The worker's source is its runtime stage's last copy** (`T-223`). BuildKit re-runs every instruction below the first whose input moved, and a re-run `COPY` is a new blob even when its bytes are the same; with `COPY src src` above the weights, every source edit re-made a layer of about 950 MB on `main`. Below the venv, the weights and the suffix list, an edit outside `redaction/` re-makes the source's layer alone. An edit inside `redaction/` still re-fetches the weights, which is right: that is where the pins live. `apps/worker/tests/test_image.py` holds the order.

**Two commits' runs can write one scope at once.** `build.yml`'s concurrency group is per commit (`T-211`), so nothing serialises the runs any more, and a burst of pushes has several legs exporting to `scope=worker` together. The last index written wins. That is the collision above in a milder form: every writer of a scope built the same image, so the manifest left standing is a manifest for the right image and the next run reads it warm — what it costs is the losing runs' layers, left unreferenced until eviction takes them. It shows as blob growth after a burst with no matching gain in warm runs, and the six runs measured after `T-211` are where to look for it first.

Read it with:

```
gh cache list --limit 100 --sort size_in_bytes --order desc
gh cache list --key index- --json key,ref,createdAt
gh api repos/{owner}/{repo}/actions/cache/usage
```

The second is the one that shows a collision. A manifest's key is `index-<scope>-…`, so healthy is one `index-api-`, `index-worker-` and `index-backup-` family on `main`, and **any `index-buildkit-` entry newer than 20/09/2026 is an unscoped writer**. A pull request's ref holds neither kind, an index being the exporter's to write: **any `index-` or `buildkit-blob-` entry under `refs/pull/` from a run after `T-223` merged is a probe exporting again**. Layers are `buildkit-blob-…`, keyed by digest and shared across scopes, so the blob total is the number to hold against the quota — read it from the third command, not by summing the first, which stops at its `--limit`.

Measured 20/09/2026, before the scopes (`T-211`): 13.5 GB held, 12.07 GB of it blobs, every index under `buildkit`, the worker leg cold on 47% of runs at 9.19 min against 2.70 warm.

Measured 21/09/2026 at 12:25Z, before the probes stopped exporting (`T-223`): 10.22 GB held in 139 entries, still over the quota; `main` 6.40 GB of blobs in 89 entries, pull-request refs 2.38 GB in 13, every one of them #89's. The total moves with every eviction — 10.43 GB in 177 entries late on 20/09, 9.51 GB in 132 earlier on 21/09 — so the pull-request refs' share is the number this change is read against. The reading after is on the ticket.
