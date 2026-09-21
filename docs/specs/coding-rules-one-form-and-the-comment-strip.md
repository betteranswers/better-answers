# The coding rules take one form, and the tree stops teaching prose

Off the route: hygiene, cut from the owner's grilling of 21/09/2026. The settled decisions, measurements and the tooling research are in the session's working notes; this spec carries what a builder needs.

## Problem Statement

An agent writes what it sees. The rules files were founded on a short imperative form and drifted into narrative: 41% of the root file is rule, the rest is enforcement bookkeeping, mechanism description and ticket history. The same voice now runs through the code — 297,000 words of comments over 65,650 lines of code, six times the reference repository's density in source and nine times in tests — and every new file copies it. Rule tags were meant for a reviewer to cite and are written in 120 test files and 80 other places. Nothing mechanical holds any of this down, and the one clean-out that was tried regrew in sixteen days.

## Solution

The tree is stripped once, by script, and held by gates from then on. A script deletes every comment and docstring it cannot recognise as a directive or a notice; agents restore only the whys; a lint rule, a Python check and a density ceiling keep it so. Tags leave everything but the rules files, review findings and gate messages. The rules files are rewritten to one form — an imperative, an optional `Reviewer:` line, a BAD/GOOD snippet — under a form test with word budgets, and the reviewer is told to read them.

## User Stories

### The implementing agent
1. As an implementing agent, I want each rule to be an imperative I can read in seconds, so that I apply it rather than litigate it.
2. As an implementing agent, I want a BAD/GOOD snippet where code shows the rule faster than words, so that I match the pattern first time.
3. As an implementing agent, I want to read only the rules that can bind the directory I am in, so that a core ticket does not carry deploy and web rules.
4. As an implementing agent, I want the files around me to open with code and carry short whys, so that what I copy is the intended style.
5. As an implementing agent, I want an over-long or history-narrating comment refused where I write it, with a message that says what is allowed, so that I fix it before CI.
6. As an implementing agent, I want a lint to refuse an environment read outside the config module, so that I learn the rule from the gate.
7. As an implementing agent, I want a scan to refuse a raw insert in a test outside a factory, in both tiers, so that setup goes through factories.
8. As an implementing agent in the worker, I want the rule to say that a factory is where a raw insert lives, so that the compliant path exists in a tier that cannot import the other's factories.
9. As an implementing agent, I want one statement of each rule, so that a change to it is a one-place edit.

### The reviewing agent
10. As the reviewing agent, I want the workflow to name the rules files as the standards I read, so that a `Reviewer:` line has a reader.
11. As the reviewing agent, I want a `Reviewer:` line on every rule only I can catch, so that I know my list without an enforcement audit.
12. As the reviewing agent, I want `[SEC3]`'s line to fire on a diff that touches a migration, grant, policy or definer function, so that the security pass has a trigger.
13. As the reviewing agent, I want `[DESIGN4]` scoped to one process, so that I never ask for a database or cross-tier guard to be removed.
14. As the reviewing agent, I want every rule tagged, so that a finding can cite it.

### The owner
15. As the owner, I want the form held by a test — banned references, tagged imperative headings, 80 words a rule, 2,500 words in the root file — so that the form survives without my attention.
16. As the owner, I want comment length, banned references in comments and comment density held in `check`, so that the strip does not regrow.
17. As the owner, I want every enforcement gap the rules files describe filed as a ticket before its sentence is deleted, so that nothing known is lost.
18. As the owner, I want proof that the strip changed no code, so that I can merge seven large diffs without reading them line by line.
19. As the owner, I want the short rules shown to still catch what the long ones caught, so that brevity costs nothing.
20. As the owner, I want the decision recorded under its own title, so that a later session finds it.
21. As the owner, I want to read the rewritten root file before it merges.

### The Coordinator
22. As the Coordinator, I want one workspace per agent on disjoint files, so that seven branches merge without conflict.
23. As the Coordinator, I want a measurable finish line per workspace, so that done is not a judgement.
24. As the Coordinator, I want the gate to land with no baseline, so that there is no list to maintain.

### A spec or ADR author
25. As a spec author, I want to name a rule in words, so that a new spec passes the tag test.
26. As an ADR reader, I want existing citations left as they were written, so that history stays accurate.

### A gate's maintainer
27. As a gate's maintainer, I want each new gate proven to fire and proven to pass, through the runner every other gate uses, so that it cannot pass by reading nothing.

## Implementation Decisions

### The strip
- A script pass deletes every comment and docstring except directives and pragmas, and licence and lift notices. TypeScript and TSX go through a syntax-aware rewrite that handles comments inside JSX before plain comments; Python goes through a lossless-syntax-tree codemod that leaves a placeholder where a body held only a docstring. The tooling research names the tools it ran; versions are pinned from the source on the day.
- A restore pass follows: one agent per workspace, the largest workspace split into source and tests, each in its own worktree. An agent reads the removed text for its files and restores only a why that stops the next editor breaking something, in 25 words at most.
- Scope is TypeScript and Python, source and tests, in all six workspaces. Applied SQL migrations, comments in YAML, JSON and shell, test titles beyond their tags, docs and commit messages are untouched.
- A throwaway proof, run by the Coordinator on every strip branch, shows each changed file is code-identical to the main branch with comments set aside: TypeScript by transform output compared as text, Python by syntax tree with docstring nodes removed. It must also fail on a lost hashbang. The one other diff it allows is a tag removed from a test title, in its own commit.
- Per-symbol impact analysis is waived for these comment-only edits by the owner's ruling; the changed-scope check still runs before each commit, and suites run in CI only.

### The comment gate
- TypeScript: a rule in the repository's own lint plugin. A comment block is 25 words at most and carries no ticket id, date, rule tag or ADR number. Directives and notices are exempt. It offers a fix.
- Python: a check with the same two conditions, docstrings counted as comments.
- The ceiling: comment lines per code line at or under 0.10 in a workspace's source and 0.05 in its tests, measured by an off-the-shelf line counter that treats a Python docstring as comment, behind a wrapper that sets the exit code. The counter does not see comments inside JSX; that blind spot is accepted because the lint rule still caps them.
- All three run in root `check` and land with no baseline once the last workspace is clean.
- A write-time hook that puts the rule's message in front of an agent when it writes the comment is a follow-up, not part of this work's acceptance.

### Tags
- A tag is written in a rules file, a review finding or a gate's failure message. The tag test asserts that, that tags are defined only in rules files and are well-formed, and that a tag in a gate message is defined.
- The ADR and spec files that exist when the test is rewritten are a frozen list that only shrinks; the test does not look inside them for retired tags.
- The baseline of tests that cite a tag, the list of tags cited nowhere, and the assertion that every tag is cited elsewhere are removed.
- Tags leave tests, test titles, living docs, lint-config comments and the paused reviewer's configuration, which points at the rules files instead.
- `[COMMENT1]` and `[COMMENT2]` take their new text in the same change as the strip, so the rules file agrees with the gates that land with it.

### The rules files
- One form: a tagged heading with an imperative title, a body, an optional `Reviewer:` line, a BAD/GOOD snippet where it helps. 80 words of prose a rule, snippets free, `[SEC3]` the first entry of a shrink-only exception list; 2,500 words of prose in the root file. Outside code fences a rules file names identifiers only.
- The `Reviewer:` line is the one marker of who catches a violation. "Each rule names what holds it" leaves the four preambles.
- Displaced text is deleted. A decision no ADR records moves to an ADR; an enforcement gap no ticket tracks moves to a ticket tagged `gate-gap`. The gap sweep runs before the rewrite.
- Moves: `[UX2]` and `[A11Y1]` to the web file, `[PIPE1]` to the worker file, `[OPS1]` to a new rules file beside the deploy configuration, which the agents' entry document names.
- Retired with no stub: `[DESIGN2]` and `[APP3]` (into `[TEST1]`), `[WRK2]`, `[WRK3]`, `[WRK4]`, `[CHECK9]`, `[UX1]`, `[OKF1]` (its test text to the OKF document; `[OKF2]` keeps the rule). Surviving tags do not renumber. The two TYPES sections become tagged rules in a TYPES family numbered from one, one per imperative.
- Content: `[DESIGN4]` is one guard per condition inside one process, with the double role check as its snippet. `[TEST2]` becomes "Real stores, always" — every store the platform runs is real in tests; an in-memory adapter is for a service someone else runs. `[TEST4]` says a raw insert appears only inside a factory. The environment rule is stated once and distinguishes reading a setting from passing the environment to a child process, which lives in one named function. `[SEC3]`'s adversarial pass becomes its `Reviewer:` line. `[TEST6]` is one line. Text about a seam not yet built goes; the ticket that builds the seam writes its rule.
- The workflow document's review step names the rules files as the standards the review reads.

### Recording
- One new ADR of 300 words at most — the form, the three places a tag is written, the form test and comment gate as holders, review by the author's own review pass — and one amendment to the store-doors ADR for real stores in tests. A row each in the ADR index.

## Testing Decisions

- A good test here proves a gate fires on a violation and passes on a clean tree, by running the real tool, and never asserts on the tool's internals.
- The lint rule, the Python check, the insert scan and the environment lint are each tested through the devtools throwaway-tree runner, both ways. Prior art: the suites that run the repository's existing lint rules and the import-direction rule.
- The ceiling's wrapper is tested through the same runner: a tree over the ceiling fails with the workspace named, a tree under it passes.
- The form test and the tag test read the committed tree, and each proves its own parser on fixture text first so that neither passes by reading nothing. Prior art: today's tag test and the check-scripts test. The form test is written first and is red until the rewrite turns it green.
- The comment-only proof is proven before use: it passes on an untouched file, fails on a one-token code edit and fails on a lost hashbang.
- Once, by hand: four seeded diffs — a raw insert in a test, an environment read in core, an oracle-style expectation, a second in-process guard — go through the review pass with the new rules text, and each is caught with the right tag.
- CI's root `check` is the arbiter for every PR.

## Out of Scope

- Commit-message length, docs and spec prose, and test-title length: a separate session.
- Comments in SQL, YAML, JSON and shell.
- Scrubbing tags from existing ADRs and specs.
- Generating the worker's factories from the schema journal.
- An independent or path-triggered reviewer, and any change to copy detection over tests.
- Resuming the paused PR reviewer.

## Further Notes

- The strip starts once the pull request queued by the parallel session has merged, and no code branch opens while it runs.
- Removing comments can surface copy-detection duplicates that comments used to separate; the fix is a helper or a fence.
- A lint rule requires the reason on an empty `catch` and on a lint disable; `check` names any the script removed, and the restore pass puts them back.
- The worker's mocking guard prints a tag in its failure message, which is one of the three places a tag belongs.
- This spec cites tags because it retires some; it lands before the tag test is rewritten and so joins the frozen list.
- The one measured study the research found puts AI-written and human-written comment ratios level, which fits the diagnosis here: the cause is the pattern in this tree, not agents as such.
