# The harness

The api harness's actions, the ceilings a spec or a drive runs into, and what a refused seed leaves. `SKILL.md` gives the rules for using them. The helpers in the suite's modules are in `apps/web/.claude/skills/playwright-specs/references/helpers.md`.

## The ceilings a spec runs into

- **Per email.** `EMAIL_CODE_EMAIL_RULE` in `apps/api/src/auth/constants.ts` — five in ten
  minutes, applied by `limitCodesByEmail` in `apps/api/src/auth/routes.ts` as Hono middleware on
  `SEND_EMAIL_CODE_PATH`, ahead of that path's count by client address. It keys on a hash of the
  address in the body, so which client asked makes no difference.
- **Per client address.** `limitByIp` in `apps/api/src/ingress/limits.ts` reads `CLIENT_IP_HEADER`
  and counts each route group apart. `AddressScope` there names the groups, and each group's rule
  is in `apps/api/src/auth/constants.ts`. A code's send and a sign-in by code count over ten
  minutes, and the rest over one. Better Auth's own limiter is off, so the api's counts are the
  only ones.
- **Per person.** `personCeiling` in `apps/api/src/trpc/base.ts` counts a signed-in person's calls
  to one procedure against a rule from the same constants file, `ASK_TO_JOIN_PERSON_RULE` for
  asking to join. Past it the call answers 429 with `Retry-After` and no refusal word. It keys on
  the session's person, so a flood through the page's own `page.request` reaches it. Every knowledge
  read and asking a question share one count a person (`KNOWLEDGE_CEILING`, used in
  `apps/api/src/trpc/knowledge.ts` and `ask.ts`), which `readsCeilingFilled` in
  `apps/web/e2e/knowledge.ts` fills. The count resets at each minute of the clock, so the helper
  waits for a fresh minute when too few seconds of the current one are left for the fill and the
  refusal after it.

Read the numbers off those files rather than from here.

## The harness's actions

Each action below is a function in `apps/web/e2e/harness.ts` that calls `/__harness`. An area's own actions live
beside `apps/api/tests/support/harness/harness-control.ts`: Sources in `apps/api/tests/support/harness/harness-sources.ts`, People in
`apps/api/tests/support/harness/harness-people.ts`, Knowledge in `apps/api/tests/support/harness/harness-knowledge.ts`, Questions in
`apps/api/tests/support/harness/harness-questions.ts` and asking in `apps/api/tests/support/harness/harness-asking.ts`:

| Action | What it does |
| --- | --- |
| `provision` | A workspace with its first Admin. It answers the workspace's id, name and short name, and the Admin |
| `person` | A person in no workspace |
| `addMember` | A member at a named role: Admin, Editor or Viewer |
| `removeMember` | Removes a member |
| `endEverySignInAndToken` | Ends every sign-in and token a person holds |
| `markTheOperator` | Grants the operator mark to the person holding an address, or clears it with `"revoke"` |
| `invite` | A waiting invitation to an address at a named role, or one accepted or cancelled, or with its expiry moved into the past |
| `ageTheConfirmation` | Moves the second-factor confirmation of every session a person holds to 61 minutes ago |
| `ageThePendingHour` | Moves the pending clock of every session a person holds to 61 minutes ago |
| `ageTheCode` | Moves the expiry of the code sent to an address into the past |
| `withAnAuthenticator` | Gives an address an authenticator and answers the key `authenticatorCodeAt` makes codes from. A second ask answers the same key. It also issues ten recovery codes, marked saved, unless the person already holds a set. `enrolledWith` answers those codes too, or issues none with `"none"` |
| `restored` | The platform operator's restore of a person's sign-in. It answers the restore code |
| `seedModelChoices` | The model choices a workspace has made. A purpose left out of the list has no model choice |
| `seedConnectedSources` | Connected sources with documents, passages, findings, a sync status and a concept citing a document. It answers each connected source's and document's id |
| `moveTheSync` | Moves the workspace's one sync to `claimed` or to `done`, as `to` names, with no worker process. `done` needs a claimed sync |
| `makeGroups` | Groups made by a named member, every group holding the members `memberIds` names |
| `askToJoin` | A person's ask to join a workspace by its short name, with a reason, waiting on the Requests tab |
| `flagTheName` | A workspace's Admin flags a member's display name, which then waits on the console's *Names waiting* page |
| `seedConcepts` | Concepts a named Admin writes in order. Each takes a kind, a sensitivity, further frontmatter keys, links to concepts earlier in the list and sources. A trust tier other than `unverified` is written as a verification row. It answers each concept's IRI, path and cited documents |
| `nameOwners` | Owners a named Admin names in order: a collection's owner by its name, or a concept's own owner by its IRI. It answers how many it named |
| `seedConceptIndex` | Concept index rows written straight to the store, in batches of one collection (or none), one kind and a count. The rows have no file, no git commit and no map, so no concept page opens for them. It answers how many it seeded |
| `seedEditSuggestion` | One waiting `edit` suggestion a named member raises on a concept, by its IRI, with the title and the body replaced where given. It answers the suggestion's id and its set's id. A concept the workspace does not hold answers 400 naming `iri`, and a suggestion the slice refuses answers 400 naming `userId` |
| `commitAuthorsOf` | The author lines, `Name <email>`, of the commits in the workspace's repository that touched a concept's file, by its IRI, newest first. A concept the workspace does not hold answers 400 naming `iri` |
| `seedQuestions` | *Questions asked* records, listed oldest first and a second apart: a verdict, a judge state, the concepts it returned by IRI, the drafted sentences with the concepts each cites, and flags open or closed. It answers each record's id and its flags' ids |
| `scriptAsking` | A workspace's models set as the owner sets them, through the ops commands (its key, a price, its spending limit and its model choices), and a script for how the suite's model wire answers that workspace: the judge's fits or a failure, the drafter's sentences, each citing a concept by title, or a failure, and a call held until released. A model the script leaves out is not chosen |
| `codeSentTo` | The sign-in code captured for an address |
| `linkSentTo` | The sign-in link's token captured for an address |
| `emailsSentTo` | How many emails the transport captured for an address |
| `aSessionOn` | A session for a person, with an optional user agent |
| `releaseTheModel` | Lets a held call go on. Every later call of that workspace's is answered at once |
| `modelCallsIn` | The judge's and the drafter's calls the wire has had for a workspace |

## What a refused seed leaves

A seed the harness cannot write answers 400. A body or a row that a schema refuses names each
field and its rule, and a write that trips a constraint names the constraint. The action's failure
carries that answer. Any other fault of the harness stays a 500, with its reason in the server's log.

A body is checked before anything is written. What a refusal after that leaves depends on who
writes the rows:

- **The harness writes them itself**, in one transaction, so a refused seed leaves nothing behind:
  `seedModelChoices`, `seedConnectedSources`, `seedQuestions`, `seedConceptIndex` and `moveTheSync`, whose refusals answer 500.
- **A slice's own action, an ops command or the harness one transaction at a time writes them**, so a
  refusal part-way leaves what was written before it: `makeGroups`, `seedConcepts`,
  `scriptAsking` and `nameOwners`. Such a refusal answers 500 and its reason is in `server.log`, except
  `nameOwners`, which answers 400 naming its place in `owners`, and the checks `seedConcepts` makes before its
  first write. Those answer 400 naming the field: a writer who is no member or no Admin, a title whose
  file the workspace already holds, and a group member who is no member of the workspace. Any other
  refusal at one concept leaves the concepts before it whole, and the refused concept's file may already be committed. `scriptAsking` sets its model script before
  any ops command runs, so the script stays set after a failure.
