# The harness and the helpers

The api harness's actions, the helpers in the suite's modules, the ceilings a spec runs into, and the readers of the api's answers. `SKILL.md` gives the rules for using them.

## The ceilings a spec runs into

- **Per email.** `EMAIL_CODE_EMAIL_RULE` in `apps/api/src/auth/constants.ts` — five in ten
  minutes, applied by `limitCodesByEmail` in `apps/api/src/auth/routes.ts` as Hono middleware on
  `SEND_EMAIL_CODE_PATH`, ahead of that path's count by client address. It keys on a hash of the
  address in the body, so which client asked makes no difference.
- **Per client address.** `limitByIp` in `apps/api/src/ingress/limits.ts` reads `CLIENT_IP_HEADER`
  and counts each route group apart. `AddressScope` there names the groups, and each group's rule
  is in `apps/api/src/auth/constants.ts`. A code's send and a sign-in by code count over ten
  minutes, and the rest over one. Better Auth's own limiter is off, so the api's counts are the
  only ones. `MCP_TOKEN_RULE` is the odd one out, counted against the bearer token rather than
  the caller's address.
- **Per person.** `personCeiling` in `apps/api/src/trpc/base.ts` counts a signed-in person's calls
  to one procedure against a rule from the same constants file, `ASK_TO_JOIN_PERSON_RULE` for
  asking to join. Past it the call answers 429 with `Retry-After` and no refusal word. It keys on
  the session's person, so a flood through the page's own `page.request` reaches it. The knowledge
  reads, `find` and `open`, share one count a person (`knowledgeReadProcedure` in
  `apps/api/src/trpc/knowledge.ts`), which `readsCeilingFilled` in `apps/web/e2e/knowledge.ts`
  fills. The count resets at each minute of the clock, so the helper waits for a fresh minute
  when too few seconds of the current one are left for the fill and the refusal after it.

Read the numbers off those files rather than from here.

## The harness's actions

Each action below is a function in `apps/web/e2e/harness.ts` that calls `/__harness`. An area's own actions live
beside `apps/api/tests/support/harness/harness-control.ts`: Sources in `apps/api/tests/support/harness/harness-sources.ts`, People in
`apps/api/tests/support/harness/harness-people.ts`, Knowledge in `apps/api/tests/support/harness/harness-knowledge.ts`, Questions in
`apps/api/tests/support/harness/harness-questions.ts` and asking in `apps/api/tests/support/harness/harness-asking.ts`:

| Action | What it does |
| --- | --- |
| `provision` | A workspace with its first Admin — the platform-provisioned action; the product offers no way to make one. It answers the workspace's id, name and short name, and the Admin |
| `person` | A person in no workspace, for the refused page and the picker |
| `addMember` | A second member at a named role — Admin, Editor or Viewer |
| `removeMember` | Removes a member, as the People page will |
| `endEverySignInAndToken` | Ends every sign-in and token a person holds, so the next request is refused |
| `markTheOperator` | Grants the operator mark to the person holding an address, or clears it with `"revoke"`, through the ops command's own action and principal — the console's door, and a mark cleared under an open page |
| `invite` | A waiting invitation to an address at a named role, as the invite action leaves it, with no email sent; or one accepted or cancelled, or with its expiry moved into the past |
| `ageTheConfirmation` | Moves the second-factor confirmation of every session a person holds to 61 minutes ago, behind the api's back. A high-impact act then answers `confirmation-too-old` and asks again in the *Confirm It’s You* dialog. It is how a spec meets a stale confirmation without waiting an hour. `apps/web/e2e/reconfirm.spec.ts` is the worked example |
| `ageThePendingHour` | Moves the pending clock of every session a person holds to an hour and a minute ago, behind the api's back — how a spec meets a sign-in that ended unconfirmed without waiting the hour |
| `ageTheCode` | Moves the expiry of the code sent to an address into the past — how a spec meets an expired code without waiting out its lifetime |
| `withAnAuthenticator` | Writes an authenticator for an address straight to the store, sealed as the library seals one, spending no emailed code and sending no notice, and answers the key a spec makes codes from with `authenticatorCodeAt`. A second ask answers the same key. It also issues ten recovery codes, marked saved, as a first setup leaves an Admin. `enrolledWith` is the same action answering those codes too, or issuing none with `"none"`, as someone just made an Admin holds |
| `restored` | The platform operator's restore, through the ops command's own action and principal: the person's factors, recovery codes and sessions end, and a restore code that expires in 24 hours is answered. No notice is sent, so a code read back afterwards is still the sign-in's |
| `seedModelChoices` | The model choices a workspace has made; a purpose left out of the list has no model choice, which the page must show rather than omit |
| `seedConnectedSources` | Connected sources as their actions and the worker leave them — documents, findings kept or overridden by an erasure, unreadable documents, passages, a sync at any status, a concept and write-up citing a document — answering each connected source's and document's id |
| `moveTheSync` | The worker's two steps over the workspace's one sync, claimed then done, through the queue's own functions under the worker's role — how a spec watches a state word move without a worker process |
| `makeGroups` | Groups made by a named member through the members slice's own actions, one transaction each, every group holding the members `memberIds` names — the member's own actions on the audit log, and the groups the `Groups` page and a member's page start from |
| `askToJoin` | A person's ask to join a workspace by its short name, with a reason, through the members slice's own action and the principal the ask-to-join procedure uses, without its sign-in or its answer's floor — a request waiting on the Requests tab |
| `flagTheName` | A workspace's Admin flags a member's display name through the members slice's own action and principal, without the email the procedure sends the operator — a name waiting on the console's *Names waiting* page |
| `seedConcepts` | Concepts a named Admin writes in order through the concepts slice's own write, so each is in the repository, the index and the map as a member's write leaves it. Each takes a kind, a sensitivity and further frontmatter keys, and links to concepts earlier in the list. A source is a document's passages, a concept earlier in the list, or a place such as `p.4` that opens nothing; a document may take a label, the file's own name for it, apart from its title. Each source gets a citation mark `[^source-N]` after the body's last word, unless the body places that mark itself. A document may be held at a sensitivity of its own, and where that differs from the concept's the Admin's override shares the concept beyond its evidence. A trust tier other than `unverified` is a verification row written straight to the store, because the slice has no verify action. A `"groups"` audience is the Admin's own override to one group holding the members `groupMemberIds` names, and nobody outside that group reads the concept, its Admin included. It answers each concept's IRI, path and cited documents |
| `nameOwners` | Owners a named Admin names in order through the concepts slice's own `nameOwner`, each with its `knowledge.owner.named` event on the audit log: a collection's owner by its name, or a concept's own owner by its IRI, which goes before the collection's. A null person clears that owner. The suite's one owner seed, so an Editor or a Viewer writes or sees Curation only once a spec names them. It answers how many it named |
| `seedConceptIndex` | Concept index rows written straight to the store by the schema package's `conceptIndexRows`, one statement per table for each batch, in batches of one collection (or none, for a concept directly under `knowledge/`), one kind and a count, each titled by the batch's title or kind and its place, such as `Policy 007`. A batch may take a sensitivity and a `"groups"` audience naming existing groups. The rows have no file, no repository commit and no map, so they reach 3,000 concepts in seconds and serve Knowledge Base's counts and lists, and a spec never opens their concept page. It answers how many it seeded |
| `seedEditSuggestion` | One waiting `edit` suggestion a named member raises on a concept, by its IRI, through the concepts slice's own `submitSuggestionSet`. It proposes the concept's standing file, frontmatter included, against that file's content hash and merge key, with the title and the body replaced where given, so an owner accepts it unless the concept moves first. It answers the suggestion's id and its set's id. A concept the workspace does not hold answers 400 naming `iri` |
| `commitAuthorsOf` | The author lines, `Name <email>`, of the commits in the workspace's repository that touched a concept's file, by its IRI, newest first. A spec reads who an acceptance committed as with it. A concept the workspace does not hold answers 400 naming `iri` |
| `seedQuestions` | *Questions asked* records as `ask` and `give_feedback` leave them, listed oldest first and a second apart: a verdict, a judge state, the concepts it returned by IRI with each one's trust then and judge's word, the drafted sentences with the concepts each cites, and flags open or closed. A concept is named by IRI alone, so a refusal can hold concepts `ask` keeps on none today. An asker left out is one an erasure renamed, and a null question is content an erasure removed. It answers each record's id and its flags' ids |
| `scriptAsking` | A workspace's models set as the owner sets them, through the ops commands (its key, a price, its spending limit and its model choices), and a script for how the suite's model wire answers that workspace: the judge's fits or a failure, the drafter's sentences, each cited by the concept it names, or a failure, and a call held until released. A model the script leaves out is not chosen, so a script with neither asks no model. The workspace's key names it at the wire, so specs running side by side never share a script |
| `releaseTheModel` | Lets a held call go on: the judge's answer, or the draft after its first sentence. Every later call of that workspace's is answered at once |
| `modelCallsIn` | The judge's and the drafter's calls the wire has had for a workspace, a held one among them — how a spec shows a second press or a refocus asked nothing |

## What a refused seed leaves

A seed the harness cannot write answers 400. A body or a row that a schema refuses names each
field and its rule, and a write that trips a constraint names the constraint. The action's failure
carries that answer, so the reason is read there and not in the server's log. Any other fault of
the harness stays a 500.

A body is checked before anything is written. What a refusal after that leaves depends on who
writes the rows:

- **The harness writes them itself**, in one transaction, so a refused seed leaves nothing behind:
  `seedModelChoices`, `seedConnectedSources` and `seedQuestions`.
- **A slice's own action writes them**, and each action opens a transaction of its own on the api's
  connections, so a refusal part-way leaves what was written before it. `makeGroups` commits each
  group and each member as it goes. `seedConcepts` commits each concept as it goes: its connected
  sources, documents and passages, then a commit in the workspace's repository, then its rows.
  `scriptAsking` commits each ops command as it runs. `nameOwners` commits each owner as it goes,
  and a refused one answers 400 naming its place in `owners` and the refusal word.
  `seedConceptIndex` writes every batch in one transaction, so a refusal leaves none of them.

Among the body's rules for `seedConcepts`, a seed gives each title, whatever its case and spacing,
and each file to one concept, and a group names each member once. Two titles with one file name in
two collections land as two concepts. A seeded concept's merge key is the one core derives from its
kind and title.

`seedConcepts` cannot be one transaction, so it reads the workspace before its first write and
refuses there, with a 400 naming the field, what the body names that the store would refuse later: a
writer who is no member of the workspace or is no Admin, a title whose file the workspace already
holds, and, for a concept shared with a group, a group member who is no member of the workspace. An
Editor or a Viewer writes only a concept they own, and the seed names no owner. A seed refused there writes nothing and makes no
repository. Any other refusal at one concept leaves the concepts before it whole, in the repository,
the index and the map. It may leave that concept's own connected sources, documents and passages,
and the concept itself, written but not yet narrowed to its group, shared past its evidence or
verified.

## The browser helpers

More helpers drive the browser rather than the harness. Most are defined in `apps/web/e2e/locators.ts`, which `harness.ts` re-exports, so a spec imports them from either:

| Helper | What it does |
| --- | --- |
| `anAddress` | An email address nobody else in the run will use, so a code read back is this test's |
| `A_ROLE` | The article a role takes in a test's title, such as *an Editor*, for a test written once for each role |
| `signInHeading` | The sign-in page's heading, for what the sign-in carries on to: nothing, joining a workspace or connecting Claude |
| `signInByEmail` | Signs a person in **through the product's own page** — fill the address, send, read the six-digit code back from the captured transport, and fill it. Six digits submit on their own, so it clicks nothing, and it waits for the code field to be gone, because leaving the page sooner cancels the sign-in. An Admin or the operator is left on the confirm or setup page, which is where a spec about those pages starts |
| `signIn` | `signInByEmail`, then, once the first page draws, past the confirm or setup page an Admin or the operator meets: it gives the person the harness's authenticator through `withAnAuthenticator`, opens the confirm page afresh with the page's own query, and types the code — the gate passed through the real page, never around it. Anyone else is left where the sign-in sends them. Most specs sign in with this |
| `confirmedWhenAsked` | Waits for the confirm or setup page an action sent the person to, such as joining as an Admin, then passes it as `signIn` does |
| `aMemberSignedInAt` | A new workspace's Editor or Viewer, signed in having asked for a path first, so sign-in carries them back to it — where a refused page is proved |
| `landedAtHome` | Asserts the page is on a role's home: its address, read off the navigation list, and its heading. The heading is the page's group's name, or its area's where it has none |
| `notFoundOfferingHome` | Asserts the not-found page and its link to a role's home. A page hidden from the role shows it, as an address that never existed does |
| `signedInAtHome` | Opens the sign-in page, runs `signIn`, and waits for a role's home, an Admin's unless another is named, as a member of one workspace arrives |
| `signedInWithNoWorkspace` | A new person in no workspace, signed in through `signIn` and waiting on the no-workspace page, answered as the harness's `person` |
| `avatarOf` | The avatar's button in the band, found by the person's name though it shows their initials alone |
| `personMenuOpened` | Opens the avatar menu in the band by the person's name and answers it. The avatar shows initials alone, so the name and the role are one disclosure in |
| `signOutFromTheShell` | Opens the avatar menu through `personMenuOpened`, then signs out, because sign-out is one disclosure in |
| `switcherOf` | The workspace switcher in the band, named for where the person is: the workspace they are reading, or the console |
| `switcherMenuOf` | The switcher's open menu, named as its button is |
| `allWorkspacesPicked` | Opens the switcher and picks *All Workspaces*, its way to the picker |
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
| `theActionLandedWithinItsBudget` | Reads that clock, annotates the test with it and asserts it under the action's 100 ms. On CI it only annotates |
| `saysARefusal` | Asserts an alert holds words. A refusal's region can stand empty from the first draw, so being in the tree shows no refusal |
| `saysSomethingNew` | Asserts a status or an alert says something other than what it said before, which the spec read from it and hands over. Holding words would pass on what it already said |
| `countOf` | A list's count: the first status its region holds, which its head says |
| `saysOfItsRead` | Asserts a list's live region holds words, where a list says its read's state in a paragraph and no alert. No role names that region, so it is found by its `aria-live`, apart from the words the list's head always shows |
| `saysTheWait` | Asserts an alert names a ceiling's wait, given in seconds as the answer named it, as the page counts it: whole minutes, rounded up, matched by their number. A wait the answer did not name fails |
| `keepsItsWordOffThePage` | Asserts the api's word for a refusal is nowhere on the page: the word is for the logs and the wire |
| `keyShown` | An authenticator's key, read off the page as a person types it into their phone, without the spaces that group it in fours |
| `refusedDigitsSelected` | Asserts a refused code's six digits are selected, so the next code typed replaces them |
| `tokenColour` | A design-system token's colour as the browser paints it, so a computed style is compared with the token rather than a copied value |
| `contrastBetween` | WCAG's contrast ratio between two painted `rgb()` colours, as `apps/web/e2e/focus-ring.spec.ts` measures each focus edge against the surface behind it |
| `controlEdges` | Each enabled control found by its edge alone, with its fill, every side it draws and the colour behind it, each composited as painted through fills and every ancestor's opacity. A wordless wrapper with a side within 8px of the control's own lends its fill, and its border on each such side. One with no such side lends nothing, and its own fill is the colour behind the control. The gate measures them with `contrastBetween` |
| `switched` | Opens the switcher named for where the person is and picks the radio item holding another workspace's name. It waits for nothing after the pick, so the spec asserts where the person landed |
| `inTwoWorkspaces` | A new person who is the Admin of one new workspace and holds a role in a second, Admin unless Viewer is named. It signs them in through `signIn`, picks the first workspace, waits for the Admin's home and the switcher named for it, and answers the address and both workspaces. A spec about moving between workspaces starts from it |
| `reconfirmedOn` | Waits for the *Confirm It’s You* dialog, gives the person the harness's authenticator through `withAnAuthenticator`, types its code, and waits for the dialog to go. A spec runs it after `ageTheConfirmation` has made an act ask again |
| `authenticatorCodeField` | The *Authenticator Code* field, by its exact label. `signIn` fills it on the confirm page, and `reconfirmedOn` fills it in the *Confirm It’s You* dialog |
| `holdingTheFirstAnswer` | Fetches every answer a matcher picks, holds the first until the spec releases it, and counts every ask. It answers `reached`, `release` and `asked`. A spec presses a second time while the first answer is held and expects `asked` to be 1, as `apps/web/e2e/sessions.spec.ts` does |
| `requestsSent` | Collects every request the page sends from then on whose address a matcher picks, in the order sent. A spec reads its length, or maps it to addresses, to show what the page asked and what it never asked, as `apps/web/e2e/jump-to.spec.ts` does |
| `answersRead` | Collects the body of every answer a matcher picks, each read as it lands, because the page's next navigation discards it. A spec awaits them all before it reads them, as `apps/web/e2e/concept-body-links.spec.ts` does |
| `memberUnreadUntil` | Drops the shell's member read, fails the member read in the frame's batch, and holds the lone retry until the promise it is given settles. The page then draws with the member unread. A spec sets it up, reloads, and acts before it lets the read land, as `apps/web/e2e/member-unread.spec.ts` and `apps/web/e2e/people.spec.ts` do |
| `askShowsTheServedAddress` | Reads the MCP surface's address from `/.well-known/oauth-protected-resource/mcp` and asserts the page's main region shows it exactly. It answers that address and fails when the document does not answer. A spec compares the page with what the api serves, not with a copied value. `apps/web/e2e/home.spec.ts` is the worked example |
| `ACTION_SAMPLES` | How many times a spec clocks one action before it judges it, five. A spec seeds `ACTION_SAMPLES - 1` extra rows, so each sample has a row to act on |
| `actionClocked` | Waits for the clock `clockTheNextKey` started and answers it in milliseconds. It fails when no clock was started, and fails by name when the node had not read its text 2 s after the key while a request was held. A spec collects one per sample for `theActionsLandedWithinTheirBudget` |
| `theActionsLandedWithinTheirBudget` | Annotates the test with every sample of an action and their median, and asserts the median under the action's 100 ms, which on CI it only annotates. It fails by name when the action was never clocked. `theActionLandedWithinItsBudget` is the same check over one sample |
| `tokenPainted` | A design-system token's value for a named CSS property as the browser paints it. It is read off a probe element styled with the token. `tokenColour` is this for `color`. `apps/web/e2e/focus-ring.spec.ts` reads `--focus-ring` as `box-shadow` with it |
| `drawnMarks` | The visible elements holding `data-marks` whose `::before` draws, each named by its `data-slot` or its tag. `apps/web/e2e/sign-in.spec.ts` asserts the card alone draws them, and that the primary button inside it holds `data-marks` and draws none |

The sign-in code is read from that capture, with `codeSentTo`, and from nowhere else: the api's
logger is forbidden from ever holding one. `emailsSentTo` counts the emails the capture holds for an address, and the suite's
api delivers nothing to `@unreachable.example`, so a spec can meet an invitation whose email did
not go.

## Claude's part in OAuth

Six more play Claude's part in its OAuth flow on the suite's own origin — `apps/web/e2e/consent.spec.ts` for the consent page, `apps/web/e2e/console-people.spec.ts` for a person who has given an assistant access:

| Helper | What it does |
| --- | --- |
| `aPkcePair` | A verifier and its challenge, as Claude mints one for each connection |
| `claudesAuthorizeUrl` | Claude's authorize request for the MCP surface at an origin, with an optional challenge, `prompt` and `state` |
| `catchClaudesRedirect` | Answers the redirect to claude.ai with a stand-in page, since the suite cannot reach it |
| `claudeExchanges` | Exchanges the code at the redirect for tokens, which is when the grant's refresh token is minted, and answers that refresh token |
| `claudeDisconnects` | Revokes that refresh token at `/oauth2/revoke`, as Claude does when the person disconnects it, so the authorization server ends the grant itself |
| `CLAUDES_REDIRECT_URI` | The redirect address the suite's Claude names in its authorize request and its token exchanges, `https://claude.ai/api/mcp/auth_callback`. A spec compares where *Connect* or *Cancel* landed with it. `catchClaudesRedirect` routes it, and `apps/web/e2e/console-people.spec.ts` unroutes it |

## Reading the api's answers

Three helpers answer for the api. `refusedFromNowOn` in `apps/web/e2e/refused-read.ts` refuses one
console procedure inside a tRPC batch, in the api's own words for a person without the operator's
mark, and leaves the batch's other answers real. A spec uses it to meet a list's refused re-read
while the console stays open, since clearing the mark itself closes the whole console.
`apps/web/e2e/console.spec.ts` and `apps/web/e2e/console-people.spec.ts` are the worked examples.

`theNextAskMeetsACeiling` in the same module answers the next ask of one path outside tRPC with the
api's own 429 and the wait it is handed, then lets that path through again. `aCeilingMet` is that
answer alone, for a spec that refuses every ask and counts them.
`apps/web/e2e/sign-out.spec.ts` uses both. `apps/web/e2e/accept-invitation.spec.ts` and
`apps/web/e2e/sign-in-link.spec.ts` use the first.

Two more in that module read what the api answered. `refusalAnswering` waits for the next answer to
one tRPC procedure, found by its place in a batch or in a call sent alone. It answers the refusal's
word and class, and each item's word where a set was refused whole. A ceiling carries no word, so
for one it answers the 429 status and the wait in seconds. `authAnswering` waits for the next answer
on a path outside tRPC and answers its status, a ceiling's wait, and the refusal as that path names
it: Better Auth's code, or the word one of the api's own routes sends. The first matching answer settles either, so a read the page asks again
is not waited for. Either throws when that answer is no refusal, so a spec that only awaits one has
still shown the api refused.

## The knowledge module

`apps/web/e2e/knowledge.ts` holds what the knowledge pages' specs share. `readsCeilingFilled`
fills the knowledge reads' ceiling, above.

| Helper | What it does |
| --- | --- |
| `isAFind` | Matches a request whose path names `knowledge.find` anywhere, because the tRPC client batches its reads. A spec hands it to `heldBack`, `page.route` or a request wait to catch a search's read |
| `isAnOpen` | Matches a request whose path names `knowledge.open` anywhere, as `isAFind` does for a find. `apps/web/e2e/concept-body-links.spec.ts` collects a concept page's opens with it |
| `heldBack` | Holds every request a matcher picks until the spec releases it. It answers `reached`, which settles when the first arrives, and `release`. A spec reads the page while a read is still out with it. `apps/web/e2e/knowledge-search.spec.ts` uses it during a search and `apps/web/e2e/sources.spec.ts` during the sources list |
| `windowRefocused` | Dispatches `visibilitychange` on the window and waits two tasks, one for the query client to resume and one for the api client's batch timer. Then it fetches `/health`. A spec follows it by counting what was sent, to show a refocus asked nothing again |
| `scrolledSideways` | How far the page scrolls sideways in pixels, the document's scroll width less its client width. A spec at a narrow width asserts it is 0 |
| `listsItsKeystrokes` | Opens the page's list of keystrokes through `keystrokesListed`. It asserts each given key is among the list's terms and each named action is in it, then dismisses the list through `keystrokesDismissed`. A page's keystroke spec runs it with the page's own keys |
| `conceptsSeeded` | Runs `seedConcepts` and answers a map from each concept's title to what the harness answered for it, its IRI, path and cited documents. `apps/web/e2e/concept-page.spec.ts` and `apps/web/e2e/concept-body-links.spec.ts` look concepts up in it by title |
| `knowledgeMenuOpened` | Opens Knowledge from the rail and answers its menu once it shows. `apps/web/e2e/collections-and-owners.spec.ts` and `apps/web/e2e/knowledge-base.spec.ts` read which pages a role sees there |
