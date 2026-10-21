# The v0.1 route

The route is the way from the foundation to a finished v0.1, cut into blocks. This file holds the status table, which is the one home of each block's strand, status, next marker, waits and plan, and the rules a session follows to pick a block and to keep the table true. Each live block's brief is `docs/specs/route/<id>.md`, and `docs/specs/route/seams.md` names the test seams a brief cites.

## Where each block stands

| Block | Strand | Delivers | Blocked by | Status | Next | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | knowledge | Personal data withheld before any store, and an erasure that says what it did | none | done | | [S0's spec](../archive/specs/s0-redaction-seam-and-erasure.md) |
| S1 | knowledge | One uploaded document to a cited passage, with no embedding | S0 | done | | [S1's spec](../archive/specs/s1-one-uploaded-document-to-a-cited-passage.md) |
| S2a | knowledge | Search and the concept page, with no model call | S1 (`open` by locator) | done | | [S2a's plan](../plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md) |
| S2b | knowledge | Ask answers from concepts with citations or refuses, and the Questions pages | S2a, S1 (unmapped passages) | done | | [S2b's plan](../plans/2026-10-11-2309-feat-s2b-ask-plan.md), [rarity-weighted matching](../plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md) |
| [S4](route/s4.md) | knowledge | The website and a SharePoint library as connected sources, priced before they sync | S1 | unplanned | | |
| [S6](route/s6.md) | knowledge | A bid's question set answered and exported as a response-set document | S2b, S3 | unplanned | | |
| [S7](route/s7.md) | knowledge | Suggested concepts extracted from synced sources within the spending limit | S4, S3 (the Kinds rename) | unplanned | | |
| [S8](route/s8.md) | knowledge | Concept vectors, taken up only when its trigger fires | trigger | reserve | | |
| [S3](route/s3.md) | records | Concepts typed and edited, guides built from them, owners per collection | none | planned | next | [plan](../plans/2026-10-21-1721-feat-s3-concepts-and-guides-plan.md) |
| [S5](route/s5.md) | records | Every suggestion decided on To decide, and answers promoted to `Answer`s | S2b, S3, S7 (the by-sync filter), V1 (flag routing) | unplanned | | |
| [V1](route/v1.md) | records | Verification requests, shelf life, and conflicts a person resolves | S3 | unplanned | | |
| [P1](route/p1.md) | people | People's pages, Microsoft sign-in and the Account page | none | building | | [people layout rework](../plans/2026-10-01-1807-feat-people-layout-rework-plan.md), [sign-in and security](../plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md) |
| P2 | people | The platform console, with provisioning and a first member | P1 | done | | [P2's spec](../archive/specs/T-028.md) |
| [O1](route/o1.md) | ops | Signals, System's cards, backups, and the Erasure and suppression page | S0 | unplanned | | |
| [C1](route/c1.md) | customer | The first customer onboarded, and its real answer tests read | S5, S6, P1, O1 | unplanned | | |

Every block gates v0.1 except S8, in reserve. Rows are in build order within a strand.

## How a session uses the route

### Pick a block

1. Read the table above. Nothing else is needed to pick.
2. If a row on your strand is building, continue it. Open its plan and build the units that have not merged. Do not plan it again.
3. Otherwise take the row marked next on your strand. The owner's prompt names the strand. With none named, take any strand's next.
4. If your strand has no next, take the first row in table order that is planned or unplanned and whose Blocked by entries are all met. Build a planned row from its plan.
5. A parallel session may take a second row on a strand by rule 4. Two sessions never take one block.
6. Read the block's brief, `docs/specs/route/<id>.md`. List the open Linear issues that carry the block's label, from the Route Block label group.
7. If one owner can build the block in one session, take it to `/poteto-mode`. Otherwise plan it first with `/poteto-mode plan <id> in docs/plans/`.

### Read the Blocked by cell

- A bare id, such as `S3`, is met when that row is done.
- An id followed by bracketed words, such as `S7 (the by-sync filter)`, holds only the units those words name. Plan the block anyway, and list the entry among those units' dependencies. Remove the entry in the pull request that merges the last unit it names.
- `trigger` on a reserve row means it waits on the measure its brief names.

### Change the table

Change a row in the pull request that makes the change true. Each fact has one cell, so each change is one edit.

| When | Edit |
| --- | --- |
| The pull request that adds the block's plan | Status to `planned`, and the plan's link in Plan |
| The first pull request that builds the block | Status to `building`, and Next cleared |
| The last unit has merged, and every Done when check in the brief holds | Status to `done`, the brief deleted from `docs/specs/route/`, and the Block cell unlinked |
| A plan or an owner ruling changes what a block waits on | Blocked by |
| A reserve row's trigger fires | Status to `unplanned` |

Before a row turns done, file what the block still owes as Linear issues under its label. A block is done when its Done when checks hold, not when every issue on its label has closed. Work that lands ahead of its block, with the owner's agreement, leaves the status alone. The same pull request moves the line from the brief's Must carry to its Builds on.

### Set next

- The owner sets Next. A session writes it only on the owner's word in that session, in a pull request that changes the table.
- A strand has one Next at most, on an unplanned or planned row. It never sits on a building, done or reserve row. The pull request that starts building clears it.
- With no marker on a strand, rule 4 picks.

### Keep a brief current

- A brief states what is true now and what the block still owes. It holds no date, no struck text and no account of who ruled when.
- When the owner rules, rewrite the statement the ruling changes. Cite the ruling's ADR, plan or issue if it has one. Otherwise the statement stands on its own.
- When a brief disagrees with an ADR, the glossary or the tree, they win in that order. Rewrite the line to match, in the pull request that found the disagreement.
- A brief lists no issues, because the Linear label does. It cites a `BA-N` only inside the obligation whose detail that issue holds.
- A plan edits its block's brief only to remove an obligation that no longer stands or to add one that is missing. The plan's own design stays in the plan.

### Put everything else in its place

| What | Where |
| --- | --- |
| A measurement, such as a recall reading | A row under its measure in `docs/operations/readings.md` |
| Work not yet planned, or a finding put off for later | A Linear issue, with a block's label where it belongs to one |
| A decision that is hard to reverse | Its ADR under `docs/solutions/architecture-patterns/` |
| A user story | `docs/specs/v01-stories.md` |
| What happened, and when | git, and `docs/archive/` |

The merge group runs `packages/devtools/test/route-spec.test.ts` through `pnpm check:docs` in the docs lane and devtools' `check` in the full lane. Each violation names its rule.

## Not in v0.1

- The bids-and-proposals stage and the Then and Later stages of `VISION.md`. S5 and S6 fix the knowledge-side contract the next stage consumes.
- Sources read live and the share agent (ADR 0013), and the HubSpot and Asana connectors.
- Agent capabilities beyond the four read entries: `action:*` scopes, Agent Auth, the approval layer, the packaged client-side plugin. An MCP App that shows a concept file inside Claude is built from its own plan when one is written, and takes a row then.
- Imported and vendor bundles, the sensitivity-filtered bundle export, a read-only clone endpoint, and scheduled exports.
- A `.docx` response set with real footnotes, JavaScript-rendered pages in the website connector, and local embedding on the first estate (ADR 0024). No embedding at all until S8's trigger fires (ADR 0016, ADR 0020).
- A metrics store, SLOs, tracing, a status page. Ontology curation beyond the Kinds list. Multi-process repository locking, a second api process, a resize of the estate.
- Desktop Safari and Firefox. v0.1 supports Chromium on the desktop, which is Chrome and Microsoft Edge, and WebKit on the iPhone, which is every iOS browser. The browser suite proves Chromium today, and C1 adds the iPhone run.
- Tagline and positioning copy, and trade-mark work.
