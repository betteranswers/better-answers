# `@better-answers/devtools`

The repository's own gate tooling. **It is imported and never deployed** — `packages/` is what
is imported, `apps/` is what deploys (ADR 0029) — so nothing under `apps/` copies this
directory into an image, and every dependency here is a development dependency.

Six things live here.

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
`scripts/mutation-summary.mjs` (`--leg … --report … [--baseline …]`), which
`.github/workflows/mutation.yml` appends to each leg's summary: the score, the mutants that
survive in this run's report and did not in the previous run's — matched by the mutated text
rather than the line number, so a file that gained lines above a survivor does not report it
as new — and the rows the runner never tested, named as a runner fault rather than counted
as survivors. A first run says "no baseline"; the script exits zero whatever the
reports hold, so the summary never gates. Its suite asserts the prose a reader sees, line by
line, and runs the script over files.

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
date, rule tag or ADR number — held by a rule for TypeScript, a check for Python and a density
ceiling per workspace. Directives and notices are exempt by their opening text everywhere, and
a directive is dropped before blocks are grouped so it cannot lend a paragraph its exemption.
Each part carries the rule in the message it prints, and each is proven through the runner
above, both ways.

| Part | What runs it | Its suite |
| --- | --- | --- |
| `lint-rules/rules/comment-only-the-why.ts`, under `lint-rules/comment-gate.oxlintrc.json` | `pnpm comment-gate:ts` | `test/comment-only-the-why.test.ts` |
| `python/comment_gate.py` | `pnpm comment-gate:python` | `test/comment-gate-python.test.ts` |
| `src/comment-density.ts`, behind `scripts/comment-density.mjs` | `pnpm comment-density` | `test/comment-density.test.ts` |

All three are root `check` steps, ahead of the tiers, and landed green with no baseline. The
lint rule sits in a config of its own because oxlint switches a plugin rule on from a config's
`rules` block and from nowhere on the command line — `--deny` does not reach one.

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

**The word limit and the citation patterns are written twice, once per language.** They are
two implementations of one rule, and nothing either tier could import at run time binds them,
so what holds them together is the pair of suites: both run the same table — the same
over-the-ceiling fixture, the same five citations, the same directive cases — so a limit that
moved in one language and not the other is a red suite rather than a quiet divergence.

The Python check runs under bare `python3` and imports only the standard library, so a fresh
clone can run it before `uv sync`. ruff reads it under `python/ruff.toml` and mypy under
`--strict`, through this workspace's `lint:python` and `typecheck:python`, run from the
worker's locked environment — the one Python toolchain the repository installs.

## `lifts/anti-slop/` — the anti-slop plugin, lifted

A verbatim third-party snapshot under ADR 0027, with its provenance, licence and notice text
in `lifts/anti-slop/THIRD_PARTY_NOTICES.md`. It is edited upstream, never here,
which is why it is excluded from this repository's linter, formatter and compiler.
