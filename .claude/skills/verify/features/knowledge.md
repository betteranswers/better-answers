# Knowledge

Knowledge is where a person finds and reads the workspace's concepts. A person searches the concepts, opens one to read its body and sources, and browses them by collection and kind.

## Sub-features

- `knowledge-search` is the Search page at `/knowledge/search`. It finds concepts by a word or a question and keeps the query in the address.
- `knowledge-concept` is one concept's page at `/knowledge/search/<conceptId>`, reached from a match. It shows the concept's body, sources, verification and links. `<conceptId>` is the last part of the concept's IRI.
- `knowledge-base` is the Knowledge Base page at `/knowledge/knowledge-base`. It lists the concepts in a tree of collections and kinds.
- `knowledge-collections-and-owners` is the Collections and Owners page at `/knowledge/collections-and-owners`. It lists each collection with its owner, and an Admin names a new owner there.
- `knowledge-not-built` covers the pages not built yet. As the Admin, each address draws the not-found page with the link `Go to Members`. They are `/knowledge/guides`, `/knowledge/all-knowledge`, `/knowledge/due-for-verification`, `/knowledge/conflicts`, `/knowledge/kinds` and `/knowledge/exports`.

## How to get to it (user POV)

- As the Admin the setup signs in, choose *Knowledge* in the rail. It opens `/knowledge/search`.
- Choose a page in the menu, the `navigation` named *Knowledge*. Under *BROWSE* it lists *Search* and *Knowledge Base*. Under *CURATION* it lists *Collections and Owners*.
- Type in *Search by a word or a question* and choose a concept in the *Matches* list. Its page opens.
- Choose *Back to Search* on a concept's page.

## Driving it with agent-browser

Preconditions:

- `.claude/skills/verify/scripts/doctor.sh <port>` printed `worth driving`. Put the launched port wherever a command says `<port>`.
- One workspace serves every recipe in this file, and one Admin sign-in drives them all. Run the setup bullets once, then the recipes in the order given.
- Each answer below names values that later commands take. Put the answer's `workspaceId` where a command says `<workspaceId>`, the Admin's `id` where it says `<adminId>`, the Admin's `email` where it says `<adminEmail>` and Ifan's `id` where it says `<ifanId>`. Put the last part of the *Annual leave* concept's `iri`, after `/c/`, where a command says `<annualLeaveId>`.

Setup:

- **Provision.** Make the workspace and its Admin. Run `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Knowledge"}'`. The answer names the `workspaceId` and the Admin's `id` and `email`. The harness mints the address.
- **Add an Editor.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Ifan Morgan"}'`, then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<ifanId>","role":"Editor"}'`. It answers `{"added":true}`.
- **Write three concepts.** Run `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<adminId>","concepts":[{"title":"Annual leave","collection":"policies","kind":"Policy","body":"Everyone takes 25 days of leave."},{"title":"Expense claims","collection":"policies","kind":"Policy","body":"Claims go in within 30 days."},{"title":"Fire drills","collection":"safety","kind":"Procedure","body":"A fire drill runs each quarter."}]}'`. The answer lists the three concepts, each with an `iri` such as `https://better-answers.com/c/01M61VDHKD4JVYRNQ0SYDRM45E`.
- **Sign in.** Run `.claude/skills/verify/scripts/sign-in.sh <port> <adminEmail>`, then `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`. The Admin lands on Members.

Search, at `/knowledge/search`, as the Admin:

- **Open from the rail.** Run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 members"`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Knowledge" --exact` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/search'"`. The heading *Browse* stands over the region *Search* and its searchbox *Search by a word or a question*. The menu lists *Search* and *Knowledge Base* under *BROWSE* and *Collections and Owners* under *CURATION*.
- **Search.** Run `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "leave" --name "Search by a word or a question"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "new URL(location.href).searchParams.get('knowledge.search') === 'leave'"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Annual leave"`. The status reads *Showing matches for “leave”.* and the list *Matches* holds the link *Annual leave*.
- **Prove it.** Run `.claude/skills/verify/scripts/browse.sh <port> reload` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Annual leave"`. The searchbox still holds `leave` and the same match is listed.
- **Evidence.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/knowledge-search.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/knowledge-search.aria.txt`.

A concept's page, at `/knowledge/search/<annualLeaveId>`, as the Admin:

- **Open from a match.** On the Search page above, run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Annual leave" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/knowledge/search/')"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 25 days of leave."`. The article *Annual leave* holds the link *Back to Search*, the heading *Annual leave*, the body, the regions *Sources*, *Verification* and *Links*, and the button *Details from the File*.
- **Return.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Back to Search"` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/search'"`. The address still carries `knowledge.search=leave` and the match is listed again.
- **Prove it.** Open the page by its address. Run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/knowledge/search/<annualLeaveId>` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 25 days of leave."`. The same article draws.
- **Evidence.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/knowledge-concept.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/knowledge-concept.aria.txt`.

Knowledge Base, at `/knowledge/knowledge-base`, as the Admin:

- **Open from the menu.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Knowledge Base"` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/knowledge-base'"`. Then run `.claude/skills/verify/scripts/browse.sh <port> wait --text "3 concepts"`. The region *Knowledge Base* holds the tree *Collections and kinds*, with the items *policies, 2 concepts* and *safety, 1 concept*, both closed.
- **Open a kind.** Run `.claude/skills/verify/scripts/browse.sh <port> find role treeitem click --name "policies, 2 concepts"`, `.claude/skills/verify/scripts/browse.sh <port> find role treeitem click --name "Policy, 2 concepts" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.search.includes('base.kind=Policy')"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Expense claims"`. The region *Policy in policies* holds a table with the columns *Title*, *Kind* and *Trust*. Its rows are *Annual leave* and *Expense claims*, each *Policy* and *Unverified*.
- **Prove it.** Run `.claude/skills/verify/scripts/browse.sh <port> reload` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Expense claims"`. The address keeps `base.collection=policies&base.kind=Policy`, and the same kind stays open and selected.
- **Evidence.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/knowledge-knowledge-base.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/knowledge-knowledge-base.aria.txt`.

Collections and Owners, at `/knowledge/collections-and-owners`, as the Admin:

- **Open from the menu.** Run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Collections and Owners"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/collections-and-owners'"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Concepts with Their Own Owner"`. The status reads *2 collections*. The items *policies* and *safety* each read *No owner yet* under *Owner*, with the picker *New Owner of policies* or *New Owner of safety* and its *Save* button.
- **Name an owner.** Run `.claude/skills/verify/scripts/browse.sh <port> press c`, which puts focus on the first picker, *New Owner of policies*. Run `.claude/skills/verify/scripts/browse.sh <port> press i`, which picks *Ifan Morgan*. Then run `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Save the new owner of policies"` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "[...document.querySelectorAll('dd')].some((each) => each.textContent.trim() === 'Ifan Morgan')"`. The owner of *policies* reads *Ifan Morgan*.
- **Prove it.** Run `.claude/skills/verify/scripts/browse.sh <port> reload` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Concepts with Their Own Owner"`. The owner of *policies* still reads *Ifan Morgan*, and *safety* still has no owner.
- **Evidence.** Run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/knowledge-collections-and-owners.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/knowledge-collections-and-owners.aria.txt`.

Pages not built, as the Admin:

- **Read the menu.** On Collections and Owners, the menu *Knowledge* lists only *Search*, *Knowledge Base* and *Collections and Owners*. No page `knowledge-not-built` names is in it.
- **Open each address.** For `/knowledge/guides`, run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/knowledge/guides` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Page Not Found"`. The heading *Page Not Found* stands over the link *Go to Members*. Repeat for each address `knowledge-not-built` names.
- **Go home.** On the last of them, run `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Go to Members"` and `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`.
- **Evidence.** On each not-found page, run `.claude/skills/verify/scripts/browse.sh <port> screenshot /tmp/better-answers-verify/<port>/evidence/knowledge-<page>.png` and `.claude/skills/verify/scripts/browse.sh <port> snapshot > /tmp/better-answers-verify/<port>/evidence/knowledge-<page>.aria.txt`, naming `<page>` for the address's last part, such as `knowledge-guides.png`.

## Gotchas

- The instance allows five codes to one address in ten minutes. A sixth sign-in of the same person in that window fails at *Send Code*. Sign in once and drive every recipe from that session.
- The owner picker is a native select. `.claude/skills/verify/scripts/browse.sh <port> select` with a role or label selector and `.claude/skills/verify/scripts/browse.sh <port> find label "New Owner of policies" fill` both answer *Done* and change nothing. A click opens a popup the keys never reach. Use the page's own `c` key and a typed letter, as the recipe does, or `.claude/skills/verify/scripts/browse.sh <port> select @<ref> "Ifan Morgan"` with the ref a fresh `snapshot -c` gives the picker.
- A concept's page takes the last part of its IRI, never the whole IRI.
- Search and a concept's page share one count of reads for each person, which resets each minute of the clock. Past it the api refuses the read until the next minute. Knowledge Base's tree and kind tables take from the same count. A recipe that searches or opens concepts in a tight loop meets it.
- Several names repeat. *Search* names a menu link, a region and a heading. Keep `--exact` where a recipe gives it.
- `POST /concepts` refuses a title whose file the workspace already holds. Rerun the setup in a fresh workspace, never in the same one.
- The menu leaves out every page not built, so a not-found page proves only that its address is not served yet. Never report it as a broken page.
