import type { Page } from "@playwright/test";

import { HOMES, type Role } from "@/shared/navigation.ts";

import { saysARefusal, switcherMenuOf, switcherOf } from "../e2e/locators.ts";
import { expect } from "./fixtures.ts";

export type Gate = () => Promise<void>;

const listedAs = (name: string, role: Role): string => `${name} ${role}`;

export const theSwitcherListsOneWorkspace = async (
  page: Page,
  workspace: string,
  role: Role,
): Promise<void> => {
  await switcherOf(page, workspace).click();
  const menu = switcherMenuOf(page, workspace);
  await expect(menu.getByRole("menuitemradio")).toHaveText([listedAs(workspace, role)]);
  await expect(menu.getByRole("menuitem")).toHaveText(["All Workspaces"]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
};

export const theConsoleIsRefused = async (page: Page, gate: Gate): Promise<void> => {
  await page.goto(HOMES.operator.path);
  await expect(page.getByRole("heading", { level: 1, name: "Access Denied" })).toBeVisible();
  await saysARefusal(page.getByRole("alert"));
  await gate();
};
