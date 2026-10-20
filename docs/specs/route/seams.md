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

The general test rules are in `CODING_STANDARDS.md`, under Tests.

## The seams

**core interface.** A block's actions and refusals, driven through an entry `packages/core` exports, over real Postgres, and a real bare repository where the block writes the bundle. The suites are in `packages/core/test/`.

**api harness.** The MCP surface, tRPC and the authorization server, driven through the server's own requests, for every block a transport reaches. The suites are in `apps/api/tests/`.

**browser suite.** One spec per page a block builds, over a served build, with the page's latency budget (ADR 0037) and the accessibility gate. The specs are in `apps/web/e2e/`.

**worker harness.** The worker's pipeline steps through pytest, over real Postgres, in `apps/worker/tests/`.

**tier contract.** Both tiers' suites read the same agreement under `contracts/` (ADR 0031). A fixture on disk that `contracts/manifest.json` does not list fails both.

**ops seam.** Each `pnpm ops` command answers done, refused or not built, each with its own exit code, through `runOps`.

**rebuild equivalence.** The worker's full map rebuild matches the map the api's own writes left (`packages/core/test/rebuild-equivalence.test.ts`). A block that touches the map keeps it green.

**cross-tier document test.** The api's actions connect, review and publish a document, the worker runs as a real process against the same stores, and the api reads the passage back as a literal through `find` and `open` (`packages/core/test/cross-tier-document.test.ts`). A block that adds a connector or an extraction step extends this test.

**invisibility suite.** A concept, passage or `Answer` the reader may not read is absent through every entry, with no count and no different refusal. The suites are `packages/core/test/invisibility.test.ts` and `apps/api/tests/invisibility.test.ts`.

## Third-party doubles

A double stands only at the wire of a service someone else runs.

- **The model client's wire.** A fetch-shaped fake passed in place of the real fetch (ADR 0049), in `packages/core/test/judge-wire.ts` and `apps/api/tests/harness-model.ts`. S7 reuses it.
- **The Graph API.** A SharePoint fake at the Graph API arrives with S4.
- **The embeddings endpoint.** A fake arrives with S8, the one block that embeds.

The recall measure runs through the core interface over the synthetic sets in `packages/core/test/fixtures/`, reports its figure and fails no build. The reading that decides is the customer's own answer tests in its workspace (ADR 0016).

## What a good test asserts

- It asserts what the caller can observe: a commit, a row, a refusal, an absence, a passage or a page. It never asserts internals.
- Its expected value is written down as a literal.
- It checks a pair both ways.
- It builds its setup through the suite's factories.
- A block's plan names its functional tests before the code is written.
- A mutation finding a block carries is a runtime test in that block's acceptance criteria.
