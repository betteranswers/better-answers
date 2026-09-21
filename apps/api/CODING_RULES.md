# Coding rules — `apps/api/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier
alone. The browser package on the other side of tRPC has its own rules in
`apps/web/CODING_RULES.md`. Each rule names what holds it, because a rule nothing runs is a
convention: this tier's rules are the constitution's most reviewer-read, since what they
govern — one server, one logger, one config module, a test that speaks HTTP — is shape
rather than syntax, and oxlint 1.80 has no rule that can see a shape.

## [APP1] The tier runs from source

Node 24 strips types at run time, so there is no build step and no `dist/`: `src/main.ts`
*is* the process and `src/migrate.ts` *is* the `migrate` one-shot of the platform stack.
Every intra-repository import carries its `.ts` extension, because that is what Node
resolves. `tsc` runs for types only (`--noEmit`). Held by the tier itself rather than by a
gate: an import missing its extension does not resolve, so the process does not start, and
there is no build script that could produce a `dist/` to check for. That is why no test and
no lint rule names this rule anywhere in the tree.

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

Nothing checks any of the three singularities. No lint rule holds `process.env` to
`src/config.ts` — oxlint 1.80 ships no `no-restricted-syntax` to express it, the same
absence ADR 0040's clock scan works around — and none counts the tier's Hono apps or its
loggers. A reviewer reads a second one off the diff, and this rule is what they read it
against.

## [APP3] Tests start a real Postgres and speak HTTP

`tests/postgres.ts` is the factory every data-touching test builds its state through
(`[TEST2]`, `[TEST4]`). A test reaches the app through `server.request(...)` — the seam a
caller crosses — never through a function the transport happens to call (`[TEST1]`,
`[DESIGN2]`). The factory is held by there being one; the seam is read off the diff, since
`better-answers/import-direction` places imports inside `packages/core` and says nothing
about a test in this tier reaching past `server.request(...)`.

## [APP4] The lift is contract-tested, not trusted

Every directory under `lifts/` carries a `THIRD_PARTY_NOTICES.md` naming its upstream
repository and commit, the snapshot's digest, its licence and notice text, what was cut, who
audited it and when, and the test a refresh must pass (ADR 0027 names the file, ADR 0005 the
practice). The test lives in `tests/` beside our own and fails the build, not a report — for
the one lift this tier carries that is `tests/cimd-fetch.test.ts`, and the refresh it names
is what a snapshot bump must pass. The notices file itself is read off the diff: nothing
enumerates the directories under `lifts/`, so a third lift arriving without one is the
reviewer's to catch. Both lifts in the tree carry theirs today —
`apps/api/lifts/better-auth-cimd-node/` and `packages/devtools/lifts/anti-slop/`.

## [APP5] Transport work follows the tier's own tRPC skills

`apps/api/.claude/skills/` holds the tRPC skills this tier is written against — router and
procedure shape, validators, links, non-JSON content types, error handling, subscriptions,
caching, the fetch adapter. Before a procedure, a link or an adapter is written or changed, the
skill that covers it is read, and a block spec's seam sketch that touches this tier names the
skill it follows (the route spec's fourth rule). Where a skill and this file disagree, this file
wins and the disagreement is recorded here. An upload is the `non-json-content-types` skill's
shape — a mutation taking `octetInputParser` or `FormData`, reached through `splitLink` on
`isNonJsonSerializable` — never a second HTTP route beside tRPC. Both halves are read off
the diff. A skill is prose and nothing can check that one was followed; and no test catches
the second route either, because `app.`'s surface ends in a catch-all `/*`
(`tests/hostnames.test.ts`) — a route mounted beside tRPC on that host is inside the
documented surface and passes. The upload seam being unbuilt, there is nothing yet for a
gate to hold even if one existed.
