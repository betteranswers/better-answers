---
date: 2026-09-01
task: T-003
status: research
---

# What `audience` requires, and which column shape should carry it

Read on 1 September 2026. Every in-repo claim cites a file and line; every PostgreSQL claim
cites postgresql.org, fetched today (`[DEPS1]`).

## The question

T-003 landed the three visibility columns on `index.chunk`. `sensitivity` was narrowed at the
boundary to the glossary's closed set; `audience` stayed unrefined text
(`packages/schema/src/boundary-schemas.ts:46-51` on `origin/t-003-database-substrate`), because
the glossary defines it as "everyone in the workspace, or named groups" — a representation
question, not a closed word set. What exactly does the term require, and which column shape
should carry it on every readable unit?

## Findings — the requirement, pinned

**1. Audience is one of three independent viewing terms, applied together on every read.**
The glossary: "**audience** — who a binding's content is for: everyone in the workspace, or
named groups. Set on the binding, carried with sensitivity onto every chunk and source entity,
and applied with *published* on every read and traversal hop. Distinct from sensitivity (how
confidential) and from trust (how reliable)" (`CONTEXT.md:198-201`). It is never a role: "a
binding's *audience* is who may see, never a role" (`CONTEXT.md:456`).

**2. It narrows both non-Restricted sensitivity classes and *is* the member list for
Restricted.** Internal is "the workspace, narrowed by audience"; Public is "still narrowed by
audience" and "never a bypass" (`CONTEXT.md:129-134`; ADR 0020,
`docs/adr/0020-personal-data-is-withheld-at-the-seam-before-any-store-and-erased-from-every-copy-by-routine.md:8`).
For Restricted, the sensitive-data briefing is explicit that the same field carries the named
members: "viewable by Admins and by members an Admin has named on the binding (the *audience*
of a Restricted binding is that list, never *everyone*)"
(`.scratch/v01-spec/briefings/24-sensitive-data-briefing.md:28`). So the value space must
express *everyone* and *a named set of people* — and the two briefings name that set
differently (groups vs members; see open question 1).

**3. The values are group ids, resolvable to the caller per read.** The records briefing fixes
the binding column as "`audience` ∈ everyone · team ids (**from the first migration**)"
(`.scratch/v01-spec/briefings/16-records-briefing.md:143`) and names the group source:
"`team` = the audience groups a binding's `audience` references" — Better Auth's organisation
plugin table (`.scratch/v01-spec/briefings/16-records-briefing.md:158`). The destination
briefing's Dust mapping says the same: "Space membership is the binding's **`audience`**
(everyone | group ids, from the first migration — 51)"
(`.scratch/v01-spec/briefings/53-destination-briefing.md:148`). The ACL research derives the
chain: "IdP (Entra / Google) → SCIM groups → platform groups → binding audience … In v0.1 the
platform's own groups (ADR 0009's organisation plugin) stand in for the SCIM layer"
(`.scratch/v01-spec/research/permission-aware-publishing-and-acl.md:91`), and "v0.1 needs the
**audience** column and its retrieval-filter term from the first migration; the
group-management UI can wait" (same file, line 10).

**4. Membership is resolved at read time, never carried in the token.** "groups never enter it
[the access token] — role and groups are re-read per call"
(`docs/adr/0009-better-auth-in-process-identity-provider.md:30`); T-004's principal line: "the
token supplies `{workspace, user}`; the data layer resolves role and group membership **in the
same transaction as the read it authorises** … a failed resolve is a refusal, never a default
role" (ordna task `refs/ordna/tasks/T-004`, acceptance criteria). So whatever the column
holds, every read has the caller's resolved group-id set available in the same transaction to
test against it.

**5. The predicate is one term in one SQL statement, tested against columns on the readable
unit.** Search is "one SQL statement with the predicate (published · sensitivity · audience ·
role) applied before ranking"
(`docs/adr/0016-an-answer-asserts-concepts-only-found-by-traversal-and-served-as-one-contract.md:8`).
The predicate is "tested against **columns on the readable unit** … never against three fields
of a source binding, because a concept and a composition have no binding"
(`CODING_RULES.md:99`). On graph reads it applies "on every node and edge of the path"
(`docs/adr/0023-the-graph-is-apache-age-inside-the-platform-postgres.md:21`, engine superseded;
the columns land on `graph_node`/`graph_edge` rows under ADR 0032,
`docs/adr/0032-the-graph-is-plain-tables-under-rls-the-substrate-is-one-journal-one-role-seam-one-definer-function.md:22`).
Failure must be silent and total: "Nothing withheld is ever counted, hinted at or explained on
any surface" (ADR 0016:8; briefing 24:114 — "no hit, no *incomplete* hint … no count").

**6. The derivation cascade writes the column on units that have no binding.** ADR 0023's
standing amendment: the three terms "become real columns on `concept_index`, on `composition`
and on every `index.chunk` row whatever its unit kind", recomputed "synchronous, inside the
narrowing act's own transaction", cascading "**two levels**, binding → concept → composition"
(`docs/adr/0023-the-graph-is-apache-age-inside-the-platform-postgres.md:71`). The rule as
written defines the combination only for the *class* ("a concept's class is the most
restrictive among the bindings of the evidence it cites"); it defines no combining rule for
audience (see open question 2). The worker writes the same columns on graph rows
(`docs/adr/0032-…:47`), so the representation must cross the tier contract to Python
unchanged.

**7. OKF v0.2 leaves all of this open.** "Trust tiers are advisory signals, not access
control" (`docs/okf-v02.md:10`); access control is a named silence this platform meets in
records and the graph, never in the concept file (`docs/okf-v02.md:31`; ADR 0023:71 — "A class
is a record, not knowledge"). No OKF key constrains the representation.

**8. As built today**, `index.chunk.audience` is `text NOT NULL`
(`packages/schema/src/index-tables.ts:45` on `origin/t-003-database-substrate`), boundary-
narrowed only to non-empty (`boundary-schemas.ts:49-51`). A single text column cannot hold
"named groups" without an encoding convention, so it satisfies only the *everyone* half of the
term; the substrate's own fail-closed principle — "A missing scope is an empty GUC is zero
rows" (`packages/schema/src/with-rls.ts:21-22`) — is the bar any refinement must keep.

## Findings — PostgreSQL, for the representation options

- Array containment and overlap are first-class operators: `@>` "Does the first array contain
  the second …" and `&&` "Do the arrays overlap, that is, have any elements in common?"
  (https://www.postgresql.org/docs/current/functions-array.html, Table 9.56, fetched
  01/09/2026).
- GIN's built-in `array_ops` operator class indexes exactly these predicates: `&&`, `@>`,
  `<@`, `=` on `anyarray` (https://www.postgresql.org/docs/current/gin.html, Table 65.3,
  fetched 01/09/2026).
- RLS policy expressions are "evaluated for each row prior to any conditions or functions
  coming from the user's query", the only exception being `LEAKPROOF` functions, which "the
  optimizer may choose to apply … ahead of the row-security check"; policies that "consider
  only the current values in the row" are "the simplest and best-performing case", and
  consulting other rows or tables from a policy needs sub-`SELECT`s that "can create race
  conditions that could allow information leakage"
  (https://www.postgresql.org/docs/current/ddl-rowsecurity.html, fetched 01/09/2026). Two
  consequences: (a) an audience term inside an RLS `USING` clause would need a per-row
  membership sub-`SELECT` — the documented worst case; (b) with the term instead in the
  application's own `WHERE` (where CODING_RULES.md:99 puts it), the non-leakproof array
  operators simply run after the workspace-isolation qual, which is the correct order anyway.
  The docs do not state the leakproofness of the array operators; if a policy-side term is
  ever proposed, `pg_proc.proleakproof` for `arraycontains`/`arrayoverlap` is checked then,
  not recalled.
- The pages fetched do not document `&&`/`@>` behaviour for empty arrays or NULL elements
  (checked https://www.postgresql.org/docs/current/functions-array.html, 01/09/2026). Whatever
  shape lands, the fail-closed edge cases (`'{}'` on either side, NULL column) are pinned by a
  functional test in the same PR, not by citation.

## The candidates

The caller's side of every predicate below is `$callerGroups` — the group ids T-004's data
layer resolves in the read's own transaction (finding 4).

### 1. Sentinel word + separate group-id array column

`audience text NOT NULL` ∈ `everyone · groups` (boundary-narrowed to the closed pair, exactly
as `sensitivity` was) plus `audience_groups text[]`, with a CHECK tying them together
(`everyone` ⇒ NULL array; `groups` ⇒ non-empty array).

- **One-predicate term:** `(audience = 'everyone' OR audience_groups && $callerGroups)` — one
  line, GIN-indexable on the array half (Table 65.3), though on `index.chunk` the access path
  is the vector/FTS index and the visibility term is a filter, so index support is a bonus,
  not the case for the shape.
- **Fail-closed:** yes, twice over. An unwritten or garbled word matches neither branch; a
  NULL or empty array matches no overlap. This is the `with-rls.ts:21-22` posture.
- **RLS cost:** none — RLS stays the single workspace-isolation policy
  (`packages/schema/migrations/0002_chunk-and-functions.sql:25-27`); the term lives in the
  store door's SQL per CODING_RULES.md:99.
- **Cascade:** writes two columns per row, but the derivation is expressible: `everyone` is
  the identity element, and named sets combine by array intersection, with the empty
  intersection representable (see open question 2) without inventing a magic value.
- **Boundary/tier contract:** matches ADR 0028's built pattern — the column stays wide, the
  boundary narrows (`boundary-schemas.ts:46-48` did exactly this for sensitivity); `text[]`
  crosses to the Python worker as a plain array.
- **Cost:** two columns that can disagree without the CHECK; the CHECK is the price of the
  explicit tag.

### 2. Single nullable group-id array, NULL = everyone

`audience text[]`, NULL meaning everyone, non-empty meaning named groups, GIN-indexed.

- **One-predicate term:** `(audience IS NULL OR audience && $callerGroups)`.
- **Fail-closed: no.** The *widest* grant is the *absent* value: a row written with no
  audience — a bug, a missed cascade, a bad worker write — is visible to the whole workspace.
  It also surrenders the existing `NOT NULL` (`index-tables.ts:45`) and drizzle-zod's
  generated schemas would read the column as optional, so the boundary loses "must be set".
  The alternative encoding (NOT NULL, `'{}'` = everyone) is worse: the natural zero value
  becomes the widest grant.
- **Everything else** (RLS cost, cascade arithmetic, tier crossing) matches candidate 1, minus
  one column.

### 3. Join table (`audience_member` rows per readable unit)

A `chunk_audience(workspace_id, chunk_id, group_id)` table (and siblings for `concept_index`,
`composition`, `graph_node`, `graph_edge`), *everyone* as absence of rows or a sentinel row.

- **One-predicate term:** an `EXISTS` sub-select per unit kind — the predicate no longer reads
  "columns on the readable unit", which is the letter of CODING_RULES.md:99 and ADR 0023:71
  ("so the predicate has something to test everywhere it is applied").
- **Fail-closed:** only with a sentinel row for *everyone*; absence-of-rows-means-everyone is
  fail-open, absence-means-no-one makes every existing row invisible until backfilled.
- **Cascade cost:** the synchronous two-level recompute (ADR 0023:71) becomes DELETE+INSERT
  across five side tables inside the narrowing transaction, instead of an UPDATE of the rows
  it already touches; every side table needs its own `withRLS()`, partitioning to match
  `index.chunk`'s `PARTITION BY LIST` parent (`0002_chunk-and-functions.sql:21`), FORCE line
  and journal entry.
- **When it wins:** many groups per unit with per-group metadata (granted-by, granted-at).
  Nothing in the briefings asks for that; the binding is the unit of grant
  (`CONTEXT.md:198-199`).

### 4. Row-per-group duplication of readable units

Each readable unit written once per audience group; the predicate becomes an equality join.

- Duplicates the 1024-float embedding per group per chunk; breaks ADR 0016's "one hit per
  unit" (`docs/adr/0016-…:8`) without a dedup pass; an audience change becomes row
  creation/deletion across every derived store rather than a column update, which the
  synchronous cascade cannot afford inside one transaction (ADR 0023:71). No briefing
  supports it; listed for completeness only.

## Recommendation

**Candidate 1: the sentinel word plus a group-id array.** It is the only shape that is
simultaneously fail-closed (the substrate's stated posture, `with-rls.ts:21-22`), a plain
column on every readable unit (CODING_RULES.md:99, ADR 0023:71), a one-line term in the one
predicate (ADR 0016:8), writable by the two-level synchronous cascade as an UPDATE, and an
exact repeat of the pattern T-003 already established for `sensitivity` — wide column,
narrowing boundary (ADR 0028, `boundary-schemas.ts:46-48`). Candidate 2 is one column cheaper
and fails open on exactly the rows a bug produces; candidates 3 and 4 move the predicate off
the row and multiply the cascade's writes.

Concretely, on every readable unit: `audience text NOT NULL` (boundary-narrowed to
`everyone · groups`), `audience_groups text[]` (boundary-narrowed to ULIDs when present), a
CHECK (`audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND
cardinality(audience_groups) > 0`, subject to open question 2's answer on the empty set), GIN
`array_ops` where a table's reads are predicate-led rather than rank-led. The migration is a
widening of T-003's column, not a rework.

**Glossary wording this implies.** *audience* gains a representation sentence, e.g.: "held on
every readable unit as the word — *everyone*, or *groups* — and, with *groups*, the ids of the
named groups; an absent or unknown value reaches no reader." And **group** needs settling as a
domain word before code names it (AGENTS.md's rule): the named set of members an Admin keeps —
Better Auth's `team` table underneath (briefing 16:158) — referenced by a binding's audience;
`CONTEXT.md` currently has no *group* entry, and *team* sits on the workspace entry's avoid
list for the tenancy sense (`CONTEXT.md:428-429`), so the code word should be *group* with
*team* noted as Better Auth's table name, mirroring how *workspace* wraps Better Auth's
*organisation*.

## Open questions

1. **Groups only, or members too?** Briefing 16 fixes the column to "everyone · team ids"
   (line 143), but briefing 24 says a Restricted binding's audience is the list of "members an
   Admin has named" (line 28), and the Guru pattern the research copied grants "Groups or
   users" (`permission-aware-publishing-and-acl.md:88`). Either the array holds mixed
   principal ids (member ids and group ids — T-004's resolver returns both), or naming members
   on a Restricted binding creates/edits a group. The column shape survives either answer; the
   glossary entry and the ADR must pick one.
2. **The audience combining rule for the cascade.** ADR 0023:71 defines "most restrictive"
   for the class only. For audience the natural rule is: *everyone* is the identity;
   named sets combine by intersection. But the empty intersection (evidence from two disjoint
   audiences) is a real state — is it representable (`groups` with an empty array, meaning
   Admins only — which loosens the CHECK above) or does it force the concept Restricted?
   This is the one place the recommended CHECK constraint and the derivation could disagree,
   so it must be settled in the same ADR.
3. **Where the workspace default audience lives.** ADR 0023:71's "a unit with no evidence
   takes the workspace default" names a default class; whether a workspace also carries a
   default audience (a config row, per ADR 0025's pattern) is unstated.
4. **Group id type.** Better Auth's `team.id` format is whatever the organisation plugin
   mints; the boundary refinement (ULID or not) is read from the installed plugin's schema in
   the implementing PR, not assumed here.
