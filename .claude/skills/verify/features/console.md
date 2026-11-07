# Console

The platform operator's view across every workspace: find a workspace or a person, correct a flagged display name.

`<stamp>` is `date +%s`, taken once for this file.

Setup, once:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Operators <stamp>"}'` answers `workspaceId`, `admin.id` and `admin.email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /operators '{"email":"<admin.email>","change":"grant"}'` answers `{"marked":true}`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Priya Shah <stamp>"}'` answers her `id` and `email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<priya id>","role":"Editor"}'`, then `.claude/skills/verify/scripts/harness.sh <port> POST /name-flags '{"workspaceId":"<workspaceId>","adminId":"<admin.id>","personId":"<priya id>"}'` answers `{"flagged":true}`.
3. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email> /console` lands on `/console/workspaces/every-workspace`.

## console-every-workspace at `/console/workspaces/every-workspace`

1. `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Operators <stamp>" --name "search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/\b1 workspace\b/i.test(document.body.innerText)"`. Expect one row, `Operators <stamp>`, with `2 members`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Operators <stamp>"`. Expect the row's details to show the `workspaceId` from setup.

## console-everyone at `/console/people/everyone`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Priya Shah <stamp>" --name "search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/\b1 person\b/i.test(document.body.innerText)"`. Expect one row reading `Priya Shah <stamp>`, her address and `Operators <stamp> Editor`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Priya Shah <stamp>" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "document.querySelector('[role=dialog]')?.innerText.includes('Operators <stamp>') === true"`. Expect the dialog for `Priya Shah <stamp>` to list `Operators <stamp>` with the role `Editor`. Close it with `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Close" --exact`.

## console-names-waiting at `/console/people/names-waiting`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "names"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/names-waiting'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "document.querySelector('input[type=search]') !== null"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<stamp>" --name "search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/\b1 name\b/i.test(document.body.innerText)"`. Expect one row, `Priya Shah <stamp>`, flagged by `Operators <stamp>`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Correct Priya Shah <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "Priya Okoro <stamp>" --name "name"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "save"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Priya Okoro <stamp>"`. Expect a status message that names `Priya Shah <stamp>` and `Priya Okoro <stamp>`, and the row gone from the list.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<priya email>" --name "search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/\b1 person\b/i.test(document.body.innerText)"`. Expect her row to read `Priya Okoro <stamp>`.

## console-home at `/console`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/console`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/workspaces/every-workspace'"`. Expect the list of every workspace on the platform.
