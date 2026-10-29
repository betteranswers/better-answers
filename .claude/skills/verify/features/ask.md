# Ask

Ask a question of the workspace's knowledge, flag the answer, return to past questions and connect Claude.

Setup, once, in a fresh workspace:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Calder Audits"}'` answers `workspaceId` and `admin.id`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<admin.id>","concepts":[{"title":"How do buyers access audit information about their users actions?","collection":"audits","body":"Buyers download their users audit log from the console."}]}'`
3. `.claude/skills/verify/scripts/harness.sh <port> POST /asking '{"workspaceId":"<workspaceId>","judging":{"fits":["How do buyers access audit information about their users actions?"]}}'` answers `{"scripted":true}`.
4. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Vera Viewer"}'` answers the Viewer's `id` and `email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<viewer id>","role":"Viewer"}'` answers `{"added":true}`.
5. `.claude/skills/verify/scripts/sign-in.sh <port> <viewer email>` lands on `/ask/new-question`.

## ask-new at `/ask/new-question`

1. `.claude/skills/verify/scripts/browse.sh <port> find label "Question" fill "How do buyers access audit information?"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Ask" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Judged"`. Expect the region `Answered` to show `Judged` and the region `audits` to hold the article `How do buyers access audit information about their users actions?`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Flag This Answer"`, `.claude/skills/verify/scripts/browse.sh <port> find role radio check --name "Incomplete"`, `.claude/skills/verify/scripts/browse.sh <port> find label "Note" fill "It leaves out the LMS."`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Send Flag"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Your flag has been sent successfully."`. Expect the button `Flag This Answer` to become a disabled button `Flagged`.

## ask-yours at `/ask/your-questions`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Your Questions"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/ask/your-questions'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "How do buyers access audit information?"`. Expect the region `Your Questions` to list one link, `How do buyers access audit information?`.

## ask-record at `/ask/your-questions/<recordId>`

1. On `/ask/your-questions`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "How do buyers access audit information?"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/ask/your-questions/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Flagged · Incomplete"`. Expect the region `Answered` to show the same article and the region `Your Feedback` to read `Flagged · Incomplete` with the note `It leaves out the LMS.`.

## ask-connect at `/ask/connect-claude`

1. On `/ask/your-questions/<recordId>`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Connect Claude" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Connect Claude as Your Assistant"`. Expect four steps, the second showing `http://localhost:<port>/mcp`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Copy Address"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Address copied successfully."`.
