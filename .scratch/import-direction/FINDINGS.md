# Import direction in `packages/core` — how ADR 0029's five rules should be enforced to v0.1

*10 September 2026. Probe branch `probe/import-direction`, cut from `66006a5`, never merged. Throwaway code was run on this branch and `packages/core` was restored; this file is the record, written for the session that cuts the follow-up ordna task. The `first-principles` skill is user-invocation-only in this repository (`disable-model-invocation`, and the harness refuses to replicate it), so the decomposition below follows `decision-clarity`'s clarify → deconstruct → simplify → decide sequence, which covers the same ground.*

## 1. The question, restated in outcome terms

The prompt asks which of A, B, C or D should enforce import direction in core. The outcome that matters is narrower: **every new directory a route block adds to `packages/core/src` must land under a mechanism that already holds all five of ADR 0029's rules, without anyone editing a pattern to describe the new directory's shape.** "Re-explaining" is the cost to remove; the number of overrides is only its symptom.

That reframing changes the test for each option: not "does it hold rule 4's face clause" (the T-114 pattern does) but "does it hold rules 1, 2, 3 and *nothing imports erasure* too, and does a new slice, door or layer need a line anywhere".

## 2. Deconstruction

### 2.1 The real goal

Five rules over directories, held mechanically (the ADR's title: "a lint rule, never a convention"), each held both where it fires and where it stays silent (`[CHECK1]`), with a message that cites the ADR (`[COMMENT2]`), and with a cost of zero config edits per new slice or door.

### 2.2 Fundamental facts (each verified this session, not assumed)

1. **Every rule is a function of two *kinds* and one *face test*.** An import is judged by (kind of the importer's directory, kind of the target's directory, is the target the directory's `index.ts`), plus acyclicity over slices. Kinds: `kernel`, `access`, door (`store/<x>`), layer (`llm`, `audit`), slice (everything else under `src/`), the top slice (`erasure`), test. The matrix:

   | importer → may reach | kernel | access | door | layer | slice |
   | --- | --- | --- | --- | --- | --- |
   | kernel | – | – | – | – | – |
   | access | yes | – | – | – | – |
   | door | yes | `store/graph` only | – | – | – |
   | layer | yes | yes | yes | – | – |
   | slice | yes | yes | yes | yes | face only, acyclic, never `erasure` |
   | test | yes | yes | yes | yes | face only |

   plus rule 5 (no transport package inside core), a specifier-list test rather than a kind test.

2. **The kind of a directory is derivable from its position.** Three fixed names (`kernel`, `access`, `store`), two layer names (`llm`, `audit`), one top slice (`erasure`); every other directory under `src/` is a slice, every directory under `store/` is a door. No checked-in `layers.json` is needed: the "map" ADR 0029 asked for is a three-line table. A new slice or door classifies with no line anywhere; only a new *layer* needs one, and rule 3 names the layers, so a new one is an ADR amendment before it is a line.

3. **oxlint's `no-restricted-imports` sees the specifier string only.** It cannot resolve `../../x/index.ts` against the importer's path to learn what directory it lands in, and it knows the importer's kind only by the override's `files` glob. A glob can say "the specifier ends at a face" only by enumerating specifier shapes per nesting depth — why T-114's pattern names `store/` and `src/` and carries five negations — and it can say *direction* only with one override per importer kind, each replacing the base rule's options and so restating every ban.

4. **The T-114 glob holds rule 4's face clause and rule 5, and nothing else.** Probe 0 (§4.1) ran the real `packages/core/**` override over ten cases: three fired (the T-114 control, a re-export of an internal, a sibling internal from two levels down) and seven passed — kernel importing a slice's face, a door importing a slice's face, access importing a door, llm importing a slice, audit importing llm, a slice importing `erasure`, a self-reference to an internal file. **Rules 1, 2, 3 and "nothing imports erasure" are conventions today.** The tree obeys them by hand (§4.0), so no gate has fired on the gap; that is the failure the ADR's title names.

5. **oxlint's JS plugin API hands a rule everything a semantic check needs.** `context.filename` (absolute path of the file being linted), `context.cwd`, `context.options`, and the `ImportDeclaration` / `ExportAllDeclaration` / `ExportNamedDeclaration` nodes with `source.value`. Read in `@oxlint/plugins@1.80.0`'s `index.d.ts` (`FILE_CONTEXT`, lines 3725–3760; `Context.options`, line 4111) and proven by probe 2 (§4.3), where a 130-line rule resolved relative and self-reference specifiers and classified both ends, `context.filename` current inside a `createOnce` visitor.

6. **Package self-reference already works in this tree.** `packages/core/node_modules/@better-answers/` holds `devtools` and `schema` and no `core`; ten test files import `@better-answers/core/store/git`, `…/store/graph` and `…/concepts` today (13 of the 79 cross-directory imports under `test/`), so Node's self-reference (`name` + `exports`) is what tsc (nodenext) and vitest resolve them by. Probe 1 (§4.2) extended this to `src/` and to every tool.

7. **`import/no-cycle` follows a self-reference** (§4.2, 1b–1c): a two-file cycle written only as `@better-answers/core/<entry>` imports produced four `Dependency cycle detected` diagnostics, the same four as the relative-form control. Rule 4's acyclic clause is not blind under B.

8. **knip counts a self-import as a use**, and never reports a face's exports at all by default, because every `exports`-map target is a knip entry file (§4.2, 1d): with `--include-entry-exports` forced on, the unused control was reported and the self-imported export was not.

9. **A plugin rule costs nothing measurable.** Core's lint is 1.47 s warm under the real config and 1.45–1.61 s with the probe rule added (§4.3); the plugin process already runs fifteen anti-slop and two `better-answers` rules.

10. **The exports map is already a second face list.** `store/index.ts` is an empty face (`export {}`) nothing imports; the tier reaches doors as `@better-answers/core/store/postgres|git|graph`; `store/objects/index.ts` is not exported (knip ignores it by name until S1 lands the door). The face a slice imports (`../guides/index.ts`) and the face a transport imports (`./guides`) are one file reached by two conventions nothing ties together.

### 2.3 Assumptions rejected

- **"A checked-in `layers.json` is needed."** Fact 2. A data file restating the tree is a pair to hold both ways (`[TEST7]`) for a table of five names. The table lives in the rule as a typed constant, tested against the real tree.
- **"Self-reference form (B) makes the direction rule unnecessary."** An exports map says what is *reachable*, not *who may reach it*. Under B, `kernel/actor.ts` may import `@better-answers/core/concepts` and tsc accepts it. B buys rule 4's face clause structurally (a non-exported subpath fails to compile) and nothing of rules 1–3; and it still needs a lint to refuse a relative import that leaves its directory, or the guarantee is a convention again.
- **"The doors' nesting is the problem."** It is the glob's problem. A rule that resolves paths does not care how deep a door sits; flattening would touch the exports map, every import and every document naming a path, for nothing once the rule exists.
- **"Direction should be the compiler's (project references, a package per layer)."** Fourteen packages for five rules; Stryker, vitest, knip and `[TEST1]`'s exports map per package; pnpm does not refuse a workspace cycle. Far above a 130-line rule in assumption load.
- **"The table-ownership map can carry the directory kinds."** It maps *tables* to owners (`concepts`, `members`, `packages/core/src/store/graph`, `apps/worker`) and records cross-owner table access — the failure no import linter can see, ADR 0029's first mitigation. Its keys are tables; it has no row per directory and should not gain one. Two maps, two questions.
- **"The Python tier needs the same mechanism."** ADR 0005: the tiers share stores and never code. The worker's one import-direction line on the route — S1's "`pipeline/` is the one module that imports `cocoindex`, a ruff `TID251` entry refusing the import elsewhere" — is ruff's, in `pyproject.toml`; a TypeScript rule neither covers nor needs to cover it.

### 2.4 Constraints — real versus inherited

Real: oxlint 1.80.0 is the linter and its `no-restricted-imports` is specifier-only; override options replace, never merge; a rule lands with a throwaway-tree test (`[CHECK1]`) and cites its ADR (`[COMMENT2]`); tsc runs `nodenext` with `.ts` extensions on every relative import; `[TEST1]` says a core test reaches an entry point the exports map names.

Inherited and challengeable: the per-glob override as *the* mechanism (the ADR itself set the trigger to replace it, and the trigger has passed — 13 directories under `src/`, 4 under `store/`); relative import form inside core (web chose the other form for the same reason: its zone overrides can only read `@/<zone>/…`); a `layers.json` file; the doors' nesting.

### 2.5 Causal structure

The nine `no-restricted-imports` overrides and eight restatements of the drizzle-zod ban exist because one tool was asked two questions it cannot answer — *which directory did this specifier land in* and *what kind is the importer* — so the config answers by enumerating shapes and by splitting the tree into globs, and the replace-not-merge semantic then multiplies every unrelated ban by the number of splits. Move both questions into a rule that resolves paths and the core override has no reason to exist: rules 1–4 become semantic, rule 5 rides in the same rule as a specifier list, and the base `**/*.ts` override's two bans reach core with no restatement.

### 2.6 False complexity

Four candidates; two survive decomposition (A and B), and B turns out to be a *form* the rule should accept rather than a mechanism. The choice is one rule, and the design decisions inside it are (i) kinds by position versus a data file (position), (ii) whether the rule also requires a reached face to be an `exports`-map entry (yes — it ties the two face lists of fact 10 together at no cost, and is what `[TEST1]` already asks of a test), (iii) whether rule 5's list lives in the rule or the config (in the rule, cited to ADR 0029; the config's one line switches it on).

## 3. What the route adds to core, block by block

From `docs/specs/v01-route.md` (10/09/2026). What matters is whether a block adds a directory of a new *kind*, since a new slice or door classifies by position.

| Block | Adds to `packages/core/src` | Kind | Needs a line under the rule? |
| --- | --- | --- | --- |
| S0 | The erasure slice's implementation (today an empty export) | slice (top) | no |
| S1 | `store/objects` exported (`putObject`/`getObject`); `sources` gains `passageAt`; `runs` gains `enqueueJobIn` | door, slice | no — positional; the exports map gains `./store/objects` for the transport anyway |
| S2 | The model client behind the route record in `llm`; `answering` split into plan · draft · record | layer, slice | no — `llm` is already a layer; a subdirectory under `answering` resolves at two levels |
| S3 | `concept_owner` on `concepts`; `guides` grows | slice | no |
| S4, S7 | worker-side; `sources`, `runs`, `concepts` grow | slice | no |
| S5 | `concepts` grows | slice | no |
| S6 | `question_set`/`question` rows (a slice, or on `answering`); the deferred principal's type in `kernel` | slice, kernel | no |
| O1 | "the signal module" over `backup_run`, `platform_event`, thresholds | slice, most likely | no if it is a slice reading other slices' rows through their faces or the ownership map's cross-owner entries; **one line plus an ADR 0029 rule-3 amendment if O1 makes it a layer every slice imports** — the only foreseeable rule edit on the route |
| P1, P2 | `members`, `workspaces` grow; api-side | slice | no |
| V1 | verification acts, on `concepts` or a slice of their own | slice | no |
| S8 | worker-side; `answering` | slice | no |
| C1 | nothing structural | – | no |

The worker takes no part: its one import rule on the route is ruff's (`TID251` for `cocoindex`, S1), in a tier that shares no code with core.

## 4. Probes — commands and verbatim results

All on branch `probe/import-direction` in the worktree `/Users/liamj/Documents/development/better-answers/.claude/worktrees/agent-af191c66fbfe4361a`, base `66006a5`. Versions read from the tree: oxlint 1.80.0, `@oxlint/plugins` 1.80.0, knip 6.34.0, vitest 4.1.11, Stryker 10.0.0, TypeScript 7.0.2, Node v24.19.0, pnpm 11.24.0. Docker 29.4.0 was up, so core's suite ran over its Testcontainers Postgres.

### 4.0 The tree today, by importer directory (baseline)

```
cd packages/core/src && grep -rn --include='*.ts' -E '^(import|export)[^;]*from "\.\./' . | … | sort | uniq -c
```

```
   1 access -> ../kernel/index.ts
   3 answering -> ../concepts/index.ts
   1 answering -> ../kernel/index.ts
   1 answering -> ../store/postgres/index.ts
   3 audit -> ../kernel/index.ts
   1 audit -> ../store/postgres/index.ts
   5 concepts -> ../audit/index.ts
   4 concepts -> ../store/postgres/index.ts
   3 concepts -> ../access/index.ts
   3 concepts -> ../kernel/index.ts
   3 concepts -> ../store/graph/index.ts
   2 concepts -> ../guides/index.ts
   2 concepts -> ../store/git/index.ts
   1 concepts -> ../members/index.ts
   1 concepts -> ../workspaces/index.ts
   1 guides -> ../store/postgres/index.ts
   1 llm -> ../kernel/index.ts
   1 llm -> ../store/postgres/index.ts
   3 members -> ../audit/index.ts
   2 members -> ../store/postgres/index.ts
   1 members -> ../kernel/index.ts
   1 members -> ../workspaces/index.ts
   1 runs -> ../store/postgres/index.ts
   1 sources -> ../access/index.ts
   1 sources -> ../audit/index.ts
   1 sources -> ../guides/index.ts
   1 sources -> ../store/postgres/index.ts
   1 store/graph -> ../../access/index.ts
   1 store/graph -> ../../kernel/index.ts
   1 store/postgres -> ../../kernel/index.ts
   1 workspaces -> ../audit/index.ts
   1 workspaces -> ../kernel/index.ts
```

All 62 land on a face; `kernel` imports nothing; `access` imports only `kernel`; the doors import `kernel` and (graph alone) `access`; `llm` and `audit` import `kernel` and the postgres door; nothing imports `erasure`; the slice graph (answering → concepts → guides, members → workspaces; sources → guides) is acyclic. Rules 1–4 hold by hand today, so the rule proposed below fires on nothing the day it lands (confirmed in §4.3).

Tests reach `src` 79 ways: 66 relative (`../src/<dir>/index.ts`, every one a face) and 13 by self-reference (`@better-answers/core/store/git` ×8, `…/store/graph` ×4, `…/concepts` ×1).

Baseline, untouched tree, `packages/core`:

```
$ for i in 1 2 3; do /usr/bin/time -p pnpm exec oxlint --config ../../.oxlintrc.json . ; done
real 2.83   (cold)
real 1.48
real 1.47
$ /usr/bin/time -p pnpm exec tsc --noEmit
real 1.44
```

### 4.1 Probe 0 — what the T-114 glob holds (approach C's ceiling)

Script `/tmp/probe-glob-holes.sh`: lifts the real `packages/core/**` override out of `.oxlintrc.json` verbatim into a throwaway tree's config, writes ten one-line files, runs `oxlint --format=unix`.

```
packages/core/src/kernel/probe.ts            import "../concepts/index.ts"            rule 1
packages/core/src/store/graph/probe.ts       import "../../concepts/index.ts"         rule 2 (door → slice)
packages/core/src/access/probe.ts            import "../store/postgres/index.ts"      rule 2 (access → door)
packages/core/src/llm/probe.ts               import "../concepts/index.ts"            rule 3 (layer → slice)
packages/core/src/audit/probe.ts             import "../llm/index.ts"                 rule 3 (audit → llm)
packages/core/src/concepts/probe.ts          import "../erasure/index.ts"             rule 4 (erasure on top)
packages/core/src/concepts/reexport.ts       export * from "../guides/renderer.ts"    rule 4 via export-from
packages/core/src/answering/plan/probe.ts    import "../../concepts/inbox.ts"         rule 4 from a subdirectory
packages/core/src/concepts/selfref.ts        import "@better-answers/core/concepts/inbox.ts"   rule 4 by self-reference
packages/core/src/concepts/control.ts        import "../guides/renderer.ts"           the T-114 control
```

Output, verbatim:

```
packages/core/src/concepts/reexport.ts:1:1: '../guides/renderer.ts' import is restricted from being used by a pattern. [Error/eslint(no-restricted-imports)]
packages/core/src/concepts/control.ts:1:1: '../guides/renderer.ts' import is restricted from being used by a pattern. [Error/eslint(no-restricted-imports)]
packages/core/src/answering/plan/probe.ts:1:1: '../../concepts/inbox.ts' import is restricted from being used by a pattern. [Error/eslint(no-restricted-imports)]

3 problems
exit: 0
```

**Verdict.** Three fired, seven silent. The glob holds rule 4's face clause (also through `export … from` and from a slice subdirectory) and rule 5; rules 1, 2, 3 and "nothing imports erasure" it cannot see, and a self-reference to a non-exported internal is invisible to it (tsc refuses that one, only because the subpath is not in the exports map). Approach C's ceiling is two of five rules, and reaching the other three by glob means one override per kind — five or six more, each restating the drizzle-zod and better-auth bans.

### 4.2 Probe 1 — package self-reference (approach B)

**1a. Rewrite.** Three real cross-directory imports in `src` and one in `test`:

- `src/audit/index.ts`: `../kernel/index.ts` ×2 → `@better-answers/core/kernel`; `../store/postgres/index.ts` → `@better-answers/core/store/postgres`
- `src/store/graph/index.ts`: `../../access/index.ts` → `@better-answers/core/access`; `../../kernel/index.ts` → `@better-answers/core/kernel`
- `test/kernel.test.ts`: `../src/kernel/index.ts` → `@better-answers/core/kernel`

```
$ cd packages/core && pnpm exec tsc --noEmit ; echo "tsc exit: $?"
tsc exit: 0
$ pnpm exec oxlint --config ../../.oxlintrc.json --format=unix . ; echo "oxlint exit: $?"
oxlint exit: 0
$ pnpm exec vitest run test/kernel.test.ts test/audit.test.ts
 RUN  v4.1.11 …/packages/core
 Test Files  2 passed (2)
      Tests  31 passed (31)
   Duration  3.37s (transform 272ms, setup 0ms, import 972ms, tests 369ms, environment 0ms)
$ cd ../.. && pnpm exec knip --reporter compact ; echo "knip exit: $?"
knip exit: 0
```

(`audit.test.ts` runs over the migrated Postgres, so vitest resolved the self-reference at runtime, not only in types. knip's compact reporter prints nothing when it finds nothing; `@better-answers/core` was not reported as an unlisted dependency of `packages/core`, so knip resolved the self-reference as the package itself.)

**1b. A cycle through self-references only.** `src/kernel/probe-a.ts` (`import { probeB } from "@better-answers/core/access"`), `src/access/probe-b.ts` (`import { probeA } from "@better-answers/core/kernel"`), one `export { … } from` line on each face.

```
$ pnpm exec oxlint --config ../../.oxlintrc.json --format=unix .
src/access/probe-b.ts:1:24: Dependency cycle detected [Error/import(no-cycle)]
src/kernel/probe-a.ts:1:24: Dependency cycle detected [Error/import(no-cycle)]
src/kernel/index.ts:63:24: Dependency cycle detected [Error/import(no-cycle)]
src/access/index.ts:282:24: Dependency cycle detected [Error/import(no-cycle)]
src/access/probe-b.ts:4:38: This condition will always return the same value since the types have no overlap. [Error/typescript(no-unnecessary-condition)]

5 problems
oxlint exit: 1
$ pnpm exec tsc --noEmit ; echo "tsc exit: $?"
tsc exit: 0
```

**1c. Control — the same cycle as relative face imports** (`../access/index.ts`, `../kernel/index.ts`):

```
src/kernel/index.ts:63:24: Dependency cycle detected [Error/import(no-cycle)]
src/kernel/probe-a.ts:1:24: Dependency cycle detected [Error/import(no-cycle)]
src/access/probe-b.ts:1:24: Dependency cycle detected [Error/import(no-cycle)]
src/access/index.ts:282:24: Dependency cycle detected [Error/import(no-cycle)]
4 problems
oxlint exit: 1
```

**Verdict.** `import/no-cycle` resolves a package self-reference exactly as a relative import: the same four diagnostics. The silent control — the untouched tree lints clean — is §4.0.

**1d. knip and a self-imported export.** On the kernel face: `export const probeOnlySelfRef = 1` (imported only by `audit/index.ts` as `@better-answers/core/kernel`) and `export const probeUnused = 2` (imported by nothing — the control). On the audit face: `export const PROBE_SELF_REF = probeOnlySelfRef` (imported by nothing).

```
$ pnpm exec knip --reporter compact ; echo "knip exit: $?"
knip exit: 0
```

Nothing — not even the control — so that run cannot be read. With entry-file exports included:

```
$ pnpm exec knip --reporter compact --include-entry-exports | grep -iE "probe|core/src"
packages/core/src/access/index.ts: EVERYONE, narrower, audienceIntersection, KIND_FLOOR
packages/core/src/audit/index.ts: PROBE_SELF_REF
packages/core/src/kernel/index.ts: normalizeError, probeUnused
…
```

**Verdict.** The control (`probeUnused`) and the never-imported `PROBE_SELF_REF` are named; `probeOnlySelfRef`, `probeA` and `probeB` — each reached only by a self-import — are not. knip 6.34 counts a self-reference as a use. By default it reports no export of a face at all, because every `exports`-map target is an entry: a face's unused export is no knip finding today under either import form. (The flag also surfaced five pre-existing unused face exports — `EVERYONE`, `narrower`, `audienceIntersection`, `KIND_FLOOR`, `normalizeError` — a hygiene note, not this probe's subject.)

**1e. Stryker 10 with the self-reference rewrite in place.** `stryker.config.mjs` runs `inPlace: true` (the sandbox's `extends` rewrite broke under TypeScript 7), so Stryker instruments the files where they stand and the resolution is vitest's own. One bounded run, with only 1a's three rewrites present and the 1b–1d artefacts removed:

```
$ cd packages/core && pnpm exec stryker run --mutate "src/audit/index.ts" --concurrency 2
13:20:07 INFO ProjectReader  No incremental result file found at reports/mutation/stryker-incremental.json, a full mutation testing run will be performed.
13:20:07 INFO ProjectReader  Found 1 of 69 file(s) to be mutated.
13:20:07 INFO Instrumenter   Instrumented 1 source file(s) with 49 mutant(s)
13:20:07 INFO ConcurrencyTokenProvider  Creating 2 test runner process(es).
13:20:07 INFO Sandbox        In place mode is enabled, Stryker will be overriding YOUR files. Find your backup at: reports/mutation/.stryker-tmp/backup-0vBc9z
13:20:08 INFO DryRunExecutor Starting initial test run (vitest test runner with "perTest" coverage analysis). This may take a while.
13:24:58 INFO DryRunExecutor Initial test run succeeded. Ran 390 tests in 4 minutes and 50 seconds (net 251721.90129799995 ms, overhead 38746.09870200005 ms).
13:24:58 WARN MutantTestPlanner Detected 35 static mutants (71% of total) that are estimated to take 100% of the time running the tests!
Mutation testing 94% (elapsed: ~11m, remaining: <1m) 47/49 tested (0 survived, 2 timed out)
Detecting unexpected exit, recovering original files from reports/mutation/.stryker-tmp/backup-0vBc9z
13:36:06 INFO MutationTestReportHelper Saved a partial incremental report to "reports/mutation/stryker-incremental.json" after an unexpected interrupt.
stryker exit: 130
```

The run was interrupted by SIGINT at 13:36:06 at the session's ten-minute bound on the mutation phase, two mutants short; Stryker recovered the in-place files from its backup (`git status` afterwards showed only 1a's three rewrites). The partial incremental report, read before it was deleted with the git-ignored `reports/` directory:

```
src/audit/index.ts {"NoCoverage":1,"Killed":44,"Timeout":2} mutants: 47
test files that killed a mutant: test/audit.test.ts, test/concepts.test.ts, test/invisibility.test.ts, test/reconciler.test.ts
```

**Verdict — proven:** Stryker's vitest runner loads a test that imports by self-reference (`kernel.test.ts` was among the 390 of the dry run) and an *instrumented* source file that imports by self-reference (`audit/index.ts`, whose 44 killed mutants were killed through four test files). The slowness is the config's own (35 of 49 mutants are static and each runs the whole related suite over Postgres; the nightly's `ignoreStatic` stays off by decision), not the self-reference's. **Not run:** the sharper reading queued behind this one — mutating a *kernel* file so that Stryker's per-mutant `vitest.related` selection has to follow a self-reference edge (`kernel.test.ts → @better-answers/core/kernel`; `audit/index.ts → @better-answers/core/kernel`) to find the killing tests. If vitest's module graph did not follow that edge, a kernel mutant would report `testsCompleted: 0`, which `[TEST6]` names a runner fault. The four killing files above all reach `audit/index.ts` by relative imports, so this run says nothing about that edge. A follow-up that wants to adopt the self-reference form in `src` runs `pnpm exec vitest related src/kernel/actor.ts --run` with and without the rewrite and compares the test-file lists — one minute each — before it does.

### 4.3 Probe 2 — a semantic rule in the repository's own plugin (approach A)

Files (throwaway; committed on this branch as the seed for the follow-up, never merged):

- `packages/devtools/lint-rules/rules/import-direction.ts` — 130 lines. Classifies `context.filename` and the resolved target by position (`kernel` / `access` / `store/*` door / `llm`,`audit` layer / `erasure` top slice / other slice / `test`), resolves a relative specifier with `path.resolve` and a `@better-answers/core/<entry>` specifier through the package root, applies the matrix of §2.2 fact 1, reports with the ADR 0029 rule number. Visits `ImportDeclaration`, `ExportAllDeclaration`, `ExportNamedDeclaration`.
- `packages/devtools/lint-rules/index.ts` — one `rules` entry.
- `apps/api/tests/import-direction-probe.test.ts` — 29 cases through `oxlintOver`, the plugin resolved from the repository as `lint-rules.test.ts` does.

```
$ cd apps/api && pnpm exec vitest run tests/import-direction-probe.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Duration  8.76s (transform 10ms, setup 0ms, import 215ms, tests 6.37s, environment 0ms)
```

The 14 firing cases: a slice reaching a sibling's internal file; from a slice subdirectory two levels up; a slice importing `erasure`'s face; a self-reference to a sibling's internal file; a test reaching a slice internal; kernel importing a slice's face; kernel importing `access`; access importing a door; the postgres door importing `access`; the graph door importing a slice's face; a door importing another door; audit importing llm; llm importing a slice's face; audit importing a slice by self-reference. Plus a re-export of a sibling's internal. The 14 silent cases: a slice importing a sibling's face, a door's face, a layer's face, its own internal, a sibling's face from a subdirectory two up, a sibling's face by self-reference; the graph door importing `access` and `kernel`; access importing kernel; audit importing a door; a test importing a slice's face and a door's face by self-reference; a bare third-party package; the same relative import outside core.

(One case was first written wrong and corrected: `concepts/landing.ts` importing `@better-answers/core/concepts/inbox.ts` is a same-directory import, which the rule rightly ignores; the case now targets `…/guides/renderer.ts`.)

Typecheck and lint of the probe files under the real config:

```
$ cd packages/devtools && pnpm exec tsc --noEmit ; echo "devtools tsc exit: $?"
devtools tsc exit: 0
$ pnpm exec oxlint --format=unix packages/devtools/lint-rules/rules/import-direction.ts packages/devtools/lint-rules/index.ts apps/api/tests/import-direction-probe.test.ts
packages/devtools/lint-rules/rules/import-direction.ts:34:62: The explicit open dictionary type on binding `MAY_REACH` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract. [Warning/anti-slop(no-known-value-widening)]
1 problem
```

**Timing.** A root-level copy of the real config with one line added (`"better-answers/import-direction": "error"`), runs interleaved, `packages/core`, warm:

```
-- real config --            real 1.48
-- with import-direction --  real 1.45
-- real config --            real 1.47
-- with import-direction --  real 1.45
-- real config --            real 1.47
-- with import-direction --  real 1.61
```

Within run-to-run noise (about ±0.1 s); the JS plugin process already runs.

**Findings over the real core tree** with the rule on (1a's three self-reference rewrites present):

```
$ pnpm exec oxlint --config ../../.oxlintrc.probe.json --format=unix . | grep -c "import-direction"
0
```

**Verdict.** The plugin API gives the rule the importer's path and the specifier; one semantic rule holds all five rules in both import forms, through `export … from`, for a test as for a slice; the throwaway-tree runner tests it both ways; it fires on nothing in the tree today; its cost is noise.

## 5. The options, by assumption load

| | Rules held | New slice / door | Restatements | Extra assumptions | Sessions |
| --- | --- | --- | --- | --- | --- |
| **C** keep the globs, pin them | 4 (face clause) and 5; 1–3 stay conventions | none for a flat slice; a slice with a subdirectory that grows a face of its own is ambiguous | 8 + 5 today, rising with every zone | that a specifier's shape is the same fact as its target — false at the second nesting depth | 0 now; unbounded later |
| **A** one semantic rule | all five, both forms | none (positional); a new *layer* is one line and an ADR amendment | core's override deleted: −1 override, −2 restatements | that the plugin API exposes the path and specifier — proven | 1 |
| **B** self-reference form | rule 4's face clause at compile time; 1–3 still need a rule; a relative import leaving its directory still needs a ban | none for the map; every new face needs an `exports` line (needed for the transport anyway) | unchanged unless combined with A | that every tool resolves a self-reference — proven except Stryker's per-mutant `related` selection (§4.2 1e); that 128 mechanical rewrites are worth a session — not shown | 1 + A |
| **D** flatten doors / a package per layer | as A / all by the compiler | a rename / a package each | as A / n packages of config | that the tree's shape is the problem — it is the glob's | 1–3 |

## 6. Recommendation

**Approach A, refined by the probes: one `better-answers/import-direction` rule in `packages/devtools/lint-rules/`, kinds by position, accepting both import forms, replacing the whole `packages/core/**` override.**

1. **Kinds by position, not a data file.** `kernel`, `access`, `store/<door>`, the layers `llm` and `audit`, the top slice `erasure`, every other `src/` directory a slice, `test/` a test. The table is a typed constant in the rule; its both-ways test walks the real tree (every directory under `packages/core/src` classifies to a kind; every named layer and the top slice exist). A new slice or door lands with no line anywhere; a new layer is one line after the ADR 0029 rule-3 amendment that names it.
2. **The matrix of §2.2 fact 1**, with the graph door's `access` as the one named exception, and `erasure` refused as a target from anywhere but a test. Messages carry the rule number.
3. **The face is the exports map.** A cross-directory import must land on the target directory's `index.ts` *and* that file must be an `exports`-map target of `packages/core/package.json` (read once per process from the nearest package root). This ties the two face lists of fact 10 together: a face a sibling may import is exactly a face a transport may import, and `[TEST1]` becomes the same check for a test. `store/index.ts`, the empty face nothing imports, is then exported for a reason or deleted — a hygiene line, not this rule's.
4. **Both forms are accepted**: `../<dir>/index.ts` at any depth, and `@better-answers/core/<entry>`. No rewrite of the 62 `src` imports is required and none is recommended: B's form buys nothing A does not hold once point 3 is in, and the one tool reading it did not finish (§4.2 1e). Tests may move to the package name over time since every tool resolves it (13 already do); that is style, not mechanism.
5. **Rule 5 rides in the same rule** as a specifier-prefix list (`hono`, `@hono/`, `@trpc/`, `@modelcontextprotocol/`, `better-auth`, `@better-auth/`, `node:http`, `node:http2`, `node:https`), cited to ADR 0029 rule 5, so the `packages/core/**` override is deleted outright and the base `**/*.ts` override's drizzle-zod and better-auth bans reach core with no restatement. The web zone overrides are untouched — same disease, separate task; the rule's kind table is keyed by package so web's `app → features → shared` can join later without a second mechanism.
6. **`import/no-cycle` stays** as the acyclicity gate; it sees both forms.
7. **Tests.** `packages/core/test/import-direction.test.ts` is rewritten over the plugin rule through `oxlintOver` — probe 2's 14 + 14 cases are the seed, plus the transport-ban cases it holds today, plus the tree walk of point 1 and an assertion that the real tree lints clean. The "last override to set `no-restricted-imports` over core" shape test goes with the override it guarded.
8. **Documents.** ADR 0029 gains a dated amendment: rule 4's `no-restricted-imports` pattern (T-114) superseded by the plugin rule; rules 1–3 and the erasure clause lint-held for the first time; the "checked-in `layers.json`" sentence corrected to kinds by position; the exports map named as the face list. `docs/adr/README.md`'s 0029 line moves in the same commit; `packages/devtools/README.md` names the rule; `.oxlintrc.json`'s core-override comment goes with the override.

**Cost: one session.** The rule is 130 lines already; the test, the config swap, the ADR amendment and the README line are the rest. The probe branch's rule and test are the seed, not the deliverable — the probe hardcodes `core` as the package root and does not read the exports map.

**Main risk.** A rule that resolves paths must find the package root the same way in the real tree and in a throwaway tree; the probe located it by the `core` path segment, which the real rule replaces with the nearest `package.json` (the throwaway test then scaffolds one). `context.options` was not exercised; if the transport list is to be config-borne rather than a constant, the plugin's options plumbing needs its own silent-and-firing case.

**What would change the answer.** If oxlint gained `import/no-restricted-paths` with resolved-path zones, the glob approach would hold direction natively and A's rule would shrink to the exports-map face check — a future oxlint, and the rule is no harder to delete for existing.

## 7. The follow-up ordna task (for the caller to cut)

**Title.** ADR 0029's five import-direction rules as one semantic lint rule, `better-answers/import-direction`, replacing the `packages/core/**` override

**Goal.** Hold all five of ADR 0029's import-direction rules — today only rule 4's face clause and rule 5 are lint-held; rules 1, 2, 3 and "nothing imports erasure" are conventions the tree obeys by hand — in one rule in the repository's own oxlint plugin that resolves the importer and the target to a kind by position under `packages/core/src`, accepts both the relative and the `@better-answers/core/<entry>` form, requires a reached face to be an `exports`-map entry, and carries rule 5's transport list, so that the `packages/core/**` `no-restricted-imports` override and its two restatements are deleted and no route block's new slice or door needs a line anywhere. Probe record: `.scratch/import-direction/FINDINGS.md` on branch `probe/import-direction`, with the probe rule and test beside it.

**Acceptance criteria.**

- [ ] `packages/devtools/lint-rules/rules/import-direction.ts` classifies a core file by position — `kernel`, `access`, `store/<door>`, the layers `llm` and `audit`, `erasure` as the top slice, every other `src/` directory a slice, `test/` a test — with the kind table a typed constant in the rule and the package root found from the nearest `package.json`, never a path segment.
- [ ] The rule refuses, with a message naming the ADR 0029 rule number: kernel importing anything in core (1); access importing anything but kernel, a door importing anything but kernel except `store/graph` importing access, a door importing a door (2); llm or audit importing a slice or each other (3); a cross-directory import that does not land on the target's `index.ts`, any import of `erasure` from outside `test/`, and — through `import/no-cycle`, unchanged — a slice cycle (4); a transport package or its dependency from the ADR's list (5). It reads `ImportDeclaration`, `ExportAllDeclaration` and `ExportNamedDeclaration` alike.
- [ ] A cross-directory import's face must be a target of `packages/core/package.json`'s `exports` map; a face the map does not name is refused with a message saying to export it.
- [ ] Both forms resolve — `../<dir>/index.ts` at any depth and `@better-answers/core/<entry>` — and a same-directory import is never judged.
- [ ] `packages/core/test/import-direction.test.ts` runs the rule through `@better-answers/devtools/throwaway-tree`'s `oxlintOver` with the plugin resolved from the repository; holds every refusal above where it fires and its counterpart where it stays silent (the probe's 14 + 14 cases and today's transport-ban cases are the seed); stays silent for the same imports outside `packages/core`; walks the real tree so every directory under `packages/core/src` classifies to a kind and every named layer and top slice exists (`[TEST7]`); and asserts the real tree lints clean under the rule (`[CHECK1]`).
- [ ] `.oxlintrc.json` switches the rule on in the base `rules` block and the `packages/core/**` override is deleted with its comment; the base `**/*.ts` override's drizzle-zod and better-auth bans now reach core unrestated; `apps/api/tests/lint-rules.test.ts`'s runner no longer lifts a core override, and its ADR 0030 case (no MCP library type in core) still fires, through the plugin rule.
- [ ] Core's lint time over `packages/core` is within noise of today's (~1.5 s warm), measured and stated in the PR.
- [ ] ADR 0029 gains a dated amendment (rule 4's T-114 pattern superseded by the plugin rule; rules 1–3 and the erasure clause lint-held; the `layers.json` sentence corrected to kinds by position; the exports map named as the face list); `docs/adr/README.md`'s 0029 line updated in the same commit; `packages/devtools/README.md` names the rule.
- [ ] No source import in `packages/core` is rewritten for this task; the web zone overrides are untouched and named as a follow-on in the ADR amendment.
- [ ] Root `check` green.

**Notes.** ADR 0029 (rules 1–5; the T-114 amendment); `[CHECK1]`, `[COMMENT2]`, `[TEST1]`, `[TEST7]`. Hygiene lines the probe surfaced, not this task's: `store/index.ts` is an empty exported face nothing imports; `knip --include-entry-exports` names five unused face exports (`EVERYONE`, `narrower`, `audienceIntersection`, `KIND_FLOOR` on access; `normalizeError` on kernel); a run that wants the self-reference form in `src` first compares `vitest related src/kernel/actor.ts` with and without the rewrite.

## 8. Housekeeping

- `packages/core` restored to `66006a5` (`git checkout -- packages/core` after Stryker's own recovery); Stryker's `stryker-setup-*.js` and its `reports/` directory (neither existed before, both git-ignored) deleted; `.oxlintrc.probe.json` deleted; two stray Stryker worker processes ended. `/tmp/probe-glob-holes.sh` and `/tmp/stryker-probe.log` are outside the tree.
- This file, the probe rule, its registration line and the probe test are committed on `probe/import-direction` (`git add -f` for this file — `.scratch/` is git-ignored) so the seed survives; the branch is never merged.
- The main working tree was not touched; no ordna task was cut; no document under `docs/` was edited.
