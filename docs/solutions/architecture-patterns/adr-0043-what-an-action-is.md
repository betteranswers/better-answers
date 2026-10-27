---
title: "An action admits before its first await and refuses in classed words across every transport"
date: 2026-09-24
module: packages/core
problem_type: architecture_pattern
component: kernel
severity: high
applies_when:
  - "Adding an action to a slice in packages/core, or exposing one through tRPC, MCP or ops"
  - "Adding a refusal word, or mapping refusals onto a transport's errors"
  - "Writing a base procedure, a Postgres door or anything else that opens a transaction"
  - "Parsing an entry's input, or sending instants or bytes across a wire"
tags:
  - adr-0043
  - action
  - step
  - refusal
  - admission
  - crossing
  - audit-action
---

# An action admits before its first await and refuses in classed words across every transport

## The decision

**An action** is what an entry may ask core to do. The entries are a tRPC procedure, an MCP entry, an ops command and the tick. An action is a read or a write, and it answers a `Result`.

- It is declared beside its hand-written face function.
- The face function admits before its first `await`. The lint rule `action-admits-before-await` holds it (`packages/devtools/lint-rules/rules/action-admits-before-await.ts`).
- A face function that takes a person declares what it admits, even where every role may ask: it declares the kernel's `ANY_ROLE`. `packages/core/test/face-admission.test.ts` names one that passes no declaration to `admit`. It also lists each step a face exports, with the action that admits for it.
- There is no action constructor: a constructed action left GitNexus answering a lower bound.
- The name an audit event is recorded under is its *audit action*.

**A step**, such as `record` or `enqueueJobIn`, runs only inside another action's transaction. It is never declared and has no refusal of its own. After an action's first write, anything it calls rejects.

**A refusal word** means one thing wherever it appears.

- Its owning slice declares it once, in a vocabulary that is plain data. Importing a module registers nothing. The shared words (`malformed`, `role-forbids`, `not-found`) are the kernel's (`packages/core/src/kernel/vocabulary.ts`).
- One module composes the catalogue: each owner's vocabulary under the owner's name (`packages/core/src/refusals/index.ts`). Every reader takes the words from it. A transport adds only its own, as the api adds its three (`apps/api/src/refusal.ts`).
- The classes are in `packages/core/src/kernel/refusal.ts`, beside the function that reads a catalogue and throws on a word two owners declare.
- It is classed by remedy: *unauthenticated*, *forbidden*, *absent*, *malformed*, *inapplicable*, *conflict* or *precondition*.
- The catalogue is append-only. A shipped word is never removed and never changes class.
- `packages/core/test/refusal-words.test.ts` holds that every word is declared once, used and classed.

**A refusal crosses each transport as `{ word, class }`**, through that transport's one crossing function. A malformed input adds its `fields`.

**A refusal may name items.** An action that refuses a whole set adds `items`, one word per refused item (`packages/core/src/kernel/refused-items.ts`).

- An item's key is an id the caller sent, or an address's position in the send. It is never an address or a name.
- An item's word states a fact about this workspace alone, and its action lists it among its refusals.
- The set's own word is the first refused item's word in id order. Its class picks the status, and no new word enters the catalogue.
- The items ride the refusal and never a success answer, so a refusal still never crosses as a value.

Each transport:

- Over tRPC it is a thrown error, typed through `AppRouter` (`apps/api/src/trpc/base.ts`). The error carries the items, and the web reads them as plain words.
- MCP has its own (`apps/api/src/mcp/crossing.ts`). It answers the set's word alone and drops the items, since no action that names items is an entry.
- `pnpm ops` maps each class to an exit code (`apps/api/src/ops/index.ts`). A command's refusal is a word, or a word beside the one thing the operator must change. It exits with its word's class. A run that names the file or commit it stopped at is no word. It exits as refused, whatever word it names. Such runs are an import's unsound tree or stopped file, and a reconcile's stopped replay. An import's manifest commit that the git door refuses as malformed is a defect in the import, so it stays an error and exits as refused too. The usage text says both. No command's action names items, so items never reach it.
- A refusal's log line holds its word and class, never an item's id.
- A ceiling is no refusal, since time is its only remedy. An action counting one in its own transaction fails with the kernel's `CeilingMet` (`packages/core/src/kernel/ceiling.ts`), which rolls the count back. tRPC's crossing answers it 429 with `retryAfterSeconds`, as it answers a ceiling met before the action. An invitation or resend email is counted in the action and sent after it commits. The action answers each invitation with the instant it counted at, and core's `returnUnsentEmails` takes only such counted invitations. When the send fails, the api gives the count back to the window it was counted in, never below zero. An approval's email is never counted, so nothing is given back for it. A send reported failed may still have been delivered, and a crash between the commit and the send keeps the count, so the counter never makes room it did not charge. The give-back is the counting step's reversal, not an Admin action, so it writes no audit row.
- Procedures are written by hand, so the call graph stays whole.

**A transport never nests a transaction.** The base procedures:

- A query resolves the member unlocked, in a read-only transaction, so a write anywhere inside it fails at its statement. tRPC sends a query over GET, a method that promises no change, and Postgres holds the promise. A held row needs a read-write transaction, which is why a query's member is read and never held.
- A mutation reads the member `FOR SHARE`.
- An own-transaction procedure resolves the Principal in a short transaction, releases the connection, and hands the action the Principal and its doors.

An MCP entry's transaction opens as the entry's `readOnlyHint` declares: read-only where the entry tells the host it only reads, read-write otherwise (ADR 0030). A read-write entry reads the member `FOR SHARE`, as a mutation does, so a revocation waits on its commit.

An MCP entry may take the own-transaction road instead. The surface resolves the member in a short transaction, releases the connection, and hands the entry fixed steps, never a door. For such an entry, read-only excludes the platform's own account of the call: the record of the question and the spend rows (ADR 0030). `ask` is the first. The road is in the tree, and so is the held member of a read-write entry. On the web, `ask` is a tRPC procedure on the own-transaction road, handed the same fixed steps. Its work runs apart from the stream that reads it. So a reader who leaves ends the model call in flight, and the work still leaves a completed record and settled spend. The stream sends its phase at once, and a keep-alive whenever it has been quiet for 25 seconds, because Cloudflare ends a response that has been quiet for 125.

Every Postgres door rolls back when its work answers a refusal or throws. A principal-scoped door answers its own refusal apart from its work's. An action that wants one union of the two calls `folded` on it. One composition root, `openDoors` in `apps/api/src/doors.ts`, opens the four doors and the Clock (ADR 0040) and states the pool's size.

**Input is parsed once, at the entry**, by the kernel's `parse` (`packages/core/src/kernel/parse.ts`) over a schema the slice owns. Instants cross every wire as ISO-8601 text, with no transformer. The upload is a tRPC mutation over `application/octet-stream`, with its descriptor travelling beside the bytes. It needs no exception to ADR 0006.

## Why

- Four problems were one absence: refusal words were retyped per action, admission was answered in three places, input was stated per transport, and there were three composition roads. Only the audit half of an action was declared.
- Classes sort a word by what its caller can do about it, so they fall one-to-one onto the status taxonomy every transport already has.
- A spike built the constructor and dropped it. For the hand-written `readMember`, the code index answered its callers. For the constructed `narrowConnectedSource`, it answered impacted 0, risk unknown. A code index that answers a lower bound for every action cannot tell anyone what an edit breaks.
- Who owns the transaction differs by action: bytes before rows, and git before rows (ADR 0012). So nothing may own it generically.
- A procedure holding a pooled connection for the whole call made an upload hold two of the pool's ten.
- A door that committed a refused work kept the rows landed before the refusal. When the door folded its own refusal into the work's, a caller could not tell a refused principal from a refused action.
- tRPC 11.18's multipart handler buffers the whole body. Its octet-stream handler streams: the first byte reached `putObject` 3 ms into a 400 ms body.
- An action on a set of people changes everyone or no one, and its refusal has to say which person refused and why. A check read before the write would race another Admin, so the words come from the action's own transaction, on its refusal.

## Rejected

- A constructed action: the code index answers a lower bound for it.
- A constructor that also parses or owns the transaction: ownership differs by action.
- Own-transaction actions each resolving their own Principal: `putObject` and `withRepositoryLock` take one outside any Postgres transaction.
- A refusal as a value on the wire: every read page would branch on it, and a cached web app could do nothing with a word it had never met.
- A check read before a set's write, to name the items it would refuse: another Admin's action can land between the read and the write.
- No classes and a table per transport, or one flat list of words.
- Capability-typed doors with no declared admission, a per-slice manifest a router is generated from, or schemas generated from types.
- A multipart upload, or a plain Hono route: both buffer through `formData()`.
