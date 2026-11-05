# The build cache

Nothing deployed builds images, because `release.yml` promotes digests a runner built and tags each promotion `release/*`. There are two build caches:

- A development machine's cache, bounded by a garbage-collection policy the builder reads at startup.
- The runner's cache, a tag in each image's package on GHCR.

## Where the policy lives

Docker Desktop's **Settings**, under **Docker Engine**, writes the policy to `~/.docker/daemon.json` under `builder.gc`. Both builders here use the `docker` driver, so their BuildKit is the daemon's own and reads only that file. A `buildkitd.toml` binds only a `docker-container` builder, and there is none.

## Prove the policy parses

A malformed policy collects nothing and looks normal everywhere, and `buildx inspect` prints the rules without parsing them. After any edit to the policy:

1. Run the inspect command:

	```
	docker buildx inspect desktop-linux
	```

2. Check that each rule's `Filters` line shows one predicate and no comma, and that each rule with an age shows a `Keep Duration`.
3. Wait for at least two GC ticks, then search the VM's log:

	```
	grep "gc error" ~/Library/Containers/com.docker.docker/Data/log/vm/init.log
	```

4. Check that the search prints nothing. A policy that fails to parse logs one line per tick:

	```
	gc error: filters: parse error: […]: unsupported operator "=": invalid argument
	```

## How a filter is read

Every broken policy breaks one of these four mechanics:

1. **The daemon cuts a filter element at its first `=`, and nowhere else.** Commas do not separate predicates. `"type=a,type=b"` is one key, `type`, with the value `a,type=b`.
2. **The daemon rebuilds each predicate for BuildKit as the key, `==`, and the value.** So `daemon.json` takes one `=` where `buildkitd.toml` takes two.
3. **BuildKit accepts `==`, `!=`, and `~=`.** Any other operator, including a bare `=` that mechanic 1 left in a value, is an `unsupported operator`.
4. **The whole policy runs in one call, and the first rule that fails to parse ends it.** No later rule runs.

So put **one predicate in each array element**, and use **distinct keys within a rule**. A repeated key is the startup error `filters expect only one value`. Different keys combine with AND, so a rule names one cache type, and a sweep of three types is three rules. `daemon.json` cannot say "type A *or* type B" in one rule (moby/moby#46864).

Age is a filter, `unused-for=48h`. `buildkitd.toml` has a `keepDuration` key, but `daemon.json` has none and drops it silently. `buildx inspect` then prints no `Keep Duration` line.

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

| Threshold | Meaning |
| --- | --- |
| `reservedSpace` | The rule runs above it, and the sweep stops below it. |
| `maxUsedSpace` | The ceiling a sweep brings the cache under. |
| `minFreeSpace` | Disk headroom to leave. Unused here. |

A sweep leaves the cache **between 10 GB and 25 GB**, so a reading of 15 GB is the policy working. Read it with `docker buildx du`, or `docker system df` for one row.

The alternative is to set `builder.gc`'s `defaultReservedSpace`, `defaultMaxUsedSpace`, and `defaultMinFreeSpace`, and delete `policy`. That has no filters to malform, and Engine 29.6.0 and later compiles a correct three-type default.

## On a `docker-container` builder

A ceiling does not need one, because `maxUsedSpace` works in `daemon.json` on Engine 29.7.2, per rule and as a default. If you add one, select it with `--builder` on each build that wants it. A *selected* container builder leaves nothing in the local image store without `--load`. The image-contents suites (`apps/api/tests/images/image-probe.ts`, `apps/worker/tests/test_image.py`) pass `--load` only on a runner, where the builder can reach the runner's cache. On a laptop they run `docker build --quiet` and start a container from the printed id.

## The runner's cache

The runner's cache is one tag, `buildcache`, in each image's GHCR package: `ghcr.io/<owner>/api:buildcache`, `…/worker:buildcache`, and `…/backup:buildcache`. `build.yml`'s image job writes it from each leg's one build, with `mode=max`, which keeps the builder stages' layers too, and `image-manifest=true`, which makes each write one OCI manifest with the config `application/vnd.buildkit.cacheconfig.v0`. Each leg writes only its own image's tag. Only a run on `refs/heads/main` writes the tag. Every other ref, a branch dispatch included, gets an empty `cache-to` and only reads. A dispatched branch runs its own copy of `build.yml`, so this rule stops an accidental write, not a deliberate one.

**Why the registry and not the Actions cache.** Any workflow on `main` can write an Actions cache entry, because the cache service takes the runner's own token, not `GITHUB_TOKEN`, and no `permissions:` block limits it. The image job holds `packages: write`, `id-token: write`, and `attestations: write`, and ships what it restores, so it takes no Actions cache (zizmor's `cache-poisoning` audit, #441). Only a token with `packages: write` on a package moves its tag. Only the image job and the weekly deletion hold one, and the deletion pushes nothing.

**One writer, and the probes only read.** The readers are the image-contents suites in `check.yml`'s `full-images` leg. `apps/api/tests/images/image-probe.ts` builds `api` and `backup`, and `apps/worker/tests/test_image.py` builds `worker`. Each passes `--cache-from` and no `--cache-to`, and holds its own argv as a literal. The leg holds only `packages: read`, logs in to the private packages on ghcr.io with its own `GITHUB_TOKEN`, and passes the registry as `IMAGE_CACHE_REGISTRY`. A laptop names no registry and builds with the daemon. A registry tag has no ref scope, so read-only probes keep a pull request from deciding what `main`'s next build reads. The cost is that every pull request run carrying a layer change rebuilds that layer.

**Reading needs the container builder.** Docker documents that the `docker` driver reads a registry cache only when the daemon keeps its images in containerd. The container builder comes from `docker/setup-buildx-action`. So `full-images` runs `setup-buildx`, and both suites refuse the `docker` driver.

An unreadable cache is a warning. The build logs `importing cache manifest from …` with the error under it, and runs cold. A leg that loses the builder, the login, or `IMAGE_CACHE_REGISTRY` stays green. No test holds those steps to those legs, so only the leg's run time shows the loss.

**The worker's source is its runtime stage's last copy.** BuildKit reruns every instruction below the first whose input moved, and a rerun `COPY` is a new blob even with the same bytes. Copied below the venv, the weights, and the suffix list, the source's layer is the only one an edit outside `redaction/` remakes. An edit inside `redaction/`, where the pins live, still refetches the weights. `apps/worker/tests/test_image.py` holds the order.

**Two commits' runs can write one tag at once.** `build.yml`'s concurrency group is per commit, so several legs can export to `worker:buildcache` at once. Each built the same image, so the last write is right.

**An overwritten cache stays in the package.** Moving `buildcache` leaves the old manifest as an untagged version, with its layers, until the weekly cleanup deletes it. Every build adds its image, the attestation's two manifests, and a cache. Container registry storage is free, and GitHub has said it will give a month's notice before that changes. The old versions lengthen the version lists, but `scan.yml` picks by `sha-` tag and `release.yml` resolves a `sha-` tag directly, so neither reads a cache.

To check the caches, run:

```
gh api --paginate 'orgs/{owner}/packages/container/worker/versions?per_page=100' \
  --jq '.[] | select(.metadata.container.tags | index("buildcache")) | .updated_at'
gh api repos/{owner}/{repo}/actions/cache/usage
```

The first command prints when a leg last wrote its tag. Name `api` or `backup` for the others. A probe that read the cache logs `importing cache manifest from ghcr.io/<owner>/<tier>:buildcache`, then `CACHED` against each reused layer. The second command reads the Actions cache, which still holds the pnpm store, uv's cache, and the detector's weights for `check.yml`.

## Deleting old cache manifests

`.github/workflows/ghcr-cleanup.yml` runs `scripts/ghcr-cleanup.mjs` at 06:43 UTC every Sunday, after the nightly mutation run (02:17, about two and a half hours) and the scan (03:41), which draw on the same hourly API allowance. It reads the packages of the tiers in `build.yml`'s image matrix, as `scan.yml` does.

It deletes a version only when all four hold:

- The version has no tag.
- Its manifest, read by digest and checked against that digest, is an OCI image manifest with the config `application/vnd.buildkit.cacheconfig.v0`, and names no subject.
- It is more than 7 days old, by the later of its created and updated times.
- It is not one of the package's three newest cache manifests, counting the one `buildcache` names.

So it never deletes:

- A tagged version: a `sha-` image, which `release.yml` and `scan.yml` read, a `sha256-` attestation index, or the manifest `buildcache` names.
- An untagged attestation manifest, with the config `application/vnd.oci.empty.v1+json`. Each image's `sha256-<digest>` index names one, and deleting it would lose that image's provenance.
- An untagged image, left when a tag moved off it.
- A manifest it cannot read, or whose body does not hash to its digest. The summary counts these.

Before deleting, it lists the package again and drops any version that gained a tag or changed. It deletes oldest first, with a two-second pause before each delete. It stops at 400 deletes, or when fewer than 200 requests are left in the token's hour, and the next week's run takes the rest.

The job summary gives each package's versions seen, selected, and deleted, and why each kept version was kept. The packages API gives no sizes, so the summary's bytes freed counts the blobs a deleted manifest names that no kept cache names. That is a ceiling, because an image can share a blob with a cache.

**Deleting takes the Admin role.** `GITHUB_TOKEN` with `packages: write` deletes a version only when the repository holds the Admin role on the package. GitHub gives that role to the repository whose workflow first published the package, and `build.yml` first published all three on 03/09/2026. If GitHub refuses a delete (HTTP 403), the job fails and names the package and the setting. To fix it, give this repository the Admin role under *Manage Actions access* in the package's settings.

**A dry run.** In Actions, open *ghcr-cleanup* and run it on `main`. The `dry-run` box is ticked by default. From a terminal, run:

```
gh workflow run ghcr-cleanup.yml --ref main -f dry-run=true
```

A dry run lists, reads, and selects as the scheduled run does, sends no delete, and its summary says what would go. It cannot show whether a delete would be refused. Only the schedule, or a dispatch with `dry-run` unticked, deletes.
