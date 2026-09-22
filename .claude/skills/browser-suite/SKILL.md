---
name: browser-suite
description: How this repository drives a browser — the served-build seam, the client-address fixture, the api harness's acts, locators, waiting and the accessibility gate. Use when writing, changing, debugging or running a Playwright spec under apps/web/e2e.
---

# The browser suite

`apps/web`'s interface is the **served build driven by a browser**, so a fact about a
screen is read here and a screen is never asserted against its source. Everything below is what
the suite already is; `apps/web/e2e/routes.spec.ts` is the fullest worked example.

## The seam

The server under the browser is the api's own test harness — the server factory over a
Testcontainers Postgres, the email transport capturing codes, the CIMD document served in
process — started by Playwright as a **process**, not imported. `apps/web` imports nothing from
`apps/api` at runtime, so launching it is the only way the browser suite can reach the
real server: `apps/api/tests/serve.ts` takes a port as its one argument and listens on it, with
the harness's control paths (`apps/api/tests/harness-control.ts`) mounted in front of the app and
served nowhere in `apps/api/src`.

One origin carries the SPA, sign-in, consent and `/oauth2/*`, which is why the consent
flow is provable in a browser at all.

`apps/web/playwright.config.ts` holds the port, the `webServer` command and `/health` as the
readiness URL — the one path the loopback carries whatever else changes, and it answers only once
the database is migrated and the authorization server has initialised.

## Each test gets its own address

Import `test` and `expect` from `apps/web/e2e/browser.ts`, which is the suite's fixture module.
Two things ride on that import whether a spec asks for them or not: the address below, and the
accessibility gate further down.

It gives every browser context a `cf-connecting-ip` header of its own, from RFC 2544's reserved
benchmarking block, keyed by worker index and a per-run count. It exists because every counter in
front of sign-in is per client address — the platform's per-IP ceilings
(`apps/api/src/ingress/limits.ts`, the rules in `apps/api/src/auth/constants.ts`) and Better
Auth's own limiter all key on the one header that file names. Without the fixture every browser
in the run arrives from the same address and shares one bucket, so a long run trips a ceiling
partway through and every spec after it fails for a reason that has nothing to do with what it
was testing.

## The harness's acts

State is built through the api's harness over HTTP, from
`apps/web/e2e/harness.ts`, using the `request` fixture. Nothing writes a row itself and nothing
sets a cookie from outside.

| Act | What it does |
| --- | --- |
| `provision` | A workspace with its first Admin — the platform-provisioned act; the product offers no way to make one |
| `person` | A person with no membership, for the refused screen and the picker |
| `addMember` | A second membership at a named role — Admin, Editor or Viewer |
| `removeMember` | Ends a membership, as the People screen will |
| `revokeCredentials` | Revokes a person's credentials, so the next request is refused |
| `seedRoutes` | The routes a workspace has chosen; a purpose left out of the list has no route, which the screen must show rather than omit |
| `anAddress` | An email address nobody else in the run will use, so a code read back is this test's |
| `signIn` | Signs a person in **through the product's own screen** — fill the address, send, read the six-digit code from the captured transport, fill it, submit |

The code is read from that capture and from nowhere else: the app's logger is forbidden from ever
holding one.

## Writing a spec

- **Locate by role and accessible name.** `getByRole`, `getByLabel`, `getByText`. Test ids appear
  nowhere in this suite; adding one adds a handle the reader does not have.
- **Wait with auto-retrying matchers.** `await expect(…).toBeVisible()`, `.toHaveURL()`,
  `.toHaveCount(0)`. Where a navigation must complete before the next act, assert the thing that
  proves the screen was left.
- **Title says what the system does for whom** — `"a member of two workspaces picks
  one, and everything after is scoped to the pick"`, not `"picker test"`.
- **Minimal comments** — only comment to clarify non-obvious intent; never restate what the next line of code does.

## The accessibility gate

The accessibility rule is WCAG 2.2 AA tested with a keyboard and a screen reader, and the suite carries that as
three things, of which automated rules are only one:

- **An `AxeBuilder` pass** (`@axe-core/playwright`) over `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
  and `wcag22aa`, asserted to have no violations. **It is run for you**: the fixture in
  `apps/web/e2e/browser.ts` audits the screen the test leaves the browser on, once the body has
  finished. A new spec is held to it by existing, and there is nothing to remember.
- **A keyboard traversal** reaching the screen and each of its acts without a pointer. Every
  screen's spec has one; it is the floor, not the extra.
- **An aria snapshot** writing out the announced structure, where what a screen *sounds like* is
  the thing under test — a row that lost its heading or a list that stopped being a list fails it
  though the pixels are unchanged.

Ask for the `passesTheAccessibilityGate` fixture — called with no arguments — where the test does
not end on the screen it is about. The routes and failed-screen specs walk on to other screens
afterwards; every consent test ends at the client's own redirect, which is another origin and no
screen of ours. A test that ends somewhere this product did not serve and audited nothing is
refused by name, so an absence is a failure rather than a silence.

`apps/web/e2e/routes.spec.ts` carries all three and is the model to copy.
`apps/web/e2e/accessibility-gate.spec.ts` is the gate's own proof: two of its four tests are
`test.fail()`, so the run prints them with a ✘ and counts them passed — that is the gate firing
where it should, and an `Expected to fail, but passed` there means the gate has stopped running.

## Running it

One project, `chromium`, fully parallel. The api serves the SPA's build output, so a build comes
first or the browser reaches the last build's screens.

```bash
# the whole suite (builds first)
pnpm --filter @better-answers/web run e2e

# one spec, one project
pnpm --filter @better-answers/web run build && \
  pnpm --filter @better-answers/web exec playwright test e2e/routes.spec.ts --project chromium
```

`test.only` is allowed while debugging and refused under CI by `forbidOnly`: the
specs import `test` from the fixture module, so oxlint's vitest rules never see them and this is
the only fence — a focused spec left behind would run alone and report the suite green.
`apps/web/test/playwright-config.test.ts` holds it both ways. Take the `.only` out before
committing.
