# `@better-answers/devtools`

The repository's own gate tooling. **It is imported and never deployed** — `packages/` is what
is imported, `apps/` is what deploys (ADR 0029) — so nothing under `apps/` copies this
directory into an image, and every dependency here is a development dependency.

Three things live here.

## `src/throwaway-tree.ts` — the runner

The one helper that writes a map of paths to sources into a temporary directory, runs a named
tool's command line over it, and returns what the tool wrote. It exists for one failure: a
tool that could not run at all reports nothing, and a suite that reads nothing as "the rule
stayed silent" then passes while enforcing nothing. So only the tool's own "I found
something" exit is tolerated, every other exit is re-thrown with both of the tool's streams,
and a smoke case proves the reporter's shape before any caller is allowed to read a silence.

The tool is a parameter — which package holds the binary, the command line, the exits that
mean a finding, and the smoke case — so a second and a third tool run through this helper
rather than each writing its own. Two tools run through it today, each with a built form
that reads its reporter: `oxlintOver`, which the lint-rule suites take, and `knipOver`,
which reads knip's JSON report as a list of findings. Imported through
`@better-answers/devtools/throwaway-tree`.

A tool's binary is found through the module graph, and a package that withholds its own
manifest from its `exports` map — knip does — is reached through its entry instead, so the
resolution never becomes a guessed path. Every tool run this way is a devDependency of this
package, because that is where the resolution starts.

## `lint-rules/` — the `better-answers` oxlint plugin

The repository's own rules: the ones that hold a rule in `CODING_RULES.md` or an ADR rather
than a generic hygiene pattern. Loaded by `.oxlintrc.json` as a `jsPlugins` specifier. Each
rule carries its rule line in the message it prints and lands with a functional test through
the runner (`[CHECK1]`).

## `lifts/anti-slop/` — the anti-slop plugin, lifted

A verbatim third-party snapshot under ADR 0027, with its provenance, licence and notice text
in `lifts/anti-slop/THIRD_PARTY_NOTICES.md` (`[APP4]`). It is edited upstream, never here,
which is why it is excluded from this repository's linter, formatter and compiler.
