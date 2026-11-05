import type { Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  landedAtHome,
  memberOfTwoWorkspaces,
  personMenuOpened,
  provision,
  signIn,
} from "../harness.ts";

const thePicker = (page: Page) => page.getByRole("heading", { level: 1, name: "Your Workspaces" });

test("sign-in opens the only workspace or the picked one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await test.step("a member of one workspace signs in and sees the workspace name, their own name, and their role", async () => {
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

  await test.step("a member of two workspaces picks the second on Your Workspaces, then sees only that workspace", async () => {
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
