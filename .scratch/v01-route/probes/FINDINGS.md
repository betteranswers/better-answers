# The four probes T-113 owed — run 10 September 2026

The route spec's Further Notes (T-113, 10/09/2026) named four probes the S0 + S1 block spec
must not trust the fold without. All four ran today. The code is throwaway and lives on the
branch `probe/t-113-four-probes`, never on `main`: `packages/schema/test/probe-t113-tsvector.test.ts`,
`apps/api/tests/probe-t113-subscription.test.ts` (with a `probe` router added to
`apps/api/src/trpc/router.ts` for it alone), `packages/core/test/probe-t113-scale.test.ts`, and
`.scratch/v01-route/probes/cocoindex/probe.py` (force-added). Machine: Apple M4 Pro, the warm
Testcontainers Postgres at `pgvector/pgvector:0.8.6-pg18-trixie` (PostgreSQL 18.6, aarch64),
Node 24.19, cocoindex 1.0.20 from PyPI (the clone at `aee7b27d` is `v1.0.20-1-g`).

## Probe 1 — the generated `tsvector` and `DROP NOT NULL` on the partitioned parent

**Verdict: both hold.** Two tests, green on the pinned image.

**(a) `concept_index`.** `ALTER TABLE concept_index ADD COLUMN search tsvector GENERATED ALWAYS AS (…) STORED`
is accepted with this expression — every function in it is IMMUTABLE on 18.6
(`jsonb_path_query_array` is `i`; `to_tsvector(regconfig, text)` is `i`; `setweight` is `i`):

```sql
setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
|| setweight(to_tsvector('english'::regconfig, coalesce(jsonb_path_query_array(frontmatter, '$.tags[*]')::text, '')), 'B')
|| setweight(to_tsvector('english'::regconfig, coalesce(jsonb_path_query_array(frontmatter, '$."also known as"[*]')::text, '')), 'B')
|| setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'C')
```

- `pg_attribute.attgenerated = 's'`; a GIN index on the column is accepted and the planner
  reaches it for the `@@` predicate (bitmap index scan on `concept_index_search_gin`).
- The JSON punctuation the review worried about (`["reimbursement", "travel-costs"]`) is
  dropped by the parser: the stored vector holds `'reimburs':3B 'travel':5B 'travel-cost':4B`.
  A tag, an *also known as*, a title word and a body word each match through
  `websearch_to_tsquery('english', …)`. A row with no `tags` key coalesces to nothing.
- What the review accepted for v0.1, seen: a code span `code_span_token` is indexed as three
  lexemes (`code`, `span`, `token`) and a URL as `example.test/receipts.` (url_path token,
  trailing sentence punctuation kept), so `example.test/receipts` did not match it. S2's
  spec should say code spans and URLs are indexed as the parser tokenises them, not as written.

**(b) `index.chunk`.** One ALTER on the LIST-partitioned parent —

```sql
ALTER TABLE "index".chunk
  ALTER COLUMN embedding DROP NOT NULL,
  ALTER COLUMN embedding_route_id DROP NOT NULL,
  ADD CONSTRAINT chunk_embedding_pair_check CHECK ((embedding IS NULL) = (embedding_route_id IS NULL));
ALTER TABLE "index".chunk
  ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, content)) STORED;
```

- propagates `attnotnull = false` on both columns to a partition that already existed, and a
  partition created afterwards through `create_workspace_partition` inherits it;
- the CHECK appears on both partitions as `chunk_embedding_pair_check`; a row with both NULL
  is accepted, a row with one NULL is refused naming that constraint;
- the generated column propagates too (`attgenerated = 's'` on both partitions) and a
  per-partition `USING gin (search)` index sits beside the HNSW one the function makes;
  a chunk with no embedding is found by `search @@ plainto_tsquery('english', 'receipts')`.

**For the S1 spec.** Migration 0023 is the two ALTERs above plus `create_workspace_partition`
replaced to add the GIN line (the HNSW line stays until S8 decides it, as the route says).

## Probe 2 — an async-generator subscription under `workspaceProcedure`

**Verdict: it neither fails nor holds — it runs, silently, out of scope.** The generator's
body executes *after* `withPrincipal` has committed and released the client, and the `tx` it
closed over is the same `pg.PoolClient`, now idle in the pool. Every statement on it succeeds:
same backend pid as the resolver's, `current_user = app_rt` (RLS applies), but
`current_workspace_id()` is **NULL** (the transaction-local `SET` is gone), so a scoped read
answers nothing and an unscoped one answers whatever the policies allow with no workspace —
while `pool.idleCount` counts that very client as free to hand to the next request.

```
event: connected
data: {}
data: {"at":"first-yield","ok":true,"pid":305,"ws":null,"role":"app_rt","members_in_scope":0,"idle":2,"total":2}
data: {"at":"second-yield","ok":true,"pid":305,"ws":null,"role":"app_rt","members_in_scope":0,"idle":2,"total":2}
event: return
```

The wire works as tRPC 11.18 documents: `GET /trpc/probe.stream` with `accept: text/event-stream`
answers 200 `text/event-stream`; SSE is on by default (`sse.enabled` defaults true), the
generator returning closes the stream with `event: return`.

**The second variant shapes the wrapper.** A subscription whose resolver is a plain async
function does its work *inside* the resolving transaction (`ws` = the workspace) and returns
an async iterable; the iterable's body then runs with no scope (`ws: null`) on the same pid:

```
data: {"at":"resolver","ws":"01M258FW…","role":"app_rt"}
data: {"at":"generator","principal":"01M258FW…","ws":null}
```

**For the S2 spec.** `workspaceProcedure` needs no new branch for subscriptions, and the
split is confirmed as the *only* safe shape: `planAnswer(principal, tx, question)` runs in
the resolver body before the iterable is returned; the returned iterable is `draftAnswer(plan, model)`
and holds no `Tx` — the type must make that impossible, since the released client answers
rather than throws; `recordAnswer` opens its own short transaction through the door
(`withPrincipal` again, or a `withScope` the principal already carries). A rule for
`apps/api/CODING_RULES.md`: **a subscription resolver returns an iterable that closes over no
`Tx`**, lint-enforced if `ctx.tx` can be seen inside an `async function*`.

## Probe 4 — cocoindex at `aee7b27d`

**(a) `managed_by="user"` under `app.drop()`: the table, its indexes *and its rows* all stay.**
The review asked whether the rows are deleted and the index kept; the answer is that nothing
is touched. A control with `managed_by="system"` drops the table entirely.

```
before update (user-managed):            table probe_rows, indexes [pkey, probe_rows_text_idx], rows []
after update:                            rows [doc-0, doc-1, doc-2]
after doc-1 withdrawn + update:          rows [doc-0, doc-2]          ← the LMDB tracking issues the delete
(a) after app.drop() (user-managed):     table kept, both indexes kept, rows [doc-0, doc-2]
control: after app.drop() (system):      table gone
```

**For the S1 spec.** ADR 0036's 2026-09-10 amendment is *necessary*, not prudent: a wipe
of the binding's LMDB (or an `app.drop()`) leaves every `index.chunk` row standing, so the
app's own `DELETE … WHERE binding_id = $1` in its transaction is the only thing that removes
them. The withdrawn-document delete works while the LMDB stands, which is the other half of
the same fact. `drop` on one binding cannot take the shared table (gate §4 probe 2) —
confirmed by construction and now by running it.

**(b) The cp313 manylinux wheel exists, as abi3.** PyPI ships no `cp313` wheel for 1.0.20;
it ships `cocoindex-1.0.20-cp311-abi3-manylinux_2_28_{x86_64,aarch64}.whl`, and `uv` resolves
exactly that for `--python-version 3.13` on both `x86_64-manylinux_2_28` and
`aarch64-manylinux_2_28`. The worker's base image `python:3.13.15-slim-bookworm` carries glibc
2.36 ≥ 2.28, so the wheel installs there with no toolchain. (The clone's `pyproject.toml`
names only `pyo3/extension-module`; the abi3 tag comes from the release build — the wheel
filename is the fact, not the manifest.)

**(c) asyncpg's default pool is 10/10.** `asyncpg.create_pool(min_size=10, max_size=10)` in
0.31.0; a lifespan pool made with no sizes opened ten connections. Worker-host F1's
`min_size=0, max_size=2` per workspace stands.

Also seen: `update_blocking()` called from inside a running event loop deadlocks (it blocks
the thread the Environment's loop runs on); the worker's host must call it from a plain
thread or use `await app.update()`. The `@coco.lifespan` decorator binds to the *default*
environment only; an `Environment` built by hand takes a `context_provider` instead.

## Probe 3 — a 3,000-concept map through seam 1

**Verdict: two of the three claims are smaller than the review feared, one is as feared.**
3,000 concepts landed through `writeConcept` (each ~1.5 KB of prose, six links to the six
before it, the first 300 citing one document of one binding), then three things timed
through the core interface with a Viewer and an Admin principal. Raw numbers in
`results/probe-3.json`; the whole seed took 2,829 s.

**(1) The creation (write-path F3).** The p50 governed write is **flat from 250 to 3,000
concepts — 894 ms at 250, 960 ms at 3,000** — and the regex backfill scan the review called
"dominant at three thousand" costs **31–42 ms at 3,000 rows** (`concept_index` at 3.8 MB):
about 3 % of a write. It is linear in the corpus, so the unresolved-reference row (owner D2)
stays right for S7 and beyond, but it is not S3's dominant cost and need not gate S3's build.
What *is* the cost is the write itself: ~0.9 s per governed write on this machine, not
growing with N — the git commit and the rows. S3's typing, S7's minting and C1's import of
232 concepts price from that figure (C1: about four minutes), and it belongs in S3's spec as
the number to keep or to beat.

**(2) The forty-entry walk (write-path F1; owner D1).**

| walk | p50 | rows returned |
| --- | --- | --- |
| one `walkFrom` (today) | 48 ms | 1,000 (the cap) |
| forty `walkFrom` in one transaction (what `ask` would do today) | **423 ms** | 40,000 |
| one set-seeded walk, `n.uid = ANY($2::text[])`, one shared cap | **15 ms** | 1,000 |

The set walk is 29× cheaper than forty walks and 3× cheaper than one, because forty seeds fill
the 1,000-row cap within a hop or two. That is the shape D1 chose and its consequence
measured: **one shared cap across forty entries is ~25 rows per entry**, so the walk barely
leaves its seeds, and the *cut recorded* line (F2 — the reached set and the depth the cap fell
at, on the answer audit) is what makes the answer honest rather than the cap what makes it
wide. S2's spec should set the cap's figure knowing this, or size it by the entry count.

**(3) The narrowing (write-path F6; S1's measured cascade ceiling).** `narrowBinding` over a
binding whose one document 300 concepts cite: **995 ms, 300 concepts moved, 3.3 ms per
concept**, inside the per-workspace advisory lock. Linear: a binding backing 3,000 citing
concepts holds the lock about ten seconds. That is the number S4's "before bindings are
large" is measured against, and O1's signal line has its threshold. (A second narrowing in
the probe returned `malformed` — an empty `audienceGroups` with `audience: "groups"` — the
probe's input, not a finding.)

**For the specs.** S1: the cascade ceiling is 3.3 ms per citing concept, measured. S2: the
set-seeded walk with one shared cap is cheap and its reach is shallow — record the cut. S3:
the backfill scan is 3 % of a write at the first client's size; the write's own ~0.9 s is
the figure that matters.
