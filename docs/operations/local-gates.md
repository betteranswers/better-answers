# Local gates and worktrees

This page describes what runs on your machine before CI: the git hooks in `lefthook.yml`, the Claude Code hooks under `.claude/hooks/`, the shared test Postgres, and the root tool configuration. `docs/operations/CI.md` covers CI.

## The pre-commit hook

The hook runs its commands in parallel over staged files. It runs no test suite.

A command runs only when a staged file matches its `glob` and, for a command with `root:`, sits in that directory. Each `*-typecheck` command then runs its workspace's `typecheck` script over the whole workspace. So a change in `packages/core` that breaks the types of `apps/api` passes the hook when no `apps/api` file is staged. Root `check` catches it.

### How to skip, when you mean to

| Command | What it skips |
| --- | --- |
| `LEFTHOOK=0 git commit` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=oxlint git commit` | one command |
| `LEFTHOOK_EXCLUDE=oxfmt,oxlint git commit` | several, comma-separated |

`LEFTHOOK_EXCLUDE` takes the command names in `lefthook.yml`. Do not delete the hook file. The next `pnpm install` writes it back.

### How it is installed

The root `prepare` script runs `lefthook install`, and pnpm runs `prepare` after every install. `pnpm-workspace.yaml` sets `lefthook: false` under `allowBuilds`, so pnpm does not run lefthook's own postinstall.

Where lefthook is absent or no git working tree exists, `prepare` prints a message and does not fail. The api's runtime image is one such place, because `--prod` leaves lefthook out. A `check.yml` step fails if a fresh clone does not get the hook.

### What each command is for

- `oxfmt` writes its fixes, and `stage_fixed` adds them to the commit, so CI never fails on formatting alone. `--no-error-on-unmatched-pattern` lets it take the whole staged set.
- `oxlint` lints staged `.ts`, `.tsx`, `.mjs`, and `.js` files with the flag root `lint` uses, which also refuses a disable comment that suppresses nothing. `--no-error-on-unmatched-pattern` lets a commit through when the lint config ignores its only staged file.
- `ruff-format` and `ruff-check` run with `root: apps/worker/`, where `uv` finds ruff's locked environment. `--only-group dev` syncs only the dev group, so a commit never fetches torch. On Linux, torch comes from PyTorch's CPU wheel host, which a sandboxed clone may not reach.
- `comment-gate-python` runs the checker of root `comment-gate:python` over staged `.py` files. It has no `root:`, because the checker reads a file's place, such as `apps/worker/src/`, from its repository path.
- `actionlint` runs the command of root `lint:workflows:actionlint` over staged workflows. actionlint, and the shellcheck it runs on each `run:` step, come from the worker's locked dev group, so a commit and CI use the same versions. The first run builds actionlint's Python package, which downloads the release from GitHub and checks its hash. uv caches the build.
- The five `*-typecheck` commands cover every workspace.

## The pre-push hook

Before a push that carries commits to a branch, the hook runs every step of root `check:gates` and the three prose suites that `check:docs` adds: `check:docs:core`, `check:docs:devtools`, and `check:docs:web`. `format:check` is in both scripts and runs once.

Each step is its own command, and the commands run in parallel, so a failure names its gate. `packages/devtools/test/root-config/lefthook-config.test.ts` fails if the hook's list and the two scripts differ in either direction.

The hook needs Docker running, because the core suite starts Postgres.

A failed gate stops the push. The gates' summary names each failure with the command that runs it alone, and the hook's summary marks `gates` failed:

```
✗ knip: run it alone with pnpm run knip (3.14 seconds)
```

The gates read the working tree, not the pushed commits, so push from a clean tree. `format:check` also reads any untracked file that no ignore pattern covers.

### When the gates run

Git passes the hook one line per pushed ref: the local ref and its sha, then the remote ref and its sha. `scripts/pre-push.sh` runs the gates when any line sends a sha that is not all zeros to a ref under `refs/heads/`. Otherwise it prints this line and lets the push through:

```
gates skipped: every ref pushed is a deletion or outside refs/heads/, so none carries commits
```

A dirty working tree therefore cannot block a tag push or a branch deletion. The gates still run for a tag pushed with a branch's new commits, and for a branch push that only deletes files.

lefthook passes git's lines only to a job with `use_stdin`, not to a `skip` condition, a `setup` step, or a `files` command. So `pre-push` has one job, `gates`, which runs `scripts/pre-push.sh`. The script runs the gates in a second hook with `pnpm exec lefthook run pre-push-gates`.

### How to skip the pre-push hook

| Command | What it skips |
| --- | --- |
| `git push --no-verify` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=knip git push` | one gate |
| `LEFTHOOK_EXCLUDE=knip,check:docs:core git push` | several, comma-separated |

`LEFTHOOK=0` also skips this hook. To run every gate without pushing, run `pnpm exec lefthook run pre-push-gates`. Do not run `lefthook run pre-push` by hand, because it waits on stdin for lines only git sends.

### What each command's `run` carries

- `{without-git-env}` unsets every variable that `git rev-parse --local-env-vars` lists. On a push from a linked worktree, git sets `GIT_DIR`, which outranks the directory `git -C <dir>` names. Without the unset, a suite that builds a throwaway repository writes into the worktree's repository. A push from the main checkout sets no `GIT_DIR`.
- `: {files};`, in the `gates` job only, does nothing when it runs. Without a files template, lefthook skips a `pre-push` command when the push changes no file still on disk, such as a push that only deletes files. `{files}` makes lefthook read the hook's own `files` list, `lefthook.yml`, which is never empty. `pre-push-gates` needs no template, because lefthook skips on a push's files only in a hook named `pre-push`.

### Where it is installed

Git keeps hooks in the common git directory, so one `pre-push` serves every checkout, and each run reads its own checkout's `lefthook.yml`. `prepare` installs it with the other two hooks. Git never calls `pre-push-gates`, so `lefthook install` writes no file for it. lefthook reinstalls the hooks when one runs under a changed `lefthook.yml`, so an older install gets `pre-push` at its next commit.

## The commit-message hook

The `commit-msg` hook runs commitlint with `commitlint.config.mjs`, which extends `@commitlint/config-conventional`. The `pr-title` job in `check.yml` runs the same check on a pull request's title. The hook refuses a subject with no type, such as a plain sentence, and a header over 100 characters. `packages/devtools/test/root-config/commit-msg-hook.test.ts` tests the hook.

## The Claude Code hooks

`.claude/settings.json` wires two scripts under `.claude/hooks/`: `worktree-create-hook.sh` on `WorktreeCreate`, and `watch-cap-hook.sh` on `SessionStart`.

### Creating a worktree

`worktree-create-hook.sh` replaces native worktree creation for every Claude Code worktree, such as an `Agent(isolation: "worktree")` fork or `claude --worktree`. Claude Code sends JSON with `.name` on stdin. The hook's stdout must be exactly the created directory, so diagnostics go to stderr.

The hook creates `.claude/worktrees/<name>` on branch `worktree-<name>`, and reopens the directory if it exists. It picks the base from the input's `.cwd`, because `CLAUDE_PROJECT_DIR` names the main checkout even from a linked worktree:

- From the main checkout, the base is `origin/main` after a fetch, or the local `main` if the fetch fails.
- From a linked worktree, the caller is a delegate that builds that session's branch, so the base is that worktree's `HEAD`.

The branch uses `--no-track`, so a bare `git pull` or `git push` never targets `main`. The hook gives the worktree its own jCodeMunch and jDocMunch indexes, so its edits do not register in the main checkout's indexes. If either tool is missing, the hook writes a line to stderr and still creates the worktree.

The hook installs nothing. pnpm installs on the first `pnpm exec`, and uv syncs on the first `uv run`. `packages/devtools/test/gates/worktree-create-hook.test.ts` tests the hook.

Nothing in this repository removes a worktree. Claude Code's own cleanup skips worktrees this hook creates, because they carry no Claude Code marker. pstack's worktree-cleanup playbook removes merged ones, and `pnpm reap-containers` removes stopped test containers.

### The doc watcher's log cap

The launchd service `us.gravelle.jdocmunch-watch` runs the jDocMunch watcher. Its plist, `~/Library/LaunchAgents/us.gravelle.jdocmunch-watch.plist`, sets `FileSize` under `SoftResourceLimits` to 1 GB. The cap also applies to the index files, so it sits far above the largest of them.

`jdocmunch-mcp watch-install` rewrites the plist without the cap. To restore the cap, run:

```
bash scripts/jdocmunch-watch-cap.sh
```

The script adds the cap and reloads the service with `launchctl bootout` and `launchctl bootstrap`. If the cap is already present, the script changes nothing, except to load a service that an earlier run left unloaded. `JDOCMUNCH_WATCH_PLIST` points the script at another plist.

On a fresh session, not on a resume, `watch-cap-hook.sh` runs the script with `--check`. If the cap is missing, the session opens with a message that names the restore command. The hook never changes the plist.

## The `check` runner

`scripts/check.mjs` is the `check` script of the root and of every workspace. It runs each step named on its command line with `pnpm run`, in order, continues past a failure, and ends by naming every step that failed. Each argument is a script in the manifest of the directory it runs in, so a manifest's `check` lists that workspace's gates.

One run reports every failure. A session told only about lint fixes lint, runs `check` again, and only then learns about types.

The worker has its own runner, `apps/worker/src/better_answers_worker/check.py`, because a uv workspace is not a pnpm workspace.

## The shared test Postgres

By default, every test run starts its own Postgres container. On a laptop, a shared server per pinned image is opt-in. In CI, only the `full-worker` job uses one, so its four pytest workers share one server.

To use it, start the server for this checkout's pin and export the lines that `up` prints:

```sh
deploy/test-postgres.sh up
export TEST_POSTGRES_URI=shared
```

`up` also prints an `export TEST_POSTGRES_PORT=` line when the server is bound to a port other than the derived one.

If the machine ran the older single shared server, run `deploy/test-postgres.sh down --all` once. It clears that server on port 55433, which otherwise returns after every Docker restart.

With `TEST_POSTGRES_URI=shared`, the warm harness in `packages/schema`, `packages/core`, and `apps/api`, and the worker's pytest harness, start no container. Each derives the server's address from the image that `packages/schema/src/postgres-image.ts` pins. A harness uses a `postgresql://` URI as given. Each tier clones its databases from a template named for a digest of `packages/schema/migrations` and of the harness that builds it. The first run on a new migration set builds the template, and later runs reuse it.

Each pinned image gets its own server, with the compose project and port derived from the image's digest, so a worktree on a newer pin gets a second server. `TEST_POSTGRES_PORT` and `TEST_POSTGRES_PROJECT` override the derived port and project stem. The servers keep data in memory, so a Docker restart discards it, and the next run rebuilds its template. These servers are separate from the dev database that `deploy/local-database.sh` starts.

| `deploy/test-postgres.sh` command | What it does |
| --- | --- |
| `up` | Starts this pin's server, and names any other server still running. |
| `address` | Prints this pin's project and address without starting anything. |
| `down` | Stops this pin's server and discards its data. |
| `down --all` | Stops every server. |

The shared servers follow these rules:

- If the variable is set but no server listens, or the URI does not name a superuser, a run stops with a message that names `TEST_POSTGRES_URI` and the `up` command. It never falls back to a container.
- Every server carries its image in the label `better_answers.image`. Under `shared`, a run refuses a server with no label or with another image's label. With an explicit URI, a run refuses another image's label. If two pins derive one port, start the second with `TEST_POSTGRES_PORT=<free port> deploy/test-postgres.sh up` and export the same `TEST_POSTGRES_PORT`.
- Two loaded servers can exhaust the Docker VM's memory. Clear old servers with `down --all` once no worktree uses their pin.
- If a server runs out of memory, Postgres ends every session, and every run on it fails. Run `down`, then `up`.
- A run's databases carry its process id. The next run on the machine drops a killed run's databases once that process has gone.
- Each run stamps its template with its last use. The next run of the same tier drops a template unused for a day, so a run held open longer can lose its template. Restart the run to rebuild it.
- `pnpm reap-containers` and Ryuk select only containers that testcontainers labelled, so neither touches the shared servers.
- Some tests still start their own server. `packages/schema/test/roles-surface.test.ts` and `apps/api/tests/deploy/browse-role.test.ts` replay part of the migration history and read or alter roles across the whole server. A case in `packages/schema/test/support/warm-postgres/cold-start.test.ts` tests the path without a warm server. Garage still starts a container per run.
- Renovate proposes pin updates each weekend and holds a Postgres major version in the Dependency Dashboard. Production's Postgres is a Coolify resource set to the pin by hand. After you merge a pin update, re-point that resource to the new image reference. If the pgvector version changed, also run `ALTER EXTENSION vector UPDATE`.

## The tool configuration at the repository root

### `cubic.yaml`

`cubic.yaml` configures the Cubic reviewer, and Cubic reads it from `main` only. Cubic enables five custom agents per repository, the repository's own first and then the organization's, and drops a sixth with no error. Each custom rule takes one of those slots. The Principal rule holds the API-auth, tenant-scoping, and request-validation checks, so they need no separate agent.

### `jscpd.config.mjs`

`jscpd.config.mjs` is a JavaScript module, not the `.jscpd.json` that jscpd reads by default. jscpd parses `.jscpd.json` as strict JSON. On a `//` comment line it prints an error, runs on its defaults, and exits zero. So `scripts/jscpd.mjs` passes the module's values on the command line.

The threshold is zero, because a percentage gets loosened the day it fails. Fold each copy into a helper, or exclude it in the config or with `jscpd:ignore-start` and `jscpd:ignore-end` comments around the copy.

jscpd skips these paths:

- `apps/web/src/shared/ui/**`, the SPA's components installed from a registry.
- `apps/web/src/shared/audit/audit-actions.ts`.
- `**/lifts/**`, verbatim third-party snapshots that change only upstream.
- `schema_view.py`, generated from the migration journal.
- The two lockfiles, by name as well as by format.
- Build output, installed dependencies, the Python environment, and the agents' worktrees.

### `knip.config.ts`

knip runs over the pnpm workspace as a step of root `check:gates`. The branch fails on a file no code reaches, an export nothing imports, a dependency no workspace uses, or a dependency used but not declared.

The config lists no process entry points, because knip's plugins already reach them. The plugins read the manifests' scripts, the SPA's `index.html`, and the `jsPlugins` specifiers in `.oxlintrc.json`. That reaches the api's `main.ts`, `migrate.ts`, and `ops.ts`, the two servers the api's suite exposes, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint plugins, and the `check` runner. Listing them again draws knip's "Remove redundant entry pattern" hint on every run. Left inferred, a file that no manifest names any more shows as unreached.

The config does not name `.gitnexus/`, where each checkout keeps its GitNexus index. `.git/info/exclude` excludes the directory, and knip reads that file beside `.gitignore`, from a worktree too. `knip --debug` lists both under "Parsed gitignore files". An `ignore` entry for the directory would suppress nothing and draw knip's "Remove from ignore" hint on every run. `packages/devtools/test/scans/knip.test.ts` fails if a knip release stops reading the exclude file. Do not silence hints with `--no-config-hints`, because it also silences the redundant-entry hints.

`includeEntryExports` is on at the top level. By default, knip treats an entry file's exports as published API and reports none of them. The `exports` map of `packages/core` makes every slice's barrel an entry, and nothing here is published, so an entry's unimported export is dead code. Only `apps/web` sets it to `false`: its `src/shared/ui` is registry source installed before the pages that will import it, and its `entry` list covers those components. A workspace's own value overrides the top-level one.

Keep an export with no caller only when its action has no transport yet and a block under `docs/specs/route/` wires it. Tag it on its own `export` line with `/** @public <block> */`, for example `/** @public S3 */`, so the tag covers only that line's names. Remove the tag when the block's row in `docs/specs/v01-route.md` is done. Do not keep the input, result, or refusal types of an action a transport already reaches. The transport infers them, and a later block that needs a name adds one line to the barrel. Do not delete a barrel, because the `better-answers/import-direction` lint rule reads it.

`--production` and `--strict` are diagnostics, not gates. Production mode drops the test entries and the manifests' scripts, so every test helper and every script-run file, such as `migrate.ts` and `ops.ts`, shows as unused. Strict mode then refuses devDependencies in what it counts as production, so every devDependency a helper imports shows as unlisted.

### `pnpm-workspace.yaml`

`pnpm-workspace.yaml` is the workspace manifest. `apps/worker/` is a uv workspace, not a pnpm one. A documentation site would join the `packages:` list.

`allowBuilds` runs only esbuild's postinstall, which puts the platform binary where vite and drizzle-kit find it. `cpu-features`, `protobufjs`, and `ssh2` are optional native accelerations this repository does not use. pnpm fails an install on a dependency with a build script that `allowBuilds` does not decide, so each refused package, lefthook included, is `false` rather than absent.

`patchedDependencies` holds two patches, each keyed by package name alone. A bump that leaves a patch's hunks applying installs unchanged. A bump that moves them fails the install on its own pull request.

- The `testcontainers` patch gives each test process its own Ryuk.
- The `@stryker-mutator/vitest-runner` 10.0.0 patch fixes two faults. Remove it when the fixes are upstream.
  - The runner joins a test's suite chain with a single space, where vitest 5 puts a `>` between two spaces, so no mutant's name filter selects a test. The patch builds the name as vitest does. See `docs/operations/CI.md`, _A runner fault fails the leg_.
  - A test file that fails to load, or a hook that throws, fails no test, so vitest never bails. The mutant then shows as survived, or under CI's load as Timeout, which counts as killed. The patch cancels the run on such a failure and counts one failed test, whose reason names the file, and the hook if one threw.
