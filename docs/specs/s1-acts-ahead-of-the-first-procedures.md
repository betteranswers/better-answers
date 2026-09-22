# S1 — Acts, ahead of the first procedures

The work S1 needs before T-135 puts the `sources` slice's acts behind tRPC. The decisions are ADR 0043's and the words are `CONTEXT.md`'s (*act*, *step*, *ledger act*, *admission*, *refusal*); this spec says what is built, in what order, and how it is proved. Read ADR 0043 first.

## Problem Statement

No entry has yet called an act that refuses in words or opens its own transaction: tRPC holds two queries, MCP three reads and one write, and the whole `sources` slice is reached by core's own suites alone. T-135 is first contact, ten acts at once, and what it would meet today is wrong in ways a person would see. An Admin who uploads a document would hold two of the api's ten pooled connections for the length of the upload, so a sixth concurrent upload waits on the pool. An act that returns a refusal after its rows have landed would have those rows committed under the workspace procedure. A refusal would reach the Sources screen as a hand-written fork per procedure, each free to send a different status for the same word, and reach an agent over MCP as one sentence about credentials whatever was refused. A double click on *bind* would bind twice, a caller who understates a file's size could stream any amount into the object store, and a failed bind would leave bytes no row names.

## Solution

A refusal word means one thing, carries a class that says what its reader can do about it, and reaches a screen, an agent and an operator as itself through one crossing per transport. A transport runs an act in the transaction the act calls for and never nests one in another; the door that opens a transaction rolls it back when the act refuses. Input is parsed once where it enters, and a malformed input says which field. The upload is safe to retry, bounded by what is actually streamed, and leaves nothing behind. A spike proves the four risky parts first and can narrow the design before anything is built on it.

## User Stories

### The Admin — a bid writer at the first client

1. As an Admin, I want ten colleagues to upload at once without any of us waiting on the platform, so that a bid team can load a library in one sitting.
2. As an Admin, I want a double click on *bind*, or a retry after a dropped connection, to leave one binding, so that I never clean up a duplicate.
3. As an Admin, I want a file over the cap refused as soon as it passes the cap, whatever size my browser declared, so that I am told at once and nothing of it is kept.
4. As an Admin, I want a refused act to leave nothing behind — no row, no ledger entry, no queued run, no stored bytes — so that what the screen says happened is what happened.
5. As an Admin, I want each refusal said in a sentence that tells me what to do — sign in again, ask someone with the authority, pick something that exists, fix this field, choose something this applies to, look again, do that first — so that I am never shown a status code.
6. As an Admin, I want a form that failed to say which field was wrong, never echoing what I typed back into a log, so that I can fix it without guessing.
7. As an Admin whose role is changed while I work, I want my next write refused rather than landed under the authority I no longer hold, so that a revocation means what it says.

### The Editor and the Viewer

8. As an Editor or a Viewer, I want an act my role cannot perform to refuse me as *forbidden* and an expired sign-in to refuse me as *unauthenticated*, so that the screen sends me to sign in only when signing in would help.
9. As a Viewer, I want a refused read to tell me nothing about whether the thing exists in a state I may not see, so that invisibility holds through the refusal too.

### A person working from Claude

10. As a person asking through the MCP surface, I want a refusal to arrive as its own word and class in the tool's error, so that the agent can tell "no such passage" from "you may not" and say so.
11. As a person whose client was installed before a new refusal word shipped, I want the agent to act on the word's class, so that an old client degrades to something sensible.

### The operator and the owner

12. As the operator, I want `pnpm ops` to exit with a code that follows the refusal's class, so that a cron wrapper can tell a precondition from a fault.
13. As the operator, I want a failure logged once, where it becomes a protocol error, with the act's name and the cause, and a refusal logged at info with its word, so that the logs say what happened without saying it twice.
14. As the operator, I want the api's connection budget stated in one place, so that I can size Postgres for the server, the MCP surface, sign-in and the tick together.
15. As the operator, I want a scheduled sweep to remove stored objects no row names after a grace period, so that failed binds do not accumulate personal data nobody can find.
16. As the owner, I want the spike's findings before T-135 is cut, so that an upload that cannot stream over tRPC is known while the spec can still change.

### The platform acting as itself

17. As the erasure routine, I want the refusal I am given to be the true one, so that a descriptor fault never reads as "role forbids".

### The builder and the reviewer

18. As the agent building T-135, I want each procedure to be three hand-written lines — its input, query or mutation, the call through the crossing — so that the transport holds nothing of the act's.
19. As the agent building T-135, I want choosing the wrong base procedure for an act to fail to compile, so that a nested transaction cannot be written.
20. As the agent building T-135, I want an unregistered refusal word in an act's result to fail to compile, so that the vocabulary cannot drift from the acts.
21. As an agent editing an act, I want GitNexus `impact` to list the procedure that calls it, so that the blast radius I report is exact.
22. As an agent writing a test, I want one suite helper that parses an act's input or throws, so that arranging a call costs one line.
23. As a reviewer, I want "every refusal word crosses as itself" to be one table-driven test per class and one walk over the registered words, so that I can see it is held without reading fifty cases.
24. As a reviewer, I want a procedure that returns a `Result` to the wire to fail a type-level sweep, so that a refusal never crosses as a success.
25. As an agent reading the rules, I want `result.ts`'s rule 5 to say what is true — after an act's first write, anything it calls rejects — so that the rule and the 47 acts that take a transaction stop disagreeing.

## Implementation Decisions

### The spike — first, and throwaway

Five probes, in order, each with what it would change (ADR 0043, *Consequences*): the result-aware door against the whole of core's suite; `bindUpload` through the own-transaction procedure under ten concurrent multipart uploads on a pool of ten; the error formatter's typed `{ word, class }` inferred by the web through `AppRouter` alone with the api-seam test green; `narrowBinding` as a constructed act with a named body, with GitNexus `impact` and `context` answering *exact* and the router site among its callers; and a count of suite lines that change with no behaviour change. The spike's code is discarded; its findings are written to the ticket, and any that amends ADR 0043 is an amendment in the same PR as the finding.

### The door rolls back

The principal-scoped door rolls its transaction back when the work it ran answers a `Result` that is not ok — one function, shared by the transport's door and the slice's. The three acts whose tail returns the enqueue's word after their rows have landed — keep in text, narrow documents, reprocess a binding — throw there, as the upload's bind already does. Narrow a binding queues no run: its one answer after a write is the cascade's `Error`, which the door rolls back. The double unwraps the old behaviour forced on callers go. `result.ts`'s rule 5 is reworded in the same change.

### The composition root and the three roads

One function in the api opens the four doors and the Clock and states the pool's size; the server, `ops` and the api test harness build from it. tRPC gains three base procedures: a query, resolving the membership unlocked as today; a mutation, resolving it with the held read; and one for an act that opens its own transaction, which resolves the Principal in a short transaction, releases the connection, and hands the act the Principal and its doors. Only that third context carries doors; a context that holds a transaction cannot reach one. The MCP surface gains the same third road when an own-transaction act first gets an entry, and not before. The loose sentence about a Principal's lifetime in the tRPC base is corrected to the kernel's.

### The vocabulary

Refusal words are declared once by their owning slice and registered globally, with the shared words in the kernel; each carries one of the seven classes; an act's refusal union is built from registered words. In scope now: the `sources` slice, the kernel's shared words, the Principal resolver's words and the transport's own two. `not-a-member` splits into the actor's word and the named person's. The membership read's "no such workspace", which today crosses as *unauthenticated* on purpose, gets a word of that class. Every other slice converts when an entry first reaches it.

### The crossing

One crossing function per transport: a value crosses as itself; a word becomes that protocol's error for its class, carrying the word, the class and, for *malformed*, the field map; an `Error` becomes an internal failure, logged once there. tRPC carries it in the error formatter's shape so the web infers the word union from `AppRouter`; the web's refusal reader and retry policy read the word and class rather than a message under one status. `ops` maps classes to exit codes on the same table. MCP's one sentence about credentials goes.

### Input

A kernel `parse` takes an act's schema and a raw value and answers the parsed, branded input or *malformed* with a map of field path to issue word, never the value. Schemas for the acts T-135 exposes live in the `sources` slice and compose from the boundary's column shapes. Those acts take the parsed type; the id parse inside the binding head, now unreachable, goes. A suite helper parses or throws. Instants in outputs cross as ISO-8601 text.

### The upload, hardened

The binding's id is minted by the caller and a repeat with the same id answers the first outcome. The stored object's key derives from that id. The act counts bytes as it streams them into the object store and refuses *too-large* past the cap, aborting the put; the cap stays one exported constant. A scheduled ops sweep removes objects older than a grace period that no document row names, and says how many.

## Testing Decisions

A good test drives an act, a procedure or a command through the interface its caller uses and asserts what that caller can observe — rows, a refusal and its class, an exit code, a connection count — never internals (`[TEST1]`, `[DESIGN2]`); real Postgres and a real object store (`[TEST2]`, `[TEST3]`); a provoked failure inside a transaction asserts the transaction's outcome (`[TEST8]`); a pair is checked both ways (`[TEST7]`). No new seam:

1. **The core slice interface** (prior art: the sources, runs and concepts suites). The door: an act that answers a refusal after a write leaves no row, no ledger entry and no job, through both principal-scoped doors. The three tails throw on a provoked enqueue fault and nothing lands. `parse`: each exposed act's schema refuses a malformed input with the failing path and no value. The vocabulary's walk: every registered word is declared once, used by an act, and classed; every classed word can cross an act's face. The hardened upload: a repeat with one id leaves one binding and answers the first outcome; a stream past the cap is refused with nothing stored; the sweep removes an unnamed object past the grace period and leaves a named one and a young one.
2. **The api HTTP harness** (prior art: the MCP and oauth-flow suites). One table-driven case per class proves a word of that class crosses tRPC and MCP as itself with its class, and that an `Error` crosses as an internal failure logged once. A mutation's membership read is held: a revocation landed mid-procedure is refused. Ten concurrent uploads through the own-transaction procedure never hold more than one connection each and none during the stream.
3. **Type-level tests** (prior art: the api-seam test). A context holding a transaction has no door; no procedure's inferred output is a `Result`; an unregistered word in an act's union does not compile; the web infers the word union from `AppRouter` alone.
4. **The `runOps` seam** (prior art: the ops suites). A refused command exits with its class's code and prints the word; the orphan sweep runs as a command.

## Out of Scope

- The act constructor — dropped by ADR 0043's 22/09/2026 amendment, the spike's probe 4 answering *lower bound*. Its fallback is T-237's: a declaration beside `reprocessBinding` and the enqueue, the act's types derived from it, admission as a pure function in the kernel, and a lint rule that a declared act admits before its first `await`. `requireAdmin` and the binding head stand for every other act.
- Converting any act but `reprocessBinding` and the enqueue; the ledger acts as a declared field; a per-procedure refusal type map; any adapter that builds procedures from declarations.
- T-135's procedures and T-136's screen themselves, and the word-to-sentence table the screen renders.
- The architecture review's other three roots — one chunk-visibility derivation, the role-privilege sweep and `contract_version`, the worker's detection and decision split — and whether narrowing a binding queues an `index` run.

## Further Notes

The working papers are under `.scratch/architecture-review-2026-09-21/`: the act census (which acts exist, their words, who reaches them), the staff review (section 5 is the spike's order and kill criteria in full; section 6 is what T-135 must still decide) and the settled-decisions record. T-165 is independent of all of this.
