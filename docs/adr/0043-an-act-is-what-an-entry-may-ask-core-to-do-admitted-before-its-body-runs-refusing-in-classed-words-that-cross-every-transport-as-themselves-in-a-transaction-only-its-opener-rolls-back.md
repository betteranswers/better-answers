---
status: accepted
date: 2026-09-21
---

# An act is what an entry may ask core to do — admitted before its body runs, refusing in classed words that cross every transport as themselves, in a transaction only its opener rolls back

**Where this came from.** An architecture review on 21/09/2026 put sixteen deepening candidates
on the table; a first-principles pass found that the largest group of them — the refusal words
retyped per act, admission answered in three places, an act's input stated per transport, three
hand-built composition roads — were one absence. An *act* is the codebase's central concept and
only its ledger half was declared (`declareActs`). A census of `packages/core` then counted 78
face functions that take a Principal, of which **16 are reached by any entry** — the `sources`
slice (12) and the `members` slice (11) by none — and 53 refusal words, `malformed` retyped as a
literal in 24 unions. T-135 is the first time a transport meets an act that refuses in words or
owns its transaction, ten at once, and two hazards were waiting for it: `workspaceProcedure`
holds a pooled connection for the whole call, so `bindUpload` beneath it would hold two of the
pool's ten per upload; and the principal-scoped door **commits** when its work *returns* a
refusal, where four acts return one after their rows have landed. The working papers — the
census, the first-principles review and the staff review whose rulings this record follows — are
under `.scratch/architecture-review-2026-09-21/`.

**The words.** *Act*, *step (of an act)*, *ledger act*, *admission* and *refusal* with its seven
classes are `CONTEXT.md`'s, settled with this record. An act is what an entry — a tRPC
procedure, an MCP entry, an ops command, the tick — may ask core to do: a face function that
takes a Principal and answers a `Result`, a read or a write. A step runs only inside another
act's transaction (`record`, `enqueueJobIn`, `holdsEveryGroup`); it is never declared and has no
refusal of its own. One rule follows and replaces the wording of `result.ts`'s rule 5: **after
an act's first write, anything it calls rejects.**

**The shape, and when it is built.** An act is a constructed callable. A constructor in the
kernel takes what the act admits, its input schema, its refusal words and whether it reads or
writes, and a **named** body function; it runs the admission and calls the body with the
narrowed Principal, so the body's first parameter is the proof and an act that skips admission
cannot be written. It opens, commits and rolls back nothing, and it parses nothing — it hands
its second parameter through untouched, so the call shape stays the one every act has today.
Admission is a pure function of the Principal and the parsed input and reads no row: what
`adminOnBinding` does today is admission plus an id's shape, and `bindingNamed`, which reads the
row, already takes that proof first. **It is built with the first act that needs what
`requireAdmin` cannot say** — a platform purpose (T-178) or a control the web hides by role
(T-136) — and until then `requireAdmin` and `adminOnBinding` stand. Two things an earlier draft
declared are left out because nothing would operate from them: who opens the transaction, which
the signature and the procedure's context type already say, and the ledger acts written, until
a sweep for an act's audit event exists to read them.

**Refusals.** A refusal word means one thing wherever it appears. Its owning slice declares it
once and it is registered globally, as ledger acts are, with the shared words (`malformed`,
`role-forbids`, `not-found`) in the kernel; an act's `Result` union is built from registered
words, so an unregistered literal does not compile, and one walk test holds that every word is
declared once, used, and classed. The classes sort a word by what its caller can do about it,
which is why they fall one-to-one onto the status taxonomy every transport already has — the
tie-breaker for a word that seems to fit two. Only a word that can cross an act's face is
classed; a store door's own words become defects before they do. `not-a-member`, which today
names the actor in one union and the person being added in another, becomes two words. A
shipped word is never removed and never changes class.

**Crossing a transport.** Each transport has one crossing function: a value crosses as itself;
a word becomes the protocol's error for its class, carrying `{ word, class }` and, for
`malformed`, the field map below; an `Error` becomes an internal failure and is logged there,
once, a refusal at info with its word. Over tRPC the refusal is a thrown error, and
the word union reaches the web through `AppRouter`'s error-formatter type, so ADR 0006's
one-type fence holds; a type-level sweep keeps any procedure's output from being a `Result`.
`pnpm ops` maps the same classes to exit codes. **Procedures are written by hand** — input,
query or mutation, the call through the crossing function — and no adapter reads a declaration
to build them: a call made through a value leaves the code index, and GitNexus `impact`, which
gates every edit here, would answer a lower bound for every act. That a word crosses as itself
is proved per class and by the walk, never by driving each word through the api harness.

**Transactions.** A transport never nests an act's transaction in its own. Three base
procedures: a query resolves the membership unlocked, as every request does today; a mutation
resolves it with the held query (`FOR SHARE`), so ADR 0012's construction covers the first
person-driven writes; and an act that opens its own transaction runs under a procedure that
resolves the Principal in a short transaction, releases the connection and hands the act the
Principal and its doors — `kernel/principal.ts` already records that a Principal may outlive
its resolving transaction and never the request, and `withMembership` re-judges it under the
shared lock. A procedure that holds a `tx` cannot, by its context's type, reach a Postgres
door. **The door rolls back**: ~~`resolveScoped` rolls back when its work answers a `Result` that
is not ok~~ every door rolls back when its work answers a `Result` that is not ok — the platform
principal's `withScope` as well as `withPrincipal` and `withMembership`, one function holding the
transaction for every Postgres door (the 2026-09-23 amendment below) — and the four tails that
return `enqueueJobIn`'s word after their rows have landed throw instead, as `bindUpload`'s does —
that word would tell an Admin they are forbidden when the fault is a descriptor's. One composition root in `apps/api` opens the four doors and the
Clock (ADR 0040) and states the pool's size; the server, `ops` and the api harness call it.

**Input and output.** Input is parsed once, where it enters the process, by a kernel `parse`
over the act's schema; the act takes the parsed type and the field brands are its proof. The
schema lives in the slice and composes from the boundary's column shapes (ADR 0028). `parse`
owns the one translation of a schema's issues into a transport-neutral map of field path to
issue word, never the value, which is what makes it more than a pass-through. MCP's flat wire
shape maps into the act's schema and is not forced to be it; an upload's bytes travel beside
the parsed fields. Shape is now refused before role, which reverses the order
`admin-binding.ts` records; a shape says nothing of a tenant's state, so nothing leaks.
Instants cross every wire as ISO-8601 text and no transformer is mounted.

## Considered options

- **A declaration beside the function, held by a sweep or by derived types and a proof value.**
  Two statements of one thing; and the proof has nothing to be required by, since `record`
  takes any Principal and every other write is `tx.query`. It stays the fallback, with a lint
  rule that a face function admits before its first `await`, if a constructed act degrades the
  code index.
- **A constructor that also parses, or owns the transaction.** A runner: transaction ownership
  differs by act (bytes before rows; git before rows, ADR 0012), so nothing may own it
  generically.
- **Own-transaction acts taking claims, each transaction resolving its own Principal.**
  Unachievable — `putObject` and `withRepositoryLock` take a Principal outside any Postgres
  transaction — and it would retire `withMembership`'s lock and make `writeConcept` take the
  repository lock before it could refuse a Viewer.
- **A refusal as a value on the wire**, typed per procedure. Every read screen would branch on
  it and a cached client could do nothing with a word it had never met. Per-procedure
  exhaustiveness, if a screen comes to need it, is a type-only map beside `AppRouter`.
- **No classes, a table per transport**; or **one flat list of words**, as the codebase these
  conventions were first modelled on keeps (137 entries, the status chosen at each call site).
- **Capability-typed doors with no declared admission**, which moves `role-forbids` out of core
  into every caller against the Principal-first rule; **a per-slice manifest a router is
  generated from**, which puts a transport's facts in core; **schemas generated from types**,
  against ADR 0028.

## Consequences

- **Before T-135**, and none of it redone later: the door's rollback and the four tails; the
  composition root, the three base procedures and the context type that keeps a door from a
  procedure holding a `tx`; the vocabulary for `sources`, the kernel's shared words,
  `PrincipalRefusal` and the transport's own two; the crossing functions and the error
  formatter, with the web reading `{ word, class }`; input schemas for the acts T-135 exposes.
  The S1 spec's "all under the workspace procedure" is amended, and T-135 and T-178 with it.
- **`bindUpload` is hardened before a transport reaches it**, as its own ticket: the binding's
  id is caller-minted so a repeat answers the first outcome; the object's key derives from it
  and a scheduled sweep removes objects no row names; the act counts the bytes it streams and
  refuses past the cap, which is one exported constant.
- **Deferred until a second consumer exists**, nothing having varied yet: the constructor and
  admission; the ledger acts as a declared field; the other acts, each converted when an entry
  first reaches it; the rename of the code's `Act` type to say *ledger act*, which lands with
  the constructor.
- **A spike goes first, and can amend this record.** In order: the result-aware door against
  the whole of core's suite — if more than two or three acts rightly answer a refusal and keep
  their rows, the throw moves to the crossing function alone; `bindUpload` through the
  own-transaction procedure under ten concurrent multipart uploads — if tRPC cannot stream, the
  upload is a plain Hono route and ADR 0006 gains an exception; the typed error formatter under
  the api-seam test; `narrowBinding` as a constructed act with GitNexus answering *exact*; and
  the suite lines that change with no behaviour change. No type-only route for the words, or
  more than about a quarter of those suites rewritten, and the constructor is dropped: the
  vocabulary, the crossing, the roads and the root stand without it.

## Amendment — 2026-09-21, the tails are three: `narrowBinding` queues no run (T-232)

This record counts four acts that return `enqueueJobIn`'s word after their rows have landed.
There are three — `keepInText`, `narrowDocuments` and `reprocessBinding`; `bindUpload`'s tail
throws already. `narrowBinding` calls no `enqueueJobIn`: its one answer after its writes is the
cascade's `Error`, which the door's rollback covers. Read *four acts* and *the four tails* above
as these three. T-232 and the S1 spec say the same; nothing else in the decision moves.

## Amendment — 2026-09-22, the spike's findings: the constructor is dropped, and the upload streams over tRPC as an octet-stream mutation (T-230)

The five probes ran on the branch `t-230-spike`, never merged; the code is the evidence and the
ticket holds the readings. Two probes killed, and each kill is decided here.

**Probe 1 — the door.** With `resolveScoped` rolling back when its work answers a `Result` that is
not ok, the whole of core's suite changed in one case: the erasure request refused for a clock
started before it arrived, which threw *did not commit* and now answers its refusal with no row
landed. No act rightly answers a refusal and keeps its rows. The rollback stays in the door;
T-232 stands as written.

**Probe 2 — the upload.** The connection half passed: one connection per request — the Principal
resolved and released before the input parser runs, then the act's own transaction — none held
while the body is read, and ten concurrent uploads on a pool of ten peaked at ten with nothing
asked while the pool was at its ceiling. The streaming half killed **for multipart only**: tRPC
11.18's multipart handler is `await req.formData()`, so the procedure saw the input at 403 ms of a
body whose last chunk arrived at 402 ms. Its octet-stream handler hands `req.body` through as a
stream, and `octetInputParser` put the first byte inside `putObject` at 3 ms of a 400 ms body.
The kill above was conditioned on tRPC not streaming; it streams. So **the upload is a tRPC
mutation over `application/octet-stream`**, `octetInputParser` on the own-transaction road, and
`FormData` is withdrawn as an admissible shape. The binding's descriptor travels beside the bytes
— headers the link sets from `op.context`, gathered once in the procedure and handed to the kernel
`parse` — which is this record's own sentence, *an upload's bytes travel beside the parsed fields*.
The descriptor sits outside `AppRouter`'s inference, so the web keeps one typed wrapper and the api
harness holds one case a renamed field fails; a custom link that carries the descriptor inside the
typed input is the shape for a second octet-stream mutation, none being on the route
and nothing having varied yet. ADR 0006 gains no exception; its 2026-09-22 amendment says what
its rule is for. A plain Hono route was weighed and refused: Hono's own multipart buffers
through the same `formData()`, and a raw body beside a plain route carries the same descriptor
with nothing compiler-checked.

**Probe 3 — the crossing.** The error formatter carries `{ word, class }` under `data.refusal`;
the web infers the word union and the class from `AppRouter` alone and the api-seam fence stays
green. T-235 stands as written.

**Probe 4 — the constructor.** A constructed act with a named body infers its types — the spike's
type-equality test holds the constructed `narrowBinding` to the hand-written signature and refusal
union with a negative control — but the code index answers a **lower bound**: on one index, one
commit and one router file, the hand-written `readMembership` answers impacted 5, direct 1, the
router at depth 1; the constructed `narrowBinding`, called from the same router, answers impacted
0, direct 0, risk *unknown*, kind `Const`, its named body no symbol at all. A gate that gates every
edit here cannot be allowed to answer a lower bound for every act. **The constructor is dropped**,
as this record said it could be. Read *The shape, and when it is built* as the fallback its
*Considered options* names: a declaration beside the function, the act's types derived from it,
and a lint rule that a face function admits before its first `await`, with the test that runs it.
The vocabulary, the crossing, the roads and the composition root stand. T-237 lands the fallback.

**Probe 5 — the suite lines.** Zero. The constructed acts kept their call shape, and no line of the
sources suites moved.

Nothing else in the decision moves.

## Amendment — 2026-09-23, every door rolls back on a refusal, and a principal-scoped door answers its own refusal apart from its work's (T-338)

**Every door rolls back.** *Transactions* named `resolveScoped` alone. `withScope`, the platform
principal's door, committed whatever its work returned, so a platform act that refused after a
write would have kept its rows; none did yet, but `inWorkspace` read the two doors alike while
only one of them rolled back. One function now opens the transaction for every Postgres door and
rolls it back when the work answers a `Result` that is not ok, when the work throws, and, for the
two principal-scoped doors, when the door refuses the principal. The identity set's two doors pass
through it as well; none of their work answers a `Result`.

**The door's refusal is its own.** Since T-232 the principal-scoped door answered its work's
`Result` as its own, with `PrincipalRefusal` folded into the work's union, so a caller could not
tell a principal the door refused from an act that refused: the erasure rehearsal reported a
subject whose credentials were revoked as "the rehearsal's request was refused". The door now
answers a `Result` of its own, carrying its refusal or the work's answer untouched. An act whose
face carries the door's words beside its own reads the two as one by calling `folded` on the
door's answer, so the acts T-232 moved to one `Result` still read one; the rehearsal reads them
apart. `folded` refuses, in the type, a work whose answer is only partly a `Result`, since the
`Result` members of such a union would reach the caller as values.

Nothing else in the decision moves.
