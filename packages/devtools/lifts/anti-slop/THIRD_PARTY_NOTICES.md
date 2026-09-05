# Lift: `anti-slop` — the oxlint plugin

Upstream: https://github.com/dmmulroy/anti-slop — "Opinionated Oxlint rules for rejecting
low-evidence TypeScript and JavaScript patterns".
Upstream commit this snapshot was taken at: `6376385614d6c5d69b7460a11a86b656cdd88a7b`
(recorded by `docs/research/t-012-cubic.md`; the sha no longer resolves against the upstream
repository, so a refresh compares source rather than history — see *Refreshing* below).
Snapshot digest, taken 2026-09-05 and covering the lifted files alone — this file is not one
of them: `58a028870935703e13ecbd947104f111d4a43cec522613e8803088ebf7f56879`. Reproduced from
this directory by
`find . -type f ! -name THIRD_PARTY_NOTICES.md | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`.
Licence: MIT (`[APP4]`, ADR 0027; read from the upstream `LICENSE` on 2026-09-05, `[DEPS1]`;
the notice text is below).
Lifted: 2026-08 at repository set-up, as `app/tools/anti-slop/`. Moved unchanged to
`apps/api/tools/anti-slop/` by T-021 and here by T-065 — a lift is imported and never
deployed, so ADR 0029 puts it under `packages/`. No rule source has ever been edited.
Audited by the T-065 builder on 2026-09-05: the upstream `LICENSE` and `src/` file list were
read on the day and reconciled against this directory, which is what produced the licence
above, the cut list below and the finding that the recorded sha no longer resolves. The
snapshot's arrival was not audited — it landed at set-up without this file — so the digest
below is a baseline taken now, not a check against what was copied then.

This file is the notice the lift has been owed since it landed: the snapshot arrived without
one, and T-065 wrote it where the lift now lives rather than leaving the obligation behind in
a workspace that no longer holds the code.

## Why it is lifted rather than depended on

Upstream publishes no package to a registry: the plugin is distributed as source to be copied
into a repository's own oxlint configuration, which is what `jsPlugins` in `.oxlintrc.json`
loads. There is no version to pin and no lockfile entry to move, so the snapshot *is* the pin
and this file is where it is written down.

## What was cut

Upstream's `src/` carries fifteen rules, their `shared/` helpers, an `index.ts`, a per-rule
`.test.ts` beside each rule, and an `effect/` rule set. This snapshot takes the fifteen rules,
`shared/` and `index.ts`. Cut: upstream's own rule tests (they run under upstream's harness,
not this repository's), the `effect/` rules (this repository uses no Effect), and everything
outside `src/` — the build scripts, the agent skills and the CI workflows.

`package.json` here is ours, not upstream's: four lines naming the directory as an ES module
with one export, so `jsPlugins` can resolve it.

## What was changed

Nothing in any rule source. The rules are read at the severities `.oxlintrc.json` sets —
eight as errors, five as warnings, two off — and that configuration is ours, in our file.

## Refreshing this directory

Upstream rewrote the history this snapshot names, so the recorded sha is a record of what was
taken and not a ref to diff against. A refresh therefore compares source:

1. Recompute the snapshot digest above and confirm nothing here has drifted since; anything
   that has, is an edit a refresh must carry forward deliberately.
2. Take `src/index.ts`, `src/rules/*.ts` (not the `.test.ts` files) and `src/shared/` from
   upstream's current `main`, keep this repository's `package.json`, and re-read the upstream
   `LICENSE` for a licence change (a move off the permissive list is a refusal, ADR 0027).
3. Reconcile `.oxlintrc.json`'s rule list with the new `index.ts`: a rule added upstream is
   off until someone decides its severity, and a rule removed upstream leaves the config in
   the same commit.
4. Record the new digest, the new commit and the date here.

## The test a refresh must pass (`[APP4]`)

The repository's `check`. Every TypeScript workspace runs `oxlint --config
../../.oxlintrc.json .`, which loads this plugin and runs all fifteen rules over that
workspace's source; a rule that stopped loading, changed its name, or started firing on code
this repository has always held fails that step rather than a report. The plugin's own
loading is additionally exercised by `apps/api/tests/lint-rules.test.ts`, which resolves both
`jsPlugins` specifiers out of the real `.oxlintrc.json` and runs oxlint over a throwaway tree
through the devtools runner.

## Upstream notice

MIT License

Copyright (c) 2026 Dillon Mulroy

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
