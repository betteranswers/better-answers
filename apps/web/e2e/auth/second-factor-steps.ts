import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { expect } from "../browser.ts";
import { enrolledWith, provision, signInByEmail } from "../harness.ts";

const CONFIRM_HEADING = "Confirm It’s You";

export const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

export const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

export const theRefusal = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

export const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

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
