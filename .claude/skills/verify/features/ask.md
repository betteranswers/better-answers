# Ask

Ask lets a person put a question to the workspace's knowledge, read the Answer or the related knowledge it finds, flag what is wrong, return to their own past questions and connect Claude so they can ask from there.

## Sub-features

- `ask-new` asks a question at `/ask/new-question` and shows the result and a flag for the answer.
- `ask-yours` lists the signed-in person's own questions at `/ask/your-questions`.
- `ask-record` opens one question at `/ask/your-questions/<recordId>` with its result and the feedback the person gave.
- `ask-connect` shows the steps and the address to connect Claude at `/ask/connect-claude`.

## How to get to it (user POV)

- The Viewer the recipe signs in lands on `/ask/new-question`.
- Choose a question's link on `Your Questions` to open its record.

## Driving it with agent-browser

Preconditions:

- The instance was started by `launch.sh <port>` and `doctor.sh <port>` printed `worth driving`. Put its port where a command says `<port>`, and run every command from the repository root.
- Take each id and address from the answer of the command that made it. The harness mints each person's address.
- The instance runs the harness's scripted model wire. Asking calls a model only as `POST /asking` scripted it for that workspace.

- **Provision.** Make a workspace with an Admin. Run `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Calder Audits"}'`. The answer names `workspaceId` and `admin.id`.
- **Seed knowledge.** The Admin writes two concepts. Run `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<admin.id>","concepts":[{"title":"How do buyers access audit information about their users actions?","collection":"audits","kind":"Answer","body":"Buyers download their users audit log from the console.","trust":"machine-confirmed"},{"title":"Audit information access for buyers","collection":"audits","kind":"Policy","body":"Buyers access audit information through the console audit page."}]}'`. The answer lists both concepts with their IRIs.
- **Script the model.** The judge finds the first concept fits. Run `.claude/skills/verify/scripts/harness.sh <port> POST /asking '{"workspaceId":"<workspaceId>","judging":{"fits":["How do buyers access audit information about their users actions?"]}}'`. It answers `{"scripted":true}`.
- **Add a Viewer.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Vera Viewer"}'`. The answer names the Viewer's `id` and `email`. Then run `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<viewer id>","role":"Viewer"}'`. It answers `{"added":true}`.
- **Sign in.** Run `.claude/skills/verify/scripts/sign-in.sh <port> <viewer email>`. It prints a line that ends with the page's address, `http://localhost:<port>/ask/new-question`. The region `New Question` holds the textbox `Question` and the button `Ask`.
- **Ask.** Run `.claude/skills/verify/scripts/browse.sh <port> find label "Question" fill "How do buyers access audit information?"`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Ask" --exact` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Judged"`. The region `Answered` shows the word `Judged` and the region `audits` holds the article `How do buyers access audit information about their users actions?`. A group `Collections` with the checkbox `audits` appears under the question.
- **Record the answer.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/ask-new-question.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/ask-new-question.aria.txt`.
- **Flag the answer.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Flag This Answer"`, `.claude/skills/verify/scripts/browse.sh <port> find role radio check --name "Incomplete"`, `.claude/skills/verify/scripts/browse.sh <port> find label "Note" fill "It leaves out the LMS."`, `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Send Flag"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Flagged"`. The button `Flag This Answer` becomes a disabled button `Flagged`.
- **Your Questions.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Your Questions"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/ask/your-questions'"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "How do buyers access audit information?"`. The region `Your Questions` lists one link, `How do buyers access audit information?`. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/ask-your-questions.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/ask-your-questions.aria.txt`.
- **Open the record.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "How do buyers access audit information?"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/ask/your-questions/')"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Flagged · Incomplete"`. The level-1 heading `Ask` sits over the question, a level-2 heading, the region `Answered` shows the same article, and the region `Your Feedback` reads `Flagged · Incomplete` with the note `It leaves out the LMS.`. This is the second view that proves the flag was stored. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/ask-your-questions-record.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/ask-your-questions-record.aria.txt`.
- **Connect Claude.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Connect Claude" --exact` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Connect Claude as Your Assistant"`. The page lists four steps, and the second shows the address `http://localhost:<port>/mcp`.
- **Copy the address.** Run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Copy Address"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Address copied successfully."`. The status beside the button says so. Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/ask-connect-claude.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/ask-connect-claude.aria.txt`.

## Gotchas

- A workspace with no `POST /asking` script asks no model. The page then says `Not judged` and shows each Answer in full, which is a different end state from `Judged`.
- `judging.fits` names a concept by its exact title. A title the workspace does not hold is ignored, so the page shows related knowledge in place of an Answer.
- Keep `--exact` on the click of `Ask`.
- The answer's own flag is `Flag This Answer`. Each Answer has a flag of its own named `Flag “<title>”` with curly quotes. Match the answer's flag by its full name.
