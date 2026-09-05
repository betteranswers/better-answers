# `@better-answers/devtools`

The repository's own gate tooling. **It is imported and never deployed** — `packages/` is what
is imported, `apps/` is what deploys (ADR 0029) — so nothing under `apps/` copies this
directory into an image, and every dependency here is a development dependency.

Four things live here.

## `src/throwaway-tree.ts` — the runner

The one helper that writes a map of paths to sources into a temporary directory, runs a named
tool's command line over it, and returns what the tool wrote. It exists for one failure: a
tool that could not run at all reports nothing, and a suite that reads nothing as "the rule
stayed silent" then passes while enforcing nothing. So only the tool's own "I found
something" exit is tolerated, every other exit is re-thrown with both of the tool's streams,
and a smoke case proves the reporter's shape before any caller is allowed to read a silence.

The tool is a parameter — which package holds the binary, the command line, the exits that
mean a finding, and the smoke case — so a second and a third tool run through this helper
rather than each writing its own. oxlint runs through it today, with `oxlintOver` as the
built form the lint-rule suites take. Imported through
`@better-answers/devtools/throwaway-tree`.

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

## `lint-rules/` — the `better-answers` oxlint plugin

The repository's own rules: the ones that hold a rule in `CODING_RULES.md` or an ADR rather
than a generic hygiene pattern. Loaded by `.oxlintrc.json` as a `jsPlugins` specifier. Each
rule carries its rule line in the message it prints and lands with a functional test through
the runner (`[CHECK1]`).

## `lifts/anti-slop/` — the anti-slop plugin, lifted

A verbatim third-party snapshot under ADR 0027, with its provenance, licence and notice text
in `lifts/anti-slop/THIRD_PARTY_NOTICES.md` (`[APP4]`). It is edited upstream, never here,
which is why it is excluded from this repository's linter, formatter and compiler.
