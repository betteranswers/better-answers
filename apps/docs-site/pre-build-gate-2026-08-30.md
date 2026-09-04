# 79 — The pre-build gate

*Session 35, 29/08/2026. The last decision ticket on the map. After this: ticket 77 flips the repository public, and the build starts.*

---

## §1 — Verdict

**Build — after four things are decided and written down. Nothing found here reopens an ADR's decision; two findings change a shape, and finding them now is the difference between a migration and a rewrite.**

Five independent reviewers took a lens each over ADRs 0001–0027, the constitution, the glossary and the whole deploy tree, and tried to break them. They confirmed a great deal — the concept inbox that pass 1 said was missing is now genuinely closed; the write path cannot be poisoned into minting a concept; the answer path leaks nothing by arithmetic; the backup design is, in one reviewer's words, better than most funded teams ship. Three of the five could not find a blocking fault at all.

They found **one blocking item and three load-bearing ones**, and they are the same kind of thing pass 1 found: not a wrong decision, but a place where two later ADRs each assumed the other had said something, and neither had.

1. **The graph cannot create the labels it is specified to use.** ADR 0023 fixes graph uniqueness as indexes "in the app's migrations", written when the label set was closed and known. ADR 0026 then made concept labels **the kind** — and kinds are minted by a producer at 15:04 on a Tuesday, so no migration can name them. Nothing says who creates the label or its index, and the writer runs under a role with `USAGE` only. It also collides the two partitions' unique indexes and makes a side-by-side full rebuild impossible. **→ Q1.**
2. **The read predicate is undefined on two of the three things it is applied to.** It is specified as three *binding* fields. A concept has no binding — it is minted from evidence spanning several, or typed by a person from none. A composition has no binding and no sensitivity anywhere in the tree. So a Restricted concept's claim, title, source and locator can reach a reader through a guide page's footnote, which never consulted the concept's class. **→ Q2.**
3. **The graph has one isolation control where every other store has two, and the deploy unit disarms it.** ADR 0023 deleted `workspace_id` from nodes on the strength of a schema boundary — but the compose file gives the worker one database role for every workspace, gives the app the *owner* DSN, and AGE cannot parameterise a graph name, so the boundary is correct string construction in one function. **→ Q3.**
4. **The bundle-and-record derive still lives in the worker after the store boundary it was built to bridge disappeared.** ADR 0023 put the graph in the same Postgres the app already commits to; generations, the watermark, the debounce, three System signals and a "map is updating" phrase all survive from a design that needed them. Deciding after the build means building that machine and then deleting it. **→ Q4.**

Below those: a statutory question about an employee's name inside a concept body (**Q5**), the estate questions the 4 GB boxes force (**Q6–Q9**), what the public flip should and should not publish (**Q10**), and two small forks (**Q11–Q12**).

**Everything else is applied at the gate** — 28 items in §2 that need writing down, not deciding — and the eight owed probes dispose themselves (§4). The repository is clean and ready for the flip (§6), and Better Auth is a stay with three written triggers (§5).

**What this means in plain terms.** The architecture is sound. Twenty-seven decisions held up under five hostile readings and none of them was overturned. What the review found is the ordinary cost of a design written across thirty-four sessions: a handful of places where the seam between two late decisions was never explicitly closed. Closing them costs a paragraph each now. Finding them in month three costs a migration on live client data.

---

## How this gate is put to you

Five sources landed on this ticket. Four arrived before the session:  research **78** (a consistency review of every core document — 148 findings, 19 of them raised as decisions), research **80** (what the MCP 2026-07-28 revision changes — eight forks), prototype **61** (the real connector run against claude.ai — five items), and research **55**'s eight owed probes. Plus two judgements the gate owes: Better Auth's stewardship under Vercel, and whether the repository is fit to go public. The fifth arrived during it — **a council of five independent reviewers** re-running pass 1's lenses over ADRs 0001–0027, the constitution and the whole deploy tree, which added 41 findings of its own (§8).

That is roughly eighty items in total. **Most of them are not decisions.** They are engineering choices with one obviously right answer, where the gate's job is to write the answer down so a builder cannot get it wrong. Research 78 says so itself: everything not in its §5 list "can be applied at the gate under `[ADR]` without a further decision".

So this briefing is in two halves:

- **§2 — Applied at the gate.** Twenty-eight items I have decided and will write into the ADRs, the constitution and the deploy tree. Each says what I did and why in one or two lines. **Read them; override any you disagree with.** You do not have to answer them.
- **§3 — Yours.** Fourteen items where the answer is a product, cost, legal or risk judgement rather than an engineering one. These are the surface's questions, and the first option on each is my recommendation.

Then §4 disposes of the owed probes, §5 and §6 are the two judgements, §7 is the build task list this gate produces, and §8 is what five independent reviewers found when they tried to break the whole design at once.

---

## §2 — Applied at the gate, no answer needed

### From research 78 (the document consistency review)

**A1 · Staging is on demand and never stands.** ADR 0024 is the latest word and it is unambiguous; five other files still assume a standing staging. Applying 0024 everywhere. The concrete consequence: **`build.yml`'s `staging` job is removed.** It redeploys staging on every push to `main`, to a stack that by design is not running — it would fail on every build. Bringing staging up becomes a step in the drill and rehearsal procedure, using the digests `build.yml` has already published. Sweeps: ADR 0022:18, `[OPS1]`, `restore-drill.sh`, `coolify.md:23`, `RUNBOOK.md:38`, `wizard-41.sh:291`.

**A2 · `[DESIGN4]`'s graph clause is rewritten for Apache AGE.** Research 78 calls this the most dangerous stale line in the tree, and it is right — the constitution is what a builder is told to obey, and its graph clause is written entirely for Neo4j: `workspace_id` on every node, the predicate inline in a quantified path pattern, Community's missing constraints, no APOC. ADR 0023 replaced all of it — a graph *is* a schema, so tenancy is a schema boundary and `workspace_id` is gone from nodes; the predicate rides in `WHERE` on every element; uniqueness is a Postgres unique index on each label table. Rewriting the clause to match, verbatim from ADR 0023.

**A3 · The `neo4j-graphrag` matcher lift is cut.** ADR 0023:35 still keeps its three matchers "as a proposal generator". They were a proposal generator for *typed relations* — and ADR 0026 abolished typed relations ("a relation is the link… no predicate matcher"). The lift has no consumer left. Cutting it removes a Python dependency, resolves `[DESIGN4]`'s ban with no exception, and takes the last Neo4j-shaped thing out of the worker.

**A4 · Five named graph edges, not three.** ADR 0026 says the only named edges are `SUPERSEDES`, `CITES`, `IS_CONCEPT`; ADR 0019 writes `DERIVED_FROM` (trust lineage) and ADR 0021/0023 writes `SAME_AS` (entity merge). These are not a contradiction once stated properly: 0026's rule is about **relations between concepts**, which come from links and are never named. `DERIVED_FROM` and `SAME_AS` are **platform-derived edges** the graph writes about its own bookkeeping. ADR 0026 gains one clause saying so. *(Flagging this one because it touches your simplicity ruling — if you would rather have three, `DERIVED_FROM` and `SAME_AS` become properties instead of edges, at the cost of a slower supersession walk.)*

**A5 · `okf://` stays, and never enters a concept file.** ADR 0002 rejected `okf://` as the way one concept file references another — correctly, because it needs a resolver everywhere and link checkers cannot see it. ADR 0018 uses `okf://` as an **MCP resource URI on the wire**, which is what MCP resource URIs are for. Different places, no conflict. Writing the distinction into both ADRs: on the wire yes, in a file never. *(This gets load-bearing if ticket 84 adopts MCP resources.)*

**A6 · `[SEC2]` is reworded; OpenAPI stays unmounted.** ADR 0008's amendment is explicit that the generated OpenAPI document is not mounted in v0.1. `[SEC2]` and ADR 0017:29 both require a functional test per capability "through tRPC, OpenAPI and MCP alike". The rule becomes "through every mounted transport" — tRPC and MCP today, OpenAPI the day it mounts, `/agent/v1` now that it exists.

**A7 · `knowledge/` is the real bundle root.** It comes from ticket 13's estate names (`knowledge/`, `platform/`, `imports/<vendor>/`, `manifest.yaml` everywhere) and ADR 0012 already exports "an archive of `knowledge/` at a commit". Confirming it in ADR 0002 along with where `manifest.yaml` sits.

**A8 · ADR 0021's carried paragraphs are restated inside ADR 0023.** "Carries over by reference" from a superseded document is exactly the trap that makes a builder read a superseded ADR and build Neo4j. Restating them.

**A9 · The worker's swap allowance becomes explicit.** `platform.compose.yaml` caps the worker at 1.5 GB and its comment promises a run that outgrows the cap "spills to the host's swap file rather than failing" — but nothing sets `memswap_limit`, so that behaviour is implicit. Setting `memswap_limit: 3072m` (1.5 GB memory + 1.5 GB swap). Ticket 42 measures the swap-in rate and revises the cap.

**A10 · Garage takes its secrets from environment variables.** The `*_file` keys point at `/run/secrets/*` that nothing writes. Garage's configuration reference confirms `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN` override the file values (checked on the vendor's page today, `[DEPS1]`). Deleting the two `*_file` keys; the values come from Coolify's environment like every other secret. No entrypoint script.

**A11 · The backup image becomes the fourth digest-deployed image.** `stores.compose.yaml` builds it on the host, which breaks ADR 0022's rule that a compose file refuses to start without a digest. `build.yml` builds and pushes it beside app, worker and postgres. One rule, no exceptions.

**A12 · The drill reads production over SSH, not over an open port.** `restore-drill.sh` wants `PROD_DATABASE_URL_RO` on VPC 2, which needs a Postgres port open from VPC 2 to VPC 1 — against `coolify.md`'s SSH-only firewall. The drill fetches its production counts over the SSH connection Coolify already holds. No new port.

**A13 · The drill's `backup_run` row is written to production.** It is currently written to staging and then wiped minutes later, which destroys the very signal it exists to raise. One narrow, single-purpose write to production — it is how you find out a drill happened, and ADR 0025's "last drill" signal has no other source.

**A14 · The app writes the release `audit_event`, on boot.** `release.yml` has no principal and ADR 0014's ledger wants an actor; the app knows its own digest at start-up. The workflow records the deploy, the app records the act.

**A15 · The repository export lives on System.** ADR 0017 already lists it there; Knowledge's toolbar exports are knowledge exports (concepts, compositions, records). Whole-repository export is a system act.

**A16 · `deploy unit` keeps the glossary's meaning.** What one release changes: the platform stack — migrate, app, worker — by digest. The stores and the database are not in it. The ADRs that use the phrase loosely get the glossary's words.

### From research 80 and prototype 61 (MCP)

**A17 · Dual-era serving, `legacy: "stateless"` (fork F1).** Not a preference — prototype 61 measured claude.ai's unauthenticated pre-flight, the probe that draws the 401 and starts the whole OAuth flow, speaking 2025-11-25 **only**. `legacy: "reject"` refuses that pre-flight and the connector can never be added at all. The move to 2026-only is conditioned on a measurement — `server/discover` observed from every host on the conformance list — never on a date.

**A18 · The token is `{workspace, user}`; role is read per call (61 item 2).** Measured, not assumed: the claim set is `aud, azp, client_id, exp, iat, iss, jti, scope, sid, sub, user, workspace`. ADR 0018 is amended. *(What the per-call read must survive is a security question — see §8.)*

**A19 · `annotations` on every MCP entry become a build requirement (61 item 3).** claude.ai split our four entries into "Write/delete tools 1" and "Other tools 3" from `readOnlyHint` alone, each with its own approval policy. ADR 0018's read/write split is legible in the host's UI for free — but only if every entry carries its annotation. A lint rule beside `[SEC2]` and a functional test that asserts every registered entry has one.

**A20 · The *Connected clients* card lists client-metadata URLs, not registrations (fork F3).** Under CIMD there is no registration and no client row, so ADR 0018's "registered clients by name" has no referent. The card lists distinct `client_id` URLs seen on issued grants with the `client_name` from each CIMD document — which usefully distinguishes Claude on the web from Claude Code. `CONTEXT.md`'s *client (connected)* loses the word *registered*.

**A21 · A retried `ask` settles its spend reservation on stream close (fork F4).** A stranded reservation counts against the workspace ceiling and starts refusing real questions — a support call. Settle on close, sweep stale reservations, and let a retry write a second audit row marked as a retry. No idempotency key: the same question asked twice in a minute is a thing people do.

**A22 · `tools/list` gets a real cache TTL, `cacheScope: "private"` (fork F5).** Private is forced, not chosen — our list varies by the token's scopes. The TTL is a config row under ADR 0025, not a constant. Taken together with deterministic ordering, this is a prompt-cache hit on every conversation.

**A23 · `@better-auth/oauth-provider` + `@better-auth/cimd` with a hand-written PRM (fork F6).** Not `@better-auth/mcp`, whose guidance is `legacy: "reject"` — which A17 rules out — and whose PRM document is a fixed shape, where Anthropic requires `resource` to match the server URL exactly as the user typed it. Eight lines we control beat a shape we configure. It is also the configuration prototype 61 actually drove claude.ai against.

**A24 · The `@better-auth/cimd/node` fix is carried as a `lifts/` snapshot (fork F7).** The plugin hands Node's `lookup` a single-address callback while Node 20+ `autoSelectFamily` passes `{ all: true }` and expects an array, so `ERR_INVALID_IP_ADDRESS` is thrown **before a packet leaves the machine** and every CIMD authorization fails `invalid_client`. ADR 0006 puts us on Node 24, so nothing about CIMD works without the fix. Prototype 61 already wrote and exercised it. It carries a `THIRD_PARTY_NOTICES.md` and a removal condition: the upstream release that fixes it. **Ticket 83 files the report** — the build does not wait for it.

**A25 · The rate limit stays a Postgres counter per `(token, window)` (fork F8).** Moving it to a Cloudflare rule keyed on `Mcp-Method` is undeployable today — claude.ai is 2025-era and sends neither header — and undeployable in principle for a per-token limit, because a header cannot carry the principal and the only per-principal value on the wire is a bearer we must not log. The new `Mcp-Method` / `Mcp-Name` headers go into the request log as signals, marked as covering 2026-era traffic only until the first client moves.

**A26 · `describe_estate` is gone; four entries, host-agnostic (your two riders from 61).** Already recorded; restating it here because the build tasks are written from it.

### Housekeeping

**A27 · The amendment trail is swept.** Research 78's core finding is that six later ADRs amend earlier ones by notes the earlier files do not carry — ADR 0019's role rename missing from 0015/0016/0017, ADR 0026's vocabulary removal missing from 0004/0005/0011/0012, ADR 0027's `THIRD_PARTY_NOTICES.md` rename missing from 0013/0021 and `AGENTS.md`, ADR 0024's Forgejo removal missing from three phrases of 0020, ADR 0023 reaching no deploy document beyond a parenthesis, and `renovate.json` still freezing Neo4j and Forgejo. **A builder reading any one of those files in isolation builds the old design.** Every note is written into every file it belongs in.

**A28 · The deploy tree is made runnable.** Three `<read on the day>` placeholders sit in fields that must parse; the Postgres image ADR 0023 requires is built by no workflow; `seed-synthetic.sh`, `init-repo` and the `stagingstore:` rclone remote do not exist; the drill's wipe ignores the per-workspace AGE schemas. These are the first build task's, and the ordering ADR 0022 implies is now stated: **the first drill precedes the first client's data.**

---

---

## §3 — Yours: fourteen decisions

*First option is the recommendation in every case. Groups A and B are the ones that cost money if they are wrong.*

### Group A — Blocking and load-bearing

**Q1 · How a concept is labelled in the graph.** *(blocking; data-flow F1)*
ADR 0026 made a concept's graph label its **kind** — and kinds are unbounded and minted at acceptance, so no migration can create the label or its unique index, and the worker's role cannot either. It also gives one label two contradictory unique indexes where a kind and a source-entity type share a word, and a `(uid)` index makes the side-by-side full rebuild ADR 0021 designed impossible.
- **(a) Recommended — one `Concept` label, `kind` as a property.** The label set goes back to app-owned migrations (which is what ADR 0007 says everywhere else), the two indexes stop colliding, the rebuild works, no DDL enters the write path and the worker needs no `CREATE`. ADR 0026 already makes `from_kind`/`to_kind` edge *properties*, so this is the consistent choice. Cost: a `kind` term on a traversal instead of a label match — negligible with an index.
- **(b) Keep labels-by-kind.** Then the acceptance transaction must create the label and its index — DDL in the write path, and `CREATE` in the worker's grants.

**Q2 · How a concept's and a composition's visibility class is set.** *(load-bearing; security F1)*
The predicate — published · sensitivity · audience · role — is written as three *binding* fields, but concepts and compositions have no binding. Today a Restricted concept's claim and locator can reach a reader through a guide footnote that never checked it.
- **(a) Recommended — inherit, with an override.** A concept's class is the **most restrictive class among the bindings of the evidence it cites**, recomputed at commit and whenever a binding widens or narrows; a composition's is the most restrictive among its includes. An Admin can override, recorded as an act. A concept with no evidence takes the workspace default. Safe by default, which is the direction ADR 0020 and D1 already chose, and the only option that stays correct when a binding is narrowed later.
- **(b) Explicit at the accept gate.** Predictable and easy to explain, but it fails open: acceptance is a bulk action, and a class nobody set is a class nobody restricted.
Either way the three terms become real columns on `concept_index`, on `composition` and on every chunk row, and properties on every graph node and edge — with one functional test per unit kind proving a Restricted-sourced concept is invisible to a Viewer through `find`, `ask`, the graph walk, the footnote and `open`.

**Q3 · Graph isolation and the database roles.** *(load-bearing; security F2 + research 78 decision 3)*
ADR 0023 removed `workspace_id` from graph nodes because a graph is a schema and the worker has `USAGE` only. But the compose file has **one** worker role for every workspace, the app runs as the **owner** (not subject to row-level security), and AGE cannot parameterise a graph name — so the boundary is a string built in one function.
- **(a) Recommended — belt and braces.** Restore `workspace_id` as a property on every node and edge and make it a term of the builder's `WHERE` on every hop, so a wrong graph name returns **zero rows** instead of another tenant's. Run the app as a non-owner `app_rt` under `FORCE ROW LEVEL SECURITY`, keeping the owner DSN for `migrate` and the two runtime-DDL paths only. Keep **one** worker login role that holds **no table privileges at all** and `SET LOCAL ROLE`s into the workspace's role — so a forgotten `SET ROLE` fails with "permission denied" rather than reaching everything. Derive the graph name through one allowlisted function that regex-checks it, the only place string-building is permitted, with a lint rule banning graph calls outside the builder.
- **(b) Schema boundary only, as ADR 0023 stands.** Cheaper by one property and one term per hop; leaves the graph as the only store in the estate with a single isolation control.

**Q4 · Where the bundle-and-record graph derive runs.** *(load-bearing; data-flow F8)*
Generations, the live-generation flip, the five-second debounce, the record watermark and the "map as of … · updating" phrase were all designed to bridge a *second store* the app could not write transactionally. ADR 0023 removed that store — the graph is now schemas in the database the app already commits its index rows to.
- **(a) Recommended — the delta joins the app's commit transaction.** Generations then exist only for full rebuilds; the watermark, the debounce, three System signals and the degradation phrase all disappear; the map is never behind for an edit, which is what ADR 0012 argued for in the first place. The Python parser's cross-check becomes a rebuild-time and nightly audit, which is what it should always have been. Source entities stay in the worker, correctly — they come from cocoindex.
- **(b) The worker keeps it.** Nothing to change now; but it means building the generation machine, three signals and a degradation phrase and quite possibly deleting them within the year.

### Group B — The statutory one

**Q5 · An employee's name inside a concept body, when erasure is requested.** *(data-flow F6)*
ADR 0020's title promises personal data is "erased from every copy by routine". The routine reaches actor ids (`human:<email>`) across history. It does **not** reach a person's name written *inside* a concept body — which is exactly what a sector capability statement contains, and which the redaction seam deliberately let through because person names are default-off for a binding that is not HR-shaped. The owner's edit is a new commit; the name stays in every earlier commit, in the nightly bundle, in the VPC 2 mirror, and in every export already issued.
- **(a) Recommended — narrow the promise, ship the forward edit, and ask the lawyer.** The defect today is that the ADR over-promises. Narrow its title and the erasure report's wording to say precisely what is erased and what is not; keep the owner's forward edit as the routine; add *authored concept bodies* to the DPIA input as a category; and put this to the lawyer as a **fourth question** beside the three already owed. A capability statement naming an employee is knowledge the company asserts about itself and usually has its own lawful basis — but that is a lawyer's sentence, not mine.
- **(b) Rewrite history too.** The routine also runs a targeted text replacement over confirmed body occurrences, under the same repository lock. Deterministic and complete — and it rewrites knowledge the company itself asserts, so every export already issued diverges from the repository.
Whichever is chosen, the ADR's wording must change: it currently promises something the routine does not do.

### Group C — The estate

**Q6 · "Embeddings run locally from day one."** *(scale F1 + research 78 decision 2)*
`docs/vision.md` states it as a principle. ADR 0024 says client one embeds on the hosted route because a 4 GB box has no room for a model server, and ADR 0020 names Mistral EU as the processor. The estate changed after the principle was written.
- **(a) Recommended — keep the requirement, drop the date.** "Local models are a requirement" means what you said at ticket 38: a local model must be usable in **any** purpose, per workspace, which the route record keyed by purpose already delivers. Local *embedding* becomes a named precondition — a model-host box — triggered by the first workspace that asks for it, not by a date. Reword the vision line to match.
- **(b) Budget a model-host box now** so the principle is true on day one. Roughly £20–40/month before any client pays.

**Q7 · The release rhythm.** *(operability F4)*
With staging on demand, production is the first place every image actually runs — including Renovate's dependency bumps. `release.yml`'s input currently reads "the digests staging is running", which really means "the last build, never executed".
- **(a) Recommended — prod-first now, drill-day discipline once client data lands.** During the build there is no client data and a bad release costs minutes, so: delete the staging fiction, make the input "the last build's digests", and make a post-deploy smoke against production the release's final step. Write the switch down as a **condition, not a date** — the day the first client's data is on the box, releases move to (b).
- **(b) Drill-day releases from the start.** One deploy train a month, when staging is already up for the drill and has just proven a restore, plus hotfixes. Safer, and much slower during a build.

**Q8 · Where the backup decryption key lives.** *(operability F5)*
The drill runs unattended at 03:00 monthly and needs the key. `SECRETS.md` says the private half is in escrow and on VPC 2 "for the duration of a drill" only. Both cannot be true.
- **(a) Recommended — the key is resident on VPC 2 in a root-only file, and we say so.** State plainly in `SECRETS.md` and the breach page that a VPC 2 compromise exposes dump plaintext, and rotate on that event. The escrowed copy remains the recovery of last resort. An honestly-stated risk beats a promise the schedule breaks.
- **(b) Semi-attended drills** — you place the key, run it, remove it. Truthful to the current wording, and realistically the drill stops happening.

**Q9 · The one Cloudflare Free rate-limit rule.** *(security F5)*
`mcp.` has no Access wall and serves the unauthenticated login (`/oauth/*`, the email-code endpoints, discovery). The single Free-plan rule is spent on `agent.`. So the estate's front door is unmetered at the edge, and "limited per token in the app" cannot limit an endpoint reached without a token.
- **(a) Recommended — buy Cloudflare Pro (~£20/month) and rule both.** `mcp.` takes credential traffic; `agent.` takes 100 MB uploads from a client's network. Both need a rule, and £20 against one credential-stuffing run is not a real trade.
- **(b) Move the single rule to `mcp.`** and leave `agent.` on the app's own cap. If cash says no, this is the right order — the app can refuse an oversized body cheaply and cannot cheaply absorb a login flood.
- **(c) Leave it on `agent.`** as it stands.
*(Not a decision, applied either way: an SSRF policy on the CIMD fetcher — it fetches a URL the caller supplies — written into ADR 0009 and into the carried lift, checking the resolved address, refusing private ranges, capping redirects and body size.)*

### Group D — The flip, and two small forks

**Q10 · What the public repository publishes about the estate.** *(security F9)*
ADR 0027 makes the whole tree public including the deploy documents. Ticket 77's audit checks each file for client names, credentials and personal data — not for operational disclosure. As it stands the flip publishes which hostnames sit outside Access and why, where the single rate-limit rule is, that a VPC 1 snapshot is a secret, the firewall rules, the bucket layout, and the escrow model with its bus factor of one. The flip is one-way through git history.
- **(a) Recommended — split the estate out, publish the product.** `SECRETS.md`, `coolify.md` and the estate-specific half of `RUNBOOK.md` move to the gitignored planning tree, leaving public stubs that name the *classes* and the rotation contract. The compose files, Dockerfiles, wizard and workflows — the parts that make the open-core claim real — stay. Add an acceptance line to ticket 77: no public file names a hostname's Access posture, a rate-limit placement, a firewall rule, a bucket name or an escrow holder.
- **(b) Publish as-is**, per ADR 0027's "whole tree open".

**Q11 · JS-rendered pages in the website connector.** *(research 78 decision 8)*
ADR 0013 left Playwright as "ticket 41's — a separate image, or dropped from v0.1". A Chromium image does not fit a 4 GB box.
- **(a) Recommended — dropped from v0.1.** The website connector fetches server-rendered HTML; a page that needs JavaScript is recorded as a fetch failure with a reason the Admin can see, never a silently empty page. Re-entry when the estate grows, or as an out-of-process fetcher like the share agent. **One check decides whether this bites**: does the first client's site serve meaningful HTML without JavaScript? That is one command on the day.
- **(b) A separate Playwright image**, and find the memory somewhere.

**Q12 · Where the docs site lives.** *(research 78 decision 14)*
`AGENTS.md` and ADR 0006 both say it is carried in-repo at `docs-site/`. **That directory does not exist**, and `coolify.md` points `docs.better-answers.com` at your existing Vercel project `knowledge-hub-docs-site`.
- **(a) Recommended — carry it in at `docs-site/` and repoint the Vercel project.** The tree is going public anyway so there is no disclosure cost; docs then change in the same pull request as the thing they document; Vercel builds happily from a monorepo subdirectory. Cost: repointing one project.
- **(b) Leave it as its own repository** and delete the `docs-site/` row from `AGENTS.md` and ADR 0006.

### Group E — Sign-off

**Q13 · Better Auth.** *(§5)*
- **(a) Recommended — stay, with the exit written as a test.** Record the three leave-triggers (a licence or distribution change; the self-hosted OAuth path deprecated or folded into Connect, or twelve months without a release while core ships; a security defect we report unfixed for one release cycle). Restate ADR 0009's Keycloak fallback with the honest cost — **two to three weeks, not two days**, because fork F2 makes us CIMD-only and Keycloak does DCR, and because Better Auth also owns the app's login and the organisation model the `workspace` claim comes from. Add the seam rule to the constitution: no Better Auth type crosses into `app/lib`. Treat ticket 83's response time as the first measurement.
- **(b) Something else — say so in the notes.**

**Q14 · The gate itself.** *(§7)*
- **(a) Recommended — "build starts with no product decision left."** The six foundation tasks in §7 (B1 repo skeleton · B2 database · B3 identity and MCP · B4 deploy unit and the first drill · B5 the write path and its reconciler · B6 the AGE spike under load) are written into ordna on this answer, with B7–B10 named and sized once the foundation stands.
- **(b) Not yet — something in §2, §4 or §7 needs to change first. Say what in the notes.**

---

## §4 — The owed probes, disposed

Research 55 left eight questions it could not answer, and pass 1 left one. **None of them blocks the build**, because in every case the design already took the conservative branch. Disposition:

| Probe | Disposition |
| --- | --- |
| 1 · Does the LMDB hold personal data, and can one entry be removed? | **Already designed for the worst answer.** Briefing 53 puts the per-binding LMDB in ADR 0005 as worker state holding personal data — never backed up, wiped and reprocessed on erasure, in the DPIA input. Measuring could only *relax* that. Becomes a build-task measurement, not a gate item. |
| 2 · What does `drop` on one environment do to a shared table or a vector index? | **Fixed by design, needs a test.** ADR 0007's second amendment gave the app all DDL in `index` and made every cocoindex target `managed_by="user"` — precisely so deleting one binding cannot drop the search index under the others. Becomes a functional test in the first build task. |
| 3 · Does a `detect_change` key invalidate every memo? | **Designed around.** Briefing 53 already rules: suppressions per document, never a global `detect_change` key. Build-task measurement. |
| 4 · How big is the first client's estate? | **Still owed, and it is not a build blocker** — the extraction plan is priced at review, so the design tolerates not knowing in advance. It becomes the first onboarding step: a Slim enumeration of the real site before any plan is priced. **This is the one number that decides whether §8's scale findings bite.** |
| 5 · Share-agent throughput and limits | **Deferred with the share agent**, which research 55 sequenced to the first on-prem client. Half of it is already answered: Cloudflare's edge body limit is 100 MB and ticket 41 set `agent.`'s per-file cap to match. |
| 6 · Neo4j online backup | **Void.** ADR 0023 put the graph inside Postgres; it rides every `pg_dump`. |
| 7 · Where does a machine client authenticate on the tunnel? | **Closed by ticket 41.** `agent.` is the machine client's hostname — no Access, the agent token checked in the app before any body is read, the one Free-plan rate-limit rule on it. |
| 8 · Does the memo cache grow without bound? | **Capped, not probed.** `LMDB_MAX_BYTES_PER_BINDING` is already 4 GB in the compose file; over it the binding's LMDB is wiped and reprocessed. Add the LMDB size per binding as an ADR 0025 signal and the question answers itself in production. |
| 9 · Coolify honours `depends_on` conditions | **Answered on paper** (research 68: Compose's plain `up -d` honours them) and already listed in `apps/docs-site/operations/coolify.md` as a probe to record at the first deploy. |

**Recommendation: close all nine.** Four are void or already answered, four are conservative-by-design and become build-task tests, and one — the first client's estate size — is an onboarding step you take before pricing a plan, not a thing that blocks writing code.

---

## §5 — Better Auth stewardship under Vercel

*ADR 0009 flagged this as a pass-2 watch item when Better Auth joined Vercel on 07/07/2026. Session 34 gave it something concrete to look at. Here is the judgement the gate owes.*

### The upside is real, and it is not the reason to stay

Better Auth now ships an **Agent Auth plugin** implementing the Agent Auth Protocol: agents holding their own identity rather than wearing the deploying person's badge, delegated and autonomous modes, capability constraints, device-authorization and CIBA approval flows, audit hooks on grant and execution. That is ADR 0009's flagged direction made concrete, and it happens to cover *both* halves the map's fog lists as new requirements — the acting credential class and the in-app approval surface — as a plugin on the identity provider we already run in-process rather than a new component.

But this is a reason to be pleased, not a reason to stay, because none of it pays until after v0.1. **The reason to stay is simpler: it works, it is proven on our own wire, and it costs one container fewer than every alternative.** Prototype 61 drove the real claude.ai connector through Better Auth 1.7.2 — CIMD chosen over DCR, the workspace claim carried, the two-organisation picker round-tripping in under a second, all four entries answered. ADR 0009's stated unproven condition is now proven.

### The risk is more specific than "Vercel might close it"

They will not — Vercel needs the library; it is the foundation of Connect. The real risk is the ordinary shape of an open-source project with a commercial parent: **the core stays healthy because the hosted product depends on it, and the edges only self-hosters use get less attention.**

We have direct evidence of that edge already, from our own prototype:

- `@better-auth/cimd/node` 1.7.2 is **broken on every supported Node** — it throws before a packet leaves the machine and fails every CIMD authorization — and **no upstream issue exists**. Nobody has reported it. That is a plugin nobody is exercising.
- `@better-auth/cli` 1.4.21 lags `better-auth` 1.7.2 and its generated migration misses `account.issuer`.
- Prototype 61 hit three further silent configuration traps, each fatal to the whole connection, each absent from the plugin's documentation.

**Our entire MCP path runs through exactly one of those edges.** So the watch item is not "will Better Auth be abandoned"; it is **"will the self-hosted OAuth-provider path stay maintained while Connect becomes where agent identity actually ships"**.

### What would actually make us leave — three triggers, written as a test

Any one of these starts a migration; none of them is a feeling:

1. **A licence or distribution change** on `better-auth` core or `@better-auth/oauth-provider` — MIT becomes anything else, or the OAuth provider moves behind a paid or hosted-only tier.
2. **The self-hosted OAuth path stops being supported** — `oauth-provider` or `cimd` deprecated, folded into Connect, or twelve months without a release while core keeps shipping.
3. **A security defect we report goes unfixed for one release cycle** on a plugin in our auth path.

**Ticket 83 is the first live test of trigger 3.** We are about to report a bug with a known, small fix on exactly the plugin our MCP path depends on. How long it takes to land is the first real datum on this question, and it costs us nothing to collect.

### Is the Keycloak fallback still real? Less than ADR 0009 assumed

The honest answer, which is worth writing down in place of the comfortable one:

- **The seam is real and worth keeping.** ADR 0009 named `requireBearerAuth`: the app validates a bearer and builds a Principal, and what issued the bearer sits behind the seam. That still holds, and it should become a constitution line — **no Better Auth type crosses into `app/lib`**.
- **The fallback is not a drop-in.** Two things ADR 0009 did not account for. First, fork F2 makes us **CIMD-only**, and Keycloak does DCR, not CIMD — so swapping providers means re-opening DCR and re-proving the entire claude.ai connector path prototype 61 measured. Second, Better Auth is not only our authorization server: it is also the app's email-code login **and its organisation model, which is where the `workspace` claim comes from**. Replacing it is not one component swap.

Call it **two to three weeks, not two days**. That is still worth having — it means no trigger above is an existential event — but the gate should record the true number.

### Recommendation

**Stay.** Record the three leave-triggers as a standing watch item reviewed at the first client's renewal or on any trigger firing; restate ADR 0009's fallback paragraph with the honest cost and the CIMD/organisation-model reasons; add the seam rule to `CODING_RULES.md`; and treat ticket 83's response time as the first measurement.

---

## §6 — The repository's public state (ADR 0027)

**Checked today. It is clean and ready for ticket 77.**

- Private, on `github.com/betteranswers/better-answers`, 52 tracked files.
- No client material tracked: `.planning/`, `.scratch/`, `.lavish/`, `old-suggested-schema.md` and `15-user-feedback.md` are all gitignored, and nothing matching a client, credential, key or env pattern is tracked.
- `apps/docs-site/operations/SECRETS.md` is tracked and holds **no secret values** — it is the inventory of what exists and where it lives, which is what it should be.
- `LICENSE` (Apache-2.0), `NOTICE`, `SECURITY.md` and `README.md` are all present, per ADR 0027 and ticket 62.

Nothing here blocks the gate. Ticket 77 still owns the flip itself, the organisation setting, and the `security@` mailbox `SECURITY.md` promises.

---

## §7 — The first build tasks

*This is the gate's output. On sign-off these are written into ordna (the queue is initialised and empty; `next_id: 1`). Six foundation tasks, then the product slice — which is deliberately not sized yet, because sizing it properly needs the foundation standing.*

**B1 · Repo skeleton and a green `check`** — no dependencies
`app/`, `web/`, `worker/`, `packages/schema`, `packages/contracts`; pnpm workspaces; oxlint + Onyx `anti-slop`; Vitest 4 + Testcontainers; Python 3.13 + uv + ruff + mypy; the root `check` running them all and CI green on a pull request. Nothing else — this task exists so every later task has a place to land and a gate to pass. *(ADRs 0005–0008; `[TEST]`, `[DEPS1]`)*

**B2 · The database — image, schema, roles, isolation** — after B1
`deploy/postgres.Dockerfile` built and pushed by `build.yml` (AGE 1.8.0 + pgvector 0.8.6 on Postgres 18); Drizzle owns `public`, the app owns the `index` and graph DDL; `CREATE EXTENSION age`; the role model **Q2** settles; `FORCE ROW LEVEL SECURITY` with `SET LOCAL` inside the transaction; the schema stamp and `migrate → app → worker`; the functional test that a missing scope returns zero rows rather than another tenant's. Carries **A9** (explicit `memswap_limit`) and scale **F2** (a memory limit on every VPC 1 service, and a stated page-cache floor). *(ADRs 0007, 0023)*

**B3 · Identity and the MCP surface** — after B1, B2
Better Auth in-process; `@better-auth/oauth-provider` + `@better-auth/cimd` with the hand-written PRM (**A23**); the CIMD fix as `lifts/better-auth-cimd-node/` with its `THIRD_PARTY_NOTICES.md` and removal condition (**A24**); dual-era serving on `legacy: "stateless"` (**A17**); the four entries, each carrying its `annotations`, with the lint rule and test that enforce it (**A19**); the per-call role read with its revocation check; the Postgres rate-limit counter (**A25**); research 80 §9's host-agnostic conformance test; and prototype 61's three silent configuration traps as regression tests, because each is fatal to the whole connection and absent from the plugin's documentation. *(ADRs 0009, 0018)*

**B4 · The deploy unit made runnable, ending in the first drill** — after B2
**A28**'s list: the three `<read on the day>` placeholders, `seed-synthetic.sh`, `init-repo`, the `stagingstore:` rclone remote, the AGE-aware staging wipe, and the `pnpm ops` commands the scripts already call (`replay-erasures`, `graph-rebuild`, `graph-counts`, `smoke`, `erasure-rehearsal`, `dump-grep`). Plus what the operability review found missing: `restore-production.sh` that is *not* the staging drill script with its wipe trap (**op F1**), `deploy/RELEASES.md` appended by `release.yml` so the previous digest is findable during an outage (**op F3**), three more runbook pages — release went wrong · a backup check is red · a client reports wrong or lingering content — each carrying a named escalation contact and the rows to attach (**op F2**), `deploy/host-setup.sh` extracting wizard stages 3 and 7's shell work and fixing the SSH restriction that would break the mirror (**op F9**), one external uptime check on the client's own path (**op F6**), and the second alert channel extended to `pg-hourly`, `nightly` and `drill` (**op F7**). **Ends by running the first restore drill by hand, before any client data exists** (ADR 0022). Also settles **Q7**'s key residency in `SECRETS.md` and the breach page.

**B5 · The concept write path and its reconciler** — after B2
The governed write: one commit per act, the person as author and the platform bot as committer, the hash precondition checked against the ref, the per-repository lock. The concept index row, `bundle_commit` and the `audit_event` in one Postgres transaction. The `concept_write_request` inbox. **And the reconciler's defined action** — the pass-2 equivalent of pass 1's blocking finding: ADR 0012 names the crash window between the git commit and the Postgres write, and names "reconciler hits" as a signal, but no document says what the reconciler *does*. It replays the missed commits through the same handler the live write uses, idempotent on the ids the commit's trailers carry. *(ADRs 0012, 0014; failure-recovery F1)*

**B6 · The AGE spike, under load** — after B2
ADR 0023's named spike, with scale **F4**'s condition added — run it **under concurrent read traffic and a concurrent hourly dump**, not cold, because the 2-minutes-per-workspace rebuild budget was set for a Neo4j-shaped box with its own isolated heap and has never been re-derived for a graph living inside the same Postgres on a 4 GB box. Measures: depth-4 traversal cost on a 100k-node label set with and without the `gen` index; the agtype parser in `pg`; `MERGE` split cost for the largest `Answer` subgraph; the derive step's idempotency from cocoindex's Postgres target; the graph role's grants across `create_graph`; and that the Coolify resource on the custom image keeps its backup writer.

### The product slice — named, not yet sized

**B7 · Sources, bindings and the pipeline** (after B2, B5) — carries the four probe measurements §4 turned into build-task tests: whether the LMDB holds personal data and whether one entry can be removed; that `drop` on one binding cannot take the shared search index with it; the `detect_change` blast radius; and the LMDB size per binding as an ADR 0025 signal. Also `double_claim` as a `platform_event` (**failure-recovery F3**).
**B8 · Records, guides and compositions** (after B5) — including the by-run filter on Knowledge that makes a poisoned suggestion set reversible in one governed write (**failure-recovery F4**).
**B9 · Search, `ask` and the answer contract** (after B3, B6, B7) — its latency measurement run under concurrent load, not quiescent (**scale F5**).
**B10 · Control Centre's six screens** (after B7, B8, B9).

**Sequencing note.** B1 → B2 is a hard chain; B3, B4, B5 and B6 all run off B2 and are independent of each other. The first genuinely client-visible moment is B4's drill, which ADR 0022 requires before any client data — so it should not be scheduled last.

---

## §8 — What the five lenses found

*Five reviewers, one lens each, independent — none read another's report. Reports: [`research/architecture-review-pass-2/`](../research/architecture-review-pass-2/) — `BRIEF.md`, `data-flow.md`, `security-credentials.md`, `failure-recovery.md`, `scale.md`, `operability.md`. 41 findings. Each was told research 78 had already done document consistency and not to re-report it.*

| Lens | Verdict |
| --- | --- |
| **Data flow** — one SharePoint file from binding to cited answer to six months on | One **blocking** finding, five must-change. The write path and the predicate's single home held; the seams between ADR 0026 (kinds) and ADR 0023 (the graph) did not. |
| **Security & credentials** — the principal, end to end | Three findings it would "stake the review on": the predicate's undefined units, the graph's single isolation control, and the platform's own writes bypassing the redaction seam. No decision overturned. |
| **Failure & recovery** — assume everything fails | One must-change (the reconciler has no defined action) and four should-fix. Crash-safety, erasure-replay and the graph's "never a hard dependency" claim all survived direct attack. |
| **Scale** — 50 workspaces on two 4 GB boxes | One gate decision (local embeddings do not fit), two must-change on memory discipline. Row counts and one Hono process are fine; **cache RAM is the constraint, not data volume**. |
| **Operability** — can one non-technical owner run it? | "Operable enough to build, and closer than most solo-founder estates" — but operable *because it is small*. Two gate decisions; the rest is paper, not software. |

### Everything blocking or must-change, and where it goes

| # | Finding | Disposition |
| --- | --- | --- |
| DF1 | **Blocking** — nothing creates a graph label named by kind, and the two partitions' unique indexes collide | **Q1** |
| SEC1 | The read predicate is undefined on concepts and compositions | **Q2** |
| SEC2 | The graph's only isolation control is string construction; the app runs as owner | **Q3** |
| DF8 | The bundle-and-record derive still bridges a store boundary that no longer exists | **Q4** |
| DF6 | Erasure does not reach a person's name inside a concept body | **Q5** |
| SCALE1 | Local embeddings cannot be hosted on this estate | **Q6** |
| OPS4 | Production is the first runtime for every image | **Q7** |
| OPS5 | The drill's unattended cron contradicts escrow-only key residency | **Q8** |
| SEC5 | `mcp.` is unmetered at the edge; the CIMD fetcher has no SSRF policy | **Q9** + applied |
| SEC9 | The flip publishes an operational map of the estate | **Q10** |
| FR1 | The reconciler for a crash between commit and rows has no defined action | **B5** |
| DF2 | An ad-hoc answer's citation marker has no minter | **B9** (renderer signature) |
| DF3 | A suggestion's identity resolves at an unstated moment; `suggestion` is filed in the wrong record kind | **B5** + first migration |
| DF4 | The platform's own citation repair un-checks every concept it repairs | ADR 0019 amendment (a *repair* origin) |
| DF5 | Evidence outlives its source but the passage does not, and nothing joins the two | ADR 0013/0014 amendment + first migration |
| SEC3 | The platform's own writes (`human:<email>`, `Person` contacts) never pass the redaction seam | ADR 0020 amendment + **B7** (index body, never frontmatter) |
| SEC4 | No system principal; a background job outlives the person's authority | `[SEC2]` + `CONTEXT.md` (two principal kinds) |
| SCALE2 | No page-cache floor, and only the worker has a memory limit | **B2** |
| SCALE3 | `MAX_CONCURRENT_RUNS=1` makes onboarding a serial queue, unmeasured | **B7** + the estate-size probe |
| OPS1 | The production restore path is the staging drill script, whose trap wipes what it restores | **B4** |
| OPS2 | The runbook covers five catastrophes and none of the common incidents | **B4** |
| OPS3 | A failed release is an outage and the previous digest is not findable | **B4** |

*The remaining should-fix and note findings (FR3 double-claim · FR4 bulk revert of a poisoned run · FR5 total-loss runbook page · SEC6 `[SEC2]` unenforceable as written · SEC7 credential blast radius · SEC8 consent and personal-token holes · SEC10 a digest interpolated into a shell command · DF7, DF9, DF10 · SCALE4–6 · OPS6–10) are each routed in §7's tasks or as an amendment. None needs an answer.*

### What they tried to break and could not

- **Pass 1's blocking finding is properly closed.** The concept inbox carries evidence, the app writes it at commit, and there is no second writer or empty window. One reviewer went looking for a derived row with two writers and found none.
- **The write path cannot be poisoned into minting a concept.** Nothing platform-prepared reaches the bundle without an Admin act, which neutralises the obvious prompt-injection route.
- **The answer path leaks nothing by arithmetic** — one *not found* for absent and withheld alike, no totals, cursor pagination with `has_more` only, "cited in N" counted over answers the caller could have received.
- **The graph is genuinely not a hard dependency** — because traversal is optional at depth 0 with tested fallbacks, not because the language is reassuring. And since ADR 0023 the graph is only unavailable when Postgres is, at which point nothing else works either.
- **A worker `kill -9` mid-extraction loses nothing, double-bills nothing, corrupts no memo** — measured on prototype 52, not asserted.
- **Fail-closed defaults hold**: Restricted is every binding's default, publish is a separate act, there is no group UI. *(One consequence to act on: the `audience` term ships with no way to produce a non-`everyone` value, so that branch would go untested — seed one group and one test.)*
- **The backup design** — client-side `age`, escrow-only private half, governance lock, erasures replayed before the app turns healthy — "a better answer than most funded teams ship".
- **Postgres at 50 workspaces is unremarkable.** ~58 M usage rows a year, per-workspace HNSW partitioning, one Hono process. The constraint is cache RAM, not rows.

### What none of them could check

No box exists, so every walk-through is a desk-check. Named explicitly: whether AGE auto-creates a label table on first write (Q1 holds either way, but it is a first-deploy probe); whether the Coolify Postgres resource's owner is the superuser (`\du` on the first deploy settles it, and it raises Q3's stakes if so); whether Better Auth 1.7.2's rate limiter defaults to memory or the database under our plugin set; and **the first client's estate size**, which is the single number every throughput and retention conclusion moves with.

---

## §9 — Round 2 and the outcome (29/08/2026)

Liam answered eight of the fourteen, then asked for the established reviewer pass: two Fable agents, a **senior staff engineer** and a **knowledge-layer persona** with the full OKF background, reading every question independently — "so that we are not knowingly creating architectural issues but are instead building on strong industry best practice architectural foundations, whilst keeping the platform's *simplicity over complexity* mantra". Reports: [`research/79-staff-engineer-review.md`](../research/79-staff-engineer-review.md) · [`research/79-knowledge-layer-review.md`](../research/79-knowledge-layer-review.md).

**Both said build. Neither disagreed outright with any of the fourteen.** The staff engineer overruled the briefing once — in Liam's favour, on Q9 — and reshaped Q2 and Q14. The knowledge reviewer found that on the four questions touching the model, the recommendations are *what the model itself demands, not concessions to engineering*.

**The reshape that mattered.** Q1, Q2, Q3 and Q4 are not four questions but one — *the graph is ordinary application data* — and answering them as four amendments to four documents would have reproduced the exact failure that caused the blocking fault. Round 2 collapsed them into one pick, recorded as **one amendment to ADR 0023**.

**Round 2, all four taken as recommended.** R1 the graph as application data (Q1–Q4 in one amendment, with the `Person` floor, the synchronous two-level recompute and the override's fixed word) · R2 Q5 on the minting rule's basis, *the routine rewrites what the platform wrote; a person edits what the company wrote* · R3 Q12 the docs site in-repo, with Warp's separate-repo evidence weighed and set aside · R4 Q13 stay on Better Auth with the seam rule **lint-enforced**.

**Three things neither the council nor this briefing had caught**, all applied: the rate-limit counters put write load from unauthenticated-adjacent traffic into the database they protect (the counter table becomes `UNLOGGED`, in B3); Q7's and Q9's conditions were prose with no forcing function (they go into `release.yml` and `coolify.md`); and Q10's estate-document split is a **hard predecessor** of ticket 77's one-way flip, not merely "at the gate".

**Delivered.** ADR 0023's amendment written; seven build tasks in ordna (`T-001`–`T-007`, 70 acceptance lines, dependencies wired); ticket 79 resolved; ticket 77 unblocked with one new acceptance line; the map swept, with a new fog entry for a class-filtered bundle export. The remaining twenty-eight applied items and the amendment sweep are build task **B0** (`T-001`), which is where they belong — research 78's finding is that a builder reading any one stale file builds the old design, so the sweep is tracked work with acceptance lines, not a session tail.
