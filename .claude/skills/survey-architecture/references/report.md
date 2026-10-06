# The report

The report is one HTML page the owner annotates, plus a markdown copy with the same content. The review reads the copy when `lavish-axi` is not at hand.

## Where it goes and what it is called

Write both files to the `.lavish/` folder of the **main checkout**, which is the parent of the directory `git rev-parse --git-common-dir` prints. A worktree's own `.lavish/` is deleted with the worktree. The folder is git-ignored, so neither file is ever committed.

Name them `survey-architecture-<area>-<YYYY-MM-DD-HHMM>.html` and `.md`, using the local time.
- `<area>` is `all` when no area was named.
- Otherwise it is the first named area's path with `/` replaced by `-`, for example `packages-core-src-concepts`. When more areas were named, add `-plus-` and how many, for example `packages-core-src-concepts-plus-1`.
- If either name is taken, add `-2`, `-3` and so on before the extension.

Never overwrite an earlier report. `lavish-axi` resumes a session by file, so a reused name would attach the old annotations to new findings.

## The header

- The date, the surveyed ref and its commit.
- How the areas were chosen: named by the owner, or picked by the history recipe with its window, area cap and the number of commits left out.
- For each area, the GitNexus index's commit against the area's last commit, and whether the index was older.
- Every capability the run did without, and what it used instead: GitNexus, the `first-principles` skill, the `diagram-design` plugin, `lavish-axi`.

Caller counts are lower bounds; say so wherever one appears.

## One card per opportunity

Use the words in `CONTEXT.md` for the domain, and the slice and door words of ADR 0029 for structure. Write "the concepts slice's face", not "the ConceptsService".

- **Files:** the files and modules involved.
- **Problem:** the friction, in terms of what is hard to change or to test.
- **Rule:** the heading of the rule it breaks, quoted from `CODING_STANDARDS.md` or the standards file beside the area.
- **Proposal:** the shape it would take, in plain words.
- **Before and after:** a diagram of each, side by side, wherever a picture helps the decision.
- **Test note:** from the walk.
- **Strength:** a badge reading Strong, Worth exploring or Speculative.
- **Conflicts with:** the decision doc's path and `ADR NNNN`, with one line on why the friction justifies reopening it. Omit the field when there is no conflict.
- **Open questions:** what reading the code could not settle.

Order the cards by strength. End with a **Top recommendation**: the one opportunity to take first, and why. After it, list the areas walked with nothing found, one line each.

## Diagrams

When this host has the `diagram-design` plugin, draw each before-and-after with it and inline its SVG in the card. Choose the diagram type that fits the change, such as an architecture delta or a dependency graph. Without the plugin, write Mermaid, which the page renders from its CDN. Either way, the markdown copy carries the same diagrams as Mermaid blocks. Leave a diagram out of a card it would not help.

## The page

The page is self-contained: one file with no local assets. Style it with the design system's tokens. Paste the contents of these files into a `<style>` block, then write plain CSS that uses their variables:
- `packages/design-system/tokens/fonts-remote.css`
- `packages/design-system/tokens/colors.css`
- `packages/design-system/tokens/typography.css`
- `packages/design-system/tokens/spacing.css`
- `packages/design-system/tokens/radius.css`
- `packages/design-system/tokens/semantic.css`

Do not use components or a CSS framework.

## Open it and hand off

When `lavish-axi` is available, open the page with it, so the owner can annotate cards and selected text. Otherwise give the page's absolute path for a browser.

Then print these lines, with absolute paths:

```text
Architecture survey: <html path>
Markdown copy: <md path>
Annotations: in the next session, `lavish-axi poll <html path>` returns what the owner queued on the page.
Next: start the architecture review with /ce-brainstorm, giving it these two paths.
```

Leave out the annotations line when `lavish-axi` was not available. On Codex, write the next step as `$ce-brainstorm`.
