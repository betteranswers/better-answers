# AGENTS.md

A living company knowledge map for UK SMBs, built on the Open Knowledge Format (OKF).

## Repository context

- `VISION.md` describes what this repository builds towards.
- `GLOSSARY.md` is the glossary.
- `docs/specs/` holds the specs. `v01-route.md` and the `route/` folder are the route spec. `v01-stories.md` holds the v0.1 user stories.
- `docs/okf-v02.md` says what OKF defines, what it leaves open, and where each part lands in this repository. Read it before you add a key, a convention, or a feature that changes the knowledge layer (bundles, concepts, and search).
- `docs/plans/` holds the unified plans.

## Directory layout

| Path | What it is |
| --- | --- |
| `apps/api/` | Hono on Node. It holds only transports. |
| `apps/web/` | Vite React single-page app. It talks to `apps/api/` only over tRPC. |
| `apps/worker/` | Python knowledge worker, managed with uv. |
| `packages/core/` | The business logic that `apps/api` calls: capability slices over four store doors. It does not depend on a transport. |
| `packages/devtools/` | The tooling for the repository's gates. |
| `packages/` | The other shared TypeScript packages: `schema` and `design-system`. |
| `contracts/` | The language-neutral fixtures of the tier contract. |
| `docs/personas/` | Personas for dogfooding. |
| `docs/operations/` | Public-facing operations documents. The other operations documents are in `.planning/estate/`. |
| `deploy/` | Compose files and deployment configuration. |
| `.cubic/wiki/` | The wiki that Cubic generates. |

## Where a file goes

### Source files

- Group source by capability, in `src/<capability>/`. Name each capability with the glossary's words.
- When a capability has more than 15 files, give it subfolders by sub-capability.
- Leave a file where it is if something other than an import names it by path.

### Test files

Test folders mirror source folders. Put a test in the folder that mirrors the folder of the slice whose entry or module the test drives.

- `test/a/b/` mirrors `src/a/b/`.
- In `apps/api` and `apps/worker`, the test root is `tests/`, so `tests/a/b/` mirrors `src/a/b/`.
- In `apps/worker`, the source root is `src/better_answers_worker/`, and the test root mirrors it.
- In `apps/web`, `test/<feature>/` or `e2e/<feature>/` mirrors `src/features/<feature>/`.

An import that only sets a test up, such as a store door or `kernel`, does not decide where the test goes.

Name a test file for the behaviour it checks. If the test checks one source file end to end, name it for that source file.

To find the tests of a source file, open its mirror folder. Then search for the file's path or for the names it exports.

### Test folders that mirror no source folder

A test folder that mirrors no source folder is one of four kinds:

- `support/` and `fixtures/` hold helpers.
- `gates/` at the test root holds the checks of the repository itself, such as a config, a lint rule, a workflow, a skill, or the tree.
- A run folder holds the tests that a job other than `check` selects. `readings/`, `budgets/`, and `images/` are run folders.
- A pinned folder mirrors a tree outside `src/`. A pinned folder can also hold the tests of one source file when those tests fill a folder.

`pnpm run test-folders` enforces these kinds. The table in `packages/devtools/src/scans/test-folders.ts` lists every run folder and every pinned folder, with the reason for each.

### Test helpers

- Put a helper that one folder uses beside that folder's tests.
- Put a helper that two folders share in `support/`.
- In `apps/web`, put every helper of `test/` in `test/support/`.
- Put a helper's own test beside the helper.

### Paths to repository files

A test or a script reaches repository files through the roots helper of its workspace:

| Workspace | Helper file | Names |
| --- | --- | --- |
| `apps/api` | `apps/api/tests/support/roots/roots.ts` | `repositoryRoot`, `workspaceRoot` |
| `apps/web` | `apps/web/test/support/roots.ts` | `repositoryRoot`, `workspaceRoot` |
| `packages/core` | `packages/core/test/support/roots/roots.ts` | `repositoryRoot`, `workspaceRoot` |
| `packages/schema` | `packages/schema/test/support/roots/roots.ts` | `repositoryRoot`, `workspaceRoot` |
| `apps/worker` | `apps/worker/tests/support/roots.py` | `REPOSITORY_ROOT`, `WORKER_ROOT` |
| `packages/devtools` (TypeScript) | `packages/devtools/src/paths.ts` | `repositoryRoot` |
| `packages/devtools` (Python) | `packages/devtools/python/roots.py` | `REPOSITORY_ROOT` |

- Outside `packages/devtools`, only the roots helpers import `repositoryRoot` from `@better-answers/devtools/paths`.
- `pnpm run lint` and `pnpm run climb-scan` refuse the common ways to climb out of a workspace. Each error message names the file of the helper to use.
- Production source under `src/` is exempt from these checks. Code at the repository root, such as `scripts/`, is also exempt.

### Folder size

A folder in a `src`, `test`, `tests`, or `e2e` tree holds at most 15 tracked files directly. `pnpm run loose-files` enforces the limit. The table in `packages/devtools/src/scans/loose-files.ts` lists the folders that a tool pins above the limit, with the reason for each.

### Move files

1. Run `scripts/test-inventory.sh <before-dir>`.
2. Write a TSV table with one `<old>\t<new>` row for each file.
3. Run `node scripts/move-files.mjs <table.tsv>`. The script rewrites the imports and the path mentions, then runs `git mv`.
4. Run `scripts/test-inventory.sh <after-dir>`.
5. Compare the two directories with `diff -r <before-dir> <after-dir>`.

A move changes no test file's name and no test's title.

## Coding

- Read the environment in the tier's config module.
- Pass the environment to a child process through one named function.
- Add backward compatibility only when someone asks for it. Without that request, add no `omitempty` shims, no legacy fallbacks, and no second code path for the old behaviour.

## Testing

### Test at the lowest layer that can see the claim

- Test a pure function in-process, and import its module by path.
- In `packages/core`, a test under `test/<x>/` imports the modules of `src/<x>/` by path. For a store door, the test folder is `test/store/<door>/` and the source folder is `src/store/<door>/`.
- In `packages/core`, a test reaches every other directory through an entry in the package's `exports` map.
- Test a transport through its interface. In `apps/api`, call `server.request(...)`. In `apps/worker`, call the job or the module entry point.
- Test the behaviour of a page on a single screen with a component test that uses Testing Library.
- Put the regression test for a bug at the lowest layer that reproduces the bug.

### Use a real store only where the store is the claim

Use the real Postgres, object store, git repository, or map only when the test is about that store. These claims are about a store:

- Row-level security and zero-rows tests.
- Migrations.
- The SQL that a slice runs.
- Locks and races.
- Governed commits and history rewrites.
- The erasure rehearsal.
- Parity of the boundary schema.
- The SQL agreements of the tier contract.

Each route or command keeps one test case that goes through its real entry.

Write a decision over rows that the code already read as a pure function in its slice.

Never mock this repository's own code. Never add an in-memory stand-in for a store that the platform runs. An in-memory adapter can replace only a third-party service, such as an LLM provider, behind its injected seam.

### Browser specs

- The browser suite has one spec for each page.
- A page's spec covers its latency budget, the accessibility gate, and keyboard reach.
- The browser suite also holds the journeys that cross pages through the real api.

### Jobs outside `check`

- The image job, `pnpm run check:images`, runs the tests of the images, the compose scripts, and the api's stop. `check` does not run them.
- A test that spawns the worker stays in its package's `check`.
- A test that records figures runs on the schedule, not in `check`.
- A performance-budget test runs on the schedule, not in `check`.

### Failures in Postgres

Postgres aborts the transaction after a failed statement, even when the code catches the error. If a test provokes a failure, assert the rejection or the rows before you assert any returned value.

## Secrets

- `docs/operations/SECRETS.md` lists where each secret lives.
- The tier's config module reads each deployment secret once.
- A workspace's secret or a person's secret is a row in the database. It never comes from the environment.
- Never log a secret.

## Agent skills

### Workflow

Use the `pstack` skills. For day-to-day work, run `/poteto-mode <goal and definition of done>`. Name the goal and how to tell that it is done. Do not name the skills.

The project playbooks in `.agents/playbooks/` add this repository's steps to the pstack playbooks.

Cubic's PR bot reviews a pull request when it opens. CodeRabbit reviews only pull requests that have the `review:coderabbit` label. Run Cubic's CLI, `pnpm run cubic-review`, before you open a pull request and before each later push. `.agents/playbooks/review.md` gives the details.

Until v0.1, the session lands its own pull request when the verdict is `PASS` or `PASS+NOTES`. The session does not wait for the owner to approve.

The verifier records its Shipping verdict as a commit status on the verified head, with the context `verdict`. The state is `success` for PASS or PASS+NOTES, and `failure` for FAIL. The description names the verdict and the verifier. For example:

```sh
gh api repos/{owner}/{repo}/statuses/<sha> -f state=success -f context=verdict -f description='PASS by <verifier>'
```

The `main` ruleset requires a successful `verdict` status and a successful `check` on the head.

To land a pull request:

1. Read the newest completed `build` run on `main` with `gh run list --workflow build.yml --branch main --status completed --limit 1`.
2. If that run failed, land the fix for `main` first.
3. Land the pull request with `gh pr merge <n> --squash --match-head-commit <verified-sha>`.

### Skills

A `paths` line in a skill's frontmatter loads the skill for the files that the skill serves. The table of these lines is in `packages/devtools/src/scans/skill-paths.ts`.

Update skills only with `pnpm run skills-update`. The command runs `npx skills update`, then `skill-paths --write`. Every entry in `skills-lock.json` sets `installMode: copy`.

### Issue tracker

The backlog is in Linear. Use the `linear-server` MCP server to reach it. `docs/agents/issue-tracker.md` gives the details.

### Architecture decisions

Before you start a task, read the decisions in `docs/solutions/architecture-patterns/` whose `applies_when` lines match it.

### Mutation triage

Treat a surviving mutant as a hypothesis until a probe verifies it. `docs/agents/mutation-triage.md` gives the procedure.

### Cloud sessions

When a session runs in a cloud environment, read `docs/agents/cloud-sessions.md`.

## Doc exploration

Use jDocMunch to find and read the indexed Markdown in this repository:

1. Run `doc_resolve_repo` on `"<repo's absolute path>"`.
2. Find a passage with `search_sections`. Read it with `get_section` or `get_sections`.
3. Before you read a long file, open its structure with `get_document_outline`.

Read a doc directly in these cases:

- You will work through all of it, such as a plan that you carry out.
- You are about to edit it.
- A command needs the raw file, such as a grep that also covers code.

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
## Gitnexus Policy

GitNexus serves a call graph of this project as **better-answers**. Use it to find what a change affects. To find and read code, use jCodeMunch.

> Every GitNexus answer reports its staleness. If it is behind `HEAD`, run `node .gitnexus/run.cjs analyze` from the project root before you trust an impact count. The rebuild takes about 80 seconds.

### Use it for

- The blast radius of a change to a symbol that other code calls: `impact({target: "symbolName", direction: "upstream"})`.
- The symbols and flows that a large diff touches: `detect_changes()`.
- The execution flows that pass through a symbol: `context({name: "symbolName"})`.
- Security review: `explain({target: "fileOrSymbol"})` lists taint findings, which are flows from a source to a sink. It needs `analyze --pdg`.

### Renames

- Rename a symbol with `rename`, not with find-and-replace. `rename` follows the call graph.

### From a worktree

A `post-merge` hook re-runs `analyze` in the background when the main checkout merges or pulls into `main`. A worktree does not have the runner.

- Pass `worktree: <the worktree's absolute path>` to `detect_changes`.
- `impact`, `context`, and `query` read the index of the main checkout. Their answers describe `main`, not the edits in the worktree.
- If `impact` answers *ambiguous*, run it again by `target_uid` before you count its risk.
- Run `rename` only as a dry run. It reads and writes the files of the main checkout.

### Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/better-answers/context` | Codebase overview and index freshness |
| `gitnexus://repo/better-answers/clusters` | All functional areas |
| `gitnexus://repo/better-answers/processes` | All execution flows |
| `gitnexus://repo/better-answers/process/{name}` | Step-by-step execution trace |

<!-- gitnexus:keep -->
<!-- gitnexus:end -->
