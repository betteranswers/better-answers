# assets

| File | What it is |
| --- | --- |
| `logo.svg` | The logo: two square brackets with a square between them, like a citation |

An app imports it as `@better-answers/design-system/assets/logo.svg`; the package exports
`./assets/*`. The web client uses it in the band, on the sign-in screens and as the
browser's tab icon. The api's server-rendered pages inline the same file.

**How it is drawn.** One path on a 16-unit square grid, full bleed, in `currentColor`,
with no external references and no `<style>`, so it can be inlined more than once
without leaking a rule into the page. Every edge falls on an even unit: the bars and
arms are 2 units thick, each bracket is 6 units wide, and the square is 4 units, its
sides in line with the arms' ends. The weight is Geist Mono's own bracket: its stem is
100/860 of its height at 500 and 120/860 at 600, and its width 336/860 at 500. The
logo's 2/16 stem and 6/16 width sit between them.

**Sizes.** A multiple of 8px keeps every edge on a whole pixel: 16px as the tab icon,
24px or 32px in the band. At other sizes the edges blur.

**Its name.** The file carries `role="img"` and a `<title>` of `better-answers`, which is
the name a link around it takes. Beside the name set in type, hide it from assistive
technology (`alt=""` on an `<img>`, `aria-hidden="true"` inline), so the name is read
once.

Interface icons come from Phosphor — `@phosphor-icons/react` in the application,
`@phosphor-icons/web` on a static page — a substitution flagged in `readme.md` §7.
