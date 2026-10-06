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
- `oxlint` runs the one lint config over the staged TypeScript, with the flag root `lint` passes, so a disable that suppresses nothing is refused at commit too.
- `ruff-format` and `ruff-check` give both tiers the same first word. `root: apps/worker/` makes the staged paths relative to the worker, which is where `uv` finds the locked environment ruff lives in. `--only-group dev` syncs ruff's group and not the worker's own dependencies, so a commit never fetches torch: on Linux that comes from PyTorch's CPU wheel host, which a sandboxed clone may not reach.
- `actionlint` runs the command root `lint:workflows` runs, over the staged workflows alone. It and the shellcheck it runs over each `run:` step come from the worker's locked dev group, so a commit and CI read a workflow with the same versions. The first run builds actionlint's Python package, which downloads the release from GitHub and checks it against the hash the package carries. uv caches the build after that.
- The five `*-typecheck` commands are every workspace with a `typecheck` script but the design system, which has neither a `tsconfig.json` nor a `scripts` block. `root:` is what scopes each command to its own workspace's staged files, so these five never see each other's changes.

## The pre-push hook

Before a push that carries commits to a branch leaves the machine, the hook runs every step root `check:gates` names and the four prose suites `check:docs` adds to them: `check:docs:api`, `check:docs:core`, `check:docs:devtools` and `check:docs:web`. `format:check` is in both scripts and runs once. In a sample of 30 failed pull requests, about half failed on one of these, and CI took five to nine minutes to say so. The merge queue is the only full CI run, so this hook is where a pull request hears about them first.

Each step is a command of its own, and the commands run in parallel. A failure therefore names its gate, and `LEFTHOOK_EXCLUDE` can skip one gate and keep the rest. The list repeats the steps the two scripts name, and `packages/devtools/test/lefthook-config.test.ts` holds it to them in both directions: a gate added to either script fails that suite until the hook runs it too. The same file pushes through the real `lefthook.yml` in a throwaway repository, with a stand-in `pnpm`, from the main checkout and from a linked worktree.

Measured on the owner's machine (the same one as above) with every gate passing, the whole hook took 22s to 23s over three runs, where `check:gates` and `check:docs` one after the other take about 30s. `check:docs:api` is the slowest command and sets the wait. The api and core suites start Postgres in Docker, as every vitest run in those two workspaces does, so the hook needs Docker running.

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
| `LEFTHOOK_EXCLUDE=knip,check:docs:api git push` | several, comma-separated |

`LEFTHOOK=0` skips it as it skips the pre-commit hook. `pnpm exec lefthook run pre-push-gates` runs every gate without pushing. `lefthook run pre-push` by hand would wait on stdin for lines only git sends.

### What each command's `run` carries

- `{without-git-env}` unsets every variable `git rev-parse --local-env-vars` lists. Pushed from a linked worktree, git runs the hook with `GIT_DIR` set to the worktree's git directory, and every gate would inherit it. `GIT_DIR` outranks the directory `git -C <dir>` names, so a suite that builds a throwaway repository would read and write the worktree's own repository in its place. A push from the main checkout sets no `GIT_DIR`, so only a worktree shows this.
- `: {files};`, in the `gates` job alone, does nothing when it runs. It is there because a pre-push command that names no files template is skipped when the push changes no file still on disk, and a push that only deletes files is one of those. Naming `{files}` makes lefthook read the hook's own `files` list instead, which is `lefthook.yml` alone and never empty. lefthook skips on a push's files only in a hook named `pre-push`, so the commands of `pre-push-gates` need no such thing.

### Where it is installed

Git keeps hooks in the common git directory, so one `pre-push` serves the main checkout and every worktree, and each run reads the `lefthook.yml` of the checkout it runs in. `prepare` installs it with the other two. `pre-push-gates` is not a name git calls, so `lefthook install` writes no file for it. lefthook also re-installs the hooks whenever one of them runs under a `lefthook.yml` that has changed since the last install, so a checkout that has not run `pnpm install` since this hook landed picks it up at its next commit.

## The commit-message hook

The `commit-msg` hook runs commitlint over every commit's message. Its config, `commitlint.config.mjs` at the root, is the one the `pr-title` job in `check.yml` reads too, so one config checks the form everywhere (`docs/agents/workflow.md`, *The commit's form*). `packages/devtools/test/commit-msg-hook.test.ts` commits through the hook's own command in a throwaway repository: a Conventional message goes in, and a declarative subject, a subject naming its ticket and one over 90 characters are each refused.

## The Claude Code hooks

`.claude/settings.json` wires three scripts under `.claude/hooks/`.

### The write-time comment gate

`comment-gate-hook.sh` runs the comment gates root `check` runs over the one file an agent has just written. It forwards each gate's own message rather than restating it. Exit 2 is the only code whose stderr reaches the model; every other outcome exits 0, so a machine without the tooling refuses no edit.

For a TypeScript file it runs root `lint`: the root config, `.oxlintrc.json`, with the `lint` script's flag, over any file the root run walks. It refuses the edit only on a comment rule's line, and leaves another rule's finding to `check`. For a Python file it runs the Python gate, over the roots that gate walks: `apps/`, `packages/`, `scripts/`, `.claude/hooks/`, `.github/`, `deploy/` and three root tool-configuration files.

`packages/devtools/test/comment-gate-hook.test.ts` holds the hook's roots to the Python gate's command in both directions. It also proves, through the hook, each comment rule the root config holds.

### Creating and removing a worktree

`worktree-create-hook.sh` replaces native worktree creation so every worktree Claude Code makes — an `Agent(isolation: "worktree")` fork, `claude --worktree`, a desktop parallel session — is provisioned before the agent's first turn. The hook contract is Claude Code's: JSON on stdin carrying `.name`, and stdout must be exactly the created directory, a non-path there aborting session startup.

The layout stays native — `.claude/worktrees/<name>` on branch `worktree-<name>` — so `.gitignore` and oxlint's and oxfmt's ignore patterns keep working unchanged. The branch starts from the checkout's HEAD: `main` is pushed before any fork, and a fork briefed to work from its worktree HEAD must see what the session sees. A hook-created worktree carries no Claude Code marker, so Claude Code's own periodic sweep leaves it alone. The remove hook and `sweep-worktrees.sh` are what remove it.

`worktree-remove-hook.sh` is the cleanup half, and it sees less than its name suggests. Claude Code fires it only when an agent finishes having changed nothing. A worktree with a commit in it is kept and reported back, and no hook runs. The owner's transcripts show this: of 296 worktree agents that committed, 292 had their worktree reported kept. So the hook nearly always meets a fresh worktree, and removes it. When it does meet work, it keeps the worktree unless the work is merged:

- changed or untracked files are always kept;
- commits are merged when `origin/main` or `main` holds them, or when a merged pull request has the worktree's HEAD as its head. The hook fetches `origin/main` before it gives up, because the main checkout's `main` is rarely pulled.

A kept worktree is removed by hand with `git worktree remove --force`. The hook may tidy and never block, so every outcome exits 0 and says why on stderr.

`sweep-worktrees.sh [<main-checkout>]` removes what the remove hook never sees: the worktree whose agent committed, pushed and merged. Before the sweep, those piled up under `.claude/worktrees/` until someone cleared them by hand. The create hook starts it in the background on every creation, with its streams on `.git/worktree-sweep.log`, which holds the latest run. Creation is the one event that happens as often as worktrees pile up and needs nobody to remember it; a step after the merge is one an agent can skip. Run the sweep by hand to clear the estate at once. It fetches `origin/main` first, and then, for each worktree under `.claude/worktrees/` and nowhere else:

- a locked worktree, or one with changed or untracked files, is kept;
- a HEAD on `origin/main`'s first-parent line is kept. It holds no commit of its own, which is how a fresh worktree looks while its agent works;
- a HEAD that reached `origin/main` through a merge commit, as the queue lands every pull request, is merged. So is a HEAD that a merged pull request has as its head, which gh answers;
- a merge less than an hour old is kept, because the agent may still be reporting from the worktree, or be resumed in it;
- anything else merged is removed, with its index, and its branch goes through `git branch -d`, never `-D`. The branch's upstream is pointed at `origin/main` first, so `-d` checks the ref the sweep judged by, where it would otherwise check the main checkout's lagging `main`. A squash-merged branch fails that check and stays for a person.

A worktree the hook or the sweep removes also gives up the jCodeMunch index provisioning gave it. Without that, the registry keeps naming a root no longer on disk — the state the owner's machine was found in, seven create events and no removals, the oldest naming a path gone for a fortnight. A jCodeMunch repository id is not derivable from its path, so it is read from what `list-repos --json` prints.

A worktree removed any other way, by the harness, by hand or by `rm -rf`, runs neither, and its jDocMunch index outlived it: 28 of 33 doc indexes named a gone folder on 06/10/2026. So each sweep run also drops every doc index whose root lies under `.claude/worktrees/` and is no longer a directory, read from what `jdocmunch-mcp watch-status` prints. An index whose folder exists, or that lies anywhere else, is left alone.

### Provisioning a worktree

`provision-worktree.sh <worktree-path>` installs a fresh checkout's dependencies and the agent tooling a checkout cannot carry, so an agent's first act in a worktree is its task and not `pnpm install`. The create hook runs it; run it by hand after a `git worktree add`, which fires no hook. Six stages, each reporting on its own line and none stopping the next:

| Stage | What it does |
| --- | --- |
| upstream | unsets the tracking branch — see below |
| pnpm install | the TypeScript workspaces |
| uv sync | the Python worker |
| jcodemunch index | the worktree as a jCodeMunch root of its own |
| skills | `provision-skills.sh`: the installed, ignored agent tooling |
| scratch | the primary checkout's `.scratch`, linked |
| planning | the primary checkout's `.planning`, linked, for the same reasons as `.scratch` |
| personas | `docs/personas`, a relative link to `.planning/personas`, where `/ce-dogfood` reads personas |

**The upstream.** `git worktree add -b <branch> <path> origin/main` sets the new branch to track `origin/main`, silently: a bare `git push` from the worktree then aims at `main`. `push.default` is unset here, so git's `simple` refuses the mismatched push — the tracking is surprising rather than harmful — and the stage unsets it so the branch's upstream is set on its first `git push -u`, by the session that means it. Here and not in the create hook, because a worktree made by hand fires no hook and runs this.

**Why `node_modules` and `.venv` are installed, never symlinked or copied.** pnpm and uv both install by hard link from a global store, in seconds, and both write links that are relative to the real tree: pnpm's workspace links (`node_modules/@better-answers/core -> ../../packages/core`) and uv's editable `.pth`. A `node_modules` or `.venv` shared with `main` would import main's `packages/core` and worker source, so a worktree's tests would run against code it is not editing. That reasoning is about path resolution and does not reach the skills, which are static markdown; `provision-skills.sh` copies those.

**Why the index is given at creation.** jCodeMunch resolves an edited file into the nearest containing indexed root. Until the worktree is one, every file an agent edits in it is registered into the *primary checkout's* index under `.claude/worktrees/…`, where a later search answers out of a ticket that is not the reader's, or out of a worktree no longer on disk. The verb is the CLI's own `index <path>`; `index_folder` is the MCP tool's name and is not something a script can call. A machine without jCodeMunch is not a broken worktree, so that case says what it costs and leaves the exit status alone — the shape `actionlint` has in `lefthook.yml` — while an index that was attempted and failed is a stage failure like any other.

**Why `.scratch` is linked, never copied** — the opposite of the skills stage's reasoning, for three reasons a copy cannot answer. It is 1.2 GB across 45,256 files, so a copy per worktree is out. It is living context rather than static material: another session writes a note into it while a worktree is open, and a copy is stale from that moment. And a note an agent writes through the link outlives the worktree, where a copy is deleted with it. The cost, which is real: the link is read-write and shared, so every agent in every worktree writes into the one unversioned folder the primary checkout holds — there is no per-worktree `.scratch` to lose work in, and none to keep work private in either.

The link cannot bloat the worktree's jCodeMunch index, for two independent reasons: `jcodemunch-mcp index` walks a directory symlink only under `--follow-symlinks`, which this script does not pass, and `.gitignore` names `.scratch` besides. Measured over a throwaway tree: 3 files indexed, then the 45,256-file `.scratch` linked into it and re-indexed — 0 new files, and 0 again for a symlinked directory that no ignore pattern covered.

That `.gitignore` pattern carries no trailing slash on purpose. Git reads a symlink as a file, so `.scratch/` would match the primary's directory and leave every worktree's link showing as `?? .scratch`: the remove hook would then keep each worktree as one holding untracked work, and a `git add -A` would commit the link. `.planning` and `docs/personas` are ignored the same way.

**Why the personas are linked, not committed.** They carry client material, and the repository is public. `docs/personas` is relative, so the one link resolves in the primary checkout and, through the `.planning` link, in every worktree. A cloud session has neither, and `/ce-dogfood` there infers a persona and says so.

Nothing is copied from `.env.local`: no workspace, test or compose file reads it, and tests reach Postgres through Testcontainers. If that changes, copy the file here — a `WorktreeCreate` hook suppresses `.worktreeinclude`.

### Provisioning the skills

`provision-skills.sh <worktree-path>` is the skills stage, and is runnable by hand. It copies every `.agents/skills` entry and `skills-lock.json` the primary checkout has and the worktree does not; reinstalls from the manifest when the copy left the worktree with nothing; and then verifies that every skill link — the root's at depth two and each workspace's at depth four — resolves inside the worktree. The worktrees, the installs and the dependency trees are pruned rather than merely excluded from the walk, so a large `node_modules` is never entered.

## The `check` runner

`scripts/check.mjs` is `check` for a TypeScript workspace and for the root: it runs every step named on its command line, even after one fails, and ends by naming all of them. Each argument is a script in the manifest of the directory it runs in, so a manifest's `check` reads as the list of gates that workspace has and adding one is a word. Failures are collected rather than thrown at the first, because a session told only about lint fixes lint, runs `check` again, and is then told about types — three runs of a browser suite to learn three things.

pnpm can select scripts by regular expression and `--no-bail` will keep going past a failure, but as of pnpm 11.24.0 that combination exits 0 with failed scripts behind it, which is the silent pass this file exists to refuse. `pnpm -r --no-bail` — the recursive form the root uses over the workspaces — does report a non-zero exit and is unaffected. The worker's equivalent is `apps/worker/src/better_answers_worker/check.py`; the two are separate because a uv workspace is not a pnpm one and neither tier can run the other's.

## The tool configuration at the repository root

**`cubic.yaml`** is the reviewer's configuration, read from `main` only. Cubic enables five custom agents per repository, the repository's own first and then the organization's, and drops a sixth with no error, so each custom rule takes one of those slots; the API-auth agent was absorbed into the Principal rule rather than deleted, tenant scoping and request validation being what that rule is for.

**`jscpd.config.mjs`** is a JavaScript module and not the `.jscpd.json` the tool reads on its own. jscpd 5.1.2 parses its config with a strict JSON parser — a `//` line is rejected, and the run then continues on the defaults and exits zero, so a config nobody could read looks exactly like a tree with nothing in it. `scripts/jscpd.mjs` turns these values into the command line instead, which the tool cannot half-read. The threshold is zero because a percentage is a dial someone tunes down the day it fires; a copy is either folded into a helper or named, in the config or beside the copy itself with jscpd's `jscpd:ignore-start` and `jscpd:ignore-end` comments.

What it is blind to, and why: the SPA's `shared/ui` is installed from a registry rather than written; `**/lifts/**` is a verbatim third-party snapshot edited upstream; `schema_view.py` is generated from the migration journal, so two tables with the same columns are the schema's doing; the two lockfiles are resolver output, excluded by name as well as by format; and build output, installed dependencies, the Python environment and the agents' worktrees are not source this repository writes.

**`knip.config.ts`** runs over the pnpm workspace as a step of root `check`: a file no code reaches, an export nothing imports, a dependency no workspace uses and a dependency used but never declared each fail the branch.

The tier's process entry points are deliberately not listed. The api's `main.ts`, `migrate.ts` and `ops.ts`, the two servers its suite exposes, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint plugins and the `check` runner are every one of them already reached by knip's own plugins, which read the manifests' scripts, the SPA's `index.html` and `.oxlintrc.json`'s `jsPlugins` specifiers. Naming them again is a second copy of the manifest, and knip says so on every run ("Remove redundant entry pattern"): a configuration that argues with the tool teaches the next session to ignore its output. Leaving them inferred also keeps the gate honest — the day a manifest stops naming one, knip reports the file as unreached rather than an entry nobody starts.

Nothing in the configuration names `.gitnexus/`. A GitNexus index is written there per checkout and excluded from git through `.git/info/exclude`, and knip parses that file beside `.gitignore` — from a worktree too, following the worktree's `gitdir` to the common one; `knip --debug` lists both under "Parsed gitignore files". The directory is therefore invisible to knip in every checkout, analysed or not, and an `ignore` naming it would suppress nothing, which knip prints as "Remove from ignore" on every run: that hint fires when a pattern suppresses no issue, not when it matches no file. `packages/devtools/test/knip.test.ts` proves the exclude file is read, both ways, so a knip release that stopped reading it fails there before the gate names `.gitnexus/run.cjs`. Silencing a hint is `--no-config-hints` and nothing narrower, which would take the redundant-entry hints with it, and those are the ones this configuration is written to keep agreeing with.

`includeEntryExports` is on at the top level. By default knip reports nothing an entry file exports, reading an entry as a package's published API, and `packages/core`'s `exports` map makes every slice's barrel an entry, so a re-export nothing imported used to pass the gate. Nothing in this repository is published, so an entry's export that nothing imports is as dead as any other, in every workspace and in the next one added. `apps/web` alone writes it out as `false`: its `src/shared/ui` is registry source installed ahead of the pages that will import it (ADR 0033), and an export of a component nothing imports yet is no more dead than the component, which its `entry` already says. The suite reads each workspace's value the way knip does, a workspace's own before the top level's, and proves both halves over a throwaway slice.

An export is kept ahead of its caller only when the act it belongs to has no transport yet and a block in `docs/specs/v01-route.md` wires it. It carries knip's own tag on an `export` line of its own, `/** @public <block> */` — `/** @public S3 */` — so the tag covers the names beside it and no others, and the block says when the tag should go. The input, result and refusal types of an act a transport already reaches are never kept: the transport infers them, and a later block that wants a name by hand adds one line to the barrel. A barrel itself is never deleted, because it is the slice's face, the list `better-answers/import-direction` reads (ADR 0029).

`--production` and `--strict` are diagnostics, not gates. Production mode drops the test entries and the manifests' scripts, so every test helper and every script-run command — `migrate.ts`, `ops.ts`, `land.ts` — reads as unused; strict mode then refuses devDependencies to what it counts as production, so every devDependency a helper imports reads as unlisted. Gating either would mean a second copy of every manifest's entry points as production patterns, the copy the paragraph on entry points above refuses.

**`pnpm-workspace.yaml`** is the workspace manifest. `apps/worker/` is a uv workspace, not a pnpm one, and a documentation site would join the `packages:` list the day one is lifted in.

`allowBuilds` runs one package's postinstall script, esbuild's, because that script puts the platform binary where vite and drizzle-kit reach it. `cpu-features`, `protobufjs` and `ssh2` are optional native accelerations we do not take, and `@ast-grep/cli` runs without its copy step. lefthook is `false` for the reason above. `false` rather than no entry at all, because pnpm 11 makes an undecided build script a hard error and silence would fail every fresh install.

`patchedDependencies` holds two patches, and a patch is a liability at every upgrade, so each reason is written down. Each is keyed by package name alone, so a bump that leaves its hunks applying installs unchanged, and one that moves them fails the install on its own pull request. The testcontainers patch gives each test process a Ryuk of its own (`docs/agents/workflow.md`, *Environment*). `@stryker-mutator/vitest-runner` 10.0.0 joins a test's suite chain with a space where vitest 5 joins it with ` > `, so no mutant's name filter selected a test, and the patch builds the name as the running vitest does (`docs/operations/CI.md`, *A runner fault fails the leg*). It also misses a suite that fails on its own. A test file that failed to load, or a hook that threw, fails no test, so vitest never bails. The run goes on through every related file, and the mutant reads survived, or under CI's contention waits out its suite and reads Timeout, which counts as killed. The patch cancels the run on such a failure and counts it as one failed test, whose reason names the file, and the hook when one threw. It is retired when the fix is upstream.
