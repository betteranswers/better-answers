# Continuous integration

This page is the design reference for `.github/workflows/`, read from the repository beside `BUILD_CACHE.md`, not the docs site. A workflow comment carries only the why its own line needs. When a comment and this page disagree, the workflow is right. The root `pnpm check` is the one list of gates, run on a laptop. The workflows decide **where** each gate runs.

| Workflow | Runs | What it does |
| --- | --- | --- |
| `check.yml` | On every pull request, and when `build.yml` calls it | Decides whether a tree is green |
| `build.yml` | On `main` | Builds and pushes the tier images |
| `release.yml` | After a green build, nightly, or by hand, as the repository variable `RELEASE_MODE` says | Promotes a pair of digests to production |
| `mutation.yml` | Nightly | Scores the two mutable workspaces |
| `budgets.yml` | Nightly | Runs `packages/core`'s performance budgets |
| `scan.yml` | Nightly | Reads the images `build.yml` pushed for known vulnerabilities. It gates nothing |
| `ghcr-cleanup.yml` | Weekly | Deletes old BuildKit cache manifests from the image packages. Its design is in `BUILD_CACHE.md` |

## Every `uses:` names a commit SHA

Every `uses:` names a commit SHA, with its tag as a comment, because a tag can move and these workflows hold a token that pushes our images. Renovate rewrites the tag, and the SHA runs. Each action has one pin across the directory. `renovate.json` keeps the pins through `pinDigests` on the `github-actions` manager, and zizmor's `unpinned-uses` audit refuses anything else.

- Every `runs-on:` names `ubuntu-26.04`, not `ubuntu-latest`, which GitHub migrates on a date of its own. A move to a new release is one edit, with a full green run before `main` sees it. `.github/actionlint.yaml` names `ubuntu-26.04`, because actionlint's list of hosted runners predates it.
- Every `setup-uv` reads its version from `apps/worker/.tool-versions` through `version-file:`. Unpinned, the action took uv 0.12.17 against the worker image's 0.12.9. The file says why it is used in place of `[tool.uv] required-version`, and what keeps it in step with the image.

## The linters

`pnpm lint:workflows` is a step of the root `check:gates`, so it runs in `full-root` and before every push. It runs three tools from the worker's locked dev group, which Renovate's `pep621` manager updates.

- actionlint, over every workflow, with `.github/actionlint.yaml`. It runs shellcheck over each `run:` step.
- zizmor, over `.github/`, offline, with `.github/zizmor.yml` named on the command line, because from a linked worktree its own search finds the main checkout's config.
- shellcheck, over every `.sh` file under `deploy/`, `.claude/hooks/`, and `scripts/`, following each `source`.

A finding is fixed, or allowed in place with its reason. Four are allowed.

| Finding | Where | Why |
| --- | --- | --- |
| `self-repository` | Off in `.github/zizmor.yml` | It asks for GitHub's `$/` form of a local action or workflow, which actionlint refuses |
| actionlint's refusal of `queue` under `concurrency` | Ignored in `.github/actionlint.yaml` | GitHub documents the key, and `release.yml` needs it. actionlint does not know it yet |
| A checkout that keeps its credential | `release.yml`'s record job | It pushes the release tag with it, and installs nothing and runs no browser. Every other checkout sets `persist-credentials: false`. The public repository needs no credential for the lane job's fetch |
| A write to `GITHUB_PATH` | The `git-filter-repo` action | It writes uv's own tool directory, never an input |

`build.yml`'s image job restores no toolchain cache, because any run can write a cache entry and this job holds the token that pushes images. Its layer cache is in the registry for the same reason (`BUILD_CACHE.md`, *The runner's cache*). The worker's probe installs only the `probe` dependency group, pytest and four packages, because its suite reads the image through Docker.

`packages/devtools/test/root-config/lint-workflows.test.ts` runs each tool as the root script does, over throwaway repositories, and shows where each refuses and where it stays silent.

## The lanes

The `lane` job puts each run in a lane before any leg installs anything. Pull requests and the runs `build.yml` calls on `main` take the same lanes.

| Lane | When | What runs |
| --- | --- | --- |
| docs | every changed path ends `.md` | `docs-gates` alone: the root `check:docs` |
| full | anything else | `full-root`, `full-core`, `full-api`, `full-web-unit`, `full-web-browser` (two shards), `full-worker`, `full-images` |

### The base is per event

- A pull request diffs from its `base.sha`.
- A run that `build.yml` calls diffs from the caller's `before`, because a called workflow's `github` context is the caller's. `workflow_call` is named beside `push`, because GitHub does not say which a called run reads as `github.event_name`.
- A dispatch, the all-zero `before` of a first push, or a base this clone cannot fetch takes the full lane and probes the images, because a wrong full lane costs only minutes.

### The docs lane's rule

`scripts/docs-lane.mjs` decides from the paths alone, with `endsWith(".md")` and nothing looser, so `.mdx`, `notes.md.ts`, and a path with `.md` in the middle are not docs. Under `--no-renames` a rename is two paths, so a markdown file renamed to a `.ts` stays `full`. Prose mixed with code takes the full lane. `packages/devtools/test/ci/docs-lane.test.ts` holds each case.

### The image probes run when an image's inputs change

`build.yml` probes every image again before it pushes, so on the full lane the `full-images` suites that build and read the images stand down (`IMAGE_PROBE_DEFERRED=true`) unless a changed path is an image input. The compose scripts' tests and the stop test, which read no image, still run. The inputs are what the three Dockerfiles copy to install, not the source they copy:

- every `package.json`, both lockfiles, `pnpm-workspace.yaml`, `tsconfig.base.json`, `patches/`, and the api's `lifts/`
- the worker's redaction module, which the build runs to fetch the detector's weights
- the Dockerfiles, their ignore files, and the toolchain pins: `.node-version`, and the worker's `.tool-versions` and `.python-version`
- all of `deploy/`, the backup image's context
- the probes, and the two workflows that build and run them

`packages/devtools/test/ci/docs-lane.test.ts` checks every `COPY` in the three Dockerfiles against the list, so a new `COPY` is an input or is named there as source. An image that a source change broke is caught by `build.yml` after the merge, which with no live users costs a fix-forward. A caller that passes `images-probed-by-the-caller: true` defers the probes whatever changed, because it runs them itself.

## The legs and the verdict

### The leg names carry their lane

A `full-<something>` job runs on the full lane, and a `docs-<something>` job on the docs lane. The `check` job at the foot of `check.yml` requires every leg with this run's lane prefix to succeed and every other leg to be skipped, and refuses a run that required no leg. So a copied leg is already under the verdict, and a leg whose condition stops matching its name turns `check` red. GitHub gives the `full-web-browser` matrix one entry in `needs`, `success` only when every shard succeeded. `packages/devtools/test/ci/docs-lane.test.ts` runs the verdict over each lane's outcomes, and holds its `needs` to every job in the file.

The branch ruleset requires the status context `check`, and `build.yml`'s `image` job waits on `needs: check`. Legs can be renamed, split, or added. The `check` job's name cannot change.

`pr-title` belongs to no lane and runs on pull requests only. It runs commitlint with `commitlint.config.mjs` over the title, which becomes the squash commit's subject, read from the API so a re-run after a retitle sees the new one. It installs nothing, and runs commitlint through `pnpm dlx` at the versions the root `package.json` pins for `@commitlint/cli` and `@commitlint/config-conventional`. The verdict requires its success on a pull request and its skip otherwise.

### The legs

The legs are separate jobs, so a full run costs its longest leg, and each leg installs only its own toolchain.

| Leg | Runs | Brings |
| --- | --- | --- |
| `full-root` | `check:root` (`check:tree` less core's suite): the root gates over the whole tree, `packages/schema` and `packages/devtools` whole, and `packages/core`'s typecheck | uv, for `packages/devtools`' ruff and mypy |
| `full-core` | `check:core:suite`, in one job, because core is off `check`'s critical path | uv, the detector's weights, and the rewrite tool, for the suites that spawn the worker or rewrite a history |
| `full-api` | The api's gates, less `tests/images/` | uv and the worker's environment, for the index job its suite runs, and the rewrite tool, for the erasure rehearsal |
| `full-web-unit` | `check:web:unit`, the SPA's typecheck and vitest suite | |
| `full-web-browser` | `check:web:e2e --shard=<i>/<n>`, on a matrix of two jobs | |
| `full-worker` | `pnpm check:worker` | uv and the detector's weights, with `cache: pnpm`. No browser |
| `full-images` | `check:images` | The container builder and a read-only login to ghcr.io, for the reasons `BUILD_CACHE.md` gives, and both toolchains |

`full-root` is CI's only fresh clone, so only it can test that install puts the hook in place.

**`full-web-browser`.** One job would be `check`'s slowest leg. Playwright deals tests, not files, to the two shards, because the suite is fully parallel. Each shard builds the SPA, starts its own api and Postgres, and runs three workers, leaving one of four cores for the api, Postgres, and the browser. Each shard always uploads `apps/web/test-results/` as `browser-traces-shard-<i>-attempt-<n>`, kept seven days. On CI a failed test is retried once with a trace, so a green run with a flake uploads one, and the job summary's flaky table gives its path. The accessibility gate's must-fail specs leave a few kilobytes in every upload.

**`full-worker`.** pnpm verifies the tree before it runs a script, so `pnpm check:worker` installs all 665 packages first, 12 seconds cold, and the leg takes `cache: pnpm`. Removing that install means changing how the root manifest spawns this gate. The leg sets `COCOINDEX_DISABLE_USAGE_TRACKING`, because the indexing engine calls home on every update and the image's own refusal does not apply outside a container.

The suite runs on four pytest-xdist workers, one per vCPU, beside ruff and mypy. `apps/worker/src/better_answers_worker/check.py` holds both choices, not pytest's `addopts`, so a one-file run by hand starts no workers. The workers share one Postgres, started with `deploy/test-postgres.sh up` and named by `TEST_POSTGRES_URI=shared` (`local-gates.md`, *The shared test Postgres*). The first worker to need it migrates a template, and each test clones its own database from it. `check.py` deselects the `image` marker, and `uv run --frozen images` selects it.

**`full-images`.** It runs the api's `tests/images/` (the api and backup images' contents, the compose scripts, the restore, and the stop) and the worker's `tests/test_image.py`. The api's `vitest.config.ts` excludes the folder and `vitest.images.config.ts` selects it. The worker's `check` deselects the `image` marker. Only this leg receives `IMAGE_PROBE_DEFERRED` and `IMAGE_CACHE_REGISTRY`. No other `check` runs these suites. Run `pnpm check:images` for them.

### Two vitest settings

- Under `GITHUB_ACTIONS`, every workspace's vitest config sets `slowTestThreshold` to `Infinity` through `packages/schema/test/support/ci/slow-test-threshold.ts`, so a leg's log lists no slow tests one by one.
- `packages/core`, `apps/api`, and `apps/web` set `isolate: false`, so the test files one vitest worker runs share their modules. `packages/schema` and `packages/devtools` keep vitest's isolation.

## The docs lane

`check:docs` runs the suites that read the repository's **documents**, through the root `check`'s runner, so one command names every failed step. `format:check` leads it, as it leads the root `check`, and does nothing here, because `.oxfmtrc.json` ignores `**/*.md`. The lane keeps gates because a docs-only commit can break one. It installs no uv, browser, rewrite tool, or builder.

The lane has two known costs.

- `apps/api` and `packages/core` start a Postgres container from their vitest `globalSetup` whichever files are selected. The fix belongs in those configurations, not the workflow.
- Five suites coupled to a markdown file run only on the full lane. Four read a committed redaction fixture. The fifth is the worker's half of the contract count, whose other half runs here without a uv environment.

## The concurrency groups

| Run | A newer run in the same group |
| --- | --- |
| `check.yml` on a pull request | Cancels it |
| `check.yml` called by `build.yml` | Never cancels it |
| `build.yml` | Never cancels it |
| `release.yml` | Queues behind it, in the one group `release-production` |

`check.yml` decides both cases by whether this is a pull request, because every commit that lands needs its image. A group holds one running and one pending job whatever `cancel-in-progress` says, and a third arrival cancels the pending one, so `build.yml`'s group and a called run's group are per commit. A called workflow's group must differ from its caller's, or it waits on itself.

`release-production` sets `queue: max`, which keeps up to 100 runs pending in arrival order, because a cancelled release would end its build cancelled, not skipped. Each release checks for itself whether it is the newest. `.github/actionlint.yaml` ignores actionlint's refusal of the `queue` key, and `packages/devtools/test/root-config/lint-workflows.test.ts` holds that actionlint still refuses any other unknown key there.

## `build.yml`

Each run's concurrency group is its own commit, and it writes one tag, that commit's `sha-<short>`. There is no `:main` tag, because with nothing serialising the runs it would end on whichever finished last. `release.yml` reads a commit's images by its `sha-` tag, and refuses when the commit has none yet.

### Three images, and the list is here

| Image | Dockerfile | Built in | Deployed by |
| --- | --- | --- | --- |
| `api` | `apps/api/Dockerfile` | The repository root, because the image carries the SPA's build | `deploy/platform.compose.yaml`, by digest. `release.yml` promotes it |
| `worker` | `apps/worker/Dockerfile` | That directory | `deploy/platform.compose.yaml`, by digest. `release.yml` promotes it |
| `backup` | `deploy/backup.Dockerfile` | `deploy/` | `deploy/stores.compose.yaml`, set on that resource by hand at the first deploy and whenever the image changes, because the stores stack is not the deploy unit |

Postgres is never built here. It is the official pgvector image, pinned by digest in `packages/schema/src/postgres-image.ts`.

### The `caches` job writes on `main` what `check.yml`'s legs read

A run restores cache entries only from its own ref and the default branch. So `full-core`, `full-api`, and `full-worker` restore the detector's weights with `actions/cache/restore`, and only the `caches` job saves them, with `actions/cache/save` under the same path and key. It checks with `lookup-only` and stops when `main` already holds the key. Otherwise it fetches through `better_answers_worker.redaction.weights.fetch`, as the worker image's build does. `apps/worker/tests/redaction/test_redaction_descriptors.py` holds the two workflows to one key.

The job also saves the pnpm store and uv's cache when `main` holds no entry for their lockfile. Nothing waits on it, and it is `continue-on-error`, so a failed Hub download never makes a built commit unreleasable by the nightly gate. It holds only `contents: read`, and the image job restores none of its entries.

### The `check` job grants what `check.yml`'s jobs ask for

GitHub reads every job of a called workflow before the run starts. A job that asks for a scope the caller did not grant fails the whole run as `startup_failure`, even when its `if:` would skip it, as `pr-title` would on a push. A job's `permissions:` replaces its workflow's block, so `check` grants `contents: read`, `pull-requests: read`, and `packages: read` for the two legs that read the layer cache. `packages/devtools/test/ci/workflow-permissions.test.ts` reads every job that calls a workflow. It fails a grant short of what the called workflow's block or one of its jobs asks for, a call to a workflow outside this directory, and a calling file that names no grant.

### The `image` job

The `image` job needs `check`, so a failed or cancelled `check` skips it.

**The two exports are one manifest.** The build runs once into the runner's daemon, the contents test probes it, and a second export to the registry reuses the builder's cache. Both exports name the same media types and refuse both attestations, or buildx would give the runner and the registry two digests for one build. The summary says what was tested and what was pushed. A mismatch turns `main` red after the push.

**Provenance is written by referrer**, keyed by the pushed digest, so the promoted digest, the deploy variable, names the manifest itself and not a wrapper. It is the leg's last step. A failure leaves the leg red with the image pushed, on purpose, so an unattested digest never looks like one something else pushed. `create-storage-record` is refused, because it needs a third scope and warns twice per leg without it.

**The probes are declared per leg.** Each matrix leg declares the command that reads its image and that command's toolchain, and every step is gated on the declaration. A fourth image joins by declaring a probe. A probe whose toolchain nothing installs fails its leg before the push.

**The layer cache is the `buildcache` tag in the image's own package.** The pushing step is its only writer, and only this job holds `packages: write`. `check.yml`'s probes read it under `packages: read` and export nothing. The cache export names neither image output, so the probed and pushed digests stay one manifest. A failed cache export only warns, because a red step after the push would skip the digest check and the attestation. `BUILD_CACHE.md`, *The runner's cache*, has the rest.

### The last job releases what this run pushed

On `main`, once every leg of the matrix has pushed, the `release` job calls `release.yml` with this run's commit, and `release.yml` decides by `RELEASE_MODE` whether to release it. Its condition names `needs.image.result == 'success'`, so one red image leg stops the release. It is a call, because zizmor refuses a `workflow_run` trigger, which gets the default branch's secrets whatever set it off. It grants exactly `contents: write` for the tag, `packages: read` for the digests, and `actions: read` for the gate to read `build.yml`'s runs.

The call passes the deploy token and the two edge credentials by name. They are `production` environment secrets, empty in this run, and a called job that names the environment reads one only when its caller passes the name, even with an empty value. `secrets: inherit` would hand every secret to every called job, and zizmor refuses it.

## `release.yml`

Nothing else deploys production. Three triggers start it:

- `build.yml`'s call after each green build on `main`, with that build's commit
- a schedule at 02:35 UTC
- a person's dispatch, for a rollback or to promote digests the person names

`RELEASE_MODE` says which may release (*The rhythm*). The `production` environment holds the deploy secrets, admits only `main`, and has no required reviewer.

### Three jobs, and one can write

| Job | What it does |
| --- | --- |
| `gate` | Decides whether this run promotes, and which commit |
| `promote` | Checks the backup on a nightly release, redeploys, runs the smoke, and names the tag. It has read access and no stored credential |
| `record` | Pushes the tag. It is the only job with `contents: write`, and it installs nothing and runs no browser |

`promote` hands `record` its head, so a commit that lands mid-release is never the one tagged.

### The gate

The `gate` job runs `deploy/release-gate.sh`, which first refuses an unknown `RELEASE_MODE`. It runs inside the concurrency group, so it decides after every earlier release finishes, and it deploys nothing.

For a called release:

- A commit that is still `main`'s head is released, with the digests its build pushed under its `sha-<short>` tag.
- A commit that is no longer the head is skipped, with a notice and a summary line, and the newer commit's green build releases instead. Production never moves back.
- When that newer build is red, nothing releases.
- When the API cannot say what `main`'s head is, the build turns red rather than risk an out-of-order release.

At night the gate walks `main`'s last 100 commits, newest first, and releases the first with a green `build.yml` run, unless a commit with a `release/*` tag comes first. It matches a tag by the seven commit characters that end its name. A refused night turns its run red, and nothing outside GitHub hears of it. `packages/devtools/test/ci/release-job.test.ts` runs the script over a stand-in `gh` for each mode and trigger.

### The digests

A dispatch with blank inputs releases `main`'s head, with the digests `build.yml` pushed under its `sha-<short>` tag, read back from ghcr.io. Staging is on demand and never stands, so there is no "digest staging runs" to default to. When the head has no image yet, or its build is red, the release refuses and names the commit, and never falls back to an older image. Wait for that build, dispatch `build` on `main`, or pass the digests, as the runbook's rollback does. A release moves no branch. Steps pass digests through `env:`, match each against `^sha256:[0-9a-f]{64}$` before anything is PATCHed, and never interpolate one into a shell line.

### Every call before the wait must answer 2xx

`deploy/release-redeploy.sh` refuses before any call when a credential is empty. It makes each call with `--max-redirs 0` and reads its status code back.

1. Reads the platform resource and its deployments. It stops before any write, naming the deployment, when one is `queued` or `in_progress`, because that deployment would ship these digests with no smoke and no tag. An unreadable list also stops it.
2. Sets the compose build command to the pull step, `docker compose pull --policy missing`, if it is not already.
3. PATCHes both digests, flagged build-time as well as runtime, so the pull reads them.
4. POSTs `/deploy` and reads the deployment's id. Coolify 4.3.13 answers a deploy behind a queued or running one with an id that names nothing, so `Deployment already queued for this commit.` stops the release, and the error says both digests are set.
5. Reads the status every 10 seconds until `finished`, for 30 minutes from the POST. `failed`, `cancelled-by-user`, or a timeout turns the step red, naming the deployment.

| Answer | Where | Result |
| --- | --- | --- |
| Anything but 2xx | A call before the wait | Stops the release. A 401 or 403 names the ability that call needs |
| 3xx | Any call | Stops the release, named as the edge's redirect to sign-in, a missing or expired Access credential |
| Anything but 2xx or 3xx, such as a 502 or no answer | A status read | Counts as one read, because the edge can blip during a long pull |

The deploy token needs Coolify's `read`, `write`, and `deploy` abilities. The `promote` job's 60-minute limit sits ten minutes above the two waits, which a test holds, so the script's own error is the one the run shows. `packages/devtools/test/ci/release-job.test.ts` runs the script against a stand-in orchestrator, over the whole sequence and each failure above.

### The pull runs before the stop

The orchestrator's compose deploy stops the running containers, then runs `docker compose up -d`, which pulls whatever is missing. A pull there once left production answering 502 for 16 minutes. The compose build command runs before the stop, in place of `docker compose build`, so the pull step puts both images on the box first. `--policy missing` skips images already there, so a re-release or a rollback to images on the box pulls nothing. A failed pull fails the deployment before the stop, and production keeps the previous release. This relies on Coolify 4.3.13's `deploy_docker_compose_buildpack` running the build command before the stop. Check that order again after a Coolify upgrade.

### The rhythm

`RELEASE_MODE` is a condition, not a date. The phases are ADR 0022's.

| Mode | What releases | Phase |
| --- | --- | --- |
| `per-merge` | Every green build on `main`. The default while the variable is unset | Until the first customer's bundle lands, while a release is minutes to undo |
| `nightly` | At 02:35 UTC the schedule promotes `main`'s newest green commit, once the box's own backup is fresh (*The nightly backup*) | Until go-live, no earlier than the end of v0.1, so a customer's data changes at most once a night, just after a verified backup |
| `drill` | Only a dispatch whose `rehearsed_by` names the drill report that just proved a restore, or a hotfix reason | From go-live |

Any other value fails closed, and every trigger refuses, naming the three. Outside `drill` a dispatch needs no reason, because it is the rollback. `RUNBOOK.md` page 6 is the procedure.

### The nightly backup

A nightly release must ride a backup taken just before it. CI cannot take one, because the orchestrator's API cannot run a command in a container, and SSH would put a new credential on the box. So the release runs after the box's own backup and refuses unless it is fresh.

| Time (UTC) | What runs |
| --- | --- |
| Five past each hour | The box's cron dumps the database |
| 02:00 | The box's cron copies the object and git stores |
| 02:17 | `mutation.yml` |
| 02:35 | `release.yml` |
| 03:00 | The monthly drill, on VPC 2 |
| 03:41 | `scan.yml` |

Each backup job pings the dead-man service only after its upload is verified. `deploy/backup-fresh.sh` reads the `pg-hourly` and `nightly` checks with the read-only key `HEALTHCHECKS_READ_KEY`. Each must be `up`, which a failed run clears. The dump must have pinged within 65 minutes, and the copies since the last 02:00 UTC. GitHub starts the schedule hours late, about 09:00 on 01/10/2026, and both limits hold wherever the start lands. A night whose copies ran late or failed deploys nothing and turns red. The script's output is the tag's `Rode on:` line. A read-only key sees no ping URL, so it cannot fake a backup.

### No signed-in run before go-live

The smoke reads `/health` and one unauthenticated document, so a release can pass it and refuse every sign-in. Until go-live, the browser suite proves each page before merge, and the smoke and uptime probe watch production. The signed-in production journeys ran here from 03/10/2026 to 19/10/2026 (BA-204). Git history keeps them for the go-live rebuild.

### The record

Every release that held is an **annotated `release/<UTC stamp>-<short commit>` tag**. Its message carries the date, a `By:` line (the person who dispatched it, or automatic), both digests, a `Rode on:` line, a `Commit:` line, and a `Run:` line. `Commit:` names the commit the digests were resolved from, and says per digest whether this head resolved it or a rollback passed it in.

`promote` names the tag and writes its message. The `record` job pushes it last, **only after the smoke passes** and `/health` again names the promoted api digest, so the newest tag is always the last release that held, which the runbook's rollback takes. A release whose smoke fails pushes no tag and says so in its summary. A dispatch of older digests still tags `promote`'s head, `main`'s head at the dispatch, and `Commit:` says the digests were passed in. After a rollback, that tag stops the nightly gate promoting the head again.

**Nothing in CI commits to a branch**, so the branch ruleset has no bypass list, and `contents: write` on the record job is the token's whole write permission. A tag ruleset on `release/*` restricts updates and deletions and leaves creation open, so nothing can move or delete a tag while it is on (`RUNBOOK.md` page 6, *The tag ruleset*). `deploy/RELEASES.md` holds the promotions up to 23/09/2026, and says how to list the tags since.

### The smoke waits for the build it promoted

Once `release-redeploy.sh` sees the deployment finish, the smoke runs `deploy/await-release.sh`. It polls `/health` for six minutes until it answers healthy **and** its `image` is the api digest this run resolved, because the old api answers healthy until its container is swapped, and fails naming both digests. A release whose api digest is already running, such as a worker-only rollback, passes on its first poll, because the worker's digest is not on `/health`. The smoke then reads the protected-resource document. `apps/api/tests/deploy/await-release.test.ts` runs the script against the api's own `/health`, served locally, and a stand-in that answers a deploy's sequence.

### About sixty a day, in `per-merge` mode

About sixty merges a day means up to sixty releases and tags, fewer when merges land mid-release. `nightly` makes one. The rollback reads only the newest tags, so their number costs nothing. Each release restarts `api`, because the orchestrator replaces a Compose resource's containers rather than rolling them. The product answers nothing for about 45 seconds between the old `api` stopping and the new one answering. On the Free plan the uptime probe alerts on one failed probe (`coolify.md`, *Ingress*), so with probes five minutes apart about one release in seven raises an alert. With no users, that costs nothing.

## `mutation.yml`

Nightly at 02:17 UTC on hosted runners, which have no minute cap on a public repository, so the summary can name what newly survived since the previous run. The job does not gate. A falling score is a Linear issue, and a red job means the run itself broke.

### Two legs, and what would bring a third back

The legs are `apps/api` and `packages/core`. A score means something only where the tests exercise the mutated code.

| Workspace | Why it has no leg | When it comes back |
| --- | --- | --- |
| `apps/web` | Its main test interface is a browser, which Stryker's Vitest runner cannot drive. Three jsdom files against a dozen components would leave a score of uncovered mutants | When a runner can drive the browser suite, or component tests cover the pages |
| `apps/worker` | Its mutatable source is a few dozen lines of configuration and logging, plus a schema view generated from the migration journal, so a mutmut score measures the generator | When the tier gets behaviour worth mutating. The settings stay in `apps/worker/pyproject.toml` |

### The baseline is the previous run's artifact

Each leg starts from the previous run's results, so an untouched mutant is not retested. Stryker writes its report only on a finish but its incremental file on a cancellation too, so each leg keeps the incremental file, merged from its shards and uploaded as `stryker-incremental-<leg>` for fourteen days.

`.github/actions/mutation-baseline` restores the newest such artifact a run on `main` uploaded before this run began. A dispatch on another branch takes the newer of `main`'s and that branch's own. It reads only this repository's own branches, because a fork can call its branch `main`, and ignores later uploads, so every job and re-run restores the same results. The baseline is an artifact because the Actions cache evicts its least recently used entry past 10 GB, and a nightly checkpoint was evicted within a day.

### Each leg runs as shards

A whole leg does not fit one job (*How long a night takes*). `scripts/mutation-shards.mjs` cuts each leg's `mutate` set into slices, and each slice is a job with its own ceiling, running Stryker with `--mutate` over it. The matrix sets 5 shards for `apps/api` and 20 for `packages/core`. `packages/devtools/test/ci/mutation-baseline.test.ts` holds the matrix, the summary, and the slices to one another.

Files are dealt heaviest first, each onto the lightest shard. A file's cost is its mutants' seconds of a worker in the previous run, fitted on 24/09/2026 at about 10 per ordinary mutant, 13 per static one, and 370 per timeout. A new file is priced by size at that run's seconds a byte. A leg with no previous run is dealt by size alone.

Each shard starts from the whole leg's results, and Stryker carries files outside `--mutate` forward, so the slicing need not be stable.

A file too heavy for one shard is named in `scripts/mutation-shards.mjs` with a number of pieces, cut by line into that many ranges, each its own shard ahead of the dealt ones. Cuts fall only between lines no mutant spans, read from Stryker's instrumenter, because Stryker mutates only what a range holds whole. The pieces share the file's previous cost, and the merge takes each mutant from the piece holding its first line.

### The merge

Each shard uploads its incremental file, and its report when it finished, as `stryker-shard-<leg>-<n>`, kept a day, whatever its outcome. The leg's `summary` job waits for every shard and takes each file from the shard that owned it.

- A shard that stopped keeps what it tested, so a forced run's gaps are never refilled with the results it was replacing.
- A cancelled shard merges like a finished one.
- A shard that went red before Stryker wrote anything hands back the results it restored.
- A shard that left nothing keeps its files' previous results.

The summary reports which shards finished, the score, the new survivors, and the runner-fault check. It uploads the merged results whenever the merge succeeded, even on a red runner fault, so the baseline expires only after fourteen days with no run reaching its restore.

A restore that cannot list or read the artifacts turns the run red rather than start from nothing and upload a poorer checkpoint. Runs on one branch take turns, because overlapping runs would start from one checkpoint and the later finisher would win, however little it tested. A re-run keeps its run id, so its uploads replace its first attempt's.

At most 6 shards run at once. The organisation's plan runs 20 jobs, and a `check.yml` run takes 12: its lane, docs-gates, pr-title, and check jobs, and eight leg jobs, with `full-web-browser` as two. `packages/devtools/test/ci/mutation-baseline.test.ts` counts those jobs from `check.yml`.

### The dispatch inputs

| Input | What it does |
| --- | --- |
| `ceiling-minutes` | Moves every shard's ceiling for one run, up to 350. A job that reaches the 360 minutes a hosted job is allowed is terminated, not cancelled, and the upload after a cancellation needs time to run |
| `shards` | Runs only the shards it names, as leg-number pairs such as `core-1,api-2`. The others skip every step and leave nothing, and the merge keeps their files' results from the run the restore read. It re-runs a failed shard, or the shards a change to the slicing moved |

To rebuild a lost baseline, dispatch on `main` with `ceiling-minutes` at 350, so the shard with the heaviest file finishes. The nights after start from what it left.

### How long a night takes

A night tests only what changed since the previous checkpoint. From 11/09 to 18/09/2026 each night finished both legs in four to fifteen minutes. A forced run tests every mutant. The forced run of every shard on 24/09/2026 measured these costs.

| Measure | `packages/core` | `apps/api` |
| --- | --- | --- |
| Seconds of a worker for an ordinary mutant | About 7.4 | About 19 |
| Static mutants | 2,910 | 681 |
| Timed-out mutants, at about six minutes of a worker each | 833 | 145 |
| A forced run on one job | Near 14 hours | Near 5 hours |

A static mutant runs as its module loads and re-runs every test file related to its file, but most die at the first failing file, so one costs nearer 55 seconds of a worker. Timed-out mutants are most of a forced run's time.

A single file sets a floor that no count of shards moves. `packages/core`'s `src/store/git/index.ts`, with some 180 timed-out mutants of 596, took over five hours on its own, and `src/store/map/index.ts` about two. Both are now split by concern. The git door is `door.ts`, `commit.ts`, `history.ts`, and `rewrite.ts` behind a 15-line `index.ts`. The map door is `generations.ts`, `walk.ts`, and `write.ts`. `scripts/mutation-shards.mjs` holds no line-range cut for either.

### Each leg's Stryker config names its own vitest config

Both legs' Stryker configs name `vitest.stryker.config.ts`, the workspace's vitest config without the `github-actions` reporter, so only the leg's `summary` job writes a step summary. Vitest adds that reporter when `GITHUB_ACTIONS` is `true`, and under Stryker it would append a "Vitest Test Report" per mutant and annotate killed mutants as errors. The workspaces' own suites keep it. `packages/core` and `apps/api` configs also set `isolate: true`, because Stryker runs every file in one worker and a static mutant is live only in a module evaluated after Stryker activates it.

### `packages/core` runs its own test order under Stryker

Its `vitest.stryker.config.ts` runs the file that failed the last run first, then the shortest. Vitest's own order runs the longest first, `test/sources/cross-tier-document.test.ts`, which spawns the worker and took 94 of the dry run's 179 seconds. Static mutants waited it out before the quick file that kills them, and many timed out. The order changes which file answers first, not the verdict, so a survivor is still the whole related suite's.

`ignoreStatic` stays off. Only the audit and refusal-word walks, which import every slice inside a test, reach 952 of core's static mutants. Under `ignoreStatic` those would run no test and fail the leg as a runner fault.

### Cancellation has to reach Stryker

A cancelled step signals only its entry process, and a shell waiting on a child forwards nothing. Behind `pnpm run mutation`, with a pnpm and an sh in between, Stryker never got the SIGINT on which it writes its partial report. The step `exec`s into pnpm's bin shim, which execs into node, so one process runs from the step down.

### A runner fault fails the leg

The summary exits non-zero, naming a runner fault first, when any merged mutant ran no test or the leg killed none, because such a report would read as a low score. It judges the merged checkpoint, reused rows included, so such rows keep the leg red until a run with `force` retests every mutant.

On 23 to 24/09/2026, vitest 5 matched a test name against its suite chain joined with ` > `, and the Stryker runner built the name with a space. No mutant's name filter selected a test, every mutant came back `Survived` with `testsCompleted: 0`, and the night hit its ceiling looking slow. The runner's patch under `patches/` builds the name as the running vitest does. `packages/devtools/test/mutation/vitest-runner-patch.test.ts` holds a mutant that only a test inside a `describe` reaches, so a vitest or runner bump that breaks the filter fails its pull request.

## `scan.yml`

Nightly at 03:41 UTC, after `mutation.yml` starts, and on dispatch. It reads the images `build.yml` pushed for known vulnerabilities and gates nothing, because a CVE published overnight is no reason for a merge to fail, and `build.yml`'s job is to push a probed digest. A reported vulnerability leaves the run green. A red run means the scan broke: the packages API refused the token, the scanner failed, or code scanning refused an upload.

### Which image

The scan reads each package's newest version with a `sha-` tag from the packages API, the image `build.yml` last pushed for the tier. `main`'s head is not scanned, because its build may still run or be red. The release tags hold no `backup` digest, which is set by hand, and scanning what production runs is a second target, not built. The version is chosen by tag, because every provenance push writes two newer manifests, one untagged and one tagged `sha256-<digest>`. The `buildcache` version has no `sha-` tag. Each leg scans by digest, so a push mid-run moves nothing, and its summary names the digest and the tag.

### The tier list is `build.yml`'s

The `tiers` job reads `build.yml`'s image matrix when the run starts, and gives each tier a leg. `fail-fast` is off, so one tier's broken scan cancels no other. A fourth image is scanned the first night after it ships.

### The scanner

The scanner is Trivy, through `aquasecurity/trivy-action`. In March 2026 an attacker force-pushed 76 of its 77 tags to a credential stealer (GHSA-69fq-xp46-6x23), so ignore the `github-actions-templates` skill's example, which pins `@master`. The first pin, v0.36.0, is an immutable release cut after the incident, with a signed tag and its commit on `master`. The `setup-trivy` action it calls is pinned by commit too. The step names Trivy's release, because the action's default trailed three of its security fixes, and Renovate's `github-actions` manager tracks that input as a release of `aquasecurity/trivy`. The database is fetched each night, because a database planted in the Actions cache would hide findings. The registry token is a Docker login, keyed by host, so it reaches ghcr.io alone and never `mirror.gcr.io`, where the scanner fetches its database first.

### Where a vulnerability shows

Each vulnerability a scan reports per package or binary path is a code scanning alert (**Security**, then **Code scanning**), so one CVE in openssl's three packages is three alerts. An alert is filed on the run's branch, `main` for the nightly run, under its tier's category: `image-api`, `image-worker`, or `image-backup`. It closes once a scan no longer finds it. The owner reads the list, and nothing else is told.

An alert is not a task, because most close through a change nobody here writes, such as a Renovate pull request moving a pinned base. A Linear issue is for a change the list shows an image owes, such as a pin to move or a package to drop, and names the alerts it expects to close.

### Triage of a vulnerability

A vulnerability is assessed for its package in its image, not for its CVE alone.

| Outcome | When | What happens |
| --- | --- | --- |
| A fix we can take | The alert's *Fixed Version* names one | The task above takes it, and the alert closes itself |
| No fix, and unreachable | The running service never takes the flawed path | Dismiss it as "won't fix", with a one-line reason saying what shows it |
| No fix, and reachable | The running service takes the flawed path | It stays open, named in `IMAGE_VULNERABILITIES.md` under *Held open* with its mitigation and the task that removes it |

A fix inside a binary someone else builds, such as `rclone` or `age`, counts as no fix until that binary's release, which Renovate proposes, carries it.

The service's calls, the image's entry points, and the advisory's conditions decide whether the flawed path is taken. Read the image directly.

1. Run `docker export` on the digest.
2. Read dpkg's status file for why a package is there.
3. Read each ELF file's `DT_NEEDED` for what links a library.
4. Read the file list for the binaries a flaw needs.

`IMAGE_VULNERABILITIES.md` keeps each package's assessment, so a new vulnerability in a package already there starts from it. A dismissal goes through the API, with a reason of at most 280 characters:

```sh
gh api -X PATCH 'repos/{owner}/{repo}/code-scanning/alerts/<number>' -f state=dismissed \
  -f dismissed_reason="won't fix" -f dismissed_comment='Unreachable (<task id>): <what shows it>'
```

A dismissal outlives every rebuild, even after a fixed version appears in the alert's text. So reading the list includes this query, which names each dismissed alert that the latest scan still reports with a fixed version, for a Debian package (filed under the image's own name) or a library a manifest pins. Reopen each with `-f state=open` and take it as a fix. A binary someone else builds is left out, because its fix arrives as a Renovate pull request, and the scan after that merge closes the alert.

```sh
gh api --paginate 'repos/{owner}/{repo}/code-scanning/alerts?state=dismissed&per_page=100' --jq '.[]
  | select(.fixed_at == null)
  | select(.most_recent_instance.location.path | test("^[^/]+/[^/]+$|package\\.json$|METADATA$"))
  | select(.most_recent_instance.message.text | test("Fixed Version: \\S"))
  | .number'
```

The method is the same at every severity. `IMAGE_VULNERABILITIES.md` says which severities have been through it.

### The alerts branch

After the scan legs, whatever their outcome, the `alerts` job writes `alerts.json` to the branch `security/alerts` as one parentless commit that replaces the previous one. It holds the run's URL, every open alert, and the alerts the query above names, each cut to its number, dates, severity, rule, category, path, message, dismissal comment, and URL. The weekly triage, a cloud Claude Code routine, reads it with `git fetch origin security/alerts`, because a cloud session's GitHub calls carry the Claude GitHub App's token, which cannot read code scanning. The job's token reads code scanning and writes the branch. The ruleset covers `main` alone, and a push made with a run's own token starts no workflow.

### Code scanning on the repository

The workflow changes no repository setting. If code scanning refuses the upload until it is turned on, turning it on is the owner's call, as the repository's admin.

## The `docker-hub-login` action

`.github/actions/docker-hub-login/` sends the Docker daemon's Docker Hub pulls through `mirror.gcr.io`, then logs the job in to Docker Hub for any image the mirror lacks. The suites' Postgres (`pgvector/pgvector`) and the images the api and worker legs build come from Docker Hub. The mirror counts against no Docker Hub limit. Logged-in legs share the account's 200 pulls an hour, which CI used up until legs failed (BA-314). An anonymous pull counts against the runner address's limit, which GitHub's runners share with every other anonymous puller.

Every leg that starts a container calls it: every `full-` leg in `check.yml` except `full-web-unit`, the image job in `build.yml`, the Stryker leg in `mutation.yml`, and the job in `budgets.yml`. It restarts the daemon, so it runs before `setup-buildx-action`, whose builder takes the same mirror in its `buildkitd-config-inline`. It reads the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, a read-only access token, which `build.yml` passes to `check.yml` by name. A run without them, such as a fork's, warns and pulls anonymously.

To rotate the token:

1. Make a new read-only access token on the Docker Hub account.
2. Run `gh secret set DOCKERHUB_TOKEN`.
3. Revoke the old token.

## The `git-filter-repo` action

`.github/actions/git-filter-repo/` installs the rewrite tool the erasure routine shells out to, which the runner image lacks. The erasure suite has no skip guard, on purpose. It is an action, not a step per workflow, because when the install lived only in `check.yml`, both mutation legs died on `git: 'filter-repo' is not a git command` and scored nothing for three nights.

**The version is read from `apps/api/Dockerfile`, not written in the action.** The runner and the api image must carry the same tested version, so the action reads the pin from the file that declares it, and refuses a Dockerfile with no such pin, or two. A job that runs the erasure suite without the action fails that suite, and the verdict job reads the failure.
