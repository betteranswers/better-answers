# The strip reaches the config tree, and the frozen documents give up their tags

Off the route: hygiene, the second half of the comment strip. The first half (`coding-rules-one-form-and-the-comment-strip.md`) stripped the two code tiers and holds them with three gates and a write-time hook; it put YAML, shell, SQL and the tags in existing ADRs and specs out of scope. This spec brings those in, on the same blueprint, and was cut from the owner's read of the closed goal on 22/09/2026.

## Problem Statement

The code tree is held: the gated workspaces sit between 0.4% and 2.3% comment lines per code line under a 10% ceiling. Everything the gates do not read is where the pattern went on unchecked. The workflow files carry more comment lines than code; the deploy scripts and compose files, the hook scripts, the tool configuration at the root and the SQL migrations together carry about 2,600 comment lines over about 4,000 lines of code. The migrations sit inside a gated workspace, where the TypeScript beside them dilutes their 73% under the ceiling, so the gate is green over the tree's largest remaining mass of prose. An agent writing a workflow step or a migration reads what stands there and writes the same.

The tag test freezes 62 ADRs and specs, 592 tag citations, as a list that only shrinks, and no ticket shrinks it. A rule tag is the address of a rule in a file that renumbers and retires; an ADR, in the form this repository writes them, is one to three sentences of context, decision and why. The tag has no place in it, and a reader following one lands on a rule that may have moved, been rewritten or gone.

## Solution

The config tree is stripped once, by script, and held by the same gates from then on: the TypeScript gate reaches the root scripts by naming their directory; the Python check learns the comment syntax of YAML, shell, TOML and SQL and runs over the config directories and the migrations; the density ceiling measures a config directory and the migrations directory each on its own. Each gate lands with no baseline once its tree is clean. The write-time hook runs the extended check on those file types too.

The 62 frozen documents lose their tags by one rule read off the ADR format: a tag a sentence merely cites, in parentheses, is deleted; a tag a sentence depends on is replaced by the rule's imperative title, or by plain words where the rule has retired. The frozen list and its shrink-only case then leave the tag test, which from then on holds that a tag is written in a rules file, a review finding or a gate's failure message and nowhere else.

The five citation patterns the two gates each carry become one fixture under the tier contract that every gate compiles, and the same patterns are refused in a string that reaches a person.

## User Stories

1. As an implementing agent, I want a workflow step, a deploy script or a migration to show me the form of the tree, so that what I write matches it without a rule telling me to.
2. As an implementing agent, I want a comment I write in a YAML, shell or SQL file refused at write time with the rule's message, so that I learn the rule before CI does.
3. As an implementing agent, I want a directive in those files (a shebang, a `shellcheck` or `renovate` line, a language-server line, a pin tag beside a `uses:` line) to pass without ceremony, so that the gate is not in the way of what the tooling needs.
4. As a reviewing agent, I want no gap between what the gates read and what the tree holds, so that a comment in a migration is a finding the gate raises rather than one I read off the diff.
5. As the owner, I want the migrations measured on their own, so that a green ceiling over `packages/schema` means the SQL is clean and not that the TypeScript beside it is large.
6. As the owner, I want the config tree's numbers in the same shape as the code tree's, so that the density report reads as one thing across the repository.
7. As the owner, I want the strip proven text-only for every language it touches, so that a comment-only change to a workflow, a compose file or a migration cannot have changed what runs.
8. As the owner, I want every why the strip removed from a deploy script or a workflow judged for restoration by the same bar as the code restores, so that the runbook knowledge in those files is not lost with the narrative around it.
9. As the owner, I want a decision that a workflow comment used to explain moved into an ADR, and a how-to moved into the operations documents, so that the prose has a home a reader can find.
10. As a reader of an ADR, I want the rule it leans on named by what it says, so that the sentence still reads when the rules file renumbers or retires the tag.
11. As a reader of an old spec, I want its parenthetical citations gone and its dependent sentences whole, so that the record of the ticket still makes sense without a rules file open beside it.
12. As a spec or ADR author, I want the tag test to refuse a tag anywhere but the three places, with no frozen list to reason about, so that the rule is one sentence.
13. As an operator reading a usage line or a refusal, I want it to say what I can do, so that I am not sent to a document number I cannot open from a terminal.
14. As a gate's maintainer, I want the citation patterns in one fixture, so that adding a sixth pattern is one edit both gates and the hook pick up, proven by the contract suites on each side.
15. As a gate's maintainer, I want the config-tree checker to be the Python check grown by a syntax table rather than a third tool, so that one message and one word ceiling hold across every language.
16. As the Coordinator, I want the strip's commits to carry the comment-only proof's answer in their bodies, so that a reviewer can trust a large diff that changes nothing.
17. As the Coordinator, I want the gates to land with no baseline and no allow-list beyond directives, so that the first comment past the ceiling after the strip is red.

## Implementation Decisions

### The config tree's scope

- The roots the strip and the gates cover: the workflows and actions directory, the deploy directory, the hooks directory under the Claude configuration, the root scripts directory, the tool configuration files at the repository root (the reviewer's configuration, the git hooks configuration, the dead-code and copy-detection configurations, the workspace manifest), and the schema package's migrations directory.
- Not covered, by construction: skills and agent documents, which are prose by nature and are read by no comment gate; the documents tree; JSON, which has no comments; the anti-slop lift, which is edited upstream.
- The languages and their comment syntax: `#` for YAML, shell and TOML; `--` for SQL; `//` and `/* */` for JavaScript, which the TypeScript gate already reads.

### The gates

- The TypeScript gate reaches the root scripts directory by naming it beside the two tiers in the gate's command. Nothing else changes in that rule.
- The Python check grows a syntax table keyed by file extension and runs over the config roots and the migrations. The two conditions are the code tree's: a comment block is 25 words at most and carries no citation. Docstrings stay a Python matter.
- Directives are exempt by shape: a shebang; a `shellcheck`, `renovate`, `yaml-language-server` or `noqa` line; a pin tag beside a `uses:` line (one word, so it passes on length regardless); a lefthook or compose key comment that names a version. The exempt shapes are listed in the check, each with a case in its suite.
- The density ceiling gains a directory mode: a config root is measured as a unit, and the migrations directory is measured on its own, apart from the workspace that holds it. The ceiling is the source ceiling, 0.10, for every config root. The report names each unit as it names a workspace today.
- The write-time hook dispatches on the extended set of file types and hands the same message back.
- All of it runs in root `check` and lands with no baseline once each root is clean.

### The strip and the restores

- The strip script grows the same syntax table and removes every comment it cannot recognise as a directive, in the config roots and the migrations. Displaced prose is deleted.
- The comment-only proof grows a normalisation per language: a file with its comments removed on both sides of the commit is byte-identical, whitespace normalised, for YAML, shell, TOML and SQL; JavaScript keeps the token proof. A strip commit carries the proof's answer in its body.
- The restores follow the code tree's bar: a why of 25 words or fewer with no citation goes back where it explains a non-obvious choice; everything else stays out. A decision a comment explained moves to an ADR; a how-to moves to the operations documents; a workflow's design essay moves to the operations documents' CI page or is deleted where the step's name already says it.
- Order: the fixture first, then the gates unwired with their suites, then the strip and its restores root by root, then the gates wired with no baseline. No code branch opens while a root is mid-strip, as before.

### The frozen documents

- The rule for a tag in an ADR or a spec, read off the ADR format the repository follows (a decision is one to three sentences of context, decision and why; optional sections only where they add value): a tag inside parentheses, cited and not read, is deleted with its parentheses; a tag a sentence depends on is replaced by the rule's imperative title in plain words, or, where the rule has retired, by the words the rule used to say; a tag that heads a list or a table row is replaced the same way.
- The replacement is by hand per sentence, from a script's list of every site; the ADR index rows and the glossary are read against the result. About 165 of the 592 are parenthetical.
- The frozen list, its shrink-only case and the note that the frozen files are not read for retired tags leave the tag test. The test then holds that a tag is written in a rules file, a review finding or a gate's failure message; the gate-file exception stays as it is.
- The previous spec, which cites tags because it retires some, is treated the same way and leaves the list with the rest.

### The citation fixture

- The five patterns (a ticket id, an ADR number, a rule tag, an ISO date, a slashed date) move to one fixture under the tier contract, each with its name and its pattern as a string both tiers can compile. The TypeScript rule, the Python check and the write-time hook read it. Each tier's contract suite proves it reads the fixture and refuses what the fixture says.

### Strings that reach a person

- A string in source carries no citation either: a usage line, a refusal message or a log line names what the reader can act on, never a document number they cannot open from where they read it. The TypeScript rule gains a second check over string and template literals in source, and the Python check the same over string literals in source, both reading the fixture. Tests are exempt, as are the gate files that print a tag in their failure message, the same exception the tag test carries.
- The sites that stand today, about eleven in the api's usage text and hostname refusals, are rewritten in the ticket that lands the check, each to say the thing rather than cite it.

## Testing Decisions

- A good test drives the real tool over a throwaway tree and asserts where it fires and where it stays silent; it never asserts on the tool's source. Every gate change lands with a both-ways functional test through the throwaway-tree runner in the devtools package, as the comment gates, the insert scan and the environment lint did.
- The Python check's suite gains a case per language and a case per exempt directive shape; the density suite gains the directory mode with a root over and under the ceiling; the hook suite gains one refused and one passed edit per new file type.
- The comment-only proof carries a self-test per language, as it does for TypeScript and Python today, and each strip commit is proven by it.
- The tag test's own cases: a tag in a rules file passes, a tag in a gate message inside a string passes, a tag in an ADR fails, a tag in a spec fails. The frozen-list case is deleted, not kept green.
- The fixture is proved by the tier contract's suites on each side, the pattern the other contract fixtures already follow.
- The strip's result is measured in the ticket's Progress with the same numbers as the first half: comment lines before and after per root, and the restores counted.

## Out of Scope

- Commit-message length, docs and spec prose, and test-title length.
- Prose in skills, agent documents and the documents tree.
- Resuming the paused PR reviewer.
- The gate-gap tickets the first half filed; they are triaged on their own.

## Further Notes

- Measured on 22/09/2026 before the strip, full-line comments only: workflows and actions 575 over 490 lines of code; deploy 552 over 943; hooks 211 over 311; root scripts 124 over 644; root tool configuration 209 over 250; migrations 967 over 1,325, in 43 files.
- The comment gate reads comments only, so an ADR number inside a usage string or a refusal message was invisible to it. The api's usage text has cited ADR numbers since before the first strip, and its newest line followed the file's pattern; that is how the string check earned its place here.
- The migrations' comment mass is the one surprise of the measurement: the workspace ceiling reads green because the TypeScript beside the SQL is eight times its size.
- Removing comments from a compose file or a workflow can surface copy-detection duplicates the comments used to separate, as it did in the code tree; the fix is the same, a helper or a fence.
