# The v0.1 route

Each block's strand, status, next marker, waits and plan live only in this table. A live block's brief is `docs/specs/route/<id>.md`, and `docs/specs/route/seams.md` names the test seams.

## Where each block stands

| Block | Strand | Delivers | Blocked by | Status | Next | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | knowledge | Personal data withheld before any store, and an erasure that says what it did | none | done | | `e19cfb9d4^:docs/archive/specs/s0-redaction-seam-and-erasure.md` |
| S1 | knowledge | One uploaded document to a cited passage, with no embedding | S0 | done | | `e19cfb9d4^:docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md` |
| S2a | knowledge | Search and the concept page, with no model call | S1 (`open` by locator) | done | | [S2a's plan](../archive/plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md) |
| S2b | knowledge | Ask answers from concepts with citations or refuses, and the Questions pages | S2a, S1 (unmapped passages) | done | | [S2b's plan](../archive/plans/2026-10-11-2309-feat-s2b-ask-plan.md), [rarity-weighted matching](../plans/004-rarity-weighted-matching.md) |
| [S4](route/s4.md) | knowledge | The website and a SharePoint library as connected sources, priced before they sync | S1 | unplanned | | |
| [S6](route/s6.md) | knowledge | A bid's question set answered and exported as a response-set document | S2b, S3 | unplanned | | |
| [S7](route/s7.md) | knowledge | Suggested concepts extracted from synced sources within the spending limit | S4, S3 | unplanned | | |
| [S8](route/s8.md) | knowledge | Concept vectors, taken up only when its trigger fires | trigger | reserve | | |
| S3 | records | Concepts typed and edited, guides built from them, owners per collection | none | done | | [plan](../plans/007-s3-concepts-and-guides.md) |
| [S5](route/s5.md) | records | Every suggestion decided on To decide, and answers promoted to `Answer`s | S2b, S3, S7 (the by-sync filter), V1 (flag routing) | unplanned | | |
| [V1](route/v1.md) | records | Verification requests, shelf life, and conflicts a person resolves | S3 | unplanned | | |
| [P1](route/p1.md) | people | People's pages, Microsoft sign-in and the Account page | none | building | | [people layout rework](../archive/plans/2026-10-01-1807-feat-people-layout-rework-plan.md), [sign-in and security](../archive/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md) |
| P2 | people | The platform console, with provisioning and a first member | P1 | done | | `e19cfb9d4^:docs/archive/specs/T-028.md` |
| [O1](route/o1.md) | ops | Signals, System's cards, backups, and the Erasure and suppression page | S0 | unplanned | | |
| [C1](route/c1.md) | customer | The first customer onboarded, and its real answer tests read | S5, S6, P1, O1 | unplanned | | |

Every block gates v0.1 except S8, the reserve. Rows are in build order within a strand.

## How a session uses the route

### Pick a block

1. If a row on your strand is building, build its unmerged units from its plan without replanning.
2. Otherwise take the next row on the strand the owner's prompt names, or on any strand if it names none.
3. If that strand has no next row, take the first planned or unplanned row, in table order, whose Blocked by entries are all met. Build a planned row from its plan.
4. A parallel session may take a second row on a strand by rule 3. Two sessions never take one block.
5. Read the brief and list the block's open Linear issues, labelled from the Route Block group.

### Read the Blocked by cell

- A bare id, such as `S3`, is met when that row is done.
- An id with bracketed words, such as `S7 (the by-sync filter)`, blocks only the units those words name. Plan the block anyway, list the entry among those units' dependencies, and remove it when the last of them merges.
- `trigger` means the reserve row waits on its brief's measure.

### Change the table

Edit a row in the pull request that makes the change true.

| When | Edit |
| --- | --- |
| The pull request adding the plan | Status `planned`, and the plan linked in Plan |
| The first building pull request | Status `building`, and Next cleared |
| The last unit merges and every Done when check holds | Status `done`, the brief deleted, the Block cell unlinked, and what the block still owes filed as issues under its label |
| A plan or owner ruling changes a block's waits | Blocked by |
| A reserve row's trigger fires | Status `unplanned` |
| Work lands ahead of its block, with the owner's agreement | Status unchanged, and the work's line moves from Must carry to Builds on |

A block is done when its Done when checks hold, not when every issue on its label has closed.

### Keep a brief current

- A brief states what is true now and what the block still owes, with no dates, struck text or ruling history.
- When the owner rules, rewrite what the ruling changes and cite its ADR, plan or issue if any.
- An ADR, then the glossary, then the tree win over a brief. Fix the brief in the pull request that finds the disagreement.
- A brief cites a `BA-N` only inside the obligation whose detail that issue holds. The Linear label lists the issues.
- A plan edits its brief only to drop an obligation that no longer stands or add a missing one.

### Put everything else in its place

| What | Where |
| --- | --- |
| A measurement | A row under its measure in `docs/operations/readings.md` |
| Unplanned work, or a finding put off | A Linear issue, with its block's label if it has one |
| A decision that is hard to reverse | Its ADR under `docs/solutions/architecture-patterns/` |
| A user story | `docs/specs/v01-stories.md` |
| What happened, and when | git, and `docs/archive/plans/` for a complete plan |

## Not in v0.1

- The bids-and-proposals stage, and `VISION.md`'s Then and Later stages. S5 and S6 fix the knowledge-side contract the next stage consumes.
- Agent capabilities beyond the four read entries: `action:*` scopes, Agent Auth, the approval layer and the packaged client-side plugin. An MCP App showing a concept file inside Claude gets its own plan.
- Imported and vendor bundles, the sensitivity-filtered bundle export, a read-only clone endpoint and scheduled exports.
- A `.docx` response set with real footnotes, JavaScript-rendered pages in the website connector, and local embedding on the first estate.
- A metrics store, SLOs, tracing, a status page, and ontology curation beyond the Concept Types list.
- Multi-process repository locking, a second api process, and an estate resize.
- Desktop Safari and Firefox. v0.1 supports desktop Chromium and iPhone WebKit, and C1 adds the iPhone run to the browser suite.
