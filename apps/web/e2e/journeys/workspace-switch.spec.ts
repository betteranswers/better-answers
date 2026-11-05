import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  inTwoWorkspaces,
  landedAtHome,
  person,
  switcherMenuOf,
  switcherOf,
} from "../harness.ts";

const SWITCH_BUDGET_MS = 1000;

const workspacesIn = (menu: Locator): Locator => menu.getByRole("menuitemradio");

const memberLink = (page: Page, name: string): Locator =>
  page.getByRole("main").getByRole("link", { name, exact: true });

const addViewerTo = async (api: APIRequestContext, workspaceId: string, name: string) => {
  const member = await person(api, anAddress("only"), { displayName: name });
  await addMember(api, { workspaceId, userId: member.id, role: "Viewer" });
  return member.id;
};

test("an Admin switches workspace and sees its home and members", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Wharfe Joinery",
    second: "Aire Joinery",
  });
  await addViewerTo(request, first.workspaceId, "Only In Wharfe");
  await addViewerTo(request, second.workspaceId, "Only In Aire");
  await page.reload();
  await expect(memberLink(page, "Only In Wharfe")).toBeVisible();

  await switcherOf(page, first.name).click();
  const started = Date.now();
  await workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name }).click();

  await expect(memberLink(page, "Only In Aire")).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "switching workspace", description: `${elapsed} ms` });
  expect(elapsed, "the workspace switch took longer than one second").toBeLessThan(
    SWITCH_BUDGET_MS,
  );

  await landedAtHome(page, "Admin");
  await expect(memberLink(page, "Only In Wharfe")).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(switcherOf(page, first.name)).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeFocused();
});
