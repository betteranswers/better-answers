# Knowledge

Search the workspace's concepts, read one, browse them by collection and kind, name a collection's owner.

Setup, once, in a fresh workspace (a title the workspace already holds is refused), then the recipes in order. `<annualLeaveId>` is the part of the *Annual leave* concept's `iri` after `/c/`.

1. `.claude/skills/verify/scripts/harness.sh <port> POST /workspaces '{"name":"Verify Knowledge"}'` answers `workspaceId`, `admin.id` and `admin.email`.
2. `.claude/skills/verify/scripts/harness.sh <port> POST /people '{"displayName":"Ifan Morgan"}'` answers Ifan's `id`. Then `.claude/skills/verify/scripts/harness.sh <port> POST /members '{"workspaceId":"<workspaceId>","userId":"<ifanId>","role":"Editor"}'` answers `{"added":true}`.
3. `.claude/skills/verify/scripts/harness.sh <port> POST /concepts '{"workspaceId":"<workspaceId>","userId":"<admin.id>","concepts":[{"title":"Annual leave","collection":"policies","kind":"Policy","body":"Everyone takes 25 days of leave."},{"title":"Expense claims","collection":"policies","kind":"Policy","body":"Claims go in within 30 days."},{"title":"Fire drills","collection":"safety","kind":"Procedure","body":"A fire drill runs each quarter."}]}'` answers each concept's `iri`.
4. `.claude/skills/verify/scripts/sign-in.sh <port> <admin.email>`, then `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`.

## knowledge-search at `/knowledge/search`

1. `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/people/members`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "2 members"`, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Knowledge" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/search'"`. Expect the searchbox *Search by a word or a question*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role searchbox fill "leave" --name "Search by a word or a question"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "new URL(location.href).searchParams.get('knowledge.search') === 'leave'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Annual leave"`. Expect the status *Showing matches for “leave”.* and the list *Matches* to hold the link *Annual leave*.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Annual leave"`. Expect the searchbox to hold `leave` and the match listed.

## knowledge-concept at `/knowledge/search/<annualLeaveId>`

1. On the Search page after step 2 above, `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Annual leave" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname.startsWith('/knowledge/search/')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 25 days of leave."`. Expect the article *Annual leave* with the link *Back to Search* and the regions *Sources*, *Verification* and *Links*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Back to Search"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/search'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Showing matches for"`. Expect the address to carry `knowledge.search=leave` and the match listed.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port>/knowledge/search/<annualLeaveId>`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Everyone takes 25 days of leave."`.

## knowledge-base at `/knowledge/knowledge-base`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Knowledge Base"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/knowledge-base'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "3 concepts"`. Expect the tree *Collections and kinds* with the closed items *policies, 2 concepts* and *safety, 1 concept*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role treeitem click --name "policies, 2 concepts"`, `.claude/skills/verify/scripts/browse.sh <port> find role treeitem click --name "Policy, 2 concepts" --exact`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.search.includes('base.kind=Policy')"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Expense claims"`. Expect the region *Policy in policies* to hold a table of *Annual leave* and *Expense claims*, each *Policy* and *Unverified*.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Expense claims"`. Expect the address to keep `base.collection=policies&base.kind=Policy` and the same kind open.

## knowledge-collections-and-owners at `/knowledge/collections-and-owners`

1. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Collections and Owners"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/knowledge/collections-and-owners'"`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Concepts with Their Own Owner"`. Expect the status *2 collections* and *policies* and *safety* each beginning *No owner yet*, each with a picker *New Owner of <collection>* and a *Save* button.
2. The picker is a native select, so `select` and `fill` change nothing. Run `.claude/skills/verify/scripts/browse.sh <port> wait --fn "[...document.querySelectorAll('option')].some((each) => each.textContent === 'Ifan Morgan')"`, then `.claude/skills/verify/scripts/browse.sh <port> press c` and `.claude/skills/verify/scripts/browse.sh <port> press i` as separate commands, then `.claude/skills/verify/scripts/browse.sh <port> find role button click --name "Save the new owner of policies"` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Ifan Morgan now owns “policies”."`. Expect the owner of *policies* to read *Ifan Morgan*.
3. Second view: `.claude/skills/verify/scripts/browse.sh <port> reload`, `.claude/skills/verify/scripts/browse.sh <port> wait --text "Concepts with Their Own Owner"`. Expect *policies* owned by *Ifan Morgan* and *safety* with no owner.

## knowledge-not-built

Pages not built draw the not-found page. A not-found page proves only that the address is not served yet, never a broken page.

1. For each of `/knowledge/guides`, `/knowledge/all-knowledge`, `/knowledge/due-for-verification`, `/knowledge/conflicts`, `/knowledge/kinds` and `/knowledge/exports`, run `.claude/skills/verify/scripts/browse.sh <port> open http://localhost:<port><address>` and `.claude/skills/verify/scripts/browse.sh <port> wait --text "Page Not Found"`. Expect the heading *Page Not Found* over the link *Go to Members*.
2. `.claude/skills/verify/scripts/browse.sh <port> find role link click --name "Go to Members"`, `.claude/skills/verify/scripts/browse.sh <port> wait --fn "location.pathname === '/people/members'"`.
