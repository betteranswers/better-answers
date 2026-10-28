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
| `ageTheConfirmation` | Moves the second-factor confirmation of every session a person holds to 61 minutes ago, behind the api's back. A high-impact act then answers `confirmation-too-old` and asks again in the *Confirm It’s You* dialog. It is how a spec meets a stale confirmation without waiting an hour. `apps/web/e2e/auth/reconfirm.spec.ts` is the worked example |
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
