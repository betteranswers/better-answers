# The suite's helpers

The helpers in the suite's modules, the helpers that play Claude's part in OAuth, the readers of the api's answers and the knowledge pages' module. `SKILL.md` gives the rules for using them. The harness's actions are in `apps/web/e2e/harness.ts`.

## The browser helpers

More helpers drive the browser rather than the harness. Most are defined in `apps/web/e2e/locators.ts`, which `harness.ts` re-exports, so a spec imports them from either:

| Helper | What it does |
| --- | --- |
| `anAddress` | An email address nobody else in the run will use, so a code read back is this test's |
| `signInHeading` | The sign-in page's heading, for what the sign-in carries on to: nothing, joining a workspace or connecting Claude |
| `signInByEmail` | Signs a person in **through the product's own page** — fill the address, send, read the six-digit code back from the captured transport, and fill it. Six digits submit on their own, so it clicks nothing, and it waits for the code field to be gone, because leaving the page sooner cancels the sign-in. An Admin or the operator is left on the confirm or setup page, which is where a spec about those pages starts |
| `signIn` | `signInByEmail`, then, once the first page draws, past the confirm or setup page an Admin or the operator meets: it gives the person the harness's authenticator through `withAnAuthenticator`, opens the confirm page afresh with the page's own query, and types the code — the gate passed through the real page, never around it. Anyone else is left where the sign-in sends them. Most specs sign in with this |
| `confirmedWhenAsked` | Waits for the confirm or setup page an action sent the person to, such as joining as an Admin, then passes it as `signIn` does |
| `memberOfTwoWorkspaces` | A person who is the Admin of one new workspace and holds a role, Viewer unless named, in a second. It answers both, and `inTwoWorkspaces` builds on it |
| `signInStatusText` | Asserts the sign-in page's heading and a status that holds words, and answers the status' text |
| `signedInAsTheOperator` | Provisions a workspace, marks its Admin the operator, signs them in at home and answers the workspace with a run tag, for the console specs |
| `landedAtHome` | Asserts the page is on a role's home: its address, read off the navigation list, and its heading. The heading is the page's group's name, or its area's where it has none |
| `notFoundOfferingHome` | Asserts the not-found page and its link to a role's home. A page hidden from the role shows it, as an address that never existed does |
| `signedInAtHome` | Opens the sign-in page, runs `signIn`, and waits for a role's home, an Admin's unless another is named, as a member of one workspace arrives |
| `signedInWithNoWorkspace` | A new person in no workspace, signed in through `signIn` and waiting on the no-workspace page, answered as the harness's `person` |
| `avatarOf` | The avatar's button in the band, found by the person's name though it shows their initials alone |
| `personMenuOpened` | Opens the avatar menu in the band by the person's name and answers it. The avatar shows initials alone, so the name and the role are one disclosure in |
| `signOutFromTheShell` | Opens the avatar menu through `personMenuOpened`, then signs out, because sign-out is one disclosure in |
| `switcherOf` | The workspace switcher in the band, named for where the person is: the workspace they are reading, or the console |
| `switcherMenuOf` | The switcher's open menu, named as its button is |
| `railOf` | The icon rail, the `navigation` named *Areas* |
| `navOf` | The menu, the `navigation` named for the open area, whose name it is given, such as `"Control Centre"` |
| `crumbOf` | A part of the band's breadcrumb by its name. The current part is a link too, so a part that leads somewhere is told by its `href` |
| `skipLinkReachesThePage` | Tab, the skip link has focus, Enter, `main` has focus — where a shell spec's keyboard traversal starts |
| `tabUntilFocused` | Presses Tab until a locator has focus, and fails by name when it never does |
| `tabOpenedByKeyboard` | A fresh document at a page, the skip link, Tab to its open tab, then the arrow keys along to a named tab, each arrow landing before the next |
| `editorPickedByKeyboard` | From a role select in focus reading Viewer: open it, one step up to Editor, pick it, and focus is back on the select |
| `keystrokesListed` | Presses `?` and answers the list of keystrokes once it is open, named for the open page as the navigation list names it |
| `keyListed` | A keystroke's key among the terms of the open list of keystrokes, which sets each action beside its key |
| `keystrokesButton` | The one *Keyboard Shortcuts* button, in the page or in a region it is given: at the rail's foot where the layout is wide, in the band where it is narrow, and a page's own outside the shell |
| `keystrokesDismissed` | Presses Escape and waits for the list to go and for focus to come back to its button, which lands a task later. A key pressed sooner keeps the focus it moved |
| `clockTheNextKey` | Starts the action's clock in the page: from the next key to the node an XPath names reading a given text. Every `fetch` the page sends after the key is held until then, because an action never waits on a round trip. A request in flight at the key is not held |
| `clockTheNextDraw` | The same clock with nothing held, for a timed draw that waits on the server, such as jump-to's list |
| `actionWithinBudget` | Reads that clock, annotates the test with it and asserts it under the action's 100 ms. On CI it only annotates |
| `alertHasText` | Asserts an alert holds words. A refusal's region can stand empty from the first draw, so being in the tree shows no refusal |
| `regionShowsNewText` | Asserts a status or an alert says something other than what it said before, which the spec read from it and hands over. Holding words would pass on what it already said |
| `countOf` | A list's count: the first status its region holds, which its head says |
| `listStatusHasText` | Asserts a list's live region holds words, where a list says its read's state in a paragraph and no alert. No role names that region, so it is found by its `aria-live`, apart from the words the list's head always shows |
| `alertShowsWait` | Asserts an alert names a ceiling's wait, given in seconds as the answer named it, as the page counts it: whole minutes, rounded up, matched by their number. A wait the answer did not name fails |
| `pageHidesRefusalWord` | Asserts the api's word for a refusal is nowhere on the page: the word is for the logs and the wire |
| `keyShown` | An authenticator's key, read off the page as a person types it into their phone, without the spaces that group it in fours |
| `tokenColour` | A design-system token's colour as the browser paints it, so a computed style is compared with the token rather than a copied value |
| `contrastBetween` | WCAG's contrast ratio between two painted `rgb()` colours, as `apps/web/e2e/app/frame.spec.ts` measures each focus edge against the surface behind it |
| `controlEdges` | Each enabled control found by its edge alone, with its fill, every side it draws and the colour behind it, each composited as painted through fills and every ancestor's opacity. A wordless wrapper with a side within 8px of the control's own lends its fill, and its border on each such side. One with no such side lends nothing, and its own fill is the colour behind the control. The gate measures them with `contrastBetween` |
| `switched` | Opens the switcher named for where the person is and picks the radio item holding another workspace's name. It waits for nothing after the pick, so the spec asserts where the person landed |
| `inTwoWorkspaces` | A new person who is the Admin of one new workspace and holds a role in a second, Admin unless Viewer is named. It signs them in through `signIn`, picks the first workspace, waits for the Admin's home and the switcher named for it, and answers the address and both workspaces. A spec about moving between workspaces starts from it |
| `authenticatorCodeField` | The *Authenticator Code* field, by its exact label. `signIn` fills it on the confirm page |
| `failMemberReadUntil` | Drops the shell's member read, fails the member read in the frame's batch, and holds the lone retry until the promise it is given settles. The page then draws with the member unread. A spec sets it up, reloads, and acts before it lets the read land, as `apps/web/e2e/journeys/self-removal-to-the-chooser.spec.ts` does |
| `ACTION_SAMPLES` | How many times a spec clocks one action before it judges it, five. A spec seeds `ACTION_SAMPLES - 1` extra rows, so each sample has a row to act on |
| `actionClocked` | Waits for the clock `clockTheNextKey` started and answers it in milliseconds. It fails when no clock was started, and fails by name when the node had not read its text 2 s after the key while a request was held. A spec collects one per sample for `medianActionWithinBudget` |
| `medianActionWithinBudget` | Annotates the test with every sample of an action and their median, and asserts the median under the action's 100 ms, which on CI it only annotates. It fails by name when the action was never clocked. `actionWithinBudget` is the same check over one sample |
| `tokenPainted` | A design-system token's value for a named CSS property as the browser paints it. It is read off a probe element styled with the token. `tokenColour` is this for `color`. `apps/web/e2e/app/frame.spec.ts` reads `--focus-ring` as `box-shadow` with it |
| `drawnMarks` | The visible elements holding `data-marks` whose `::before` draws, each named by its `data-slot` or its tag. `apps/web/e2e/auth/consent.spec.ts` asserts the card alone draws them |

The sign-in code is read from that capture, with `codeSentTo`, and from nowhere else: the api's
logger is forbidden from ever holding one. `emailsSentTo` counts the emails the capture holds for an address, and the suite's
api delivers nothing to `@unreachable.example`, so a spec can meet an invitation whose email did
not go.

## Claude's part in OAuth

Six more play Claude's part in its OAuth flow on the suite's own origin — `apps/web/e2e/auth/consent.spec.ts` for the consent page, `apps/web/e2e/journeys/consent-and-oauth.spec.ts` and `apps/web/e2e/journeys/console-end-sessions.spec.ts` for a person who has given an assistant access:

| Helper | What it does |
| --- | --- |
| `aPkcePair` | A verifier and its challenge, as Claude mints one for each connection |
| `claudesAuthorizeUrl` | Claude's authorize request for the MCP surface at an origin, with an optional challenge, `prompt` and `state` |
| `catchClaudesRedirect` | Answers the redirect to claude.ai with a stand-in page, since the suite cannot reach it |
| `claudeExchanges` | Exchanges the code at the redirect for tokens, which is when the grant's refresh token is minted, and answers that refresh token |
| `CLAUDES_REDIRECT_URI` | The redirect address the suite's Claude names in its authorize request and its token exchanges, `https://claude.ai/api/mcp/auth_callback`. A spec compares where *Connect* or *Cancel* landed with it. `catchClaudesRedirect` routes it, and `apps/web/e2e/journeys/console-end-sessions.spec.ts` unroutes it |

## The second-factor steps

`apps/web/e2e/second-factor-steps.ts` holds the steps the confirm, recovery and journey specs share once an authenticator exists:

| Helper | What it does |
| --- | --- |
| `heading` | The page's level-1 heading by name |
| `codeField` | The *Authenticator Code* field |
| `theRefusal` | The alert once it holds words |
| `codeOf` | The code an authenticator key shows now |
| `signedInAgain` | Clears the browser's cookies and signs the person in by email again, waiting on the confirm page |
| `anAdminWithAnAuthenticator` | A new Admin whose authenticator is enrolled, with its recovery codes saved or none |
| `recoveryField` | The *Recovery Code* field |
| `codesListed` | The recovery codes' list items |
| `recoveryCodesParagraphs` | The paragraph that says what the set of codes is |
| `codesTicked` | Ticks *I have saved these codes* and presses the named finishing button |
| `regionOf` | A region by its exact name |
| `openAccountFromPersonMenu` | Opens Account from the avatar menu in the band |

## The page modules

Three modules hold what several pages' specs and the journeys share.

`apps/web/e2e/asking.ts` is the New Question page's fixtures and locators:

| Helper | What it does |
| --- | --- |
| `anAuditWorkspace` | A workspace with its Admin and four seeded concepts, one of them unfiled. It answers `workspaceId`, `adminId` and `adminEmail` |
| `QUESTION`, `POLICY`, `DRAFTED`, `DRAFTING` | The audit question, the policy concept, the drafted sentence, and the drafting script that cites it |
| `questionBox`, `askButton` | The New Question region's textbox and its *Ask* button |
| `answered` | A result region by its verdict's name, such as *Answered* or *Related Knowledge* |
| `collectionIn` | A collection's region inside a result |

`apps/web/e2e/people-pages.ts` is the People group's pages and the invitation a person is sent:

| Helper | What it does |
| --- | --- |
| `MEMBERS_PAGE` | The Members page's path, read off the navigation list |
| `membersRegion`, `outcomeOf` | The Members region, and its second status |
| `memberRows`, `tickOf`, `selectionAction` | The person rows, a row's *Select* checkbox, and a button of the selection bar |
| `memberLink`, `thePage`, `openedByName` | A member's link, the main region, and opening a member's page by name until its heading shows |
| `invitationsRegion`, `invitationRows`, `inviteDialog`, `inviteAction`, `addressField` | The Invitations tab's region and rows, the *Invite a Person* dialog, the button that opens it, and its address field |
| `personButton`, `sheetOf` | The Everyone page's button for a person, and the sheet it opens |
| `invitationHeading`, `joinButton`, `nameField`, `invitedAs` | The invitation page's heading, *Join Workspace* button, *Display Name* field, and the paragraph naming the inviter and the role |
| `anInvitation` | Invites a new address to a workspace by a new inviter and answers the address and the link |

`apps/web/e2e/connected-sources.ts` is the Sources page:

| Helper | What it does |
| --- | --- |
| `anAdminAtSources` | A new workspace's Admin, with connected sources seeded if asked, signed in on the Sources page. It answers the workspace and what it seeded |
| `indexed` | A seeded connected source, indexed and Internal unless the call overrides it |
| `connectedSourcesRegion`, `saidIn` | The list's region, and its last status |
| `connectedSourceNamed`, `stateOf`, `lastSyncedOf`, `sensitivityOf` | A source's list item, and its *State*, *Last Synced* and *Sensitivity* values |
| `rowAction` | A row action's button: review, publish, narrow or widen |

## Reading the api's answers

Two helpers in `apps/web/e2e/refused-read.ts` read what the api answered. `refusalAnswering` waits for the next answer to
one tRPC procedure, found by its place in a batch or in a call sent alone. It answers the refusal's
word and class, and each item's word where a set was refused whole. A ceiling carries no word, so
for one it answers the 429 status and the wait in seconds. `authAnswering` waits for the next answer
on a path outside tRPC and answers its status, a ceiling's wait, and the refusal as that path names
it: Better Auth's code, or the word one of the api's own routes sends. The first matching answer settles either, so a read the page asks again
is not waited for. Either throws when that answer is no refusal, so a spec that only awaits one has
still shown the api refused.

## The knowledge module

`apps/web/e2e/knowledge.ts` holds what the knowledge pages' specs share.

| Helper | What it does |
| --- | --- |
| `isKnowledgeFind` | Matches a request whose path names `knowledge.find` anywhere, because the tRPC client batches its reads. A spec hands it to `holdRequests`, `page.route` or a request wait to catch a search's read |
| `holdRequests` | Holds every request a matcher picks until the spec releases it. It answers `reached`, which settles when the first arrives, and `release`. A spec reads the page while a read is still out with it. `apps/web/e2e/knowledge/search.spec.ts` uses it during a search and `apps/web/e2e/journeys/source-upload-to-published.spec.ts` while the sources list loads |
| `scrolledSideways` | How far the page scrolls sideways in pixels, the document's scroll width less its client width. A spec at a narrow width asserts it is 0 |
| `listsItsKeystrokes` | Opens the page's list of keystrokes through `keystrokesListed`. It asserts each given key is among the list's terms and each named action is in it, then dismisses the list through `keystrokesDismissed`. A page's keystroke spec runs it with the page's own keys |
| `conceptsSeeded` | Runs `seedConcepts` and answers a map from each concept's title to what the harness answered for it, its IRI, path and cited documents. `apps/web/e2e/knowledge/concept.spec.ts` and `apps/web/e2e/inbox/waiting-on-you.spec.ts` look concepts up in it by title |
| `knowledgeMenuOpened` | Opens Knowledge from the rail and answers its menu once it shows. `apps/web/e2e/knowledge/collections-and-owners.spec.ts` reads which pages a role sees there |
