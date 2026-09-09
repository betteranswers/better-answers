# Core survivor delta — the nine unwalked modules, and the two doors re-anchored

The anchor run is **[34323778136](https://github.com/betteranswers/better-answers/actions/runs/34323778136)**
(`stryker-core`, 2026-09-09): **299 live of 3,574 mutants, 91.63%**. Every live row is a
`Survived` or `NoCoverage` row with a nonzero `testsCompleted` — **no row in this report has
`testsCompleted: 0`**, so the vitest-runner patch (T-107) is holding and there is nothing to
list under a runner-fault heading.

Read `docs/research/t-009-survivor-triage.md` for the standing verdicts and
`docs/research/t-009-survivor-delta.md` for what moved before this. This document is two
things: a **full triage** of the nine modules that landed with T-055–T-059 and have never
been walked, and a **re-anchor** of every other file with a live row against the verdict the
triage already holds for it.

Verdict vocabulary is the triage's, unchanged: **must-kill** — the mutation changes
observable behaviour at a seam that matters, and the missing test is a real gap.
**worth-killing** — real behaviour, lower stakes; kill it when touching the area.
**noise** — cosmetic. **equivalent** — cannot change observable behaviour. Equivalence is
labelled by class throughout, as `docs/agents/mutation-triage.md` requires: **[proof]** is
*behaviourally identical, argued from the code*; **[no seam]** is *nothing observable at this
seam* — the two functions differ and no caller, driver or fixture in this tree can reach the
difference. A `[no seam]` row is never a reason to write a bespoke fixture.

Every row below was anchored to the byte range its `location` names in the tree at `HEAD`
(`9940959`) before a verdict was written, so no verdict here rests on a line number.

Two method notes, because between them they moved a dozen verdicts while this was being
written — every one from must-kill towards equivalent, which is the direction the retro says
to distrust, so each is spelled out where it lands.

**Read the *killed* rows on the same expression, not only the surviving ones.** A cluster
where the whole condition dies both ways and only its operands survive is a *redundant
guard* whose rule is already driven, not an untested rule. That is what `guides/index.ts:57`
turned out to be, and what `git/index.ts:278` turned out to be once T-105's candidate table
was read beside it.

**Name the input that would kill each row before writing "must-kill".** Four of the eight
survivors on `landing.ts:178-179` only ever make the cascade run *more*, which no test can
hold; `reconciler.ts:311:35` and `file.ts:213`'s `$` are each refused one step later by the
same word; and `file.ts:225`'s emptied `catch` returns the same implicit `undefined` the
`return` did. A row nothing can distinguish is not a gap however much the branch deserves a
test.

---

## Headline

### Part 1 — the nine unwalked modules (126 live)

The brief said 124; the nine files hold **126**.

| verdict | rows |
| --- | ---: |
| must-kill | 43 |
| worth-killing | 42 |
| equivalent | 41 |
| noise | 0 |
| **total** | **126** |

| file | live | must-kill | worth-killing | equivalent |
| --- | ---: | ---: | ---: | ---: |
| `src/concepts/reconciler.ts` | 42 | 22 | 11 | 9 |
| `src/concepts/file.ts` | 30 | 7 | 6 | 17 |
| `src/runs/index.ts` | 14 | 8 | 6 | 0 |
| `src/concepts/landing.ts` | 12 | 4 | 1 | 7 |
| `src/concepts/visibility.ts` | 10 | 2 | 7 | 1 |
| `src/guides/index.ts` | 7 | 0 | 3 | 4 |
| `src/concepts/inbox.ts` | 5 | 0 | 2 | 3 |
| `src/sources/index.ts` | 4 | 0 | 4 | 0 |
| `src/concepts/graph-maintenance.ts` | 2 | 0 | 2 | 0 |

### Part 2 — the re-anchor (173 live)

| classification | rows |
| --- | ---: |
| standing verdict, still describes the code | 83 |
| standing verdict **reclassified** — the verdict described the mutant, or the code moved under it | 14 |
| fresh — landed since the triage, triaged here | 76 |
| **regression** — a row the triage recorded as killed or settled that is live again | **0** |

| file | live | standing | reclassified | fresh |
| --- | ---: | ---: | ---: | ---: |
| `src/store/git/index.ts` | 56 | 5 | 9 | 42 |
| `src/store/graph/index.ts` | 47 | 24 | 0 | 23 |
| `src/answering/index.ts` | 27 | 22 | 5 | 0 |
| `src/concepts/index.ts` | 20 | 20 | 0 | 0 |
| `src/access/index.ts` | 5 | 0 | 0 | 5 |
| `src/members/*.ts` | 5 | 3 | 0 | 2 |
| `src/kernel/constraint.ts` | 4 | 4 | 0 | 0 |
| `src/store/postgres/index.ts` | 4 | 3 | 0 | 1 |
| `src/audit/*.ts` | 2 | 1 | 0 | 1 |
| `src/workspaces/index.ts` | 2 | 1 | 0 | 1 |
| `src/kernel/actor.ts` | 1 | 0 | 0 | 1 |

**No regressions.** Every row the triage or T-103 recorded as killed, settled or reclassified
is either still absent from the live set or is a *different* row at the same expression. The
git door's `..`/`.`/empty-segment cluster, its `malformed-path` refusal, its
`GIT_INDEX_FILE`/`read-tree` rows, its trailer tuples and the whole of its `catch` block —
the triage's biggest must-kill block — are **all killed** in this run; T-105's path tests and
the reconciler's own suite closed them.

The fourteen reclassifications are the retro's lesson landing again: nine git-door rows whose
triage verdict described the **mutant** (`stdin?.end` "removes the call" — it does not), or an
`isBundlePath` clause a sibling clause already makes, or the lock registry's leak, which has
no functional seam to hold it; and five `answering` rows whose equivalence T-086 wrote into
the source as a comment after the triage was written. Every reclassification moves a row from
must-kill towards equivalent, which is the direction the retro says to be suspicious of — so
each names the input that would kill it, or says why no input can.

---

## Untested branches (from the NoCoverage clusters)

36 rows are `NoCoverage`: the statement was never executed by any test at all. They cluster
into nine branches, and each is one sentence of behaviour nothing drives.

1. **A commit the governed write did not make, refused at the trailers**
   (`reconciler.ts:158:93`, `311:67`, `332:41`). No test replays a commit whose `Actor:` or
   `Audit:` trailer is missing or malformed, whose file carries neither a `type` nor a held
   kind, or whose row the boundary refuses. The one `unreadable-commit` test commits a file
   outside the renderer's grammar, which fails one guard earlier, at `parseConceptFile`.
2. **A replayed creation whose derived merge key another concept holds**
   (`reconciler.ts:202:34`, two rows). The IRI fallback the docblock promises — "the restore
   path lands rather than stopping on two concepts sharing a title" — has never run.
3. **A replayed file that names no `type` or `title`** (`reconciler.ts:309:61`, `310:63`).
   The fall-back to the held row's kind and title is unreachable from a governed commit and
   nothing forges one.
4. **A bundle with no commits and a recorded watermark** (`git/index.ts:467:77`). ADR 0012's
   `history-diverged` for a database restored ahead of a repository that was not.
5. **A commit whose last paragraph is not all trailers** (`git/index.ts:516:11`), and a git
   root that exists as a **file** (`git/index.ts:69:51`).
6. **The queue's boundary refusal** (`runs/index.ts:240:35`). `enqueueJob`'s `malformed` for
   a kind or a reason the row would reject — refused, the docblock says, "where the caller
   can be told rather than by an aborted transaction" — is never told to a caller.
7. **A frontmatter value that is not JSON** (`file.ts:225:11`). `scalarOf`'s `catch` — the
   grammar's refusal of an unquoted value — is never entered; every malformed fixture fails
   an earlier guard. Worth a fixture, though no mutant on that line can hold it: emptying the
   `catch` leaves the same implicit `undefined`.
8. **A malformed source entry in a view** (`answering/index.ts:369:37`, `429:83`), and the
   two throws that stand for store integrity: the inbox's actor-shape guard
   (`inbox.ts:119:42`) and the optimistic-lock loss (`inbox.ts:437:40`, `438:27`), the
   audience/group disagreement (`access/index.ts:249:33`, `250:21`) and the ledger's
   "landed no row" (`audit/index.ts:177:41`).
9. **Type-only fallbacks that cannot fire** — `file.ts:259:38/260:34/276:41/311:38`,
   `git/index.ts:510:59/530:15/530:29`, `graph/index.ts:221:51/255:47/257:43/278:78/313:37/329:57/330:49/570:46`,
   `members/requests.ts:354:39`. Every one is a `?? ""` or a destructuring default that
   `noUncheckedIndexedAccess` demands and the runtime can never reach; T-103 settled the
   graph and audit ones by writing the proof into the source, and the same treatment fits
   the rest. These are **not** gaps.

---

## Platform findings

**A. ADR 0012 stop conditions with no test.** `reconcile` names four `ReplayRefusal`s and
`commitsAfter` one `ReconcileRefusal`. Three of the five are driven: `path-taken`,
`rename-refused`, and `unreadable-commit` *by way of a file outside the grammar*. The rest
are not. Nothing drives `unreadable-commit` from a missing or malformed trailer
(`reconciler.ts:158`), from a commit that changed no file or more than one
(`reconciler.ts:161`, and the door's own `readCommit` at `git/index.ts:552`, `556`), from a
file whose frontmatter carries no `iri` (`reconciler.ts:165`), from a file naming neither a
`type` nor a held kind (`reconciler.ts:311`), or from a row the boundary refuses
(`reconciler.ts:332`); and nothing drives `history-diverged` for a headless bundle with a
watermark (`git/index.ts:467`). ADR 0012's rule is *report and never skip*; the report side
of five stop conditions is unproved.

**B. A commit the index refuses that is not proved refused.** The `path-taken` stop is
tested. Its sibling — a replayed **creation** whose derived merge key another concept
already holds — has never run (`reconciler.ts:202`, NoCoverage). The docblock promises the
restore path lands on the IRI rather than stopping; nothing proves it, and the row it would
insert is the one `merge-key-taken` names.

**C. A run that finds nothing to do is not proved to stop nowhere.**
`commitsAfter` filters `rev-list`'s output for the empty string, and with the filter gone an
up-to-date bundle's `missed` is `[""]`, so the run stops at a commit that is not one. Three
`git/index.ts:482` mutants survive: the "rows are up to date" test asserts `replayed: []`
and never `stopped: undefined`.

**D. The trailer reader's forgery guards are undriven.** `trailersOf`'s docblock promises the
reader "takes the last paragraph and never the first match". Every commit the door writes has
exactly two paragraphs, where `.at(-1)` and `.at(1)` are the same element, so
`git/index.ts:510:52` survives; `TRAILER_LINE`'s `^` anchor survives (`500:22`), so a
trailer-shaped fragment inside the last paragraph would be read as a trailer; and a
non-trailer line in the last paragraph would make the reader **throw** rather than skip
(`514:14`, five rows). This is the one place a hand-forged commit meets a parser, and the
parser's promises are all untested.

**E. The visibility cascade is only ever driven by a `sensitivity` move.** In
`landing.ts:176-179`, every mutant of the `sensitivity` comparison dies and **every mutant of
the `audience` and `audienceGroups` comparisons survives** — four of them making
`sameVisibility` answer *the same* when the audience word or the group list moved, which skips
`recomputeCompositionsIncluding` entirely and leaves a guide page wider than what it includes.
ADR 0039's audience rule and ADR 0023's two-level cascade have no test at this seam: no
re-write moves only the audience and then reads a composition that includes it.

**F. One half of the crash-window rule is driven and the other is not.**
`guides/index.ts:57` states that "an include whose concept has no index row counts as
Restricted, never as absent". Reading the *killed* rows on those lines settles that the rule
is driven: forcing the condition either way and inverting either `=== null` all die, so a
composition including a row-less concept is in the suite. Its three survivors are only the
redundancy between two columns a `LEFT JOIN` nulls together — see finding I. The concept half
of the same state (`visibility.ts:295`, finding K) is **not** driven, and that asymmetry is
the gap.

**G. `JOB_IS_OVER` is asserted only negatively.** `runs/index.ts:133` is the terminal-status
list `apps/api`'s `--wait` poll loops on. Core's only assertion is
`expect(JOB_IS_OVER).not.toContain(...)`, so emptying the array and blanking each of its three
members all survive. This is `[TEST7]`'s shape — a list checked in one direction only — over a
cross-workspace contract, and an emptied list makes `ops --wait` poll until its deadline.

**H. A person's queue act is not proved to re-read its membership.**
`runs/index.ts:161`'s `principal.kind === "platform"` forced true survives, so nothing
distinguishes the platform's `withScope` road from the person's `withMembership` road. The
docblock's whole reason for the branch — "an Admin demoted between the call and the write does
not get their job" — is undriven, as is the refusal it produces (`166:7`).

**I. Guards that cannot fire, kept for a type.** Each of these is fully masked by a sibling
runtime check, which is exactly the `[SHALLOW]` detector `CODING_RULES.md` describes — "a
mutant that survives inside a guard is a guard something else already made". None is a gap;
each is a candidate for a comment, in the shape T-103 used, or for removal:
- `git/index.ts:278-279` — `candidate.length > 0` and `!candidate.startsWith("/")` are both
  implied by the empty-segment clause at `288`: `""`, `"/a"` and `"a/"` all split to a segment
  that is `""`. Four of the five surviving rows are that redundancy.
- `file.ts:238` — `pairOf`'s `match === null || typeof key !== "string"` is one condition
  written twice: a non-null match's group 1 is a quoted JSON string, so `key` is a string
  exactly when `match` is non-null.
- `reconciler.ts:306` — `facts.suggestionId === undefined` is masked by the sibling
  `payload === undefined`, since `payload` is literally `undefined` whenever the id is.
- `reconciler.ts:326` — `status: stringIn(facts.frontmatter, "status")` is a second reading of
  a key `indexRowOf` reads itself (`landing.ts:232`); blanking the argument changes nothing.
- `graph/index.ts:318` — the external-scheme guard is masked by `resolvedResource`, which
  returns a scheme'd or `//` target unchanged, so the `.slice(1)` form can never be a bundle
  path (`isBundlePath` refuses every path holding `//`).
- `graph/index.ts:272`, `329:21` — regex anchors made redundant by `LINK`'s own alternation
  and by the `.trim()` one line down.
- `guides/index.ts:57` — an include's `sensitivity` and `audience` come from a `LEFT JOIN`
  over `NOT NULL` columns, so they are null together and either clause decides alone.
- `access/index.ts:200`, `132:39`/`187:35` in `file.ts`, `concepts/index.ts:506`,
  `987` — the same shape.

**J. A documented complexity invariant no test can observe.** `graph/index.ts:230`'s
`heads.set(...)` is what keeps `blankedSpans` linear over an adversarial run of backticks —
tenant input inside the governed write's transaction, by its own docblock. Removing the call
changes no output, only the cost, so no functional test can hold it. Worth naming as a
performance property, not a survivor to close.

**K. The crash-window state is handled in two places and driven in one.**
`visibility.ts:295`/`337` guard a cascade over an IRI that `concept_evidence` names and
`concept_index` does not. That state is **reachable**: `concept_evidence`'s foreign key is
`concept_evidence_identity_fk`, to `concept_identity` and not to the index row, which is the
same separation `guides/index.ts`'s docblock names — "an identity can stand without its row —
a creation whose rows were lost in the crash window and not yet replayed". A narrowing whose
binding's documents are cited by a concept the reconciler has not replayed yet reaches both
guards. The composition half is driven and answers Restricted (finding F); the concept half
is not driven at all, and its mutant throws on `visibilityOf(undefined)` where the code
answers *nothing to recompute*. One test over that one state covers both.

**L. The per-repository lock registry grows one key per workspace, for the life of the
process.** `git/index.ts:424`/`428`'s `finally` is what clears it, and all three of its
surviving mutants are unobservable through the exports map: a retained entry is a resolved
promise the next act chains onto, one microtask later, in the same order. The triage called
this must-kill; it is not a test to write, it is a leak to fix or to accept in writing. On the
current estate (one api process, ADR 0024) the bound is the number of workspaces, so it is
small — but it is the one place in this report where the right answer is a source change and
not a test.

**M. T-108's expected reach.** T-108 (a stuck workspace's ref moved back to its watermark,
ADR 0012) is in flight on this path. Its tests should move these rows and no others:
`git/index.ts:467:29`, `467:65` and `467:77` (the headless-bundle/watermark pair —
`history-diverged` is exactly the state a stuck workspace is rewound out of);
`git/index.ts:482:29`, `482:64`, `482:72` (a rewound bundle's `missed` list read back);
`reconciler.ts:405:9` (the watermark read's failure arm); and, if the ticket exercises a
replay after the rewind, `reconciler.ts:280:7`. It is also the natural home for the lock
registry's leak (finding L), since a rewind takes the same lock. It should **not** be
expected to move the
`158`/`165`/`311`/`332` trailer-and-grammar clusters, which need forged commits rather than a
moved ref.

---

## Must-kill shortlist

Ranked by what the branch protects.

1. **`reconciler.ts:158` (6 rows) — the gate that decides a commit is the platform's.**
   `factsOf`'s trailer guard is what separates a commit the governed write made from any
   other commit on the ref. Its refusal body is NoCoverage. Test: replay a commit with no
   `Actor:`, one with a non-actor `Actor:`, one with no `Audit:`, and one whose `Audit:` is
   not a ULID; each must stop at that sha with `unreadable-commit`, and land nothing. (The
   other two rows on the line are each masked by their own sibling and are not work.)
2. **`landing.ts:178`/`179` (4 rows) — ADR 0039's audience cascade.** A re-write that narrows
   a concept's audience must narrow every composition that includes it, in the same
   transaction. Nothing drives it: the cascade's only test moves `sensitivity`. Test: land a
   composition over a concept, re-write the concept moving only `audience` (then only
   `audienceGroups`), and assert the composition's three columns moved with it. The other
   eight rows on those lines are cost-only and are not this ticket's work.
3. **`git/index.ts:514`/`516` (5 rows) and `500:22` (`^`), `510:52` — the forgery guards on
   the commit reader.** A hand-forged commit is the only kind these see, and all of their
   promises are unproved; the `514` cluster makes the reader throw. Test: read back a commit
   whose message has three paragraphs with a trailer-shaped line in the middle one, and one
   whose last paragraph mixes a trailer with prose.
4. **`reconciler.ts:311` (4 rows) and `332` (2) — the two remaining `unreadable-commit`
   stops.** A creation whose file names no `type`, and a commit whose row the boundary
   refuses. Both stop with an `Error` under the mutants and with the word in the code.
5. **`git/index.ts:552`/`556` (8 rows) and `reconciler.ts:161` — a commit that is not one
   added-or-modified file.** A deletion, a rename, an empty commit and a two-file commit all
   have to come back as `change: undefined` and stop the replay. Nothing drives any of them,
   and the `556:5` mutants would run `git show <sha>:undefined`.
6. **`reconciler.ts:233` (3 rows) — a lost commit that dropped or swapped a citation.** The
   only lost commit replayed today *adds* one, where both conjuncts are false together. A
   commit that dropped a citation and one that swapped it must each still land Restricted and
   say `evidenceAgrees: false` on the ledger.
7. **`runs/index.ts:161` and `133` (5 rows) — the membership re-read, and the terminal-status
   list.** Findings G and H.
8. **`reconciler.ts:202` (3 rows) — the derived merge key another concept holds.** Finding B.
9. **`file.ts:213` (`^`), `265`, `306`, `307:7` (5 rows) — the concept-file grammar's
   tightness.** `parseConceptFile` is "the renderer's inverse and deliberately no more", and
   the nightly audit cross-checks it against the Python tier hash by hash (T-057). Two cheap
   fixtures close all five: a frontmatter line with junk before its quoted key, and a
   no-fence file whose body carries a `---` with a blank line after it. A numeric list item
   (`265`) is a third line in the existing `it.each` refusal table.
10. **`file.ts:134` (2 rows) — RFC 8785's key sort.** The nested-object branch is only ever
    handed keys already in order, so the sort that makes the content hash independent of a
    producer's key order is unproved — and the hash is a cross-tier contract (ADR 0031).
11. **`visibility.ts:295`/`337` (2 rows) — the crash-window state on the concept half of the
    cascade.** Findings F and K: a composition including a concept whose rows were lost is
    driven and answers Restricted; a narrowing that reaches the same concept is not, and the
    mutant throws on `visibilityOf(undefined)` rather than leaving it alone.
12. **`git/index.ts:467` (2 rows) — `history-diverged` for a headless bundle.** Finding A;
    T-108's likely reach.
13. **`answering/index.ts:310` (4 rows) and `292` (2) — `stale_after`'s grammar and calendar
    check.** Both are the triage's standing must-kills and both still describe the code.
14. **`workspaces/index.ts:163` — a credential revocation for a person id nobody holds.** The
    triage's standing must-kill; T-088's revocation work did not reach this arm.
15. **`runs/index.ts:240` (2 rows) — the queue's boundary refusal.** Finding A's queue
    equivalent; the refusal body is NoCoverage.

---

## Part 1 — full tables

### `src/concepts/reconciler.ts` (42)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `158:7` ×5, `158:93` (NC) | whole condition → `false`, its first three operands → `false`, the three `\|\|` → `&&`, block → `{}` | must-kill | `factsOf`'s trailer gate never refuses in any test — every replayed commit carries a well-formed `Actor:` and `Audit:`, and the one "commit the governed write did not make" test fails two guards later, at `parseConceptFile`. Four forged commits kill all six: no `Actor:`, a malformed `Actor:`, no `Audit:`, a non-ULID `Audit:` — each must stop with `unreadable-commit` rather than with the `NOT NULL` violation the mutant produces |
| `158:7` (`actor === undefined`), `158:51` (`audit === undefined`) | conditional → `false` | equivalent [proof] | each is masked by its own sibling: `isActorId(undefined)` and `ULID.test(undefined)` are both false, so the next operand refuses the same input |
| `161:7` | `read.change === undefined` → `false` | must-kill | no test replays a commit that changed no file or more than one; `factsOf` is called outside `attempt`, so the mutant throws out of `reconcile` instead of stopping at the sha |
| `165:7` ×2 | whole condition → `false`, `\|\|` → `&&` | must-kill | no replayed file parses and then carries no `iri` or one outside the IRI form; the IRI is the one identity a commit carries (ADR 0002) and nothing proves the replay reads it |
| `165:7` (`typeof iri !== "string"`) | conditional → `false` | equivalent [proof] | masked by `!IRI.test(iri)`, which refuses `undefined` too |
| `182:10` | `typeof value === "string"` → `true` | worth-killing | `stringIn` only ever sees a string or an absent key, so the type test never has to choose; a file whose `type` is a number would take the held row's kind today and refuse under the mutant |
| `200:30`, `200:54` | `title.trim()` → `title`, `/\s+/g` → `/\s/g` | worth-killing | no replayed creation derives its merge key from a title carrying leading, trailing or repeated whitespace, so ADR 0003's normalisation is unexercised |
| `202:10`, `202:34` ×2 (NC) | `holder === undefined \|\| holder === iri` → `true`, `holder === iri` → `false`/`!==` | must-kill | the second operand has never been evaluated: no replay meets a derived merge key another concept already holds, so the documented IRI fallback that keeps the restore path landing has never run |
| `233:10` ×2, `233:38` | `&&` → `\|\|`, `filed.size === held.size` → `true`, `[...filed]` → `[]` | must-kill | the only lost commit the suite replays **adds** a citation, where both conjuncts are false at once, so neither is proved. Two more shapes are needed and neither exists: a commit that **dropped** a citation (`filed ⊂ held` — sizes differ, every filed pair held) kills the `true` and `\|\|` rows, and one that **swapped** a citation (same size, different pairs) kills the `[]` row. Both are lost commits that would replay at the citations' class rather than Restricted |
| `280:7` | `!read.ok` → `false` | worth-killing | no test makes `readCommit` fail mid-replay, so the git door's own failure is never carried out as the run's stop reason |
| `294:50` | `"skipped"` → `""` | equivalent [proof] | the value's only consumer is `outcome.value === "landed" ? replayed : skipped` at `419`, so every non-`"landed"` string routes to `skipped` |
| `302:11` | `facts.suggestionId === undefined` → `false` | equivalent [no seam] | the mutant calls `payloadFor` with no id, and `concept_write_request_for(NULL)` answers no row, so `payload` is `undefined` either way and only one extra statement differs — the row's own survival across 14 covering tests is the evidence that the extra call does not raise |
| `306:11` | `facts.suggestionId === undefined` → `false` | equivalent [proof] | a guard the sibling already makes: `payload` is literally `undefined` whenever the id is, so the first operand only narrows the type |
| `309:61`, `310:63` (NC) | `held?.kind` → `held.kind`, `held?.title` → `held.title` | worth-killing | the governed write always writes `type` and `title` into the file it commits (the suite proves it), so the fall-back to the held row is reachable only from a forged commit and nothing forges one |
| `311:13` ×3, `311:67` (NC) | whole condition → `false`, `kind === undefined` → `false`, `\|\|` → `&&`, `"unreadable-commit"` → `""` | must-kill | the stop for a commit whose file names no `type` over a concept with no held row has never been reached; `foldKind(undefined)` throws inside `indexRowOf`, so the mutant stops with an `Error` where the code stops with the word |
| `311:35` | `title === undefined` → `false` | equivalent [proof] | masked one step down: a row with no title fails `conceptRow.safeParse`, and `332` answers the same `unreadable-commit` |
| `326:49` | `"status"` → `""` | equivalent [proof] | `indexRowOf` reads `facts.frontmatter["status"]` itself (`landing.ts:232`) and prefers the caller's value only when it is a string, so blanking the key here leaves the same status on the row |
| `332:13`, `332:41` (NC) | `!parsed.success` → `false`, `"unreadable-commit"` → `""` | must-kill | no replay hands `indexRowOf` a row the boundary refuses, so the last of the four stop conditions has never fired |
| `361:41` | `[]` → `["Stryker was here"]` | equivalent [no seam] | an entry with no `sensitivity` contributes nothing to the intersection — `narrower` compares `RANK[undefined]` and answers the other side — so a placeholder in `restsAlsoOn` moves no class |
| `370:16` | `typeof named === "string"` → `true` | worth-killing | every provoked replay failure is a named constraint, so the arm that hands back the store's own `Error` is never taken |
| `405:9` | `!watermark.ok` → `false` | worth-killing | no test makes the watermark read fail, so a Postgres failure at the head of a run is never reported as one |
| `461:7` | `!read.ok` → `false` | worth-killing | `reconcilerHits`' ledger read is never made to fail |
| `488:7` | `!held.ok` → `false` | worth-killing | `workspaceIds` is never made to fail under the periodic pass |
| `489:43` | `[]` → `["Stryker was here"]` | worth-killing | the pass's outcomes are read through a `Map` keyed by workspace id, so a phantom entry is invisible; nothing asserts the pass answers exactly the workspaces the platform holds |

### `src/concepts/file.ts` (30)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `132:39` | `item !== null` → `true` | equivalent [no seam] | `FrontmatterValue`'s array arms are `string[]` or `FrontmatterSource[]`, and `listItemsOf` refuses a `null` item, so no file or row in this tree puts a `null` where `typeof … === "object"` would catch it |
| `134:51` → `false`, `134:51` → `a <= b` | EqualityOperator/Conditional | must-kill | the key comparator answers `0` where it should answer `1`, and `toSorted` then leaves those pairs in the producer's order — RFC 8785's whole point, and a cross-tier hash contract (ADR 0031); no fixture holds a non-`sources` object list with out-of-order keys |
| `134:38` → `a <= b`, `134:51` → `true`, `134:51` → `a >= b` | EqualityOperator/Conditional | equivalent [proof] | `Object.keys` yields distinct keys, so the comparator's `a === b` arm is unreachable and these three differ only there |
| `167:80` | `"utf8"` → `""` | equivalent [proof] | Node reads an unrecognised encoding name as utf8 — verified out-of-band: `createHash("sha256").update("é☃ Ünïcode", "")` and `…, "utf8"` give the same digest, while `"latin1"` does not |
| `187:35` | `item !== null` → `true` | equivalent [no seam] | the renderer's list branch, same shape as `132:39`: the type and the parser both refuse a `null` item |
| `213:26` drop `^` | Regex | must-kill | `FRONTMATTER_LINE` is the grammar: without the anchor a line carrying junk before a quoted key — an indented one, say — parses as a pair, so a file the renderer never wrote is read as one |
| `213:26` drop `$` | Regex | worth-killing | narrower than it looks: `"key":value` is refused either way, because without `$` it parses as a bare key and `listItemsOf` then finds no items. The two differ only for a `"key":value` **followed by** a `  - ` list |
| `225:11` (NC) | `catch` block → `{}` | equivalent [proof] | emptying the `catch` leaves the arrow function returning `undefined` implicitly, which is what the removed `return undefined` did. The coverage fact stands — `scalarOf` never throws in any test, so the refusal of an unquoted value is undriven — but no mutant on this line can hold it |
| `238:10` ×2, `238:28` | `\|\|` → `&&`, conditionals → `false` | equivalent [proof] | one condition written twice — `FRONTMATTER_LINE`'s group 1 is a quoted JSON string, so `key` is a string exactly when `match` is non-null, and either clause alone decides every input |
| `259:10` ×2 | `at < close` → `true`, → `at <= close` | equivalent [proof] | the bound is redundant: `close` is the index of a line that **is** `"---"`, which never starts with `"  - "`, so the loop stops at the fence with or without it |
| `259:38`, `260:34`, `276:41` (NC) | `""` → `"Stryker was here!"` | equivalent [proof] | `?? ""` fallbacks on `lines[at]` inside a bound that keeps the index within a dense `split` result |
| `265:11` | `typeof item !== "string"` → `false` | must-kill | a numeric or boolean list item would be pushed into a `string[]`; the grammar's "a list is strings or OKF's objects and never a mix" has no fixture for the scalar half |
| `273:21` | `field.rest === undefined` → `false` | equivalent [proof] | `scalarOf(undefined)` throws inside its own `try` and answers `undefined`, which is what the ternary's other arm returns |
| `274:11` | `value === undefined` → `false` | worth-killing | an entry field whose value is not a scalar would be stored as `undefined` rather than refusing the file |
| `277:11` ×2 | `at >= close` → `false`, → `at > close` | worth-killing | the entry-continuation bound is never pushed to the fence, so nothing proves a continuation line stops at it |
| `279:11` | `field === undefined` → `false` | worth-killing | a malformed continuation line would throw on `field.rest` rather than answering `malformed` |
| `306:17`, `306:64`, `307:7` | `lines[0] === "---"` → `true`, `-1` → `+1`, `close === -1` → `false` | must-kill | the opening-fence check is only ever met by a fixture that also holds no `---` anywhere, so a file with a fence-shaped line in its body and none at the top is not proved refused |
| `307:17` | `-1` → `+1` | worth-killing | an empty frontmatter block (`---\n---\n\n`) is accepted today and refused under the mutant; nothing pins which |
| `311:38` (NC) | `""` → `"Stryker was here!"` | equivalent [proof] | the `?? ""` on `lines[at]` inside `at < close` |

### `src/concepts/landing.ts` (12)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `178:3` ×2, `179:3` ×2 | `one.audience === other.audience` → `true`/`!==`, the groups comparison → `true`/`!==` | must-kill | `sameVisibility`'s `sensitivity` clause is driven — every mutant of it dies — and its `audience` and `audienceGroups` clauses are not: each of these four makes the function answer *unchanged* for a re-write that moved only the audience word or only the group list, so `recomputeCompositionsIncluding` is skipped and every composition including the concept is left wider than what it includes (ADR 0039, ADR 0023) |
| `176:24`, `177:3` → `false`, `403:7` → `true`, `179:26`, `179:35`, `179:69`, `179:78` | ArrowFunction → `() => undefined`, conditional → `false`/`true`, `[]` → placeholder, `" "` → `""` | equivalent [no seam] | all seven err in the **recompute more** direction only. The first three force the second-level recompute to run every time, and it is idempotent by its own docblock; the four join mutants change one side of a string comparison, which can make two equal group lists compare unequal but never the reverse — except under a group id that is exactly the concatenation of two others, which nothing mints. Only cost differs |
| `235:6` | `typeof fileStatus === "string"` → `true` | worth-killing | no write lands a file whose `status` key is a non-string, so the choice between the file's status and the row's held status is never made |

### `src/concepts/visibility.ts` (10)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `261:7`, `263:7` | `!serialised.ok`/`!groups.ok` → `false` | worth-killing | neither the cascade lock nor the held-groups read is ever made to fail, so `openingACascadeOverHeldGroups` never carries a failure out |
| `295:7`, `337:9` | `row === undefined` → `false`, `visibility !== undefined` → `true` | must-kill | no cascade meets an IRI that `concept_evidence` names and `concept_index` does not — a reachable state, since the citation's foreign key is to `concept_identity` and a creation's rows can be lost in the crash window — so the "nothing to recompute" answer is unproved and the mutant throws on `visibilityOf(undefined)` (Platform finding K) |
| `400:7`, `407:7`, `432:7`, `444:7` | `!x.ok` → `false` | worth-killing | `overrideConceptClass`'s four failure arms — the groups gate, the identity read, the override write and the cascade — are none of them driven, so an Admin's override reports no store failure it meets |
| `533:14` | `cited.rows[0]?.cited` → `cited.rows[0].cited` | equivalent [proof] | an unqualified `count(*)` aggregate always answers exactly one row |
| `538:7` | `!read.ok` → `false` | worth-killing | the evidence pane's read is never made to fail |

### `src/runs/index.ts` (14)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `133:50`, `133:51`, `133:59`, `133:69` | `["done","failed","poisoned"]` → `[]`, each string → `""` | must-kill | `JOB_IS_OVER` is asserted in core only by `not.toContain`, a direction every one of these mutants also satisfies; `apps/api`'s `--wait` poll loops until its deadline on an emptied list (`[TEST7]`) |
| `161:7` | `principal.kind === "platform"` → `true` | must-kill | nothing distinguishes the platform's `withScope` road from the person's `withMembership` road, so the fresh membership re-read the docblock exists for — "an Admin demoted between the call and the write does not get their job" — is unproved |
| `165:7`, `166:7` | `!held.ok`/`!held.value.ok` → `false` | worth-killing | the store failure and the moved-role refusal on the person's road are both undriven |
| `240:7`, `240:35` (NC) | `!parsed.success` → `false`, `"malformed"` → `""` | must-kill | `enqueueJob`'s boundary refusal for a kind or reason the row would reject has never been reached, so the refusal the docblock promises the caller is unproved |
| `250:7` | `!written.ok` → `false` | worth-killing | the insert is never made to fail |
| `287:7`, `349:7`, `350:7` | `!x.ok` → `false` | worth-killing | `jobById`'s read and `bundleHealth`'s read and membership arms are never made to fail |
| `355:22` | `outcome.value === null` → `false` | must-kill | a finished nightly audit whose `outcome` is NULL is never read back, so the fail-closed *mismatched* answer for "I cannot tell" is unproved — and under the mutant the read throws on `findings[finding]` |

### `src/guides/index.ts` (7)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `57:3` ×2, `57:35` | `\|\|` → `&&`, conditionals → `false` | equivalent [proof] | the rule itself **is** driven — `57:3`'s whole-condition mutants both ways and both `!==` inversions all die, so a composition including a concept with no index row is in the suite and lands Restricted. What survives is the redundancy between the two clauses: the includes come from a `LEFT JOIN concept_index` over columns the table declares `NOT NULL`, so `sensitivity` and `audience` are null together and either clause alone decides every reachable case |
| `99:7` | `input.iris.length === 0` → `false` | equivalent [proof] | the guard is cost-only: `i.iri = ANY('{}')` matches nothing, so the recompute answers the same empty list with or without the statement |
| `99:39` | `[]` → `["Stryker was here"]` | worth-killing | one test reaches the empty-iris early return and none asserts its value |
| `165:7`, `178:7` | `!page.ok`/`!footnotes.ok` → `false` | worth-killing | neither of `footnotesOf`'s reads is ever made to fail |

### `src/sources/index.ts` (4)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `127:7`, `134:7`, `148:7`, `165:7` | `!x.ok` → `false` | worth-killing | `narrowBinding`'s four failure arms — the cascade gate, the binding read, the narrowing write and the two-level cascade — are none of them driven, so an Admin's narrowing never reports a store failure it meets; the same shape as `visibility.ts`'s override |

### `src/concepts/inbox.ts` (5)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `119:7`, `119:42` (NC) | `!isActorId(value)` → `false`, message → `` | worth-killing | the inbox's actor-shape guard has never thrown: no fixture seeds a suggestion row whose `proposer` or `decider` is outside the three actor forms, and whether the column's own constraint makes that unconstructible is worth settling before a test is written |
| `437:13`, `437:40` (NC), `438:27` (NC) | `written.rows.length === 0` → `false`, block → `{}`, message → `""` | equivalent [no seam] | the code says it: "unreachable while the lock above holds" — the `FOR UPDATE` above makes the losing update impossible, and the throw exists so the ledger row cannot commit for a decision that did not happen |

### `src/concepts/graph-maintenance.ts` (2)

| row(s) | mutator → replacement | verdict | why, in the code |
| --- | --- | --- | --- |
| `101:23` ×2 | `generations.length > 1` → `true`, → `>= 1` | worth-killing | a sweep of exactly one generation must write its ledger row with **no** batch id (ADR 0014 rule 4's convention, the same one `reconcile` follows at `409`); nothing asserts the single-generation case's `batch_id` is null |

---

## Part 2 — the re-anchor

### `src/store/git/index.ts` (56) — 5 standing, 9 reclassified, 42 fresh

The triage's git table stopped at the per-repository lock. Everything from `openGit`,
`commitsAfter`, `readCommit` and `trailersOf` landed after it (T-055/T-056's reconciler
reads, T-105's root check and path tests) and is triaged fresh here.

**Resolved since the triage — do not spend effort here.** The `..`/`.`/empty-segment cluster
(`288`, 17 mutants), the whole control-character `.some()` (`284`), `isBundlePath`'s
`malformed-path` refusal, both `GIT_INDEX_FILE`/`read-tree` rows, the `Suggestion:`/`Run:`/
`Projection:` trailer tuples, `isSubjectLine`'s length boundary, `maxBuffer`'s arithmetic and
the entire `catch` block that tells a stale precondition from a store failure are **all
killed** in this run.

| row(s) | mutator → replacement | class | verdict | note |
| --- | --- | --- | --- | --- |
| `187:52` | `"C"` → `""` | standing | worth-killing | the triage's `140`: `LC_ALL=C` pins git's messages so the stale-precondition regex reads them; still environment-dependent and still untested |
| `190:7` | `options.input !== undefined` → `true` | standing | noise | the triage's `143`: `.end(undefined)` on a command that reads no stdin is a no-op at every call site |
| `191:5` | `child.child.stdin?.end` → `child.child.stdin.end` | **reclassified** | equivalent [proof] | the triage's `144` called this must-kill on the reading that the `.end(…)` call is removed — it is not; only the `?.` is, and `promisify(execFile)`'s default `stdio` always gives a piped `stdin`, so the mutant can throw only where `stdin` is never null |
| `258:27` | `[]` → `["Stryker was here"]` | standing | noise | the triage's `209`: an extra non-`Key: value` line changes no trailer any reader parses — though it does mean the commit message's exact trailer block is pinned by nothing |
| `278:3` ×4, `279:4` | conditionals → `true`, `&&` → `\|\|`, `> 0` → `>= 0`, `startsWith` → `endsWith` | **reclassified** | equivalent [proof] | the triage's `229-231` cluster was must-kill; T-105's path tests killed most of it and, in doing so, proved the rest redundant. `git.test.ts`'s candidate table already holds `""` and `/etc/passwd` and both are still refused with these clauses mutated, because `"".split("/")` is `[""]` and `"/etc/passwd".split("/")` opens with `""` — the empty-segment clause at `288` refuses every case `length > 0` and the leading-slash test would have. `endsWith("/")` is the same argument from the other end |
| `286:12`, `286:27` | `code < 0x20` → `<= 0x20`, `code === 0x7f` → `false` | fresh | worth-killing | T-105's control-character clause is driven by the tab and newline candidates, which `< 0x20` still refuses either way; what is untested is the boundary — no *accepted* path in the suite carries a space, so refusing `0x20` costs nothing visible, and no refused path carries a DEL, so admitting `0x7f` costs nothing either. One accepted path with a space and one refused path with a DEL close both |
| `373:13`, `374:47` | block → `{}`, `force: true` → `false` | standing | worth-killing | the triage's `316-318`/`317`: the temp-index cleanup is a resource leak, not a correctness break |
| `424:13`, `428:9` → `false`, `428:37` | block → `{}`, conditional → `false`, call → `;` | **reclassified** | equivalent [no seam] | the triage's `353-358`/`357` was must-kill and its other half — clearing a waiter's entry that is not yours — now dies. What is left is the leak direction, and it has no functional seam: a retained `chained` is already resolved and never rejects, so the next act chains onto it and runs one microtask later with the same ordering. Killing it means asserting over the module-private `locks` map, which `[TEST1]` refuses. The leak is real and belongs in a ticket about the map, not in a test |
| `69:51` (NC) | `"no-such-root"` → `""` | fresh | worth-killing | `openGit` is well covered — the absent-root arm dies — but no test opens a root that exists as a **file**, so this arm of ADR 0024's guard has never run |
| `194:10`, `194:26`, `557:78`, `557:85` | `options.raw === true` → `false`, `true` → `false`, `{ raw: true }` → `{}` | fresh | worth-killing | nothing asserts `readCommit` answers the file's **bytes as committed** rather than trimmed; the round-trip test parses the renderer's output directly and never through the door |
| `467:29`, `467:77` (NC) | `since === null` → `true`, `"history-diverged"` → `""` | fresh | must-kill | a bundle with no commits and a recorded watermark — a database restored ahead of a repository that was not — never reaches `history-diverged` |
| `467:65` | `[]` → `["Stryker was here"]` | fresh | worth-killing | the empty `missed` list for a headless bundle is never asserted |
| `482:29`, `482:64`, `482:72` | drop `.filter`, `sha !== ""` → `true`, `""` → placeholder | fresh | must-kill | `git()` trims, so `listed` is `""` exactly when nothing is missed and the filter is what turns `[""]` into `[]`; without it an up-to-date run stops at a commit that is not one, and the "rows are up to date" test asserts `replayed: []` and never `stopped: undefined` |
| `500:22` drop `^` | Regex | fresh | must-kill | a trailer-shaped fragment anywhere in the last paragraph would be read as a trailer, which is the forgery the reader's docblock promises to refuse |
| `500:22` drop `$` | Regex | fresh | equivalent [proof] | `(.+)` is greedy and the input is one line with no `m` flag, so the anchor changes neither the match nor group 2 |
| `510:17` | `trimEnd()` → `trimStart()` | fresh | worth-killing | the trailing newline the mutant leaves is a line that matches no trailer and is dropped; the two differ only for a forged single-paragraph message whose trailer line is indented |
| `510:52` | `.at(-1)` → `.at(1)` | fresh | must-kill | every commit the door writes has exactly two paragraphs, where `.at(1)` **is** `.at(-1)`; the docblock's "the last paragraph and never the first match" is unproved for any message with a body |
| `510:59` (NC), `530:15`, `530:29` (NC), `562:39` | `""` → placeholder, `"\0"` → `""` | fresh | equivalent [proof] | `String.split` always returns at least one element and `--format=%H%x00%P%x00%B` always emits two NULs, so the destructuring defaults cannot fire and `message` holds one element, which `join` never separates |
| `514:14` ×4, `516:11` (NC) | conditionals → `true`, `&&` → `\|\|`, `match?.[1]` → `match[1]`, `[]` → placeholder | fresh | must-kill | no commit read back has a non-trailer line in its last paragraph, so the reader would **throw** on `match[1]` rather than skip the line |
| `514:42` | `match[2] !== undefined` → `true` | fresh | equivalent [proof] | `TRAILER_LINE`'s group 2 is `(.+)` — never optional, so it participates whenever the regex matched |
| `548:20` ×2 | `at + 1 < …` → `<=`, `at + 1` → `at - 1` | fresh | equivalent [proof] | the extra turn reads a `status` of `""` or `undefined`, which the `A`/`M` test at `552` refuses, so no file is pushed |
| `552:9` ×4, `552:10` | conditionals → `true`, `&&` → `\|\|` | fresh | must-kill | no commit read back deletes, renames or copies a file, so the `A`/`M` test never discriminates — and a deletion has no content for the replay to land |
| `552:47`, `552:69`, `552:78` | `file !== undefined` → `true`, `file !== ""` → `true`, `""` → placeholder | fresh | equivalent [proof] | the loop bound `at + 1 < fields.length` makes `fields[at + 1]` defined over a dense `split` result, and git emits no empty path — the checks are `noUncheckedIndexedAccess`'s, not the runtime's |
| `556:5` ×3 | conditionals → `true`, `&&` → `\|\|` | fresh | must-kill | a commit that changed no file or more than one is never read back; under the mutant the door runs `git show <sha>:undefined` instead of answering `change: undefined` |
| `556:27` | `file !== undefined` → `true` | fresh | equivalent [proof] | `files.length === 1` implies `files[0]` is defined |
| `561:13` | `parentList.length === 1` → `true` | fresh | worth-killing | a root commit answers `null` either way; the two differ only for a merge commit on the ref, which the door never makes and no test forges |

### `src/store/graph/index.ts` (47) — 24 standing, 0 reclassified, 23 fresh

T-103 settled most of this file by writing proofs into the source rather than removing
guards, and every one of those verdicts still describes the code. The triage's must-kill
shortlist for this file — `supersedes()`, the stale-outgoing-edge DELETE, the `to_kind`
sync UPDATE, the SUPERSEDES relabel — is **entirely killed** in this run.

| row(s) | class | verdict | note |
| --- | --- | --- | --- |
| `218:20`, `220:9`, `221:51` (NC), `225:12`, `227:11` | standing (T-103) | equivalent [proof] | `blankedSpans`'s loop bounds, `opener` and the `queued.get` fallback — proved in comments at `212-217` and `223-224`; the pairing invariant, not the type, is what rules the indices out |
| `255:47`, `257:43`, `278:78`, `313:37`, `329:57`, `330:49` (all NC) | standing (T-103) | equivalent [proof] | the `?? ""` fallbacks on capture groups that are `+`-quantified or always participate, and on `String.split`'s first element |
| `325:17` | standing (T-103) | equivalent [proof] | `sectionAt`'s starting index: the two extra out-of-bounds starts read `""` and fall through to the same first heading |
| `431:88`, `434:86` | standing (T-087's correction) | equivalent [proof] | the retro's failed assumption 6, confirmed at their current anchors: the mutated literal is the ternary's **false** branch, so the placeholder only pushes an unmatched string into an `= ANY($2::text[])` lookup |
| `440:7` ×2, `452:7` ×2 | standing (T-103) | equivalent [proof] | cost-only guards by their own comments: an empty `ANY('{}')` is a legal query that returns nothing |
| `569:19`, `570:7`, `570:46` (NC) | standing (T-103) | equivalent [proof] | an insert-or-update `RETURNING` over a `NOT NULL` column always yields one row; the throw is a guard that cannot fire |
| `608:17`, `653:7` | standing (T-103) | equivalent [proof] | the `isNew` backfill guard, cost-only by its comment: bypassing it re-runs an idempotent backfill |
| `184:69` | standing | worth-killing | the triage's `159`: blanking to `""` instead of a same-length space deletes a fenced block's columns, which merges paragraphs and moves the `sentence` derived for a link beside a fence |
| `205:56` | fresh | equivalent [proof] | a placeholder in a length's queue is a non-number, so `position > at` is `false` and the same head-advance that discards consumed positions discards it unread |
| `227:37` | fresh | worth-killing | `position > at` → `>=` makes a run whose own position sits at the queue head close against itself; no body in the suite has an unpaired backtick run after a paired span |
| `228:7` | fresh | worth-killing | `head += 1` → `-= 1` stops the discard scan; one test covers the line and nothing asserts what it pairs |
| `230:5` | fresh | equivalent [proof] | the memo only keeps the pairing linear — re-scanning from `0` reaches the same head because positions increase (Platform finding J) |
| `247:3` | fresh | equivalent [proof] | both the definition key and every lookup go through `normalisedLabel`, so folding up or down matches the same pairs |
| `257:55`, `257:73` | fresh | worth-killing | without the anchors a `<` or `>` anywhere in an angle-bracketed definition target is stripped; no fixture has one mid-string |
| `272:21` ×2 | fresh | equivalent [proof] | `LINK`'s alternation already fixes `text` to exactly `[a][b]`, so both anchors are redundant |
| `314:7`, `314:16` | fresh | equivalent [no seam] | an empty target (`[x](#heading)`) resolves through `resolvedResource` to the concept's own **directory**, which no `concept_index` row holds, so no edge lands with or without the guard |
| `318:7` ×2, `318:7` Regex ×3, `318:44` | fresh | equivalent [no seam] | `resolvedResource` returns a scheme'd or `//` target unchanged, so the `.slice(1)` form matches no row — and `isBundlePath` refuses every path holding `//`, so the collision the guard prevents is unreachable without a contrived concept path (Platform finding I) |
| `329:21` ×2 | fresh | equivalent [proof] | `$` is redundant for a greedy `(.*)` on one line, and moving whitespace into group 1 is undone by the `.trim()` at `330` |
| `357:45`, `358:9` | fresh | equivalent [proof] | the `\|$` alternative only adds a boundary at the paragraph's last character, which is never before a link's index, and a link match never begins with `.`, `!` or `?` |
| `705:15`, `706:7` | fresh | worth-killing | `writeConceptVisibility` for a workspace the map never held is a documented early return ("a workspace the map never held is nothing to keep in step") with no test |

### The lighter pass

**`src/answering/index.ts` (27) — 22 standing hold, 5 reclassified.**
The triage's standing verdicts still describe `292:25` ×2 (`stale_after`'s grammar anchors,
must-kill — the docblock's own reason is that `new Date` is not a validator), `310` ×4
(`utcMidnight`'s three-field rollover check, must-kill — no impossible date rolls only one
field), `369:9`/`369:37` (a malformed `sources[]` entry, must-kill), `429` ×5 (`termsOf`'s
word grammar), `206` ×3 (`tagsOf`'s non-string filter), `225:7`/`456:9` (store failures) and
`461` ×4 (`ask`'s citation ordering — the whole comparator can answer `undefined` and nothing
notices). **Reclassified to equivalent**: `348:10` and `372:19`/`372:36`, which T-086 settled
in the source itself — the comments at `345-347` and `370-371` say in as many words that the
guard and the type test "never differ" — and `66:5`/`66:10`, where the `current` arm's body is
`break`, i.e. the switch's own exit, so removing it or blanking its label leads to the same
line.

**`src/concepts/index.ts` (20) — all 20 standing, all still describe the code.**
`341`/`342` (the file's `type`/`title` defaults over a caller's frontmatter), `506` ×3 (the
widening guard, whose two clauses are undefined together on a creation so neither is proved
alone), `610:18` (a store error the constraint map does not name), `689:26`/`795:14` (the
acceptance author fallbacks), `717:37` (the acceptance message's `.trim()` — the delta's `975`
cluster, now down to one row), `962`/`963` ×2/`976` (`findConcepts`'s input normalisation) and
`987` ×5 (`checkOf`'s three-clause guard, where the column pair is written together so the
first two clauses are one). The delta's `1093` `merge-key-taken` row is killed.

**`src/access/index.ts` (5) — all fresh** (the module had no live mutants at the triage).
`133:3` (`RANK[one] <= RANK[other]` → `<`) is **equivalent [proof]**: at equality `one` and
`other` are the same sensitivity, so both arms return the same word. `200:17` is **equivalent
[proof]**: `KIND_FLOOR[undefined]` is `undefined`, which is the value the guard produces.
`249:7` with its two NoCoverage rows is **worth-killing**: `visibilityOf`'s "audience word and
group list disagree" throw has never fired, and whether the zod parse above it already refuses
that shape decides whether a test is constructible at all.

**`src/kernel/actor.ts:81` — fresh, equivalent [proof].** The delta listed this row without a
verdict. `PERSON_PREFIX` is six characters and so is `"agent:"`, but neither non-person form's
tail survives the boundary's person-id grammar — a process actor's is `s:better-answers-…` and
an agent's carries a `/` — so `personOfActor` answers `undefined` with or without the guard.

**`src/kernel/constraint.ts` (4) — all standing, all hold.** Three `worth-killing` rows for the
contrived non-string `.constraint` shape real Postgres errors do not produce, and `28:88`
settled equivalent by T-103's comment (no placeholder ever equals a real constraint name).

**`src/store/postgres/index.ts` (4) — 3 standing, 1 fresh.** `56:3` is the documented probe
result in `docs/agents/mutation-triage.md`: `→ true` survives because node-postgres sends
`undefined` and `null` as the same NULL, while `→ false` dies — **equivalent [proof]**.
`444:18`/`474:18` are T-103's settled `?? 1` rows, **equivalent [proof]**. `250:11` is **fresh**
(it exists because T-103 reshaped `refuse` to return a `Result`) and **worth-killing**: no test
presents a credential naming a role together with a membership the row refuses, so a refusal
would come back as `role-disagrees` instead of its own word.

**`src/members/*.ts` (5) — 3 standing, 2 fresh.** `groups.ts:279` is T-103's settled row
(a `SELECT` of two constant `EXISTS` with no `FROM` always answers one row) — **equivalent
[proof]**. `requests.ts:354` ×2 carries the triage's `350` verdict, **worth-killing**, and
still holds. Fresh: `groups.ts:355` is **equivalent [proof]** — an empty group list makes
`count(*)` answer `0`, which equals `distinct.length`, so the early return is cost-only — and
`groups.ts:360` is **equivalent [proof]** for the same reason as `279`.

**`src/audit/*.ts` (2) — 1 standing, 1 fresh.** `index.ts:177:41` is T-103's settled row
(a plain `INSERT … RETURNING` always yields one row), **equivalent [proof]**.
`vocabulary.ts:138` is **fresh** and **equivalent [proof]**: `ACT.test(name)` one line above
already requires the `family.subject.verb` form, so `name.split(".")[1]` is never `undefined`
where the guard is read. It is worth noting this row now carries `testsCompleted: 388` — the
thirteen `vocabulary.ts` rows the retro found with `testsCompleted: 0` are gone, which is the
runner patch working.

**`src/workspaces/index.ts` (2) — 1 standing, 1 fresh.** `163:11` still carries the triage's
must-kill and is **still unkilled**: T-088's revocation work asserted a minted id nobody holds
through a different arm, and nothing reaches this `UPDATE … RETURNING`'s empty result, so a
revocation for a person id nobody holds is not proved to answer "no such person". `349:7` is
**fresh** and **worth-killing**: `workspaceIds`' store failure is undriven, which is also
`reconciler.ts:488`'s gap seen from the other side.

---

## Probes — the controls failed, so nothing here rests on one

Two controls were run through `pnpm mutant-probe` against the whole `packages/core` suite
over a Testcontainers Postgres, on one line with opposite reported verdicts — the sharpest
pair `docs/agents/mutation-triage.md` asks for.

| control | mutation | report says | probe says |
| --- | --- | --- | --- |
| positive | `landing.ts:403` `!sameVisibility(held, visibility)` → `false` | Killed | **killed** (19 of 476 failed) — as expected |
| negative | `landing.ts:403` `!sameVisibility(held, visibility)` → `true` | Survived | **killed** (1 of 476 failed) — *not* as expected |

The negative control's single failure is not the mutation. It is
`rebuild-equivalence.test.ts`'s "finds no mismatch between the two parsers over the bundle
those acts wrote" hitting its 60-second `testTimeout`, beside `graph-budget.test.ts`'s
`beforeAll` hitting its 300-second `hookTimeout` and taking its three tests with it. Both are
this machine under load; neither touches `sameVisibility`.

**So the harness does not discriminate here, and by the method's own rule no equivalence
verdict in this document cites a probe.** Every `equivalent` call above is argued from the
code, and the strongest of them are corroborated without a probe at all — by the *killed*
rows on the same expression (`guides/index.ts:57`, `git/index.ts:278`) or by the suite's own
fixtures (`git.test.ts`'s candidate table already holds `""` and `/etc/passwd`). One call was
settled out-of-band instead: `file.ts:167`'s `"utf8" → ""`, by hashing a non-ASCII string
under both encodings in a bare Node process.

Two things worth carrying back into the method:

- **`mutant-probe` reads a timed-out test as a kill.** The script reports one `verdict:` line
  from "did any test fail", and a `Test timed out` counts. On a developer machine the core
  suite holds at least two tests long enough to time out under load, so a `killed` verdict
  from a whole-suite probe is not evidence of a kill unless the failures are read. The script
  could separate "failed an assertion" from "timed out" in its summary line, which is the
  difference between a kill and a fault.
- **A whole-suite probe of `packages/core` costs 25 minutes and is the only shape the method
  allows for an equivalence call**, because `--suite` narrows a kill and never an equivalence.
  With `graph-budget` and `rebuild-equivalence` in the same run, that shape is close to
  unusable locally. Excluding those two files by name — not narrowing to one — would keep the
  whole-suite property and make the harness answer.

---

## Proposed tickets

Four tracer-bullet tickets, cut by module. Each owns the must-kill and worth-killing rows
named; the equivalent rows are not work, except where a ticket is asked to write the proof
into the source in T-103's shape.

### T-1 — Every ADR 0012 stop condition is driven, and the replay is proved to stop at it

`src/concepts/reconciler.ts`, `src/store/git/index.ts` (the reader half).

Forge the commits the governed write never makes and prove the replay refuses each one by
name: a missing or malformed `Actor:`/`Audit:` trailer (`reconciler.ts:158` ×6), a commit that
changed no file or two (`reconciler.ts:161`; `git/index.ts:552` ×5, `556` ×3), a file that
parses and carries no `iri` (`165` ×2), a creation whose file names no `type`
(`311` ×4), a row the boundary refuses (`332` ×2), a derived merge key another concept holds
(`202` ×3), a citation dropped and a citation swapped (`233` ×3), a headless bundle with a watermark
(`git/index.ts:467` ×2), and a run with nothing to do that stops nowhere
(`git/index.ts:482` ×3). Also the reader's forgery guards: a three-paragraph message
(`git/index.ts:510:52`), a trailer-shaped fragment (`500:22`), a non-trailer line in the last
paragraph (`514` ×4, `516`). Worth-killing rows it owns: `reconciler.ts:182`, `200` ×2,
`280`, `309`/`310`, `370`, `405`, `461`, `488`, `489`; `git/index.ts:69:51`, `194` ×2,
`286` ×2, `467:65`, `510:17`, `557` ×2, `561`. The lock registry's three rows
(`git/index.ts:424`/`428`) are **not** this ticket's work — finding L, a source change or a
written acceptance, sequenced with T-108.

### T-2 — A concept file the renderer never wrote is refused, and the hash is independent of a producer's key order

`src/concepts/file.ts`.

The grammar's tightness, as three more lines in the existing `it.each` refusal table: a
frontmatter line with junk before its quoted key (`213:26`), a numeric list item (`265:11`),
and a file with no opening fence but a fence-shaped body line (`306` ×2, `307:7`). And RFC
8785's sort over a non-`sources` object list whose keys arrive out of order (`134:51` ×2) — a
cross-tier contract, so the expected canonical text and digest are literals computed
out-of-band (`[TEST9]`). Worth-killing rows it owns: `213:26` (`$`), `274`, `277` ×2, `279`,
`307:17`. The seventeen equivalents want the T-103 treatment: a comment where
`noUncheckedIndexedAccess`, or a sibling clause, is the only reason a check is there.

### T-3 — A move in a concept's audience narrows every composition that includes it, and a cascade over a concept whose rows were lost leaves it alone

`src/concepts/landing.ts`, `src/guides/index.ts`, `src/concepts/visibility.ts`,
`src/sources/index.ts`, `src/concepts/graph-maintenance.ts`.

Drive the cascade by the audience rather than the class: a re-write that moves only the
audience word, and one that moves only the group list, each re-deriving the compositions that
include the concept (`landing.ts:178` ×2, `179:3` ×2). Drive the crash-window state on the
half that is not driven: a narrowing over a binding cited by a concept whose index row was
lost leaves that concept alone rather than throwing (`visibility.ts:295`, `337`) — the
composition half already lands Restricted and is proved. Worth-killing rows it owns:
`landing.ts:235`, `guides/index.ts:99:39`, `165`, `178`, `visibility.ts:261`, `263`, `400`,
`407`, `432`, `444`, `538`, `sources/index.ts:127`, `134`, `148`, `165`,
`graph-maintenance.ts:101` ×2.

### T-4 — A person's queue act re-reads its membership, and the queue's own refusals reach the caller

`src/runs/index.ts`, `src/workspaces/index.ts`, `src/concepts/inbox.ts`,
`src/store/postgres/index.ts`.

Prove the person's road is not the platform's: an Admin demoted between the call and the write
does not get their job (`161:7`, `166:7`). Assert `JOB_IS_OVER` in both directions against
literals (`133` ×4, `[TEST7]`, `[TEST9]`). Reach `enqueueJob`'s boundary refusal (`240` ×2)
and `bundleHealth`'s null-outcome answer (`355:22`). Revoke credentials for a minted person id
nobody holds and assert the refusal (`workspaces/index.ts:163`). Worth-killing rows it owns:
`runs/index.ts:165`, `250`, `287`, `349`, `350`; `workspaces/index.ts:349`;
`inbox.ts:119` ×2; `postgres/index.ts:250:11`.
