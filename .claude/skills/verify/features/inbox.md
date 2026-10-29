# Inbox

Decide the changes other members suggest to concepts: compare, then accept or decline.

Setup, once, in a fresh workspace, then the recipes in order. `<annualLeaveIri>` and `<expenseClaimsIri>` are the concepts' whole `iri`. `<annualLeaveId>` is the part of the first after `/c/`.

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Inbox"}'` answers `workspaceId`, `admin.id` and `admin.email`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Ifan Morgan"}'` answers Ifan's `id`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<ifanId>","role":"Editor"}'` answers `{"added":true}`.
3. `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<admin.id>","concepts":[{"title":"Annual leave","collection":"policies","kind":"Policy","body":"Everyone takes 25 days of leave."},{"title":"Expense claims","collection":"policies","kind":"Policy","body":"Claims go in within 30 days."}]}'` answers each concept's `iri`.
4. `.claude/skills/verify/scripts/harness.sh <port> POST /suggestions '{"workspaceId":"<workspaceId>","userId":"<ifanId>","iri":"<annualLeaveIri>","body":"Everyone takes 28 days of leave."}'` and `.claude/skills/verify/scripts/harness.sh <port> POST /suggestions '{"workspaceId":"<workspaceId>","userId":"<ifanId>","iri":"<expenseClaimsIri>","body":"Claims go in within 60 days."}'`. Each answers a `suggestionId`.
5. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email>` lands on `/people/members`.

## inbox-waiting-on-you at `/inbox/waiting-on-you`

1. `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 members"`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Inbox" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/inbox/waiting-on-you'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 suggestions waiting"`. Expect the region *Waiting on You* to list *Annual leave* and *Expense claims*, each with the checkbox *Select <title>* and *Ifan Morgan* under *Suggested By*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role checkbox check --name "Select Annual leave"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Accept Selected"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 suggestion waiting"`. Expect the status *Accepted. The change is committed with Ifan Morgan as its author.* and only *Expense claims* listed.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/knowledge/search/<annualLeaveId>`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 28 days of leave."`. Then `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/inbox/waiting-on-you`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "1 suggestion waiting"`. Expect only *Expense claims* listed.

## inbox-waiting-item at `/inbox/waiting-on-you/<suggestionId>`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Expense claims" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/inbox/waiting-on-you/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Suggested Version"`. Expect the buttons *Accept* and *Decline*, and the regions *Current Version* (30 days) and *Suggested Version* (60 days).
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Decline" --exact`, `.claude/skills/verify/scripts/browse.sh <port> find label "Reason for Declining" fill "The figure is from last year"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Decline Suggestion"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/inbox/waiting-on-you'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "0 suggestions waiting"`. Expect the status *Declined. Ifan Morgan can read your reason.* and the region *Waiting on You* to hold *Nothing is waiting on you.*
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "0 suggestions waiting"`.
