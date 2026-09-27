# The build cache

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

Two caches, neither the estate's. Nothing deployed builds images — `release.yml` promotes digests a runner built, and records each promotion as a `release/*` tag — so the build caches are the two that build: a development machine's, bounded by a garbage-collection policy the builder reads at startup and by nothing a person runs, and the runner's, a tag in each image's package on GHCR that nothing bounds yet, read in *The runner's cache* at the foot of this file. Every section between is the development machine's.

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

A registry cache on GHCR: one tag, `buildcache`, in each image's own package, so `ghcr.io/<owner>/api:buildcache`, `…/worker:buildcache` and `…/backup:buildcache`. `build.yml`'s pushing step writes it with `mode=max`, which keeps the builder stages' layers as well as the shipped ones, and with `image-manifest=true`, which makes each write one OCI manifest whose config is `application/vnd.buildkit.cacheconfig.v0`. Each leg writes only its own image's tag.

**Why the registry and not the Actions cache.** Until 27/09/2026 this was BuildKit's `type=gha` backend, in the repository's Actions cache beside the pnpm store, uv's cache and the detector's weights. A run on `main` restores entries written on `main`. The cache service takes the runner's own token, not `GITHUB_TOKEN`, so no `permissions:` block narrows who writes: any code running in any workflow on `main` could write an entry under a key the image job reads. A compromised dependency in the nightly mutation job is one example. The image job holds `packages: write`, `id-token: write` and `attestations: write`, and the layers it restores go into the image it pushes and attests. zizmor's `cache-poisoning` audit named the job's pnpm and uv caches, and #441 turned them off; the layer cache had the same exposure and no audit that reads it. A tag in these packages moves only for a token holding `packages: write` on them, and the image job is the only job in the repository that holds it.

**One writer, and the probes only read.** The readers are the two image-contents suites `check.yml` runs in a merge group: `apps/api/tests/image-probe.ts`, which builds `api` and `backup` on `full-api`, and `apps/worker/tests/test_image.py`, which builds `worker` on `full-worker`. Each passes `--cache-from` and no `--cache-to`, and each leg holds only `packages: read`, so a probe could not move the tag if it tried. The packages are private, so there is no anonymous read. Each leg logs in to ghcr.io with its own `GITHUB_TOKEN` and hands the suite the registry as `IMAGE_CACHE_REGISTRY`. A laptop names no registry and builds with the daemon, as before. Each suite holds its own argv as a literal.

A registry tag has no ref scope, as an Actions cache entry had. A merge group that wrote it would decide what `main`'s next build reads, which is the exposure this layout exists to close. The price of reading only is that a change to a layer is rebuilt by every merge group that carries it, since nothing a group built is kept.

**A pull request builds no image at all**, so it neither reads this cache nor writes it: its `check` runs no suite. Nor does a docs-only merge group, which takes the docs lane — every changed path ending `.md` — and runs the prose gates in one job, `docs-gates`, installing neither the builder nor the weights (the process review, 21/09/2026; the steps are in `.github/workflows/check.yml`). A full-lane merge group builds the images only when a changed path is an image input (`CI.md`, *The lanes*). Every sentence here about what a probe reads is about that run.

**Reading needs the container builder.** Docker documents the daemon's own `docker` driver as reading a registry cache only when the daemon keeps its images in containerd. On 21/09/2026 a hosted runner's daemon (Engine 28.0.4 on `overlay2`, buildx v0.37.0) could not import the old `type=gha` backend either: it logged `ERROR: unknown cache importer: gha`, built all six layers cold and exited 0, while the container builder `docker/setup-buildx-action` creates read six of six (run 35602449161). So `full-api` and `full-worker` each run `setup-buildx`, and both suites refuse the `docker` driver. An unreadable cache is a warning, not a failure: the build logs `importing cache manifest from …` with the error under it and runs cold. So a leg that loses the builder, the login or `IMAGE_CACHE_REGISTRY` stays green. No test holds those steps to those legs; the leg's run time is where a loss shows.

**The worker's source is its runtime stage's last copy** (`T-223`). BuildKit re-runs every instruction below the first whose input moved, and a re-run `COPY` is a new blob even when its bytes are the same; with `COPY src src` above the weights, every source edit re-made a layer of about 950 MB on `main`. Below the venv, the weights and the suffix list, an edit outside `redaction/` re-makes the source's layer alone. An edit inside `redaction/` still re-fetches the weights, which is right: that is where the pins live. `apps/worker/tests/test_image.py` holds the order.

**Two commits' runs can write one tag at once.** `build.yml`'s concurrency group is per commit (`T-211`), so nothing serialises the runs, and a burst of pushes has several legs exporting to `worker:buildcache` together. The last manifest written wins. Every writer of a tag built the same image, so the manifest left standing is right for the next run, and the losing runs' manifests are left untagged like any overwritten one.

**An overwritten cache stays in the package.** GHCR keeps every manifest pushed to a package. Moving `buildcache` leaves the manifest it pointed at as an untagged version, still holding its layers, and nothing deletes it. Container registry storage is free today, and GitHub has said it will give a month's notice before that changes, so this costs nothing yet. It does lengthen the version lists. On 27/09/2026 each package held about 1,100 versions: every build adds its image and the attestation's two manifests, and now a cache. `scan.yml` reads every page and picks by `sha-` tag, and `release.yml` resolves a `sha-` tag directly, so neither reads a cache.

A cleanup, when one is wanted, may delete an untagged version only when its manifest's config is `application/vnd.buildkit.cacheconfig.v0`. Deleting every untagged version is wrong here: each attestation leaves an untagged manifest that its `sha256-<digest>` tag's index names, and deleting it loses that image's provenance.

Read it with:

```
gh api --paginate 'orgs/{owner}/packages/container/worker/versions?per_page=100' \
  --jq '.[] | select(.metadata.container.tags | index("buildcache")) | .updated_at'
gh api repos/{owner}/{repo}/actions/cache/usage
```

The first says when a leg last wrote its tag; name `api` or `backup` for the other two. A merge group's probe that read the cache logs `importing cache manifest from ghcr.io/<owner>/<tier>:buildcache` and then `CACHED` against the layers it reused. The second is the Actions cache, which still holds the pnpm store, uv's cache and the detector's weights for `check.yml`. On 27/09/2026, before the move, it held 14.78 GB in 245 entries, 9.25 GB of them layer blobs. Those blobs stop being written, and eviction takes them.
