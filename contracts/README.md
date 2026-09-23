# The tier contract

The language-neutral home of everything `apps/api` (TypeScript) and `apps/worker` (Python) must agree about across ADR 0005's stores-not-code seam. Decided in **ADR 0031**; this directory is that decision made checkable. It is deployed by nothing and imported by nothing — both tiers' test suites *read* it, and so, since `citation`, does the repository's own gate tooling, which is deployed by nothing either.

`manifest.json` names the agreements and the form each takes, one of three. **ADR 0031's table names them and what each settles; its amendments are the history** — which agreement arrived when, and at which `contract_version`. This page keeps no second copy of either.

- **sql-function** — the behaviour is the database's; both tiers call it. The functions land in `packages/schema`'s migrations; fixtures here test them.
- **fixtured** — a golden vector both suites read and must interpret identically.
- **generated** — produced from one source (ADR 0028); golden rows here fixture the meaning.

Two conformance tests read this directory and assert the same expectations — `packages/core/test/tier-contract.test.ts` (vitest) and `apps/worker/tests/test_tier_contract.py` (pytest). Each hardcodes the agreement ids and `contract_version` it speaks, **deliberately**: a change here that either tier does not understand fails that tier's suite, which is the point.

Adding a fixture: put the file under `<agreement>/`, list it in `manifest.json`'s `fixtures` array as `{ "agreement": "<id>", "path": "<agreement>/<file>" }`, and teach both suites what it means in the same PR. A fixture on disk but not in the manifest — or listed but absent — fails both suites. `contract_version` moves in that same commit, and so do the two suites' hardcoded copies of it.

The form an entry declares is a claim about this directory, and both suites hold it to what is here. A **fixtured** agreement lists at least one fixture, each under its own `<agreement>/` and each on disk; a **generated** agreement has rows on disk under it; a **sql-function** agreement is asked nothing about files, so what sits under one is its own business. Held the other way too: a directory no agreement claims fails, and so does an entry naming a form neither suite knows — a form goes unrecognised loudly rather than passing by omission. Each failure names the agreement and the form it declared, so an entry that lied is legible without opening the manifest.
