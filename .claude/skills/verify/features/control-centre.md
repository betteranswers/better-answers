# Control Centre

An Admin runs the workspace: members, invitations, groups, audit log, connected sources, questions asked, and sees its model choices.

`<stamp>` is `date +%s`, taken once for this file. Setup runs once in a fresh workspace, then any recipe in any order.

Setup:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Control Centre"}'` answers `workspaceId`, `admin.id` and `admin.email`. The Admin's display name is *Test person*.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"email":"priya-cc-<stamp>@example.test","displayName":"Priya Shah"}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"email":"sam-cc-<stamp>@example.test","displayName":"Sam Okoro"}'` answer `id`, which the recipe calls `<priyaId>` and `<samId>`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<priyaId>","role":"Editor"}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<samId>","role":"Viewer"}'`. Each answers `{"added":true}`.
3. `.claude/skills/verify/scripts/harness.sh <port> POST /groups '{"workspaceId":"<workspaceId>","userId":"<admin.id>","names":["HR team"],"memberIds":["<priyaId>"]}'` answers `{"made":1}`.
4. `.claude/skills/verify/scripts/harness.sh <port> POST /connected-sources '{"workspaceId":"<workspaceId>","connectedSources":[{"name":"Staff handbook","sensitivity":"Internal","sync":"done","documents":[{"title":"handbook.md"}]}]}'`
5. `.claude/skills/verify/scripts/harness.sh <port> POST /model-choices '{"workspaceId":"<workspaceId>","modelChoices":[{"purpose":"answering","provider":"anthropic","model":"claude-sonnet-5"},{"purpose":"embedding","provider":"mistral","model":"mistral-embed"}]}'` answers `{"seeded":2}`.
6. `.claude/skills/verify/scripts/harness.sh <port> POST /questions '{"workspaceId":"<workspaceId>","records":[{"question":"How long do you keep audit logs?","verdict":"ok","flags":[{"reason":"wrong","note":"We keep them for seven years."}]},{"question":"Who can see the audit log?","verdict":"related"}]}'`
7. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email>` lands on `/people/members`.

## cc-members at `/people/members`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Sam Okoro"`. Expect the table to list *Priya Shah* in *HR team*, *Sam Okoro* and *Test person*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "invite"`, `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "invitee-cc-<stamp>@example.test" --name "email"`, `.claude/skills/verify/scripts/browse.sh <port> find role combobox click --name "role"`, `.claude/skills/verify/scripts/browse.sh <port> find role option click --name "Editor"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "send"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/invited/i.test(document.body.innerText)"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "done"`.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> find role tab click --name "invitations"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "invitee-cc-<stamp>@example.test"`. Expect one row for the invited address, with the role *Editor* and *Test person* as the person who invited them.

## cc-member-page from `/people/members`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Sam Okoro"`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Priya Shah"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/people/members/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "HR team"`. Expect the radio group for her role to have *Editor* checked, and the checklist of her groups to have *HR team* ticked.
2. `.claude/skills/verify/scripts/browse.sh <port> find role radio click --name "Viewer" --exact`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "change"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/changed/i.test(document.body.innerText)"`. Expect a status message that names *Viewer*.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "HR team"`. Expect the radio group for her role to have *Viewer* checked. Then `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "People" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Sam Okoro"`. Expect Priya Shah's row to read *Viewer*.

## cc-groups at `/people/groups`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/groups`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "HR team"`. Expect *HR team* with *1 member*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "create"`, `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "Site leads" --name "name"`, `.claude/skills/verify/scripts/browse.sh <port> press Enter`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Site leads"`. Expect the count *2 groups*.
3. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Site leads" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Sam Okoro"`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "Sam Okoro"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/added/i.test(document.body.innerText)"`. Expect a status message that names *Sam Okoro* and *Site leads*.
4. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Site leads"`. Expect the *Site leads* row to read *1 member*.

## cc-audit-log at `/system/audit-log`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/system/audit-log`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "HR team"`. Expect, among the events, *Test person* creating the group *HR team* and adding *Priya Shah* to it.
2. `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "HR team" --name "search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/\b2 events\b/i.test(document.body.innerText)"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.search === '?audit.search=HR+team'"`. Expect only the two *HR team* events.
3. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "group created"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "<admin.email>"`. Expect the event to open beneath its line, naming *Test person* and the Admin's address as the person who did it.

## cc-connected-sources at `/sources/connected-sources`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/sources/connected-sources`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Staff handbook"`. Expect *1 connected source*, the *Staff handbook* entry showing the sensitivity *Internal* and the state *Indexed*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Publish Staff handbook"` opens a dialog to publish *Staff handbook*, with its button to publish disabled. Then `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "lawful basis"`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "privacy information"`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "DPIA"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Publish" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Published"`.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Published"`. Expect the entry's state to read *Published* and the entry to offer no button to publish.

## cc-models-and-spend at `/models/models-and-spend`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/models/models-and-spend`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "claude-sonnet-5"`. Expect *Answering* to read *Anthropic* and *claude-sonnet-5*, *Embedding* to read *Mistral AI* and *mistral-embed*, and *Extraction*, *Enrichment* and *Judging* to name no model.
2. `.claude/skills/verify/scripts/browse.sh <port> find role tab click --name "spend"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/coming soon/i.test(document.body.innerText)"`. Expect a line that says the page is not built yet.

## cc-questions-asked at `/questions/questions-asked`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/questions/questions-asked`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "How long do you keep audit logs?"`. Expect the flagged questions to hold *How long do you keep audit logs?* and the other questions to hold *Who can see the audit log?*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "How long do you keep audit logs?"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "We keep them for seven years."`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "fixed"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/closed/i.test(document.body.innerText)"`. Expect the flag to read as closed, fixed in the knowledge.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Who can see the audit log?"`. Expect no flagged questions, and both questions among the other questions.

## cc-answer-tests at `/questions/answer-tests`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/questions/answer-tests`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/no answer tests/i.test(document.body.innerText)"`. Expect the empty list of answer tests.

## cc-not-built

1. For each of `/overview`, `/suggestions/to-decide`, `/sources/publishing-rules`, `/sources/cost-estimates`, `/sources/backlogs`, `/sources/removed-at-source`, `/sources/share-agents`, `/models/spending-limit`, `/people/personal-tokens`, `/personal-data/erasure-and-suppression`, `/system/signals`, `/system/health` and `/system/backups`, run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port><address>` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/not found/i.test(document.body.innerText)"`. Expect a heading that says the page is not found, over a link to the members page.
2. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "go to"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`.
