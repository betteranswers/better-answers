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
- Leave a file where it is if something other than an import names it by path.

### Test files

Test folders mirror source folders. Put a test in the folder that mirrors the folder of the slice whose entry or module the test drives.

`test/a/b/` mirrors `src/a/b/`. `TREES` in `packages/devtools/src/scans/test-folders.ts` lists each workspace's test root and source root.

An import that only sets a test up, such as a store door or `kernel`, does not decide where the test goes.

Name a test file for the behaviour it checks. If the test checks one source file end to end, name it for that source file.

To find the tests of a source file, open its mirror folder. Then search for the file's path or for the names it exports.

### Test folders that mirror no source folder

Such a folder is `support/` or `fixtures/` for helpers, `gates/` at the test root for checks of the repository itself, or a row in `PINS` in `packages/devtools/src/scans/test-folders.ts`. `pnpm run test-folders` names the fix for any other folder.

### Test helpers

- Put a helper that one folder uses beside that folder's tests.
- Put a helper that two folders share in `support/`.
- Put a helper's own test beside the helper.

### Paths to repository files

A test or a script reaches repository files through its workspace's roots helper, never by climbing with `..`. `pnpm run lint` and `pnpm run climb-scan` name the helper in each error. Production source under `src/` and code at the repository root, such as `scripts/`, are exempt.

### Folder size

A folder in a `src`, `test`, `tests`, or `e2e` tree holds at most 15 tracked files directly. Split a full folder by sub-capability. `pnpm run loose-files` enforces the limit.

### Move files

Write a TSV table with one `<old>\t<new>` row for each file, then run `node scripts/move-files.mjs <table.tsv>`. The script rewrites the imports and the path mentions, then runs `git mv`. A move changes no test file's name and no test's title.

The script makes the move in a copy of the working tree first. It lists every test in the tree and in the copy by file name and title, and compares the two lists as one list for the whole repository, so a test can move to another workspace. It moves the tree only when the lists match. If they differ, or a listing fails, it prints the difference, leaves the tree as it was, and exits non-zero.

A listing runs each test module and no test, so it holds the title that the test runs under: a title built at run time, each row of `it.each`, and every skipped and todo case. It covers every vitest config in `packages/*` and `apps/*` except a stryker config, the worker's pytest collection, and Playwright's list of the web specs. It does not see a `describe` that holds no case. A listing points the temp folders that test modules make into its own folder and deletes them, and answers their `docker info` probes as if Docker were down. A move takes about a minute and a half, about as long as two listings.

If the script stops before it prints its report, run it again with the same table. A run stopped while it lists has not changed the tree. A run killed while it moves the files leaves a journal in the git folder, and the next run undoes that part-done move first.

## Coding

- Read the environment in the tier's config module.
- Pass the environment to a child process through one named function.
- Add backward compatibility only when someone asks for it.

## Testing

### Test at the lowest layer that can see the claim

- Test a pure function in-process, and import its module by path.
- In `packages/core`, a test imports any module of the folder it mirrors, and any other folder only through that folder's `index.ts`. The `import-direction` lint enforces this.
- Test a transport through its interface. In `apps/api`, call `server.request(...)`. In `apps/worker`, call the job or the module entry point.
- Test the behaviour of a page on a single screen with a component test that uses Testing Library.

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

The browser suite has one spec for each page, and its cross-page journeys are in `apps/web/e2e/journeys/`. The `playwright-specs` skill gives the rest.

### Jobs outside `check`

- Put an image, compose-script or api-stop test in `apps/api/tests/images/`, or mark a worker test `image`. `pnpm run check:images` runs them; `check` does not.
- Put a test that records figures in `packages/core/test/readings/`, and a performance-budget test in `packages/core/test/budgets/`. The schedule runs them.
- A test that spawns the worker stays in its package's `check`.

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

`.agents/playbooks/review.md` owns review and the verdict: Cubic, CodeRabbit, CodeQL, `pnpm run cubic-review` before each push, and the `verdict` commit status.

Until v0.1, the session lands its own pull request when the verdict is `PASS` or `PASS+NOTES`. The session does not wait for the owner to approve.

The `main` ruleset requires a successful `verdict` status and a successful `check` on the head. Before you land, read the newest completed `build` run on `main` with `gh run list --workflow build.yml --branch main --status completed --limit 1`. If it failed, land the fix for `main` first.

### Skills

A `paths` line in a skill's frontmatter loads the skill for the files that the skill serves. The table of these lines is in `packages/devtools/src/scans/skill-paths.ts`.

Update skills only with `pnpm run skills-update`. The command runs `npx skills update`, then `skill-paths --write`. Every entry in `skills-lock.json` sets `installMode: copy`.

### Issue tracker

The backlog is in Linear. Use the `linear-server` MCP server to reach it. `docs/agents/issue-tracker.md` gives the details.

### Architecture decisions

Before you start a task, read the decisions in `docs/solutions/architecture-patterns/` whose `applies_when` lines match it.

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
