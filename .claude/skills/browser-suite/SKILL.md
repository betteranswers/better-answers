---
name: browser-suite
description: How this repository drives a browser — the served-build seam, the two client-address fixtures, the api harness's acts, locators, waiting, the accessibility gate and the journeys. Use when writing, changing, debugging or running a Playwright spec under apps/web/e2e or a journey under apps/web/journeys.
---

# The browser suite

`apps/web`'s interface is the **served build driven by a browser**, so a fact about a
page is read here and a page is never asserted against its source. Everything below is what
the suite already is; `apps/web/e2e/models-and-spend.spec.ts` is the fullest worked example.

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
flow is provable in a browser at all. It is `http://localhost:3100`, never `127.0.0.1`: a
passkey's relying party must be a domain, and WebAuthn refuses an IP address.

A spec that makes or uses a passkey attaches a virtual authenticator to its page first, through
`aVirtualAuthenticator` in `apps/web/e2e/virtual-authenticator.ts`, which drives Chromium's
WebAuthn domain over the DevTools protocol. It verifies its user and answers every prompt with no
prompt shown, the email field's autofill included: a page opening the sign-in page while the
device holds a passkey the platform keeps is signed in at once. Its `leftUnattended` leaves every
prompt waiting, so that page signs in by email, and `attendedAgain` answers prompts again.
`withoutWebAuthn` is a browser with none. `apps/web/e2e/passkeys.spec.ts` is the worked example,
and `apps/web/e2e/confirm-recovery.spec.ts` signs in by email while the device holds a passkey.

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
`request` fixture. Nothing writes a row itself and nothing sets a cookie from outside. Eighteen acts
call `/__harness`, which `apps/api/tests/harness-control.ts` mounts, the Sources two from
`apps/api/tests/harness-sources.ts` and the People three from `apps/api/tests/harness-people.ts`:

| Act | What it does |
| --- | --- |
| `provision` | A workspace with its first Admin — the platform-provisioned act; the product offers no way to make one. It answers the workspace's id, name and slug, and the Admin |
| `person` | A person in no workspace, for the refused page and the picker |
| `addMember` | A second member at a named role — Admin, Editor or Viewer |
| `removeMember` | Removes a member, as the People page will |
| `endEverySignInAndToken` | Ends every sign-in and token a person holds, so the next request is refused |
| `markTheOperator` | Grants the operator mark to the person holding an address, or clears it with `"revoke"`, through the ops command's own act and principal — the console's door, and a mark cleared under an open page |
| `invite` | A waiting invitation to an address at a named role, as the invite act leaves it, with no email sent; or one accepted or cancelled, or with its expiry moved into the past |
| `ageTheSignIn` | Moves every session a person holds to a sign-in 61 minutes ago, behind the api's back — how a spec meets `sign-in-too-old` without waiting an hour |
| `ageThePendingHour` | Moves the pending clock of every session a person holds to an hour and a minute ago, behind the api's back — how a spec meets a sign-in that ended unconfirmed without waiting the hour |
| `ageTheCode` | Moves the expiry of the code sent to an address into the past — how a spec meets an expired code without waiting out its lifetime |
| `withAnAuthenticator` | Writes an authenticator for an address straight to the store, sealed as the library seals one, spending no emailed code and sending no notice, and answers the key a spec makes codes from with `authenticatorCodeAt`. A second ask answers the same key. It also issues ten recovery codes, marked saved, as a first setup leaves an Admin. `enrolledWith` is the same act answering those codes too, or issuing none with `"none"`, as someone just made an Admin holds |
| `restored` | The platform operator's restore, through the ops command's own act and principal: the person's factors, recovery codes and sessions end, and a restore code that expires in 24 hours is answered. No notice is sent, so a code read back afterwards is still the sign-in's |
| `seedModelChoices` | The model choices a workspace has made; a purpose left out of the list has no model choice, which the page must show rather than omit |
| `seedConnectedSources` | Connected sources as their acts and the worker leave them — documents, findings kept or overridden by an erasure, quarantined documents, passages, a sync at any status, a concept and composition citing a document — answering each connected source's and document's id |
| `moveTheSync` | The worker's two steps over the workspace's one sync, claimed then done, through the queue's own functions under the worker's role — how a spec watches a state word move without a worker process |
| `makeGroups` | Groups made by a named member through the members slice's own acts, one transaction each, every group holding the members `memberIds` names — the member's own acts on the audit log, and the groups the `Groups` page and a member's page start from |
| `askToJoin` | A person's ask to join a workspace by its slug, with a reason, through the members slice's own act and the principal the ask-to-join procedure uses, without its sign-in or its answer's floor — a request waiting on the Requests tab |
| `flagTheName` | A workspace's Admin flags a member's display name through the members slice's own act and principal, without the email the procedure sends the operator — a name waiting on the console's *Names waiting* page |

Thirty-one more helpers in the same module drive the browser rather than the harness:

| Helper | What it does |
| --- | --- |
| `anAddress` | An email address nobody else in the run will use, so a code read back is this test's |
| `signInHeading` | The sign-in page's heading, read off its word table for what the sign-in carries on to: nothing, joining a workspace or connecting Claude |
| `quoted` | A table's sentence quoted as an inline aria snapshot takes it, so the snapshot reads the words rather than copying them |
| `signInByEmail` | Signs a person in **through the product's own page** — fill the address, send, read the six-digit code back from the captured transport, and fill it. Six digits submit on their own, so it clicks nothing, and it waits for the code field to be gone, because leaving the page sooner cancels the sign-in. An Admin or the operator is left on the confirm or setup page, which is where a spec about those pages starts |
| `signIn` | `signInByEmail`, then, once the first page draws, past the confirm or setup page an Admin or the operator meets: it gives the person the harness's authenticator through `withAnAuthenticator`, opens the confirm page afresh with the page's own query, and types the code — the gate passed through the real page, never around it. Anyone else is left where the sign-in sends them. Most specs sign in with this |
| `confirmedWhenAsked` | Waits for the confirm or setup page an act sent the person to, such as joining as an Admin, then passes it as `signIn` does |
| `aMemberSignedInAt` | A new workspace's Editor or Viewer, signed in having asked for a path first, so sign-in carries them back to it — where a refused page is proved |
| `landedAtHome` | Asserts the page is on a role's home, its address and its heading read off the navigation list. The heading is the page's group's name, or its area's where it has none |
| `notFoundOfferingHome` | Asserts the not-found page and its link to a role's home. A page hidden from the role shows it, as an address that never existed does |
| `signedInAtHome` | Opens the sign-in page, runs `signIn`, and waits for a role's home, an Admin's unless another is named, as a member of one workspace arrives |
| `signedInWithNoWorkspace` | A new person in no workspace, signed in through `signIn` and waiting on the no-workspace page, answered as the harness's `person` |
| `avatarOf` | The avatar's button in the band, found by the person's name though it shows their initials alone |
| `personMenuOpened` | Opens the avatar menu in the band by the person's name and answers it. The avatar shows initials alone, so the name and the role are one disclosure in |
| `signOutFromTheShell` | Opens the avatar menu through `personMenuOpened`, then signs out, because sign-out is one disclosure in |
| `switcherOf` | The workspace switcher in the band, named for where the person is: the workspace they are reading, or the console |
| `switcherMenuOf` | The switcher's open menu, named as its button is |
| `railOf` | The icon rail, the `navigation` named `RAIL` |
| `navOf` | The menu, the `navigation` named for the area it is given, such as `CONTROL_CENTRE` |
| `crumbOf` | A part of the band's breadcrumb by its name. The current part is a link too, so a part that leads somewhere is told by its `href` |
| `skipLinkReachesThePage` | Tab, the skip link has focus, Enter, `main` has focus — where a shell spec's keyboard traversal starts |
| `tabUntilFocused` | Presses Tab until a locator has focus, and fails by name when it never does |
| `tabOpenedByKeyboard` | A fresh document at a page, the skip link, Tab to its open tab, then the arrow keys along to a named tab, each arrow landing before the next |
| `editorPickedByKeyboard` | From a role select in focus reading Viewer: open it, one step up to Editor, pick it, and focus is back on the select |
| `keystrokesListed` | Presses `?` and answers the list of keystrokes once it is open, named for the open page as the navigation list names it |
| `keystrokesButton` | The one *Keyboard shortcuts* button, in the page or in a region it is given: at the rail's foot where the layout is wide, in the band where it is narrow, and a page's own outside the shell |
| `keystrokesDismissed` | Presses Escape and waits for the list to go and for focus to come back to its button, which lands a task later. A key pressed sooner keeps the focus it moved |
| `clockTheNextKey` | Starts the act's clock in the page: from the next key to the node an XPath names reading a given text |
| `theActLandedWithinItsBudget` | Reads that clock, annotates the test with it and asserts it under the act's 100 ms |
| `saysItsSentenceNotItsWord` | Asserts an alert reads the sentence a feature's refusal table holds for a word, and that the word is nowhere on the page |
| `keyShown` | An authenticator's key, read off the page as a person types it into their phone, without the spaces that group it in fours |
| `refusedDigitsSelected` | Asserts a refused code's six digits are selected, so the next code typed replaces them |

The sign-in code is read from that capture and from nowhere else: the api's logger is forbidden from ever
holding one. `emailsSentTo` counts the emails the capture holds for an address, and the suite's
api delivers nothing to `@unreachable.example`, so a spec can meet an invitation whose email did
not go.

Five more play Claude's part in its OAuth flow on the suite's own origin — `apps/web/e2e/consent.spec.ts` for the consent page, `apps/web/e2e/console-people.spec.ts` for a person who has given an assistant access:

| Helper | What it does |
| --- | --- |
| `aPkcePair` | A verifier and its challenge, as Claude mints one for each connection |
| `claudesAuthorizeUrl` | Claude's authorize request for the MCP surface at an origin, with an optional challenge, `prompt` and `state` |
| `catchClaudesRedirect` | Answers the redirect to claude.ai with a stand-in page, since the suite cannot reach it |
| `claudeExchanges` | Exchanges the code at the redirect for tokens, which is when the grant's refresh token is minted, and answers that refresh token |
| `claudeDisconnects` | Revokes that refresh token at `/oauth2/revoke`, as Claude does when the person disconnects it, so the authorization server ends the grant itself |

## Writing a spec

- **Locate by role and accessible name.** `getByRole`, `getByLabel`, `getByText`. Test ids appear
  nowhere in this suite; adding one adds a handle the reader does not have.
- **Find the shell by its landmarks**, named from `apps/web/src/app/words.ts` and
  `apps/web/src/shared/navigation.ts`:
  - The top band is the `banner`.
  - The icon rail is the `navigation` named `RAIL`, one link per area, which `railOf` finds.
    Its foot holds *Keyboard shortcuts*, which `keystrokesButton` finds.
  - The menu is the `navigation` named for the open area, such as
    `CONTROL_CENTRE.name`, with each group a heading over its pages' links. `navOf` finds it.
  - The breadcrumb is the `navigation` named `BREADCRUMB`, inside the banner. `crumbOf` finds a
    part of it.
  - Jump-to is the banner's button named `JUMP_TO.name`. It opens a `dialog` of the same name
    holding a `combobox`.
  - The workspace switcher is `switcherOf` and its menu `switcherMenuOf`. The avatar is
    `avatarOf`, and its menu is `personMenuOpened`.
  - At a narrow width the navigation control opens a `dialog` named `NAVIGATION_SHEET`, holding
    the rail and the menu.

  `apps/web/e2e/frame.spec.ts` holds the shell. `apps/web/e2e/jump-to.spec.ts` and
  `apps/web/e2e/workspace-switcher.spec.ts` are the worked examples for jump-to and the switcher.
- **Wait with auto-retrying matchers.** `await expect(…).toBeVisible()`, `.toHaveURL()`,
  `.toHaveCount(0)`. Where a navigation must complete before the next act, assert the thing that
  proves the page was left. Never a fixed sleep, and never a load state.
- **Title says what the system does for whom** — `"a member of two workspaces picks
  one, and everything after is scoped to the pick"`, not `"picker test"`.
- **Minimal comments** — only comment to clarify non-obvious intent; never restate what the next line of code does.
- **Give an assertion a message wherever the failure would not name itself.** The harness's own
  `${path} answered ${status}` is the pattern, and so are the axe assertion and the gate's refusal
  in `apps/web/e2e/browser.ts`.
- **Read the SPA's own constants, words as well as pages, rather than copying them.**
  `apps/web/e2e/models-and-spend.spec.ts` imports `@/shared/navigation.ts`, so the list of areas, groups
  and pages is written once. Read a sentence the same way: import it from a feature's word table
  (`apps/web/src/features/sources/words.ts`), the navigation list or the role meanings
  (`apps/web/src/shared/role-words.ts`). Then assert the state it belongs to: the
  region, its role, the next action. Never pin prose as a literal, so rewording a page breaks no
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
- **A shared part no page draws yet is bundled with Vite, not imported.** Playwright compiles
  every `.tsx` it loads with its own JSX runtime, so React cannot render a component a spec imports.
  `apps/web/e2e/list-parts.spec.ts` builds a unit-suite harness through Vite from a virtual entry
  and runs the script on the SPA's origin. The page carries only the served build's stylesheet, so
  a class that appears in the harness alone is missing from it, with no error.

## The accessibility gate

The accessibility rule is WCAG 2.2 AA tested with a keyboard and a screen reader, and the suite carries that as
three things, of which automated rules are only one:

- **An `AxeBuilder` pass** (`@axe-core/playwright`) over `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
  and `wcag22aa`, asserted to have no violations. **It is run for you**: the fixture in
  `apps/web/e2e/browser.ts` audits the page the test leaves the browser on, once the body has
  finished, and stands aside where the test has already failed so the real error is the one
  reported. A new spec is held to it by existing, and there is nothing to remember. Each audit
  first waits for every transition on the page to end, because axe reads a control part-way
  through its fade as a contrast nobody settles on. A refusal handing a button back from its
  disabled look is the case. An endless animation, such as a spinner, is audited running.
- **A keyboard traversal** reaching the page and each of its acts without a pointer:
  `apps/web/e2e/sign-in.spec.ts` for the three pages outside the shell,
  `apps/web/e2e/frame.spec.ts` for the band, the rail and the menu, and
  `apps/web/e2e/models-and-spend.spec.ts` and `apps/web/e2e/failed-page.spec.ts` for theirs. It is the
  floor, not the extra.
- **An aria snapshot**, written inline with `toMatchAriaSnapshot`, where what a page *sounds
  like* is the thing under test — a row that lost its heading or a list that stopped being a list
  fails it though the pixels are unchanged. `apps/web/e2e/models-and-spend.spec.ts` holds one and
  `apps/web/e2e/frame.spec.ts` two.

Ask for the `passesTheAccessibilityGate` fixture — called with no arguments — where the test does
not end on the page it is about. The models-and-spend and failed-page specs walk on to other pages
afterwards; every test in `apps/web/e2e/consent.spec.ts` ends at the client's own redirect, which
is another origin and no page of ours. A test that ends somewhere this product did not serve and
audited nothing is refused by name, so an absence is a failure rather than a silence.

`apps/web/e2e/models-and-spend.spec.ts` carries all three and is the model to copy.
`apps/web/e2e/accessibility-gate.spec.ts` is the gate's own proof: two of its six tests are
`test.fail()`, so the run prints them with a ✘ and counts them passed — that is the gate firing
where it should, and an `Expected to fail, but passed` there means the gate has stopped running.

## Running it

One project, `chromium`, fully parallel. The api serves the SPA's build output, so a build comes
first or the browser reaches the last build's pages.

```bash
# the whole suite (builds first)
pnpm --filter @better-answers/web run e2e

# one spec, one project
pnpm --filter @better-answers/web run build && \
  pnpm --filter @better-answers/web exec playwright test e2e/models-and-spend.spec.ts --project chromium

# one test in it, by title
pnpm --filter @better-answers/web exec playwright test e2e/models-and-spend.spec.ts -g "latency budget"

# what would run, starting no server
pnpm --filter @better-answers/web exec playwright test --list
```

This workspace's `check` runs types, the vitest suite and then the whole browser suite, so a
spec left broken fails `check:web` and the root `check` with it. Lint is the root's `check:gates`.

`test.only` is allowed while debugging and refused under CI by `forbidOnly`: the
specs import `test` from the fixture module, so oxlint's vitest rules never see them and this is
the only fence — a focused spec left behind would run alone and report the suite green.
`apps/web/test/playwright-config.test.ts` holds it both ways. Take the `.only` out before
committing.

Under CI a failed test gets one retry, and the retry records a trace. A test that passes only on
its retry is flaky, not green. `apps/web/e2e/flaky-report.ts` names it in a warning annotation
and in the job's summary, with its first failure, so file a ticket with the run id. Nothing is
retried on your own machine.

## The journeys

The journeys sign in to production as the test workspace's three test people, an Admin, an
Editor and a Viewer, and walk the pages each role reaches. `.github/workflows/release.yml` runs
them after a release, and against the live release on a night with nothing to promote;
`docs/operations/RUNBOOK.md` page 13 is the owner's side of them. They live in
`apps/web/journeys/`: a preflight, then one spec per role, each page a `test.step`. Their config
is `apps/web/playwright.journeys.config.ts`, and `pnpm --filter @better-answers/web run journeys`
runs them.

They reuse the suite without changing it. `apps/web/journeys/fixtures.ts` extends the `test` from
`apps/web/e2e/browser.ts`, so the accessibility gate is the suite's own, and each journey calls it
on every page it leaves. It overrides `context` and `request` with no client address, because
production's edge sets one. A journey names its person with `test.use({ role })`, and the fixture
signs them in on the product's own sign-in page and signs them out on the server afterwards,
even after a failure. The locators come from `apps/web/e2e/locators.ts`, which `harness.ts`
re-exports. Production has no harness, so `.oxlintrc.json` refuses any harness act under
`apps/web/journeys/` except `codeSentTo`, the harness code source below. The harness's Admin key,
below, is a request of the journeys' own, made only under that source.

| | The browser suite | The journeys |
| --- | --- | --- |
| The server | Playwright starts `apps/api/tests/serve.ts` | None: the base URL is `PUBLIC_URL`, and the config refuses to load without an http or https address |
| Workers | Fully parallel | One, one journey at a time |
| Projects | `chromium` | `preflight`, which signs nobody in, then `roles`, which depends on it |
| Retries | One, under CI | None: each Send spends a ceiling the release, a rerun and the owner share |
| `test.only` | Refused under CI | Refused everywhere: a focused journey would run alone and report `held` |
| Traces, screenshots and video | A trace on the retry | Off: a trace, screenshot or video of a signed-in page would publish a live session |
| Reporter | `list` and the flaky report | The outcome reporter alone, so no failure's detail, which can hold an address, reaches a public log |

The Admin's journey reads the test workspace before any act. A workspace that differs from its
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
`POST /__harness/test-workspaces`, the fixture command's own act, which
`apps/api/tests/harness-control.ts` mounts and no spec calls. It takes a testing domain, a slug and
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
either; by hand, add `--reporter=list` to read one.

`check:web` never runs a journey, since the suite's `testDir` is `e2e`, and nor does a pull
request or the merge queue. Its typecheck does cover them, so renaming a word they read from a
word table fails `check` before it lands. A change to a page a journey walks changes that
journey in the same pull request and runs it by hand as above (`docs/agents/workflow.md`).

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

- **Storage-state global set-up.** A session is made by signing in on the product's own page, so
  what the browser sees is what a person would see.
- **A worker-user pool.** The two client-address fixtures keep parallel workers apart here, and
  people are minted per spec.
- **A second, serial project for slow specs.** Onyx tags them `@exclusive` and gives them one
  worker; there is one project here and nothing yet needs a lane of its own.
- **The Page Object Model.** A page is located by role and accessible name where it is used, so
  the spec says the words a person would hear rather than a name only the suite knows.
- **An import alias for the suite.** Onyx forbids relative imports and resolves `@tests/e2e/`;
  there are three modules to import here, `./browser.ts`, `./harness.ts` and
  `./virtual-authenticator.ts`.
- **Visual regression.** Out of scope for v0.1; the aria snapshot is the structural record instead.
- **Theme runs.** No light/dark matrix.
- **Long-running dev servers.** Onyx runs against `next dev` and a separate backend; Playwright
  starts the one process here and stops it, so a run reads the build the same way CI does.
