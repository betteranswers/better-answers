# S4 — The roles' surface, read back, and the contract's digest

The work Root C of the 2026-09-21 architecture review settled: it lands before Root B's build and all of it before S4, where every connector adds tables and worker grants. The decisions are ADR 0032's amendment of 21/09 (`worker_rt` is deny-by-default; the roles' surface is generated from `pg_catalog`, not declared) and ADR 0031's of the same day (the contract's version is a digest both tiers compute and the worker reads at run time; a manifest entry's form is held to the disk). Read both amendments first. This spec says what is built, in what order, and how it is proved.

## Problem Statement

Migration 0000 grants `app_rt` and `worker_rt` SELECT, INSERT, UPDATE and DELETE on every table any later migration creates in `public` and `index`. Every privilege statement since has been a subtraction — 28 REVOKEs against `worker_rt`, covering 45 table names — or, after a subtraction, an addition back. A table whose migration forgets its REVOKE is a table the worker can write, and nothing says so. Four are in that state today: `job`, `workspace`, `workspace_config` and `llm_route`. Two of the four have no reader in `apps/worker/src` at all, and on one the worker holds DELETE. Nothing granted it, nothing revoked it, nobody wrote it down. S4 brings a connector per source system, each with its own tables and grants, and under today's default each starts open to the worker unless its author remembers a line that is on no checklist.

The second statement of the same fact is no better. `CROSS_OWNER_TABLE_ACCESS` is keyed by module, not role, with no privilege vocabulary: `access: "read and write"` covers SELECT, INSERT, UPDATE, DELETE on `index.chunk` and SELECT, UPDATE on `source_document` alike, and its nine `WORKER` rows are checked against the file tree and the table declarations and against no database ever.

And the two tiers disagree quietly. `contract_version` is a number in `contracts/manifest.json` read by two tests, each against a constant hand-written beside it in the same repository at the same commit, so it can fail only by forgetting to edit a number. Where the tiers genuinely skew — two images from one commit, one of which failed to build — nothing reads it, and the worker keeps claiming. Two smaller things wear the same shape: the manifest declares a form for `credential-envelope` and `cost-ledger` and neither has a file, because the inventory check never joins `agreements[id].form` to the disk; and which suggestion kinds each role may raise is asserted by a regular expression over one migration's text, which is a check on history rather than on the function in front of it.

## Solution

The worker's role is deny-by-default in both schemas. A migration that wants the worker to reach a table says so in a GRANT; a migration that forgets grants nothing. `app_rt` keeps its defaults, because the app owns the schema (ADR 0007). With that flip the GRANT lines are the one statement of intent, so the second statement is deleted rather than checked: a snapshot of role × object × privilege is generated from `pg_catalog` after migrating, committed, and drift-checked on the road the worker's schema view already travels, so a widened surface is one line in a diff somebody reads in the PR that widens it. What the catalogue cannot express — the four `SECURITY DEFINER` functions and the tables each reaches past its caller's grants — is one declared note, and nothing else is declared.

The contract's version becomes a digest of `contracts/`, computed by each tier from the same bytes in the same order, stamped by `migrate`, compared by the worker beside the schema stamp it already checks. A half-deployed pair of tiers refuses work loudly, in the words the schema stamp already uses, instead of working on and disagreeing. A manifest entry's form is held to the disk. And the role-to-kinds fact is asserted by calling the live function as each role.

## User Stories

### The owner

1. As the owner, I want a connector's new table to give the worker nothing until a migration says otherwise, so that S4's reach grows only where somebody wrote it down.
2. As the owner, I want the worker's whole privilege surface to be one file I can read, so that "what can the ingestion tier touch" has an answer rather than a sweep of 28 REVOKEs.
3. As the owner, I want the privileges nobody meant — DELETE on a table the worker never reads — taken away in the change that makes them visible, so that the file starts true.
4. As the owner, I want the hand-written second statement of the worker's reach deleted rather than tested, so that a privilege is said in one place and read back in one place.
5. As the owner, I want a partial deploy to stop the worker rather than let it work under a contract it does not speak, so that a failed image build is an outage I see and not answers I cannot trust.
6. As the owner, I want a form the manifest claims to be a file on disk, so that an agreement cannot be recorded as settled while nothing holds either tier to it.

### The operator

7. As the operator, I want a worker that finds a contract digest it does not match to claim nothing, log once, and start again by itself when the deploy finishes, so that the refusal needs no intervention and does not bury the release it is about.
8. As the operator, I want a mismatch under `--once` to exit non-zero, so that a cron wrapper and a smoke check can tell a refusal from a quiet success.
9. As the operator, I want the digest check to behave exactly as the schema stamp check does, so that there is one refusal to recognise in the logs and one runbook line for both.
10. As the operator running a restore drill, I want the privileges snapshot to be the same file whatever tenants the restored database holds, so that the drill's diff is about the restore and never about how many workspaces exist.
11. As the operator, I want a worker image that failed to build to idle the worker, and a schema-only deploy not to, so that the two stamps stay two questions.

### The platform acting as itself

12. As the worker's loop, I want to check the contract digest in the same tick, over the same connection, as the schema stamp, so that claiming work costs one extra read and no new seam.
13. As the worker, I want the digest I compare against to be baked into my own image, so that the comparison cannot be defeated by reading the same directory the other tier read.
14. As a run, I want a table I may not touch to refuse me at the grant rather than at a policy, so that a mistake is an error on the statement and not a silent zero rows.

### The builder in S4

15. As the agent building a connector's migration, I want a failing test to tell me my new table grants the worker nothing, so that I learn the rule from the build rather than from a review comment.
16. As the agent adding a grant, I want the whole change to the worker's reach to appear as lines in one generated file in my own PR, so that I see what I widened before anyone else reads it, and regeneration to be one command in the schema workspace.
17. As the agent adding a `SECURITY DEFINER` function, I want a test to fail because the declared note does not name it, so that a function reaching past its caller's grants cannot arrive silently.
18. As the agent editing a fixture, I want to edit no number anywhere, so that admitting an agreement is a commit to the file and to the tiers and nothing else.
19. As the agent adding an agreement, I want the suite to fail until the form I declared has a file, so that I cannot record an intention as a contract.

### The reviewer

20. As a reviewer, I want a widened privilege to be one line naming the role, the object, the column and the verb, so that I do not reconstruct a surface from a REVOKE-then-GRANT sequence.
21. As a reviewer, I want a run-time partition to add no rows and a bump of the Postgres image to leave the file alone, so that the diff I read is about privileges and never about tenancy or a dependency.
22. As a reviewer, I want a `SECURITY DEFINER` row to read as "this role's surface on the tables this function touches is not stated here", so that I know where the file stops.
23. As a reviewer, I want the four pieces to arrive as four PRs, so that the flip, the digest and the two small gates are each judged on their own.

### The security reviewer of a client

24. As a client's security reviewer, I want one committed file stating every privilege each runtime role holds on every object, to the column and the function, so that I can assess the ingestion tier's reach without a database or an interview.
25. As a client's security reviewer, I want that file to state that neither runtime role carries `rolbypassrls` or `rolsuper`, so that the row-level-security claims made elsewhere are not vacuous.
26. As a client's security reviewer, I want the file to name the functions that reach past their caller's grants rather than imply no such reach exists, so that its silences are declared.
27. As a client's security reviewer, I want to be told what the file cannot say — which migration granted a column, and whether a grant was meant — so that I read it as a surface and not as an intent.

## Implementation Decisions

### The flip

One migration, moving no existing object's privileges: `ALTER DEFAULT PRIVILEGES … REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt` in `public` and in `index`. Default privileges live in `pg_default_acl` alone, so every relation's ACL is byte-identical before and after; what changes is what the next table created in either schema inherits, which is nothing.

The same migration writes out by name what the worker held by the default alone and keeps — `job` (SELECT, INSERT, UPDATE; DELETE already revoked), `workspace` (SELECT), and its SELECT on the `"index".chunk` parent, which discharges the duty ADR 0032's amendment of 19/09 left on the next migration to touch that table's privileges. Those GRANTs restate privileges the relations already carry, so they move no row of the snapshot; they move where the privilege is said. It revokes what the worker held and never read: `llm_route`, on which it could DELETE, and `workspace_config`. That is the migration's one behaviour change, taken knowingly.

And it brings five functions under this journal's own pattern — `REVOKE EXECUTE … FROM PUBLIC`, then a GRANT to the roles that call it, as migration 0022 does for the queue's four. The five are `current_workspace_id`, `llm_route_for`, `suggestion_decides_once`, `graph_generation_flip_guard` and `graph_row_generation_guard`: they carry no EXECUTE statement of their own, and a null `proacl` is not "nobody" but PUBLIC EXECUTE, which is why a sweep of the journal's GRANT lines never found them. `current_workspace_id` goes to both runtime roles, because every tenant policy calls it. The three trigger functions go to nobody — EXECUTE on a trigger's function is checked when the trigger is created, not when it fires, and the migration's test proves a write still fires each of the three. `llm_route_for` goes to the roles its callers run as, read off those callers.

Two consequences follow. The 28 REVOKEs become no-ops — they stay, the journal being append-only, but they stop being what makes the surface true. And the census's asymmetry survives into the generated file, where it is now legible: `app_rt` has a defaults block and `worker_rt` does not.

### The snapshot

Seven blocks, each a fact a migration can move: the roles and their attributes; the default privileges read back from `pg_default_acl`; schema USAGE; relation privileges to the row, with relation kind and whether it is a partition; column privileges, one row per (role, object, column, privilege); function EXECUTE with identity arguments and whether the function is `SECURITY DEFINER`; and ownership as a count per owner and relation kind. Relations whose ACL is null are counted and named once rather than given a row each, which would double the file for no fact.

The format is JSON, one compact object per line inside a pretty outer structure, the generator asserting its own output parses: the diff is then exactly one line per privilege gained or lost, which is the whole of the design's claim. Pretty-printing spreads one privilege over four to seven lines and TSV cannot distinguish a missing field from an empty one — the trade `schema_view.py` already makes by rendering formatter-stable Python rather than a pickle. Two normalisations make it committable: the owner, whatever role ran the journal, is emitted as `<migrator>`; and run-time partitions collapse to a token naming their parent. Today that collapse never fires, because a partition inherits no ACL and a statement routed through the parent is checked against the parent's ACL — but it is what stops the file growing a row per tenant the day a future `create_workspace_partition` issues a grant of its own.

Two traps decide the query set, both hit live in the spike. `pg_get_userbyid(0)` returns not NULL but the string `unknown (OID=0)`, so the `COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC')` idiom silently drops every PUBLIC row and produces a file that looks complete; the grantee test is `CASE WHEN a.grantee = 0 THEN 'PUBLIC' …`. And a null `proacl` is materialised through `acldefault`, so PUBLIC EXECUTE appears as a row rather than as an absence. An extension's own functions — pgvector ships 121 — are excluded by their `pg_depend` extension dependency, so an image bump does not churn the file.

It is generated from a migrated database with one workspace partition already made, and travels the road the worker's schema view travels: a generator script in the schema workspace starting its own migrated Postgres, a command in that workspace's `package.json`, and a drift test regenerating over a fresh migrated database and comparing committed bytes to regenerated ones, inside that workspace's `test` and with no CI step of its own. The generator must never be what CI runs, and the comparison must never be the file against itself: the spike's first run was wrong and silently so.

`CROSS_OWNER_TABLE_ACCESS` loses its nine `WORKER` rows and the entry that made `apps/worker` a named owner, keeping its 28 rows for the app's own slices. It never held anything about a database — its suite checks it against the file tree and the table declarations — and after this it holds nothing about the worker either. What stops its new silence being read as a statement is the snapshot beside it: the file that does state the worker's surface is generated, committed and drift-checked, so there is no question the map is the only answer to.

### The declared note

Four functions are `SECURITY DEFINER`, where ADR 0032's title counts one: `create_workspace_partition`, which lets `app_rt` create a partition of `index.chunk` in a schema it holds only USAGE on; `submit_suggestion_set`, through which both roles write `concept_write_request` and `suggestion` while the snapshot shows `worker_rt` holding nothing on either; `suggestion_set_summary`, which reads `suggestion` and reaches no further than its caller's grants; and `concept_write_request_for`, which reads a table `app_rt`'s ALL is revoked on.

Each function's row carries `security_definer`, so the existence of a reach is generated. What cannot be generated is the reach itself, which is the body's and not the ACL's. One note names those four and the tables each reaches, and nothing else is declared. A test holds the roster — the `SECURITY DEFINER` set in the catalogue equals the set the note names, both ways — so a fifth arrives as a red suite. Which tables each one reaches is the body's, so the note states that much of itself is unheld.

### The digest

A file set, an order and a framing, stated so that TypeScript and Python agree byte for byte.

**The file set** is every file under `contracts/`, at any depth, whose relative path has no segment beginning with a dot, minus `README.md`. That is the walk both halves already implement and each already proves against a throwaway tree, with one change: `manifest.json` is in. It has to be — an agreement in *sql-function* form adds no file, so a manifest the digest ignored would let a new agreement arrive without changing the contract. `README.md` is out: it is prose for a person, and a typo fix must not idle the worker. Nothing outside `contracts/` is in, and neither tier's own generated digest constant is in.

**The order** is the relative paths, written with `/` as the separator whatever the platform's separator is, encoded UTF-8, sorted by byte — not by code point, not by locale, not by the order a directory walk returns.

**The framing**, per file: the path's UTF-8 bytes, one `0x0A`, the content's length in bytes as decimal ASCII, one `0x0A`, then the content's bytes. Length-prefixing makes a boundary unforgeable — without it a file whose content holds a newline and a plausible path could be rearranged into a different file set with the same stream. Content is read as bytes and never decoded, newline-normalised or trimmed: a checkout with CRLF endings is a different digest, which is correct, because the tiers would be reading different bytes; the repository carries no `.gitattributes`, so git checks out what is committed. The hash is SHA-256 over that stream, rendered as 64 lowercase hex characters, whole — no short form, because a truncated digest in a log is a value somebody compares by eye and gets wrong.

**Each tier carries its own constant, generated and committed.** Neither image copies `contracts/` — the api's copies `apps/api/src`, `packages/core/src`, `packages/schema/src` and `packages/schema/migrations`, the worker's copies its `src` — so a tier computing the digest at run time would have nothing to compute it from. Each gains a generated module holding the digest, produced by a generator in its own workspace, committed, and drift-checked by regenerating from `contracts/` and comparing: ADR 0028's mechanism and `schema_view.py`'s road applied to a second value, under which a hand-edited constant fails its own tier's check.

`migrate` stamps the api's constant into a one-row platform table after applying the journal. The table carries no `workspace_id`, so it joins `RLS_EXEMPTIONS` with a reason and `TABLE_OWNERS` gains its row, and `worker_rt`'s SELECT on it is written out by name in the migration that creates it — the first grant written under the new rule. The worker reads it in the same tick, over the same connection, beside the schema stamp, and refuses identically: claim nothing, log once rather than once a tick, sleep the idle interval and re-check so the refusal lifts by itself when the deploy finishes; under `--once`, return 1. The log line names both stamps' state, so one line tells an operator which disagreed.

`contract_version` leaves `contracts/manifest.json`, and `SPOKEN_CONTRACT_VERSION` leaves both suites with the tests that read it.

### A form held to the disk

The inventory check gains the join it never made: for every entry of `agreements`, *fixtured* means the manifest lists at least one fixture under that agreement and the path exists; *generated* means golden rows exist on disk under it; *sql-function* asserts nothing about files. Both ways, in both suites, beside the walk they already do.

`credential-envelope` declares *fixtured* with no directory and no entry; `cost-ledger` declares *generated* with no golden rows. **The recommendation is that both leave the manifest and return with their build.** Neither subject exists: there is no envelope module under `packages/core/src` or `apps/worker/src`, and `llm_call` appears in the tree as one line of prose in `packages/core/src/llm/index.ts` with no table in any migration. A fixture written now would be the agreement describing itself rather than being held to something — the failure ADR 0031's redaction amendment names in so many words. The envelope returns with ADR 0041's build and the ledger with the `llm_call` table, each bringing its file in the commit that makes it real. The amendment's words are "get theirs or change form", and leaving the manifest is a third answer, so **this is the ticket's to confirm with the owner before it is built.**

### The role-to-kinds fact, probed live

`kindsAdmittedFor` — a regular expression for `WHEN '<role>' THEN ARRAY[…]` over `0018_the-inbox-substrate.sql`'s text — is replaced by a probe of the function in front of it. In a migrated database, inside a transaction carrying a workspace scope, `SET LOCAL ROLE` to each runtime role in turn and call `submit_suggestion_set` once per role and per suggestion kind with an otherwise well-formed one-request set: an admitted kind lands its rows, a refused kind raises with SQLSTATE `insufficient_privilege`. The pair is asserted both ways against `SUGGESTION_KINDS_FROM_THE_APP` and `SUGGESTION_KINDS_FROM_A_RUN`, and a third caller — the migrator, which the function's `CASE` leaves null — is refused on every kind.

The instance the regex checks is correct at HEAD: `submit_suggestion_set` is defined once, in 0018, and never replaced or dropped. It is the pattern that is unsound, and two functions in the journal show why — `claim_job` is defined in 0022, dropped in 0035 and recreated there, and `create_workspace_partition` is replaced by 0037. The prior art for the replacement is in the same package: a suite that finds a migration's own statement and *executes* it rather than asserting on its text.

### Where a repo-level gate lives

Fifteen of the 33 test files in `apps/api/tests/` test the repository rather than the api, none importing `apps/api/src` or its harness, all running inside the lifetime of the Postgres container that workspace's config starts for every run. **The rule, for whoever next touches one: a repo-level gate moves to `packages/devtools` when a ticket already has it open, and never as a ticket of its own.** `packages/devtools` is the workspace that is imported and never deployed, its vitest config registers no global setup, and none of the fifteen needs a database — so the move drops a container start from that gate's path and costs the ticket a file move.

## Testing Decisions

A good test drives the thing through the interface its caller uses and asserts what that caller can observe, never internals. Every store the platform runs is real — here that is Postgres, migrated, and nothing is faked or stubbed for any proof below. A pair is checked both ways. Rows a test needs are seeded through a test factory, never by a raw INSERT written into the test itself. No new seam: every proof runs on a road that exists.

1. **The schema suite, against a migrated database.** Prior art: the worker schema view's drift test, `toBe(regenerated)` over a database from the warm fixture with a both-ways name check beside it; and the RLS suite's existing privilege probe, which asserts `worker_rt`'s four verbs on the `index.chunk` parent and nothing at all on a workspace's partition, against a closed set of the eight privileges the pinned image has. The tests: the committed snapshot equals a regeneration over a fresh migrated database with one partition made, and every role the file names is a role in the catalogue and back. A throwaway table created in each schema after the flip gives `worker_rt` no privilege on any of the eight and `app_rt` all four — the proof that the flip is what makes the file's silence a statement. `has_table_privilege` says false on all eight for `llm_route` and `workspace_config`, and says exactly SELECT, INSERT, UPDATE for `job`, SELECT for `workspace`, the four verbs for the `index.chunk` parent, and the eleven-column sets for `finding` through `has_column_privilege`. No function the journal installs carries a PUBLIC EXECUTE row, and a write still fires each of the three trigger functions whose PUBLIC EXECUTE went. The file holds PUBLIC's schema USAGE on `public`, which turns the generator's own trap into an assertion: the version that lost every PUBLIC row fails here. And the `SECURITY DEFINER` set in the catalogue equals the set the declared note names, both ways.
2. **The worker's loop.** Prior art: the loop's schema-stamp test. A worker whose contract digest does not match the stamped one claims nothing, logs once rather than once a tick, and returns 1 under `--once`; a worker whose digest and schema stamp both match claims. The two mismatches are provoked separately, so neither check passes on the other's behalf.
3. **Both tier-contract suites.** A repo-level gate reads the two tiers' generated digest constants as text and asserts they are equal — the exact proof, over the real directory, that the two languages agree. Beside it, a case table written out in each half over synthetic trees materialised in a temporary directory, each with its expected hex: a nested directory, a file with no trailing newline, a file holding CRLF bytes, an astral character in a filename and in content, an empty file, a dotfile that must not count, and a `README.md` that must not count. The cases are written out in both halves on purpose, on the reasoning those suites were built with: each states what its own tier computes, so a tier that has not been taught a rule fails its own suite, and deduplicating that away would delete the test. Form ↔ disk is asserted both ways in both halves.
4. **The live-function probe.** Prior art: `SET LOCAL ROLE` under the warm fixture, as every role-scoped assertion in the RLS suite does. Each role × kind pair admitted or refused as above, both ways against the two constants, plus the caller the function admits for no kind.

**What no test holds.** Whether a widened privilege was *meant*. The catalogue cannot say which migration granted a column — two migrations' SELECT grants on `finding` merge into one eleven-column set, and a re-grant of a column already held is indistinguishable from a statement doing nothing — and it cannot say intent at all. What the design buys is that the question becomes legible where the change is read: one line per privilege in the diff of the PR that widened it, naming the role, the object, the column and the verb, in front of the `/code-review` that ends the implementing agent's own work. The same holds for what each `SECURITY DEFINER` function reaches: the test holds the roster, the note names the tables, and the body is read where the diff is.

## Out of Scope

- Candidate O, the deploy tree's three hand-rolled compose parsers and the merged document none of them reads — nothing until after v0.1.
- The rule → holder map: the coding-rules reshape has its own handoff.
- Folding the schema stamp and the contract digest into one "same commit" stamp — declined, because an api-only deploy would idle the worker for nothing.
- T-240's question of whether the full-text match can be pushed beneath the RLS qual, and the LEAKPROOF answer to it. It is HEAD's defect, filed, and touches no privilege this spec moves.
- RLS sweeps. Privileges and row-level security are orthogonal and both must hold; the RLS suite already proves `relrowsecurity`, `relforcerowsecurity`, one policy per tenant table and the workspace seam in both `qual` and `with_check`. The snapshot states the privileges and grows no `relrowsecurity` column duplicating a check already made.
- Root B's build (ADR 0044) and Root D's, which this work sequences before and around but does not contain.

## Further Notes

**Sequencing.** Four pieces, three independently mergeable in any order and one that must be second. (1) **The flip and the snapshot, one ticket and one PR** — ADR 0032 says why they are one decision: the catalogue cannot say whether a grant was meant, so it is deny-by-default that makes a row's presence a statement, and a snapshot generated before the flip is a picture of an accident. It lands **before Root B's build**, so the migration that drops `index.chunk`'s four visibility columns lands against a surface already read back. (2) **The form held to the disk** — small, independent of the flip, and it touches both tier-contract suites, so it goes before the digest, which touches the same two files, rather than beside it. (3) **The digest** — after the flip, because its stamp table's `worker_rt` SELECT is written out by name under the new rule, where before the flip that same table would have granted the worker full DML silently, which is the failure this work exists to close. (4) **The live probe for the suggestion kinds** — independent of all three; may land first. All four before S4.

**What the catalogue cannot say.** Which migration granted a column: `pg_attribute.attacl` holds a set, and two migrations' grants on one table merge into one. Intent: a DELETE held by accident looks exactly like one that was given. And ownership as a privilege: the file states who owns each relation, not what that owner may do, because an owner's rights are implicit and appear in no ACL — a smaller hole than it looks, since `FORCE ROW LEVEL SECURITY` binds the owner too.

**Why deny-by-default is the load-bearing half.** Under today's defaults, a row in a generated privileges file is evidence that somebody created a table, not that anybody decided anything. After the flip, every row `worker_rt` holds traces to a GRANT a migration wrote, so the file's presence and its absence both mean something. That is why a hand-written role-keyed declaration swept both ways against the catalogue was rejected: a second statement of one fact, held by a test, with almost nothing left to catch once the default is closed.

**The accepted cost of the digest.** A benign edit to a fixture, or an added fixture, changes the digest and stops a worker whose image was built from an earlier commit. Both images are built from one commit, so that state is a partial deploy and should be loud. The alternative — a narrower stamp, a manifest of what the worker reads — buys machinery against a cost that is the minutes of a deploy that was happening anyway, and ADR 0031 has already named the condition that reopens it: the customer-hosted worker, whose redeploy we do not control.

**The working papers** are under `.scratch/architecture-review-2026-09-21/`: `census-root-c-20260921.md` (every grant, revoke and EXECUTE in the journal, read off the files, with the eleven places the review was wrong or stale), `spike-root-c-snapshot-20260921.md` and its `.json` (the query set verbatim, the census comparison, the flip prototyped and measured, the two traps, the sample one-line diff), and `roots-b-c-d-decisions-20260921.md` (Round 1 Root C, FP4, and the owner's rulings on what the flip grants back). Migration SQL is outside the code index, so an agent verifying a grant reads the files directly.
