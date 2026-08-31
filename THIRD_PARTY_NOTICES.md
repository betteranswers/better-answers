# `anti-slop` — third-party notices

An oxlint JS plugin of fifteen generic TypeScript rules, lifted whole from Onyx
(`[LIFT1]`, ADR 0005). It is the reason `[TEST3]` is a lint rule and not a
convention: `no-module-mocking` refuses `vi.mock` / `jest.mock` programmatically.

| | |
| --- | --- |
| Upstream repository | <https://github.com/onyx-dot-app/onyx> |
| Path upstream | `web/tools/oxlint/anti-slop/` |
| Snapshot taken at | `729ec580c7590fa2b9980846a5b0ab9bacd02190` (clone `main`, 21/08/2026) |
| Last upstream commit touching the path | `6376385614d6c5d69b7460a11a86b656cdd88a7b`, 14/08/2026 — *feat(web): enforce anti-slop lint rules on src/ and lib/ (#14006)* |
| `sha256` of this snapshot | `2621e75034966ce588a28c255a2648fb40833cc9e0bd354b786f6b8d80f33ec1` — see `snapshotDigest` in the contract test below for how it is computed |
| Licence | MIT Expat — Onyx's `LICENSE`, which places everything outside an `ee/` directory under MIT. This path is not under `ee/` (`[LIFT3]`, ADR 0027). |
| Audited by | Liam Jons, 30/08/2026 (T-002) |

## What was cut

Nothing. Twenty files, 2,523 lines of TypeScript, copied verbatim — including the
plugin's own `package.json`, which is `private` and unused here because
`.oxlintrc.json` names the plugin by path.

## What is ours, not theirs

The **rule severities** in the repository's `.oxlintrc.json`. Onyx runs eight of the
fifteen rules as errors, five as warnings and two off, and turns *every* anti-slop rule
off for test files. We keep that split, and the test override turns off every rule Onyx
does **but one**: `no-module-mocking` stays an **error in test files**, because a test is
the only place it can fire and `[TEST3]` is what it exists to enforce. That is the whole
difference — the other fourteen behave exactly as they do upstream.

**The severity split is upstream's, deliberately.** Eight rules are errors, five are
warnings and two are off, so five of the fifteen cannot fail `check` — oxlint exits 0 on
warnings. That is Onyx's own tuning of which rules are noisy, made against a far larger
codebase than this one, and deviating from it without evidence would be guessing. A rule
earns promotion to `error` when this repository has a case where the warning was right;
`--deny-warnings` is the lever, and it is deliberately not pulled yet.

## The boundary contract a refresh must pass

`app/test/anti-slop-lift.test.ts` — it runs oxlint over a fixture and asserts that

1. `no-module-mocking` reports `vi.mock(...)` **inside a `*.test.ts` file** — the
   only place it can fire, and the reason for the severity difference above;
2. `no-chained-type-assertions` reports `x as unknown as T` in ordinary source; and
3. the snapshot's digest is still the one recorded in the table above, so what runs
   is what was audited.

A refresh (`[LIFT2]`) re-snapshots the directory, re-runs that test, and updates the
commit and digest rows from what it reports. If either rule stops firing, the
constitution has lost its teeth and the refresh does not land.

## Notice

```
Copyright (c) 2023-present DanswerAI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
