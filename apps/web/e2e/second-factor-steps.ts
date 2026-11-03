import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { expect } from "./browser.ts";
import { enrolledWith, personMenuOpened, provision, signInByEmail } from "./harness.ts";

const CONFIRM_HEADING = "Confirm It’s You";

export const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

export const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

export const theRefusal = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

export const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

export const recoveryField = (page: Page) => page.getByRole("textbox", { name: "Recovery Code" });

export const codesListed = (page: Page) =>
  page.getByRole("list", { name: "Recovery Codes" }).getByRole("listitem");

export const saidOfTheSet = (page: Page) =>
  page.getByRole("region", { name: "Save Your Recovery Codes" }).getByRole("paragraph");

export const codesTicked = async (page: Page, finish: string): Promise<void> => {
  await page.getByRole("checkbox", { name: "I have saved these codes" }).check();
  await page.getByRole("button", { name: finish }).click();
  await expect(codesListed(page)).toHaveCount(0);
};

const accountHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Account" });

export const regionOf = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

export const accountFromTheBand = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: "Account" }).click();
  await expect(accountHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
};

const signedInWaiting = async (page: Page, api: APIRequestContext, email: string, on: string) => {
  await page.goto("/sign-in");
  await signInByEmail(page, api, email);
  await expect(heading(page, on)).toBeVisible();
};

export const signedInAgain = async (page: Page, api: APIRequestContext, email: string) => {
  await page.context().clearCookies();
  await signedInWaiting(page, api, email, CONFIRM_HEADING);
};

export const anAdminWithAnAuthenticator = async (
  page: Page,
  api: APIRequestContext,
  codes: "saved" | "none" = "saved",
) => {
  const { admin } = await provision(api, { name: "Calder Confirmations" });
  const { key, recoveryCodes } = await enrolledWith(api, admin.email, codes);
  await signedInWaiting(page, api, admin.email, CONFIRM_HEADING);
  return { email: admin.email, key, codes: recoveryCodes };
};
