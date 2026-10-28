# Console

The Console is the platform operator's view across every workspace. The operator finds any person and what they hold, corrects a display name an Admin flagged, and lists every workspace with its short name and id. Only a person holding the operator mark sees it.

## Sub-features

- `console-everyone` lists every person on the platform at `/console/people/everyone`, searches them, and opens one person's sheet.
- `console-names-waiting` lists the display names Admins flagged at `/console/people/names-waiting` and corrects one.
- `console-every-workspace` lists every workspace at `/console/workspaces/every-workspace`, searches them, and shows one workspace's id.
- `console-home` sends `/console` to `/console/workspaces/every-workspace`, the operator's home.

## How to get to it (user POV)

- The operator lands on `/console/workspaces/every-workspace` after signing in at `/console`.
- Choose the `Console` link in the rail, the `navigation` named `Areas`.
- Choose `Everyone`, `Names Waiting` or `Every Workspace` in the `navigation` named `Console`.
- Choose `Go to Everyone` on an empty `Names Waiting` list.
- Open any of the addresses above with `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port><path>`.

## Driving it with agent-browser

Preconditions:

- The instance was started by `launch.sh <port>` and `doctor.sh <port>` printed `worth driving`. Put its port where a command says `<port>`, and run every command from the repository root.
- `<stamp>` is the output of `date +%s`, taken once for this recipe, so this run's names differ from every earlier run's.
- Take each id and address from the answer of the command that made it. The harness mints each person's address.

- **Make the operator.** The operator is a person granted the mark. Run `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Operators <stamp>"}'`. Note `workspaceId`, `admin.id` and `admin.email`. Then run `.claude/skills/verify/scripts/harness.sh <port> POST /operators '{"email":"<admin.email>","change":"grant"}'`. It answers `{"marked":true}`.
- **Add a member with a flagged name.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Priya Shah <stamp>"}'`, which answers her `id` and `email`, and `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<priya id>","role":"Editor"}'`. Then the workspace's Admin flags her name. Run `.claude/skills/verify/scripts/harness.sh <port> POST /name-flags '{"workspaceId":"<workspaceId>","adminId":"<admin.id>","personId":"<priya id>"}'`. It answers `{"flagged":true}`.
- **Sign in.** Run `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email> /console`. It prints that the page is at `/console/workspaces/every-workspace`. The rail holds one link, `Console`.
- **Every Workspace.** Run `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Operators <stamp>" --name "Search by name or short name"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 workspace matches"`. The table `Every workspace on the platform.` holds one row, `Operators <stamp>`, with its short name and `2 members`.
- **A workspace's id.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "More About Operators <stamp>"`. The row opens to show `Workspace ID` with the id `POST /workspaces` answered. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/console-every-workspace.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot -c > /tmp/better-answers-verify/<port>/evidence/console-every-workspace.aria.txt`.
- **Everyone.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "Priya Shah <stamp>" --name "Search by name or address"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 person matches"`. The table `Every person on the platform.` holds one row. Its cells read `Priya Shah <stamp>` with her address, `Operators <stamp> Editor` and `None on record`.
- **A person's sheet.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Priya Shah <stamp>" --exact` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "No open sessions"`. The dialog `Priya Shah <stamp>` holds the regions `Workspaces` with `Operators <stamp>` and `Editor`, `Sign-In`, `Sessions` saying `No open sessions`, `Assistant Access` saying no assistants are connected, `Display Name` and `End Every Sign-In Everywhere`. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/console-everyone.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot -c > /tmp/better-answers-verify/<port>/evidence/console-everyone.aria.txt`, then `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Close" --exact`.
- **Names Waiting.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Names Waiting"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/names-waiting'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Priya Shah <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<stamp>" --name "Search by name or workspace"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 name matches"`. The table `Display names waiting to be corrected.` holds one row, `Priya Shah <stamp>`, flagged by `Operators <stamp>`.
- **Correct the name.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Correct Priya Shah <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find label "Display Name" fill "Priya Okoro <stamp>"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Save Changes"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "changed to Priya Okoro <stamp>"`. The status says `The display name Priya Shah <stamp> has been changed to Priya Okoro <stamp> successfully.` and the row leaves the list. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/console-names-waiting.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot -c > /tmp/better-answers-verify/<port>/evidence/console-names-waiting.aria.txt`.
- **Prove the correction.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Everyone" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/people/everyone'"`, `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "<priya email>" --name "Search by name or address"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Priya Okoro <stamp>"`. Her row now reads `Priya Okoro <stamp>`. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/console-everyone-corrected.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot -c > /tmp/better-answers-verify/<port>/evidence/console-everyone-corrected.aria.txt`.
- **The Console's own address.** Run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/console` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/console/workspaces/every-workspace'"`. The operator lands on `Every Workspace`.

## Gotchas

- The Console shows only to a person holding the operator mark. Anyone else who opens a `/console` address meets `Access Denied` with the link `Back to Your Workspaces`, not the not-found page.
- The operator here is also the Admin of a workspace, yet signing in at `/console` opens the Console with only the `Console` link in its rail.
- Every list holds what the whole instance holds, from every recipe run on it. Give each seeded name the stamp, search for it, and wait for the status to say `matches` before you read the table.
- The correct button's full name is `Correct Priya Shah <stamp>’s Display Name` with a curly apostrophe. Match it by the substring `Correct Priya Shah <stamp>`.
- A person's sheet draws its headings before its facts, with one region `Sessions and Assistant Access` while it reads. Wait for a fact such as `No open sessions` before you capture it.
- Leave `End Every Sign-In and Token` alone in this recipe. It ends every sign-in and token the person holds, behind a confirmation of its own.
- A correction needs a second-factor confirmation under an hour old. The sign-in gives one, so a long pause before `Save Changes` brings up the `Confirm It’s You` dialog.
