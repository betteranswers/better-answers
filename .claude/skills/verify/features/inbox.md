# Inbox

Inbox is where a person decides the changes other members suggest to concepts. An Admin sees every waiting edit, and a member named owner of a collection or a concept sees the edits to what they own. They compare a suggestion with the current version, then accept it, which saves the change with its proposer as author, or decline it with a reason.

## Sub-features

- `inbox-waiting-on-you` is the Waiting on You page at `/inbox/waiting-on-you`. It lists each waiting suggestion with who suggested it and when, and accepts the selected ones at once.
- `inbox-waiting-item` is one suggestion's page at `/inbox/waiting-on-you/<suggestionId>`, reached from its row. It sets the current version beside the suggested one and accepts or declines it.

## How to get to it (user POV)

- Choose *Inbox* in the rail, the `navigation` named *Areas*. It opens `/inbox/waiting-on-you`. The rail shows *Inbox* only to an Admin and to an owner.
- Choose *Waiting on You* in the menu, the `navigation` named *Inbox*.
- Choose a suggestion's title in the list. Its page opens.
- Choose *Back to Waiting on You* on a suggestion's page, or a link in the breadcrumb, the `navigation` named *Breadcrumb*.
- Open a suggestion's address before signing in. The address survives sign-in and the suggestion opens.

## Driving it with agent-browser

Preconditions:

- `.claude/skills/verify/scripts/doctor.sh <port>` printed `worth driving`. Put the launched port wherever a command says `<port>`.
- One workspace serves both recipes in this file, and one Admin sign-in drives them. Run the setup bullets once, then the recipes in the order given. The first recipe accepts one suggestion and the second declines the other.
- Each answer below names values that later commands take. Put the answer's `workspaceId` where a command says `<workspaceId>`, the Admin's `id` where it says `<adminId>`, the Admin's `email` where it says `<adminEmail>` and Ifan's `id` where it says `<ifanId>`. Put each concept's whole `iri` where a command says `<annualLeaveIri>` or `<expenseClaimsIri>`, and the last part of the *Annual leave* IRI, after `/c/`, where it says `<annualLeaveId>`.

Setup:

- **Provision.** Make the workspace and its Admin. Run `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Inbox"}'`. The answer names the `workspaceId` and the Admin's `id` and `email`. The harness mints the address.
- **Add an Editor.** Ifan proposes the changes. Run `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Ifan Morgan"}'`, then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<ifanId>","role":"Editor"}'`. It answers `{"added":true}`.
- **Write two concepts.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<adminId>","concepts":[{"title":"Annual leave","collection":"policies","kind":"Policy","body":"Everyone takes 25 days of leave."},{"title":"Expense claims","collection":"policies","kind":"Policy","body":"Claims go in within 30 days."}]}'`. The answer lists both concepts, each with an `iri` such as `https://better-answers.com/c/01M61VDHKD4JVYRNQ0SYDRM45E`.
- **Suggest two edits.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /suggestions '{"workspaceId":"<workspaceId>","userId":"<ifanId>","iri":"<annualLeaveIri>","body":"Everyone takes 28 days of leave."}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /suggestions '{"workspaceId":"<workspaceId>","userId":"<ifanId>","iri":"<expenseClaimsIri>","body":"Claims go in within 60 days."}'`. Each answers a `suggestionId` and a `setId`.
- **Sign in.** Run `.claude/skills/verify/scripts/sign-in.sh <port> <adminEmail>`, then `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`. The Admin lands on Members.

Waiting on You, at `/inbox/waiting-on-you`, as the Admin:

- **Open from the rail.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Inbox" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/inbox/waiting-on-you'"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 suggestions waiting"`. The heading *Inbox* stands over the region *Waiting on You*. It holds the button *Accept Selected* and a list with the rows *Annual leave* and *Expense claims*. Each row has the checkbox *Select <title>*, its title as a link, *Ifan Morgan* under *Suggested By* and *No owner, so Admins decide* under *Owner*.
- **Accept one.** Run `.claude/skills/verify/scripts/browse.sh <port> find role checkbox check --name "Select Annual leave"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Accept Selected"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 suggestion waiting"`. The status reads *Accepted. The change is committed with Ifan Morgan as its author.* Only *Expense claims* is listed.
- **Prove it.** Run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/knowledge/search/<annualLeaveId>` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 28 days of leave."`. The concept's page shows the accepted body. Then run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/inbox/waiting-on-you` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 suggestion waiting"`. Only *Expense claims* is listed.
- **Evidence.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you.aria.txt`.

A waiting suggestion, at `/inbox/waiting-on-you/<suggestionId>`, as the Admin:

- **Open from the row.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Expense claims" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/inbox/waiting-on-you/')"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Suggested Version"`. The address ends with the *Expense claims* `suggestionId`. The article *Expense claims* holds the link *Back to Waiting on You*, the buttons *Accept* and *Decline*, and the regions *Current Version*, *Suggested Version* and *Suggested Sources*. The current text says 30 days and the suggested text says 60 days.
- **Evidence before the decision.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you-item.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you-item.aria.txt`.
- **Decline it.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Decline" --exact`, `.claude/skills/verify/scripts/browse.sh <port> find label "Reason for Declining" fill "The figure is from last year"` and `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Decline Suggestion"`. Then run `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/inbox/waiting-on-you'"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "0 suggestions waiting"`. The page returns to the list. The status reads *Declined. Ifan Morgan can read your reason.* and the list says *Nothing is waiting on you.*
- **Prove it.** Run `.claude/skills/verify/scripts/browse.sh <port> reload` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "0 suggestions waiting"`. The list stays empty.
- **Evidence after the decision.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you-declined.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/inbox-waiting-on-you-declined.aria.txt`.

## Gotchas

- The page is an Admin's and an owner's. An Editor or a Viewer sees *Inbox* only once an Admin names them owner, of a collection with `.claude/skills/verify/scripts/harness.sh <port> POST /owners '{"workspaceId":"<workspaceId>","userId":"<adminId>","owners":[{"collection":"policies","personId":"<ifanId>"}]}'` or of one concept with `{"iri":"<annualLeaveIri>","personId":"<ifanId>"}` in `owners`. An owner of one concept sees that concept's suggestions alone. Owning nothing, they meet *Page Not Found* with *Go to New Question*, at the list and at each suggestion's address.
- The instance allows five codes to one address in ten minutes. A sixth sign-in of the same person in that window fails at *Send Code*. Sign in once and drive both recipes from that session.
- `POST /suggestions` takes the concept's whole IRI, and a concept's page takes only its last part. A concept the workspace does not hold answers 400 naming `iri`.
- A suggestion is made against the concept as it stood. Accept one, and a second suggestion waiting on the same concept goes back to its proposer instead of committing. Seed each recipe's suggestions on different concepts.
- Seed the suggestions as a member other than the one signed in, so *Suggested By* proves who proposed them.
- Several names nest. *Accept* sits inside *Accept Selected*, *Decline* inside *Decline Suggestion*, and *Inbox* names the rail's link, a heading and the menu's `navigation`. Keep `--exact` where a recipe gives it.
- `wait --text` matches a substring, so `wait --text "2 suggestions waiting"` also matches *12 suggestions waiting*. Seed few enough suggestions that the count cannot nest.
