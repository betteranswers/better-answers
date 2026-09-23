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
- `ruff-format` and `ruff-check` give both tiers the same first word. `root: apps/worker/` makes the staged paths relative to the worker, which is where `uv` finds the locked environment ruff lives in.
- `actionlint` is a Homebrew binary, not an npm package, so a clone may not have it. A warning and a pass, never a failure: a tool nobody installed must not block a commit.
- The five `*-typecheck` commands are every workspace with a `typecheck` script but the design system, which has neither a `tsconfig.json` nor a `scripts` block. `root:` is what scopes each command to its own workspace's staged files, so these five never see each other's changes.

## The commit-message ceiling

The `commit-msg` hook holds every commit's subject to 72 characters, not just `pnpm land`'s. The number is written twice — in `lefthook.yml` and in `packages/devtools/src/land.ts` — because nothing either could import binds a shell one-liner to a TypeScript constant. What holds them to one number is `packages/devtools/test/land.test.ts`, which reads both and fails when they disagree; it also runs the command over a message file both ways.

## The Claude Code hooks

`.claude/settings.json` wires three scripts under `.claude/hooks/`.

### The write-time comment gate

`comment-gate-hook.sh` runs the same comment gate root `check` runs over the one file an agent has just written, and forwards the gate's own message rather than restating it. Exit 2 is the only code whose stderr reaches the model; every other outcome exits 0, so a machine without the tooling refuses no edit. It reads `apps/` and `packages/` only, those being the two roots root `check` hands the TypeScript and Python gates.

### Creating and removing a worktree

`worktree-create-hook.sh` replaces native worktree creation so every worktree Claude Code makes — an `Agent(isolation: "worktree")` fork, `claude --worktree`, a desktop parallel session — is provisioned before the agent's first turn. The hook contract is Claude Code's: JSON on stdin carrying `.name`, and stdout must be exactly the created directory, a non-path there aborting session startup.

The layout stays native — `.claude/worktrees/<name>` on branch `worktree-<name>` — so `.gitignore` and oxlint's and oxfmt's ignore patterns keep working unchanged. The branch starts from the checkout's HEAD: `main` is pushed before any fork, and a fork briefed to work from its worktree HEAD must see what the session sees. A hook-created worktree carries no Claude Code marker, so the periodic sweep leaves it alone; the remove hook and `git worktree remove` are the two ways it goes.

`worktree-remove-hook.sh` is the cleanup half. It applies Claude Code's own rule for native worktrees: a clean worktree goes, and one holding work stays on disk for a person to look at. "Work" is changed or untracked files, or commits its upstream (or `main`, when it has none) does not have. A kept worktree is removed by hand with `git worktree remove --force`. The hook may tidy and never block, so every outcome exits 0 and says why on stderr.

A worktree removed here also gives up the jCodeMunch index provisioning gave it. Without that, the registry keeps naming a root no longer on disk — the state the owner's machine was found in, seven create events and no removals, the oldest naming a path gone for a fortnight. A jCodeMunch repository id is not derivable from its path, so it is read from what `list-repos --json` prints.

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

**The upstream.** `git worktree add -b <branch> <path> origin/main` sets the new branch to track `origin/main`, silently: a bare `git push` from the worktree then aims at `main`, and the remove hook measures "work" against that upstream rather than against `main`. `push.default` is unset here, so git's `simple` refuses the mismatched push — the tracking is surprising rather than harmful — and the stage unsets it so the branch's upstream is set on its first `git push -u`, by the session that means it. Here and not in the create hook, because a worktree made by hand fires no hook and runs this.

**Why `node_modules` and `.venv` are installed, never symlinked or copied.** pnpm and uv both install by hard link from a global store, in seconds, and both write links that are relative to the real tree: pnpm's workspace links (`node_modules/@better-answers/core -> ../../packages/core`) and uv's editable `.pth`. A `node_modules` or `.venv` shared with `main` would import main's `packages/core` and worker source, so a worktree's tests would run against code it is not editing. That reasoning is about path resolution and does not reach the skills, which are static markdown; `provision-skills.sh` copies those.

**Why the index is given at creation.** jCodeMunch resolves an edited file into the nearest containing indexed root. Until the worktree is one, every file an agent edits in it is registered into the *primary checkout's* index under `.claude/worktrees/…`, where a later search answers out of a ticket that is not the reader's, or out of a worktree no longer on disk. The verb is the CLI's own `index <path>`; `index_folder` is the MCP tool's name and is not something a script can call. A machine without jCodeMunch is not a broken worktree, so that case says what it costs and leaves the exit status alone — the shape `actionlint` has in `lefthook.yml` — while an index that was attempted and failed is a stage failure like any other.

**Why `.scratch` is linked, never copied** — the opposite of the skills stage's reasoning, for three reasons a copy cannot answer. It is 1.2 GB across 45,256 files, so a copy per worktree is out. It is living context rather than static material: the Coordinator writes a note into it while a worktree is open, and a copy is stale from that moment. And a note an agent writes through the link outlives the worktree, where a copy is deleted with it. The cost, which is real: the link is read-write and shared, so every agent in every worktree writes into the one unversioned folder the primary checkout holds — there is no per-worktree `.scratch` to lose work in, and none to keep work private in either.

The link cannot bloat the worktree's jCodeMunch index, for two independent reasons: `jcodemunch-mcp index` walks a directory symlink only under `--follow-symlinks`, which this script does not pass, and `.gitignore` names `.scratch` besides. Measured over a throwaway tree: 3 files indexed, then the 45,256-file `.scratch` linked into it and re-indexed — 0 new files, and 0 again for a symlinked directory that no ignore pattern covered.

That `.gitignore` pattern carries no trailing slash on purpose. Git reads a symlink as a file, so `.scratch/` would match the primary's directory and leave every worktree's link showing as `?? .scratch`: the remove hook would then keep each worktree as one holding untracked work, and a `git add -A` would commit the link.

Nothing is copied from `.env.local`: no workspace, test or compose file reads it, and tests reach Postgres through Testcontainers. If that changes, copy the file here — a `WorktreeCreate` hook suppresses `.worktreeinclude`.

### Provisioning the skills

`provision-skills.sh <worktree-path>` is the skills stage, and is runnable by hand. It copies every `.agents/skills` entry and `skills-lock.json` the primary checkout has and the worktree does not; reinstalls from the manifest when the copy left the worktree with nothing; and then verifies that every skill link — the root's at depth two and each workspace's at depth four — resolves inside the worktree. The worktrees, the installs and the dependency trees are pruned rather than merely excluded from the walk, so a large `node_modules` is never entered.

## The tool configuration at the repository root

**`cubic.yaml`** is the reviewer's configuration, read from `main` only. Cubic enables five agents per repository across every source and drops a sixth with no error, so the two custom rules cost the generic slots they replaced; the generic API-auth agent was absorbed into the Principal rule rather than deleted, tenant scoping and request validation being what that rule is for.

**`jscpd.config.mjs`** is a JavaScript module and not the `.jscpd.json` the tool reads on its own. jscpd 5.1.2 parses its config with a strict JSON parser — a `//` line is rejected, and the run then continues on the defaults and exits zero, so a config nobody could read looks exactly like a tree with nothing in it. `scripts/jscpd.mjs` turns these values into the command line instead, which the tool cannot half-read. The threshold is zero because a percentage is a dial someone tunes down the day it fires; a copy is either folded into a helper or named, in the config or beside the copy itself with jscpd's `jscpd:ignore-start` and `jscpd:ignore-end` comments.

What it is blind to, and why: the SPA's `shared/ui` is installed from a registry rather than written; `**/lifts/**` is a verbatim third-party snapshot edited upstream; `schema_view.py` is generated from the migration journal, so two tables with the same columns are the schema's doing; the two lockfiles are resolver output, excluded by name as well as by format; and build output, installed dependencies, the Python environment and the agents' worktrees are not source this repository writes.

**`knip.config.ts`** runs over the pnpm workspace as a step of root `check`: a file no code reaches, an export nothing imports, a dependency no workspace uses and a dependency used but never declared each fail the branch.

The tier's process entry points are deliberately not listed. The api's `main.ts`, `migrate.ts` and `ops.ts`, the two servers its suite exposes, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint plugins and the `check` runner are every one of them already reached by knip's own plugins, which read the manifests' scripts, the SPA's `index.html` and `.oxlintrc.json`'s `jsPlugins` specifiers. Naming them again is a second copy of the manifest, and knip says so on every run ("Remove redundant entry pattern"): a configuration that argues with the tool teaches the next session to ignore its output. Leaving them inferred also keeps the gate honest — the day a manifest stops naming one, knip reports the file as unreached rather than an entry nobody starts.

The top-level `ignore` is conditional on whether this checkout carries a GitNexus index. That index is written under `.gitnexus/` per checkout and excluded from git through `.git/info/exclude` rather than `.gitignore`, which knip reads and `.git/info/exclude` it does not. A checkout that has been analysed therefore names `.gitnexus/run.cjs` as an unused file for a reason that is not the tree's. A checkout that has not been analysed carries no such directory — every worktree is one of those, the runner living in the main checkout — and knip prints a pattern matching nothing as a configuration hint on every run. So the pattern is named only where it matches. Silencing the hint instead is `--no-config-hints` and nothing narrower, which would take the redundant-entry hints with it, and those are the ones this configuration is written to keep agreeing with.

**`pnpm-workspace.yaml`** is the workspace manifest. `apps/worker/` is a uv workspace, not a pnpm one, and a documentation site would join the `packages:` list the day one is lifted in.

`allowBuilds` runs postinstall scripts for two packages, each because the script is what puts a platform binary where the caller reaches it — esbuild for vite and drizzle-kit, ast-grep for the strip script. The other three are optional native accelerations we do not take. lefthook is `false` for the reason above. `false` rather than no entry at all, because pnpm 11 makes an undecided build script a hard error and silence would fail every fresh install.

`minimumReleaseAgeExclude` names the releases taken at their current version deliberately, read from the registry on the day, against pnpm 11's hold on releases younger than its minimum age.

`patchedDependencies` holds one patch, and a patch is a liability at every upgrade, so its reason is here. `@stryker-mutator/vitest-runner` 10.0.0 reads a test file that failed to load — a mutant threw while a module it imports was loading — as no tests run, and reports the mutant that broke the import as survived with `testsCompleted: 0`. The patch counts the file's failure as one failed test named for it; both `stryker.config.mjs` files say more. It is retired when the fix is upstream.
