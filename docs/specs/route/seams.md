# Test seams

A brief's Seams field names seams from this table. The general test rules are in `AGENTS.md`, under Testing.

## The seams

| Seam | What it drives | Where |
| --- | --- | --- |
| core interface | A block's actions and refusals through a `packages/core` export, over real Postgres and a real bare repository where the block writes the bundle | `packages/core/test/` |
| api harness | MCP, tRPC and the authorization server through the server's own requests, for every block a transport reaches | `apps/api/tests/` |
| browser suite | One spec per page a block builds, over a served build, with the page's latency budget and the accessibility gate | `apps/web/e2e/` |
| worker harness | The worker's pipeline steps, through pytest over real Postgres | `apps/worker/tests/` |
| tier contract | One agreement both tiers' suites read. A fixture `contracts/manifest.json` does not list fails both | `contracts/` |
| ops seam | Each `pnpm ops` command through `runOps`, answering done, refused or not built with its own exit code | |
| rebuild equivalence | The worker's full map rebuild against the map the api's writes left. A block that touches the map keeps it green | `packages/core/test/concepts/rebuild-equivalence.test.ts` |
| cross-tier document test | The api connects, reviews and publishes a document, the worker runs as a real process on the same stores, and the api reads the passage back as a literal through `find` and `open`. A block adding a connector or extraction step extends it | `packages/core/test/sources/cross-tier-document.test.ts` |
| invisibility suite | A concept, passage or `Answer` the reader may not read is absent through every entry, with no count and no different refusal | `packages/core/test/access/invisibility.test.ts`, `apps/api/tests/mcp/invisibility.test.ts` |

## Third-party doubles

| Service | Double |
| --- | --- |
| The model client's wire | A fetch-shaped fake for the real fetch, in `packages/core/test/support/judge-wire.ts` and `apps/api/tests/support/harness/harness-model.ts`. S7 reuses it |
| The Graph API | A SharePoint fake, arriving with S4 |
| The embeddings endpoint | A fake, arriving with S8, the one block that embeds |

The recall measure runs through the core interface over the synthetic sets in `packages/core/test/fixtures/` and fails no build. The customer's own answer tests, in its workspace, give the reading that decides.

## What a good test asserts

- What the caller can observe: a commit, a row, a refusal, an absence, a passage or a page. Never internals.
- An expected value written as a literal.
- A pair, both ways.
- Setup through the suite's factories.

A block's plan names its functional tests before the code. A mutation finding a block carries is a runtime test in its acceptance criteria.
