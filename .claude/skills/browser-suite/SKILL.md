---
name: browser-suite
description: How this repository drives a browser: the served-build seam, the client-address fixtures, the harness's actions and helpers, locators, waiting, the accessibility gate and the journeys. Use when writing, debugging or running a Playwright spec under apps/web/e2e or a journey under apps/web/journeys, when a spec fails, flakes or hangs, when the gate refuses a page, when a spec needs state no harness action makes, or when a change renames a page's label, heading or accessible name.
---

# The browser suite

`apps/web`'s interface is the **served build driven by a browser**, so a fact about a
page is read here and a page is never asserted against its source. Everything below is what
the suite already is; `apps/web/e2e/models-and-spend.spec.ts` is the fullest worked example.

Three reference files hold the detail. Open the one a task needs:

- **`references/harness.md`**: every harness action and helper, what a refused seed leaves
  behind, the ceilings a spec runs into, and the readers of the api's answers. Open it before
  writing set-up, before reaching for a helper (sign-in, shell locators, keyboard, latency clocks,
  Claude's part in OAuth, the knowledge pages' module), and before adding an action or a helper,
  which may already exist.
- **`references/accessibility-gate.md`**: what the audit checks, and how the gate proves itself.
  Open it when the gate refuses a page, when a spec is about one theme, or when a change touches
  the gate.
- **`references/journeys.md`**: the production journeys, their configuration, code sources,
  outcome words and the by-hand run. Open it before changing a page a journey walks, and before
  writing or running a journey or reading its outcome word.

## The seam

The server under the browser is the api's own test harness, `startApp` in
`apps/api/tests/harness.ts`, over a Testcontainers Postgres and a Garage object store. The email
transport captures codes, Claude's client metadata document is served in process, and a model wire
answers each workspace's model calls as its spec scripted them and fails any call no script
answers. Playwright starts it as a **process**, not an import: `apps/web` imports nothing from
`apps/api` at runtime, so launching it is the only way the browser suite reaches the real server.
`apps/api/tests/serve.ts` takes a port as its one argument and listens on it, with the harness's
control paths (`apps/api/tests/harness-control.ts`) mounted in front of the api and served
nowhere in `apps/api/src`.

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

`apps/web/playwright.config.ts` holds the port, the `webServer` command (`node tests/serve.ts`
run in `apps/api`, handed that port) and `/health` as the readiness URL. `/health` answers only
once the database is migrated and the authorization server has initialised. The api's `serve:e2e`
script is the same command for a person to run by hand. Playwright never goes through it: pnpm
11.27 and later start a script in a process group of its own, which Playwright's kill never
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

The two addresses are **different on purpose**. The browser is one client and the set-up traffic
is another, so a spec that floods a path through `request` leaves the page's own bucket untouched.
`apps/web/e2e/sign-in.spec.ts` is the case: it posts six codes for one address through `request`,
then asks for one more in the browser, and what refuses it is the per-email ceiling rather than
a per-address one the flood would have filled for the page as well. Without an
address of its own, a caller shares one bucket with every other caller in the run, and a long run
trips a ceiling partway through. Both addresses come from RFC 2544's benchmarking block, keyed by
worker index and a per-run count. The header's name is written out in `browser.ts` rather than
imported, because `apps/web` takes nothing from `apps/api` at runtime. A spec that means to prove a ceiling names which ceiling it
proves and reaches it from the side that counts; `references/harness.md` lists the three.

## Building state

State is built through the api's harness over HTTP, from `apps/web/e2e/harness.ts`, using the
`request` fixture. Nothing writes a row itself and nothing sets a cookie from outside. Each
action calls `/__harness`, which `apps/api/tests/harness-control.ts` mounts, and an area's own
actions live beside it in `apps/api/tests/harness-*.ts`. The same module re-exports the locators
and browser helpers in `apps/web/e2e/locators.ts`. Most specs sign in with `signIn` or
`signedInAtHome`, which pass through the product's own sign-in page and its second-factor gate,
never around them. Each spec provisions its own workspace with `provision` and mints its own
address with `anAddress`, so two specs running together never share state.

A seed the harness cannot write answers 400, naming each field and its rule, and the action's
failure carries that answer, so read the reason there and not in the server's log. A seed that a
slice's own action writes can leave part of its rows behind when refused part-way;
`references/harness.md` says which seeds do. Before adding an action or a helper, search that
file for one that already does the job.

## Writing a spec

- **Locate by role and accessible name, and write the name in the spec.** `getByRole`,
  `getByLabel`, `getByText`. A control, a heading, a region, a dialog and a field are each found by
  the name the page gives them, written as a literal where the spec uses it. A name built from
  seeded data is a template over that data, such as `` `Remove ${member.name}` ``. Playwright
  matches a name as a substring in any case, so a name that sits inside another control's name on
  the same page takes `exact: true`. A check that a name is absent holds only while that name
  still names the control, so the same spec also finds the control by that name, held once, where
  the page shows it. Test ids appear nowhere in this suite; adding one adds a handle the reader
  does not have.
- **Import none of the web's text.** A spec and a journey import from the SPA only what is not
  text: a page's address, a wire word, a limit, a count, a key's letter, a type, a function that
  formats seeded data. A changed label then fails the tests that name that control, at run time,
  and nothing else. `apps/web/e2e/models-and-spend.spec.ts` reads its page's address off
  `apps/web/src/shared/navigation.ts` and writes each name itself.
- **Find the shell by its landmarks:**
  - The top band is the `banner`.
  - The icon rail is the `navigation` named *Areas*, one link per area, which `railOf` finds.
    Its foot holds *Keyboard Shortcuts*, which `keystrokesButton` finds.
  - The menu is the `navigation` named for the open area, such as *Control Centre*, with each
    group a heading over its pages' links. `navOf` finds it.
  - The breadcrumb is the `navigation` named *Breadcrumb*, inside the banner. `crumbOf` finds a
    part of it.
  - Jump-to is the banner's button named *Jump To*. It opens a `dialog` of the same name
    holding a `combobox`.
  - The workspace switcher is `switcherOf` and its menu `switcherMenuOf`. The avatar is
    `avatarOf`, and its menu is `personMenuOpened`.
  - At a narrow width the navigation control opens a `dialog` named *Menu*, holding
    the rail and the menu.

  `apps/web/e2e/frame.spec.ts` holds the shell. `apps/web/e2e/jump-to.spec.ts` and
  `apps/web/e2e/workspace-switcher.spec.ts` are the worked examples for jump-to and the switcher.
- **Wait with auto-retrying matchers.** `await expect(…).toBeVisible()`, `.toHaveURL()`,
  `.toHaveCount(0)`. Where a navigation must complete before the next action, assert the thing that
  proves the page was left. Never a fixed sleep, and never a load state.
- **Title says what the system does for whom**: `"a member of two workspaces picks
  one, and everything after is scoped to the pick"`, not `"picker test"`.
- **A set-up repeated across a file becomes a local helper**, with a comment saying why it exists.
- **Give an assertion a message wherever the failure would not name itself.** The harness's own
  `${path} answered ${status}` is the pattern, and so are the axe assertion and the gate's refusal
  in `apps/web/e2e/browser.ts`.
- **Assert what the page does, never a sentence it shows.** A test may assert seeded data, text a
  person types, a closed-set word, a number, and the accessible name of a control, heading, region
  or dialog. The trust words and the api's refusal words are closed sets. A sentence the web shows
  is asserted nowhere, so rewording a page breaks no spec. Assert what the sentence stood for: the
  region and its role, the data or the state that changed, the next action. A region that stands
  empty until it has something to say is checked for holding words, with `toHaveText(/\S/)` or
  `filter({ hasText: /\S/ })`. `apps/web/e2e/outcome-regions.spec.ts` finds such a region while it
  is still empty, with `filter({ hasNotText: /\S/ })`, and checks the outcome lands in that same
  region. An aria snapshot keeps roles, names, levels, states and order, and no prose line of any
  kind, `- text:` lines included. A name in one is a literal, and a name from seeded data goes in
  through `JSON.stringify`, which quotes it as the snapshot takes it.
- **Tell which refusal happened from where it was decided.** Where the api answered, read its
  answer with `refusalAnswering` or `authAnswering` from `./refused-read.ts`
  (`references/harness.md` says what each answers), then check the alert with `saysARefusal`.
  Ask for the answer before the action that calls and await it afterwards, because an answer can
  land before anything waits for it. Holding words shows a refusal only in an alert that said
  nothing before it. In one that already says a refusal, read what it says first, then check with
  `saysSomethingNew` that it says something else. A ceiling's answer carries no word, so the spec
  hands the wait it names to `saysTheWait`. The api's word is for the logs and the wire, and
  `keepsItsWordOffThePage` asserts the page shows none of it. A refusal the page draws outside an
  alert, as a console list's refused read and the concept page's not found are, is told by the
  answer and by the state the page is left in. Where that state is something gone from a region,
  the spec also checks the region says something in its place, as `saysOfItsRead` does for a list.
  Where the page decided (a request dropped, a refusal the page raises before it calls, the tries
  left for a code), no answer says which refusal it was, so `saysARefusal` is the whole check and
  a number the alert shows is matched by pattern. No spec imports a refusal's sentence, and the
  page gains no marker for a test's sake. `apps/web/e2e/people.spec.ts` reads a batched answer,
  `apps/web/e2e/sources.spec.ts` one sent alone and a refusal the page raises itself,
  `apps/web/e2e/sign-in.spec.ts` Better Auth's, and `apps/web/e2e/knowledge-search.spec.ts` a
  dropped request.
- **A latency budget is measured, annotated and asserted**: `test.info().annotations.push(…)`
  beside the comparison, so a run that passes still says how close it came. A list's second is
  timed from a fresh `goto`, so no cache answers it. An action's 100 ms is timed **in the page**,
  with a keydown listener and a `MutationObserver`, because a matcher's polling is coarser than the
  budget. `apps/web/e2e/sources.spec.ts` times both, with `clockTheNextKey` and
  `theActionLandedWithinItsBudget`. Most specs time one sample;
  `apps/web/e2e/people.spec.ts` and `apps/web/e2e/people-groups.spec.ts` take the median of
  `ACTION_SAMPLES` through `theActionsLandedWithinTheirBudget`.
- **A shared part no page draws yet is bundled with Vite, not imported.** Playwright compiles
  every `.tsx` it loads with its own JSX runtime, so React cannot render a component a spec imports.
  `apps/web/e2e/drawn-parts.ts` builds a unit-suite harness through Vite from a virtual entry
  with `bundledHarness`, once per file, and `harnessDrawn` draws it on the SPA's origin under the
  served stylesheets; `apps/web/e2e/list-parts.spec.ts` and
  `apps/web/e2e/blueprint-parts.spec.ts` use it. The page carries only the served build's
  stylesheet, so a class that appears in the harness alone is missing from it, with no error.

## The accessibility gate

The accessibility rule is WCAG 2.2 AA tested with a keyboard and a screen reader, and the suite
carries that as three things, of which automated rules are only one:

- **An `AxeBuilder` pass** (`@axe-core/playwright`) over `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
  and `wcag22aa`, asserted to have no violations. The fixture in `apps/web/e2e/browser.ts` runs
  it on the page the test leaves the browser on, once the body has finished and passed, in light
  and in dark, so a new spec is held to it by existing and a gate failure appears only once the
  test's own assertions pass. The audit also refuses a control whose edge and fill
  both sit under 3:1 against what is behind it, and a page with more than three registration marks.
  `references/accessibility-gate.md` says what the audit sets aside and how it measures.
- **A keyboard traversal** reaching the page and each of its actions without a pointer:
  `apps/web/e2e/sign-in.spec.ts` for the three pages outside the shell,
  `apps/web/e2e/frame.spec.ts` for the band, the rail and the menu, and
  `apps/web/e2e/models-and-spend.spec.ts` and `apps/web/e2e/failed-page.spec.ts` for theirs. It is
  the floor, not the extra.
- **An aria snapshot**, written inline with `toMatchAriaSnapshot`, where what a page *sounds
  like* is the thing under test: a row that lost its heading or a list that stopped being a list
  fails it though the pixels are unchanged. `apps/web/e2e/models-and-spend.spec.ts` holds one and
  `apps/web/e2e/frame.spec.ts` two.

Ask for the `passesTheAccessibilityGate` fixture, called with no arguments, where the test does
not end on the page it is about. The models-and-spend and failed-page specs walk on to other pages
afterwards; most tests in `apps/web/e2e/consent.spec.ts` end at the assistant's own redirect, which
is another origin and no page of ours. A test that ends somewhere this product did not serve and
audited nothing is refused by name, so an absence is a failure rather than a silence.
`apps/web/e2e/models-and-spend.spec.ts` carries all three and is the model to copy.

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
The merge queue runs the browser suite as three shards of `check:web:e2e`, with three workers each.

`test.only` is allowed while debugging and refused under CI by `forbidOnly`. The specs import
`test` from the fixture module, so oxlint's vitest rules never see them and this is the only
fence: a focused spec left behind would run alone and report the suite green.
`apps/web/test/playwright-config.test.ts` holds it both ways. Take the `.only` out before
committing.

Under CI a failed test gets one retry, and the retry records a trace. A test that passes only on
its retry is flaky, not green. `apps/web/e2e/flaky-report.ts` names it in a warning annotation
and in the job's summary, with its first failure; file a ticket with the run id. Nothing is
retried on a local machine.

## The journeys

The journeys sign in to production as the test workspace's Admin, Editor and Viewer, and walk
the pages each role reaches. They live in `apps/web/journeys/`, extend the suite's `test`, and
run after a release, never in `check`, a pull request or the merge queue. A journey writes each
name itself, as a spec does, so a label changed under one fails nothing until the journey runs.
A change to a page a journey walks, a label it names included, changes that journey in the same
pull request and runs it by hand against the browser suite's api with the harness code source.
Each role's spec in `apps/web/journeys/` names its pages as `test.step` titles, so read those to
learn whether a change reaches a journey.
`references/journeys.md` gives the run, the configuration and the outcome words.

## Not carried

The suite started from Onyx's Playwright skill and leaves these of its practices out:

- **Storage-state global set-up.** A session is made by signing in on the product's own page, so
  what the browser sees is what a person would see.
- **A worker-user pool.** The two client-address fixtures keep parallel workers apart, and
  people are minted per spec.
- **A second, serial project for slow specs.** There is one project, and nothing yet needs a lane
  of its own.
- **The Page Object Model.** A page is located by role and accessible name where it is used, so
  the spec says the words a person would hear rather than a name only the suite knows.
- **An import alias for the suite.** A spec imports its sibling modules by relative path:
  `./browser.ts`, `./harness.ts`, `./refused-read.ts`, `./knowledge.ts`, `./drawn-parts.ts` and
  `./virtual-authenticator.ts`.
- **Visual regression.** Out of scope for v0.1; the aria snapshot is the structural record.
- **Long-running dev servers.** Playwright starts the one process and stops it, so a run reads the
  build the same way CI does.
