import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  personMenuOpened,
  provision,
  signIn,
} from "../harness.ts";

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

test("sign-in lands a sole member and scopes a picked workspace", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await test.step("a sole member lands in the shell: workspace, person, role", async () => {
    const email = anAddress("sole");
    const workspace = await provision(request, { name: "Acme Joinery", adminEmail: email });

    await page.goto("/sign-in");
    await signIn(page, request, email);

    await landedAtHome(page, "Admin");
    const bar = page.getByRole("banner");
    await expect(bar.getByText(workspace.name)).toBeVisible();
    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByText(workspace.admin.name, { exact: true })).toBeVisible();
    await expect(you.getByText("Admin", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
    await passesTheAccessibilityGate();
  });

  await test.step("a two-workspace member picks the second, and everything after is scoped to it", async () => {
    const email = anAddress("both");
    const { first, second } = await memberOfTwoWorkspaces(request, email, {
      first: "Northern Tooling",
      second: "Southern Castings",
    });

    await page.context().clearCookies();
    await page.goto("/sign-in");
    await signIn(page, request, email);

    await expect(thePicker(page)).toBeVisible();
    await expect(page.getByRole("button", { name: first.name })).toBeVisible();

    await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
    await page.getByRole("button", { name: second.name }).click();

    await landedAtHome(page, "Viewer");
    const bar = page.getByRole("banner");
    await expect(bar.getByText(second.name)).toBeVisible();
    await expect(bar.getByText(first.name)).toHaveCount(0);
    await expect(await personMenuOpened(page, first.admin.name)).toContainText("Viewer");
  });
});
