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

const workspacesHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your Workspaces" });

test("sign-in opens the only workspace or the picked one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await test.step("a sole-workspace member sees their workspace, name, and role", async () => {
    const email = anAddress("sole");
    const workspace = await provision(request, { name: "Acme Joinery", adminEmail: email });

    await page.goto("/sign-in");
    await signIn(page, request, email);

    await landedAtHome(page, "Admin");
    const header = page.getByRole("banner");
    await expect(header.getByText(workspace.name)).toBeVisible();
    const personMenu = await personMenuOpened(page, workspace.admin.name);
    await expect(personMenu.getByText(workspace.admin.name, { exact: true })).toBeVisible();
    await expect(personMenu.getByText("Admin", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
    await passesTheAccessibilityGate();
  });

  await test.step("a member of two workspaces sees only the one picked", async () => {
    const email = anAddress("both");
    const { first, second } = await memberOfTwoWorkspaces(request, email, {
      first: "Northern Tooling",
      second: "Southern Castings",
    });

    await page.context().clearCookies();
    await page.goto("/sign-in");
    await signIn(page, request, email);

    await expect(workspacesHeading(page)).toBeVisible();
    await expect(page.getByRole("button", { name: first.name })).toBeVisible();

    await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
    await page.getByRole("button", { name: second.name }).click();

    await landedAtHome(page, "Viewer");
    const header = page.getByRole("banner");
    await expect(header.getByText(second.name)).toBeVisible();
    await expect(header.getByText(first.name)).toHaveCount(0);
    await expect(await personMenuOpened(page, first.admin.name)).toContainText("Viewer");
  });
});
