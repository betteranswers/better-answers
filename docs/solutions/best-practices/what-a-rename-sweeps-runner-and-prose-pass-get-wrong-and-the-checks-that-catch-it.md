---
title: "What a rename sweep's runner and prose pass get wrong, and the checks that catch it"
date: 2026-10-04
category: best-practices
module: packages/devtools
problem_type: best_practice
component: development-workflow
severity: medium
applies_when:
  - "A BA-29 sweep (U8 to U17) runs the rename runner in packages/devtools/src/rename over a map"
  - "Writing the prose pass for comments, JSX text, markdown and CSS that the runner does not touch"
  - "Writing a keep rule or a sense regex for a sweep's map"
  - "A sweep moves files that a pending map under packages/devtools/renames/ names by literal path"
  - "A sweep touches a fixture under contracts/ or a landed phrase of more than one word"
symptoms:
  - "The runner's text pass renamed a stored localStorage key that R22 keeps, and a test title meaning the colour token --surface-page"
  - "A blanket pass turned non-navigation senses of surface and screen (api exposure, the MCP surface, the roles surface, design colours, the verb, a device display) into area and page"
  - "A Testing Library keep rule and a Tailwind keep rule matched inside file paths and class names such as auth-screen"
  - "ts-morph's property rename left shorthand properties unrenamed, and only tsc caught it"
  - "A pending map names files by literal path that a sweep moved, and nothing tests that the paths exist"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - testing-framework
tags:
  - rename-sweep
  - prose-pass
  - keep-rule
  - sense-regex
  - ts-morph
  - replay-check
  - words-test
  - ba-29
---

# What a rename sweep's runner and prose pass get wrong, and the checks that catch it

## Context

BA-29 renames the code's words to the reader's words in sweeps, U7 to U17 of `docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`. U7 (screen, surface and secondary nav become page, area and menu) ran first, on the branch `feat/ba-29-u7-page-area-menu`, in four commits: the sweep itself, the landing of its rows in the words test, and two that fix what the sweep got wrong (the second of them after code review). Ten sweeps remain, U8 to U17. Landing rows in the words test is covered by the sibling doc (Related). This one covers the two passes that come before it.

A sweep runs in two passes.

**The runner** (`packages/devtools/src/rename`, run as `pnpm --filter @better-answers/devtools rename --map <name>`, `packages/devtools/package.json:28`) replays a committed map from `packages/devtools/renames/`. Its symbol pass renames TypeScript identifiers through ts-morph's language service (`symbolPass`, `packages/devtools/src/rename/symbols.ts:172-198`). Its text pass uses ast-grep to rename string fragments in TypeScript, TSX and JavaScript, Python identifiers and strings, and JSON string values (`rulesFor` and `textPass`, `packages/devtools/src/rename/text.ts:56-87` and `185-215`). It touches nothing else:

- no comment, JSX text, markdown or CSS;
- no import path: a module-path match gets the verdict `module path` and is left alone (`fixedVerdict`, `text.ts:127-130`);
- no file move: "A module's own declaration is its file, which a rename cannot move" (`ownedDeclaration`, `symbols.ts:38-41`).

The runner already leaves two cases to a person: an aliased import, and a lone word whose joiner it cannot tell, each listed and never edited (session history: the review of U6's runner). Neither came up in U7.

**The prose pass** does the rest: comments, JSX text, docs, CSS, file moves, and the imports that name moved files. In U7's session it was a perl script that held each kept sense behind a placeholder while it replaced the old words, then put the kept text back. The script was session tooling and is not in the tree.

Each mistake below got past the runner. tsc, the contract digest test and code review caught most of them, and reading a word diff by hand caught the rest. Several left no old word behind, so the words test could never have seen them.

## Guidance

Run these steps in order. Each one names the U7 mistake it would have stopped and the check that caught it there.

### Before the runner applies

**1. Read the dry run's string renames for stored and wire names.** Run the map as a dry run on the unswept tree and read every text rename:

```sh
pnpm --filter @better-answers/devtools rename --map <name> | grep -E '^  text .* → '
```

A rename line reads `  text <file>:<line>:<col> "<found>" → "<to>"` (`lineOf`, `packages/devtools/src/rename/report.ts:9-14`), and renames are listed first (`byWeight`, `report.ts:17-21`). Look for any name that a browser, a database, a URL or another program stores or sends:

- localStorage and sessionStorage keys (the web app's are `KEPT_UNDER` constants under `better-answers.`, in `menu-showing.ts`, `keystrokes.tsx` and `session-memory.ts`)
- cookie names, query-string and router keys, header names
- CSS custom properties and design tokens
- any string that names one of these, such as a test title

Before applying, give each one a sense in the map. When the row lands, also give it a permitted sense on the words test row.

U7's text pass renamed two of these:

- `KEPT_UNDER` in `apps/web/src/app/menu-showing.ts` went from `"better-answers.secondary-nav"` to `"better-answers.menu"`, though U7's approach says "The localStorage key stays (R22)". The hook shows the menu unless the key reads `closed` (`apps/web/src/app/secondary-nav-showing.ts:18` before U7). After the rename, every reader who had hidden the menu would have seen it again.
- The e2e test title `"paints the shell in the page's own surface token"` (`apps/web/e2e/frame.spec.ts:794`) meant the colour token `--surface-page`. The pass changed it to "area token".

Code review caught both, and the review-fix commit restored them. The key is back, with:

- a comment at `menu-showing.ts:5`;
- a sense in the map (`packages/devtools/renames/page-area-menu.json:63-66`);
- a permitted sense on the `secondary nav` row (`apps/api/tests/old-words.ts:544-550`).

The map's colour sense now matches `surface token` as well (`page-area-menu.json:59-62`).

A test cannot protect a stored key by spelling it out. `apps/web/test/**` is in the map's text paths (`page-area-menu.json:38-50`), so the same pass that rewrites the code's literal would rewrite the test's too. This follows from the paths. It was not observed, because no test in `apps/web/test/` pins the menu key. Only a sense keeps a key.

**2. Write sense regexes as JavaScript.** A map's `matches` are compiled with `new RegExp` (`isPattern`, `packages/devtools/src/rename/map.ts:40-48`). A pattern that does not compile is refused as "not a regular expression" when the map is parsed.

- The bare `(?i)` prefix throws on Node 24.19 ("Invalid group"). It is easy to copy from `text.ts:108`, where it is legal because ast-grep reads Rust regex.
- Spell case with character classes, as the committed map does: `[Ss]urface`, `(?:MCP|Mcp|mcp)`. Node 24.19 accepts the grouped form `(?i:...)`, but no map uses it.
- A sense's pattern is tested against the whole string or identifier the runner found (`senseOf`, `map.ts:115-120`). So `^screen$` (`page-area-menu.json:53`) keeps the identifier `screen` and nothing longer.

**3. Reword the old word's other senses before the blanket pass.** Before replacing anything, list every sense the old word has in the tree.

- In U7, *surface* also meant what the api exposes, the MCP surface, the roles surface, the design system's colours and tokens, the design system Frame's prop, and a verb ("surfaces its legacy").
- *Screen* also meant a screen reader, Tailwind's screen sizes, Testing Library's `screen`, and a device's display.

A noun sense with a fixed spelling gets a keep rule and a sense (`SCREEN_SENSES` and `SURFACE_SENSES`, `old-words.ts:147-187`). Reword verbs and loose senses by hand first, because no keep rule can tell them apart from the navigation sense. U7 did this for the verbs and the device senses. The sweep commit's message says: "Where surface meant an endpoint, a transport or a verb, the docs now say so plainly." Even so, the blanket pass turned some other-sense uses into *area* and *page*. The word diff in step 8 found them.

### The prose pass

**4. Bound every keep rule on the left with more than `\b`.** `\b` treats a hyphen as a boundary, so it stops some matches inside file names and class lists but not others. U7's two rules failed in different ways (results checked with Node's RegExp; perl reads these patterns the same way):

| Keep rule | `"./auth-screen.tsx"` | `screen.getByRole(` | `min-h-screen` |
|---|---|---|---|
| `screen(?=\.)`, U7's Testing Library rule | kept | kept | not kept |
| `\bscreen(?=\s*\.)` | kept | kept | not kept |
| `(?<![\w-])screen\.(?:getBy\|getAllBy\|queryBy\|queryAllBy\|findBy\|findAllBy\|debug)` | not kept | kept | not kept |
| `[hw]-screen`, U7's Tailwind rule | kept | not kept | kept |
| `\b[hw]-screen`, or `(?<![\w-])(?:min-\|max-)?[hw]-screen\b` | not kept | not kept | kept |

Two things went wrong in U7:

- The Testing Library rule kept `screen` in file paths such as `auth-screen.tsx`, so the imports of the moved files kept their old paths.
- The Tailwind rule matched the `h-screen` inside `auth-screen`.

In the session, tsc found the broken module paths.

- **Tailwind:** a left boundary that excludes hyphens is enough. The words test uses `(?<![\w-])` (`old-words.ts:155`).
- **Testing Library:** no boundary is enough, because `auth-screen.` and `screen.` both follow a non-word character. Name the query methods, and give the import (`import { screen } from "@testing-library/react"`) its own rule.
- Do not copy the words test's Testing Library sense (`old-words.ts:150-154`) into the prose pass. In the words test it only blanks text, and only under `apps/web/test/`. As a keep rule it matches `auth-screen.tsx`.

Before running a keep rule, try it on a moved file's import, a class list and a real use, as in the table.

**5. Move files, then fix their imports, then run tsc.** The runner moves no file and changes no import path (Context), so the prose pass or `git mv` has to. Even on the swept tree, a dry run lists three `module path` occurrences the runner will not touch: `./mcp/surface.ts`, `./roles-surface.ts` and `../scripts/roles-surface.ts`, all kept names. Run tsc (the workspace's `check`) as soon as the prose pass finishes. In U7 it caught the kept import paths and the shorthand properties in step 7.

**6. Check the map's collisions in prose too.** A map's `collisions` list where the new word already means something in code (`page-area-menu.json:5-14`). For U7 those were Playwright's `page` and the row menu. The list protects only the runner's identifiers, not the prose pass.

U7's prose pass turned "Every screen the page was shown" (`apps/web/e2e/display-name.spec.ts:34` before U7) into "Every page the page was shown". It did the same to `signInByEmail`'s comment (`apps/web/e2e/harness.ts:359` before U7). In both, a fix commit changed Playwright's page to "the browser". Either reword the collision's prose sense before the pass, or afterwards grep for the new word twice in one clause:

```sh
git diff -U0 origin/main...HEAD -- apps/web/e2e apps/web/journeys | rg -n '^\+.*\bpages?\b[^.;(){}]{0,25}\bpage\b'
```

Run against the sweep commit alone, before its fixes, this listed eleven lines, including both of the wrong ones.

**7. When you rename a property by hand, check its shorthand uses.** Outside the map, U7 used ts-morph's language service to rename the type `Group` to `MenuGroup`, the `groups` property to `menuGroups`, and `Place.group` to `Place.menuGroup`. Shorthand uses such as `({ surface, group, screen })` in `apps/web/src/app/breadcrumb.tsx` and `apps/web/src/app/jump-to.tsx` before U7 did not come out as `menuGroup: group`, and tsc refused them.

ts-morph's `rename` takes a `usePrefixAndSuffixText` option. Unset, it falls back to the manipulation setting `usePrefixAndSuffixTextForRename`, which ts-morph 28 sets to false (`node_modules/.pnpm/ts-morph@28.0.0/node_modules/ts-morph/dist/ts-morph.js:638`). There are two fixes:

- turn the option on, so the language service writes `menuGroup: group`;
- or rename the locals too, as U7 did (`jump-to.tsx:74-77`, `breadcrumb.tsx:20`).

The runner's own symbol pass also passes `false` (`symbols.ts:114`), so after any sweep, let tsc check the shorthand.

### After both passes

**8. Read each word pair's diff, file by file.** A keep rule protects only the senses someone thought of. This command lists every changed line for a pair, under its file:

```sh
git diff --word-diff=plain -U0 origin/main...HEAD -- . | rg '^\+\+\+ |\[-[^]]*[Ss]urface'
```

Read it file by file for senses the sweep should not have touched. Run it again for each pair in the map. U7's surface-to-area list runs to 318 changed lines. It also shows the hand rewordings next to the renames, such as the complexity-gate skill's "surfaces its legacy", which now says "brings up its legacy", so a reviewer can check both in one read.

**9. Grep landed phrases across line breaks.** The words test splits each file into lines before it matches (`lineFindingsIn`, `apps/api/tests/words-scan.ts:208-215`). A landed phrase of two or more words that wraps at a comment's line break therefore passes. After U7's pass, the comment at `apps/web/src/shared/icon.tsx:108-109` read "navigation and secondary" at the end of one line and "nav, never list or sidebar" at the start of the next. Code review found it. For each multi-word row, grep with line breaks and comment marks allowed between the words:

```sh
rg -U -n -i 'secondary[\s*/#]+nav' \
  -g '!docs/archive/**' -g '!docs/plans/**' -g '!docs/dogfood-reports/**' \
  -g '!apps/api/tests/old-words.ts' -g '!packages/devtools/renames/**' \
  -g '!docs/solutions/best-practices/what-a-rename-sweeps-*'
```

The globs leave out the paths the words test carves out or never reads: stored history, the plans and dogfood reports, the list, the maps and this doc, which quotes the words it teaches a sweep to remove. Run against `icon.tsx` as the sweep commit left it, this finds the wrapped pair at lines 108-109, which a single-line grep misses. On U7's head it prints nothing.

**10. Leave a fixture under `contracts/` as written, and add a sense for it instead.** Both tiers read the fixtures under `contracts/`. The api tier's contract digest is computed from them, and `packages/schema/test/contract-digest.test.ts:14-18` fails when the committed stamp no longer matches. The sweep reworded a `why` in `contracts/concept-inbox/cases.json:107` ("the summary is a decision surface"). That moved the digest with no change in meaning. A fix commit put the fixture back and added a sense scoped to that directory (`old-words.ts:182-186`). The sense is one entry in the list. Rewording the fixture means regenerating the stamp, which is a tier contract change made for wording alone. The sibling doc covers how to write the sense.

**11. Update pending maps by hand for every file the sweep moves.** A map names files by literal path, in its `symbols.paths`, its `text.paths` and its senses' `paths`. Nothing catches a stale path:

- The runner never edits a map. `packages/devtools/renames/**` is on its kept list, because "A map rewritten by its own sweep could no longer be replayed" (`map.ts:15-16`).
- The test for the committed maps only parses them (`packages/devtools/test/rename.test.ts:471-477`). Its comment says the globs are deliberately not checked against today's tree, because a landed sweep moves the files its own map names.

So when a sweep moves a file that a later map names, nothing fails. U7 moved three files that the pending U9 map (`packages/devtools/renames/model-choice.json`) names:

- `apps/web/src/app/screens/routes-and-spend-screen.tsx`
- `apps/web/test/failed-screen.test.tsx`
- `apps/web/test/two-surfaces.test.tsx`

Code review caught it. To list them:

```sh
git diff --name-status -M origin/main...HEAD | awk '$1 ~ /^R/ {print $2}' > /tmp/moved.txt
grep -n -F -f /tmp/moved.txt packages/devtools/renames/*.json
```

Run against the map as it was before the review fix, this printed those three paths, on five lines (two of them sit in both `symbols.paths` and `text.paths`). A moved file that a map covers by a glob, such as `apps/web/e2e/**`, needs no change.

**12. Pin a new accessible name with `exact: true` when it appears inside another.** Unless `exact: true` is set, Playwright matches a `getByRole` name as a case-insensitive substring. U7 titled the narrow layout's sheet "Menu", and the toggle reads "Hide the menu", so `getByRole("button", { name: "Menu" })` finds both. `apps/web/e2e/frame.spec.ts:93-97` sets `exact: true`, with a comment that says why. Check each new reader word against the names already on the pages where it appears.

**13. Replay the committed map on the swept tree. It should rename nothing.** Once the sweep and its fixes are in, run the map again as a dry run:

```sh
pnpm --filter @better-answers/devtools rename --map page-area-menu
```

A dry run writes nothing (`renameOver`, `packages/devtools/src/rename/index.ts:23-31`). Its summary should have no `rename` heading, only senses, kept paths, `module path` and `outside the allowlist`. A `rename` line means the tree still holds an old word the map would change: either the sweep missed it, or it needs a sense.

On U7's head, after the review fix, the replay takes about six seconds. It reports 563 occurrences, none of them a rename:

- 364 Testing Library `screen`
- 47 for what the api exposes
- 36 and 28 under the two roles-surface senses
- 27 for design-system colours
- 20 in rename maps
- 18 in the words test's list
- 11 for the MCP surface
- the rest in ones, twos and threes, including the one menu key

Read the `outside the allowlist` section too. In U7 it holds the `contracts/` fixture and two strings in the design system's lint config, which the map's paths do not reach.

## Why This Matters

Every one of U7's mistakes got past the runner, and several got past every automatic gate:

- A renamed storage key changes nothing a test reads, but it resets a choice on every reader's browser (R22).
- A renamed token name, or a non-navigation *surface* turned into *area*, reads plausibly and fails nothing.

tsc, the contract digest test, code review and a hand-read word diff caught them, and only the first two run on their own. The ten remaining sweeps each bring their own words and senses. U9 replays the model-choice map whose paths U7 moved. U12 renames passage together with the worker's stored names, where more of what the runner meets is stored rather than read. Steps 1, 6, 8, 9, 11 and 13 are each one command, and each would have shown a U7 mistake before review did.

## When to Apply

- Planning or running any of BA-29's sweeps, U8 to U17, from writing the map to opening the pull request.
- Writing or changing a sense in a map under `packages/devtools/renames/`, or a keep rule in a prose pass.
- Renaming a property or type by hand through ts-morph, outside a map.
- Running a sweep that moves files while another map under `packages/devtools/renames/` is still pending.
- Reviewing a sweep's pull request: steps 1, 8, 9, 11 and 13 work for a reviewer too.

## Examples

**A stored key the text pass renamed, and how it is kept.**

```ts
// before U7, apps/web/src/app/secondary-nav-showing.ts:5
const KEPT_UNDER = "better-answers.secondary-nav";

// the sweep commit, after the runner's text pass
const KEPT_UNDER = "better-answers.menu";

// after the review fix, apps/web/src/app/menu-showing.ts:5-6
/** Stored on readers' browsers, so the key keeps its first name (R22). */
const KEPT_UNDER = "better-answers.secondary-nav";
```

```json
{
  "sense": "the menu's showing choice, stored on readers' browsers under its first key (R22)",
  "matches": ["better-answers\\.secondary-nav"]
}
```

The words test row carries the same sense, scoped to `apps/web/` and written `/better-answers\.secondary-nav/g` (`old-words.ts:546-548`).

**A phrase wrapped across a comment's line break, which the words test reads as two lines.**

```ts
// after the sweep commit, apps/web/src/shared/icon.tsx
/**
 * The keys are the glossary's words, not Phosphor's: the shell says navigation and secondary
 * nav, never list or sidebar.
 */

// after the review fix
/**
 * The keys are the glossary's words, not Phosphor's: the shell says navigation and menu,
 * never list or sidebar.
 */
```

**A shorthand property after a hand rename.** Before U7, `jump-to.tsx` built `.map((screen) => ({ surface, group, screen }))` and destructured `({ surface, group, screen }: Placed)`. Once `Placed.group` became `menuGroup`, both had to name it in full. U7 renamed the locals to match: `area.menuGroups.flatMap((menuGroup) => ... .map((page) => ({ area, menuGroup, page })))` (`jump-to.tsx:74-77`).

**A collision word doubled in prose.**

```ts
// before U7, apps/web/e2e/display-name.spec.ts:34
/** Every screen the page was shown, so a screen that came and went cannot pass unseen. */
// the sweep commit
/** Every page the page was shown, so a page that came and went cannot pass unseen. */
// the fix commit
/** Every page the browser was shown, so a page that came and went cannot pass unseen. */
```

**A contract fixture kept as written.** A fix commit reverted `contracts/concept-inbox/cases.json:107` to "the summary is a decision surface" and added this sense to `SURFACE_SENSES` (`old-words.ts:182-186`):

```ts
{
  sense: "what a person decides on, in a fixture whose every edit moves the contract's digest",
  within: "contracts/concept-inbox/",
  written: /\bdecision surface\b/g,
},
```

## Related

- `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`: the step after these two passes. It covers marking rows landed, permitted senses, carve-outs, the glossary marks and the ratchet, and the traps the words test does not report.
- `docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`: U7's approach (R22 keeps the localStorage key) and the units U8 to U17 this doc is for.
- `packages/devtools/src/rename/` (the runner), `packages/devtools/renames/page-area-menu.json` (U7's map, a worked example of senses) and `packages/devtools/renames/model-choice.json` (the U9 map whose paths U7 moved).
