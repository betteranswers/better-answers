# The accessibility gate's audit

What the audit in `apps/web/e2e/browser.ts` does on each page a test leaves, and how the gate
proves itself. `SKILL.md` gives the gate's three parts and when a spec names the fixture.

## What the audit does

The fixture audits the page the test leaves the browser on, once the body has finished, and
stands aside where the test has already failed so the real error is the one reported.

- **Transitions end first.** Each audit waits for every transition on the page to end, because
  axe reads a control part-way through its fade as a contrast nobody settles on. A refusal handing
  a button back from its disabled look is the case. An endless animation, such as a spinner, is
  audited running.
- **The page is read from its top.** Each audit scrolls to the top and scrolls back afterwards: a
  row scrolled half under the sticky band is how a sticky band works, and axe would refuse that
  row's control as a target the band's own button partly covers. So where a spec leaves the page
  scrolled decides nothing.
- **Marks and textures are set aside.** The audit refuses a page that draws more than three
  registration marks. It sets the marks and the grid and dot textures aside while axe runs, and
  fails any contrast axe still could not decide because of what was painted behind the text.
- **Wordless controls are measured by their edge.** Axe's contrast rule reads words only, so the
  audit also refuses any enabled control a person finds by its edge alone (a field, a select, or a
  checkbox, radio or switch with no words of its own) whose edge and fill both sit under 3:1
  against what is behind it. Both are measured as painted. A wordless wrapper's border counts only
  on a side that hugs the field's own, and its fill only when one of its sides does. A wordless
  box that hugs on no side is a layout's, so the field is measured against that box's own fill. An
  ancestor's opacity dims edge and fill alike. `controlEdges` and `contrastBetween`, in
  `references/helpers.md`, are the measures.
- **Both themes are audited.** The audit runs in the page's own theme, then sets `data-theme` on
  `<html>` to the other theme, audits again and puts the page's theme back, so every state a test
  leaves is held in dark as well as light. A failure names the theme it was found in. A spec about
  one theme keeps it on the browser under `THEME_KEPT_UNDER` from
  `apps/web/src/shared/theme/theme-switch.ts`, as `apps/web/e2e/app/dark-theme.spec.ts` does.

## The gate's own proof

`apps/web/e2e/accessibility-gate.spec.ts` is the gate's own proof. Each of its `test.fail()` tests
draws one thing the gate must refuse, so the run prints it with a ✘ and counts it passed. That is
the gate firing where it should. An `Expected to fail, but passed` there means the gate no longer
refuses that thing. A new case prints exactly that on the gate as it was before the change it
proves. One that already prints a ✘ there fails for another reason, as an undersized field fails
axe's `target-size`.
