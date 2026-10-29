# Console

The platform operator's view across every workspace: find a workspace or a person, correct a flagged display name.

`<stamp>` is `date +%s`, taken once for this file.

Setup, once:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Operators <stamp>"}'` answers `workspaceId`, `admin.id` and `admin.email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /operators '{"email":"<admin.email>","change":"grant"}'` answers `{"marked":true}`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Priya Shah <stamp>"}'` answers her `id` and `email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<priya id>","role":"Editor"}'`, then `.claude/skills/verify/scripts/harness.sh <port> POST /name-flags '{"workspaceId":"<workspaceId>","adminId":"<admin.id>","personId":"<priya id>"}'` answers `{"flagged":true}`.
3. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email> /console` lands on `/console/workspaces/every-workspace`.

## console-every-workspace at `/console/workspaces/every-workspace`

1. `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Operators <stamp>" --name "Search by name or short name"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 workspace matches"`. Expect one row, `Operators <stamp>`, with `2 members`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "More About Operators <stamp>"`. Expect `Workspace ID` with the `workspaceId` from setup.

## console-everyone at `/console/people/everyone`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Priya Shah <stamp>" --name "Search by name or address"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 person matches"`. Expect one row reading `Priya Shah <stamp>`, her address and `Operators <stamp> Editor`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Priya Shah <stamp>" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "No open sessions"`. Expect the dialog `Priya Shah <stamp>` to hold `Workspaces` with `Operators <stamp>` and `Editor`. Close it with `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Close" --exact`.

## console-names-waiting at `/console/people/names-waiting`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Names Waiting"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/names-waiting'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Review display names flagged by Admins."`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<stamp>" --name "Search by name or workspace"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 name matches"`. Expect one row, `Priya Shah <stamp>`, flagged by `Operators <stamp>`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Correct Priya Shah <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find label "Display Name" fill "Priya Okoro <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Save Changes"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "changed to Priya Okoro <stamp>"`. Expect the status `The display name Priya Shah <stamp> has been changed to Priya Okoro <stamp> successfully.` and the row gone from the list.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<priya email>" --name "Search by name or address"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 person matches"`. Expect her row to read `Priya Okoro <stamp>`.

## console-home at `/console`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/console`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/workspaces/every-workspace'"`. Expect `Every Workspace`.
