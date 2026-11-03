# Local gates and worktrees

What runs on a developer's or an agent's own machine before CI sees anything: the git hooks `lefthook.yml` declares, the Claude Code hooks under `.claude/hooks/`, and the decisions the tool configuration files at the repository root carry. CI itself is `docs/operations/CI.md`.

## The pre-commit hook

One hook, its commands in parallel over staged files only. No test suite lives here — root `check` owns those. Five commands each run one workspace's own `typecheck` script (`tsc --noEmit`) over its own staged `.ts`/`.tsx` files, so a staged type error is refused at commit.

Measured cold on the owner's machine (Apple M4 Pro, 14 cores, 24 GiB; Docker VM 10 CPUs, 15.6 GiB): api 1.9s, web 1.8s, core 1.6s, schema 1.8s, devtools 1.0s. The api is the worst case, and `parallel: true` makes every command wait on the slowest rather than the sum, so 1.9s is the hook's own added cost.

A command runs only when a file under its own workspace is staged: a change in `packages/core` that breaks `apps/api`'s types passes this hook whenever no `apps/api` file is staged beside it. That is the price of a hook that stays seconds long rather than minutes; root `check` owns the cross-workspace case, and always will.

### How to skip, when you mean to

| Command | What it skips |
| --- | --- |
| `LEFTHOOK=0 git commit …` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=oxlint git commit …` | one command |
| `LEFTHOOK_EXCLUDE=oxfmt,oxlint git commit …` | several, comma-separated |

The command names in `lefthook.yml` are the names those variables take. A deliberate skip is one of these; it is never a deleted hook file, because the next `pnpm install` writes it back and the reason for the skip goes with it.

### How it is installed

The root `prepare` script runs `lefthook install`, and pnpm runs `prepare` after every install — so a fresh clone gets the hook with no step to remember. lefthook ships its own postinstall that would do the same, but pnpm 11 only runs a dependency's lifecycle scripts when `pnpm-workspace.yaml`'s `allowBuilds` says so, and that list is for native builds we have inspected, not for a tool wiring itself into `.git`. So `allowBuilds` refuses lefthook's postinstall (`lefthook: false`) and `prepare` does the installing in the open, in a script anyone reading the manifest can see.

`prepare` falls back to a message rather than failing, because pnpm runs it in two places that have no business holding a hook: the api's runtime image, where `--prod` leaves lefthook out of the tree entirely, and any install outside a git working tree. A fresh developer clone is the case that must work, and the check workflow asserts it on the only genuinely fresh clone we get — so the fallback cannot hide a real failure.

### What each command is for

- `oxfmt` writes, and `stage_fixed` puts what it wrote into the commit, so a formatting-only CI failure cannot happen and no second commit is needed to fix it. `--no-error-on-unmatched-pattern` is what makes handing over the whole staged set safe.
- `oxlint` runs the one lint config over the staged TypeScript and root scripts (`.ts`, `.tsx`, `.mjs`, `.js`), with the flag root `lint` passes, so a disable that suppresses nothing is refused at commit too. `--no-error-on-unmatched-pattern` lets through a commit whose only staged script the lint config ignores.
- `ruff-format` and `ruff-check` give both tiers the same first word. `root: apps/worker/` makes the staged paths relative to the worker, which is where `uv` finds the locked environment ruff lives in. `--only-group dev` syncs ruff's group and not the worker's own dependencies, so a commit never fetches torch: on Linux that comes from PyTorch's CPU wheel host, which a sandboxed clone may not reach.
- `comment-gate-python` runs the checker root `comment-gate:python` runs, over the staged `.py` files. It carries no `root:`, because the checker reads a file's place, such as `apps/worker/src/`, from its repository path.
- `actionlint` runs the command root `lint:workflows` runs, over the staged workflows alone. It and the shellcheck it runs over each `run:` step come from the worker's locked dev group, so a commit and CI read a workflow with the same versions. The first run builds actionlint's Python package, which downloads the release from GitHub and checks it against the hash the package carries. uv caches the build after that.
- The five `*-typecheck` commands are every workspace with a `typecheck` script but the design system, which has neither a `tsconfig.json` nor a `scripts` block. `root:` is what scopes each command to its own workspace's staged files, so these five never see each other's changes.

## The pre-push hook

Before a push that carries commits to a branch leaves the machine, the hook runs every step root `check:gates` names and the three prose suites `check:docs` adds to them: `check:docs:core`, `check:docs:devtools` and `check:docs:web`. `format:check` is in both scripts and runs once. In a sample of 30 failed pull requests, about half failed on one of these, and CI took five to nine minutes to say so. This hook says so before the push.

Each step is a command of its own, and the commands run in parallel. A failure therefore names its gate, and `LEFTHOOK_EXCLUDE` can skip one gate and keep the rest. The list repeats the steps the two scripts name, and `packages/devtools/test/root-config/lefthook-config.test.ts` holds it to them in both directions: a gate added to either script fails that suite until the hook runs it too. The same file pushes through the real `lefthook.yml` in a throwaway repository, with a stand-in `pnpm`, from the main checkout and from a linked worktree.

Measured on the owner's machine (the same one as above) with every gate passing, the whole hook took 20s to 24s over three runs on 12/10/2026, where `check:gates` and `check:docs` one after the other take about 37s. `check:docs:devtools` is the slowest command and sets the wait. The core suite starts Postgres in Docker, as every vitest run in that workspace does, so the hook needs Docker running.

A failed gate stops the push. The gates' summary names each failure with the command that runs it alone, and the hook's own summary under it marks `gates` failed:

```
✗ knip: run it alone with pnpm run knip (3.14 seconds)
```

The gates read the working tree, not the commits being pushed, so push from a clean tree. An untracked file counts too: `format:check` reads one that no ignore pattern covers, and refuses the push if it is unformatted.

### When the gates run

Git hands the hook one line per ref it pushes: the local ref and its sha, then the remote ref and its sha. `scripts/pre-push.sh` reads them, and runs the gates when any line sends a sha that is not all zeros to a ref under `refs/heads/`. Every other push carries no commit CI would check, so the script prints one line and lets it through:

```
gates skipped: every ref pushed is a deletion or outside refs/heads/, so none carries commits
```

That covers a tag's push or deletion, a ref in a namespace of its own (such as ordna's archived `refs/ordna/`), and a branch's deletion. A dirty working tree cannot block any of them. A tag pushed beside a branch's new commits still runs the gates, as does a branch push that only deletes files. The suite pushes each of these cases through the hook.

The gates live in a second hook, `pre-push-gates`, because lefthook hands git's lines to a job with `use_stdin` and to nothing else. A `skip` condition, a `setup` step and a `files` command all read an empty stdin, so none of them can tell a tag from a branch. `pre-push` is therefore one job, `gates`, which runs the script, and the script runs `pnpm exec lefthook run pre-push-gates`.

### How to skip the pre-push hook

| Command | What it skips |
| --- | --- |
| `git push --no-verify` | the whole hook, once |
| `LEFTHOOK_EXCLUDE=knip git push` | one gate |
| `LEFTHOOK_EXCLUDE=knip,check:docs:core git push` | several, comma-separated |

`LEFTHOOK=0` skips it as it skips the pre-commit hook. `pnpm exec lefthook run pre-push-gates` runs every gate without pushing. `lefthook run pre-push` by hand would wait on stdin for lines only git sends.

### What each command's `run` carries

- `{without-git-env}` unsets every variable `git rev-parse --local-env-vars` lists. Pushed from a linked worktree, git runs the hook with `GIT_DIR` set to the worktree's git directory, and every gate would inherit it. `GIT_DIR` outranks the directory `git -C <dir>` names, so a suite that builds a throwaway repository would read and write the worktree's own repository in its place. A push from the main checkout sets no `GIT_DIR`, so only a worktree shows this.
- `: {files};`, in the `gates` job alone, does nothing when it runs. It is there because a pre-push command that names no files template is skipped when the push changes no file still on disk, and a push that only deletes files is one of those. Naming `{files}` makes lefthook read the hook's own `files` list instead, which is `lefthook.yml` alone and never empty. lefthook skips on a push's files only in a hook named `pre-push`, so the commands of `pre-push-gates` need no such thing.

### Where it is installed

Git keeps hooks in the common git directory, so one `pre-push` serves the main checkout and every worktree, and each run reads the `lefthook.yml` of the checkout it runs in. `prepare` installs it with the other two. `pre-push-gates` is not a name git calls, so `lefthook install` writes no file for it. lefthook also re-installs the hooks whenever one of them runs under a `lefthook.yml` that has changed since the last install, so a checkout that has not run `pnpm install` since this hook landed picks it up at its next commit.

## The commit-message hook

The `commit-msg` hook runs commitlint over every commit's message. Its config, `commitlint.config.mjs` at the root, is the one the `pr-title` job in `check.yml` reads too, so one config checks the form everywhere. `packages/devtools/test/root-config/commit-msg-hook.test.ts` commits through the hook's own command in a throwaway repository: a Conventional message goes in, and a declarative subject, a subject naming its ticket and one over 90 characters are each refused.

## The Claude Code hooks

`.claude/settings.json` wires two scripts under `.claude/hooks/`: the worktree create hook and the doc watcher's cap.

### Creating a worktree

`worktree-create-hook.sh` replaces native worktree creation for every worktree Claude Code makes, such as an `Agent(isolation: "worktree")` fork or `claude --worktree`. Claude Code sends JSON on stdin carrying `.name`, and the hook's stdout must be exactly the created directory, so every diagnostic goes to stderr.

The layout stays native, `.claude/worktrees/<name>` on branch `worktree-<name>`, so the ignore patterns keep working. The base depends on where the request comes from, read from the input's `.cwd`, because `CLAUDE_PROJECT_DIR` names the main checkout in both cases. A request from the main checkout is independent work, so it starts from `origin/main` after a fetch, or from the local `main` when the fetch fails. A request from a linked worktree is a delegate building part of that session's branch, so it starts from that worktree's `HEAD`. The branch is made with `--no-track`, so a bare `git pull` or `git push` never aims at `main`.

The hook then gives the worktree a jCodeMunch index and a jDocMunch index of its own. Without them, every edit in the worktree registers in the main checkout's indexes. A machine without either tool gets a line on stderr and a worktree all the same.

The hook installs nothing. pnpm installs on the first `pnpm exec` and uv syncs on the first `uv run`. `packages/devtools/test/gates/worktree-create-hook.test.ts` holds the base choice, `--no-track` and the indexes.

Nothing in this repository removes a worktree. A hook-created worktree carries no Claude Code marker, so Claude Code's own sweep leaves it alone. pstack's worktree-cleanup playbook removes merged ones, and `pnpm reap-containers` removes stopped test containers.

### The doc watcher's log cap

The jDocMunch watcher runs as the launchd service `us.gravelle.jdocmunch-watch`. On 06/10/2026 a loop in it wrote a 159 GB `~/.doc-index/logs/watch.err`. Its plist now carries `SoftResourceLimits` → `FileSize` of 1 GB, so no file the watcher writes can grow past that. The limit binds the index files too, and the largest is 64 MB, so the cap stays far above it.

`jdocmunch-mcp watch-install` writes the plist afresh and drops the cap. Put it back with:

```
bash scripts/jdocmunch-watch-cap.sh
```

It adds the cap and reloads the service with `launchctl bootout` and `bootstrap`. When the cap is already there it changes nothing, unless an earlier run left the service unloaded, and then it loads it. A `SessionStart` hook, `.claude/hooks/watch-cap-hook.sh`, runs it with `--check` when a session starts fresh, not on a resume. When the cap is missing, the session opens with a message naming the command. The hook only reads the plist: nothing but a person running the script changes it. Set `JDOCMUNCH_WATCH_PLIST` to point the script at another plist.

## The `check` runner

`scripts/check.mjs` is `check` for a TypeScript workspace and for the root: it runs every step named on its command line, even after one fails, and ends by naming all of them. Each argument is a script in the manifest of the directory it runs in, so a manifest's `check` reads as the list of gates that workspace has and adding one is a word. Failures are collected rather than thrown at the first, because a session told only about lint fixes lint, runs `check` again, and is then told about types — three runs of a browser suite to learn three things.

pnpm can select scripts by regular expression and `--no-bail` will keep going past a failure, but as of pnpm 11.24.0 that combination exits 0 with failed scripts behind it, which is the silent pass this file exists to refuse. `pnpm -r --no-bail` — the recursive form the root uses over the workspaces — does report a non-zero exit and is unaffected. The worker's equivalent is `apps/worker/src/better_answers_worker/check.py`; the two are separate because a uv workspace is not a pnpm one and neither tier can run the other's.

## The shared test Postgres

By default every test run starts its own Postgres container. Several worktrees running `check` at once then run several servers, and on 15/10/2026 four of them took a 14-core Mac to a load average of 45. One shared server per pinned image avoids that. It is opt-in on a laptop. In CI only `full-worker` uses it, started with `deploy/test-postgres.sh up`, so that the suite's four pytest workers share one server instead of starting four.

Start the server for this checkout's pin, then export the line it prints:

```sh
deploy/test-postgres.sh up
export TEST_POSTGRES_URI=shared
```

With `TEST_POSTGRES_URI=shared`, the warm harness in `packages/schema`, `packages/core` and `apps/api`, and the worker's pytest harness, start no Postgres container. Each works out its server's address from the image `packages/schema/src/postgres-image.ts` pins, so the variable needs no change when a branch moves to another pin. Each tier clones its databases from a template on that server. The template is named for a digest of `packages/schema/migrations` and of the harness that builds it, so worktrees on different migrations never share one. The first run on a new migration set builds its template, and every later run reuses it. Leave the variable unset, or empty, and a run starts its own container as before. A `postgresql://` URI in the variable is used as given.

Each pinned image gets its own server: the compose project and port come from the image's digest. A worktree on a newer pin runs `up` and gets a second server beside the first, so neither wipes nor borrows the other. `deploy/test-postgres.sh address` prints the project and address for this checkout's pin without starting anything. `up` names any other server still running. `down` stops this pin's server and discards everything on it, and `down --all` stops every one. Their data lives in memory, so a Docker restart discards it too, and the next run rebuilds its template in seconds. `TEST_POSTGRES_PORT` and `TEST_POSTGRES_PROJECT` move a server off its derived port and project stem. They are separate servers from the dev database `deploy/local-database.sh` starts.

After upgrading from the single shared server, run `deploy/test-postgres.sh down --all` once. It also clears the old server on port 55433, which would otherwise come back after every Docker restart.

What to expect:

- A run with the variable set but no server listening, or a URI that is not a superuser, stops at once with a line naming `TEST_POSTGRES_URI` and the `up` command. It never falls back to a container.
- Every server carries its image as `better_answers.image`. Under `shared`, a run refuses a server with no stamp or another image's; with an explicit URI, it refuses another image's. That catches the rare case of two pins deriving one port: start the second with `TEST_POSTGRES_PORT=<free port> deploy/test-postgres.sh up` and export the same `TEST_POSTGRES_PORT`.
- Two loaded servers can exhaust the Docker VM's memory. Clear old ones with `down --all` once no worktree uses their pin.
- If a server runs out of memory, Postgres stops every session at once, and every run using it fails together. `down` then `up` clears it.
- A run's databases carry its process id. A run that is killed leaves them behind, and the next run on the machine drops them once that process has gone.
- Each run stamps its template with the time it used it. A template no run has used for a day is dropped by the next run of the same tier, so old migration sets do not fill the server. A run held open for longer than a day can lose its template; restart it and it rebuilds one.
- `pnpm reap-containers` and Ryuk select only containers testcontainers labelled, so neither touches the shared servers.
- Some test files still start a server of their own: the two that replay part of the migration history, `roles-surface.test.ts` and `apps/api/tests/deploy/browse-role.test.ts`, which read or alter roles across the whole server, and the case in `warm-postgres/cold-start.test.ts` that proves the path without a warm server. Garage still starts a container per run.
- Renovate proposes updates to the pin each weekend and holds a Postgres major in the Dependency Dashboard. Production's Postgres is a Coolify resource set to the pin by hand: after merging a pin update, re-point it to the new image reference, and run `ALTER EXTENSION vector UPDATE` when pgvector's version moved.

## The tool configuration at the repository root

**`cubic.yaml`** is the reviewer's configuration, read from `main` only. Cubic enables five custom agents per repository, the repository's own first and then the organization's, and drops a sixth with no error, so each custom rule takes one of those slots; the API-auth agent was absorbed into the Principal rule rather than deleted, tenant scoping and request validation being what that rule is for.

**`jscpd.config.mjs`** is a JavaScript module and not the `.jscpd.json` the tool reads on its own. jscpd 5.1.2 parses its config with a strict JSON parser — a `//` line is rejected, and the run then continues on the defaults and exits zero, so a config nobody could read looks exactly like a tree with nothing in it. `scripts/jscpd.mjs` turns these values into the command line instead, which the tool cannot half-read. The threshold is zero because a percentage is a dial someone tunes down the day it fires; a copy is either folded into a helper or named, in the config or beside the copy itself with jscpd's `jscpd:ignore-start` and `jscpd:ignore-end` comments.

What it is blind to, and why: the SPA's `shared/ui` is installed from a registry rather than written; `**/lifts/**` is a verbatim third-party snapshot edited upstream; `schema_view.py` is generated from the migration journal, so two tables with the same columns are the schema's doing; the two lockfiles are resolver output, excluded by name as well as by format; and build output, installed dependencies, the Python environment and the agents' worktrees are not source this repository writes.

**`knip.config.ts`** runs over the pnpm workspace as a step of root `check`: a file no code reaches, an export nothing imports, a dependency no workspace uses and a dependency used but never declared each fail the branch.

The tier's process entry points are deliberately not listed. The api's `main.ts`, `migrate.ts` and `ops.ts`, the two servers its suite exposes, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint plugins and the `check` runner are every one of them already reached by knip's own plugins, which read the manifests' scripts, the SPA's `index.html` and `.oxlintrc.json`'s `jsPlugins` specifiers. Naming them again is a second copy of the manifest, and knip says so on every run ("Remove redundant entry pattern"): a configuration that argues with the tool teaches the next session to ignore its output. Leaving them inferred also keeps the gate honest — the day a manifest stops naming one, knip reports the file as unreached rather than an entry nobody starts.

Nothing in the configuration names `.gitnexus/`. A GitNexus index is written there per checkout and excluded from git through `.git/info/exclude`, and knip parses that file beside `.gitignore` — from a worktree too, following the worktree's `gitdir` to the common one; `knip --debug` lists both under "Parsed gitignore files". The directory is therefore invisible to knip in every checkout, analysed or not, and an `ignore` naming it would suppress nothing, which knip prints as "Remove from ignore" on every run: that hint fires when a pattern suppresses no issue, not when it matches no file. `packages/devtools/test/scans/knip.test.ts` proves the exclude file is read, both ways, so a knip release that stopped reading it fails there before the gate names `.gitnexus/run.cjs`. Silencing a hint is `--no-config-hints` and nothing narrower, which would take the redundant-entry hints with it, and those are the ones this configuration is written to keep agreeing with.

`includeEntryExports` is on at the top level. By default knip reports nothing an entry file exports, reading an entry as a package's published API, and `packages/core`'s `exports` map makes every slice's barrel an entry, so a re-export nothing imported used to pass the gate. Nothing in this repository is published, so an entry's export that nothing imports is as dead as any other, in every workspace and in the next one added. `apps/web` alone writes it out as `false`: its `src/shared/ui` is registry source installed ahead of the pages that will import it (ADR 0033), and an export of a component nothing imports yet is no more dead than the component, which its `entry` already says. The suite reads each workspace's value the way knip does, a workspace's own before the top level's, and proves both halves over a throwaway slice.

An export is kept ahead of its caller only when the action it belongs to has no transport yet and a block under `docs/specs/route/` wires it. It carries knip's own tag on an `export` line of its own, `/** @public <block> */` — `/** @public S3 */` — so the tag covers the names beside it and no others, and the tag goes when the block's row in `docs/specs/v01-route.md` turns done. The input, result and refusal types of an action a transport already reaches are never kept: the transport infers them, and a later block that wants a name by hand adds one line to the barrel. A barrel itself is never deleted, because it is the slice's face, the list `better-answers/import-direction` reads (ADR 0029).

`--production` and `--strict` are diagnostics, not gates. Production mode drops the test entries and the manifests' scripts, so every test helper and every script-run command — `migrate.ts` and `ops.ts` — reads as unused; strict mode then refuses devDependencies to what it counts as production, so every devDependency a helper imports reads as unlisted. Gating either would mean a second copy of every manifest's entry points as production patterns, the copy the paragraph on entry points above refuses.

**`pnpm-workspace.yaml`** is the workspace manifest. `apps/worker/` is a uv workspace, not a pnpm one, and a documentation site would join the `packages:` list the day one is lifted in.

`allowBuilds` runs one package's postinstall script, esbuild's, because that script puts the platform binary where vite and drizzle-kit reach it. `cpu-features`, `protobufjs` and `ssh2` are optional native accelerations we do not take. lefthook is `false` for the reason above. `false` rather than no entry at all, because pnpm 11 makes an undecided build script a hard error and silence would fail every fresh install.

`patchedDependencies` holds two patches, and a patch is a liability at every upgrade, so each reason is written down. Each is keyed by package name alone, so a bump that leaves its hunks applying installs unchanged, and one that moves them fails the install on its own pull request. The testcontainers patch gives each test process a Ryuk of its own. `@stryker-mutator/vitest-runner` 10.0.0 joins a test's suite chain with a space where vitest 5 joins it with ` > `, so no mutant's name filter selected a test, and the patch builds the name as the running vitest does (`docs/operations/CI.md`, *A runner fault fails the leg*). It also misses a suite that fails on its own. A test file that failed to load, or a hook that threw, fails no test, so vitest never bails. The run goes on through every related file, and the mutant reads survived, or under CI's contention waits out its suite and reads Timeout, which counts as killed. The patch cancels the run on such a failure and counts it as one failed test, whose reason names the file, and the hook when one threw. It is retired when the fix is upstream.
