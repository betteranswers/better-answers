# The build cache

Nothing deployed builds an image. `release.yml` promotes digests that a runner built, and tags each promotion `release/*`. There are two build caches:

- A development machine's cache, bounded by a garbage-collection policy that the builder reads at startup.
- The runner's cache, a tag in each image's package on GHCR.

## Where the policy lives

Docker Desktop writes the policy to `~/.docker/daemon.json`, under `builder.gc`. Edit it in **Settings**, under **Docker Engine**. Both builders on a development machine use the `docker` driver, so their BuildKit is the daemon's own and reads only `daemon.json`. A `buildkitd.toml` applies only to a `docker-container` builder, and there is none.

## How the daemon reads a filter

Every broken policy breaks one of these four rules:

1. **The daemon splits a filter element at its first `=`, and nowhere else.** A comma does not separate predicates. `"type=a,type=b"` is one key, `type`, with the value `a,type=b`.
2. **The daemon rewrites each predicate for BuildKit as the key, `==`, and the value.** So `daemon.json` takes one `=` where `buildkitd.toml` takes two.
3. **BuildKit accepts `==`, `!=`, and `~=`.** Any other operator is an `unsupported operator` error. That includes a bare `=` that rule 1 left in a value.
4. **The daemon runs the whole policy in one call, and the first rule that fails to parse ends the call.** No later rule runs.

Put one predicate in each array element, and use a different key for each predicate in a rule. A repeated key fails at startup with `filters expect only one value`. Different keys combine with AND, so one rule names one cache type, and a sweep of three types takes three rules. `daemon.json` cannot express "type A or type B" in one rule.

Age is a filter: `unused-for=48h`. `buildkitd.toml` has a `keepDuration` key, but `daemon.json` has none and drops it without an error. `docker buildx inspect` then prints no `Keep Duration` line.

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
| `reservedSpace` | The rule runs when the cache is above this size, and the sweep stops below it. |
| `maxUsedSpace` | The size that a sweep brings the cache under. |
| `minFreeSpace` | The disk space to leave free. This policy does not set it. |

After a sweep, the cache is between 10 GB and 25 GB. A reading of 15 GB means the policy works. Read the size with `docker buildx du`, or with `docker system df` for a one-row total.

Instead of `policy`, you can set `defaultReservedSpace`, `defaultMaxUsedSpace`, and `defaultMinFreeSpace` under `builder.gc`. Those keys take no filters, so there is nothing to malform. On Engine 29.6.0 and later, the daemon builds a correct default policy for the three cache types from them.

## Prove the policy parses

A malformed policy collects nothing and shows no other sign. `docker buildx inspect` prints the rules without parsing them. After each edit to the policy:

1. Inspect the builder:

	```
	docker buildx inspect desktop-linux
	```

2. Check that each rule's `Filters` line shows one predicate and no comma.
3. Check that each rule with an age shows a `Keep Duration`.
4. Wait for at least two GC ticks. Then search the VM's log:

	```
	grep "gc error" ~/Library/Containers/com.docker.docker/Data/log/vm/init.log
	```

5. Check that the search prints nothing. A policy that fails to parse logs one line on each tick:

	```
	gc error: filters: parse error: […]: unsupported operator "=": invalid argument
	```

## On a `docker-container` builder

You do not need a `docker-container` builder to set a ceiling. On Engine 29.7.2, `daemon.json` applies `maxUsedSpace` both per rule and as a default.

If you add one, select it with `--builder` on each build that needs it. A build on a selected container builder leaves nothing in the local image store unless you pass `--load`. The image-contents suites, `apps/api/tests/images/image-probe.ts` and `apps/worker/tests/test_image.py`, pass `--load` only on a runner, where they read the runner's cache. On a laptop, they run `docker build --quiet` and start a container from the image id that it prints.

## The runner's cache

The runner's cache is one tag, `buildcache`, in each image's GHCR package:

- `ghcr.io/<owner>/api:buildcache`
- `ghcr.io/<owner>/worker:buildcache`
- `ghcr.io/<owner>/backup:buildcache`

### Who writes the tag

`build.yml`'s `image` job writes the tag from each leg's one build. Each leg writes only its own image's tag. The export uses two options:

- `mode=max` keeps the layers of the builder stages as well as the final stage.
- `image-manifest=true` makes each write one OCI manifest with the config `application/vnd.buildkit.cacheconfig.v0`.

Only a run on `refs/heads/main` writes the tag. On every other ref, including a dispatched branch, `cache-to` is empty and the build only reads. A dispatched branch runs its own copy of `build.yml`, so this rule stops an accidental write, not a deliberate one.

A failed export only warns, so a cache that the registry refused does not stop the build.

### Why the cache is in the registry

The `image` job holds `packages: write`, `id-token: write`, and `attestations: write`, and ships what it restores. Any workflow on `main` can write an Actions cache entry, because the cache service takes the runner's own token, not `GITHUB_TOKEN`, and no `permissions:` block limits it. So the `image` job restores no Actions cache. zizmor's `cache-poisoning` audit enforces this.

A registry tag moves only for a token that holds `packages: write` on the package. Two jobs hold one: the `image` job and the weekly cleanup. The cleanup pushes nothing.

### Who reads the tag

The readers are the image-contents suites in `check.yml`'s `full-images` leg:

- `apps/api/tests/images/image-probe.ts` builds `api` and `backup`.
- `apps/worker/tests/test_image.py` builds `worker`.

Each suite passes `--cache-from` and no `--cache-to`, and holds its build argv as a literal. The leg holds only `packages: read`. It logs in to ghcr.io with its own `GITHUB_TOKEN`, because the packages are private, and passes the registry to the suites as `IMAGE_CACHE_REGISTRY`. On a laptop, `IMAGE_CACHE_REGISTRY` is unset and the suites build with the daemon.

A registry tag has no ref scope. If a pull request could write the tag, it would decide which layers `main`'s next build reads and ships. Read-only probes prevent that. The cost is that each pull request run rebuilds every layer it changes.

### Reading needs the container builder

The `docker` driver reads a registry cache only when the daemon stores its images in containerd, and the runner's daemon does not. So `full-images` runs `docker/setup-buildx-action` to get a container builder. When `docker buildx inspect` reports the `docker` driver, or `IMAGE_CACHE_REGISTRY` is unset, both suites skip the cache and run `docker build --quiet`.

### An unreadable cache only warns

When the build cannot read the cache, it logs `importing cache manifest from …` with the error below that line, and builds without the cache. The leg stays green if it loses the builder, the login, or `IMAGE_CACHE_REGISTRY`. No test ties those steps to that leg. The only sign is a longer run time.

### The worker's source is the last `COPY`

BuildKit reruns every instruction below the first one whose input changed, and a rerun `COPY` makes a new blob even when the bytes are the same. In `apps/worker/Dockerfile`, `COPY src src` is the runtime stage's last copy, below the venv, the weights, and the suffix list. So an edit outside `redaction/` remakes only the source layer. An edit inside `redaction/`, which holds the pins, still fetches the weights again. `apps/worker/tests/test_image.py` checks this order.

### Two commits can write one tag at once

`build.yml`'s concurrency group is per commit, so runs for two commits on `main` can export to the same tag at the same time. The last write wins. Either cache is safe to read, because BuildKit keys each layer by its inputs and rebuilds any layer whose inputs differ.

### An overwritten cache stays in the package

When `buildcache` moves, the old manifest stays as an untagged version, with its layers, until the weekly cleanup deletes it. Each build adds an image, the attestation's two manifests, and a cache. GitHub does not charge for container registry storage. The old versions make the version lists longer. They do not affect a reader, because `scan.yml` picks a version by its `sha-` tag and `release.yml` resolves a `sha-` tag directly.

## Check the runner's caches

1. To see when a leg last wrote its tag, run:

	```
	gh api --paginate 'orgs/{owner}/packages/container/worker/versions?per_page=100' \
	  --jq '.[] | select(.metadata.container.tags | index("buildcache")) | .updated_at'
	```

	Replace `worker` with `api` or `backup` to check the other packages.

2. To see the Actions cache, run:

	```
	gh api repos/{owner}/{repo}/actions/cache/usage
	```

	The Actions cache holds the pnpm store, uv's cache, and the redaction detector's weights for `check.yml`.

3. To confirm that a probe read the cache, search its log for `importing cache manifest from ghcr.io/<owner>/<tier>:buildcache`. Each reused layer shows `CACHED`.

## Deleting old cache manifests

`.github/workflows/ghcr-cleanup.yml` runs `scripts/ghcr-cleanup.mjs` at 06:43 UTC every Sunday. The nightly mutation run starts at 02:17 UTC and takes about two and a half hours, and the scan starts at 03:41 UTC. Both use the same hourly API allowance, so the cleanup starts after them. The cleanup reads the package of each tier in `build.yml`'s `image` matrix.

The cleanup deletes a version only when all four of these conditions are true:

- The version has no tag.
- Its manifest, read by digest and checked against that digest, is an OCI image manifest with the config `application/vnd.buildkit.cacheconfig.v0`, and names no subject.
- It is more than 7 days old, measured from the later of its created and updated times.
- It is not one of the package's three newest cache manifests. The manifest that `buildcache` names counts as one of the three.

So the cleanup never deletes these versions:

- A tagged version. That is a `sha-` image, which `release.yml` and `scan.yml` read, a `sha256-` attestation index, or the manifest that `buildcache` names.
- An untagged attestation manifest, with the config `application/vnd.oci.empty.v1+json`. Each image's `sha256-<digest>` index names one, and its deletion would lose that image's provenance.
- An untagged image, left when a tag moved off it.
- A manifest that it cannot read, or whose body does not hash to its digest. The summary counts these.

Before it deletes, the cleanup lists the package again and drops each selected version that gained a tag or changed. It deletes the oldest version first and pauses for two seconds before each delete. It stops after 400 deletes, or when fewer than 200 requests remain in the token's hourly allowance. The next week's run deletes the rest.

For each package, the job summary gives the number of versions seen, selected, and deleted, and the reason each kept version was kept. The packages API reports no sizes. The summary's "bytes freed" adds up the blobs that a deleted manifest names and that no kept cache names. That figure is a ceiling, because an image can share a blob with a cache.

## Run the cleanup as a dry run

A dry run lists, reads, and selects versions as the scheduled run does, but sends no delete. Its summary lists what a real run would delete. A dry run cannot show whether GitHub would refuse a delete. Only the schedule, or a dispatch with `dry-run` cleared, deletes.

To start a dry run in Actions, open **ghcr-cleanup** and run it on `main`. The **dry-run** box is selected by default.

To start a dry run from a terminal, run:

```
gh workflow run ghcr-cleanup.yml --ref main -f dry-run=true
```

## Fix a refused delete

The cleanup's `GITHUB_TOKEN` holds `packages: write`. That token deletes a version only when the repository holds the Admin role on the package. GitHub gives that role to the repository whose workflow first published the package, and `build.yml` first published all three. If GitHub refuses a delete with HTTP 403, the job fails and names the package and the setting.

To fix a refused delete:

1. Open the package's settings.
2. If the package inherits its access from the repository, turn that off.
3. Under **Manage Actions access**, give this repository the Admin role.
