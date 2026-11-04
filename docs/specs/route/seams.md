# Test seams

A brief's Seams field names seams from this list:

- core interface
- api harness
- browser suite
- worker harness
- tier contract
- ops seam
- rebuild equivalence
- cross-tier document test
- invisibility suite

The general test rules are in `AGENTS.md`, under Testing.

## The seams

**core interface.** The core interface drives a block's actions and refusals through an entry that `packages/core` exports. It runs over real Postgres, and over a real bare repository where the block writes the bundle. The suites are in `packages/core/test/`.

**api harness.** The api harness drives MCP, tRPC and the authorization server through the server's own requests, for every block a transport reaches. The suites are in `apps/api/tests/`.

**browser suite.** The browser suite holds one spec per page a block builds. Each spec runs over a served build, with the page's latency budget and the accessibility gate. The specs are in `apps/web/e2e/`.

**worker harness.** The worker harness runs the worker's pipeline steps through pytest, over real Postgres. The suites are in `apps/worker/tests/`.

**tier contract.** Both tiers' suites read the same agreement under `contracts/`. A fixture on disk that `contracts/manifest.json` does not list fails both.

**ops seam.** The ops seam runs each `pnpm ops` command through `runOps`. Each command answers done, refused or not built, each with its own exit code.

**rebuild equivalence.** The worker's full map rebuild matches the map the api's own writes left (`packages/core/test/concepts/rebuild-equivalence.test.ts`). A block that touches the map keeps the test green.

**cross-tier document test.** The api's actions connect, review and publish a document. The worker runs as a real process against the same stores. The api then reads the passage back as a literal through `find` and `open`. The test is `packages/core/test/sources/cross-tier-document.test.ts`, and a block that adds a connector or an extraction step extends it.

**invisibility suite.** A concept, passage or `Answer` the reader may not read is absent through every entry, with no count and no different refusal. The suites are `packages/core/test/access/invisibility.test.ts` and `apps/api/tests/mcp/invisibility.test.ts`.

## Third-party doubles

A double stands only at the wire of a service someone else runs.

- **The model client's wire.** A fetch-shaped fake replaces the real fetch. It is in `packages/core/test/support/judge-wire.ts` and `apps/api/tests/support/harness/harness-model.ts`. S7 reuses it.
- **The Graph API.** A SharePoint fake at the Graph API arrives with S4.
- **The embeddings endpoint.** A fake arrives with S8, the one block that embeds.

The recall measure runs through the core interface over the synthetic sets in `packages/core/test/fixtures/`. It reports its figure and fails no build. The reading that decides comes from the customer's own answer tests, in its workspace.

## What a good test asserts

- It asserts what the caller can observe: a commit, a row, a refusal, an absence, a passage or a page. It never asserts internals.
- Its expected value is written down as a literal.
- It checks a pair both ways.
- It builds its setup through the suite's factories.
- A block's plan names its functional tests before the code is written.
- A block that carries a mutation finding lists it as a runtime test in its acceptance criteria.
