---
title: "An act admits before its first await and refuses in classed words across every transport"
date: 2026-09-24
module: packages/core
problem_type: architecture_pattern
component: kernel
severity: high
applies_when:
  - "Adding an act to a slice in packages/core, or exposing one through tRPC, MCP or ops"
  - "Adding a refusal word, or mapping refusals onto a transport's errors"
  - "Writing a base procedure, a Postgres door or anything else that opens a transaction"
  - "Parsing an entry's input, or sending instants or bytes across a wire"
tags:
  - adr-0043
  - act
  - step
  - refusal
  - admission
  - crossing
  - audit-act
---

# An act admits before its first await and refuses in classed words across every transport

## The decision

**An act** is what an entry may ask core to do. The entries are a tRPC procedure, an MCP entry, an ops command and the tick. An act is a read or a write, and it answers a `Result`.

- It is declared beside its hand-written face function.
- The face function admits before its first `await`. The lint rule `act-admits-before-await` holds it (`packages/devtools/lint-rules/rules/act-admits-before-await.ts`).
- There is no act constructor: a constructed act left GitNexus answering a lower bound.
- The name an audit event is recorded under is its *audit act*.

**A step** runs only inside another act's transaction, such as `record` or `enqueueJobIn`. It is never declared and has no refusal of its own. After an act's first write, anything it calls rejects.

**A refusal word** means one thing wherever it appears.

- Its owning slice declares it once, and it is registered globally. The shared words (`malformed`, `role-forbids`, `not-found`) are the kernel's (`packages/core/src/kernel/vocabulary.ts`). The classes and the register are in `packages/core/src/kernel/refusal.ts`.
- It is classed by remedy: *unauthenticated*, *forbidden*, *absent*, *malformed*, *inapplicable*, *conflict* or *precondition*.
- The register is append-only. A shipped word is never removed and never changes class.
- `packages/core/test/refusal-words.test.ts` holds that every word is declared once, used and classed.

**A refusal crosses each transport as `{ word, class }`**, through that transport's one crossing function. A malformed input adds its `fields`.

**A refusal may name items.** An act that refuses a whole set adds `items`, one word per refused item (`packages/core/src/kernel/refused-items.ts`).

- An item's key is an id the caller sent, or an address's position in the send. It is never an address or a name.
- An item's word states a fact about this workspace alone, and its act lists it among its refusals.
- The set's own word is the first refused item's word in id order. Its class picks the status, and no new word enters the register.
- The items ride the refusal and never a success answer, so a refusal still never crosses as a value.

Each transport:

- Over tRPC it is a thrown error, typed through `AppRouter` (`apps/api/src/trpc/base.ts`). The error carries the items, and the web reads them as plain words.
- MCP has its own (`apps/api/src/mcp/crossing.ts`). It answers the set's word alone and drops the items, since no act that names items is an entry.
- `pnpm ops` maps each class to an exit code (`apps/api/src/ops/index.ts`). A command's refusal is a word, or a word beside the one thing the operator must change, such as the address the test workspace's fixture refused, and it exits with its word's class. An import's refusal that names the file it stopped at is no word, and exits as refused. No command's act names items, so items never reach it.
- A refusal's log line holds its word and class, never an item's id.
- A ceiling is no refusal, since time is its only remedy. An act counting one in its own transaction fails with the kernel's `CeilingMet` (`packages/core/src/kernel/ceiling.ts`), which rolls the count back. tRPC's crossing answers it 429 with `retryAfterSeconds`, as a ceiling met before the act does.
- Procedures are written by hand, so the call graph stays whole.

**A transport never nests a transaction.** The base procedures:

- A query resolves the member unlocked.
- A mutation reads the member `FOR SHARE`.
- An own-transaction procedure resolves the Principal in a short transaction, releases the connection, and hands the act the Principal and its doors.

Every Postgres door rolls back when its work answers a refusal or throws. A principal-scoped door answers its own refusal apart from its work's, and an act that wants one union calls `folded` on it. One composition root, `openDoors` in `apps/api/src/doors.ts`, opens the four doors and the Clock (ADR 0040) and states the pool's size.

**Input is parsed once, at the entry**, by the kernel's `parse` (`packages/core/src/kernel/parse.ts`) over a schema the slice owns. Instants cross every wire as ISO-8601 text, with no transformer. The upload is a tRPC mutation over `application/octet-stream`, its descriptor travelling beside the bytes, with no exception to ADR 0006.

## Why

- Refusal words retyped per act, admission answered in three places, input stated per transport and three composition roads were one absence. Only the audit half of an act was declared.
- Classes sort a word by what its caller can do about it, so they fall one-to-one onto the status taxonomy every transport already has.
- A spike built the constructor and dropped it. The hand-written `readMember` answered its callers; the constructed `narrowConnectedSource` answered impacted 0, risk unknown. A code index that answers a lower bound for every act cannot tell anyone what an edit breaks.
- Transaction ownership differs by act, bytes before rows and git before rows (ADR 0012), so nothing may own it generically.
- A procedure holding a pooled connection for the whole call made an upload hold two of the pool's ten.
- A door that committed a refused work kept the rows landed before the refusal. When the door folded its own refusal into the work's, a caller could not tell a refused principal from a refused act.
- tRPC 11.18's multipart handler buffers the whole body. Its octet-stream handler streams: the first byte reached `putObject` 3 ms into a 400 ms body.
- An act on a set of people changes everyone or no one, and its refusal has to say which person refused and why. A check read before the write would race another Admin, so the words come from the act's own transaction, on its refusal.

## Rejected

- A constructed act: the code index answers a lower bound for it.
- A constructor that also parses or owns the transaction: ownership differs by act.
- Own-transaction acts each resolving their own Principal: `putObject` and `withRepositoryLock` take one outside any Postgres transaction.
- A refusal as a value on the wire: every read page would branch on it, and a cached web app could do nothing with a word it had never met.
- A check read before a set's write, to name the items it would refuse: another Admin's act can land between the read and the write.
- No classes and a table per transport, or one flat list of words.
- Capability-typed doors with no declared admission, a per-slice manifest a router is generated from, or schemas generated from types.
- A multipart upload, or a plain Hono route: both buffer through `formData()`.

## History

The full record, with its four amendments (T-232, T-230, T-338, the T-027 and T-028 grill): `docs/archive/adr/0043-what-an-act-is.md`.

A refusal naming items came with the people layout rework (`docs/plans/2026-10-01-1807-feat-people-layout-rework-plan.md`, KTD1), and a ceiling counted inside an act with its invitations (KTD11).
