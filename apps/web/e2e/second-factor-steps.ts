import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { AUTHENTICATOR_WORDS, RECOVERY_CODE_WORDS } from "@/features/auth/account-words.ts";
import {
  CONFIRM_WORDS,
  RECOVERY_WORDS,
} from "@/features/auth/second-factor/second-factor-words.ts";

import { expect } from "./browser.ts";
import { enrolledWith, personMenuOpened, provision, signInByEmail } from "./harness.ts";

const CONFIRM_HEADING = CONFIRM_WORDS.heading;

export const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

export const codeField = (page: Page) =>
  page.getByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });

export const theRefusal = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

export const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

export const recoveryField = (page: Page) =>
  page.getByRole("textbox", { name: RECOVERY_WORDS.field });

export const codesListed = (page: Page) =>
  page.getByRole("list", { name: RECOVERY_CODE_WORDS.heading }).getByRole("listitem");

export const recoveryCodesParagraphs = (page: Page) =>
  page.getByRole("region", { name: RECOVERY_CODE_WORDS.saveHeading }).getByRole("paragraph");

export const codesTicked = async (page: Page, finish: string): Promise<void> => {
  await page.getByRole("checkbox", { name: "I have saved these codes" }).check();
  await page.getByRole("button", { name: finish }).click();
  await expect(codesListed(page)).toHaveCount(0);
};

const accountHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Account" });

export const regionOf = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

export const openAccountFromPersonMenu = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: "Account" }).click();
  await expect(accountHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
};

const signInToHeading = async (
  page: Page,
  api: APIRequestContext,
  email: string,
  headingName: string,
) => {
  await page.goto("/sign-in");
  await signInByEmail(page, api, email);
  await expect(heading(page, headingName)).toBeVisible();
};

export const signedInAgain = async (page: Page, api: APIRequestContext, email: string) => {
  await page.context().clearCookies();
  await signInToHeading(page, api, email, CONFIRM_HEADING);
};

export const anAdminWithAnAuthenticator = async (
  page: Page,
  api: APIRequestContext,
  codes: "saved" | "none" = "saved",
) => {
  const { admin } = await provision(api, { name: "Calder Confirmations" });
  const { key, recoveryCodes } = await enrolledWith(api, admin.email, codes);
  await signInToHeading(page, api, admin.email, CONFIRM_HEADING);
  return { email: admin.email, key, codes: recoveryCodes };
};
