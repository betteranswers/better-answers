# Coding rules — `apps/api/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier alone.

## [APP1] Import with the `.ts` extension

Node strips types at run time, so there is no build step and no `dist/`: `src/main.ts` is the process and `src/migrate.ts` is the `migrate` one-shot. Every intra-repository import carries its `.ts` extension, because that is what Node resolves. `tsc` runs for types only.

## [APP2] Build one Hono app and one logger

`src/server.ts` builds the tier's only Hono app and takes what it needs as one typed parameter, `createServer(dependencies: ServerDependencies)`, which is the shape every later mount follows. `src/logger.ts` is the tier's only logger. An entry point calls `requireBootstrap`, which says what is missing on the way out rather than failing later against a store it was never told about.

## [APP4] Test every lift by contract, never by trust

Every directory under `lifts/` carries a `THIRD_PARTY_NOTICES.md` naming its upstream repository and commit, the snapshot's digest, its licence and notice text, what was cut, who audited it and when, and the test a refresh must pass. That test lives in `tests/` beside our own and fails the build rather than a report.

## [APP5] Follow this tier's tRPC skills

`apps/api/.claude/skills/` holds the tRPC skills this tier is written against. Read the skill that covers a procedure, a link or an adapter before writing or changing one. Where a skill and this file disagree, this file wins and the disagreement is recorded here. Bytes in are a mutation taking `octetInputParser`, reached through `splitLink`, the descriptor beside the bytes; bytes out are a route beside tRPC an ADR opens.

Reviewer: a skill is prose, and nothing can check that one was followed.