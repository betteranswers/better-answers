# The tier contract

`apps/api` (TypeScript) and `apps/worker` (Python) share no code. They meet only through stores, such as the database. This directory holds every behaviour the two tiers must agree on, in a form that belongs to neither language.

## Agreements

`manifest.json` lists each agreement by id and declares its form. The form is a claim about this directory, and the conformance suites check it.

- **sql-function.** The behaviour belongs to the database, and both tiers call the same SQL function. The function lands in a migration in `packages/schema`. Fixtures here can test the function, but the form requires no files.
- **fixtured.** Both suites read the same golden vector and must interpret it identically. The agreement lists at least one fixture. Each fixture is under `<agreement>/` and exists on disk.
- **generated.** One source produces the values. Golden rows on disk under `<agreement>/` fix what the values mean.

## Conformance suites

Two suites read this directory and assert the same expectations:

- `packages/core/test/tier-contract.test.ts` (vitest)
- `apps/worker/tests/test_tier_contract.py` (pytest)

Each suite hardcodes the agreement ids. A change here that one tier does not understand fails that tier's suite. Both suites fail on a fixture that is on disk but not in `manifest.json`, and on a fixture that `manifest.json` lists but that is not on disk. Both suites skip this README by name, so any other file here counts as a fixture, a second markdown file included.

## What a new fixture needs

A new fixture needs four changes in the same PR:

- The file, under `<agreement>/`.
- An entry `{ "agreement": "<id>", "path": "<agreement>/<file>" }` in the `fixtures` array of `manifest.json`.
- Code in both suites that reads the fixture.
- Both stamps, regenerated in the same commit. [The digest](#the-digest) names the commands.

## The digest

The version of this directory is its digest. Each tier computes the digest on its own, in `packages/schema/src/contract-digest.ts` and `apps/worker/src/better_answers_worker/contract_digest.py`.

The digest covers every file at any depth, except for this README, symbolic links, and any path with a segment that starts with `.`. Each tier sorts the relative paths by their UTF-8 bytes. For each file in turn, it feeds SHA-256 the path, a newline, the byte length, a newline, and the bytes. The result is lowercase hex.

Neither tier's image copies this directory, so each tier carries the digest as a generated constant that is committed to the repository:

| Tier | Stamp file | Command that writes it |
| --- | --- | --- |
| api | `packages/schema/src/contract-stamp.ts` | `pnpm --filter @better-answers/schema run generate:contract-stamp` |
| worker | `apps/worker/src/better_answers_worker/contract_stamp.py` | `cd apps/worker && uv run --frozen generate-contract-stamp` |

Each tier's `check` regenerates its constant and compares the result with the committed file, so a hand-edited constant fails.

`apps/api/src/migrate.ts` writes the api constant to the `contract_stamp` table. At run time the worker compares its own constant with that row. If they differ, the worker logs an error and claims no jobs. A deploy that updates one tier and not the other therefore stops the worker until both stamps match.

## Repository paths

Every repository path that this directory names, in a fixture or on this page, must exist. `packages/devtools/src/moves/move-files.ts` does not rewrite files under `contracts/`, so a move can leave a stale path here. `packages/devtools/test/scans/contract-paths.test.ts` fails on that path. To fix it, point the mention at the file's new path. If the mention is in a fixture, regenerate both stamps, because the fixture edit changes the digest.
