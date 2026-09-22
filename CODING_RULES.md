# Coding rules

These rules bind every workspace. A directory's own rules live beside it, in `apps/api/CODING_RULES.md`, `apps/web/CODING_RULES.md`, `apps/worker/CODING_RULES.md` and `deploy/CODING_RULES.md`.

Every rule is an imperative under a tag a finding can cite. A `Reviewer:` line marks the part of a rule no mechanism could catch on the way in, and it is the only such marker; where a mechanism is possible and absent, a ticket names it instead. A rule states what it asks for and not which gate catches a breach, the gate printing the tag itself. Why a rule was decided is in `docs/adr/`.

## DESIGN

### [DESIGN1] Design a deep module behind a small interface

A module's interface is everything a caller must know: types, invariants, ordering, error modes, configuration, performance. Keep that small over a large implementation. Apply the deletion test — remove the module; if complexity vanishes it was a pass-through, and if it reappears across callers it earned its place. Wanting to test past the interface means the module is the wrong shape: reshape it.

Reviewer: depth is a judgement about an interface against its implementation; nothing measures it.

### [DESIGN3] Introduce a seam only where something already varies

One adapter is a hypothetical seam; two is a real one. Take a dependency as a parameter, and return a result rather than producing a side effect.

### [DESIGN4] Refuse a value once, where it enters

A value is refused by the type at the seam, the boundary schema, or the one check the door makes — and a value the boundary refused is never refused again inside that process. A second refusal cannot fire, so a fault in the first stays green under the suite. Correct the type so the boundary's refusal reaches the site, or delete the unreachable guard; never disable the lint there.

```ts
// BAD — `refuse` already rejected an unknown role, so this can never fire
const row = refuse(member);
if (!isRole(row.role)) return unknownRole();

// GOOD — `refuse` returns the narrowed row, so the type is the one guard
const row: MembershipRow & { role: Role } = refuse(member);
```

## TEST

### [TEST1] Test through the interface a caller crosses

Reach `apps/api` through `server.request(...)`, `apps/worker` through the job or module entry point, and `packages/core` through an entry its `exports` map names. Drive `apps/web` as a browser drives the served build, or render a component through Testing Library where its own behaviour is under test; never assert a screen against its source. Hand a sibling workspace shared test infrastructure through an entry under the `./testing` name, never a bare path.

### [TEST2] Run every store the platform runs, for real

Every store this platform deploys is the real thing in a test, never a stand-in: Postgres, the object store, the git repository, the graph. An in-memory adapter is for a service someone else runs — an LLM provider, a SaaS API — behind that service's own adapter.

### [TEST3] Never mock our own code

`vi.mock`, `jest.mock` and a `monkeypatch` aimed at our own modules are banned whatever the target. A third-party attribute stays patchable.

### [TEST4] Build test state through a factory module

A raw `INSERT` appears inside a factory module and nowhere else, and `packages/devtools/src/insert-scan.ts` names the ones that count — a factory, a harness, a probes module, one set per tier. A file does not join that list by sitting beside a suite. A factory hands back what it wrote, so a test never re-reads the row it made.

```python
# BAD — in the test, and the row has to be read back to be asserted on
cursor.execute("INSERT INTO workspace (id, name) VALUES (%s, %s)", (ulid(), "Acme"))

# GOOD — the factory the scan names, handing back what it wrote
workspace = seed_workspace(cursor, name="Acme")
```

### [TEST5] Title a test by the behaviour it proves

A title says what the system does, and for whom, rather than which function it calls.

Reviewer: a title's subject is prose, and nothing but a person reads it.

### [TEST6] Triage the nightly mutation summary, never the score

A survivor the summary newly names is a task; a falling score is not a failed build.

### [TEST7] Check a pair in both directions

Where a list names members, a generated artefact mirrors a source or a registry names them, assert both ways: every entry has its member, and every member its entry. One direction finds the missing, the other the orphan.

### [TEST8] Assert a provoked transaction's outcome before any value

Postgres aborts the transaction whatever the work does with a caught rejection, so a test that swallows a statement failure and asserts a returned value can pin a rolled-back transaction as success. Assert the rejection, or the rows, first.

Reviewer: what a test asserts, and in what order, nothing but a person can see.

### [TEST9] Write the expected value down

The expected value is a literal, a worked example or the spec's own figure — never the code under test called a second time. Spell a constant the test needs in the test; read a value too long to spell from a fixture file.

```ts
// BAD — agrees with every implementation, including a wrong one
expect(hashOf(frontmatter)).toBe(hashOf(canonical(frontmatter)));

// GOOD — a digest computed out of band
expect(hashOf(frontmatter)).toBe("b5f1…");
```

Reviewer: no gate can tell an oracle from an expectation; the nightly mutation summary catches the rest after the fact.

## CHECK

### [CHECK1] Land a gate with the test that runs it

A lint rule, a tool in `check` and a hook command each land with a functional test that runs the real tool over a throwaway tree, asserting where it fires and where it stays silent. Never assert on its internals. Print the rule's tag in the failure message, so a reader who hits it reaches the rule. Every tool named in `check` is a gate and never a report: its finding is a rule citation, not a matter of taste.

### [CHECK2] Fail a suite that can run nothing

A test script never passes for having found no tests, and a focused browser spec fails under CI. pytest refuses a marker it does not know and an expected failure that passed. Every workspace carries a `check` script, or is named with its reason in `apps/api/tests/check-scripts.test.ts`.

### [CHECK3] Name every failure in one run

A workspace's `check` runs every step it has even after one fails, and reports them together; `&&` between steps is banned. Each tier has one runner, and a manifest's steps are named in that manifest and nowhere else.

## COMMENT

### [COMMENT1] Comment only the why

A comment gives a reason the code cannot: a constraint, a trade-off, a gotcha. It never says what the code does or did, or which ticket, decision or rule asked for it. A string a person reads cites nothing either, tests apart. Absent is the default; a file opens with code. A directive, a notice and a copy-detection fence sit outside.

Reviewer: nothing reads a comment's intent, so a restatement or a narration is a person's to remove.

### [COMMENT2] Write a rule tag in a rules file, a review finding or a gate's failure message

Those three places and nowhere else, bar the frozen list in `apps/api/tests/coding-rules-tags.test.ts` — the documents that cited a rule before this one, and it only shrinks. A tag in source, a test, a document or a deploy file is a pointer a reader cannot follow and a citation nothing keeps true: write the rule in words where the reader meets it, or delete the sentence.

## GLOSSARY

### [GLOSSARY1] Keep `CONTEXT.md` a glossary and nothing else

Domain terms, one definition each, no implementation detail. Code takes the glossary's word; a missing word is settled in `CONTEXT.md` before code names it.

Reviewer: no scan can tell a definition from an implementation detail, nor whether a new identifier took its word from the glossary.

## TYPES

### [TYPES1] Turn `strict` and `noUncheckedIndexedAccess` on

An indexed read is `T | undefined` until the code narrows it.

### [TYPES2] Parse every boundary with zod

Input, environment and tool schemas are parsed where they enter.

### [TYPES3] Choose a type over an enum

An `enum` does not compile here. A union of string literals says the same thing and erases.

### [TYPES4] Never assert a type with `as`

A type assertion is refused in source and test alike; `as const` is not one. Parse the value with zod where it enters, narrow it in control flow, or state the type at the declaration. A test feeding a value its type forbids says so with `@ts-expect-error`. One survives only for a library's declaration gap or a generic the compiler leaves open, the comment saying why it is sound beside the disable.

### [TYPES5] Never mutate a parameter

Return a new value. What a caller passed in is the caller's.

### [TYPES6] Return an error as a `Result`, and catch only around a library

Wrap an external library's throw through `normalizeError`. No `catch` is empty: a swallowed error carries the reason it is safe to lose.

### [TYPES7] Suffix a money or a time value with its unit

`timeoutMs`, `priceCents`.

### [TYPES8] Import statically

A dynamic `import()` hides a dependency from every tool that reads the graph.

### [TYPES9] Type every public Python signature

mypy runs strict over `src` and `tests`. An untyped signature does not lint, and neither does `Any` in one.

## LOG

### [LOG1] Log through the tier's one structured logger

pino in TypeScript, structlog in Python, JSON to stdout, one logger per tier. `console.*` and `print` are banned outside scripts. Prompt and completion content never reach the logger, the exporter or a row.

Reviewer: no scan can tell what a logged value holds, on either tier.

## SEC

### [SEC1] Keep a secret to its credential class

A secret belongs to one of the seven credential classes `docs/operations/SECRETS.md` names. The bootstrap class — what the deploy unit must give the process before it can reach anything — is what a config module reads; the other six are rows under the envelope, reached through a credentials provider the first slice needing one builds. Classes are never mixed in one scope, and a secret is never logged.

Reviewer: a diff that logs a bootstrap value is what this catches.

### [SEC2] Take a `Principal` as the first parameter

Every `packages/core` function that reads or writes tenant data takes a `Principal` — workspace, user, role — first. A transport builds it; business logic checks the role, the role's action threshold and the read predicate beside the data access. Test the predicate against columns on the readable unit, never against a source binding's fields. Work that outlives a session runs under a deferred or a platform principal, never a live user session.

### [SEC3] Ship a tenant table, a grant or a definer function with the test of what it refuses

Create every tenant table `withRLS()` and ship its zero-rows test: under forced row-level security and the non-owner runtime role, a policy-less table returns no rows. The graph tables are tenant tables too, the identity set the one named exemption. Every privilege a migration installs, a default privilege among them, lands with a test of the path it must **refuse** beside the one it serves: the wrong role, another tenant's scope, a partition reached directly. A partition child is a table of its own: assert its denial directly, not the parent's. A definer function guards its arguments against the transaction's scope before any DDL, pins its `search_path`, schema-qualifies every object, and has `EXECUTE` revoked from `PUBLIC` and granted to its one caller. No LLM-authored SQL runs against a shared store.

Reviewer: attack a change to a migration, a grant, a policy or a definer function before it merges — a person's pass, no CI step; nothing scans LLM-authored SQL.

### [SEC4] Read the environment in the tier's one config module

No other module in the tier reads it, and never at a call site; a suite, a script and this repository's own tooling are outside the rule. A setting no step in the tier reads yet does not belong in the module. Passing the environment on to a child process is a different act, and it lives in one named function.

### [SEC5] Run an act's admission before its first `await`

An act judges whether a principal may ask for it before it opens a transaction or reads a row, so nothing is done for a caller it was never going to serve. The judgement is pure — the principal's kind, a person's role as a level, the purposes a platform principal acts for, the parsed input — and refuses in a word of the forbidden or unauthenticated class. A step takes the principal its act admitted and judges none.

## AUDIT

### [AUDIT1] Write an act and its audit event in one transaction

Every Admin act, governed write and platform act writes its event through the audit slice in the same transaction as the rows it describes, so an act whose event cannot be written does not happen. One row per act and target: a bulk act is N rows sharing a batch id, never one hiding N. Call the doors bare — a wrapper that catches the abort hands it back as a value the act might not read.

### [AUDIT2] Name an act `family.subject.verb`, and declare it

The four families — people, knowledge, sources, platform — are the one closed list. Each slice declares its acts against the template type the audit slice exports, and the doors accept a declared act and nothing else. The subject is what was acted on, the verb what happened: `people.member.role_changed`, `sources.binding.published`.

### [AUDIT3] Derive the actor as an `ActorId`

The row's actor is the kernel's `ActorId`, derived from the Principal by the kernel's one function — never composed by hand, never an email, a display name or a session. A concept file keeps `human:<email>` in `generated.by` and `verified[].by`: the two forms differ by decision, which is why erasure rewrites files and never the ledger.

### [AUDIT4] Audit a platform or a deferred act under its own actor

Work that outlives a session names the actor the kernel derives from its principal — for the platform, its own actor id — never a person's session. The audit slice has two doors and no third: one derives the actor from the caller's Principal, the other takes the platform principal and an explicit actor, refusing a user principal.

### [AUDIT5] Carry ids and role words in the detail

The structured detail names a record by its id and a role by its word — Admin, Editor, Viewer — and carries an act's confirmations as typed fields. It never carries an email, a display name, a prompt or a completion: a ledger holding one would need rewriting on erasure, and the ledger is never rewritten.

### [AUDIT6] Keep the ledger append-only in the database

The migration that creates `audit_event` revokes `UPDATE` and `DELETE` from the app's role and grants the worker's role nothing, each refusal tested beside the path it serves.

### [AUDIT7] Mint the row's id before the write

The writer mints a ULID through the kernel minter and the column has no database default, so a governed write mints its id before its git commit: a ledger row and a commit join on one id.

### [AUDIT8] Keep a read, a run and a health check out of the ledger

A read writes no row, unless a decision names the view an act. An event with no workspace — a sign-in, a token issued or refused — is a log line, the ledger being a tenant table. Runs, the answer audit, signals, alerts, spend, backup runs and health checks are their own records.

## OKF

### [OKF2] Keep a concept file spec-pure

A concept file carries what OKF v0.2 defines plus two platform keys: `iri` and `sources[].locator`. What the spec leaves open — supersession, conflicting claims, typed relations, access — is met in the graph and in records. A new key needs a decision record that argues it against the bundle-alone test in `docs/okf-v02.md`, and why neither can carry it.

Reviewer: the schema is open so a foreign file round-trips; nothing refuses a key, and two is the count a diff is held to.

## DEPS

### [DEPS1] Pin a version from its source, never from memory

Every dependency, image, extension and tool version is read from the vendor's own release page, or from Context7, at the time of the change, and the pull request names where. A Renovate pull request is a source when it names the release page it read.

### [DEPS2] Export a pinned value as one constant

Every pinned value is one exported constant in the package that owns the decision. Every TypeScript consumer imports it; a tier that cannot import reads the constant's source and refuses more than one match. A copy is a second pin that ages alone.
