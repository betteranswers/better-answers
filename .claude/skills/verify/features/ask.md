# Ask

Ask a question of the workspace's knowledge, flag the answer, return to past questions and connect Claude.

Setup, once, in a fresh workspace:

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Calder Audits"}'` answers `workspaceId` and `admin.id`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<admin.id>","concepts":[{"title":"How do buyers access audit information about their users actions?","collection":"audits","body":"Buyers download their users audit log from the console."}]}'`
3. `.claude/skills/verify/scripts/harness.sh <port> POST /asking '{"workspaceId":"<workspaceId>","judging":{"fits":["How do buyers access audit information about their users actions?"]}}'` answers `{"scripted":true}`.
4. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Vera Viewer"}'` answers the Viewer's `id` and `email`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<viewer id>","role":"Viewer"}'` answers `{"added":true}`.
5. `.claude/skills/verify/scripts/sign-in.sh <port> <viewer email>` lands on `/ask/new-question`.

## ask-new at `/ask/new-question`

1. `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "How do buyers access audit information?" --name "question"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Ask" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Judged"`. Expect the answer to show `Judged` and the region `audits` to hold the article `How do buyers access audit information about their users actions?`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "answer"`, `.claude/skills/verify/scripts/browse.sh <port> find role radio check --name "incomplete"`, `.claude/skills/verify/scripts/browse.sh <port> find role textbox fill "It leaves out the LMS." --name "note"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "send"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/flagged/i.test(document.body.innerText)"`. Expect a status message, and the button that flags the answer to become a disabled button that says the answer is flagged.

## ask-yours at `/ask/your-questions`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "questions"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/ask/your-questions'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "How do buyers access audit information?"`. Expect the list of the asker's questions to hold one link, `How do buyers access audit information?`.

## ask-record at `/ask/your-questions/<recordId>`

1. On `/ask/your-questions`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "How do buyers access audit information?"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/ask/your-questions/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "It leaves out the LMS."`. Expect the answer to show the same article, and the asker's feedback to show the flag with the reason `Incomplete` and the note `It leaves out the LMS.`.

## ask-connect at `/ask/connect-claude`

1. On `/ask/your-questions/<recordId>`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "connect"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/ask/connect-claude'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "http://localhost:<port>/mcp"`. Expect four steps, the second showing `http://localhost:<port>/mcp`.
2. `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "copy"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "/copied/i.test(document.body.innerText)"`. Expect a status message that says the address is copied.
