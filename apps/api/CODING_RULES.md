# Coding rules — `apps/api/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier
alone. `apps/web/` is a browser package and follows the same TypeScript rules; it talks to
this tier over tRPC and neither imports the other (ADR 0006).

## [APP1] The tier runs from source

Node 24 strips types at run time, so there is no build step and no `dist/`: `src/main.ts`
*is* the process and `src/migrate.ts` *is* the `migrate` one-shot of the platform stack.
Every intra-repository import carries its `.ts` extension, because that is what Node
resolves. `tsc` runs for types only (`--noEmit`).

## [APP2] One server, one logger, one config module

`src/server.ts` builds the tier's only Hono app and takes what it needs as one typed
parameter — `createServer(dependencies: ServerDependencies)`, the pool, the public origin,
the hostname list and whatever else a mount needs — is the shape every later mount follows. `src/logger.ts` is
the tier's only logger (`[LOG1]`). `src/config.ts` is the only module in the tier that
reads the environment (`[SEC1]`, § TYPES), and it reads the **bootstrap class alone** —
what the deploy unit must give the process before it can reach anything. Every other
credential class is a row under the envelope, so a key belongs in that module only once
something in this tier reads it. Entry points call `requireBootstrap`, which says why on
the way out rather than failing later against a store it was never told about.

## [APP3] Tests start a real Postgres and speak HTTP

`tests/postgres.ts` is the factory every data-touching test builds its state through
(`[TEST2]`, `[TEST4]`). A test reaches the app through `server.request(...)` — the seam a
caller crosses — never through a function the transport happens to call (`[TEST1]`,
`[DESIGN2]`).

## [APP4] The lift is contract-tested, not trusted

Every directory under `lifts/` carries a `THIRD_PARTY_NOTICES.md` naming its upstream
repository and commit, the snapshot's digest, its licence and notice text, what was cut, who
audited it and when, and the test a refresh must pass (ADR 0027 names the file, ADR 0005 the
practice). The test lives in `tests/` beside our own and fails the build, not a report.
