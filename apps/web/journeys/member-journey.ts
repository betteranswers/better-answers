import type { Page } from "@playwright/test";

import { goHome } from "@/app/words.ts";
import { HOMES } from "@/shared/navigation.ts";

import {
  landedAtHome,
  notFoundOfferingHome,
  signInHeading,
  signOutFromTheShell,
} from "../e2e/locators.ts";
import { theConsoleIsRefused, theSwitcherListsOneWorkspace, type Gate } from "./every-role.ts";
import { expect, test } from "./fixtures.ts";
import { sessionMemberOf } from "./reads.ts";

/** An Editor or a Viewer: they reach their home, and an Admin's page says it was never there. */
export const aMembersJourney = async (
  page: Page,
  role: "Editor" | "Viewer",
  gate: Gate,
): Promise<void> => {
  const { workspace, person } = await test.step("Home", async () => {
    await landedAtHome(page, role);
    const member = await sessionMemberOf(page);
    await gate();
    return member;
  });

  await test.step("The workspace switcher", () =>
    theSwitcherListsOneWorkspace(page, workspace.name));

  await test.step("The console", () => theConsoleIsRefused(page, gate));

  await test.step("An Admin's page", async () => {
    await page.goto(HOMES.Admin.path);
    await notFoundOfferingHome(page, role);
    await gate();
    await page.getByRole("link", { name: goHome(HOMES[role]) }).click();
    await landedAtHome(page, role);
  });

  await test.step("Sign out", async () => {
    await signOutFromTheShell(page, person.name);
    await expect(signInHeading(page)).toBeVisible();
  });
};
