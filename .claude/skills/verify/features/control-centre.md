# Control Centre

An Admin runs the workspace: members, invitations, groups, audit log, connected sources, model choices, questions asked.

`<stamp>` is `date +%s`, taken once for this file. Setup runs once in a fresh workspace, then any recipe in any order.

Setup:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Control Centre"}'` answers `workspaceId`, `admin.id` and `admin.email`. The Admin's display name is *Test person*.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"email":"priya-cc-<stamp>@example.test","displayName":"Priya Shah"}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"email":"sam-cc-<stamp>@example.test","displayName":"Sam Okoro"}'` answer `<priyaId>` and `<samId>`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<priyaId>","role":"Editor"}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<samId>","role":"Viewer"}'`. Each answers `{"added":true}`.
3. `.claude/skills/verify/scripts/harness.sh <port> POST /groups '{"workspaceId":"<workspaceId>","userId":"<admin.id>","names":["HR team"],"memberIds":["<priyaId>"]}'` answers `{"made":1}`.
4. `.claude/skills/verify/scripts/harness.sh <port> POST /connected-sources '{"workspaceId":"<workspaceId>","connectedSources":[{"name":"Staff handbook","sensitivity":"Internal","sync":"done","documents":[{"title":"handbook.md"}]}]}'`
5. `.claude/skills/verify/scripts/harness.sh <port> POST /model-choices '{"workspaceId":"<workspaceId>","modelChoices":[{"purpose":"answering","provider":"anthropic","model":"claude-sonnet-5"},{"purpose":"embedding","provider":"mistral","model":"mistral-embed"}]}'` answers `{"seeded":2}`.
6. `.claude/skills/verify/scripts/harness.sh <port> POST /questions '{"workspaceId":"<workspaceId>","records":[{"question":"How long do you keep audit logs?","verdict":"ok","flags":[{"reason":"wrong","note":"We keep them for seven years."}]},{"question":"Who can see the audit log?","verdict":"related"}]}'`
7. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email>` lands on `/people/members`.

## cc-members at `/people/members`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "3 members"`. Expect the table to list *Priya Shah* in *HR team*, *Sam Okoro* and *Test person*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Invite a Person"`, `.claude/skills/verify/scripts/browse.sh <port> find label "Email Addresses" fill "invitee-cc-<stamp>@example.test"`, `.claude/skills/verify/scripts/browse.sh <port> find role combobox click --name "Role"`, `.claude/skills/verify/scripts/browse.sh <port> find role option click --name "Editor"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Send Invitation"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "has been invited as an Editor"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Done"`.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> find role tab click --name "Invitations"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 waiting invitation"`. Expect one row for the invited address, with the role *Editor* and *Test person* under *Invited By*.

## cc-member-page at `/people/members/<priyaId>`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "3 members"`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Priya Shah"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/people/members/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Priya Shah is an Editor"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Changes are saved immediately."`. Expect the *Role* radio group to have *Editor* checked and *Groups for Priya Shah* to have *HR team* ticked.
2. `.claude/skills/verify/scripts/browse.sh <port> find role radio click --name "Viewer" --exact`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Change Role"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "role has been changed to Viewer"`.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Priya Shah is a Viewer"`. Then `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "People" --exact` (the breadcrumb, the only link of that name), `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "3 members"`. Expect Priya Shah's row to read *Viewer*.

## cc-groups at `/people/groups`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/groups`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "HR team"`. Expect *HR team* with *1 member*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Create a Group"`, `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "Site leads" --name "New Group Name"`, `.claude/skills/verify/scripts/browse.sh <port> press Enter`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Site leads has been created"`. Expect the count *2 groups*.
3. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Site leads" --exact`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "Sam Okoro"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Sam Okoro has been added to Site leads"`.
4. Second view: `.claude/skills/verify/scripts/browse.sh <port> press Escape`, `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Site leads"`. Expect the *Site leads* row to read *1 member*.

## cc-audit-log at `/system/audit-log`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/system/audit-log`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "The platform provisioned the workspace"`. Expect *Test person created the group HR team* and *Test person added Priya Shah to the group HR team* among the events.
2. `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "HR team" --name "Search by person, group or action"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 events matching"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.search === '?audit.search=HR+team'"`. Expect only the two *HR team* events.
3. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Details of Group created"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "<admin.email>"`. Expect the event to open beneath its line, naming *Test person* and the Admin's address under *By*.

## cc-connected-sources at `/sources/connected-sources`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/sources/connected-sources`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Staff handbook"`. Expect *1 connected source*, the *Staff handbook* entry listing *Internal* and *Indexed*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Publish Staff handbook" --exact` opens the dialog *Publish Staff handbook* with *Publish* disabled. Then `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "Lawful basis recorded"`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "Privacy information updated"`, `.claude/skills/verify/scripts/browse.sh <port> find role checkbox click --name "DPIA reference recorded"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Publish" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "has been published"`.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Published"`. Expect the entry's *State* to read *Published* and to offer no *Publish* button.

## cc-models-and-spend at `/models/models-and-spend`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/models/models-and-spend`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "claude-sonnet-5"`. Expect *Answering* to read *Anthropic* and *claude-sonnet-5*, *Embedding* to read *Mistral AI* and *mistral-embed*, and *Extraction*, *Enrichment* and *Judging* to read *Not set*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role tab click --name "Spend"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Spend is coming soon"`.

## cc-questions-asked at `/questions/questions-asked`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/questions/questions-asked`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "How long do you keep audit logs?"`. Expect the region *Flagged* to hold *How long do you keep audit logs?* and *Other Questions* to hold *Who can see the audit log?*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "How long do you keep audit logs?"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "We keep them for seven years."`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Fixed in the Knowledge"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "closed as fixed in the knowledge"`. Expect the flag to read *Closed* with *Fixed in the knowledge*.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> press Escape`, `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Other Questions"`. Expect no *Flagged* region and *Other Questions* holding both questions.

## cc-answer-tests at `/questions/answer-tests`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/questions/answer-tests`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "No answer tests yet"`.

## cc-not-built

Pages not built draw the not-found page. A not-found page proves only that the address is not served yet, never a broken page.

1. For each of `/overview`, `/suggestions/to-decide`, `/sources/publishing-rules`, `/sources/cost-estimates`, `/sources/backlogs`, `/sources/removed-at-source`, `/sources/share-agents`, `/models/spending-limit`, `/people/personal-tokens`, `/personal-data/erasure-and-suppression`, `/system/signals`, `/system/health` and `/system/backups`, run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port><address>` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Page Not Found"`. Expect the heading *Page Not Found* over the link *Go to Members*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Go to Members"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`.
