import type { Page } from "@playwright/test";

import { ALL_WORKSPACES } from "@/app/words.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

import { saysARefusal, switcherMenuOf, switcherOf } from "../e2e/locators.ts";
import { expect } from "./fixtures.ts";

/** The audit of the page the journey is about to leave. */
export type Gate = () => Promise<void>;

/** An item of the switcher reads its workspace's name, then the person's role there. */
const listedAs = (name: string, role: Role): string => `${name} ${role}`;

/** A test person belongs to the test workspace alone, and no menu offers them the console. */
export const theSwitcherListsOneWorkspace = async (
  page: Page,
  workspace: string,
  role: Role,
): Promise<void> => {
  await switcherOf(page, workspace).click();
  const menu = switcherMenuOf(page, workspace);
  await expect(menu.getByRole("menuitemradio")).toHaveText([listedAs(workspace, role)]);
  await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
};

/** Written out: the console's word table imports tRPC code at runtime. */
const CLOSED = "Access Denied";

/** No test person is the operator. A standing left unread alerts too, under another heading. */
export const theConsoleIsRefused = async (page: Page, gate: Gate): Promise<void> => {
  await page.goto(HOMES.operator.path);
  await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
  await saysARefusal(page.getByRole("alert"));
  await gate();
};
