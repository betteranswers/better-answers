# Screen review before S2 (BA-36)

> Every built page walked in a real browser on 09/10/2026, against `main` at `a84dbe14`, with `/pixel-perfect:critique`, a keyboard pass, a 24px target check at 390px, a live-region check and the glossary gate. It found 35 issues. Each one that this change does not fix is a Linear issue (*Issues filed*). Three questions are left for the owner (*Decisions for the owner*).

**Not done here:** the screen-reader pass with VoiceOver and NVDA that the owner asked for on 02/10. VoiceOver speaks aloud on the machine the review ran on, and NVDA needs Windows. The DOM half of that pass is F33. The listening half is still owed, and BA-36 stays open until it is done.

## How it was run

- **Server.** The browser suite's api, `apps/api/tests/serve.ts 3150`, served the web build. Its harness seeded a UK accounting practice:
  - eight members across the three roles, and four groups;
  - three invitations (waiting, outside the firm, expired) and an ask to join;
  - a flagged display name and two model choices;
  - three connected sources, holding a cited document, findings, an unreadable scan, and syncs queued, done and never run;
  - a second workspace, a person in no workspace, and the operator.
- **Sessions.** One signed-in session per role: Admin, Editor, Viewer, the operator, a member of two workspaces, and an invitee.
- **Widths and themes.** 1440px and 390px; 320px for sideways scroll. Light theme, then dark forced on by hand (F19).
- **Personas** (`docs/personas/personas.md`). The Founder-Operator and the Knowledge Curator on Control Centre; a Viewer for Ask; the platform operator for the Console.
- **Not walked.** `/display-name` on its own and `/sign-in/link`. Both use the sign-in pages' layout, which F2 and F3 cover.
- **Console errors.** None on any Control Centre page.

Screenshots for every P1 and P2 finding are in `2026-10-09-ba-36-screen-review-assets/`, named by finding.

## Design health score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Counts and states are on every list; empty outcome regions are hidden until they fill (F33) |
| 2 | Match between system and the real world | 2 | Machine values on the page: `upload`, `published:`, `anthropic`, `uk-nino`, "the audit row" (F11, F12, F24, F25, F26) |
| 3 | User control and freedom | 3 | Escape and Cancel work everywhere; Review opens far from the source it reviews (F25) |
| 4 | Consistency and standards | 1 | Three page heads, three secondary-action styles, two table kinds, an off-system consent page and a dark theme that doesn't flip (F3, F9, F10, F18, F19, F34) |
| 5 | Error prevention | 3 | Consequence lines beside every governed action; a disabled Remove says why |
| 6 | Recognition rather than recall | 3 | Breadcrumbs, jump-to and a shortcuts list per page |
| 7 | Flexibility and efficiency | 3 | ⌘K, single-key shortcuts and bulk selection on Members |
| 8 | Aesthetic and minimalist design | 2 | None of the blueprint register is built; the audit log and member page are long-winded (F1, F13, F14) |
| 9 | Help users recover from errors | 2 | An unknown address draws an unstyled page; the operator lands somewhere with no way out (F6, F28) |
| 10 | Help and documentation | 1 | An Editor's or Viewer's only page says "Ask in Claude for now" and nothing about how to connect it (F27) |
| | **Total** | **23/40** | Acceptable, with significant work before a customer meets it |

**Anti-patterns: pass, with one caveat.** There is no gradient, glass, emoji, bounce or decorative imagery, and colour carries meaning only behind words. The caveat is that, with the marks, `Frame`, the grid substrate and the accent button unbuilt, every page reads as a stock shadcn admin. That is the most likely "a generator made this" tell, and F1 is its fix.

## What works

- **Every action names its effect.** Examples: "Widen Client files to Internal for named groups", "Make Amara Okafor an Editor", "Send the invitation", and a consequence line under each. This is the house tone the design system asks for, and it holds on every Control Centre page.
- **The shell holds at every width.** The band, rail and menu meet the token widths. Breadcrumbs name every level. At 320px nothing scrolls sideways, and the menu becomes a sheet.
- **The keyboard is first-class.** Skip link first, focus visible on every control (F31 is about its contrast, not its presence), ⌘K over pages, members and actions, and a per-page shortcut list.

## Findings

Severity: **P1** blocks a person or breaks the brand on a first visit; **P2** costs a person time or trust; **P3** is polish. The `fNN` screenshots are in the assets folder.

### System and design-system package

- **F1 · P1 · every page.** None of the blueprint register is built: no `GridPattern` substrate, no registration marks, no `Frame`, no `Card` with marks, and the primary button carries no marks. `.scratch/research/ui-design-system-conformance-2026-10-09.md` (machine-local) records the same gap in code: the `--mark-*` and `--grid-*` tokens ship, and nothing reads them.
- **F2 · P2 · sign-in, code, setup, recovery codes, account, workspaces, invitation.** The content is pinned top-left at 32px with three-fifths of the viewport empty. No frame or card holds the form (f02).
- **F3 · P2 · the same pages.** Secondary actions in one row use three treatments: a bordered button, an accent-text button, and unstyled text ("Keyboard shortcuts").
- **F15 · P3 · shell.** The rail's open area is a solid near-black square, the heaviest object on every page, outweighing the primary button.
- **F30 · P2 · sign-in refusal.** "Too many codes have been asked for…" has a red left border. The system bans coloured left borders (`features/auth/auth-page.tsx`) (f30).
- **F31 · P2 · WCAG 1.4.11 · every control.** The focus indicator is the kit's 3px ring at 50% accent, about 2.3:1 on the page. The system's 2px `--accent-200` ring with a 1px `--accent-600` edge is in the bridge but loses to the kit's utility (f31).

### Navigation and dead ends

- **F6 · P1 · an unknown address** (`/nothing-here`). It renders with no shell, no logo and no padding: an h1 and a link at 0,0 on white (f06).
- **F7 · P3 · `/ask` as an Admin.** The shell shows with no breadcrumb and no area marked, and "Go to Members" is underlined where no other link is.
- **F8 · P2 · `/account`.** A signed-in page that drops the shell. There is no band, rail or workspace, and the only way back is a link at the foot.
- **F27 · P1 · Ask, the home of an Editor and a Viewer.** "Ask in Claude for now. Your questions and their answers will be listed here." Nothing says how to connect Claude. Every non-Admin meets this first, and it is the only page their menu holds (f27). S2a's Search and S2b's Ask will fill the area; until then the line must carry the steps.
- **F28 · P1 · the operator.** An operator in no workspace who signs in, or opens `/`, lands on "No workspace yet / Ask to join a workspace", with no way into the Console. The operator's declared home is Every workspace (f28).

### Control Centre: People

- **F9 · P2 · Members.** The tab row and "Invite a person" sit above the h1 "People". The h2 "Members" repeats the tab, and the count appears twice with different nouns: "8 members" and "8 people" (f09).
- **F10 · P2 · Groups.** No tab row, so its head differs from Members in the same group. Group names are bold text with no link cue, though each opens a sheet (f10).
- **F14 · P2 · a member's page.**
  - The role shows three times: header pill, Access row and the radios.
  - The disabled primary reads "Make Amara Okafor an Editor" while she already is one.
  - The Groups card, and the group sheet's Members card, have an empty band above their text.
  - "To Amara Okafor" on an activity row is unclear, and "Sign-ins and tokens here: Never ended" is hard to parse (f14).
- **F17 · P3 · Members tabs.** "8 members" stays beside the tabs on Invitations and Requests, where it is the wrong count.
- **F18 · P2 · Requests.** A different table from the other two tabs: no search, an unsunken header, an "Actions" header, a "Waiting" pill on every row, and "Approve" bordered beside a bare "Decline". BA-49's rebuild on the shared list parts covers it (f18).
- **F20 · P2 · 390px.** Email addresses in the Members table break mid-word ("hollisreed.te / st").
- **F21 · P2 · the passkey offer.** It takes three or four lines at the top of every page at 390px, and sits on every page at desktop until dismissed.
- **F35 · P3 · Your workspaces.** The workspaces are bare bordered rows with no role beside each, and the foot holds only "Account", where other sign-in pages carry Sign out and Keyboard shortcuts.
- **Targets (WCAG 2.5.8).** At 390px only the row checkboxes (16×16) and inline links fall under 24px, and all pass on the spacing exception. Nothing to file.

### Control Centre: Sources, Models, System

- **F11 · P2 · Connected sources.**
  - Raw values: "Connector upload", and the lower-case state pills "received" and "published" beside "Restricted".
  - "Review" and "Widen" don't say their effect.
  - A grey band row holds only "Connect a document" (f11).
- **F12 · P2 · Models and spend.** Providers show as raw ids ("anthropic", "voyage"). "No model is set." appears three times with no next step and no word on who sets one (f12).
- **F13 · P2 · Audit log.** Each event is about 90px tall (summary, email line, Details disclosure, family pill), so eleven events fill 1,400px. The family pill repeats on every row (f13).
- **F23 · P2 · Connect a document.** "Named groups are chosen here once the People page lists them" is out of date now that Groups is built.
- **F24 · P2 · More about a source.**
  - Each value leads with its stored value ("published:", "searchable:", "knowledge base:", "keep:").
  - The "Destination" label appears twice.
  - "0 want OCR" is jargon (f24).
- **F25 · P2 · Review.**
  - It opens below the whole list, away from the source clicked.
  - Its three actions show disabled, with no line saying to tick a row first.
  - Raw rule ids and lower-case categories are on the page; BA-29's sweep owns those (f25).
- **F26 · P3 · Widen.**
  - A modal for a reversible change, against "a modal exists only for an irreversible action".
  - "What the audit row will carry" puts a record's shape on the page.
  - "Audience, from Named groups / to Named groups" lists a non-change (f26).

### Console

- **F29 · P3.**
  - Names waiting carries Everyone's description ("Every person on the platform…").
  - Everyone's search is a labelled field above the table, unlike the toolbar search on Members.
  - Every workspace is cards where the other two pages are tables.

### Dark theme

- **F19 · P1 once reachable.** Nothing sets `data-theme`; only the tab icon follows `prefers-color-scheme`. So no person can reach dark mode today.
  - **Forced on with `data-theme="dark"`:** menu items, the open tab, role and group pills, dates and filter text keep light-theme colours on near-black, which makes them unreadable. Jump to and Columns stay white (f19).
  - **With `.dark` alone,** the page is mixed: `index.css`'s `dark:` variant binds only `[data-theme="dark"]`, while `tailwind-bridge.css` honours `.dark` too.

### The assistant consent page

- **F34 · P1 · `/consent`, drawn by the api.** It is off the design system entirely:
  - a system sans, not Geist;
  - a green rounded "Connect" and a rounded "Cancel";
  - a centred column where the other sign-in pages are left-aligned;
  - a straight apostrophe.

  Every person connecting Claude sees it first (f34). It shares the product's origin by design, so the fix is to draw it with the tokens, not to move it into the SPA.

### Setup

- **F4 · P2.** Opening "Set up an authenticator instead" leaves the passkey form open, so two accent-filled primaries show at once (f04).
- **F5 · P3.** The passkey field's label is just "Name", and the 36px input sits beside a 32px button.

### Accessibility

- **F32 · pass.** Fifteen tab stops come before the first page control on Members, with "Skip to the page" first.
- **F33 · P2 · live regions (BA-38).** On every Control Centre page, the empty outcome `output` and `div[role=alert]` are `display:none` until they fill. A screen reader may not track a region that was never rendered, so the first outcome can go unannounced. The count lines ("8 people", "11 events.") are visible `output`s and are fine.

### Glossary

- **The gate.** `apps/api/tests/avoid-words.test.ts` passes on `a84dbe14` (147 tests), so no word the glossary marks internal reaches a page it scans.
- **The rendered text.** Every page's text was matched against `OLD_WORDS`. These hits predate 03/10/2026, so BA-29's sweeps own them:
  - "they stay named on what they checked" (26/09);
  - "Checks concepts" (25/09);
  - "the sessions and assistant access that can act as them" (25/09);
  - "once the file lands" (23/09).
- **One new candidate.** "Sign-ins and tokens" (07/10, `dea100ac`) against *Tokens → Personal tokens* (*Decisions for the owner*).

### Not a page

- **F16 · test harness.** Two seeds the harness accepts end in a 500: `kept: true` on a `default-on` finding trips `finding_restore_check`, and an `unreadableReason` with a space fails the pattern the factory holds it to. Both should answer 400 with the reason.

## Decisions for the owner

1. **BA-12: where does an Editor who owns a collection decide?** The navigation already answers one way. `KNOWLEDGE`'s curation pages and `INBOX` are declared `owners: true`, and Control Centre is Admin-only. So the declared shape is a queue on the reader's areas (Inbox, Knowledge › Curation), not Control Centre filtered by ownership. Nothing records ownership yet (`readerOf` gives every reader `owns: []`), so neither path is visible today. Confirm the declared shape, or change it before S3 names owners.
2. **Is the dark theme in scope for v0.1?**
   - The design system flags it as authored without evidence (`packages/design-system/readme.md` §7).
   - Nobody can reach it today, and forced on it is broken (F19).
   - The choices: build the toggle and fix the surfaces, or drop dark from v0.1 and delete the `dark:` utilities and the bridge's `.dark` branch. The F19 issue waits on this answer.
3. **"Sign-ins and tokens".** The member page's heading and summary row (added 07/10) say *tokens* where `OLD_WORDS` reads *Personal tokens*. The ratchet passes it. Rule whether this sense (the tokens an assistant holds) is the same word.

## Issues filed

Each issue is in Triage, related to BA-36, and cites the findings it carries.

| Findings | Issue |
|---|---|
| F1, F2, F3, F15, F30, F31 | BA-97, the design-system package S2a's web units wait on |
| F19 | BA-98, waits on decision 2 |
| F6, F7, F8 | BA-99 |
| F27 | BA-100 |
| F28 | BA-101 |
| F34 | BA-102 |
| F9, F10, F17, F21 | BA-103 |
| F11, F12, F23, F24, F25, F26 | BA-104 |
| F13, F14, F20, F29 | BA-105 |
| F4, F5, F35 | BA-106 |
| F16 | BA-107 |
| F18 | comment on BA-49 |
| F33 | comment on BA-38 |
| Decision 1 | comment on BA-12 |
