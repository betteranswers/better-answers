# The tier contract

The language-neutral home of everything `apps/api` (TypeScript) and `apps/worker` (Python) must agree about across ADR 0005's stores-not-code seam. Decided in **ADR 0031**; this directory is that decision made checkable. It is deployed by nothing and imported by nothing — both tiers' test suites *read* it.

`manifest.json` names the seven agreements and the form each takes — the six ADR 0031 settled, plus **id-shape**, the one shape every id either tier mints has, added by ADR 0035's amendment to it (05/09/2026):

- **sql-function** — the behaviour is the database's; both tiers call it. The functions land in `packages/schema`'s migrations; fixtures here test them.
- **fixtured** — a golden vector both suites read and must interpret identically.
- **generated** — produced from one source (ADR 0028); golden rows here fixture the meaning.

Two conformance tests read this directory and assert the same expectations — `packages/core/test/tier-contract.test.ts` (vitest) and `apps/worker/tests/test_tier_contract.py` (pytest). Each hardcodes the agreement ids and `contract_version` it speaks, **deliberately**: a change here that either tier does not understand fails that tier's suite, which is the point.

Adding a fixture: put the file under `<agreement>/`, list it in `manifest.json`'s `fixtures` array as `{ "agreement": "<id>", "path": "<agreement>/<file>" }`, and teach both suites what it means in the same PR. A fixture on disk but not in the manifest — or listed but absent — fails both suites. `contract_version` moves in the same commit, and so do the two suites' hardcoded copies of it: **3** is the version the **queue** agreement's fixture landed at (T-057), which is what makes the claim protocol's lease semantics a thing both tiers are held to rather than one tier's reading of them.
