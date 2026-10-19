# The journeys

The journeys are off (`JOURNEYS_MODE` is `off`) and are being retired until go-live (BA-204). This page describes them as they were, for that retirement.

They sign in as the test workspace's three test people, an Admin, an
Editor and a Viewer, and walk the pages each role reaches. `.github/workflows/release.yml` runs
them after a release, and against the live release on a night with nothing to promote;
`docs/operations/RUNBOOK.md` page 13 is the owner's side of them. They live in
`apps/web/journeys/`: a preflight, then one spec per role, each page a `test.step`. Their config
is `apps/web/playwright.journeys.config.ts`, and `pnpm --filter @better-answers/web run journeys`
runs them.

They reuse the suite without changing it. `apps/web/journeys/fixtures.ts` extends the `test` from
`apps/web/e2e/browser.ts`, so the accessibility gate is the suite's own, and each journey calls it
on every page it leaves. It overrides `context` and `request` with no client address, because
production's edge sets one. The Editor's and the Viewer's journeys are one walk, `aMembersJourney` in `apps/web/journeys/member-journey.ts`: home, the address to connect an assistant, the workspace switcher, search, the refused console, an Admin's page meeting not-found, and sign-out, each a `test.step`. A journey names its person with `test.use({ role })`, and the fixture
signs them in on the product's own sign-in page and signs them out on the server afterwards,
even after a failure. The locators come from `apps/web/e2e/locators.ts`, which `harness.ts`
re-exports. Production has no harness, so `.oxlintrc.json` refuses any harness action under
`apps/web/journeys/` except `codeSentTo`, the harness code source below. The harness's Admin key,
below, is a request of the journeys' own, made only under that source.

| | The browser suite | The journeys |
| --- | --- | --- |
| The server | Playwright starts `apps/api/tests/serve.ts` | None: the base URL is `PUBLIC_URL`, and the config refuses to load without an http or https address |
| Workers | Fully parallel; three under CI | One, one journey at a time |
| Projects | `chromium` | `preflight`, which signs nobody in, then `roles`, which depends on it |
| Retries | One, under CI | None: each Send spends a ceiling the release, a rerun and the owner share |
| `test.only` | Refused under CI | Refused everywhere: a focused journey would run alone and report `held` |
| Traces, screenshots and video | A trace on the retry | Off: a trace, screenshot or video of a signed-in page would publish a live session |
| Reporter | `list` and the flaky report | The outcome reporter alone, so no failure's detail, which can hold an address, reaches a public log |

The Admin's journey reads the test workspace before any action. A workspace that differs from its
fixture stops the run `could-not-run`, and nobody else signs in.

`JOURNEYS_CODE_SOURCE` names where a sign-in's code is read. Unset, or any other value, it ends
the run `could-not-run`:

- **`inbox`**, which the release's journeys step sets: the code comes from the test inbox,
  `apps/test-inbox`, through its API, and only from an email whose DKIM signature verifies as
  production's sender's. It needs `JOURNEYS_INBOX_URL`, `JOURNEYS_INBOX_KEY` and `JOURNEYS_SENDER`.
- **`harness`**, for a run by hand against the browser suite's api, `apps/api/tests/serve.ts`:
  `codeSentTo` reads the code from its capture, which no email leaves.

After its code, the Admin confirms a second factor on the confirm page, typing the code an
authenticator key makes; it never presses the passkey button. Under `inbox` the key is
`JOURNEYS_ADMIN_AUTHENTICATOR_KEY`, as setup shows it or the `otpauth://` link it is in, and a
missing or unparseable one ends the run `could-not-run` before any code is sent. Under `harness`
the run asks `POST /__harness/authenticators` for the test Admin's key before the sign-in. It
writes the Admin an authenticator with saved recovery codes if they hold none, and answers the same
key on a second ask, so a by-hand run needs no key and skips no step.

Both read the test people's addresses from `JOURNEYS_ADMIN_EMAIL`, `JOURNEYS_EDITOR_EMAIL` and
`JOURNEYS_VIEWER_EMAIL`. By hand, build first, start the api with
`pnpm --filter @better-answers/api run serve:e2e <port>`, and make the test workspace through
`POST /__harness/test-workspaces`, the fixture command's own action, which
`apps/api/tests/harness-control.ts` mounts and no spec calls. It takes a testing domain, a short name and
the three addresses. Then:

```bash
PUBLIC_URL=http://localhost:<port> JOURNEYS_CODE_SOURCE=harness \
  JOURNEYS_ADMIN_EMAIL=… JOURNEYS_EDITOR_EMAIL=… JOURNEYS_VIEWER_EMAIL=… \
  pnpm --filter @better-answers/web run journeys
```

A run ends in one word, which `apps/web/journeys/outcome-reporter.ts` writes to
`apps/web/test-results/journeys-outcome` for the release to read: `held` once a role journey ran
and every test passed, `fail` when a page's step failed, and `could-not-run` when the run could
not judge the release. `could-not-run` outranks `fail`. A journey raises those two through
`couldNotRun` and `failed` in `apps/web/journeys/outcome.ts`. The run's summary names the role,
the page and the step from the steps' titles and those reasons alone, never an error's message,
which can hold an address, so write a reason that names none. The reporter prints no error
either. By hand, `--reporter=list` prints each one, but the flag replaces the config's reporters,
so that run writes no outcome: take the outcome from a run without the flag. Naming the outcome
reporter in the flag beside `list` fails at the run's end, because only the config hands it its
outcome file.

`check:web` never runs a journey, since the suite's `testDir` is `e2e`, and nor does a pull
request or the merge queue. Its typecheck covers them; run one by hand as above (`docs/agents/workflow.md`).
