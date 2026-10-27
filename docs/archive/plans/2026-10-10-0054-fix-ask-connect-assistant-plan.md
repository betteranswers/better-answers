---
title: Tell an Editor or Viewer on Ask how to connect their assistant - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Tell an Editor or Viewer on Ask how to connect their assistant - Plan

## Goal Capsule

- **Objective:** an Editor or a Viewer who signs in and lands on Ask can connect Claude from what the page says, with the address this deployment serves in front of them.
- **Means:** Ask's unbuilt page gains the connection steps and the address, derived from the page's own origin (KTD1, KTD2), proved in the browser against the address the api itself publishes (KTD4).
- **Authority:** Linear BA-100's acceptance list, then this plan. F27 of `docs/dogfood-reports/2026-10-09-ba-36-screen-review.md` is the evidence.
- **Stop conditions:** stop and report if the page's origin and the api's published address can differ in any served build.
- **Finishes and ships:** an open pull request with its own CI green; the lead merges.

---

## Product Contract

### Summary

Ask stays unbuilt, and its page keeps its one line. Below the line it now carries three numbered steps for connecting Claude, the address to give Claude with a button that copies it, and a closing line that Claude will act as the person, in this workspace.

### Problem Frame

An Editor's and a Viewer's only page is Ask, and today it reads "Ask in Claude for now. Your questions and their answers will be listed here." Nothing says how to connect Claude, so every non-Admin meets a dead end on their first visit. S2a's Search and S2b's Ask will fill the area later; until then the page must carry the steps.

### Requirements

- R1. Ask's page names the steps to connect Claude: where in Claude to add it, the address to give it, and how to finish the connection.
- R2. The address shown is the one the deployment serves, read from where the page is served, never a literal in the source.
- R3. The page says that Claude will act as the person, in this workspace.
- R4. The page's words are the reader's: *assistant* for Claude where the page speaks of it in general (`CONCEPTS.md`), and never the internal word for the endpoint the address reaches.
- R5. The address can be copied with one button, and a copy the browser refuses says so and says what to do instead.
- R6. When S2a's Search or S2b's Ask is built for these roles, this content is revisited or removed. The condition is written beside the words, and a Linear issue holds it.

### Scope Boundaries

- Ask's page is not built here: the navigation list keeps it unbuilt, and S2a and S2b own what fills it.
- No keystroke copies the address. Connecting is done once, not a common action, and Ask lists the shell's keystrokes alone.
- Claude Code and personal tokens are not described. The Account page holds personal tokens, and the person who lands on Ask is connecting Claude on the web or the desktop app.
- The api is not changed. It already serves its MCP resource at its own origin's `/mcp`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The address is the page's origin and the endpoint's path.** The api serves the single-page application only on the `app.` hostname, and `PUBLIC_URL`'s host is that hostname (`apps/api/src/config.ts`, the hostname fence in `apps/api/src/ingress/hostnames.ts`). The protected-resource document's `resource`, and every access token's audience, is `${PUBLIC_URL}/mcp` (`apps/api/src/server.ts`). So `window.location.origin` joined to `/mcp` is that string in every served build: production, the browser suite's `serve.ts` on `http://localhost:<port>`, and a manual look. Reading it through tRPC would cost a request and a loading state to learn a value the page already holds.
- KTD2. **The web states the path rather than importing it.** `apps/web/CODING_STANDARDS.md` says so for the tRPC endpoint, and the reason holds here: the built bundle keeps no reference to the api. The path is one constant beside `TRPC_ENDPOINT`'s kind, and KTD4 is what binds it to the api.
- KTD3. **Ask's content grows inside `UnbuiltPage`.** `drawOf` in `apps/web/src/app/router.tsx` refuses a page the list calls unbuilt that something draws, so Ask is not given a built page. `UnbuiltPage` draws, for Ask's home, a part holding the steps below the line; every other home keeps its line alone. The words live in `apps/web/src/app/words.ts`, beside the line they extend.
- KTD4. **The browser proves the address against the api's own document.** The spec reads `/.well-known/oauth-protected-resource/mcp` through the `request` fixture and asserts the page shows its `resource` exactly. The journeys do not repeat it against production: the document shares one count per client address and minute with every tRPC call, at half tRPC's ceiling, so one more read in a journey that already spends that count would end some releases could-not-run.
- KTD5. **Copying reuses what exists.** `copiedToTheClipboard` (`apps/web/src/features/auth/clipboard.ts`) answers false when the browser refuses. `OutcomeLine` and `refusedWith` (`apps/web/src/shared/`) carry the said and refused outcomes, the status region staying in the tree while empty. The vendored Kibo `Snippet` is not used: its copy button is icon-only and hidden until hover.

### Assumptions

- Claude's own labels are "Settings", "Connectors", "Add custom connector", "Add" and "Connect". The page quotes them as Claude's, in typographic quotes. If Claude renames them, the words table is the one place to change.
- On a Claude Team or Enterprise plan an organisation owner adds a custom connector before members can connect it. The page does not say so; the pull request names this for the owner to decide.

---

## Implementation Units

### U1. Ask's page carries the steps and the address

- **Goal:** Ask's page shows the line, the three steps, the address with its copy button, and the closing line.
- **Requirements:** R1 to R6; KTD1, KTD2, KTD3, KTD5.
- **Dependencies:** none.
- **Files:**
  - Modify: `apps/web/src/app/words.ts`, `apps/web/src/app/pages/unbuilt-page.tsx`
  - Create: `apps/web/src/app/pages/connect-assistant.tsx`
  - Test: `apps/web/test/connect-assistant.test.tsx`, with the clipboard stand-in moved out of `apps/web/test/recovery-codes.test.tsx` into `apps/web/test/clipboard-stand-in.ts` so both share it
- **Approach:**
  1. `words.ts` gains the connection's words: a heading naming the assistant, the three steps, the copy button's label, the copied line, the refusal, and the closing line in the consent page's form (`CONSENT_WORDS.asYou` in `apps/api/src/auth/pages.ts`). Its doc comment states R6's condition.
  2. The part derives the address once, from the page's origin.
  3. The part draws a second-level heading, an ordered list, the address in Geist Mono with `wrap-anywhere`, an outline button described by the address, and an `OutcomeLine`.
  4. `UnbuiltPage` draws the part under Ask's line.
- **Patterns to follow:** the key and its copy button in `apps/web/src/features/auth/authenticator-part.tsx`.
- **Test scenarios:**
  - A Viewer opening `/ask` sees the line, the heading, three list items and the address read from the page's origin.
  - Choosing the copy button writes the address to the clipboard and says it was copied.
  - A clipboard that refuses leaves an alert saying the address was not copied and to select and copy it.
- **Verification:** the web unit suite passes.

### U2. The browser suite proves it

- **Goal:** an Editor's and a Viewer's Ask, as served, shows the address the api publishes, sounds as a list of steps, and passes the accessibility gate.
- **Requirements:** R1, R2, R3, R5; KTD4.
- **Dependencies:** U1.
- **Files:**
  - Modify: `apps/web/e2e/home.spec.ts`, `apps/web/e2e/locators.ts`
- **Approach:**
  1. `locators.ts` gains a helper asserting the address shown on Ask equals the `resource` of the protected-resource document, read through the page's own request context.
  2. `home.spec.ts`'s aria snapshot of Ask's `main` gains the heading, the list and the button; the "hidden page gives itself away" comparison stays as it is.
  3. A test copies the address by keyboard and reads the clipboard back, with clipboard permission granted to the context.
- **Test scenarios:**
  - An Editor and a Viewer each land on Ask, and its `main` reads as heading, line, heading, a list of three steps, the address and the copy button.
  - The address on the page equals the protected-resource document's `resource`.
  - Tab reaches the copy button, Enter copies, the status says so, and the clipboard holds the address.
  - Ask is still drawn within its second, timed on the line it waited on before.
- **Verification:** `home.spec.ts` passes; the journeys, which walk Ask, run by hand against `serve.ts` and end `held`.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Web | `pnpm --filter @better-answers/web run check` | U1, U2: types, unit suite, the whole browser suite |
| Root gates | `pnpm run check:gates` | format, lint, comment density, knip, jscpd |
| Docs | `pnpm run check:docs` | the plan and the page's words pass the words gate |
| Journeys | by hand against `serve.ts`, `JOURNEYS_CODE_SOURCE=harness` | the members' journeys still walk Ask |
| CI | the pull request's own jobs | title, lockfile, lanes |

---

## Definition of Done

- R1 to R6 hold, each proved by a test above or, for R6, by the doc comment and its Linear issue.
- The page never shows a literal address.
- No abandoned attempt remains in the diff.
