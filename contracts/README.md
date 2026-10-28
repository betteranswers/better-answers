# The tier contract

The language-neutral home of everything `apps/api` (TypeScript) and `apps/worker` (Python) must agree across the stores-not-code seam.

`manifest.json` names the agreements.

- **sql-function** — the behaviour is the database's; both tiers call it. The functions land in `packages/schema`'s migrations; fixtures here test them.
- **fixtured** — a golden vector both suites read and must interpret identically.
- **generated** — produced from one source; golden rows here fixture the meaning.

Two conformance tests read this directory and assert the same expectations — `packages/core/test/tier-contract.test.ts` (vitest) and `apps/worker/tests/test_tier_contract.py` (pytest). Each hardcodes the agreement ids: a change here that either tier does not understand fails that tier's suite.

**The version of this directory is its digest.** Every file here at any depth, minus this page and anything under a dotted path, framed path-then-length-then-bytes in byte order and hashed SHA-256 — computed independently by each tier, carried by each as a generated and committed constant, stamped into `contract_stamp` by `migrate`, and read back by the worker at run time. Neither image copies this directory, which is why the constant is committed rather than computed at boot; `pnpm --filter @better-answers/schema run generate:contract-stamp` and `uv run --frozen generate-contract-stamp` write the two, and each tier's `check` regenerates and compares.

Adding a fixture: put the file under `<agreement>/`, list it in `manifest.json`'s `fixtures` array as `{ "agreement": "<id>", "path": "<agreement>/<file>" }`, and teach both suites what it means in the same PR. A fixture on disk but not in the manifest — or listed but absent — fails both suites. Both generated digests move in that same commit, and a deploy that lands one tier and not the other is a worker that says so rather than one that works on a contract it does't hold.

Every repository path this directory names, in a fixture or on this page, must exist. The move codemod never rewrites `contracts/`, so `packages/devtools/test/scans/contract-paths.test.ts` fails on a path whose file has moved. Point the mention at the file's new path, then regenerate both stamps, because a fixture edit moves the digest.

The form an entry declares is a claim about this directory. A **fixtured** agreement lists at least one fixture, each under its own `<agreement>/` and each on disk; a **generated** agreement has rows on disk under it; a **sql-function** agreement is asked nothing about files.
