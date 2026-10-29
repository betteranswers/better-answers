import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import { landedAtHome, provision, signInByEmail, withAnAuthenticator } from "../harness.ts";

const MEMBERS = HOMES.Admin.path;

const confirmHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Confirm It’s You" });

const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

const landedAt = (page: Page): URL => new URL(page.url());

const anAdminWaiting = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  const workspace = await provision(api, { name: workspaceName });
  const key = await withAnAuthenticator(api, workspace.admin.email);
  await page.goto("/sign-in");
  await signInByEmail(page, api, workspace.admin.email);
  await expect(confirmHeading(page)).toBeVisible();
  return { workspace, key };
};

const confirmedWith = async (page: Page, key: string): Promise<void> => {
  await codeField(page).fill(authenticatorCodeAt(key, new Date()));
};

test("a pending Admin opening Members confirms, then lands back there", async ({
  page,
  request,
}) => {
  const { key } = await anAdminWaiting(page, request, "Calder Joinery");

  await page.goto(MEMBERS);

  await expect(confirmHeading(page)).toBeVisible();
  expect(`${landedAt(page).pathname}${landedAt(page).search}`).toBe(
    `/confirm?redirect=${encodeURIComponent(MEMBERS)}`,
  );
  await expect(codeField(page)).toBeFocused();
  await confirmedWith(page, key);
  await landedAtHome(page, "Admin");
});
