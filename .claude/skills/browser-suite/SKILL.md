---
name: browser-suite
description: How this repository drives a browser — the served-build seam, the two client-address fixtures, the api harness's acts, locators, waiting and the accessibility gate. Use when writing, changing, debugging or running a Playwright spec under apps/web/e2e.
---

# The browser suite

`apps/web`'s interface is the **served build driven by a browser**, so a fact about a
screen is read here and a screen is never asserted against its source. Everything below is what
the suite already is; `apps/web/e2e/routes.spec.ts` is the fullest worked example.

## The seam

The server under the browser is the api's own test harness — `startApp` in
`apps/api/tests/harness.ts` over a Testcontainers Postgres and a Garage object store, the email
transport capturing codes, Claude's client metadata document served in process — started by
Playwright as a **process**, not
imported. `apps/web` imports nothing from `apps/api` at runtime, so launching it is the only way
the browser suite can reach the real server: `apps/api/tests/serve.ts` takes a port as its one
argument and listens on it, with the harness's control paths
(`apps/api/tests/harness-control.ts`) mounted in front of the api and served nowhere in
`apps/api/src`.

One origin carries the SPA, sign-in, consent and `/oauth2/*`, which is why the consent
flow is provable in a browser at all.

`apps/web/playwright.config.ts` holds the port, the `webServer` command — `node tests/serve.ts`
run in `apps/api`, handed that port — and `/health` as the readiness URL: the one path the loopback
carries whatever else changes, and it answers only once the database is migrated and the
authorization server has initialised. The api's `serve:e2e` script is the same command for a
person to run by hand; Playwright never goes through it, because pnpm 11.27 and later start a
script in a process group of its own, which Playwright's kill at the end of the run never
reaches, so the server outlives the suite and the run hangs on its open output.

## The fixture module

Import `test` and `expect` from `apps/web/e2e/browser.ts`. It overrides three of Playwright's own
fixtures and adds a fourth:

| Fixture | What the module does with it |
| --- | --- |
| `context` | A browser context carrying a `cf-connecting-ip` header of its own; closed after the test |
| `page` | A page on that context |
| `request` | An `APIRequestContext` on the config's `baseURL`, carrying a `cf-connecting-ip` header of its **own**; disposed after the test |
| `passesTheAccessibilityGate` | The audit below, declared `auto`, so it runs whether a spec names it or not |

A spec asks for the ones it uses and gets the rest anyway: `apps/web/e2e/sign-out.spec.ts` takes
`context` to clear cookies mid-test, and every spec that builds state takes `request`.

### Two addresses, not one

Both addresses come from RFC 2544's benchmarking block, keyed by worker index and a per-run count.
The header's name is written out in `browser.ts` rather than imported, because `apps/web` takes
nothing from `apps/api` at runtime.

They are **different addresses on purpose**: the browser is one client and the set-up traffic is
another, so a spec that floods a path through `request` leaves the page's own bucket untouched.
`apps/web/e2e/sign-in.spec.ts` is the case — it posts six codes for one address through `request`,
then asks for one more in the browser, and what refuses it is the per-email ceiling rather than a
per-address one the flood would have filled for the page as well.

Without an address of its own a caller shares one bucket with every other caller in the run: a
long run trips a ceiling partway through, every spec after it fails for a reason that has nothing
to do with what it was testing, and Better Auth logs that it could not tell the callers apart.

### The ceilings a spec runs into

- **Per email.** `EMAIL_CODE_EMAIL_RULE` in `apps/api/src/auth/constants.ts` — five in ten
  minutes, applied by `limitCodesByEmail` in `apps/api/src/auth/routes.ts` as Hono middleware on
  `SEND_EMAIL_CODE_PATH`, ahead of Better Auth's own rule for that path. It keys on a hash of the
  address in the body, so which client asked makes no difference.
- **Per client address.** `limitByIp` in `apps/api/src/ingress/limits.ts` reads `CLIENT_IP_HEADER`
  and applies `OAUTH_IP_RULE`, `PAGE_IP_RULE`, `TRPC_IP_RULE` and
  `MCP_UNAUTHENTICATED_IP_RULE`, all in `apps/api/src/auth/constants.ts`; Better Auth's own
  limiter, configured there as `BETTER_AUTH_RATE_LIMIT`, keys on the same header. `MCP_TOKEN_RULE`
  is the odd one out, counted against the bearer token rather than the caller's address.
- **Per person.** `personCeiling` in `apps/api/src/trpc/base.ts` counts a signed-in person's calls
  to one procedure against a rule from the same constants file, `ASK_TO_JOIN_PERSON_RULE` for
  asking to join. Past it the call answers 429 with `Retry-After` and no refusal word. It keys on
  the session's person, so a flood through the page's own `page.request` reaches it.

A spec that means to prove a ceiling names which of the three it is proving, and reaches it from
the side that counts. Read the numbers off those files rather than from here.

## The harness's acts

State is built through the api's harness over HTTP, from `apps/web/e2e/harness.ts`, using the
`request` fixture. Nothing writes a row itself and nothing sets a cookie from outside. Fourteen acts
call `/__harness`, which `apps/api/tests/harness-control.ts` mounts, the Sources two from
`apps/api/tests/harness-sources.ts` and the People three from `apps/api/tests/harness-people.ts`:

| Act | What it does |
| --- | --- |
| `provision` | A workspace with its first Admin — the platform-provisioned act; the product offers no way to make one. It answers the workspace's id, name and slug, and the Admin |
| `person` | A person with no membership, for the refused screen and the picker |
| `addMember` | A second membership at a named role — Admin, Editor or Viewer |
| `removeMember` | Ends a membership, as the People screen will |
| `revokeCredentials` | Revokes a person's credentials, so the next request is refused |
| `markTheOperator` | Grants the operator mark to the person holding an address, or clears it with `"revoke"`, through the ops command's own act and principal — the console's door, and a mark cleared under an open page |
| `invite` | A waiting invitation to an address at a named role, as the invite act leaves it, with no email sent |
| `ageTheSignIn` | Moves every session a person holds to a sign-in 61 minutes ago, behind the api's back — how a spec meets `sign-in-too-old` without waiting an hour |
| `seedRoutes` | The routes a workspace has chosen; a purpose left out of the list has no route, which the screen must show rather than omit |
| `seedBindings` | Source bindings as their acts and the worker leave them — documents, findings kept or overridden by an erasure, quarantined documents, chunks, an index run at any status, a concept and composition citing a document — answering each binding's and document's id |
| `moveTheIndexRun` | The worker's two steps over the workspace's one index run, claimed then done, through the queue's own functions under the worker's role — how a spec watches a state word move without a worker process |
| `makeGroups` | Groups made by a named member through the members slice's own acts, one transaction each, every group holding the members `memberIds` names — the member's own acts on the audit log, and the groups the `Groups` view and a member's sheet start from |
| `askToJoin` | A person's ask to join a workspace by its slug, with a reason, through the members slice's own act and the principal the ask-to-join procedure uses, without its sign-in or its answer's floor — a request waiting on the Requests tab |
| `flagTheName` | A workspace's Admin flags a member's display name through the members slice's own act and principal, without the email the procedure sends the operator — a name waiting on the console's *Names waiting* view |

Fifteen more helpers in the same module drive the browser rather than the harness:

| Helper | What it does |
| --- | --- |
| `anAddress` | An email address nobody else in the run will use, so a code read back is this test's |
| `signIn` | Signs a person in **through the product's own screen** — fill the address, send, read the six-digit code back from the captured transport, fill it, submit, and wait for the code field to be gone rather than for the click |
| `aMemberSignedInAt` | A new workspace's Editor or Viewer, signed in having asked for a path first, so sign-in carries them back to it — where a refused screen is proved |
| `landedAtHome` | Asserts the page is on a role's home, its address and its heading read off the screen list |
| `signedInAtHome` | Opens the sign-in screen, runs `signIn`, and waits for an Admin's home, as the Admin of one workspace arrives |
| `signOutFromTheShell` | Opens the top bar's menu, then signs out, because sign-out is one disclosure in |
| `skipLinkReachesTheScreen` | Tab, the skip link has focus, Enter, `main` has focus — where a shell spec's keyboard traversal starts |
| `tabUntilFocused` | Presses Tab until a locator has focus, and fails by name when it never does |
| `tabOpenedByKeyboard` | A fresh document at a view, the skip link, Tab to its open tab, then the arrow keys along to a named tab, each arrow landing before the next |
| `editorPickedByKeyboard` | From a role select in focus reading Viewer: open it, one step up to Editor, pick it, and focus is back on the select |
| `keystrokesListed` | Presses `?` and answers the screen's list of keystrokes once it is open |
| `keystrokesDismissed` | Presses Escape and waits for the list to go and for focus to come back to its button, which lands a task later and would take focus from a sooner key |
| `clockTheNextKey` | Starts the act's clock in the page: from the next key to the node an XPath names reading a given text |
| `theActLandedWithinItsBudget` | Reads that clock, annotates the test with it and asserts it under the act's 100 ms |
| `saysItsSentenceNotItsWord` | Asserts an alert reads the sentence a feature's refusal table holds for a word, and that the word is nowhere on the page |

The sign-in code is read from that capture and from nowhere else: the api's logger is forbidden from ever
holding one.

Four more play Claude's part in its OAuth flow on the suite's own origin — `apps/web/e2e/consent.spec.ts` for the consent screen, `apps/web/e2e/console-people.spec.ts` for a person holding a client grant:

| Helper | What it does |
| --- | --- |
| `aPkcePair` | A verifier and its challenge, as Claude mints one for each connection |
| `claudesAuthorizeUrl` | Claude's authorize request for the MCP surface at an origin, with an optional challenge, `prompt` and `state` |
| `catchClaudesRedirect` | Answers the redirect to claude.ai with a stand-in page, since the suite cannot reach it |
| `claudeExchanges` | Exchanges the code at the redirect for tokens, which is when the grant's refresh token is minted |

## Writing a spec

- **Locate by role and accessible name.** `getByRole`, `getByLabel`, `getByText`. Test ids appear
  nowhere in this suite; adding one adds a handle the reader does not have.
- **Wait with auto-retrying matchers.** `await expect(…).toBeVisible()`, `.toHaveURL()`,
  `.toHaveCount(0)`. Where a navigation must complete before the next act, assert the thing that
  proves the screen was left. Never a fixed sleep, and never a load state.
- **Title says what the system does for whom** — `"a member of two workspaces picks
  one, and everything after is scoped to the pick"`, not `"picker test"`.
- **Minimal comments** — only comment to clarify non-obvious intent; never restate what the next line of code does.
- **Give an assertion a message wherever the failure would not name itself.** The harness's own
  `${path} answered ${status}` is the pattern, and so are the axe assertion and the gate's refusal
  in `apps/web/e2e/browser.ts`.
- **Read the SPA's own constants, words as well as screens, rather than copying them.**
  `apps/web/e2e/routes.spec.ts` imports `@/shared/screens.ts`, so the list of screens is written
  once. Read a sentence the same way: import it from a feature's word table
  (`apps/web/src/features/sources/words.ts`), the screen list or the role meanings
  (`apps/web/src/features/people/role-meanings.ts`). Then assert the state it belongs to: the
  region, its role, the next action. Never pin prose as a literal, so rewording a screen breaks no
  spec. Read a control's accessible name from the same table where one exists. Two things stay
  literal: the trust words, a closed set that is part of the behaviour, and text a person types.
  A refusal's sentence comes from its feature's `refusal-words.ts`, or `@/shared/refusal-words.ts`
  for the class fallbacks. A word table imports no React or tRPC code at runtime, so the suite
  loads it without the rest of the SPA.
- **A latency budget is measured, annotated and asserted** — `test.info().annotations.push(…)`
  beside the comparison, so a run that passes still says how close it came. A list's second is
  timed from a fresh `goto`, so no cache answers it. An act's 100 ms is timed **in the page** — a
  keydown listener and a `MutationObserver` — because a matcher's polling is coarser than the
  budget. `apps/web/e2e/sources.spec.ts` times both; the act's clock is the harness's two helpers
  above.

## The accessibility gate

The accessibility rule is WCAG 2.2 AA tested with a keyboard and a screen reader, and the suite carries that as
three things, of which automated rules are only one:

- **An `AxeBuilder` pass** (`@axe-core/playwright`) over `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
  and `wcag22aa`, asserted to have no violations. **It is run for you**: the fixture in
  `apps/web/e2e/browser.ts` audits the screen the test leaves the browser on, once the body has
  finished, and stands aside where the test has already failed so the real error is the one
  reported. A new spec is held to it by existing, and there is nothing to remember.
- **A keyboard traversal** reaching the screen and each of its acts without a pointer:
  `apps/web/e2e/sign-in.spec.ts` for the three screens outside the shell,
  `apps/web/e2e/frame.spec.ts` for the rail and the secondary nav, and
  `apps/web/e2e/routes.spec.ts` and `apps/web/e2e/failed-screen.spec.ts` for theirs. It is the
  floor, not the extra.
- **An aria snapshot**, written inline with `toMatchAriaSnapshot`, where what a screen *sounds
  like* is the thing under test — a row that lost its heading or a list that stopped being a list
  fails it though the pixels are unchanged. `apps/web/e2e/routes.spec.ts` holds one and
  `apps/web/e2e/frame.spec.ts` two.

Ask for the `passesTheAccessibilityGate` fixture — called with no arguments — where the test does
not end on the screen it is about. The routes and failed-screen specs walk on to other screens
afterwards; every test in `apps/web/e2e/consent.spec.ts` ends at the client's own redirect, which
is another origin and no screen of ours. A test that ends somewhere this product did not serve and
audited nothing is refused by name, so an absence is a failure rather than a silence.

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

# one test in it, by title
pnpm --filter @better-answers/web exec playwright test e2e/routes.spec.ts -g "latency budget"

# what would run, starting no server
pnpm --filter @better-answers/web exec playwright test --list
```

This workspace's `check` runs lint, types, the vitest suite and then the whole browser suite, so a
spec left broken fails `check:web` and the root `check` with it.

`test.only` is allowed while debugging and refused under CI by `forbidOnly`: the
specs import `test` from the fixture module, so oxlint's vitest rules never see them and this is
the only fence — a focused spec left behind would run alone and report the suite green.
`apps/web/test/playwright-config.test.ts` holds it both ways. Take the `.only` out before
committing.

## Carried from Onyx

The donor is Onyx's Playwright skill. Its practices that are ours too:

- **API-first set-up.** Build state through the harness; reserve the browser for the behaviour
  under test.
- **Parallel-safe.** No shared mutable state between specs — each provisions its own workspace and
  mints its own address, so two running together never collide.
- **No hardcoded waits.** Auto-retrying matchers, never a timeout a spec picked.
- **Descriptive test names.** Onyx wants the expected behaviour in the title; here the title also
  says whose behaviour it is.
- **DRY helpers, with a comment saying why.** A set-up repeated across a file becomes a local
  helper carrying the reason it exists.
- **Error context.** Onyx re-throws with the page's text and URL; the same duty is met here by the
  message on the assertion, which the runner prints with the diff.

## Not carried

- **Storage-state global set-up.** A session is made by signing in on the product's own screen, so
  what the browser sees is what a person would see.
- **A worker-user pool.** The two client-address fixtures keep parallel workers apart here, and
  people are minted per spec.
- **A second, serial project for slow specs.** Onyx tags them `@exclusive` and gives them one
  worker; there is one project here and nothing yet needs a lane of its own.
- **The Page Object Model.** A screen is located by role and accessible name where it is used, so
  the spec says the words a person would hear rather than a name only the suite knows.
- **An import alias for the suite.** Onyx forbids relative imports and resolves `@tests/e2e/`;
  there are two modules to import here, `./browser.ts` and `./harness.ts`.
- **Visual regression.** Out of scope for v0.1; the aria snapshot is the structural record instead.
- **Theme runs.** No light/dark matrix.
- **Long-running dev servers.** Onyx runs against `next dev` and a separate backend; Playwright
  starts the one process here and stops it, so a run reads the build the same way CI does.
