# Mutation triage: controls both ways, one waiter, staging by path

A mutation report (`[TEST6]`) names survivors; a triage session decides which are gaps and which are equivalent, and turns the gaps into tests. Three habits keep that session honest, and each was learned in the T-009 wave by getting it wrong once. A verdict in a triage document is a hypothesis: `audit/index.ts:89` was triaged *equivalent* and is killed today, and `readWorkspaceConfig`'s verdict described the mutant rather than the code. Read the source before the verdict, and probe before calling anything.

## Controls

A **probe** is one mutation applied by hand, the suite run against it, the file restored. Run it through the script and nothing else:

```bash
pnpm mutant-probe --file packages/core/src/audit/index.ts --line 149 \
  --from 'principal.kind === "user"' --to 'false' [--suite audit] [--timeout-ms 600000]
```

`scripts/mutant-probe.mjs` pins the mutation to the text on the line it names and refuses a line that has moved; refuses a file with an unstaged change, so it never restores over someone's edit; restores in a `finally` that an interrupt, a crashed suite and a thrown error all reach; prints one `verdict:` line — `killed`, `survived`, `timed out` — and then the `src` diff-stat against `HEAD`, exiting non-zero when the tree is not clean. `--suite` is a vitest filter for the file's workspace; without it the whole workspace suite runs.

A harness that answers only one way says nothing. Before any verdict from a probe or a differential harness is written down:

- **A positive control** — a mutant the report says `Killed` — comes back `killed`. A suite broken for an unrelated reason kills everything, and reads exactly like a working one.
- **A negative control** — a mutant the report says `Survived` — comes back `survived`. A harness that could not apply its mutation kills nothing and reads exactly like a clean sweep.
- **The whole suite**, never one file, decides a survival: a per-file `survived` may only mean that file has no covering test. `--suite` narrows a kill, never an equivalence call.
- **The same line's opposite** is the best pair: `audit/index.ts:149`'s `true` survives (node-postgres sends `undefined` and `null` as the same NULL) and its `false` dies (RLS refuses the scope mismatch). One expression, two verdicts, is a harness that discriminates.
- **`testsCompleted` is nonzero** before a row is called a survivor. A row with `testsCompleted: 0` was never run — the runner resolved its covering tests to nothing — and since T-097 the planner marks such a static mutant `Ignored` rather than `Survived`; a row that still shows zero is a runner fault to report, not a gap to close.

Equivalence has two classes, and only one is a proof. *Behaviourally identical, argued from the code* — the mutant cannot produce a different statement, row or value. *Nothing observable at this seam* — the two functions differ, and no caller, driver or fixture in this tree can reach the difference. Label the second as the second: a test written with a bespoke fixture purely to move the number is the report inverting the rule, and `[TEST6]` says a falling score is never a gate.

## Waiting on a long run

A Stryker pass over a module is tens of minutes; a session that polls it in turns spends its budget saying "still waiting". The recipe:

1. **Write the classification down first.** Before the run starts, the running verdict table goes to a file in the worktree (`reports/` is git-ignored and beside the run's own output). A result that lives only in a message may never be sent: T-089's four passes finished after its session died and nothing read them.
2. **Arm one waiter on the report file**, not on the process: `until [ -f packages/core/reports/mutation/mutation.json ]; do sleep 30; done`. If a waiter must watch the process, `pgrep -f "[s]tryker"` — the bracket keeps the waiter's own command line from matching itself, which is how a waiter hangs forever.
3. **Do read-only work meanwhile**: read source for the next rows, re-anchor the triage's line numbers against `HEAD`, draft the tests. Nothing that edits a file under `src` while the run has the tree instrumented (`inPlace: true`).
4. **Per-file passes** for anything over roughly four hundred mutants, each with `--force` so no pass reuses `stryker-incremental.json` from the last (the file holds only the last pass's results). `--no-incremental` is the flag's negation; `--incremental false` reads `false` as a config filename and aborts.
5. **An interrupted pass writes no report** and leaves the tree instrumented — every mutated file rewritten with a `// @ts-nocheck` prologue. Recover with `git checkout -- packages/core/src` and read `git status --porcelain --untracked-files=all` before anything else.

## Staging

The tree a triage session commits from has had mutants applied to it, a runner instrumenting it and a suite writing under it. Stage from what is read, never from what is remembered:

1. `git status --porcelain --untracked-files=all` — bare `git status` hides what is inside an untracked directory, and a mutation run leaves exhaust there (`packages/core/undefined/` once, a bare repository a mutated git door wrote).
2. **Stage by path**: `git add <file> <file>`; never `git add -A`, never `git add .`. An untracked directory of exhaust and an instrumented file both ride a broad add.
3. **Confirm the `src` diff before a PR**: `git diff --stat origin/main..HEAD -- packages/core/src` (and the tier's) — a tests-only branch shows nothing, a branch that changed source shows exactly the files it meant to. The probe prints the working-tree half of this after every run; this is the committed half.
4. **The gates a branch never narrows** run before the report is written (`[CHECK9]`): the root `check` line's steps ahead of `check:workspaces`, and each touched workspace's `typecheck`. The suites may narrow to the ones the branch touches; the root `check` runs once, in full, before the PR.

Expected values in the tests a triage writes are literals (`[TEST9]`): the survivor that outlived a test which computed its expectation from the code is the commonest shape in the wave, and the fix is to write the sentence, the frontmatter or the hash down.
