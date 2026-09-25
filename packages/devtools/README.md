# `@better-answers/devtools`

The repository's own gate tooling. **It is imported and never deployed** — `packages/` is what
is imported, `apps/` is what deploys (ADR 0029) — so nothing under `apps/` copies this
directory into an image, and every dependency here is a development dependency.

Eight things live here.

## `src/throwaway-tree.ts` — the runner

The one helper that writes a map of paths to sources into a temporary directory, runs a named
tool's command line over it, and returns what the tool wrote. It exists for one failure: a
tool that could not run at all reports nothing, and a suite that reads nothing as "the rule
stayed silent" then passes while enforcing nothing. So only the tool's own "I found
something" exit is tolerated, every other exit is re-thrown with both of the tool's streams,
and a smoke case proves the reporter's shape before any caller is allowed to read a silence.

The tool is a parameter — which package holds the binary, the command line, the exits that
mean a finding, the environment it runs in, and the smoke case — so a second and a third tool
run through this helper rather than each writing its own. Three tools run through it today,
each with a built form that reads its reporter: `oxlintOver`, which the lint-rule suites take,
`knipOver`, which reads knip's JSON report as a list of findings, and `jscpdOver`, from the
module beside it. Imported through `@better-answers/devtools/throwaway-tree`.

Beside the runner, for the tools whose subject is a git repository rather than a flat tree —
the worktree provisioning stage, the mutant probe — `throwawayRepository`, `gitIn` and
`writeUnder` make one, run git in it and write under it; the suite that uses them builds the
commits, links and worktrees its case needs and keeps the runner's two fences by hand.

A tool's binary is found through the module graph, and a package that withholds its own
manifest from its `exports` map — knip does — is reached through its entry instead, so the
resolution never becomes a guessed path. Every tool run this way is a devDependency of this
package, because that is where the resolution starts.

`oxlintOver` also hands the child the path to `tsgolint`, the binary oxlint spawns for its
type-aware rules. oxlint finds that binary by walking up from its working directory, and a
throwaway tree lives where there is no `node_modules` to walk up to — so without this every
type-aware rule would read as silent, which is the failure this whole helper exists to make
impossible. A tree that a type-aware rule is asserted over carries a `tsconfig.json`, because
the type-aware linter needs a program to type the files it lints.

Two modules sit beside it, for the two tools whose gates read a file this repository owns.

`src/jscpd.ts` turns a set of copy-paste settings into jscpd's command line, in one place, so
the gate (`scripts/jscpd.mjs`, driven by the root `jscpd.config.mjs`) and the suite that
proves the gate fires run the tool the same way. The values live in a JavaScript module and
not in jscpd's own `.jscpd.json` because every exclusion has to carry the reason it is there,
and jscpd 5 parses that file strictly, reports a parse it refused, and then scans on its
defaults and exits zero — a config nobody could read reading exactly like a tree with nothing
in it. `jscpdOver` is the built form for a throwaway tree. Imported through
`@better-answers/devtools/jscpd`.

`src/oxlint-config.ts` reads the repository's own `.oxlintrc.json` as a value, comments and
all, for the three suites that run oxlint over a throwaway tree under the *real* config
rather than a restatement of it. It is one reader rather than three because the
comment-stripping is the part that would have gone wrong quietly. Imported through
`@better-answers/devtools/oxlint-config`.

`src/mutant-probe.ts` is the mutant probe behind `scripts/mutant-probe.mjs` (`pnpm
mutant-probe --file … --line … --from … --to … [--suite …]`): one hand-applied mutation,
pinned to the text on the line it names, run against the file's workspace suite, restored in
a `finally` that an interrupt, a crashed suite and a thrown error all reach, then the `src`
diff-stat against `HEAD`. It exists because two triage sessions restored on the happy path
alone and left a mutant in `src` with the suite green. Its suite spawns the script over a
throwaway git repository and interrupts it mid-run; `docs/agents/mutation-triage.md` is
where the method that uses it is written.

`src/mutation-summary.ts` is the mutation run's job summary behind
`scripts/mutation-summary.mjs` (`--leg … --report … [--baseline …] [--checkpoint …]`), which
`.github/workflows/mutation.yml` appends to each leg's summary: the score, the mutants that
survive in this run's report and did not in the previous run's — matched by the mutated text
rather than the line number, so a file that gained lines above a survivor does not report it
as new — and the rows the runner never tested, named as a runner fault rather than counted
as survivors. A first run says "no baseline". The script exits zero whatever the score, so
the summary never gates on one; it exits one, naming a **runner fault** first in the summary
and on stderr, when a mutant ran no test or the leg killed none, because then no verdict in
the report means anything. A leg cut short at its ceiling writes no report, so the fault is
read from the checkpoint it left instead. Its suite asserts the prose a reader sees, line by
line, and runs the script over files.

`src/mutation-shards.ts` cuts a mutation leg into shards and puts the leg back together, behind
`scripts/mutation-shards.mjs`, which reads each leg's `mutate` patterns from its Stryker config.
`slice --leg … --shard … --of … --baseline …` prints one shard's files for `stryker run
--mutate`: the patterns resolved in order as Stryker resolves them, then each file, heaviest
first, onto the lightest shard so far. A file weighs what its mutants cost the previous run, in
seconds of a worker fitted to a forced run of every shard, a timed-out mutant far above the rest;
a file that run did not hold is priced by size at its seconds a byte, and with no previous run
size is all there is. Ties keep path order, so every job of a run, reading the same previous run,
cuts the same slices. `merge --leg … --of … --shards … --baseline … --out …` takes each file from
the shard that owned it,
renumbering the tests each shard numbered on its own. A shard that stopped leaves out what it
never reached, so a forced run's gaps are not refilled with the results it was replacing; only
a shard that left nothing is filled from the previous run, so a lost shard never leaves the leg
poorer than it started. The merge writes the leg's checkpoint always and its report only when
every shard finished, as one run would, and prints a line naming the shards that did not. A
file keeps its results when a new file moves it to another shard, because every shard starts
from the whole leg's results and Stryker carries a file outside `--mutate` forward from the file
it read. The suite runs Stryker over a throwaway workspace, two shards merged against one whole
run, then moves a file and reads its results back.

`src/land.ts` is the landing command behind `scripts/land.mjs` (`pnpm land --message "…"`): the
working tree's changes and one sentence become a branch named from the message, a commit over
`origin/main`'s fetched head, a push, a pull request opened with `gh pr create --fill` and an
armed auto-merge, with the queue state read back over GraphQL and printed. It exists because a
one-line docs change cost five commands and so was pushed straight to `main`, and a commit that
reaches `main` outside the queue rebuilds every entry already in it. The rule it serves is
`docs/agents/workflow.md`'s *The prose shape*, which says the shape once and states no list of
refusals of its own — a message or a tree the command will not take comes back naming the
condition it missed. The subject ceiling is the one part written twice, here and in
`lefthook.yml`'s `commit-msg` hook, because nothing either could import binds a shell
one-liner to a TypeScript constant: the suite reads both and fails when they disagree, and
runs the hook's own command over a message file either side of the ceiling. A read-back that
shows the pull request neither queued nor armed fails the
run and prints the command that arms it, because a run that says nothing about the arming is
the silence this package exists to refuse. Its suite spawns the script over a throwaway git
repository whose `origin` is a bare repository on disk, with `git push` and the whole of `gh`
stubbed on the path, so the fetch is real and no case can reach GitHub.

## `lint-rules/` — the `better-answers` oxlint plugin

The repository's own rules: the ones that hold a rule in `CODING_RULES.md` or an ADR rather
than a generic hygiene pattern. Loaded by `.oxlintrc.json` as a `jsPlugins` specifier. Each
rule carries its rule line in the message it prints and lands with a functional test through
the runner.

Three rules today. The two MCP entry rules hold ADR 0018's line at the declaration and are
run by `apps/api/tests/lint-rules.test.ts`. `import-direction` holds all five of ADR 0029's
import-direction rules over `packages/core` as one rule, by placing both ends of an import in
a zone from their position under the package whose manifest names `@better-answers/core`;
the rule file says what it refuses, and `packages/core/test/import-direction.test.ts` runs it
both ways and over the committed tree.

## The comment gate — three parts, all in root `check`

The comment rule's two conditions — a comment block is 25 words at most and cites no ticket id,
date, rule tag or ADR number — held by a rule for TypeScript, a check for the rest and a density
ceiling over each unit. The check reads a file by a syntax table keyed on its extension: `#` for
Python, YAML, shell and TOML, `--` for SQL, and docstrings on top for Python alone. Directives
and notices are exempt by their opening text everywhere, two of the migrations' own by their
whole text, and a directive is dropped before blocks are grouped so it cannot lend a paragraph
its exemption. What a language calls code is code: a string in any of them, and a dollar-quoted
body, an escaped string or a quoted identifier in SQL. Each part carries the rule in the message
it prints, and each is proven through the runner above, both ways.

The citation half also reads the strings in source, because a usage line, a refusal message or
a log line sends its reader somewhere just as a comment does, and the comment walk never saw
one. A string with no space in it is a value — an identifier, a path, a key, a version — and
goes past; the word ceiling is a comment's alone, because a usage text is long by design. A
test is exempt, and so is a gate that prints its own rule tag in a failure message: those files
are named in `gates-printing-a-tag.json` beside this README, which the oxlint rule reads through
`src/tag-printing-gates.ts` and the Python check reads directly, so a new gate is one edit.

| Part | What runs it | Its suite |
| --- | --- | --- |
| `lint-rules/rules/comment-only-the-why.ts`, under `lint-rules/comment-gate.oxlintrc.json` | `pnpm comment-gate:ts` | `test/comment-only-the-why.test.ts` |
| `python/comment_gate.py` | `pnpm comment-gate:python` | `test/comment-gate-python.test.ts` |
| `src/comment-density.ts`, behind `scripts/comment-density.mjs` | `pnpm comment-density` | `test/comment-density.test.ts` |

All three are root `check` steps, ahead of the tiers, and landed green with no baseline. The
lint rule sits in a config of its own because oxlint switches a plugin rule on from a config's
`rules` block and from nowhere on the command line — `--deny` does not reach one.

The ceiling measures two kinds of unit. A positional argument is a root of workspaces: each
directory under it carrying a `package.json` or a `pyproject.toml` is one workspace, measured
on TypeScript and Python, split into a source arm and a test arm with a ceiling each.
`--directory <path>`, repeatable, names one directory measured as a single number under the
source ceiling, on those two languages and the config tree's beside them — shell, YAML, TOML,
SQL and JavaScript. The longest path wins where a directory sits inside a workspace, so
`--directory packages/schema/migrations` gives the SQL a number of its own rather than one the
TypeScript eight times its size decides. The report names a directory the way it names a
workspace, and a named directory the counter read no file in is refused, never called clean.
Root `check` names the two workspace roots and `packages/schema/migrations`; each config root
is wired as its strip lands.

`.claude/hooks/comment-gate-hook.sh` runs the same two parts at write time over the file an
edit touched, and hands their message straight back; its suite holds its extension list against
the check's syntax table both ways. The check names one path it does not judge, proved by a
case in its suite: `apps/worker/pyproject.toml`, which no root of the config-tree strip covers.
Skills are walked past wherever they sit, being prose no comment gate reads.

The counter is **cloc**, pinned at `2.6.0-cloc`, which carries upstream cloc `2.06` — the
number a behaviour is compared against. **Read the pin off the registry's `latest` tag and
never off the highest version.** The npm redistribution renumbered itself partway through its
life to follow upstream, so `2.11.0` is its biggest number, was published in December 2022 and
carries cloc `1.96`, while `2.6.0-cloc` is three years newer; `renovate.json` follows the tag
for this one package for that reason, because every other ordering of these versions is a lie.

cloc was taken over `scc`, which the tooling research picked on semantics, because scc
publishes no npm or PyPI distribution and every tool this repository installs arrives through
pnpm or uv. cloc agrees with scc where the choice mattered: a Python docstring is comment, and
`{/* … */}` in TSX is invisible to both — the lint rule is what caps those. `--skip-uniqueness`
is passed because cloc counts a file with an identical twin once, which would quietly take an
arm's lines away.

The rule's fix deletes the offending block. The suite proves it by spawning oxlint `--fix` over
a tree it wrote rather than through the runner, which answers with a report and not a rewrite;
a linter that did not run leaves the text as it was, and both halves of that assertion fail.
It spawns the binary the runner would, through the runner's own `executableOf`, so the two
resolutions cannot drift.

**The word limit is written twice, once per language** — the citation patterns are not, since
both tiers compile `contracts/citation/cases.json`. The limit is two implementations of one
rule, and nothing either tier could import at run time binds them, so what holds them together
is the pair of suites: both run the same table — the same over-the-ceiling fixture, the same
five citations, the same directive cases — so a limit that moved in one language and not the
other is a red suite rather than a quiet divergence.

The Python check runs under bare `python3` and imports only the standard library, so a fresh
clone can run it before `uv sync`. ruff reads it under `python/ruff.toml` and mypy under
`--strict`, through this workspace's `lint:python` and `typecheck:python`, run from the
worker's locked environment — the one Python toolchain the repository installs.

## `src/insert-scan.ts` — the insert scan

The setup rule's holder: a raw `INSERT` appears inside a factory module and nowhere else.
`scripts/insert-scan.mjs` walks the directories it is named — `pnpm insert-scan`, a root
`check` step — and reads the suites' territory: every `.ts`, `.tsx` and `.py` file that a
test directory holds or that a test name marks. One reader covers both languages, so the
statement's shape cannot move in one tier and not the other. Production code is not
territory, which is where a statement belongs.

**A factory module is a short named list, in the scan's own source, and nothing else.** A
glob would let the next file written beside a suite become a factory by existing, which is
the way round any gate of this kind; a module joins the list in the commit that creates it,
and the failure message names where the list lives so a reader can get there. The suite holds
the list to its job twice over: every entry names a file the tree still has, and every entry
carries a statement, so a rename cannot open a hole and an entry cannot outlive its reason.

A walk that read no suite file exits 2 rather than reporting a tree without inserts, which is
the silence the runner above exists to refuse. `test/insert-scan.test.ts` runs the script
through the runner over a throwaway tree, both ways and in both languages, and proves the
module beside a suite is refused until it is named.

## `lifts/anti-slop/` — the anti-slop plugin, lifted

A verbatim third-party snapshot under ADR 0027, with its provenance, licence and notice text
in `lifts/anti-slop/THIRD_PARTY_NOTICES.md`. It is edited upstream, never here,
which is why it is excluded from this repository's linter, formatter and compiler.
