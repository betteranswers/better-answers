# Local gates and worktrees

This page covers what runs on a developer's or an agent's machine before CI: the git hooks in `lefthook.yml`, the Claude Code hooks under `.claude/hooks/`, and the tool configuration at the repository root. `docs/operations/CI.md` covers CI.

## The pre-commit hook

The hook runs its commands in parallel over staged files only, and runs no test suite. Five commands each run one workspace's `typecheck` script (`tsc --noEmit`) over that workspace's staged `.ts` and `.tsx` files.

With `parallel: true`, the hook costs its slowest command, about 1.9s cold for the api.

A command runs only when a file in its own workspace is staged. A change in `packages/core` that breaks `apps/api`'s types passes the hook when no `apps/api` file is staged. Root `check` catches that case.

### How to skip, when you mean to

| Command | What it skips |
| --- | --- |
| `LEFTHOOK=0 git commit …` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=oxlint git commit …` | one command |
| `LEFTHOOK_EXCLUDE=oxfmt,oxlint git commit …` | several, comma-separated |

The variables take the command names in `lefthook.yml`. Do not delete the hook file, which the next `pnpm install` writes back.

### How it is installed

The root `prepare` script runs `lefthook install`, and pnpm runs `prepare` after every install. `pnpm-workspace.yaml`'s `allowBuilds` refuses lefthook's own postinstall (`lefthook: false`), because that list is for inspected native builds.

`prepare` prints a message instead of failing where no hook belongs: the api's runtime image, where `--prod` leaves lefthook out, and any install outside a git working tree. The check workflow asserts that a fresh clone gets the hook.

### What each command is for

- `oxfmt` writes its fixes, and `stage_fixed` adds them to the commit, so CI never fails on formatting alone. `--no-error-on-unmatched-pattern` lets it take the whole staged set.
- `oxlint` runs the lint config over staged `.ts`, `.tsx`, `.mjs`, and `.js` files with root `lint`'s flag, so it also refuses a disable comment that suppresses nothing. `--no-error-on-unmatched-pattern` lets a commit through when the config ignores its only staged script.
- `ruff-format` and `ruff-check` run with `root: apps/worker/`, where `uv` finds ruff's locked environment. `--only-group dev` syncs only ruff's group, so a commit never fetches torch. On Linux, torch comes from PyTorch's CPU wheel host, which a sandboxed clone may not reach.
- `comment-gate-python` runs root `comment-gate:python`'s checker over staged `.py` files. It has no `root:`, because the checker reads a file's place, such as `apps/worker/src/`, from its repository path.
- `actionlint` runs root `lint:workflows`'s command over staged workflows. actionlint and the shellcheck it runs on each `run:` step come from the worker's locked dev group, so a commit and CI use the same versions. The first run builds actionlint's Python package, which downloads the release from GitHub and checks it against the package's hash. uv caches the build.
- The five `*-typecheck` commands cover every workspace with a `typecheck` script except the design system, which has no `tsconfig.json` and no `scripts` block. `root:` scopes each command to its own workspace's staged files.

## The pre-push hook

Before a push that carries commits to a branch, the hook runs every step of root `check:gates` and the three prose suites `check:docs` adds: `check:docs:core`, `check:docs:devtools`, and `check:docs:web`. `format:check` is in both scripts and runs once.

Each step is its own command, run in parallel, so a failure names its gate. `packages/devtools/test/root-config/lefthook-config.test.ts` holds the hook's list to the two scripts in both directions.

With every gate passing, the hook takes 20s to 24s, and `check:docs:devtools` is the slowest command. The hook needs Docker running, because the core suite starts Postgres.

A failed gate stops the push. The gates' summary names each failure with the command that runs it alone, and the hook's summary marks `gates` failed:

```
✗ knip: run it alone with pnpm run knip (3.14 seconds)
```

The gates read the working tree, not the pushed commits, so push from a clean tree. `format:check` also reads any untracked file that no ignore pattern covers.

### When the gates run

Git passes the hook one line per pushed ref: the local ref and its sha, then the remote ref and its sha. `scripts/pre-push.sh` runs the gates when any line sends a sha that is not all zeros to a ref under `refs/heads/`. Otherwise it prints one line and lets the push through:

```
gates skipped: every ref pushed is a deletion or outside refs/heads/, so none carries commits
```

That covers a tag's push or deletion, a ref in its own namespace (such as ordna's archived `refs/ordna/`), and a branch deletion. A dirty working tree cannot block these. A tag pushed with a branch's new commits still runs the gates, and so does a branch push that only deletes files.

lefthook passes git's lines only to a job with `use_stdin`, not to a `skip` condition, a `setup` step, or a `files` command. So `pre-push` is one job, `gates`, which runs the script, and the script runs the gates in a second hook with `pnpm exec lefthook run pre-push-gates`.

### How to skip the pre-push hook

| Command | What it skips |
| --- | --- |
| `git push --no-verify` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=knip git push` | one gate |
| `LEFTHOOK_EXCLUDE=knip,check:docs:core git push` | several, comma-separated |

`LEFTHOOK=0` also skips this hook. To run every gate without pushing, run `pnpm exec lefthook run pre-push-gates`. Run by hand, `lefthook run pre-push` waits on stdin for lines only git sends.

### What each command's `run` carries

- `{without-git-env}` unsets every variable that `git rev-parse --local-env-vars` lists. On a push from a linked worktree, git sets `GIT_DIR` to the worktree's git directory. `GIT_DIR` outranks the directory `git -C <dir>` names, so a suite that builds a throwaway repository would write to the worktree's repository instead. A push from the main checkout sets no `GIT_DIR`, so only a worktree shows this.
- `: {files};`, in the `gates` job only, does nothing when it runs. Without a files template, lefthook skips a `pre-push` command when the push changes no file still on disk, as when a push only deletes files. `{files}` makes lefthook read the hook's own `files` list, `lefthook.yml`, which is never empty. `pre-push-gates` needs no template, because lefthook skips on a push's files only in a hook named `pre-push`.

### Where it is installed

Git keeps hooks in the common git directory, so one `pre-push` serves every checkout. Each run reads its own checkout's `lefthook.yml`. `prepare` installs it with the other two hooks. Git never calls `pre-push-gates`, so `lefthook install` writes no file for it. lefthook reinstalls the hooks when one runs under a changed `lefthook.yml`, so an older install gets the hook at its next commit.

## The commit-message hook

The `commit-msg` hook runs commitlint with `commitlint.config.mjs`, the config the `pr-title` job in `check.yml` also reads. It refuses a declarative subject, a subject naming its ticket, and a subject over 90 characters. `packages/devtools/test/root-config/commit-msg-hook.test.ts` tests it.

## The Claude Code hooks

`.claude/settings.json` wires two scripts under `.claude/hooks/`: the worktree create hook and the doc watcher's cap.

### Creating a worktree

`worktree-create-hook.sh` replaces native worktree creation for every Claude Code worktree, such as an `Agent(isolation: "worktree")` fork or `claude --worktree`. Claude Code sends JSON with `.name` on stdin. The hook's stdout must be exactly the created directory, so diagnostics go to stderr.

The layout stays native, `.claude/worktrees/<name>` on branch `worktree-<name>`. The hook picks the base from the input's `.cwd`, because `CLAUDE_PROJECT_DIR` names the main checkout in both cases.

- From the main checkout, the base is `origin/main` after a fetch, or the local `main` if the fetch fails.
- From a linked worktree, the request is a delegate building that session's branch, so the base is that worktree's `HEAD`.

The branch uses `--no-track`, so a bare `git pull` or `git push` never targets `main`. The hook gives the worktree its own jCodeMunch and jDocMunch indexes, so its edits do not register in the main checkout's indexes. Without either tool, the hook writes a line to stderr and still creates the worktree.

The hook installs nothing. pnpm installs on the first `pnpm exec`, and uv syncs on the first `uv run`. `packages/devtools/test/gates/worktree-create-hook.test.ts` tests the hook.

Nothing in this repository removes a worktree, and Claude Code's sweep skips hook-created ones, which carry no Claude Code marker. pstack's worktree-cleanup playbook removes merged ones, and `pnpm reap-containers` removes stopped test containers.

### The doc watcher's log cap

The launchd service `us.gravelle.jdocmunch-watch` runs the jDocMunch watcher. Its plist sets `FileSize` under `SoftResourceLimits` to 1 GB. The cap also binds the index files, the largest of which is 64 MB.

`jdocmunch-mcp watch-install` rewrites the plist without the cap. To restore the cap, run:

```
bash scripts/jdocmunch-watch-cap.sh
```

The script adds the cap and reloads the service with `launchctl bootout` and `bootstrap`. If the cap is present, it changes nothing, except to load a service an earlier run left unloaded. `JDOCMUNCH_WATCH_PLIST` points it at another plist.

A `SessionStart` hook, `.claude/hooks/watch-cap-hook.sh`, runs the script with `--check` on a fresh session, not on a resume. If the cap is missing, the session opens with a message naming the command. The hook never changes the plist.

## The `check` runner

`scripts/check.mjs` is `check` for each TypeScript workspace and for the root. It runs every step named on its command line, continues past failures, and ends by naming every step that failed. Each argument is a script in the manifest of the directory it runs in, so a manifest's `check` lists that workspace's gates.

The runner collects every failure rather than stopping at the first. A session told only about lint fixes lint, runs `check` again, and is then told about types.

pnpm can also select scripts by regular expression with `--no-bail`, but as of pnpm 11.24.0 that combination exits 0 when scripts fail. `pnpm -r --no-bail`, which the root uses across workspaces, does report a non-zero exit.

The worker has its own runner, `apps/worker/src/better_answers_worker/check.py`, because a uv workspace is not a pnpm workspace.

## The shared test Postgres

By default every test run starts its own Postgres container. A shared server per pinned image is opt-in on a laptop. In CI only `full-worker` uses it, started with `deploy/test-postgres.sh up`, so its four pytest workers share one server.

To use it, start the server for this checkout's pin and export the line it prints:

```sh
deploy/test-postgres.sh up
export TEST_POSTGRES_URI=shared
```

With `TEST_POSTGRES_URI=shared`, the warm harness in `packages/schema`, `packages/core`, and `apps/api`, and the worker's pytest harness, start no container. Each derives the server's address from the image that `packages/schema/src/postgres-image.ts` pins. Each tier clones its databases from a template named for a digest of `packages/schema/migrations` and the harness that builds it. The first run on a new migration set builds the template, and later runs reuse it. A `postgresql://` URI is used as given.

Each pinned image gets its own server, with the compose project and port derived from the image's digest, so a worktree on a newer pin gets a second server. The servers keep data in memory, so a Docker restart discards it, and the next run rebuilds its template in seconds. `TEST_POSTGRES_PORT` and `TEST_POSTGRES_PROJECT` override the derived port and project stem. These servers are separate from the dev database that `deploy/local-database.sh` starts.

| `deploy/test-postgres.sh` command | What it does |
| --- | --- |
| `up` | Starts this pin's server, and names any other server still running. |
| `address` | Prints this pin's project and address without starting anything. |
| `down` | Stops this pin's server and discards its data. |
| `down --all` | Stops every server. |

If the machine ran the older single shared server, run `deploy/test-postgres.sh down --all` once. It clears that server on port 55433, which otherwise returns after every Docker restart.

The shared servers follow these rules:

- If the variable is set but no server listens, or the URI is not a superuser, a run stops with a message naming `TEST_POSTGRES_URI` and the `up` command. It never falls back to a container.
- Every server carries its image as `better_answers.image`. Under `shared`, a run refuses a server with no stamp or another image's. With an explicit URI, it refuses another image's. If two pins derive one port, start the second with `TEST_POSTGRES_PORT=<free port> deploy/test-postgres.sh up` and export the same `TEST_POSTGRES_PORT`.
- Two loaded servers can exhaust the Docker VM's memory. Clear old servers with `down --all` once no worktree uses their pin.
- If a server runs out of memory, Postgres ends every session, and every run on it fails. Run `down`, then `up`.
- A run's databases carry its process id. The next run on the machine drops a killed run's databases once that process has gone.
- Each run stamps its template with its last use. The next run of the same tier drops a template unused for a day. A run held open longer can lose its template. Restart it to rebuild one.
- `pnpm reap-containers` and Ryuk select only containers that testcontainers labelled, so neither touches the shared servers.
- Some tests still start their own server. `roles-surface.test.ts` and `apps/api/tests/deploy/browse-role.test.ts` replay part of the migration history and read or alter roles across the whole server. A case in `warm-postgres/cold-start.test.ts` proves the path without a warm server. Garage still starts a container per run.
- Renovate proposes pin updates each weekend and holds a Postgres major in the Dependency Dashboard. Production's Postgres is a Coolify resource set to the pin by hand. After merging a pin update, re-point it to the new image reference. If pgvector's version moved, also run `ALTER EXTENSION vector UPDATE`.

## The tool configuration at the repository root

### `cubic.yaml`

`cubic.yaml` configures the reviewer, and Cubic reads it from `main` only. Cubic enables five custom agents per repository, the repository's own first, then the organization's, and drops a sixth with no error. Each custom rule takes one of those slots. The Principal rule holds the API-auth checks, tenant scoping and request validation, instead of a separate agent.

### `jscpd.config.mjs`

`jscpd.config.mjs` is a JavaScript module, not the `.jscpd.json` that jscpd reads by default. jscpd 5.1.2 parses its config as strict JSON. It rejects a `//` line, then runs on the defaults and exits zero. `scripts/jscpd.mjs` passes the module's values on the command line instead.

The threshold is zero, because a percentage gets loosened the day it fails. Fold each copy into a helper, or name it in the config or beside the copy with `jscpd:ignore-start` and `jscpd:ignore-end` comments.

jscpd skips these paths:

- The SPA's `shared/ui`, installed from a registry.
- `**/lifts/**`, a verbatim third-party snapshot edited upstream.
- `schema_view.py`, generated from the migration journal.
- The two lockfiles, excluded by name as well as by format.
- Build output, installed dependencies, the Python environment, and the agents' worktrees.

### `knip.config.ts`

knip runs over the pnpm workspace as a step of root `check`. A file no code reaches, an export nothing imports, a dependency no workspace uses, or a dependency used but undeclared fails the branch.

The configuration lists no process entry points. knip's plugins already reach the api's `main.ts`, `migrate.ts`, and `ops.ts`, the two servers the api's suite exposes, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint plugins, and the `check` runner. The plugins read the manifests' scripts, the SPA's `index.html`, and `.oxlintrc.json`'s `jsPlugins` specifiers. Listing the entry points again draws knip's "Remove redundant entry pattern" hint on every run. Leaving them inferred also means that the day a manifest stops naming one, knip reports the file as unreached.

The configuration does not name `.gitnexus/`, where each checkout keeps its GitNexus index. `.git/info/exclude` excludes the directory, and knip parses that file beside `.gitignore`, from a worktree too, through the worktree's `gitdir`. `knip --debug` lists both under "Parsed gitignore files". An `ignore` entry for the directory would suppress nothing and draw knip's "Remove from ignore" hint on every run. `packages/devtools/test/scans/knip.test.ts` fails if a knip release stops reading the exclude file. Do not silence hints with `--no-config-hints`, which also silences the redundant-entry hints.

`includeEntryExports` is on at the top level. By default knip reports nothing an entry file exports, treating it as published API. `packages/core`'s `exports` map makes every slice's barrel an entry, and nothing here is published, so an entry's unimported export is dead in every workspace. Only `apps/web` sets it to `false`, because its `src/shared/ui` is registry source installed ahead of the pages that will import it, and its `entry` covers those components. A workspace's own value overrides the top level's.

An export is kept ahead of its caller only when its action has no transport yet and a block under `docs/specs/route/` wires it. It carries knip's tag on its own `export` line, `/** @public <block> */`, for example `/** @public S3 */`, so the tag covers only that line's names. Remove the tag when the block's row in `docs/specs/v01-route.md` turns done. Never keep the input, result, or refusal types of an action a transport already reaches. The transport infers them, and a later block that needs a name adds one line to the barrel. Never delete a barrel. It is the list that `better-answers/import-direction` reads.

`--production` and `--strict` are diagnostics, not gates. Production mode drops the test entries and the manifests' scripts, so every test helper and script-run command, such as `migrate.ts` and `ops.ts`, reads as unused. Strict mode then refuses devDependencies in what it counts as production, so every devDependency a helper imports reads as unlisted.

### `pnpm-workspace.yaml`

`pnpm-workspace.yaml` is the workspace manifest. `apps/worker/` is a uv workspace, not a pnpm one. A documentation site would join the `packages:` list.

`allowBuilds` runs only esbuild's postinstall, which puts the platform binary where vite and drizzle-kit reach it. `cpu-features`, `protobufjs`, and `ssh2` are optional native accelerations the repository does not use. pnpm 11 runs a dependency's lifecycle scripts only when `allowBuilds` allows them, and fails an install on an undecided one. Each refused package, lefthook included, is therefore `false` rather than absent.

`patchedDependencies` holds two patches, each keyed by package name alone. A bump that leaves a patch's hunks applying installs unchanged. A bump that moves them fails the install on its own pull request.

- The testcontainers patch gives each test process its own Ryuk.
- The `@stryker-mutator/vitest-runner` 10.0.0 patch fixes two faults, and is retired when the fix is upstream. First, the runner joins a test's suite chain with a space where vitest 5 uses ` > `, so no mutant's name filter selects a test. The patch builds the name as vitest does (`docs/operations/CI.md`, *A runner fault fails the leg*). Second, a test file that failed to load, or a hook that threw, fails no test, so vitest never bails. The mutant reads survived, or under CI's contention reads Timeout, which counts as killed. The patch cancels the run on such a failure and counts one failed test, whose reason names the file, and the hook if one threw.
