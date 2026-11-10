import type { Locator, Page } from "@playwright/test";

import { PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { SIGN_OUT } from "@/shared/words.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  memberOfTwoWorkspaces,
  signIn,
} from "../harness.ts";
import { scrolledSideways } from "../knowledge.ts";

const thePicker = (page: Page) =>
  page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading });

const LIST_BUDGET_MS = 1000;

const rowsOf = (page: Page) => page.getByRole("main").getByRole("listitem");

const linesOf = (button: Locator): Promise<number> =>
  button.evaluate((drawn) => {
    const text = document.createRange();
    text.selectNodeContents(drawn);
    return new Set([...text.getClientRects()].map((line) => Math.round(line.top))).size;
  });

test("lists a member's workspaces within a second", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("listed");
  const { first } = await memberOfTwoWorkspaces(request, email, {
    first: "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Community Joinery",
    second: "Timed Fabrics",
  });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(rowsOf(page)).toHaveCount(2);

  const started = Date.now();
  await page.goto("/choose-workspace");
  await expect(rowsOf(page)).toHaveCount(2);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "workspace list", description: `${elapsed} ms` });
  expect(elapsed, "two workspaces took longer than one second to render").toBeLessThan(
    LIST_BUDGET_MS,
  );

  await test.step("puts Account, Sign Out, and Keyboard Shortcuts after the workspaces", async () => {
    const workspaces = page.getByRole("main").getByRole("listitem").getByRole("button");
    await expect(workspaces).toHaveCount(2);

    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main:
        - heading ${JSON.stringify(PICKER_WORDS.heading)} [level=1]
        - paragraph
        - list
        - link "Account"
        - button "Sign Out"
        - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
    `);
    await page.keyboard.press("Tab");
    await expect(workspaces.first(), "Tab did not reach the first workspace").toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      workspaces.last(),
      "Tab stopped on the role tag between the workspaces",
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Account" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: SIGN_OUT })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keystrokesButton(page)).toBeFocused();

    const listed = await keystrokesListed(page, PICKER_WORDS.heading);
    await expect(listed.getByRole("term").filter({ hasText: /^w$/ })).toBeVisible();
    await keystrokesDismissed(page, listed);
    await page.keyboard.press("w");
    await expect(workspaces.first()).toBeFocused();
  });

  await passesTheAccessibilityGate();

  await test.step("wraps a long workspace name and keeps its role visible at 320 pixels", async () => {
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width: 320, height: 720 });
    await narrow.goto("/choose-workspace");
    await expect(thePicker(narrow)).toBeVisible();

    const named = narrow.getByRole("button", { name: first.name, exact: true });
    await expect(named).toHaveAccessibleDescription("Admin");
    expect(await linesOf(named), "the long name does not wrap").toBeGreaterThan(1);
    await expect(
      rowsOf(narrow).filter({ has: named }).getByText("Admin", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await scrolledSideways(narrow), "the picker scrolls sideways at 320 pixels").toBe(0);
    await narrow.close();
  });
});
