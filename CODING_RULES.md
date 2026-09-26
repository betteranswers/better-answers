# Coding rules

These rules bind every workspace. A directory's own rules live beside it, in `apps/api/CODING_RULES.md`, `apps/web/CODING_RULES.md`, `apps/worker/CODING_RULES.md` and `deploy/CODING_RULES.md`.

Every rule is an imperative under a tag that a finding can cite. A `Reviewer:` line marks the part of a rule that no mechanism could catch on the way in. It is the only such marker. Where a mechanism is possible but absent, a ticket names it instead. A rule says what it asks for, not which gate catches a breach: the gate prints the tag itself. Why a rule was decided is in `docs/adr/`.

## DESIGN

### [DESIGN1] Design a deep module behind a small interface

A module's interface is everything a caller must know: types, invariants, ordering, error modes, configuration, performance. Keep it small over a large implementation. Apply the deletion test: remove the module. If complexity vanishes, it was a pass-through. If complexity reappears across callers, it earned its place. If you want to test past the interface, the module is the wrong shape, so reshape it.

Reviewer: depth is a judgement of an interface against its implementation, and nothing measures it.

### [DESIGN3] Introduce a seam only where something already varies

One adapter is a hypothetical seam; two is a real one. Take a dependency as a parameter, and return a result rather than producing a side effect.

### [DESIGN4] Refuse a value once, where it enters

Refuse a value in one place: the type at the seam, the boundary schema, or the one check the door makes. A value the boundary refused is never refused again inside that process. A second refusal cannot fire, so a fault in the first stays green under the suite.

- Correct the type so the boundary's refusal reaches the site, or delete the unreachable guard.
- Never disable the lint at the guard.

```ts
// BAD — `refuse` already rejected an unknown role, so this can never fire
const row = refuse(member);
if (!isRole(row.role)) return unknownRole();

// GOOD — `refuse` returns the narrowed row, so the type is the one guard
const row: MembershipRow & { role: Role } = refuse(member);
```

### [DESIGN6] Keep a function's complexity at 8 or under

Each branch, loop, `catch`, `case` and boolean operator adds one to a function's cyclomatic complexity. This holds in both tiers, tests included. Split a function before it passes 8.

### [DESIGN7] Return from a nested loop, never jump out by a label

A labelled `break` or `continue` lands somewhere the reader has to hunt for. Move the inner loop into a function, and return from it.

## TEST

### [TEST1] Test through the interface a caller crosses

- Reach `apps/api` through `server.request(...)`.
- Reach `apps/worker` through the job or module entry point.
- Reach `packages/core` through an entry its `exports` map names.
- Drive `apps/web` as a browser drives the served build. Where a component's own behaviour is under test, render it through Testing Library. Never assert a screen against its source.
- Hand a sibling workspace shared test infrastructure through an entry under the `./testing` name, never a bare path.

### [TEST2] Run every store the platform runs, for real

A test uses the real thing for every store this platform deploys, never a stand-in. Those stores are Postgres, the object store, the git repository and the graph. An in-memory adapter is for a service someone else runs, such as an LLM provider or a SaaS API. It sits behind that service's own adapter.

### [TEST3] Never mock our own code

`vi.mock`, `jest.mock` and a `monkeypatch` aimed at our own modules are banned, whatever the target. A third-party attribute stays patchable.

### [TEST4] Build test state through a factory module

A raw `INSERT` appears inside a factory module and nowhere else. `packages/devtools/src/insert-scan.ts` names the modules that count: a factory, a harness and a probes module, one set per tier. A file does not join that list by sitting beside a suite. A factory hands back what it wrote, so a test never re-reads the row it made.

```python
# BAD — in the test, and the row has to be read back to be asserted on
cursor.execute("INSERT INTO workspace (id, name) VALUES (%s, %s)", (ulid(), "Acme"))

# GOOD — the factory the scan names, handing back what it wrote
workspace = seed_workspace(cursor, name="Acme")
```

### [TEST5] Title a test by what the system does, in 10 words at most

A title is a short present-tense phrase. It says what the system does, not which function it calls: "refuses a name over 100 characters". It has 10 words at most and never says "should". The `describe` block names the unit under test. A Python test's name takes the same shape: `test_refuses_long_name`.

Reviewer: only a person reads a title's subject.

### [TEST6] Triage the nightly mutation summary, never the score

A survivor the summary newly names is a task. A falling score is not a failed build.

### [TEST7] Check a pair in both directions

Assert both ways wherever:

- a list names members;
- a generated artefact mirrors a source;
- a registry names members.

Every entry has its member, and every member its entry. One direction finds the missing, the other the orphan.

### [TEST8] Assert a provoked transaction's outcome before any value

Postgres aborts the transaction whatever the work does with a caught rejection. So a test that swallows a statement failure and asserts a returned value can pin a rolled-back transaction as success. Assert the rejection, or the rows, first.

Reviewer: only a person can see what a test asserts, and in what order.

### [TEST9] Write the expected value down

The expected value is a literal, a worked example or the spec's own figure. It is never the code under test called a second time. Spell a constant the test needs in the test. Read a value too long to spell from a fixture file.

```ts
// BAD — agrees with every implementation, including a wrong one
expect(hashOf(frontmatter)).toBe(hashOf(canonical(frontmatter)));

// GOOD — a digest computed out of band
expect(hashOf(frontmatter)).toBe("b5f1…");
```

Reviewer: no gate can tell an oracle from an expectation. The nightly mutation summary catches the rest after the fact.

## CHECK

### [CHECK1] Land a gate with the test that runs it

A lint rule, a tool in `check` and a hook command each land with a functional test. The test runs the real tool over a throwaway tree. It asserts where the tool fires and where it stays silent. Never assert on its internals. Print the rule's tag in the failure message, so whoever hits it reaches the rule. Every tool named in `check` is a gate, never a report. Its finding is a rule citation, not a matter of taste.

### [CHECK2] Fail a suite that can run nothing

A test script never passes for having found no tests. A focused browser spec fails under CI. pytest refuses a marker it does not know, and an expected failure that passed. Every workspace carries a `check` script, or is named with its reason in `apps/api/tests/check-scripts.test.ts`.

### [CHECK3] Name every failure in one run

A workspace's `check` runs every step it has, even after one fails, and reports them together. `&&` between steps is banned. Each tier has one runner, and a manifest's steps are named in that manifest and nowhere else.

## COMMENT

### [COMMENT1] Comment only the why

Say only what code cannot: a constraint, a trade-off or a trap. Use plain words, 25 at most. Absent is the default. Never:

- restate the code or tell its history;
- cite a ticket, date, ADR or rule tag. The same holds for a string a person reads, tests apart.

A declaration's comment is `/** */`. An exported function in `packages/core`, `packages/schema` or the worker may carry a 50-word doc block saying what its signature cannot.

Reviewer: no tool reads a comment's intent.

### [COMMENT2] Write a rule tag in a rules file, a review finding or a gate's failure message

Write it in those three places and nowhere else, with no document exempt. In source, a test, a document or a deploy file, a tag is a pointer a reader cannot follow. It is also a citation nothing keeps true. Write the rule in words where the reader meets it, or delete the sentence. `apps/api/tests/coding-rules-tags.test.ts` holds the rule over the two places that are files.

### [COMMENT3] Give a directive its reason on the same line

A directive names what it suppresses and gives its reason on the same line. This covers `@ts-expect-error`, an oxlint or ESLint disable, `// Stryker disable`, `# noqa` and `# type: ignore`. The reason counts against the 25-word cap. `@ts-expect-error` is the only TypeScript suppression; `@ts-ignore` is refused. Write no TODO, FIXME or XXX comment: file the ticket instead.

## GLOSSARY

### [GLOSSARY1] Keep `CONTEXT.md` a glossary and nothing else

It holds domain terms, one definition each, and no implementation detail. Code takes the glossary's word, and a missing word is settled in `CONTEXT.md` before code names it.

Reviewer: no scan can tell a definition from an implementation detail. Nor can one tell whether a new identifier took its word from the glossary.

## TYPES

### [TYPES1] Turn `strict` and `noUncheckedIndexedAccess` on

An indexed read is `T | undefined` until the code narrows it.

### [TYPES2] Parse every boundary with zod

Input, environment and tool schemas are parsed where they enter.

### [TYPES3] Choose a type over an enum

`enum` does not compile. `z.enum` takes the `as const` tuple a literal union derives from, never a copy.

### [TYPES4] Never assert a type with `as`

A type assertion is refused in source and test alike; `as const` is not one. Instead, do one of these:

- parse the value with zod where it enters;
- narrow it in control flow;
- state the type at the declaration.

A test feeding a value its type forbids says so with `@ts-expect-error`. An assertion survives only for a library's declaration gap, or a generic the compiler leaves open. The disable's reason says why it is sound.

### [TYPES5] Never mutate a parameter

Return a new value. What a caller passed in is the caller's.

Reviewer: the lint holds an assignment to a parameter or its property; only a person sees a mutating call on one, such as `push` or `Object.assign`.

### [TYPES6] Return an error as a `Result`, and catch only around a library

Wrap an external library's throw through `normalizeError`. No `catch` is empty: a swallowed error carries the reason it is safe to lose.

### [TYPES7] Suffix a money or a time value with its unit

`timeoutMs`, `priceCents`.

### [TYPES8] Import statically

A dynamic `import()` hides a dependency from every tool that reads the graph.

### [TYPES9] Type every public Python signature

mypy runs strict over `src` and `tests`. An untyped signature does not lint, and neither does `Any` in one.

### [TYPES10] Read only the keys a table owns

`in` and `for…in` also see what an object inherits, so a name such as `toString` passes as a key. Test a key with `Object.hasOwn`, or hold the table in a `Map`. Walk a table with `for…of` over `Object.keys` or `Object.entries`.

Reviewer: the lint knows a table only by its upper-case name. It cannot tell a lower-case table from the `in` that narrows a union type.

## LOG

### [LOG1] Log through the tier's one structured logger

pino in TypeScript, structlog in Python: JSON to stdout, one logger per tier. `console.*` and `print` are banned outside scripts. Prompt and completion content never reach the logger, the exporter or a row.

Reviewer: no scan can tell what a logged value holds, on either tier.

## SEC

### [SEC1] Keep a secret to its credential class

A secret belongs to one of the seven credential classes `docs/operations/SECRETS.md` names.

- The bootstrap class is what the deploy unit must give the process before it can reach anything. A config module reads it.
- The other six are rows under the envelope. A credentials provider reaches them; the first slice that needs one builds it.

Never mix classes in one scope, and never log a secret.

Reviewer: this catches a diff that logs a bootstrap value.

### [SEC2] Take a `Principal` as the first parameter

Every `packages/core` function that reads or writes tenant data takes a `Principal` first: workspace, user, role. A transport builds it. Business logic checks the role, the role's action threshold and the read predicate beside the data access. Test the predicate against columns on the readable unit, never against a source binding's fields. Work that outlives a session runs under a deferred or a platform principal, never a live user session.

### [SEC3] Ship a tenant table, a grant or a definer function with the test of what it refuses

Create every tenant table `withRLS()` and ship its zero-rows test. Under forced row-level security and the non-owner runtime role, a policy-less table returns no rows. The graph tables are tenant tables; only the identity set is exempt.

Every privilege a migration installs, default ones included, lands with a test of the path it must **refuse**, beside the one it serves. Such paths are the wrong role, another tenant's scope and a partition reached directly. A partition child is a table of its own, so assert its denial directly, not the parent's.

A definer function:

- guards its arguments against the transaction's scope before any DDL;
- pins its `search_path`;
- schema-qualifies every object;
- has `EXECUTE` revoked from `PUBLIC` and granted to its one caller.

No LLM-authored SQL runs against a shared store.

Reviewer: attack a change to a migration, a grant, a policy or a definer function before it merges. A person does this, not CI. Nothing scans LLM-authored SQL.

### [SEC4] Read the environment in the tier's one config module

No other module in the tier reads it, and no call site does. A suite, a script and this repository's own tooling are outside the rule. A setting that no step in the tier reads yet does not belong in the module. Passing the environment on to a child process is a different matter, and it lives in one named function.

### [SEC5] Run an act's admission before its first `await`

Before an act opens a transaction or reads a row, it judges whether the principal may ask for it. Nothing is then done for a caller it was never going to serve. The judgement is pure and works from:

- the principal's kind;
- a person's role, as a level;
- the purposes a platform principal acts for;
- the parsed input.

It refuses in a word of the forbidden or unauthenticated class. A step takes the principal its act admitted and judges none.

## AUDIT

### [AUDIT1] Write an act and its audit event in one transaction

Every Admin act, governed write and platform act writes its event through the audit slice. It does so in the same transaction as the rows the event describes, so an act whose event cannot be written does not happen. One row per act and target: a bulk act is N rows sharing a batch id, never one hiding N. Call the doors bare. A wrapper that catches the abort hands it back as a value the act might not read.

### [AUDIT2] Name an act `family.subject.verb`, and declare it

The four families are the one closed list: people, knowledge, sources, platform. Each slice declares its acts against the template type the audit slice exports. The doors accept a declared act and nothing else. The subject is what was acted on, and the verb what happened: `people.member.role_changed`, `sources.binding.published`.

### [AUDIT3] Derive the actor as an `ActorId`

The row's actor is the kernel's `ActorId`, derived from the Principal by the kernel's one function. It is never composed by hand, and never an email, a display name or a session. A concept file keeps `human:<email>` in `generated.by` and `verified[].by`. The two forms differ by decision, which is why erasure rewrites files and never the audit log.

### [AUDIT4] Audit a platform or a deferred act under its own actor

Work that outlives a session names the actor the kernel derives from its principal, never a person's session. For the platform, that is its own actor id. The audit slice has two doors and no third:

- one derives the actor from the caller's Principal;
- the other takes the platform principal and an explicit actor, and refuses a user principal.

### [AUDIT5] Carry ids and role words in the detail

The structured detail names a record by its id, and a role by its word: Admin, Editor, Viewer. It carries an act's confirmations as typed fields. It never carries an email, a display name, a prompt or a completion. An audit log holding one would need rewriting on erasure, and the audit log is never rewritten.

### [AUDIT6] Keep the audit log append-only in the database

The migration that creates `audit_event` or `identity_audit_event` revokes `UPDATE` and `DELETE` from the api's role, and grants the worker's role nothing. Each refusal is tested beside the path it serves.

### [AUDIT7] Mint the row's id before the write

The writer mints a ULID through the kernel minter, and the column has no database default. So a governed write mints its id before its git commit, and an audit event and a commit join on one id.

### [AUDIT8] Keep a read, a run and a health check out of the audit log

A read writes no row, unless a decision names the view an act. An event with no workspace, like a token issued or a workspace pick, is a log line, unless declared for the identity-set audit log, as a sign-in is. A consent lands in its workspace's. Both land after the library's commit: a failed row is a log line, never a refusal. Runs, the answer audit, signals, alerts, spend, backup runs and health checks are their own records.

## OKF

### [OKF2] Keep a concept file spec-pure

A concept file carries what OKF v0.2 defines, plus two platform keys: `iri` and `sources[].locator`. What the spec leaves open is met in the graph and records: supersession, conflicting claims, typed relations, access. A new key needs a decision record. It argues the key against the bundle-alone test in `docs/okf-v02.md`, and says why neither can carry it.

Reviewer: the schema is open, so a foreign file round-trips. Only a person holds a diff to the two platform keys.

## DEPS

### [DEPS1] Pin a version from its source, never from memory

Read every dependency, image, extension and tool version from the vendor's own release page, or from Context7. Read it at the time of the change, and say in the pull request where you read it. A Renovate pull request is a source when it names the release page it read.

### [DEPS2] Export a pinned value as one constant

Every pinned value is one exported constant in the package that owns the decision. Every TypeScript consumer imports it. A tier that cannot import reads the constant's source, and refuses more than one match. A copy is a second pin that ages alone.
