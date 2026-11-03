import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  provision,
  signIn,
} from "../harness.ts";
import { scrolledSideways } from "../knowledge.ts";

const thePicker = (page: Page) => page.getByRole("heading", { level: 1, name: "Your Workspaces" });

const memberOfTwoWorkspaces = async (
  request: APIRequestContext,
  email: string,
  names: { readonly first: string; readonly second: string },
) => {
  const first = await provision(request, { name: names.first, adminEmail: email });
  const second = await provision(request, { name: names.second });
  await addMember(request, {
    workspaceId: second.workspaceId,
    userId: first.admin.id,
    role: "Viewer",
  });
  return { first, second };
};

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
  expect(elapsed, "the list of two workspaces rendered past its budget").toBeLessThan(
    LIST_BUDGET_MS,
  );

  await test.step("ends the chooser with Account, Sign out and Keyboard shortcuts", async () => {
    const workspaces = page.getByRole("main").getByRole("listitem").getByRole("button");
    await expect(workspaces).toHaveCount(2);

    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main:
        - heading "Your Workspaces" [level=1]
        - paragraph
        - list
        - link "Account"
        - button "Sign Out"
        - button "Keyboard Shortcuts"
    `);
    await page.keyboard.press("Tab");
    await expect(workspaces.first(), "Tab did not reach the first workspace").toBeFocused();
    await page.keyboard.press("Tab");
    await expect(workspaces.last(), "a role tag took a stop between the workspaces").toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Account" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign Out" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keystrokesButton(page)).toBeFocused();

    const listed = await keystrokesListed(page, "Your Workspaces");
    await expect(listed.getByRole("term").filter({ hasText: /^w$/ })).toBeVisible();
    await keystrokesDismissed(page, listed);
    await page.keyboard.press("w");
    await expect(workspaces.first()).toBeFocused();
  });

  await passesTheAccessibilityGate();

  await test.step("keeps a long workspace name and role at 320 pixels", async () => {
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width: 320, height: 720 });
    await narrow.goto("/choose-workspace");
    await expect(thePicker(narrow)).toBeVisible();

    const named = narrow.getByRole("button", { name: first.name, exact: true });
    await expect(named).toHaveAccessibleDescription("Admin");
    expect(await linesOf(named), "the long name stays on one line").toBeGreaterThan(1);
    await expect(
      rowsOf(narrow).filter({ has: named }).getByText("Admin", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await scrolledSideways(narrow), "the picker scrolls sideways at 320 pixels").toBe(0);
    await narrow.close();
  });
});
