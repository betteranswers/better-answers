---
status: accepted
date: 2026-08-31
---

# The tree is `apps/` over `packages/`; business logic is a library of capability slices over four store doors; and the direction between them is a lint rule, never a convention

ADR 0005 fixes two runtime tiers and ADR 0008 gives the TypeScript tier four caller classes — the SPA over tRPC, third parties over generated OpenAPI, agents over MCP, and a share agent over `/agent/v1` — but nothing said where the code those callers share lives. It lived nowhere: `app/src/` is five files, there is no `app/lib/`, and `createServer` takes a `Pool`. So the tier becomes **`apps/api` (the one deployable) over `packages/core` (a library it depends on)**, `core` is organised as **capability slices over four store doors**, and the import direction between them is enforced by `no-restricted-imports` and `import/no-cycle` in the existing oxlint configuration rather than by a rule anyone has to remember.

This ADR was taken pre-build, on purpose: a tree is nearly free to choose while `app/src/` is five files and expensive to change once `T-003` lands tables.

## Why business logic is a library and not a directory

**Because it has five callers and four of them have no notion of an HTTP status code.** The tRPC router, the MCP surface (ADR 0018), `/agent/v1` (ADR 0008 amendment), a script, and `T-006`'s reconciler — which replays missed commits "through the same handler the live write uses" — all call the same functions. Dust reached this conclusion first and wrote it down as `[BACK18]`: *"a `lib/api/*` function may be called from many places… The status code only makes sense at the transport boundary. Putting it in the business layer either forces non-HTTP callers to invent fake status codes, or leaks one transport's response shape into code that should be transport-agnostic."* Their `front/AGENTS.md` states the resulting shape as flatly: *"It is a library workspace, not a running server… The dependency is one-way."*

**A package is chosen over a directory for its export list, not for its import gate.** The gate argument is false and was corrected in review: a package boundary cannot stop `packages/core` importing `hono`, so it does not by itself enforce the rule above. What a package uniquely gives is a declared public surface — the module's **interface** in `[DESIGN1]`'s sense, written down and compiler-checked. Dust's own `exports` map is four wildcards (`./lib/*` among them), which published their whole tree and bought them no interface discipline at all; this is the mistake to avoid, not to copy. `packages/core` therefore exports **named entry points only**, and the transport ban is a separate mechanism (below).

## The tree

```
apps/
  api/              The one TypeScript deployable. Transports only: the tRPC router, the MCP
                    surface, /agent/v1, the OAuth server, the host router, the worker control
                    plane's HTTP face. Publishes exactly one thing — its router type.
  web/              The Vite SPA. Features per Control Centre screen (ADR 0006).
  worker/           The Python tier. connectors/<provider>/ as vertical slices, pipeline/<stage>/
                    as one-way dataflow, platform/ as its store and route clients.
packages/
  core/             Business logic. The subject of this ADR.
  schema/           Drizzle tables and the boundary schemas over them (ADR 0028).
  contracts/        The language-neutral tier contract (see Consequences).

packages/core/src/
  kernel/           Principal, branded ids, the error vocabulary, Result. Types and pure
                    functions only; imports nothing else in core.
  access/           The read predicate (published · sensitivity · audience) defined once as
                    data, with a SQL renderer and a Cypher renderer, and one shared test corpus
                    asserting both produce identical inclusion sets.
  store/            The four doors, one per shared store (ADR 0005), and the only place a
                    connection is constructed:
    postgres/       The handle, the transaction helper, and the RLS session setter
                    (SET LOCAL app.workspace_id, from the Principal).
    git/            The governed write to the per-workspace bare repository (ADR 0024).
    graph/          The AGE query and delta builder; emits access's Cypher predicate on every
                    element of every path (ADR 0023).
    objects/        Object-store access; per-workspace prefix discipline lives here alone.
  llm/              Route resolution per workspace and purpose, and the llm_call ledger.
  audit/            The one append-only ledger: the typed event vocabulary and one write
                    function.
  sources/          Slice: bindings, the source catalogue, the publish and sensitivity gates,
                    retention classes (ADR 0013).
  concepts/         Slice: the concept write path — suggestions, the inbox, minting and
                    identity, the acceptance transaction, verification and trust events,
                    evidence at commit time (ADRs 0011, 0012, 0019).
  answering/        Slice: find, ask and open — retrieval, traversal, citation, answer records,
                    question sets, feedback, corrections, answer tests, the promotion gate,
                    usage (ADRs 0016, 0017).
  guides/           Slice: guides, compositions, includes, sections, footnotes, the renderer,
                    the review flow (ADRs 0004, 0014, 0015).
  erasure/          Slice: erasure requests, suppression, replay on restore (ADRs 0020, 0022).
                    The one slice permitted to import other slices' interfaces, because an
                    erasure is by nature an act over the whole estate. Nothing imports erasure.
  runs/             Slice: the worker control plane as the app sees it — enqueue, run and
                    heartbeat views, cancel flags. Thin over the SQL protocol functions; owns
                    no semantics of its own.
```

**A slice is the capability that owns a set of tables and the invariants over them** — the write path, not a screen. That definition generated the list above and is the test for adding to it.

**`store/` names the four shared stores because that is what `CONTEXT.md` already means by the word** — *"one of the platform's four shared stores"*, **git store**, *every derived store*. Naming only the Postgres door `store/` would have given one word two meanings and been contradicted by the glossary's own **git store** entry.

## What the tree refuses, and why

**No `records/`.** ADR 0014's record families are nine unrelated things joined by "OKF does not define them" — a data classification, not a capability. As a folder it is a wastebasket by construction and would hold most of the platform: it is Dust's `lib/api/` (1,605 files) rebuilt under better vocabulary. The families distribute instead — bindings to `sources/`, evidence and verification to `concepts/`, usage and answers to `answering/`, compositions to `guides/`, erasure and suppression to `erasure/`, audit to `audit/`.

**No `bundles/`, no `sources/`-as-layer, no `graph/`-as-slice.** The three knowledge layers are how the *data* is classified. Every capability the product ships cuts across all three, so a folder set built from them makes each feature a change in four places. `bundles`' code *is* `concepts/` plus `store/git/`.

**No `principal/`.** A Principal is a value every slice carries, which makes it a kernel type; a folder for it would mix a cross-cutting concern onto the capability axis — the same error, one level down.

**No Control Centre folder.** Control Centre is a composition of slice reads and existing commands in `apps/api`'s routers. An admin-only branch inside a slice function is a design smell and is refused at review.

## Import direction — five rules

1. `kernel` imports nothing else in `core`. Everything may import `kernel`.
2. `access` and `store` import only `kernel`.
3. `llm` and `audit` import `kernel`, `access` and `store` — never a slice, never each other.
4. A slice imports `kernel`, `access`, the store doors, `llm`, `audit`, and **other slices only through their `index.ts`** — never internals, never another slice's `*.store.ts`. The slice graph is acyclic. `erasure` sits at the top; nothing imports it.
5. Nothing in `core` imports a transport or a transport's dependency. Transports import slice `index.ts` files only.

## Enforcement, and the failure mode no linter can see

**Both mechanisms were run against `oxlint 1.80.0` before this ADR was written, not assumed.** A per-glob `no-restricted-imports` override fires inside `core/**` and stays silent outside it; `import/no-cycle` detects a two-file cycle. oxlint 1.80 has no `import/no-restricted-paths`, so the per-glob override is the substitute for bulletproof-react's `zones`.

Adopted in this order: the transport-dependency ban over `packages/core/**` and a dependency allowlist in CI; an override refusing the `store/postgres` handle outside `**/*.store.ts` and `store/` itself; `unicorn/filename-case`; the no-store-imports-a-store rule. When the folder count passes roughly eight, one anti-slop rule reading a checked-in `layers.json` replaces the accumulating per-glob overrides — the existing plugin already runs fifteen rules, so this is the cheap end of the ladder rather than a new mechanism.

**The failure that matters most has no import statement at all.** One slice writing SQL against another slice's tables works perfectly — it is the same database — and no import-direction linter can ever see it. This is the way the frontend feature model breaks on a backend: bulletproof-react's features are near-independent because the state they share sits behind an API, while slices here share one database and its invariants. Applied verbatim, "no cross-feature imports" would force either duplicated queries against another slice's tables or a migration of everything shared into a `shared/` wastebasket. Dust ran that experiment without meaning to: `front` and `connectors` never declared a dependency, so shared helpers were copy-pasted and diverged — `retries.ts` is 39 lines in one and 115 in the other, and `BaseResource` exists twice.

The mitigations, in strength order: **a checked-in table-ownership map** (slice → tables), reviewed like the export list; **per-slice Drizzle table files**, which turn touching another slice's table into an import and therefore into something lintable, provided they can coexist with `packages/schema` remaining the generation source (ADR 0028); and RLS with grants as the backstop for the tenancy dimension.

**A transaction that spans slices lives in the slice that owns the act** — the acceptance transaction writes concepts, audit and the graph delta in one transaction and belongs to `concepts/` — composing store doors and other slices' interfaces, never a free-floating orchestrator layer.

## Tenancy: RLS is the guarantee, the Principal is what reaches the other three stores

`[DESIGN4]` requires a workspace-aware data layer that throws in every environment, and cited Dust's `WorkspaceAwareModel` as the contract it follows. **That pattern cannot be ported.** It works by intercepting Sequelize's `beforeFind`, and drizzle-orm exposes no query lifecycle hook; Drizzle's own documented answer to this problem is Postgres row-level security, and `pgTable.withRLS()` is **default-deny** — a table with no policy returns no rows to anyone. That is a stronger guarantee than the thing `[DESIGN4]` asked for, and stronger than Dust's, which only warn-logs at one percent sampling in production.

So the hierarchy inverts: **RLS with `FORCE ROW LEVEL SECURITY`, the non-owner `app_rt` role and `SET LOCAL app.workspace_id` is the guarantee**, proved by a zero-rows test per tenant table; the store layer is ergonomics over it. **Principal-first-argument survives and is load-bearing** — it is what carries isolation to git, the object store and the graph, none of which RLS reaches.

The size ceiling `[DESIGN1]` implies is a proxy that splitting a file games. The rule with teeth is **a store file may not import another store file**, at error; a line ceiling rides along as a warning with the split recipe written before the first breach.

## Considered options

- **A directory plus a lint rule (`app/src/lib/`).** Holds the import direction as well as a package does, and gives no export list — so a transport may reach any file in `lib/`, and the module has an interface only by convention. Rejected for the same reason Dust's wildcard `exports` map is a mistake: the interface is the thing being bought.
- **Folders named for the three knowledge layers plus records** — `sources/ bundles/ graph/ records/`. Proposed from `CONTEXT.md` and rejected independently by two reviewers: it is the data taxonomy, every capability cuts across all of it, and `records/` becomes the wastebasket described above. `[GLOSSARY1]` governs domain terms; applying it to module structure is what produced this option.
- **Two TypeScript deployables, splitting `/agent/v1` from the human and agent surfaces.** `[DESIGN3]` refuses it: nothing varies across that seam yet, the hostname refusal is already a router rule, and ADR 0005 fixes two runtime tiers. The library boundary is what makes the later split a compose-file change, which is what ADR 0005 promised. The residual risk — an unauthenticated hostname sharing a process with the OAuth server, guarded by an in-process host router — is answered by edge enforcement and a functional test, not by a second deployable.
- **Vertical slices with bulletproof-react's zero-cross-slice rule applied verbatim.** Rejected on the shared-database argument above; the weakened form is rule 4.
- **`resources/` for the persistence modules**, following Dust. Rejected twice over: *resource* is MCP's word for a first-class protocol object the platform will serve (ADR 0018's direction), and Dust's resource layer is where their size discipline failed (`space_resource.ts`, 2,417 lines).
- **Flat top-level directories** (`api/`, `web/`, `worker/`, `packages/*`), which is Dust's shape. Rejected: Dust has no `packages/` directory, and shared code accordingly ended up spread across four simultaneous sharing mechanisms. `apps/` and `packages/` makes "what deploys" against "what is imported" structural rather than remembered.

## Consequences

- `app/` becomes `apps/api`, `web/` becomes `apps/web`, `worker/` becomes `apps/worker`; `packages/core` is new. `pnpm-workspace.yaml`, both lint configs, `deploy/`, the CI workflows, `vitest.config.ts`, the Stryker configs and every document naming a path move in the same commit — a directory move is complete only when every path naming it moves too (`T-016`).
- **`[DESIGN4]` is demoted from a rule to this ADR.** Seven hundred words of design specification wearing a rule identifier will drift from the code the day the code exists, and half of it is superseded here. `CODING_RULES.md` keeps the short, checkable statement — workspace id on every row, every query through a store door, RLS default-deny, a Principal first — and points at this ADR for the shape.
- **`[TEST1]` gains a second test surface.** It currently recognises the endpoint for `app/` and the job entry point for `worker/`; `packages/core`'s exported entry points are now a third, or the rule forbids testing the module this ADR makes central.
- **`packages/contracts` is renamed.** ADR 0005 reserves *contract* for the app↔worker seam, which a pnpm package cannot serve because the worker is Python. The `Result` convention folds into `kernel`, and the tier contract — the encryption envelope's golden vector, the queue protocol's fixtures — becomes a language-neutral fixture directory both suites read. Its own task. **Enacted by ADR 0031 (2026-09-01): the package is deleted rather than renamed — `Result` to `kernel` as above — and the fixture directory is top-level `contracts/`.**
- **The app↔worker contract is wider than `packages/schema` and remains the live risk.** The queue protocol, the concept-inbox handshake, the credential envelope, the read predicate, LLM routing and the cost ledger are all cross-tier, and generated table types cover one of them. Protocol semantics belong in SQL functions both tiers call, with one conformance suite both CIs run. Not settled by this ADR; named by it. **Settled by ADR 0031 (2026-09-01) — which also corrects this list: the read predicate's logic is app-only; what is cross-tier is the visibility columns the worker writes.**
- `CONTEXT.md` gains nothing. `slice`, `kernel` and `access` are architecture words, not domain terms, and `[GLOSSARY1]` keeps them out; the slice names were taken from the glossary deliberately, and `erasure` rather than `privacy` is why.
- **The first vertical slice is an ADR-invalidation instrument.** Decisions taken before any code exists are calibrated against no evidence; `T-003` onwards is where this tree, ADR 0028's registry and `[TEST1]`'s absolutism first meet a real table, and each is expected to move.
