# Continuous integration

This page describes the workflows in `.github/workflows/` and the composite actions in `.github/actions/`. Read it in the repository, beside `BUILD_CACHE.md`. The docs site does not publish it. If this page and a workflow disagree, the workflow is right. A workflow comment explains only its own line.

The root `pnpm check` is the one list of gates, and it runs on a laptop. The workflows decide where each gate runs.

| Workflow | Runs | What it does |
| --- | --- | --- |
| `check.yml` | On every pull request, and when `build.yml` calls it | Decides whether a tree is green |
| `build.yml` | On a push to `main`, and on dispatch | Builds, probes, and pushes the three images, then calls `release.yml` |
| `release.yml` | When `build.yml` calls it, at 02:35 UTC, and on dispatch. `RELEASE_MODE` decides which of these can release | Promotes a pair of digests to production |
| `mutation.yml` | At 02:17 UTC, and on dispatch | Scores `apps/api` and `packages/core` with Stryker |
| `budgets.yml` | At 04:23 UTC, and on dispatch | Runs `packages/core`'s performance budgets |
| `scan.yml` | At 03:41 UTC, and on dispatch | Scans the images `build.yml` pushed for known vulnerabilities. It gates nothing |
| `ghcr-cleanup.yml` | Sundays at 06:43 UTC, and on dispatch | Deletes old BuildKit cache manifests from the image packages. `BUILD_CACHE.md` describes it |

## Every `uses:` names a commit SHA

Every `uses:` names a commit SHA, with its tag in a comment. A tag can move, and these workflows hold a token that pushes our images. Each action has one pin across the directory. Renovate updates the pins through `pinDigests` on its `github-actions` manager in `renovate.json`. zizmor's `unpinned-uses` audit, set to `hash-pin` in `.github/zizmor.yml`, refuses any other form.

- Every `runs-on:` names `ubuntu-26.04`, not `ubuntu-latest`, because GitHub moves `ubuntu-latest` to a new release on its own date. To move to a new release, change every `runs-on:` in one edit, and get a full green run before the change reaches `main`. `.github/actionlint.yaml` lists `ubuntu-26.04` as a runner label, because actionlint's list of hosted runners does not include it.
- Every `setup-uv` step reads its version from `apps/worker/.tool-versions` through `version-file:`. Without it, the action installs the newest uv, which is not the uv the worker image uses. That file says why it is used in place of `[tool.uv] required-version`, and what keeps it in step with the image.

## The linters

`pnpm lint:workflows` is a step of the root `check:gates`, so it runs in the `full-root` leg and before every push. It runs three tools from the worker's locked `dev` dependency group, which Renovate's `pep621` manager updates.

- actionlint runs over every workflow with `.github/actionlint.yaml`. It runs shellcheck over each `run:` step.
- zizmor runs offline over `.github/`, with `--config .github/zizmor.yml` on the command line. In a linked worktree, zizmor's own search finds the main checkout's config instead.
- shellcheck runs over every `.sh` file under `deploy/`, `.claude/hooks/`, and `scripts/`, and follows each `source`.

Fix each finding, or allow it in place with its reason. Four findings are allowed.

| Finding | Where | Why |
| --- | --- | --- |
| `self-repository` | Off in `.github/zizmor.yml` | It asks for GitHub's `$/` form of a local action or workflow, which actionlint refuses |
| actionlint's refusal of `queue` under `concurrency` | Ignored in `.github/actionlint.yaml` | GitHub documents the key, and `release.yml` needs it. actionlint does not know the key |
| A checkout that keeps its credential | `release.yml`'s `record` job | The job pushes the release tag with that credential. It installs nothing and runs no browser. Every other checkout sets `persist-credentials: false` |
| A write to `GITHUB_PATH` | The `git-filter-repo` action | It writes uv's own tool directory, never an input |

`packages/devtools/test/root-config/lint-workflows.test.ts` runs each tool as the root script does, over throwaway repositories. It shows where each tool refuses and where it stays silent. It also checks that actionlint still refuses any unknown key under `concurrency` other than `queue`.

## The lanes

The `lane` job in `check.yml` puts each run in a lane before any leg installs anything. Pull requests and the runs that `build.yml` calls on `main` use the same lanes.

| Lane | When | What runs |
| --- | --- | --- |
| docs | Every changed path ends in `.md` | `docs-gates` alone, which runs the root `check:docs` |
| full | Any other change | `full-root`, `full-core`, `full-api`, `full-web-unit`, `full-web-browser` (two shards), `full-worker`, and `full-images` |

### The base is per event

- A pull request diffs from its `base.sha`.
- A run that `build.yml` calls diffs from the caller's `before`, because a called workflow reads its caller's `github` context. The `lane` job accepts `workflow_call` as well as `push` as the event name, because GitHub does not document which one a called run reports.
- A dispatch, the all-zero `before` of a first push, or a base this clone cannot fetch takes the full lane and probes the images. A full lane by mistake costs only minutes.

The base is fetched one commit deep and without a credential. `git diff` between two trees needs no ancestry, and the repository is public.

### The docs lane's rule

`scripts/docs-lane.mjs` decides from the changed paths alone. A path is docs only if it passes `endsWith(".md")`. So `.mdx`, `notes.md.ts`, and a path with `.md` in the middle are not docs. The diff uses `--no-renames`, so a rename counts as two paths, and a markdown file renamed to `.ts` takes the full lane. A change that mixes prose and code takes the full lane. `packages/devtools/test/ci/docs-lane.test.ts` holds each case.

### The image probes run when an image's inputs change

`build.yml` probes every image again before it pushes. So on the full lane, the `full-images` suites that build and read the images stand down, with `IMAGE_PROBE_DEFERRED=true`, unless a changed path is an image input. The compose scripts' tests and the stop test read no image, so they still run.

The inputs are `IMAGE_INPUTS` in `scripts/docs-lane.mjs`, plus every `package.json`. They are what the three Dockerfiles copy to install, not the source they copy:

- every `package.json`, `apps/worker/pyproject.toml`, both lockfiles, `pnpm-workspace.yaml`, `tsconfig.base.json`, `patches/`, and `apps/api/lifts/`
- the worker's package `__init__.py` and its `redaction/` module, which the build runs to fetch the detector's weights
- the Dockerfiles, their `.dockerignore` files, and the toolchain pins: `.node-version`, `apps/worker/.tool-versions`, and `apps/worker/.python-version`
- all of `deploy/`, which is the backup image's build context
- the probes, and `build.yml` and `check.yml`, which build and run them

`packages/devtools/test/ci/docs-lane.test.ts` checks every `COPY` in the three Dockerfiles against this list. A new `COPY` must be an input, or be named in the test as source. If a source change breaks an image, `build.yml` catches it after the merge, and the fix goes forward.

A caller that passes `images-probed-by-the-caller: true` defers the probes whatever changed, because the caller runs them itself. `build.yml` passes it.

## The legs and the verdict

### The leg names carry their lane

A `full-<name>` job runs on the full lane, and a `docs-<name>` job runs on the docs lane. The `check` job at the end of `check.yml` is the verdict:

- Every leg whose name starts with this run's lane must succeed.
- Every other leg must be skipped.
- `pr-title` must succeed on a pull request and be skipped otherwise.
- A run that required no leg fails.

So a copied leg is already under the verdict, and a leg whose `if:` stops matching its name turns `check` red. GitHub reports the `full-web-browser` matrix as one entry in `needs`, which is `success` only when every shard succeeded. `packages/devtools/test/ci/docs-lane.test.ts` runs the verdict over each lane's outcomes, and checks that its `needs` lists every job in the file.

The branch ruleset requires the status context `check`, and `build.yml`'s `image` job has `needs: check`. You can rename, split, or add legs. Do not rename the `check` job.

`pr-title` belongs to no lane and runs on pull requests only. It runs commitlint with `commitlint.config.mjs` over the pull request's title, which becomes the squash commit's subject. It reads the title from the API, so a re-run after a retitle reads the new title. It installs nothing. It runs commitlint through `pnpm dlx`, at the versions the root `package.json` pins for `@commitlint/cli` and `@commitlint/config-conventional`.

### The legs

Each leg is a separate job, so a full run takes as long as its longest leg, and each leg installs only its own toolchain.

| Leg | Runs | Installs |
| --- | --- | --- |
| `full-root` | `check:root`: the root gates over the whole tree, `packages/schema` and `packages/devtools` whole, and `packages/core`'s typecheck. This is `check:tree` without core's suite | uv, for `packages/devtools`' ruff and mypy |
| `full-core` | `check:core:suite`, in one job, because core is not on `check`'s critical path | uv, the detector's weights, and the rewrite tool, for the suites that spawn the worker or rewrite a history |
| `full-api` | `check:api`, the api's gates. `tests/images/` is left out | uv and the worker's environment, for the index job its suite runs, and the rewrite tool, for the erasure rehearsal |
| `full-web-unit` | `check:web:unit`, the SPA's typecheck and vitest suite | Node and pnpm only |
| `full-web-browser` | `check:web:e2e --shard=<i>/<n>`, on a matrix of two jobs | Playwright's Chromium |
| `full-worker` | `pnpm check:worker` | uv and the detector's weights, with `cache: pnpm`. No browser |
| `full-images` | `check:images` | Both toolchains, the container builder, and a read-only login to ghcr.io, for the reasons `BUILD_CACHE.md` gives |

`full-root` also checks that `pnpm install` alone installs lefthook's `pre-commit` hook. It is the only leg that can, because it is CI's only fresh clone.

**`full-web-browser`.** Playwright deals tests, not files, to the two shards, because the suite is fully parallel. Each shard builds the SPA, starts its own api and Postgres, and runs three Playwright workers. That leaves one of the runner's four cores for the api, Postgres, and the browser. On CI, a failed test is retried once with a trace. Each shard uploads `apps/web/test-results/` as `browser-traces-shard-<i>-attempt-<n>` after every run, kept for seven days. So a green run with a flaky test still uploads its trace, and the job summary's flaky table gives the path. The accessibility gate's must-fail specs add a few kilobytes to every upload.

**`full-worker`.** pnpm verifies the tree before it runs a script, so `pnpm check:worker` installs every package first, and the leg uses `cache: pnpm`. To remove that install, change how the root manifest runs this gate. The leg sets `COCOINDEX_DISABLE_USAGE_TRACKING`, because the indexing engine reports usage on every update, and the image's own setting does not apply outside a container.

The worker suite runs on four pytest-xdist workers, one per vCPU, beside ruff and mypy. `apps/worker/src/better_answers_worker/check.py` sets the worker count, not pytest's `addopts`, so a one-file run by hand starts no workers. The workers share one Postgres. The leg starts it with `deploy/test-postgres.sh up` and names it with `TEST_POSTGRES_URI=shared` (`local-gates.md`, _The shared test Postgres_). The first worker that needs the database migrates a template, and each test clones its own database from it. `check.py` deselects the `image` marker, and `uv run --frozen images` selects it.

**`full-images`.** It runs the api's `tests/images/` and the worker's `tests/test_image.py`. The api suites cover the api and backup images' contents, the compose scripts, the restore, and the stop. The api's `vitest.config.ts` excludes `tests/images/`, and `vitest.images.config.ts` selects it. Only this leg receives `IMAGE_PROBE_DEFERRED` and `IMAGE_CACHE_REGISTRY`. No other leg runs these suites. To run them locally, run `pnpm check:images`.

### Two vitest settings

- Under `GITHUB_ACTIONS`, every workspace's vitest config sets `slowTestThreshold` to `Infinity` through `packages/schema/test/support/ci/slow-test-threshold.ts`, so a leg's log does not list slow tests one by one.
- `packages/core`, `apps/api`, and `apps/web` set `isolate: false`, so the test files that one vitest worker runs share their modules. `packages/schema` and `packages/devtools` keep vitest's isolation.

## The docs lane

`check:docs` runs the suites that read the repository's documents. It runs through the root `check`'s runner, so one command names every failed step. `format:check` runs first, as it does in the root `check`, and checks nothing here, because `.oxfmtrc.json` ignores `**/*.md`. The lane runs gates because a docs-only commit can break one. It installs no uv, browser, rewrite tool, or builder.

The lane has two known costs:

- `apps/api` and `packages/core` start a Postgres container from their vitest `globalSetup`, whichever files are selected. Fix this in those vitest configs, not in the workflow.
- Five suites that read a markdown file run only on the full lane. Four read a committed redaction fixture. The fifth is the worker's half of the contract count. Its other half runs on the docs lane without a uv environment.

## The concurrency groups

| Run | A newer run in the same group |
| --- | --- |
| `check.yml` on a pull request | Cancels it |
| `check.yml` called by `build.yml` | Never cancels it |
| `build.yml` | Never cancels it |
| `release.yml` | Queues behind it, in the one group `release-production` |

`check.yml` chooses by whether the run is a pull request, because every commit that lands needs its image. A group holds one running job and one pending job whatever `cancel-in-progress` says, and a third arrival cancels the pending one. So the groups of `build.yml` and of a called `check.yml` are per commit. A called workflow's group must differ from its caller's group, or the called run waits on itself.

`release-production` sets `queue: max`, which keeps up to 100 runs pending in arrival order. Without it, a release cancelled in the queue would leave its build cancelled, not skipped. Each release checks for itself whether it is the newest.

## `build.yml`

Each run's concurrency group is its own commit. Each run writes one tag per image, that commit's `sha-<short>`, where `<short>` is seven characters. There is no `:main` tag, because nothing serialises the runs, so it would point at whichever run finished last. `release.yml` reads a commit's images by its `sha-` tag, and refuses when the commit has none yet.

### Three images, and the list is here

| Image | Dockerfile | Build context | Deployed by |
| --- | --- | --- | --- |
| `api` | `apps/api/Dockerfile` | The repository root, because the image carries the SPA's build | `deploy/platform.compose.yaml`, by digest. `release.yml` promotes it |
| `worker` | `apps/worker/Dockerfile` | `apps/worker` | `deploy/platform.compose.yaml`, by digest. `release.yml` promotes it |
| `backup` | `deploy/backup.Dockerfile` | `deploy/` | `deploy/stores.compose.yaml`. Set it on that resource by hand at the first deploy and whenever the image changes, because the stores stack is not the deploy unit |

CI never builds Postgres. It is the official pgvector image, pinned by digest in `packages/schema/src/postgres-image.ts`.

### The `caches` job writes on `main` what `check.yml`'s legs read

A run restores cache entries only from its own ref and the default branch. So `full-core`, `full-api`, and `full-worker` restore the detector's weights with `actions/cache/restore`. Only the `caches` job saves them, with `actions/cache/save` under the same path and key. The job first checks with `lookup-only`, and does nothing for the weights when `main` already holds the key. Otherwise it fetches them through `better_answers_worker.redaction.weights.fetch`, as the worker image's build does. `apps/worker/tests/redaction/test_redaction_descriptors.py` checks that the two workflows use one key.

The job also saves the pnpm store and uv's cache when `main` holds no entry for their lockfile. No job waits on it, and it is `continue-on-error`, so a failed Hugging Face download never stops the nightly gate from releasing a built commit. It holds only `contents: read`, and the `image` job restores none of its entries.

### The `check` job grants what `check.yml`'s jobs ask for

GitHub reads every job of a called workflow before the run starts. A job that asks for a scope the caller did not grant fails the whole run as `startup_failure`, even when its `if:` would skip it, as `pr-title` would on a push. A job's `permissions:` replaces its workflow's block. So `build.yml`'s `check` job grants `contents: read`, `pull-requests: read`, and `packages: read`, the last for the legs that read the layer cache.

`packages/devtools/test/ci/workflow-permissions.test.ts` reads every job that calls a workflow. It fails on each of these:

- a grant short of what the called workflow, or one of its jobs, asks for
- a call to a workflow outside `.github/workflows/`
- a calling job that names no grant

### The `image` job

The `image` job has `needs: check`, so a failed or cancelled `check` skips it. It is a matrix with one leg per image, and `fail-fast` is off.

The job restores no toolchain cache, because any run can write a cache entry, and this job holds the token that pushes images. Its layer cache is in the registry for the same reason (`BUILD_CACHE.md`, _The runner's cache_). The worker's probe installs only the `probe` dependency group, which is pytest, because its suite reads the image through Docker.

**The image the probe read is the image pushed.** Each leg builds once, into the runner's daemon. The probe reads that image, and the next step pushes it with `docker push`. The daemon keeps its images in containerd, which pushes the manifest the build wrote byte for byte. The push step fails if the daemon does not use containerd. Do not push from a second build. BuildKit does not promise that a second build takes every layer from the first build's cache. It can rerun the worker's steps, which fetch the weights and the suffix list again, or read a `buildcache` that another run moved. Then the pushed digest is not the probed digest. The job summary names the digest the probe tested and the digest the registry returns for the pushed tag. If the two differ, the leg fails after the push and `main` turns red.

**The leg writes provenance as a referrer**, keyed by the pushed digest. So the promoted digest, which is the deploy variable, names the image manifest itself, not a wrapper. Provenance is the leg's last step. If it fails, the leg is red with the image already pushed. The red leg is deliberate, so that an unattested digest never looks like a digest something else pushed. `create-storage-record` is off, because it needs a third scope and warns twice per leg without it.

**Each leg declares its probe.** Each matrix entry declares the command that reads its image and that command's toolchain, `node` or `python`. Every step is gated on that declaration. To add a fourth image, add a matrix entry that declares a probe. If no step installs a probe's toolchain, the leg fails before the push.

**The layer cache is the `buildcache` tag in each image's own package.**

- The leg's one build is the only writer, and only this job holds `packages: write`.
- Only a run on `refs/heads/main` writes the tag. A run dispatched on a branch reads it, exports nothing, and rebuilds the layers that `main`'s cache does not cover. A branch run that wrote the tag would decide which layers `main`'s next build reads and ships.
- The rule lives in the workflow's own `cache-to`, which a branch's copy of `build.yml` can change. It stops an accident, not a deliberate write.
- `check.yml`'s probes read the tag under `packages: read` and export nothing.
- The build writes the cache before the probe runs, so a leg whose probe fails still leaves its layers. Each layer is keyed by its inputs, so a fix that changes those inputs builds past them.
- A failed cache export only warns, so a cache the registry refused never stops a built image from being probed and pushed.

`BUILD_CACHE.md`, _The runner's cache_, covers the rest.

### The last job releases what this run pushed

On `main`, once every leg of the matrix has pushed, the `release` job calls `release.yml` with this run's commit. `release.yml` then decides by `RELEASE_MODE` whether to release it. The job's condition includes `needs.image.result == 'success'`, so one red image leg stops the release.

The job is a `workflow_call`, not a `workflow_run` trigger. zizmor refuses `workflow_run`, because it gets the default branch's secrets whatever started it. The job grants exactly three scopes: `contents: write` for the tag, `packages: read` for the digests, and `actions: read` for the nightly gate to read `build.yml`'s runs.

The call passes `COOLIFY_DEPLOY_TOKEN`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET` by name. They are `production` environment secrets, so they are empty in this run. A called job that names the environment reads such a secret only when its caller passes the secret's name, even with an empty value. Do not use `secrets: inherit`. It hands every secret to every called job, and zizmor refuses it.

## `release.yml`

`release.yml` is the only thing that deploys production. Three triggers start it:

- `build.yml`'s call after each green build on `main`, with that build's commit
- a schedule at 02:35 UTC
- a person's dispatch, for a rollback or to promote digests the person names

`RELEASE_MODE` decides which triggers can release (_The rhythm_). The `production` environment holds the deploy secrets, admits only `main`, and has no required reviewer.

### Three jobs, and one can write

| Job | What it does |
| --- | --- |
| `gate` | Runs `deploy/release-gate.sh`, which decides whether this run promotes, and which commit |
| `promote` | On a nightly release, checks the backup. Then it redeploys, runs the smoke, and names the tag. It has read access and no stored credential |
| `record` | Pushes the tag. It is the only job with `contents: write`. It installs nothing and runs no browser |

`promote` passes its head commit to `record`, so a commit that lands during a release is never the one tagged.

### The gate

`deploy/release-gate.sh` first refuses an unknown `RELEASE_MODE`. The `gate` job runs inside the concurrency group, so it decides only after every earlier release has finished. It deploys nothing.

For a release that `build.yml` called:

- If the commit is still `main`'s head, the gate releases it, with the digests its build pushed under its `sha-<short>` tag.
- If the commit is no longer the head, the gate skips it with a notice and a summary line. The newer commit's green build releases instead, so production never moves back.
- If that newer build is red, nothing releases.
- If the API cannot say what `main`'s head is, the gate fails and the build turns red, rather than risk a release out of order.

For the nightly release, the gate walks `main`'s last 100 commits, newest first:

- If a commit has a `release/*` tag, the gate stops and releases nothing, because nothing newer than the last release is green. So the nightly release never moves production back either. The gate matches a tag by the seven commit characters that end its name.
- Otherwise it releases the first commit with a green `build.yml` run.
- If none of the 100 commits has a green build, or the gate cannot read the history, the runs, or the tags, the run turns red. Nothing outside GitHub reports a red night.

`packages/devtools/test/ci/release-job.test.ts` runs the script over a stand-in `gh` for each mode and trigger.

### The digests

A dispatch with blank `api_digest` and `worker_digest` releases `main`'s head, with the digests `build.yml` pushed under its `sha-<short>` tag, read back from ghcr.io. Staging runs only on demand, so there is no standing staging digest to default to. If the head has no image yet, or its build is red, the release refuses and names the commit. It never falls back to an older image. In that case, wait for the build, dispatch `build` on `main`, or pass the digests, as the runbook's rollback does.

A release moves no branch. Steps pass digests through `env:` and never interpolate one into a shell line. A step checks each digest against `^sha256:[0-9a-f]{64}$` before anything is PATCHed.

### Every call before the wait must answer 2xx

`deploy/release-redeploy.sh` refuses before any call if a credential is empty. It makes each call with `--max-redirs 0`, and reads back the status code. It makes these calls in order:

1. It reads the platform resource and its deployments. If one is `queued` or `in_progress`, it stops before any write and names the deployment, because that deployment would ship these digests with no smoke and no tag. If it cannot read the list, it also stops.
2. It sets the compose build command to the pull step, `docker compose pull --policy missing`, if the command is not set already.
3. It PATCHes both digests, flagged build-time as well as runtime, so the pull step reads them.
4. It POSTs `/deploy` and reads the deployment's id. Coolify 4.3.13 answers a deploy that arrives behind a queued or running one with an id that names nothing. So the answer `Deployment already queued for this commit.` stops the release, and the error says that both digests are set.
5. It reads the deployment's status every 10 seconds until `finished`, for up to 30 minutes from the POST. `failed`, `cancelled-by-user`, or a timeout turns the step red and names the deployment.

| Answer | Where | Result |
| --- | --- | --- |
| Anything but 2xx | A call before the wait | Stops the release. A 401 or 403 names the ability that call needs |
| 3xx | Any call | Stops the release. The error names it as the edge's redirect to sign-in, which means the Access credential is missing or expired |
| Anything but 2xx or 3xx, such as a 502 or no answer | A status read | Counts as one read, because the edge can fail briefly during a long pull |

The deploy token needs Coolify's `read`, `write`, and `deploy` abilities. The `promote` job's `timeout-minutes` is 60. A test holds it at least ten minutes longer than the redeploy's wait and the smoke's wait together, so the run shows the script's own error, not a job timeout. `packages/devtools/test/ci/release-job.test.ts` runs the script against a stand-in orchestrator, over the whole sequence and each failure above.

### The pull runs before the stop

The orchestrator's compose deploy stops the running containers, then runs `docker compose up -d`, which pulls any image that is missing. A pull at that point leaves production down, answering 502, for as long as the pull takes. The compose build command runs before the stop. So the release sets it to the pull step, in place of `docker compose build`, and both images are on the box before the stop.

- `--policy missing` skips images already on the box, so a re-release, or a rollback to images on the box, pulls nothing.
- A failed pull fails the deployment before the stop, and production keeps the previous release.

This depends on Coolify 4.3.13's `deploy_docker_compose_buildpack` running the build command before the stop. After a Coolify upgrade, check that order again.

### The rhythm

The repository variable `RELEASE_MODE` sets which triggers release. Change it when the product reaches the next phase, not on a date. If it is unset, the mode is `per-merge`. To set it, run `gh variable set RELEASE_MODE --body <mode>`.

| Mode | What releases | Use it |
| --- | --- | --- |
| `per-merge` | Every green build on `main`. The default while the variable is unset | Until the first customer's bundle lands, while a release takes minutes to undo |
| `nightly` | At 02:35 UTC, the schedule promotes `main`'s newest green commit, once the box's own backup is fresh (_The nightly backup_) | Until go-live, and not before the end of v0.1, so a customer's data changes at most once a night, just after a verified backup |
| `drill` | Only a dispatch whose `rehearsed_by` names the drill report that just proved a restore (`drills/drill-<stamp>.md`), or `hotfix: <reason>` | From go-live |

Any other value fails closed. Every trigger refuses and names the three modes. Outside `drill`, a dispatch needs no reason, because a dispatch is the rollback. A check in the workflow enforces the mode, not a sentence in a runbook. `RUNBOOK.md` page 6 is the procedure.

### The nightly backup

A nightly release must follow a backup taken just before it. CI cannot take one. The orchestrator's API cannot run a command in a container, and SSH would put a new credential on the box. So the release runs after the box's own backup, and refuses unless that backup is fresh.

| Time (UTC) | What runs |
| --- | --- |
| Five past each hour | The box's cron dumps the database |
| 02:00 | The box's cron copies the object and git stores |
| 02:17 | `mutation.yml` |
| 02:35 | `release.yml` |
| 03:00 | The monthly drill, on VPC 2 |
| 03:41 | `scan.yml` |
| 04:23 | `budgets.yml` |

Each backup job pings the dead-man service only after its upload is verified. `deploy/backup-fresh.sh` reads the `pg-hourly` and `nightly` checks with the read-only key `HEALTHCHECKS_READ_KEY`, a `production` environment secret.

- Each check must be `up`. A failed backup run clears that state.
- The dump must have pinged within the last 65 minutes.
- The copies must have pinged since the most recent 02:00 UTC, so that night's copies count and the previous night's do not.

GitHub can start the schedule hours late. Both limits hold wherever the start lands, because each hour brings a new dump. A night whose copies ran late or failed deploys nothing and turns red. The script's output becomes the tag's `Rode on:` line. A read-only key cannot see a ping URL, so it cannot fake a backup.

### No signed-in run before go-live

The smoke reads `/health` and one unauthenticated document, so a release can pass the smoke and still refuse every sign-in. Until go-live, the browser suite proves each page before merge, and the smoke and the uptime probe watch production.

### The record

Every release that held is an annotated `release/<UTC stamp>-<short commit>` tag. Its message has these lines:

- `When (UTC):`, the release time
- `By:`, the person who dispatched it, or automatic
- `api:` and `worker:`, the two digests
- `Rode on:`, the backup, the drill report, the hotfix reason, or `any green build`
- `Commit:`, the commit the release resolved its digests from. It says, per digest, whether this head resolved it or a dispatch passed it in.
- `Run:`, the run's URL

`promote` names the tag and writes its message. The `record` job pushes it last, and only after the smoke passes and `/health` still names the promoted api digest. So the newest tag is always the last release that held, and the runbook's rollback uses it. A release whose smoke fails pushes no tag, and its summary says so. A dispatch of older digests still tags `promote`'s head, which is `main`'s head at the dispatch, and `Commit:` says the digests were passed in. After a rollback, that tag stops the nightly gate from promoting the head again.

No CI job commits to a branch. So the branch ruleset has no bypass list, and `contents: write` on the `record` job is the token's only write permission. A tag ruleset on `release/*` restricts updates and deletions and allows creation, so nothing can move or delete a tag while the ruleset is on (`RUNBOOK.md` page 6, _The tag ruleset_). `deploy/RELEASES.md` holds the promotions up to 23/09/2026, and says how to list the tags since.

### The smoke waits for the build it promoted

When `release-redeploy.sh` sees the deployment finish, the smoke runs `deploy/await-release.sh`. The script polls `/health` 61 times, 6 seconds apart, until it answers healthy and its `image` is the api digest this run resolved. The old api answers healthy until its container is swapped, so a healthy answer alone proves nothing. If the polls run out, the script fails and names both digests.

A release whose api digest is already running, such as a worker-only rollback, passes on its first poll, because `/health` does not show the worker's digest. The smoke then reads the protected-resource document at `/.well-known/oauth-protected-resource/mcp`. `apps/api/tests/deploy/await-release.test.ts` runs the script against the api's own `/health`, served locally, and against a stand-in that answers a deploy's sequence.

### About sixty a day, in `per-merge` mode

In `per-merge` mode, each merge to `main` can make a release and a tag, which is about sixty a day. Merges that land during a release make fewer. `nightly` makes one a day. The rollback reads only the newest tags, so the number of tags costs nothing.

Each release restarts `api`, because the orchestrator replaces a Compose resource's containers rather than rolling them. The product answers nothing for about 45 seconds between the old `api` stopping and the new one answering. On the Free plan, the uptime probe alerts on one failed probe (`coolify.md`, _Ingress_). With probes five minutes apart, about one release in seven raises an alert.

## `mutation.yml`

`mutation.yml` runs at 02:17 UTC on hosted runners, which have no minute limit on a public repository. Its summary names the mutants that newly survived since the previous run. The workflow gates nothing. A falling score is a Linear issue. A red run means the run itself broke.

### Two legs, and what would bring a third back

The legs are `apps/api` and `packages/core`. A score means something only where the tests exercise the mutated code.

| Workspace | Why it has no leg | When it gets one |
| --- | --- | --- |
| `apps/web` | Its main tests run in a browser, which Stryker's Vitest runner cannot drive. Three jsdom files against a dozen components would score mostly uncovered mutants | When a runner can drive the browser suite, or component tests cover the pages |
| `apps/worker` | Its mutable source is a few dozen lines of configuration and logging, plus a schema view generated from the migration journal, so a mutmut score would measure the generator | When the tier gets behaviour worth mutating. The mutmut settings stay in `apps/worker/pyproject.toml` |

### The baseline is the previous run's artifact

Each leg starts from the previous run's results, so it does not retest an unchanged mutant. Stryker writes its report only when it finishes, but writes its incremental file on a cancellation too. So each leg keeps the incremental file, merged from its shards, and uploads it as `stryker-incremental-<leg>`, kept for fourteen days.

`.github/actions/mutation-baseline` restores the newest such artifact that a run on `main` uploaded before this run began. A dispatch on another branch takes the newer of `main`'s artifact and that branch's own.

- It reads only runs from this repository's own branches, because a fork can name its branch `main`.
- It ignores uploads made after this run began, so every job and every re-run restores the same results.

The baseline is an artifact, not an Actions cache entry. The Actions cache evicts its least recently used entry past 10 GB, and a nightly checkpoint did not survive a day there. Artifacts do not count toward that limit.

### Each leg runs as shards

A whole leg does not fit in one job's 360 minutes. So `scripts/mutation-shards.mjs` cuts each leg's `mutate` set into slices. Each slice is a matrix job with its own ceiling, which runs Stryker with `--mutate` over the slice. The matrix sets 5 shards for `apps/api` and 20 for `packages/core`. `packages/devtools/test/ci/mutation-baseline.test.ts` checks that the matrix, the summary, and the slices agree.

The slicing code is `packages/devtools/src/mutation/mutation-shards.ts`. It deals files heaviest first, each onto the lightest shard:

- A file's cost is the worker seconds its mutants took in the previous run, priced at 10 seconds per ordinary mutant, 13 per static mutant, and 370 per timeout.
- A new file is priced by its size, at the previous run's seconds per byte.
- A leg with no previous run is dealt by size alone.

Each shard starts from the whole leg's results, and Stryker carries files outside `--mutate` forward. So the slicing does not need to be stable from night to night.

Timed-out mutants take most of a forced run's time, and one file's mutants all run in one shard. So a heavy file sets a floor on the run's length that no number of shards moves. To fix a file too heavy for one shard, split the source file by concern. If that is not possible, name the file in the leg's `split` in `scripts/mutation-shards.mjs`, with a number of pieces. The file is cut by line into that many ranges, and each range is its own shard, ahead of the dealt shards. Cuts fall only between lines that no mutant spans, as Stryker's instrumenter reports, because Stryker mutates only what a range holds whole. The pieces share the file's previous cost. The merge takes each mutant from the piece that holds its first line. No file is split at present.

### The merge

Each shard uploads its incremental file, and its report if it finished, as `stryker-shard-<leg>-<n>`, kept for a day, whatever its outcome. The leg's `summary` job waits for every shard, and takes each file's results from the shard that owned the file.

- A shard that stopped keeps what it tested, so the merge never refills a forced run's gaps with the results the forced run was replacing.
- A cancelled shard merges like a finished one.
- A shard that went red before Stryker wrote anything hands back the results it restored.
- A shard that left nothing keeps its files' previous results.

The summary reports which shards finished, the score, the new survivors, and the runner-fault check. It uploads the merged results whenever the merge succeeded, even when a runner fault turns it red. So the baseline expires only after fourteen days in which no run reached its restore.

If the restore cannot list or read the artifacts, the run turns red rather than start from nothing and upload a poorer checkpoint. Runs on one branch take turns in the concurrency group `mutation-<ref>`. Overlapping runs would start from one checkpoint, and the later one to finish would win, however little it tested. A re-run keeps its run id, so its uploads replace its first attempt's.

At most 6 shards run at once (`max-parallel`). The organisation's plan runs 20 jobs at once, and a `check.yml` run takes 12: its `lane`, `docs-gates`, `pr-title`, and `check` jobs, and eight leg jobs, counting `full-web-browser` as two. `packages/devtools/test/ci/mutation-baseline.test.ts` counts those jobs from `check.yml`.

### The dispatch inputs

| Input | What it does |
| --- | --- |
| `force` | Retests every mutant (`stryker --force`). Off by default, which reuses the previous run's results |
| `ceiling-minutes` | Sets every shard's ceiling for one run. Empty is 180, and the most is 350. GitHub terminates a hosted job at 360 minutes rather than cancelling it, and the upload after a cancellation needs time to run |
| `shards` | Runs only the shards it names, as leg-number pairs with commas and no spaces, such as `core-1,api-2`. The other shards skip every step and leave nothing, and the merge keeps their files' results from the run the restore read. Use it to re-run a failed shard, or the shards a change to the slicing moved |

### Rebuild a lost baseline

1. Dispatch `mutation` on `main` with `ceiling-minutes` set to 350, so the shard with the heaviest file can finish.
2. Let the next nights run. Each one starts from what the previous run left.

### Each leg's Stryker config names its own vitest config

Both legs' Stryker configs set `vitest.configFile` to `vitest.stryker.config.ts`. That file is the workspace's vitest config with the changes below. Both files change `reporters`, `exclude` and `isolate`. The `packages/core` file also changes `env` and `sequence`. First, it drops the `github-actions` reporter, so only the leg's `summary` job writes a step summary. Vitest adds that reporter when `GITHUB_ACTIONS` is `true`. Under Stryker, it would append a "Vitest Test Report" per mutant and annotate killed mutants as errors. The workspaces' own suites keep the reporter.

Second, it sets `exclude` to leave out each test that lints the files under `src` without running them. In `packages/core` these are `environment-lint`, `face-admission` and `import-direction`. In `apps/api` it is `no-ambient-clock`. Stryker rewrites `src` in place, so such a test lints the instrumented code, which can fail the initial test run. It also cannot kill a mutant. The config names each file, so that a gate that also runs `src` stays in the run. `refusal-words` is such a gate, and it is the only test of `src/kernel/refusal.ts`. The workspaces' own suites run every gate.

Third, both files set `isolate: true`. Stryker runs every file in one worker, and a static mutant is live only in a module evaluated after Stryker activates it. The workspaces' own suites set `isolate: false`.

The two changes left are in `packages/core` only. The `packages/core` file sets `env.GITHUB_STEP_SUMMARY` to an empty string, so that no test writes a step summary under Stryker. It also sets `sequence.sequencer`, which the next section describes.

### `packages/core` runs its own test order under Stryker

`packages/core/vitest.stryker.config.ts` runs the file that failed in the last run first, then the shortest file. Vitest's own order runs the longest file first, which is `test/sources/cross-tier-document.test.ts`. That file spawns the worker and takes about half the suite's time. Static mutants waited for it before the quick file that kills them, and many timed out. The order changes which file answers first, not the verdict, so a survivor still survived the whole related suite.

`ignoreStatic` stays off. Only the audit and refusal-word walks, which import every slice inside a test, reach many of core's static mutants. Under `ignoreStatic`, those mutants would run no test and fail the leg as a runner fault.

### Cancellation has to reach Stryker

A cancelled step signals only its entry process, and a shell waiting on a child forwards nothing. Stryker writes its partial results when it receives SIGINT. So the step `exec`s into `node_modules/.bin/stryker`, which execs into node, and one process runs from the step down. Do not run Stryker through `pnpm run mutation`, because pnpm and a shell between the step and Stryker do not pass SIGINT on.

### A runner fault fails the leg

The summary exits non-zero, and names a runner fault first, when any merged mutant ran no test or the leg killed none. Such a report would otherwise read as a low score. The check judges the merged checkpoint, reused rows included. So rows like these keep the leg red until a run with `force` retests every mutant.

Vitest 5 matches a test name against its suite chain joined with a spaced greater-than sign, as in `outer > inner > test`. The Stryker Vitest runner built the name with a single space, so no mutant's name filter selected a test, and every mutant came back `Survived` with `testsCompleted: 0`. `patches/@stryker-mutator__vitest-runner.patch` builds the name as the running vitest does. `packages/devtools/test/mutation/vitest-runner-patch.test.ts` holds a mutant that only a test inside a `describe` reaches, so a vitest or runner upgrade that breaks the filter fails its pull request.

## `scan.yml`

`scan.yml` runs at 03:41 UTC, after `mutation.yml` starts, and on dispatch. It scans the images `build.yml` pushed for known vulnerabilities, and gates nothing. A vulnerability published overnight is no reason for a merge to fail, and `build.yml`'s job is to push a probed digest. A reported vulnerability leaves the run green. A red run means the scan itself broke. For example, the packages API refused the token, the scanner failed, or code scanning refused an upload.

### Which image

Each leg scans its package's newest version with a `sha-` tag, read from the packages API. That is the image `build.yml` last pushed for the tier.

- `main`'s head is not scanned, because its build may still be running or be red.
- The release tags hold no `backup` digest, because that digest is set by hand. Scanning what production runs is a separate target, and nothing builds it yet.
- The version is chosen by tag, because every provenance push writes two newer manifests, one untagged and one tagged `sha256-<digest>`. The `buildcache` version has no `sha-` tag.

Each leg scans by digest, so a push during the run changes nothing. Its summary names the digest and the tag.

### The tier list is `build.yml`'s

The `tiers` job reads `build.yml`'s `image` matrix when the run starts, and gives each tier a leg of the `trivy` job. `fail-fast` is off, so one tier's broken scan cancels no other. A fourth image is scanned the first night after it ships.

### The scanner

The scanner is Trivy, through `aquasecurity/trivy-action`. In March 2026 an attacker force-pushed 76 of the action's 77 tags to a credential stealer (GHSA-69fq-xp46-6x23). Pin the action by commit to a release cut after that incident, never to `@master`. The `github-actions-templates` skill's example pins it to `@master`, so do not copy that example. The current pin is v0.36.0, an immutable release with a signed tag and its commit on `master`. The `setup-trivy` action it calls is pinned by commit too. The step sets `version:` to a Trivy release, because the action's default trails Trivy's security fixes. Renovate's `github-actions` manager updates that input as a release of `aquasecurity/trivy`.

The scan fetches the vulnerability database each night with `cache: "false"`. Any run on `main` can write an Actions cache entry, and a database planted there would hide findings. The registry login is keyed by host, so the token reaches ghcr.io alone, never `mirror.gcr.io`, where the scanner fetches its database.

### Where a vulnerability shows

Each vulnerability a scan reports, per package or binary path, is a code scanning alert, under **Security** then **Code scanning**. So one CVE in openssl's three packages is three alerts. An alert is filed on the run's branch, which is `main` for the nightly run, under its tier's category: `image-api`, `image-worker`, or `image-backup`. It closes when a scan no longer finds it. The owner reads the list, and nothing else is notified.

An alert is not a task, because most alerts close through a change nobody here writes, such as a Renovate pull request that moves a pinned base image. Open a Linear issue for a change the list shows an image needs, such as a pin to move or a package to drop. Name the alerts the issue expects to close.

### Triage of a vulnerability

Assess a vulnerability for its package in its image, not for its CVE alone. The outcome is one of three.

| Outcome | When | What to do |
| --- | --- | --- |
| A fix we can take | The alert's _Fixed Version_ names one | Take it in the issue for that image. The alert closes itself |
| No fix, and unreachable | The running service never takes the flawed path | Dismiss it as "won't fix", with a one-line reason that says what shows it |
| No fix, and reachable | The running service takes the flawed path | Leave it open. Name it in `IMAGE_VULNERABILITIES.md` under _Held open_, with its mitigation and the task that removes it |

A fix inside a binary someone else builds, such as `rclone` or `age`, counts as no fix until that binary's release carries it. Renovate proposes that release.

The service's calls, the image's entry points, and the advisory's conditions decide whether the service takes the flawed path. To find out, read the image itself:

1. Run `docker export` on the digest.
2. Read dpkg's status file to see why a package is there.
3. Read each ELF file's `DT_NEEDED` entries to see what links a library.
4. Read the file list for the binaries the flaw needs.

`IMAGE_VULNERABILITIES.md` keeps each package's assessment. For a new vulnerability in a package already listed, start from that assessment.

To dismiss an alert, use the API. The reason can be at most 280 characters:

```sh
gh api -X PATCH 'repos/{owner}/{repo}/code-scanning/alerts/<number>' -f state=dismissed \
  -f dismissed_reason="won't fix" -f dismissed_comment='Unreachable (<task id>): <what shows it>'
```

A dismissal outlasts every rebuild, even after a fixed version appears in the alert's text. So when you read the list, also run the dismissed-but-now-fixable query below. It names each dismissed alert that the latest scan still reports with a fixed version, for a Debian package (filed under the image's own name) or for a library a manifest pins. Reopen each one with `-f state=open`, and take the fix. The query leaves out binaries someone else builds, because their fix arrives as a Renovate pull request, and the scan after that merge closes the alert.

```sh
gh api --paginate 'repos/{owner}/{repo}/code-scanning/alerts?state=dismissed&per_page=100' --jq '.[]
  | select(.fixed_at == null)
  | select(.most_recent_instance.location.path | test("^[^/]+/[^/]+$|package\\.json$|METADATA$"))
  | select(.most_recent_instance.message.text | test("Fixed Version: \\S"))
  | .number'
```

Use the same method at every severity. `IMAGE_VULNERABILITIES.md` records which severities have been through it.

### The alerts branch

After the scan legs finish, whatever their outcome, the `alerts` job writes `alerts.json` to the branch `security/alerts`. It writes one parentless commit that replaces the previous one. The file holds the run's URL, every open alert, and the alerts the dismissed-but-now-fixable query names. Each alert is cut to its number, created date, state, severity, rule, category, path, message, dismissal comment, and URL.

The weekly triage is a cloud Claude Code routine. It reads the file with `git fetch origin security/alerts`, because a cloud session's GitHub calls carry the Claude GitHub App's token, which cannot read code scanning. The job's token reads code scanning and writes the branch. The branch ruleset covers only `main`, and a push made with a run's own token starts no workflow.

### Code scanning on the repository

The workflow changes no repository setting. If code scanning refuses the upload because it is turned off, the owner decides whether to turn it on, as the repository's admin.

## The `docker-hub-login` action

`.github/actions/docker-hub-login/` sends the Docker daemon's Docker Hub pulls through `mirror.gcr.io`, then logs the job in to Docker Hub for any image the mirror lacks. The suites' Postgres (`pgvector/pgvector`) and the images the api and worker legs build come from Docker Hub.

- A pull through the mirror counts against no Docker Hub limit.
- Logged-in legs share the account's 200 pulls an hour, which CI can use up.
- An anonymous pull counts against the runner address's limit, which GitHub's runners share with every other anonymous puller.

Every job that starts a container calls the action:

- every `full-` leg in `check.yml` except `full-web-unit`
- the `image` job in `build.yml`
- the `stryker` job in `mutation.yml`
- the job in `budgets.yml`

The action restarts the daemon, so it runs before `setup-buildx-action`. The builder that action starts sets the same mirror in its `buildkitd-config-inline`. The action reads the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, a read-only access token. `build.yml` passes both to `check.yml` by name. A run without them, such as a fork's, warns and pulls anonymously.

### Rotate the Docker Hub token

1. Create a new read-only access token on the Docker Hub account.
2. Run `gh secret set DOCKERHUB_TOKEN`.
3. Revoke the old token.

## The `git-filter-repo` action

`.github/actions/git-filter-repo/` installs `git-filter-repo`, the rewrite tool the erasure routine runs, which the runner image lacks. The erasure suite has no skip guard, by design. The install is a shared action, not a step in each workflow, because every job that runs the erasure suite needs it: `full-core`, `full-api`, and each `stryker` shard. Without it, a job fails with `git: 'filter-repo' is not a git command`.

The action reads the version from the `ARG GIT_FILTER_REPO_VERSION=` line in `apps/api/Dockerfile`, so the runner and the api image run the same tested version. It refuses a Dockerfile with no such line or with more than one. It then checks that git can run `git filter-repo`. A job that runs the erasure suite without the action fails that suite, and the `check` verdict reads the failure.
