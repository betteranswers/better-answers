---
title: "What a rename's prose pass gets wrong, and the checks that catch it"
date: 2026-10-04
last_updated: 2026-10-08
category: best-practices
module: development-workflow
problem_type: best_practice
component: development-workflow
severity: medium
applies_when:
  - "A rename replaces a word across comments, JSX text, docs, CSS and code with a pattern over the tree"
  - "Writing a keep rule for the senses of the old word a rename must leave alone"
  - "The old word has a second sense in code, is part of longer names in other senses, or is a gerund or verb"
  - "A rename touches a stored or wire name, a fixture under contracts/, a page address, or a phrase of more than one word"
  - "A rename moves files, or a one-word noun becomes two words"
symptoms:
  - "A blanket pass renamed a stored localStorage key, a CSS token's name in a test title, and the other senses of the old word"
  - "A keep rule matched inside file paths and class names such as auth-screen, so moved files kept their old imports"
  - "The pass turned a Python local into two words, a movedFrom address into one that no longer redirects, and a gerund into a noun"
  - "The pass rewrote contract fixture prose after both stamps were generated, and the tier's digest test failed"
  - "A two-word phrase wrapped at a comment's line break passed the words test"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - testing-framework
tags:
  - rename
  - prose-pass
  - keep-rule
  - stored-names
  - moved-address
  - words-test
---

# What a rename's prose pass gets wrong, and the checks that catch it

## Context

A rename that spans the tree replaces the old word with a pattern over every tracked file, holding each sense it must keep behind a keep rule. BA-29 ran eleven such passes, U7 to U17 of `docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`. Each mistake below got past the pass. tsc, the contract digest test and code review caught most of them, and reading a word diff by hand caught the rest. Several left no old word behind, so the words test could never have seen them. Adding the old word's row to the words test is the sibling doc (Related).

## Guidance

### Before the pass

**1. List every sense the old word has, in prose and in code.** In U7, *surface* also meant what the api exposes, the MCP surface, the roles surface, the design system's colours and a verb; *screen* also meant a screen reader, Tailwind's screen sizes, Testing Library's `screen` and a device's display. In U11, *bind* was also the store door's helper that sets a SQL parameter, and *binding cookie* the sign-in link's cookie. Reword verbs and loose senses by hand first, because no keep rule can tell them from the renamed sense. Give each fixed-spelling sense a keep rule.

**2. Hold every stored and wire name.** Anything a browser, a database, a URL or another program stores or sends keeps its name (R22): localStorage and sessionStorage keys, cookie names, query-string and router keys, header names, CSS custom properties and design tokens, and any string that names one of them, such as a test title. U7's pass renamed the menu's localStorage key `better-answers.secondary-nav`, so every reader who had hidden the menu would have seen it again, and turned the test title "the page's own surface token" (the colour token `--surface-page`) into "area token". A test cannot protect a stored key by spelling it out: the same pass rewrites the test's literal too. Only a keep rule keeps it.

Leave out of the pass every path the words test carves out (`CARVED_OUT` in `apps/api/tests/avoid-words.test.ts`: migrations and their snapshots, `docs/archive/`, plans and dogfood reports dated before 2026-10-08, the stored-names register, lifted code) and every generated file, such as `apps/web/src/features/people/audit-actions.ts`. They hold stored history or are regenerated, and no test fails when a pass rewrites them.

**3. A word inside longer names in other senses.** With *domain* to *collection*, a pass that matches the word at camel humps and joiners rewrites `testingDomain`, `domainOf`, `OFF_TESTING_DOMAIN` and the stored column `testing_domain`; *hit* to *match* rewrites `reconcilerHits`. None of them meant the reader's word, and the column would change with no migration. Narrow the pass to the files that write the renamed sense, or give the longer names an unanchored keep rule. Then grep the word's own trees for longer names that do mean it: the words test's one-sense row matches the whole word only.

### Keep rules

**4. Bound every keep rule on the left with more than `\b`.** `\b` treats a hyphen as a boundary, so it stops some matches inside file names and class lists but not others:

| Keep rule | `"./auth-screen.tsx"` | `screen.getByRole(` | `min-h-screen` |
|---|---|---|---|
| `screen(?=\.)` | kept | kept | not kept |
| `(?<![\w-])screen\.(?:getBy\|getAllBy\|queryBy\|queryAllBy\|findBy\|findAllBy\|debug)` | not kept | kept | not kept |
| `[hw]-screen` | kept | not kept | kept |
| `(?<![\w-])(?:min-\|max-)?[hw]-screen\b` | not kept | not kept | kept |

U7's Testing Library rule kept `screen` in `auth-screen.tsx`, so the moved files' imports kept their old paths, and its Tailwind rule matched the `h-screen` inside `auth-screen`. For Tailwind a left boundary that excludes hyphens is enough. For Testing Library no boundary is enough: name the query methods, and give the import its own rule. Try each rule on a moved file's import, a class list and a real use before running it.

**5. The pass edits whatever its pattern reaches, code included.** U11's pass protected the stored names it knew of and still turned a Python local `binding` into `connected source` (a syntax error), `movedFrom: ["/sources/bindings"]` into an address that no longer led to its page, and the label "Binding the document" into "Connected source the document". Hold `movedFrom` values and every quoted address or path in the keep list. Grep for the gerund (`Binding the`, `binding a`) before the pass and reword it by hand. After the pass, grep code files for the new noun in a code position (`= `, `.`, `(`, a comma before a newline) outside quotes and comments. An exclude glob such as `':!*migrations*'` also skips any file whose name holds the word, so check what a glob drops.

**6. Check where the new word already means something.** U7's new word *page* is also Playwright's `page`, and the pass turned "Every screen the page was shown" into "Every page the page was shown". Reword that sense before the pass, or grep for the new word twice in one clause afterwards:

```sh
git diff -U0 origin/main...HEAD -- apps/web/e2e apps/web/journeys | rg -n '^\+.*\bpages?\b[^.;(){}]{0,25}\bpage\b'
```

### After the pass

**7. Move files, fix their imports, then run tsc.** A text pass moves no file. Move them with `git mv`, fix the imports, and run the workspace's `check`: tsc finds kept import paths and, after a hand rename of a property, shorthand uses such as `({ group })` that did not become `menuGroup: group`.

**8. Read each word pair's diff, file by file.** A keep rule protects only the senses someone thought of:

```sh
git diff --word-diff=plain -U0 origin/main...HEAD -- . | rg '^\+\+\+ |\[-[^]]*[Ss]urface'
```

Run it for each pair. It shows the hand rewordings next to the replacements, so a reviewer checks both in one read.

**9. Grep multi-word phrases across line breaks.** The words test reads a file line by line, so a two-word phrase wrapped at a comment's line break passes it. U7 left "navigation and secondary" at the end of one line and "nav, never list or sidebar" at the start of the next. Grep with line breaks and comment marks allowed between the words:

```sh
rg -U -n -i 'secondary[\s*/#]+nav' -g '!docs/archive/**' -g '!docs/{plans,dogfood-reports}/2026-0[1-9]-*' \
  -g '!docs/{plans,dogfood-reports}/2026-10-0[1-7]-*' -g '!apps/api/tests/old-words.ts' -g '!docs/solutions/best-practices/*renam*'
```

The globs leave out files the words test also skips: the archive, plans and dogfood reports dated before 2026-10-08, the list, and the rename learnings, which quote the words a rename removes.

**10. Leave a fixture under `contracts/` as written.** Both tiers read those fixtures, and the api tier's contract digest is computed from them (`packages/schema/test/contract-digest.test.ts`). Rewording one moves the digest for wording alone; give the old word a sense on its row in the words test instead. When a fixture must change, regenerate both stamps after the pass, never before it: U11's pass reworded fixture prose after the stamps were generated, and the worker's hand-edited-digest test failed.

**11. A noun that grows a word pushes test titles past their cap.** `MOST_WORDS = 10` (`packages/schema/test/test-title.ts`), and the Python suite holds the same cap. *Binding* to *connected source* put about sixty titles over it. Run every suite's title check before committing.

**12. Redirect a renamed page only if it is built.** When the page has `built: true` in `apps/web/src/shared/navigation.ts`, add each old address to its `movedFrom` and to the `MOVED` list in `apps/web/test/navigation.test.ts` in the same commit, and watch the test fail before the address is right. An unbuilt page was never routed, so it gets neither: "routes every moved address, each leading to a built page" (`apps/web/test/frame.test.tsx`) refuses a moved address whose pages are all unbuilt.

**13. Pin a new accessible name with `exact: true` when it sits inside another.** Playwright matches a `getByRole` name as a case-insensitive substring unless `exact: true` is set. U7 titled the narrow layout's sheet "Menu", and the toggle reads "Hide the menu", so `getByRole("button", { name: "Menu" })` found both.

## Why This Matters

A renamed storage key changes nothing a test reads, but it resets a choice on every reader's browser. A renamed token name, or another sense of the old word turned into the new one, reads plausibly and fails nothing. tsc, the contract digest test, code review and a hand-read word diff caught these, and only the first two run on their own. Steps 6, 8 and 9 are each one command.

## When to Apply

- Planning or running a rename that replaces a word across the tree, from the first sense list to opening the pull request.
- Writing a keep rule for a sense the rename leaves alone.
- Renaming a page, built or not.
- Reviewing a rename's pull request: steps 6, 8 and 9 work for a reviewer too.

## Examples

**A stored key the pass renamed, and how it is kept.**

```ts
// before U7
const KEPT_UNDER = "better-answers.secondary-nav";
// after the pass
const KEPT_UNDER = "better-answers.menu";
// after the review fix, apps/web/src/app/menu-showing.ts
/** Stored on readers' browsers, so the key keeps its first name (R22). */
const KEPT_UNDER = "better-answers.secondary-nav";
```

The `secondary nav` row in `apps/api/tests/old-words.ts` carries the same sense, scoped to `apps/web/`.

**A collision word doubled in prose.**

```ts
/** Every screen the page was shown, so a screen that came and went cannot pass unseen. */
/** Every page the page was shown, so a page that came and went cannot pass unseen. */
/** Every page the browser was shown, so a page that came and went cannot pass unseen. */
```

## Related

- `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`: adding the old word's row to the words test, in the same pull request.
- `docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md`: the migration a rename of a stored name needs.
- `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md`: what a moved or unbuilt address shows.
